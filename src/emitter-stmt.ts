/**
 * C++ statement emission — converts Doof AST statement nodes to C++ code.
 *
 * Handles statement dispatch, variable declarations, try/catch bindings,
 * control flow (if/while/for), and block emission. Declaration-level
 * constructs (classes, interfaces, enums, functions, type aliases) are
 * in emitter-decl.ts; JSON serialization is in emitter-json.ts.
 */

import type {
  Statement,
  Block,
  Expression,
  TryBinding,
  TryStatement,
  WithStatement,
  ElseNarrowStatement,
} from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitType, isPointerType, isVariantUnionType, isOptionalNullable, isMonostateNullable } from "./emitter-types.js";
import { substituteEmitType } from "./emitter-monomorphize.js";
import { emitExpression, indent, emitIdentifierSafe, emitBlockBody } from "./emitter-expr.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExtractNarrowedValue } from "./emitter-narrowing.js";
import { resolveTypeAnnotation } from "./emitter-expr-utils.js";
import {
  emitFunctionDecl,
  emitClassDecl,
  emitInterfaceDecl,
  emitEnumDecl,
  emitTypeAlias,
} from "./emitter-decl.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Emit a C++ statement (one or more lines) for a Doof statement node.
 * Appends lines to ctx.sourceLines (or ctx.headerLines for declarations).
 */
export function emitStatement(stmt: Statement, ctx: EmitContext): void {
  switch (stmt.kind) {
    case "mock-import-directive":
      break;

    case "const-declaration":
      emitConstDecl(stmt, ctx);
      break;

    case "readonly-declaration":
      emitReadonlyDecl(stmt, ctx);
      break;

    case "immutable-binding":
      emitImmutableBinding(stmt, ctx);
      break;

    case "let-declaration":
      emitLetDecl(stmt, ctx);
      break;

    case "function-declaration":
      emitFunctionDecl(stmt, ctx);
      break;

    case "class-declaration":
      emitClassDecl(stmt, ctx);
      break;

    case "interface-declaration":
      emitInterfaceDecl(stmt, ctx);
      break;

    case "enum-declaration":
      emitEnumDecl(stmt, ctx);
      break;

    case "type-alias-declaration":
      emitTypeAlias(stmt, ctx);
      break;

    case "return-statement": {
      const ind = indent(ctx);
      if (stmt.value) {
        const fnRet = substituteEmitType(ctx.currentFunctionReturnType, ctx);
        const val = emitExpression(stmt.value, ctx, fnRet);
        // If enclosing function returns Result<T,E> and value is not already Result,
        // wrap in Result::success()
        const valType = substituteEmitType(stmt.value.resolvedType, ctx);
        if (fnRet && fnRet.kind === "result" && valType && valType.kind !== "result") {
          const resultCppType = emitType(fnRet);
          ctx.sourceLines.push(`${ind}return ${resultCppType}::success(${val});`);
        } else {
          ctx.sourceLines.push(`${ind}return ${val};`);
        }
      } else {
        ctx.sourceLines.push(`${ind}return;`);
      }
      break;
    }

    case "yield-statement": {
      const ind = indent(ctx);
      const val = emitExpression(stmt.value, ctx, ctx.caseExpressionYieldType);
      ctx.sourceLines.push(`${ind}return ${val};`);
      break;
    }

    case "if-statement":
      emitIfStatement(stmt, ctx);
      break;

    case "case-statement":
      emitCaseStatement(stmt, ctx);
      break;

    case "while-statement":
      emitWhileStatement(stmt, ctx);
      break;

    case "for-statement":
      emitForStatement(stmt, ctx);
      break;

    case "for-of-statement":
      emitForOfStatement(stmt, ctx);
      break;

    case "with-statement":
      emitWithStatement(stmt, ctx);
      break;

    case "break-statement": {
      const ind = indent(ctx);
      const loopControl = findLoopControl(ctx, stmt.label);
      if (loopControl?.naturalCompletionFlag) {
        ctx.sourceLines.push(`${ind}${loopControl.naturalCompletionFlag} = false;`);
      }
      if (stmt.label) {
        ctx.sourceLines.push(`${ind}goto ${stmt.label}_break;`);
      } else {
        ctx.sourceLines.push(`${ind}break;`);
      }
      break;
    }

    case "continue-statement": {
      const ind = indent(ctx);
      if (stmt.label) {
        ctx.sourceLines.push(`${ind}goto ${stmt.label}_continue;`);
      } else {
        ctx.sourceLines.push(`${ind}continue;`);
      }
      break;
    }

    case "expression-statement": {
      const ind = indent(ctx);
      ctx.sourceLines.push(`${ind}${emitExpression(stmt.expression, ctx)};`);
      break;
    }

    case "array-destructuring":
      emitArrayDestructuring(stmt.bindingKind, stmt.bindings, emitExpression(stmt.value, ctx), ctx);
      break;

    case "array-destructuring-assignment":
      emitArrayDestructuringAssignment(stmt.bindings, emitExpression(stmt.value, ctx), ctx);
      break;

    case "block":
      emitBlock(stmt, ctx);
      break;

    case "positional-destructuring": {
      const val = emitExpression(stmt.value, ctx);
      if (stmt.bindings.includes("_")) {
        emitPositionalDestructuringWithDiscards(
          stmt.bindingKind,
          stmt.bindings,
          val,
          stmt.value.resolvedType,
          ctx,
        );
      } else {
        const ind = indent(ctx);
        const qualifier = stmt.bindingKind === "let" ? "auto" : "const auto";
        const bindings = stmt.bindings.join(", ");
        ctx.sourceLines.push(`${ind}${qualifier} [${bindings}] = ${val};`);
      }
      break;
    }

    case "positional-destructuring-assignment": {
      emitPositionalDestructuringAssignment(
        stmt.bindings,
        emitExpression(stmt.value, ctx),
        stmt.value.resolvedType,
        ctx,
      );
      break;
    }

    case "named-destructuring": {
      const ind = indent(ctx);
      const qualifier = stmt.bindingKind === "let" ? "auto" : "const auto";
      const val = emitExpression(stmt.value, ctx);
      // Emit the value into a temp to avoid re-evaluation
      const tmp = `_dest${ctx.tempCounter++}`;
      ctx.sourceLines.push(`${ind}const auto& ${tmp} = ${val};`);
      // Determine accessor based on whether value is a pointer type (class → ->)
      const valType = stmt.value.resolvedType;
      const accessor = valType && isPointerType(valType) ? "->" : ".";
      // Emit one variable per binding, accessing by field name
      for (const binding of stmt.bindings) {
        const localName = emitIdentifierSafe(binding.alias ?? binding.name);
        const fieldName = emitIdentifierSafe(binding.name);
        ctx.sourceLines.push(`${ind}${qualifier} ${localName} = ${tmp}${accessor}${fieldName};`);
      }
      break;
    }

    case "named-destructuring-assignment":
      emitNamedDestructuringAssignment(stmt.bindings, emitExpression(stmt.value, ctx), stmt.value.resolvedType, ctx);
      break;

    // Import/export/extern declarations are handled at module level; skip here
    case "import-declaration":
    case "extern-class-declaration":
    case "extern-function-declaration":
    case "export-declaration":
    case "export-list":
    case "export-all-declaration":
      break;

    case "try-statement":
      emitTryStatement(stmt, ctx);
      break;

    case "else-narrow-statement":
      emitElseNarrowStatement(stmt, ctx);
      break;

    default:
      ctx.sourceLines.push(`${indent(ctx)}/* unhandled statement: ${(stmt as Statement).kind} */`);
  }
}

