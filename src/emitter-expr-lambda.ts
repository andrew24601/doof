/**
 * C++ lambda expression emission and capture analysis.
 *
 * Handles lambda → C++ closure translation including:
 * - Parameter and return type emission
 * - Capture list analysis (by-value vs by-reference)
 * - Pre-scan for `let` variables that must be heap-boxed (capturedMutables)
 */

import type {
  LambdaExpression,
  AsyncExpression,
  ActorCreationExpression,
  CallExpression,
  MemberExpression,
  Expression,
  Block,
  Statement,
} from "./ast.js";
import { emitType } from "./emitter-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression, emitBlockBody, indent } from "./emitter-expr.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";

// ============================================================================
// Lambda expressions
// ============================================================================

export function emitLambdaExpression(expr: LambdaExpression, ctx: EmitContext): string {
  const params = expr.params.map((p) => {
    const pType = p.resolvedType ? emitType(p.resolvedType) : "auto";
    return `${pType} ${emitIdentifierSafe(p.name)}`;
  }).join(", ");

  const retType = expr.resolvedType && expr.resolvedType.kind === "function"
    ? emitType(expr.resolvedType.returnType)
    : "auto";

  const captures = analyzeLambdaCaptures(expr, ctx);
  const captureList = captures.length > 0 ? captures.join(", ") : "=";

  if (expr.body.kind === "block") {
    const bodyLines = emitBlockBody(expr.body as Block, ctx);
    return `[${captureList}](${params}) -> ${retType} {\n${bodyLines}\n${indent(ctx)}}`;
  }

  const body = emitExpression(expr.body as Expression, ctx);
  return `[${captureList}](${params}) -> ${retType} { return ${body}; }`;
}

// ============================================================================
// Async / actor-creation expressions
// ============================================================================

export function emitAsyncExpression(expr: AsyncExpression, ctx: EmitContext): string {
  if (expr.expression.kind === "block") {
    const body = ctx.emitBlock(expr.expression as Block, ctx);
    return `doof::async_call([=]() {\n${body}${indent(ctx)}})`;
  }

  const innerExpr = expr.expression as Expression;

  if (innerExpr.kind === "call-expression") {
    const callExpr = innerExpr as CallExpression;
    if (callExpr.callee.kind === "member-expression") {
      const memberExpr = callExpr.callee as MemberExpression;
      const objType = memberExpr.object.resolvedType;
      if (objType && objType.kind === "actor") {
        return emitActorAsyncCall(callExpr, memberExpr, objType, expr, ctx);
      }
    }
  }

  const innerCode = emitExpression(innerExpr, ctx);
  const retType = expr.resolvedType;
  if (retType?.kind === "promise" && retType.valueType.kind === "void") {
    return `doof::async_call([=]() { ${innerCode}; })`;
  }
  return `doof::async_call([=]() { return ${innerCode}; })`;
}

function emitActorAsyncCall(
  callExpr: CallExpression,
  memberExpr: MemberExpression,
  objType: Extract<NonNullable<MemberExpression["object"]["resolvedType"]>, { kind: "actor" }>,
  asyncExpr: AsyncExpression,
  ctx: EmitContext,
): string {
  const obj = emitExpression(memberExpr.object, ctx);
  const method = emitIdentifierSafe(memberExpr.property);
  const className = objType.innerClass.symbol.name;
  const args = callExpr.args.map((a) => emitExpression(a.value, ctx)).join(", ");

  const promiseType = asyncExpr.resolvedType;
  const valueType = promiseType?.kind === "promise" ? promiseType.valueType : null;
  const cppRetType = valueType ? emitType(valueType) : "void";

  if (cppRetType === "void") {
    if (args) {
      return `${obj}->template call_async<void>([&](${className}& _self) { _self.${method}(${args}); })`;
    }
    return `${obj}->template call_async<void>([](${className}& _self) { _self.${method}(); })`;
  }
  if (args) {
    return `${obj}->template call_async<${cppRetType}>([&](${className}& _self) -> ${cppRetType} { return _self.${method}(${args}); })`;
  }
  return `${obj}->template call_async<${cppRetType}>([](${className}& _self) -> ${cppRetType} { return _self.${method}(); })`;
}