function findLoopControl(
  ctx: EmitContext,
  label: string | null,
): { label: string | null; naturalCompletionFlag: string | null } | null {
  const loopControls = ctx.loopControls ?? [];
  if (label === null) {
    return loopControls[loopControls.length - 1] ?? null;
  }
  for (let index = loopControls.length - 1; index >= 0; index--) {
    if (loopControls[index].label === label) {
      return loopControls[index];
    }
  }
  return null;
}

// ============================================================================
// Variable declarations
// ============================================================================

/**
 * Emit a catch-expression as the direct RHS of a binding declaration.
 * Statement-level form (no IIFE): declares the error variable, emits
 * do { ... } while(false), then assigns the variable name.
 *
 * Pattern:
 *   CppType _catch_N = std::nullopt;          // or std::monostate{}
 *   do {
 *       auto _try_M = rhs;
 *       if (_try_M.isFailure()) { _catch_N = std::move(_try_M.error()); break; }
 *       const auto x = std::move(_try_M.value());
 *       ...
 *   } while (false);
 *   const auto varName = _catch_N;            // optional alias
 */
function emitCatchBinding(
  varName: string,
  catchExpr: import("./ast.js").CatchExpression,
  qualifier: string,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const catchVar = `_catch_${ctx.tempCounter++}`;
  const resolvedType = catchExpr.resolvedType;
  const cppType = resolvedType ? emitType(resolvedType) : "auto";

  // Determine the null initializer based on the emitted C++ type
  // std::optional<T> → std::nullopt
  // std::shared_ptr<T> / std::weak_ptr<T> → nullptr
  // std::variant<std::monostate, ...> → std::monostate{}
  let nullInit: string;
  if (cppType.startsWith("std::optional")) {
    nullInit = "std::nullopt";
  } else if (cppType.startsWith("std::shared_ptr") || cppType.startsWith("std::weak_ptr")) {
    nullInit = "nullptr";
  } else {
    nullInit = "std::monostate{}";
  }

  ctx.sourceLines.push(`${ind}${cppType} ${catchVar} = ${nullInit};`);
  ctx.sourceLines.push(`${ind}do {`);

  // Emit body statements inside the do block with catch context
  const prevCatchVar = ctx.catchVarName;
  ctx.catchVarName = catchVar;
  const innerCtx = { ...ctx, indent: ctx.indent + 1 };
  for (const stmt of catchExpr.body) {
    emitStatement(stmt, innerCtx);
  }
  ctx.catchVarName = prevCatchVar;
  // Sync the tempCounter back
  ctx.tempCounter = innerCtx.tempCounter;

  ctx.sourceLines.push(`${ind}} while (false);`);
  ctx.sourceLines.push(`${ind}${qualifier} ${emitIdentifierSafe(varName)} = ${catchVar};`);
}

function emitConstDecl(
  stmt: import("./ast.js").ConstDeclaration,
  ctx: EmitContext,
): void {
  // Catch expression as binding RHS → statement-level emission
  if (stmt.value.kind === "catch-expression") {
    emitCatchBinding(stmt.name, stmt.value, "const auto", ctx);
    return;
  }

  const ind = indent(ctx);
  const name = emitIdentifierSafe(stmt.name);
  const declType = substituteEmitType(stmt.resolvedType, ctx);
  const explicitCppType = stmt.type && declType ? emitType(declType) : null;

  // Emit description comment
  if (stmt.description) {
    ctx.sourceLines.push(`${ind}// ${stmt.description}`);
  }

  const val = emitExpression(stmt.value, ctx, declType);
  assertDeclarationTypeResolved(stmt.name, declType);

  // For variant union types, emit explicit type instead of auto
  if (explicitCppType) {
    ctx.sourceLines.push(`${ind}const ${explicitCppType} ${name} = ${val};`);
  } else if (declType && isVariantUnionType(declType)) {
    const cppType = emitType(declType);
    ctx.sourceLines.push(`${ind}const ${cppType} ${name} = ${val};`);
  } else if (isConstexprValue(stmt.value)) {
    ctx.sourceLines.push(`${ind}constexpr auto ${name} = ${val};`);
  } else {
    ctx.sourceLines.push(`${ind}const auto ${name} = ${val};`);
  }
}

function emitReadonlyDecl(
  stmt: import("./ast.js").ReadonlyDeclaration,
  ctx: EmitContext,
): void {
  // Catch expression as binding RHS → statement-level emission
  if (stmt.value.kind === "catch-expression") {
    emitCatchBinding(stmt.name, stmt.value, "const auto", ctx);
    return;
  }

  const ind = indent(ctx);
  const name = emitIdentifierSafe(stmt.name);
  const declType = substituteEmitType(stmt.resolvedType, ctx);
  const explicitCppType = stmt.type && declType ? emitType(declType) : null;

  // Emit description comment
  if (stmt.description) {
    ctx.sourceLines.push(`${ind}// ${stmt.description}`);
  }

  const val = emitExpression(stmt.value, ctx, declType);
  assertDeclarationTypeResolved(stmt.name, declType);

  // readonly on class types → shared_ptr<const T>
  if (declType && declType.kind === "class") {
    const innerType = declType.symbol.name;
    ctx.sourceLines.push(`${ind}const std::shared_ptr<const ${innerType}> ${name} = ${val};`);
  } else if (explicitCppType) {
    ctx.sourceLines.push(`${ind}const ${explicitCppType} ${name} = ${val};`);
  } else {
    ctx.sourceLines.push(`${ind}const auto ${name} = ${val};`);
  }
}

function emitImmutableBinding(
  stmt: import("./ast.js").ImmutableBinding,
  ctx: EmitContext,
): void {
  // Catch expression as binding RHS → statement-level emission
  if (stmt.value.kind === "catch-expression") {
    emitCatchBinding(stmt.name, stmt.value, "const auto", ctx);
    return;
  }

  const ind = indent(ctx);
  const name = emitIdentifierSafe(stmt.name);
  const declType = substituteEmitType(stmt.resolvedType, ctx);
  const explicitCppType = stmt.type && declType ? emitType(declType) : null;
  const val = emitExpression(stmt.value, ctx, declType);
  assertDeclarationTypeResolved(stmt.name, declType);

  // := → const auto (shallow immutable: binding can't change, pointee mutable)
  if (declType && declType.kind === "class") {
    const cppType = emitType(declType);
    ctx.sourceLines.push(`${ind}const ${cppType} ${name} = ${val};`);
  } else if (explicitCppType) {
    ctx.sourceLines.push(`${ind}const ${explicitCppType} ${name} = ${val};`);
  } else {
    ctx.sourceLines.push(`${ind}const auto ${name} = ${val};`);
  }
}

function emitLetDecl(
  stmt: import("./ast.js").LetDeclaration,
  ctx: EmitContext,
): void {
  // Catch expression as binding RHS → statement-level emission
  if (stmt.value.kind === "catch-expression") {
    emitCatchBinding(stmt.name, stmt.value, "auto", ctx);
    return;
  }

  const ind = indent(ctx);
  const name = emitIdentifierSafe(stmt.name);
  const declType = substituteEmitType(stmt.resolvedType, ctx);
  const explicitCppType = stmt.type && declType ? emitType(declType) : null;
  const val = emitExpression(stmt.value, ctx, declType);
  assertDeclarationTypeResolved(stmt.name, declType);

  // Heap-box captured mutable variables so escaping lambdas don't dangle.
  if (ctx.capturedMutables?.has(stmt.name) && declType) {
    const cppType = emitType(declType);
    ctx.sourceLines.push(`${ind}auto ${name} = std::make_shared<${cppType}>(${val});`);
    return;
  }

  // For variant union types (e.g. Foo | Bar | null), we must use the explicit type
  // instead of auto, because auto would deduce the narrower type of the initializer
  // (e.g. shared_ptr<Foo>) and fail on later reassignment to other variants.
  if (explicitCppType) {
    ctx.sourceLines.push(`${ind}${explicitCppType} ${name} = ${val};`);
  } else if (declType && isVariantUnionType(declType)) {
    const cppType = emitType(declType);
    ctx.sourceLines.push(`${ind}${cppType} ${name} = ${val};`);
  } else {
    ctx.sourceLines.push(`${ind}auto ${name} = ${val};`);
  }
}

function assertDeclarationTypeResolved(
  name: string,
  resolvedType: import("./checker-types.js").ResolvedType | undefined,
): void {
  if (!resolvedType) {
    throw new Error(`Cannot emit declaration "${name}" without checker type information`);
  }
  if (resolvedType.kind === "unknown") {
    throw new Error(`Cannot emit declaration "${name}" with unresolved type`);
  }
}

// ============================================================================
// Try statement
// ============================================================================

/**
 * Emit a `try` statement: evaluate the Result-typed RHS into a temp,
 * check for failure (early return), then bind the success value.
 *
 * Generated pattern:
 *   auto _try_N = <rhs>;
 *   if (_try_N.isFailure()) return doof::Result<OutT, OutE>::failure(std::move(_try_N.error()));
 *   const auto x = std::move(_try_N.value());
 */
function emitTryStatement(stmt: TryStatement, ctx: EmitContext): void {
  const ind = indent(ctx);
  const tmp = `_try_${ctx.tempCounter++}`;
  const binding = stmt.binding;

  // Extract the RHS expression from the inner binding
  const rhsExpr = getTryBindingRhs(binding);
  if (!rhsExpr) {
    ctx.sourceLines.push(`${ind}/* try: could not extract RHS */`);
    return;
  }

  const rhs = emitExpression(rhsExpr, ctx);

  // Emit the temp assignment
  ctx.sourceLines.push(`${ind}auto ${tmp} = ${rhs};`);

  // Inside a catch expression: break instead of return, assign error to catch var
  if (ctx.catchVarName) {
    ctx.sourceLines.push(`${ind}if (${tmp}.isFailure()) { ${ctx.catchVarName} = std::move(${tmp}.error()); break; }`);
  } else {
    // Emit the failure check with early return
    // Use the enclosing function's return type for the Result wrapping
    const fnRet = ctx.currentFunctionReturnType;
    if (fnRet && fnRet.kind === "result") {
      const retType = emitType(fnRet);
      ctx.sourceLines.push(`${ind}if (${tmp}.isFailure()) return ${retType}::failure(std::move(${tmp}.error()));`);
    } else {
      // Fallback: use the RHS result type
      const rhsType = rhsExpr.resolvedType;
      if (rhsType && rhsType.kind === "result") {
        const retType = emitType(rhsType);
        ctx.sourceLines.push(`${ind}if (${tmp}.isFailure()) return ${retType}::failure(std::move(${tmp}.error()));`);
      } else {
        ctx.sourceLines.push(`${ind}if (${tmp}.isFailure()) return std::move(${tmp}.error());`);
      }
    }
  }

  const rhsType = rhsExpr.resolvedType;
  const isVoidSuccessResult = rhsType?.kind === "result" && rhsType.successType.kind === "void";
  const isBareExpressionTry = binding.kind === "expression-statement"
    && binding.expression.kind !== "assignment-expression";
  if (isVoidSuccessResult && !isBareExpressionTry) {
    throw new Error('Result<void, E> try statements can only be emitted for bare "try expr" forms');
  }

  // Emit the variable binding from the unwrapped value
  emitTryBinding(binding, tmp, ctx);
}

/** Extract the RHS expression from a TryBinding. */
function getTryBindingRhs(binding: TryBinding): Expression | null {
  switch (binding.kind) {
    case "immutable-binding":
    case "const-declaration":
    case "readonly-declaration":
    case "let-declaration":
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      return binding.value;
    case "expression-statement": {
      const expr = binding.expression;
      if (expr.kind !== "assignment-expression") return expr;
      if (expr.kind === "assignment-expression") return expr.value;
      return null;
    }
    default:
      return null;
  }
}