export function emitActorCreationExpression(expr: ActorCreationExpression, ctx: EmitContext): string {
  const className = emitIdentifierSafe(expr.className);
  const args = expr.args.map((a) => emitExpression(a, ctx)).join(", ");
  return `std::make_shared<doof::Actor<${className}>>(${args})`;
}

// ============================================================================
// Lambda capture analysis
// ============================================================================

/**
 * Analyze which outer names a lambda references and determine capture mode.
 * - Mutable bindings (let): capture by reference [&x]
 * - Immutable bindings (const/readonly/:=/param): capture by value [x]
 * Returns an array of capture specifiers, or empty if we should fall back to [=].
 */
function analyzeLambdaCaptures(expr: LambdaExpression, ctx: EmitContext): string[] {
  const paramNames = new Set(expr.params.map((p) => p.name));
  const captures = new Map<string, string>(); // name → capture spec

  collectCaptures(expr.body, paramNames, captures, ctx);

  if (captures.size === 0) return [];
  return Array.from(captures.values());
}

/** Recursively collect captured identifiers from an expression or block. */
function collectCaptures(
  node: Expression | Block,
  paramNames: Set<string>,
  captures: Map<string, string>,
  ctx: EmitContext,
): void {
  if (!node) return;

  if (node.kind === "block") {
    for (const stmt of (node as Block).statements) {
      collectCapturesFromStatement(stmt, paramNames, captures, ctx);
    }
    return;
  }

  const expr = node as Expression;
  switch (expr.kind) {
    case "identifier":
      if (!paramNames.has(expr.name) && expr.resolvedBinding) {
        const binding = expr.resolvedBinding;
        if (["class", "function", "interface", "enum", "type-alias"].includes(binding.kind)) break;
        if (binding.kind === "field") {
          captures.set("this", "this");
          break;
        }
        const name = emitIdentifierSafe(expr.name);
        if (binding.mutable && ctx.capturedMutables?.has(expr.name)) {
          captures.set(expr.name, name);        // by value (shared_ptr)
        } else if (binding.mutable) {
          captures.set(expr.name, `&${name}`);   // by reference
        } else {
          captures.set(expr.name, name);          // by value (immutable)
        }
      }
      break;
    case "this-expression":
      captures.set("this", "this");
      break;
    case "binary-expression":
      collectCaptures(expr.left, paramNames, captures, ctx);
      collectCaptures(expr.right, paramNames, captures, ctx);
      break;
    case "unary-expression":
      collectCaptures(expr.operand, paramNames, captures, ctx);
      break;
    case "member-expression":
      collectCaptures(expr.object, paramNames, captures, ctx);
      break;
    case "index-expression":
      collectCaptures(expr.object, paramNames, captures, ctx);
      collectCaptures(expr.index, paramNames, captures, ctx);
      break;
    case "call-expression":
      collectCaptures(expr.callee, paramNames, captures, ctx);
      for (const arg of expr.args) {
        collectCaptures(arg.value, paramNames, captures, ctx);
      }
      break;
    case "assignment-expression":
      collectCaptures(expr.target, paramNames, captures, ctx);
      collectCaptures(expr.value, paramNames, captures, ctx);
      break;
    case "lambda-expression":
      // Nested lambda — don't descend, it handles its own captures
      break;
    case "if-expression":
      collectCaptures(expr.condition, paramNames, captures, ctx);
      collectCaptures(expr.then, paramNames, captures, ctx);
      collectCaptures(expr.else_, paramNames, captures, ctx);
      break;
    case "array-literal":
      for (const el of expr.elements) collectCaptures(el, paramNames, captures, ctx);
      break;
    case "tuple-literal":
      for (const el of expr.elements) collectCaptures(el, paramNames, captures, ctx);
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") collectCaptures(part, paramNames, captures, ctx);
      }
      break;
    case "case-expression":
      collectCaptures(expr.subject, paramNames, captures, ctx);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const s of (arm.body as Block).statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
        } else {
          collectCaptures(arm.body as Expression, paramNames, captures, ctx);
        }
      }
      break;
    case "construct-expression":
      if (!expr.named) {
        for (const a of (expr.args as Expression[])) collectCaptures(a, paramNames, captures, ctx);
      } else {
        for (const p of (expr.args as import("./ast.js").ObjectProperty[])) {
          if (p.value) collectCaptures(p.value, paramNames, captures, ctx);
        }
      }
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectCaptures(entry.key, paramNames, captures, ctx);
        collectCaptures(entry.value, paramNames, captures, ctx);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const s of (expr.expression as Block).statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      } else {
        collectCaptures(expr.expression as Expression, paramNames, captures, ctx);
      }
      break;
    case "actor-creation-expression":
      for (const a of expr.args) collectCaptures(a, paramNames, captures, ctx);
      break;
    case "catch-expression":
      for (const s of expr.body) collectCapturesFromStatement(s, paramNames, captures, ctx);
      break;
    case "non-null-assertion":
      collectCaptures(expr.expression, paramNames, captures, ctx);
      break;
    default:
      break;
  }
}