/** Emit the variable binding(s) using the unwrapped value from the temp. */
function emitTryBinding(binding: TryBinding, tmp: string, ctx: EmitContext): void {
  const ind = indent(ctx);

  switch (binding.kind) {
    case "const-declaration":
    case "readonly-declaration": {
      const name = emitIdentifierSafe(binding.name);
      const cppType = binding.type && binding.resolvedType ? emitType(binding.resolvedType) : null;
      const qualifier = cppType ? `const ${cppType}` : "const auto";
      ctx.sourceLines.push(`${ind}${qualifier} ${name} = std::move(${tmp}.value());`);
      break;
    }
    case "immutable-binding": {
      const name = emitIdentifierSafe(binding.name);
      const cppType = binding.type && binding.resolvedType ? emitType(binding.resolvedType) : null;
      const qualifier = cppType ? `const ${cppType}` : "const auto";
      ctx.sourceLines.push(`${ind}${qualifier} ${name} = std::move(${tmp}.value());`);
      break;
    }
    case "let-declaration": {
      const name = emitIdentifierSafe(binding.name);
      const cppType = binding.type && binding.resolvedType ? emitType(binding.resolvedType) : null;
      const qualifier = cppType ?? "auto";
      ctx.sourceLines.push(`${ind}${qualifier} ${name} = std::move(${tmp}.value());`);
      break;
    }
    case "expression-statement": {
      // Assignment: x = expr
      const expr = binding.expression;
      if (expr.kind === "assignment-expression") {
        const target = emitExpression(expr.target, ctx);
        ctx.sourceLines.push(`${ind}${target} = std::move(${tmp}.value());`);
      }
      break;
    }
    case "array-destructuring-assignment": {
      emitArrayDestructuringAssignment(binding.bindings, `${tmp}.value()`, ctx);
      break;
    }
    case "array-destructuring": {
      const arrayTmp = `_arr${ctx.tempCounter++}`;
      ctx.sourceLines.push(`${ind}const auto& ${arrayTmp} = ${tmp}.value();`);
      emitArrayDestructuring(binding.bindingKind, binding.bindings, arrayTmp, ctx, false);
      break;
    }
    case "positional-destructuring": {
      if (binding.bindings.includes("_")) {
        const sourceType = binding.value.resolvedType?.kind === "result"
          ? binding.value.resolvedType.successType
          : binding.value.resolvedType;
        emitPositionalDestructuringWithDiscards(
          binding.bindingKind,
          binding.bindings,
          `${tmp}.value()`,
          sourceType,
          ctx,
        );
      } else {
        const qualifier = binding.bindingKind === "let" ? "auto" : "const auto";
        const bindings = binding.bindings.join(", ");
        ctx.sourceLines.push(`${ind}${qualifier} [${bindings}] = std::move(${tmp}.value());`);
      }
      break;
    }
    case "positional-destructuring-assignment": {
      const sourceType = binding.value.resolvedType?.kind === "result"
        ? binding.value.resolvedType.successType
        : binding.value.resolvedType;
      emitPositionalDestructuringAssignment(binding.bindings, `${tmp}.value()`, sourceType, ctx);
      break;
    }
    case "named-destructuring": {
      const qualifier = binding.bindingKind === "let" ? "auto" : "const auto";
      const valType = binding.value.resolvedType;
      const accessor = valType && isPointerType(valType) ? "->" : ".";
      const inner = `${tmp}.value()`;
      for (const b of binding.bindings) {
        const localName = emitIdentifierSafe(b.alias ?? b.name);
        const fieldName = emitIdentifierSafe(b.name);
        ctx.sourceLines.push(`${ind}${qualifier} ${localName} = ${inner}${accessor}${fieldName};`);
      }
      break;
    }
    case "named-destructuring-assignment": {
      const sourceType = binding.value.resolvedType?.kind === "result"
        ? binding.value.resolvedType.successType
        : binding.value.resolvedType;
      emitNamedDestructuringAssignment(binding.bindings, `${tmp}.value()`, sourceType, ctx);
      break;
    }
  }
}

function emitArrayDestructuring(
  bindingKind: "immutable" | "let",
  bindings: readonly string[],
  valueExpr: string,
  ctx: EmitContext,
  captureValue: boolean = true,
): void {
  const ind = indent(ctx);
  const qualifier = bindingKind === "let" ? "auto" : "const auto";
  const arrayRef = captureValue ? `_arr${ctx.tempCounter++}` : valueExpr;

  if (captureValue) {
    ctx.sourceLines.push(`${ind}const auto& ${arrayRef} = ${valueExpr};`);
  }
  ctx.sourceLines.push(`${ind}doof::array_require_min_size(${arrayRef}, ${bindings.length});`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    ctx.sourceLines.push(`${ind}${qualifier} ${emitIdentifierSafe(name)} = doof::array_at(${arrayRef}, ${index});`);
  }
}

function emitArrayDestructuringAssignment(
  bindings: readonly string[],
  valueExpr: string,
  ctx: EmitContext,
  captureValue: boolean = true,
): void {
  const ind = indent(ctx);
  const arrayRef = captureValue ? `_arr${ctx.tempCounter++}` : valueExpr;

  if (captureValue) {
    ctx.sourceLines.push(`${ind}const auto& ${arrayRef} = ${valueExpr};`);
  }
  ctx.sourceLines.push(`${ind}doof::array_require_min_size(${arrayRef}, ${bindings.length});`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    ctx.sourceLines.push(`${ind}${emitIdentifierSafe(name)} = doof::array_at(${arrayRef}, ${index});`);
  }
}

function emitPositionalDestructuringWithDiscards(
  bindingKind: "immutable" | "let",
  bindings: readonly string[],
  valueExpr: string,
  sourceType: ResolvedType | undefined,
  ctx: EmitContext,
): void {
  if (sourceType?.kind === "class") {
    emitClassPositionalDestructuringWithDiscards(bindingKind, bindings, valueExpr, sourceType, ctx);
    return;
  }
  emitTuplePositionalDestructuringWithDiscards(bindingKind, bindings, valueExpr, ctx);
}

function emitTuplePositionalDestructuringWithDiscards(
  bindingKind: "immutable" | "let",
  bindings: readonly string[],
  valueExpr: string,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const qualifier = bindingKind === "let" ? "auto" : "const auto";
  const tupleRef = `_tuple${ctx.tempCounter++}`;

  ctx.sourceLines.push(`${ind}const auto& ${tupleRef} = ${valueExpr};`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    ctx.sourceLines.push(`${ind}${qualifier} ${emitIdentifierSafe(name)} = std::get<${index}>(${tupleRef});`);
  }
}