function collectCapturesFromStatement(
  stmt: Statement,
  paramNames: Set<string>,
  captures: Map<string, string>,
  ctx: EmitContext,
): void {
  switch (stmt.kind) {
    case "expression-statement":
      collectCaptures(stmt.expression, paramNames, captures, ctx);
      break;
    case "return-statement":
      if (stmt.value) collectCaptures(stmt.value, paramNames, captures, ctx);
      break;
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      collectCaptures(stmt.value, paramNames, captures, ctx);
      break;
    case "if-statement":
      collectCaptures(stmt.condition, paramNames, captures, ctx);
      for (const s of stmt.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      for (const ei of stmt.elseIfs) {
        collectCaptures(ei.condition, paramNames, captures, ctx);
        for (const s of ei.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      }
      if (stmt.else_) {
        for (const s of stmt.else_.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      }
      break;
    case "case-statement":
      collectCaptures(stmt.subject, paramNames, captures, ctx);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const s of arm.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
        } else {
          collectCaptures(arm.body, paramNames, captures, ctx);
        }
      }
      break;
    case "while-statement":
      collectCaptures(stmt.condition, paramNames, captures, ctx);
      for (const s of stmt.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      }
      break;
    case "for-statement":
      if (stmt.init) collectCapturesFromStatement(stmt.init, paramNames, captures, ctx);
      if (stmt.condition) collectCaptures(stmt.condition, paramNames, captures, ctx);
      for (const update of stmt.update) collectCaptures(update, paramNames, captures, ctx);
      for (const s of stmt.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      }
      break;
    case "for-of-statement":
      collectCaptures(stmt.iterable, paramNames, captures, ctx);
      for (const s of stmt.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      }
      break;
    case "with-statement":
      for (const b of stmt.bindings) collectCaptures(b.value, paramNames, captures, ctx);
      for (const s of stmt.body.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      break;
    case "block":
      for (const s of stmt.statements) collectCapturesFromStatement(s, paramNames, captures, ctx);
      break;
    default:
      break;
  }
}

// ============================================================================
// Pre-scan for captured mutables
// ============================================================================

/**
 * Scan a function body to find all `let` variables captured by any lambda
 * at any nesting depth.  Returns the set of variable names that need to be
 * heap-boxed via `std::shared_ptr<T>`.
 */
export function scanCapturedMutables(
  body: Block,
  paramNames: Set<string>,
): Set<string> {
  const result = new Set<string>();
  scanStatementsForLambdaCaptures(body.statements, paramNames, result);
  return result;
}

function scanStatementsForLambdaCaptures(
  stmts: readonly Statement[],
  outerNames: Set<string>,
  result: Set<string>,
): void {
  for (const stmt of stmts) {
    scanStatementForLambdaCaptures(stmt, outerNames, result);
  }
}

function scanStatementForLambdaCaptures(
  stmt: Statement,
  outerNames: Set<string>,
  result: Set<string>,
): void {
  switch (stmt.kind) {
    case "expression-statement":
      scanExprForLambdaCaptures(stmt.expression, outerNames, result);
      break;
    case "return-statement":
      if (stmt.value) scanExprForLambdaCaptures(stmt.value, outerNames, result);
      break;
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      scanExprForLambdaCaptures(stmt.value, outerNames, result);
      break;
    case "if-statement":
      scanExprForLambdaCaptures(stmt.condition, outerNames, result);
      scanStatementsForLambdaCaptures(stmt.body.statements, outerNames, result);
      for (const ei of stmt.elseIfs) {
        scanExprForLambdaCaptures(ei.condition, outerNames, result);
        scanStatementsForLambdaCaptures(ei.body.statements, outerNames, result);
      }
      if (stmt.else_) {
        scanStatementsForLambdaCaptures(stmt.else_.statements, outerNames, result);
      }
      break;
    case "case-statement":
      scanExprForLambdaCaptures(stmt.subject, outerNames, result);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          scanStatementsForLambdaCaptures(arm.body.statements, outerNames, result);
        } else {
          scanExprForLambdaCaptures(arm.body, outerNames, result);
        }
      }
      break;
    case "while-statement":
      scanExprForLambdaCaptures(stmt.condition, outerNames, result);
      scanStatementsForLambdaCaptures(stmt.body.statements, outerNames, result);
      if (stmt.then_) {
        scanStatementsForLambdaCaptures(stmt.then_.statements, outerNames, result);
      }
      break;
    case "for-statement":
      if (stmt.init) scanStatementForLambdaCaptures(stmt.init, outerNames, result);
      if (stmt.condition) scanExprForLambdaCaptures(stmt.condition, outerNames, result);
      for (const update of stmt.update) {
        scanExprForLambdaCaptures(update, outerNames, result);
      }
      scanStatementsForLambdaCaptures(stmt.body.statements, outerNames, result);
      if (stmt.then_) {
        scanStatementsForLambdaCaptures(stmt.then_.statements, outerNames, result);
      }
      break;
    case "for-of-statement":
      scanExprForLambdaCaptures(stmt.iterable, outerNames, result);
      scanStatementsForLambdaCaptures(stmt.body.statements, outerNames, result);
      if (stmt.then_) {
        scanStatementsForLambdaCaptures(stmt.then_.statements, outerNames, result);
      }
      break;
    case "with-statement":
      for (const b of stmt.bindings) scanExprForLambdaCaptures(b.value, outerNames, result);
      scanStatementsForLambdaCaptures(stmt.body.statements, outerNames, result);
      break;
    case "block":
      scanStatementsForLambdaCaptures(stmt.statements, outerNames, result);
      break;
    default:
      break;
  }
}