function emitClassPositionalDestructuringWithDiscards(
  bindingKind: "immutable" | "let",
  bindings: readonly string[],
  valueExpr: string,
  sourceType: Extract<ResolvedType, { kind: "class" }>,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const qualifier = bindingKind === "let" ? "auto" : "const auto";
  const objectRef = `_obj${ctx.tempCounter++}`;
  const fieldNames = sourceType.symbol.declaration.fields.flatMap((field) =>
    field.static_ ? [] : field.names,
  );

  ctx.sourceLines.push(`${ind}const auto& ${objectRef} = ${valueExpr};`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    const fieldName = fieldNames[index];
    if (!fieldName) continue;
    ctx.sourceLines.push(`${ind}${qualifier} ${emitIdentifierSafe(name)} = ${objectRef}->${emitIdentifierSafe(fieldName)};`);
  }
}

function emitPositionalDestructuringAssignment(
  bindings: readonly string[],
  valueExpr: string,
  sourceType: ResolvedType | undefined,
  ctx: EmitContext,
): void {
  if (sourceType?.kind === "class") {
    emitClassPositionalDestructuringAssignment(bindings, valueExpr, sourceType, ctx);
    return;
  }
  emitTuplePositionalDestructuringAssignment(bindings, valueExpr, ctx);
}

function emitTuplePositionalDestructuringAssignment(
  bindings: readonly string[],
  valueExpr: string,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const tupleRef = `_tuple${ctx.tempCounter++}`;

  ctx.sourceLines.push(`${ind}const auto& ${tupleRef} = ${valueExpr};`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    ctx.sourceLines.push(`${ind}${emitIdentifierSafe(name)} = std::get<${index}>(${tupleRef});`);
  }
}

function emitClassPositionalDestructuringAssignment(
  bindings: readonly string[],
  valueExpr: string,
  sourceType: Extract<ResolvedType, { kind: "class" }>,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const objectRef = `_obj${ctx.tempCounter++}`;
  const fieldNames = sourceType.symbol.declaration.fields.flatMap((field) =>
    field.static_ ? [] : field.names,
  );

  ctx.sourceLines.push(`${ind}const auto& ${objectRef} = ${valueExpr};`);
  for (let index = 0; index < bindings.length; index++) {
    const name = bindings[index];
    if (name === "_") continue;
    const fieldName = fieldNames[index];
    if (!fieldName) continue;
    ctx.sourceLines.push(`${ind}${emitIdentifierSafe(name)} = ${objectRef}->${emitIdentifierSafe(fieldName)};`);
  }
}

function emitNamedDestructuringAssignment(
  bindings: readonly import("./ast.js").DestructureBinding[],
  valueExpr: string,
  sourceType: ResolvedType | undefined,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const tmp = `_dest${ctx.tempCounter++}`;
  const accessor = sourceType && isPointerType(sourceType) ? "->" : ".";

  ctx.sourceLines.push(`${ind}const auto& ${tmp} = ${valueExpr};`);
  for (const binding of bindings) {
    const localName = emitIdentifierSafe(binding.alias ?? binding.name);
    const fieldName = emitIdentifierSafe(binding.name);
    ctx.sourceLines.push(`${ind}${localName} = ${tmp}${accessor}${fieldName};`);
  }
}

// ============================================================================
// Control flow
// ============================================================================

function emitIfStatement(
  stmt: import("./ast.js").IfStatement,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const cond = emitExpression(stmt.condition, ctx);

  ctx.sourceLines.push(`${ind}if (${cond}) {`);
  emitBlockStatements(stmt.body, { ...ctx, indent: ctx.indent + 1 });
  ctx.sourceLines.push(`${ind}}`);

  for (const elseIf of stmt.elseIfs) {
    const eiCond = emitExpression(elseIf.condition, ctx);
    ctx.sourceLines.push(`${ind}else if (${eiCond}) {`);
    emitBlockStatements(elseIf.body, { ...ctx, indent: ctx.indent + 1 });
    ctx.sourceLines.push(`${ind}}`);
  }

  if (stmt.else_) {
    ctx.sourceLines.push(`${ind}else {`);
    emitBlockStatements(stmt.else_, { ...ctx, indent: ctx.indent + 1 });
    ctx.sourceLines.push(`${ind}}`);
  }
}

function emitCaseStatement(
  stmt: import("./ast.js").CaseStatement,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const innerCtx = { ...ctx, indent: ctx.indent + 1 };
  const innerInd = indent(innerCtx);
  const tmp = `_case_subject_${ctx.tempCounter++}`;
  const subject = emitExpression(stmt.subject, ctx);
  const subjectType = stmt.subject.resolvedType;

  ctx.sourceLines.push(`${ind}{`);
  innerCtx.sourceLines.push(`${innerInd}auto ${tmp} = ${subject};`);

  if (subjectType?.kind === "result") {
    emitResultCaseStatementBranches(stmt.arms, tmp, innerCtx);
  } else if (subjectType && (subjectType.kind === "union" || subjectType.kind === "interface")) {
    emitVariantCaseStatementBranches(stmt.arms, tmp, subjectType, innerCtx);
  } else {
    emitValueCaseStatementBranches(stmt.arms, tmp, innerCtx);
  }

  ctx.tempCounter = innerCtx.tempCounter;
  ctx.sourceLines.push(`${ind}}`);
}

function emitValueCaseStatementBranches(
  arms: readonly import("./ast.js").CaseArm[],
  tmp: string,
  ctx: EmitContext,
): void {
  let hasPreviousBranch = false;

  for (const arm of arms) {
    for (const pattern of arm.patterns) {
      let condition: string | null = null;
      let bindingPrelude: string | null = null;

      if (pattern.kind === "value-pattern") {
        condition = `${tmp} == ${emitExpression(pattern.value, ctx)}`;
      } else if (pattern.kind === "range-pattern") {
        const conditions: string[] = [];
        if (pattern.start) {
          conditions.push(`${tmp} >= ${emitExpression(pattern.start, ctx)}`);
        }
        if (pattern.end) {
          const op = pattern.inclusive ? "<=" : "<";
          conditions.push(`${tmp} ${op} ${emitExpression(pattern.end, ctx)}`);
        }
        condition = conditions.join(" && ");
      } else if (pattern.kind === "type-pattern") {
        condition = "true";
        if (pattern.name !== "_") {
          bindingPrelude = `auto& ${emitIdentifierSafe(pattern.name)} = ${tmp};`;
        }
      }

      hasPreviousBranch = emitCaseStatementBranch(condition, bindingPrelude, arm.body, ctx, hasPreviousBranch);
      if (pattern.kind === "wildcard-pattern") return;
    }
  }
}

function emitResultCaseStatementBranches(
  arms: readonly import("./ast.js").CaseArm[],
  tmp: string,
  ctx: EmitContext,
): void {
  let hasPreviousBranch = false;

  for (const arm of arms) {
    for (const pattern of arm.patterns) {
      let condition: string | null = null;
      let bindingPrelude: string | null = null;

      if (pattern.kind === "type-pattern") {
        const typeName = pattern.type.kind === "named-type" ? pattern.type.name : null;
        if (typeName === "Success") {
          condition = `${tmp}.isSuccess()`;
        } else if (typeName === "Failure") {
          condition = `${tmp}.isFailure()`;
        } else {
          continue;
        }
        if (pattern.name !== "_") {
          bindingPrelude = `auto& ${emitIdentifierSafe(pattern.name)} = ${tmp};`;
        }
      }

      hasPreviousBranch = emitCaseStatementBranch(condition, bindingPrelude, arm.body, ctx, hasPreviousBranch);
      if (pattern.kind === "wildcard-pattern") return;
    }
  }
}

function emitVariantCaseStatementBranches(
  arms: readonly import("./ast.js").CaseArm[],
  tmp: string,
  subjectType: ResolvedType,
  ctx: EmitContext,
): void {
  let hasPreviousBranch = false;

  for (const arm of arms) {
    for (const pattern of arm.patterns) {
      let condition: string | null = null;
      let bindingPrelude: string | null = null;

      if (pattern.kind === "type-pattern") {
        const resolvedType = resolveTypeAnnotation(pattern.type, ctx);
        const cppType = emitType(resolvedType);
        condition = `std::holds_alternative<${cppType}>(${tmp})`;
        if (pattern.name !== "_") {
          bindingPrelude = `auto& ${emitIdentifierSafe(pattern.name)} = ${emitExtractNarrowedValue(tmp, subjectType, resolvedType, ctx)};`;
        }
      }

      hasPreviousBranch = emitCaseStatementBranch(condition, bindingPrelude, arm.body, ctx, hasPreviousBranch);
      if (pattern.kind === "wildcard-pattern") return;
    }
  }
}

function emitCaseStatementBranch(
  condition: string | null,
  bindingPrelude: string | null,
  body: Expression | Block,
  ctx: EmitContext,
  hasPreviousBranch: boolean,
): boolean {
  const ind = indent(ctx);
  const bodyCtx = { ...ctx, indent: ctx.indent + 1 };
  const bodyInd = indent(bodyCtx);

  if (condition === null) {
    if (hasPreviousBranch) {
      ctx.sourceLines.push(`${ind}else {`);
    } else {
      ctx.sourceLines.push(`${ind}{`);
    }
  } else if (hasPreviousBranch) {
    ctx.sourceLines.push(`${ind}else if (${condition}) {`);
  } else {
    ctx.sourceLines.push(`${ind}if (${condition}) {`);
  }

  if (bindingPrelude) {
    bodyCtx.sourceLines.push(`${bodyInd}${bindingPrelude}`);
  }

  if (body.kind === "block") {
    emitBlockStatements(body, bodyCtx);
  } else {
    bodyCtx.sourceLines.push(`${bodyInd}${emitExpression(body, bodyCtx)};`);
  }

  ctx.tempCounter = bodyCtx.tempCounter;
  ctx.sourceLines.push(`${ind}}`);
  return true;
}

function emitWhileStatement(
  stmt: import("./ast.js").WhileStatement,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const cond = emitExpression(stmt.condition, ctx);
  const naturalCompletionFlag = stmt.then_ ? `_loop_completed_${ctx.tempCounter++}` : null;

  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_continue:;`);
  }

  if (naturalCompletionFlag) {
    ctx.sourceLines.push(`${ind}bool ${naturalCompletionFlag} = true;`);
  }

  const loopCtx = {
    ...ctx,
    indent: ctx.indent + 1,
    loopControls: [...(ctx.loopControls ?? []), { label: stmt.label, naturalCompletionFlag }],
  };

  ctx.sourceLines.push(`${ind}while (${cond}) {`);
  emitBlockStatements(stmt.body, loopCtx);
  ctx.sourceLines.push(`${ind}}`);
  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_break:;`);
  }
  if (naturalCompletionFlag && stmt.then_) {
    ctx.sourceLines.push(`${ind}if (${naturalCompletionFlag}) {`);
    emitBlockStatements(stmt.then_, { ...ctx, indent: ctx.indent + 1 });
    ctx.sourceLines.push(`${ind}}`);
  }
}

function emitForStatement(
  stmt: import("./ast.js").ForStatement,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const naturalCompletionFlag = stmt.then_ ? `_loop_completed_${ctx.tempCounter++}` : null;

  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_continue:;`);
  }

  if (naturalCompletionFlag) {
    ctx.sourceLines.push(`${ind}bool ${naturalCompletionFlag} = true;`);
  }

  // Emit C-style for: for (init; cond; update)
  // Init
  let initStr = "";
  if (stmt.init) {
    // Capture init as an expression-like thing
    const tempLines: string[] = [];
    const tempCtx = { ...ctx, sourceLines: tempLines, indent: 0 };
    emitStatement(stmt.init, tempCtx);
    initStr = tempLines[0]?.trim().replace(/;$/, "") ?? "";
  }

  const condStr = stmt.condition ? emitExpression(stmt.condition, ctx) : "";
  const updateStr = stmt.update.map((u) => emitExpression(u, ctx)).join(", ");
  const loopCtx = {
    ...ctx,
    indent: ctx.indent + 1,
    loopControls: [...(ctx.loopControls ?? []), { label: stmt.label, naturalCompletionFlag }],
  };

  ctx.sourceLines.push(`${ind}for (${initStr}; ${condStr}; ${updateStr}) {`);
  emitBlockStatements(stmt.body, loopCtx);
  ctx.sourceLines.push(`${ind}}`);

  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_break:;`);
  }
  if (naturalCompletionFlag && stmt.then_) {
    ctx.sourceLines.push(`${ind}if (${naturalCompletionFlag}) {`);
    emitBlockStatements(stmt.then_, { ...ctx, indent: ctx.indent + 1 });
    ctx.sourceLines.push(`${ind}}`);
  }
}