function scanExprForLambdaCaptures(
  expr: Expression,
  outerNames: Set<string>,
  result: Set<string>,
): void {
  if (!expr) return;

  switch (expr.kind) {
    case "lambda-expression": {
      const lambdaParams = new Set(expr.params.map((p) => p.name));
      collectMutableCaptureNames(expr.body, lambdaParams, outerNames, result);
      if (expr.body.kind === "block") {
        scanStatementsForLambdaCaptures((expr.body as Block).statements, outerNames, result);
      } else {
        scanExprForLambdaCaptures(expr.body as Expression, outerNames, result);
      }
      break;
    }
    case "binary-expression":
      scanExprForLambdaCaptures(expr.left, outerNames, result);
      scanExprForLambdaCaptures(expr.right, outerNames, result);
      break;
    case "unary-expression":
      scanExprForLambdaCaptures(expr.operand, outerNames, result);
      break;
    case "member-expression":
      scanExprForLambdaCaptures(expr.object, outerNames, result);
      break;
    case "index-expression":
      scanExprForLambdaCaptures(expr.object, outerNames, result);
      scanExprForLambdaCaptures(expr.index, outerNames, result);
      break;
    case "call-expression":
      scanExprForLambdaCaptures(expr.callee, outerNames, result);
      for (const arg of expr.args) {
        scanExprForLambdaCaptures(arg.value, outerNames, result);
      }
      break;
    case "assignment-expression":
      scanExprForLambdaCaptures(expr.target, outerNames, result);
      scanExprForLambdaCaptures(expr.value, outerNames, result);
      break;
    case "if-expression":
      scanExprForLambdaCaptures(expr.condition, outerNames, result);
      scanExprForLambdaCaptures(expr.then, outerNames, result);
      scanExprForLambdaCaptures(expr.else_, outerNames, result);
      break;
    case "array-literal":
      for (const el of expr.elements) scanExprForLambdaCaptures(el, outerNames, result);
      break;
    case "tuple-literal":
      for (const el of expr.elements) scanExprForLambdaCaptures(el, outerNames, result);
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") scanExprForLambdaCaptures(part, outerNames, result);
      }
      break;
    case "case-expression":
      scanExprForLambdaCaptures(expr.subject, outerNames, result);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          scanStatementsForLambdaCaptures((arm.body as Block).statements, outerNames, result);
        } else {
          scanExprForLambdaCaptures(arm.body as Expression, outerNames, result);
        }
      }
      break;
    case "construct-expression":
      if (!expr.named) {
        for (const a of (expr.args as Expression[])) scanExprForLambdaCaptures(a, outerNames, result);
      } else {
        for (const p of (expr.args as import("./ast.js").ObjectProperty[])) {
          if (p.value) scanExprForLambdaCaptures(p.value, outerNames, result);
        }
      }
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        scanExprForLambdaCaptures(entry.key, outerNames, result);
        scanExprForLambdaCaptures(entry.value, outerNames, result);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        scanStatementsForLambdaCaptures((expr.expression as Block).statements, outerNames, result);
      } else {
        scanExprForLambdaCaptures(expr.expression as Expression, outerNames, result);
      }
      break;
    case "actor-creation-expression":
      for (const a of expr.args) scanExprForLambdaCaptures(a, outerNames, result);
      break;
    case "catch-expression":
      for (const s of expr.body) scanStatementForLambdaCaptures(s, outerNames, result);
      break;
    case "non-null-assertion":
      scanExprForLambdaCaptures(expr.expression, outerNames, result);
      break;
    default:
      break;
  }
}