function emitForOfStatement(
  stmt: import("./ast.js").ForOfStatement,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const naturalCompletionFlag = stmt.then_ ? `_loop_completed_${ctx.tempCounter++}` : null;

  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_continue:;`);
  }

  if (naturalCompletionFlag) {
    ctx.sourceLines.push(`${ind}bool ${naturalCompletionFlag} = true;`);
  }

  const iterable = emitExpression(stmt.iterable, ctx);
  const iterableType = substituteEmitType(stmt.iterable.resolvedType, ctx);

  if (iterableType?.kind === "stream") {
    const streamVar = `_stream_${ctx.tempCounter++}`;
    const nextVar = `_stream_next_${ctx.tempCounter++}`;
    const nextType = {
      kind: "union",
      types: [iterableType.elementType, { kind: "null" }],
    } as import("./checker-types.js").ResolvedType;

    ctx.sourceLines.push(`${ind}auto ${streamVar} = ${iterable};`);
    ctx.sourceLines.push(`${ind}while (true) {`);

    const innerCtx = {
      ...ctx,
      indent: ctx.indent + 1,
      loopControls: [...(ctx.loopControls ?? []), { label: stmt.label, naturalCompletionFlag }],
    };
    const innerInd = indent(innerCtx);

    ctx.sourceLines.push(`${innerInd}auto ${nextVar} = std::visit([](auto&& _obj) { return _obj->next(); }, ${streamVar});`);

    if (isMonostateNullable(nextType)) {
      ctx.sourceLines.push(`${innerInd}if (std::holds_alternative<std::monostate>(${nextVar})) break;`);
    } else if (isOptionalNullable(nextType)) {
      ctx.sourceLines.push(`${innerInd}if (!${nextVar}.has_value()) break;`);
    } else if (isPointerType(nextType)) {
      ctx.sourceLines.push(`${innerInd}if (${nextVar} == nullptr) break;`);
    }

    if (stmt.bindings.length === 1) {
      const binding = emitIdentifierSafe(stmt.bindings[0]);
      if (isMonostateNullable(nextType)) {
        ctx.sourceLines.push(`${innerInd}const auto& ${binding} = std::get<${emitType(iterableType.elementType)}>(${nextVar});`);
      } else if (isOptionalNullable(nextType)) {
        ctx.sourceLines.push(`${innerInd}const auto& ${binding} = ${nextVar}.value();`);
      } else {
        ctx.sourceLines.push(`${innerInd}const auto& ${binding} = ${nextVar};`);
      }
    } else {
      const bindings = stmt.bindings.map(emitIdentifierSafe).join(", ");
      if (isMonostateNullable(nextType)) {
        ctx.sourceLines.push(`${innerInd}const auto& [${bindings}] = std::get<${emitType(iterableType.elementType)}>(${nextVar});`);
      } else if (isOptionalNullable(nextType)) {
        ctx.sourceLines.push(`${innerInd}const auto& [${bindings}] = ${nextVar}.value();`);
      } else {
        ctx.sourceLines.push(`${innerInd}const auto& [${bindings}] = ${nextVar};`);
      }
    }

    emitBlockStatements(stmt.body, innerCtx);
    ctx.sourceLines.push(`${ind}}`);
    if (stmt.label) {
      ctx.sourceLines.push(`${ind}${stmt.label}_break:;`);
    }
    if (naturalCompletionFlag && stmt.then_) {
      ctx.sourceLines.push(`${ind}if (${naturalCompletionFlag}) {`);
      emitBlockStatements(stmt.then_, { ...ctx, indent: ctx.indent + 1 });
      ctx.sourceLines.push(`${ind}}`);
    }
    return;
  }

  // Arrays and maps are shared_ptr<container>, need dereference to iterate
  const needsDeref = iterableType && (iterableType.kind === "array" || iterableType.kind === "map" || iterableType.kind === "set");
  const iterExpr = needsDeref ? `*${iterable}` : iterable;
  const loopCtx = {
    ...ctx,
    indent: ctx.indent + 1,
    loopControls: [...(ctx.loopControls ?? []), { label: stmt.label, naturalCompletionFlag }],
  };

  if (iterableType?.kind === "map" && stmt.bindings.length === 2) {
    // Map iteration: for (key, value) of map → for (const auto& [k, v] : *map)
    const bindings = stmt.bindings.map(emitIdentifierSafe).join(", ");
    ctx.sourceLines.push(`${ind}for (const auto& [${bindings}] : ${iterExpr}) {`);
  } else if (stmt.bindings.length === 1) {
    ctx.sourceLines.push(`${ind}for (const auto& ${emitIdentifierSafe(stmt.bindings[0])} : ${iterExpr}) {`);
  } else {
    // Destructuring for-of → auto& [a, b, ...] : iterable
    const bindings = stmt.bindings.map(emitIdentifierSafe).join(", ");
    ctx.sourceLines.push(`${ind}for (const auto& [${bindings}] : ${iterExpr}) {`);
  }

  emitBlockStatements(stmt.body, loopCtx);
  ctx.sourceLines.push(`${ind}}`);
  if (stmt.label) {
    ctx.sourceLines.push(`${ind}${stmt.label}_break:;`);
  }
  if (naturalCompletionFlag && stmt.then_) {
    ctx.sourceLines.push(`${ind}if (${naturalCompletionFlag}) {`);
    emitBlockStatements(stmt.then_, { ...ctx, indent: ctx.indent + 1 });
    ctx.sourceLines.push(`${ind}}`);
  }
}

function emitWithStatement(stmt: WithStatement, ctx: EmitContext): void {
  const ind = indent(ctx);
  ctx.sourceLines.push(`${ind}{`);
  const innerCtx = { ...ctx, indent: ctx.indent + 1 };
  const innerInd = indent(innerCtx);

  for (const binding of stmt.bindings) {
    const name = emitIdentifierSafe(binding.name);
    const declType = binding.resolvedType;
    const val = emitExpression(binding.value, innerCtx, declType);

    if (declType && declType.kind === "class") {
      const cppType = emitType(declType);
      innerCtx.sourceLines.push(`${innerInd}const ${cppType} ${name} = ${val};`);
    } else if (declType && isVariantUnionType(declType)) {
      const cppType = emitType(declType);
      innerCtx.sourceLines.push(`${innerInd}const ${cppType} ${name} = ${val};`);
    } else {
      innerCtx.sourceLines.push(`${innerInd}const auto ${name} = ${val};`);
    }
  }

  emitBlockStatements(stmt.body, innerCtx);
  ctx.sourceLines.push(`${ind}}`);
}

// ============================================================================
// Else-narrow statement
// ============================================================================

/**
 * Emit an else-narrow statement.
 *
 * ```doof
 * x := loadConfig() else {
 *     log(x)     // x has full type
 *     return
 * }
 * // x has narrowed type here
 * ```
 *
 * Emits C++ with a temp, condition check, else block, then narrowed extraction.
 */
function emitElseNarrowStatement(stmt: ElseNarrowStatement, ctx: EmitContext): void {
  const ind = indent(ctx);
  const innerInd = indent({ ...ctx, indent: ctx.indent + 1 });
  const subjectType = stmt.subject.resolvedType;
  const narrowedType = stmt.resolvedType;
  const tmp = `_else${ctx.tempCounter++}`;
  const safeName = emitIdentifierSafe(stmt.name);

  // Evaluate subject into temp
  const subjectExpr = emitExpression(stmt.subject, ctx);
  ctx.sourceLines.push(`${ind}auto ${tmp} = ${subjectExpr};`);

  // Emit condition and else block
  const condition = emitElseNarrowCondition(tmp, subjectType, ctx);
  ctx.sourceLines.push(`${ind}if (${condition}) {`);

  // Bind name with full type inside else block
  ctx.sourceLines.push(`${innerInd}auto& ${safeName} = ${tmp};`);
  emitBlockStatements(stmt.elseBlock, { ...ctx, indent: ctx.indent + 1 });

  ctx.sourceLines.push(`${ind}}`);

  // Emit narrowed binding after else block
  if (narrowedType && subjectType) {
    ctx.sourceLines.push(`${ind}${emitElseNarrowExtraction(safeName, tmp, subjectType)}`);
  } else {
    ctx.sourceLines.push(`${ind}auto& ${safeName} = ${tmp};`);
  }
}

/**
 * Build the C++ condition for the else-narrow check.
 * Returns the condition expression string (without the if/parens).
 */
function emitElseNarrowCondition(
  tmp: string,
  subjectType: import("./checker-types.js").ResolvedType | undefined,
  _ctx: EmitContext,
): string {
  if (!subjectType) return `false`;

  // Determine structure: is there null? is there Result?
  const hasNull = typeHasNull(subjectType);
  const resultType = findResultType(subjectType);

  if (resultType && hasNull) {
    // Result | null — check null OR failure
    if (isOptionalNullable(subjectType) || isPointerType(subjectType)) {
      // Not possible for Result|null (would be variant), but handle gracefully
      return `!${tmp}.has_value() || ${tmp}.value().isFailure()`;
    }
    // variant with monostate: Result | null → std::variant<std::monostate, Result<S,E>>
    return `std::holds_alternative<std::monostate>(${tmp}) || std::get<${emitType(resultType)}>(${tmp}).isFailure()`;
  }

  if (resultType) {
    // Pure Result (may have nullable success type — handled at extraction)
    return `${tmp}.isFailure()`;
  }

  // Nullable (no Result)
  if (isMonostateNullable(subjectType)) {
    return `std::holds_alternative<std::monostate>(${tmp})`;
  }
  if (isOptionalNullable(subjectType)) {
    return `!${tmp}.has_value()`;
  }
  if (isPointerType(subjectType)) {
    return `${tmp} == nullptr`;
  }

  return `false`;
}

/**
 * Emit the narrowed binding extraction after the else block.
 */
function emitElseNarrowExtraction(
  name: string,
  tmp: string,
  subjectType: import("./checker-types.js").ResolvedType,
): string {
  const hasNull = typeHasNull(subjectType);
  const resultType = findResultType(subjectType);

  if (resultType && hasNull) {
    // Result | null → extract from variant then unwrap Result value
    if (resultType.successType.kind === "class") {
      // Success type is a class (shared_ptr) — move it out
      return `auto ${name} = std::move(std::get<${emitType(resultType)}>(${tmp}).value());`;
    }
    return `auto ${name} = std::get<${emitType(resultType)}>(${tmp}).value();`;
  }

  if (resultType) {
    // Pure Result — unwrap value
    if (resultType.successType.kind === "class") {
      return `auto ${name} = std::move(${tmp}.value());`;
    }
    return `auto ${name} = ${tmp}.value();`;
  }

  // Nullable — unwrap
  if (isOptionalNullable(subjectType)) {
    return `auto& ${name} = ${tmp}.value();`;
  }
  if (isPointerType(subjectType)) {
    return `auto& ${name} = ${tmp};`;
  }

  return `auto& ${name} = ${tmp};`;
}

/** Check if a type contains null (directly or in a union). */
function typeHasNull(type: import("./checker-types.js").ResolvedType): boolean {
  if (type.kind === "null") return true;
  if (type.kind === "union") return type.types.some((t) => t.kind === "null");
  return false;
}

/** Find a Result type within a type (directly or as a union member). */
function findResultType(type: import("./checker-types.js").ResolvedType): import("./checker-types.js").ResultResolvedType | null {
  if (type.kind === "result") return type;
  if (type.kind === "union") {
    const r = type.types.find((t) => t.kind === "result");
    if (r && r.kind === "result") return r;
  }
  return null;
}

// ============================================================================
// Blocks
// ============================================================================

function emitBlock(block: Block, ctx: EmitContext): void {
  const ind = indent(ctx);
  ctx.sourceLines.push(`${ind}{`);
  emitBlockStatements(block, { ...ctx, indent: ctx.indent + 1 });
  ctx.sourceLines.push(`${ind}}`);
}

/** Emit statements inside a block (without the braces). */
export function emitBlockStatements(block: Block, ctx: EmitContext): void {
  for (const stmt of block.statements) {
    emitStatement(stmt, ctx);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if an expression is a compile-time constant (for constexpr). */
function isConstexprValue(expr: Expression): boolean {
  switch (expr.kind) {
    case "int-literal":
    case "long-literal":
    case "float-literal":
    case "double-literal":
    case "bool-literal":
    case "char-literal":
      return true;
    case "string-literal":
      return expr.parts.length === 0 || (expr.parts.length === 1 && typeof expr.parts[0] === "string");
    case "unary-expression":
      return (expr.operator === "-" || expr.operator === "+") && isConstexprValue(expr.operand);
    default:
      return false;
  }
}