/**
 * Walk a lambda body to find identifiers that reference mutable outer bindings.
 */
function collectMutableCaptureNames(
  node: Expression | Block,
  lambdaParams: Set<string>,
  outerNames: Set<string>,
  result: Set<string>,
): void {
  if (!node) return;

  if (node.kind === "block") {
    for (const stmt of (node as Block).statements) {
      collectMutableCaptureNamesFromStmt(stmt, lambdaParams, outerNames, result);
    }
    return;
  }

  const expr = node as Expression;
  switch (expr.kind) {
    case "identifier":
      if (
        !lambdaParams.has(expr.name) &&
        expr.resolvedBinding &&
        expr.resolvedBinding.mutable &&
        !["class", "function", "interface", "enum", "type-alias", "field"].includes(expr.resolvedBinding.kind)
      ) {
        result.add(expr.name);
      }
      break;
    case "binary-expression":
      collectMutableCaptureNames(expr.left, lambdaParams, outerNames, result);
      collectMutableCaptureNames(expr.right, lambdaParams, outerNames, result);
      break;
    case "unary-expression":
      collectMutableCaptureNames(expr.operand, lambdaParams, outerNames, result);
      break;
    case "member-expression":
      collectMutableCaptureNames(expr.object, lambdaParams, outerNames, result);
      break;
    case "index-expression":
      collectMutableCaptureNames(expr.object, lambdaParams, outerNames, result);
      collectMutableCaptureNames(expr.index, lambdaParams, outerNames, result);
      break;
    case "call-expression":
      collectMutableCaptureNames(expr.callee, lambdaParams, outerNames, result);
      for (const arg of expr.args) {
        collectMutableCaptureNames(arg.value, lambdaParams, outerNames, result);
      }
      break;
    case "assignment-expression":
      collectMutableCaptureNames(expr.target, lambdaParams, outerNames, result);
      collectMutableCaptureNames(expr.value, lambdaParams, outerNames, result);
      break;
    case "lambda-expression":
      // Don't descend into nested lambdas — they handle their own captures
      break;
    case "if-expression":
      collectMutableCaptureNames(expr.condition, lambdaParams, outerNames, result);
      collectMutableCaptureNames(expr.then, lambdaParams, outerNames, result);
      collectMutableCaptureNames(expr.else_, lambdaParams, outerNames, result);
      break;
    case "array-literal":
      for (const el of expr.elements) collectMutableCaptureNames(el, lambdaParams, outerNames, result);
      break;
    case "tuple-literal":
      for (const el of expr.elements) collectMutableCaptureNames(el, lambdaParams, outerNames, result);
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") collectMutableCaptureNames(part, lambdaParams, outerNames, result);
      }
      break;
    case "case-expression":
      collectMutableCaptureNames(expr.subject, lambdaParams, outerNames, result);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const s of (arm.body as Block).statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
        } else {
          collectMutableCaptureNames(arm.body as Expression, lambdaParams, outerNames, result);
        }
      }
      break;
    case "construct-expression":
      if (!expr.named) {
        for (const a of (expr.args as Expression[])) collectMutableCaptureNames(a, lambdaParams, outerNames, result);
      } else {
        for (const p of (expr.args as import("./ast.js").ObjectProperty[])) {
          if (p.value) collectMutableCaptureNames(p.value, lambdaParams, outerNames, result);
        }
      }
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectMutableCaptureNames(entry.key, lambdaParams, outerNames, result);
        collectMutableCaptureNames(entry.value, lambdaParams, outerNames, result);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const s of (expr.expression as Block).statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      } else {
        collectMutableCaptureNames(expr.expression as Expression, lambdaParams, outerNames, result);
      }
      break;
    case "catch-expression":
      for (const s of expr.body) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      break;
    case "non-null-assertion":
      collectMutableCaptureNames(expr.expression, lambdaParams, outerNames, result);
      break;
    default:
      break;
  }
}

function collectMutableCaptureNamesFromStmt(
  stmt: Statement,
  lambdaParams: Set<string>,
  outerNames: Set<string>,
  result: Set<string>,
): void {
  switch (stmt.kind) {
    case "expression-statement":
      collectMutableCaptureNames(stmt.expression, lambdaParams, outerNames, result);
      break;
    case "return-statement":
      if (stmt.value) collectMutableCaptureNames(stmt.value, lambdaParams, outerNames, result);
      break;
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      collectMutableCaptureNames(stmt.value, lambdaParams, outerNames, result);
      break;
    case "if-statement":
      collectMutableCaptureNames(stmt.condition, lambdaParams, outerNames, result);
      for (const s of stmt.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      for (const ei of stmt.elseIfs) {
        collectMutableCaptureNames(ei.condition, lambdaParams, outerNames, result);
        for (const s of ei.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      }
      if (stmt.else_) {
        for (const s of stmt.else_.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      }
      break;
    case "case-statement":
      collectMutableCaptureNames(stmt.subject, lambdaParams, outerNames, result);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const s of arm.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
        } else {
          collectMutableCaptureNames(arm.body, lambdaParams, outerNames, result);
        }
      }
      break;
    case "while-statement":
      collectMutableCaptureNames(stmt.condition, lambdaParams, outerNames, result);
      for (const s of stmt.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      }
      break;
    case "for-statement":
      if (stmt.init) collectMutableCaptureNamesFromStmt(stmt.init, lambdaParams, outerNames, result);
      if (stmt.condition) collectMutableCaptureNames(stmt.condition, lambdaParams, outerNames, result);
      for (const update of stmt.update) {
        collectMutableCaptureNames(update, lambdaParams, outerNames, result);
      }
      for (const s of stmt.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      }
      break;
    case "for-of-statement":
      collectMutableCaptureNames(stmt.iterable, lambdaParams, outerNames, result);
      for (const s of stmt.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      if (stmt.then_) {
        for (const s of stmt.then_.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      }
      break;
    case "with-statement":
      for (const b of stmt.bindings) collectMutableCaptureNames(b.value, lambdaParams, outerNames, result);
      for (const s of stmt.body.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      break;
    case "block":
      for (const s of stmt.statements) collectMutableCaptureNamesFromStmt(s, lambdaParams, outerNames, result);
      break;
    default:
      break;
  }
}
