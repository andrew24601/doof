/**
 * C++ operator expression emission — binary, unary, assignment, member access,
 * and index expressions.
 */

import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  AssignmentExpression,
  MemberExpression,
  QualifiedMemberExpression,
  IndexExpression,
} from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitClassCppName, emitEnumHelperName, emitEnumVariantAccess, emitNullForType, emitType, isPointerType, isMonostateNullable, isOptionalNullable } from "./emitter-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression } from "./emitter-expr.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitPanicAt, emitPanicLocationArgs } from "./emitter-panic.js";
import { emitQualifiedSymbolName, emitSymbolReferenceName } from "./emitter-names.js";

function getNamedClassStaticAccess(expr: MemberExpression, ctx: EmitContext): string | null {
  if (expr.object.kind !== "identifier") return null;

  const binding = expr.object.resolvedBinding;
  const objectType = expr.object.resolvedType;
  if (!objectType || objectType.kind !== "class") return null;
  if (binding?.kind !== "class" && binding?.kind !== "import") return null;

  const className = emitClassCppName(objectType.symbol, ctx.module.path);
  if (expr.property === "metadata") {
    return `${className}::_metadata`;
  }
  if (expr.property === "fromJsonValue") {
    return `${className}::fromJsonValue`;
  }
  const field = objectType.symbol.declaration.fields.find(
    (f) => f.names.includes(expr.property) && f.static_,
  );
  if (field) {
    return `${className}::${emitIdentifierSafe(expr.property)}`;
  }

  const method = objectType.symbol.declaration.methods.find(
    (m) => m.name === expr.property && m.static_,
  );
  if (!method) return null;

  return `${className}::${emitIdentifierSafe(expr.property)}`;
}

function getNamedInterfaceStaticAccess(expr: MemberExpression): string | null {
  if (expr.object.kind !== "identifier") return null;

  const binding = expr.object.resolvedBinding;
  const objectType = expr.object.resolvedType;
  if (!objectType || objectType.kind !== "interface") return null;
  if (binding?.kind !== "interface") return null;
  if (expr.property !== "fromJsonValue") return null;
  return emitQualifiedSymbolName(objectType.symbol, `${objectType.symbol.name}_fromJsonValue`);
}

function getNamedTypeAliasStaticAccess(expr: MemberExpression): string | null {
  if (expr.object.kind !== "identifier") return null;

  const binding = expr.object.resolvedBinding;
  if (expr.property !== "fromJsonValue") return null;
  if (binding?.symbol?.symbolKind !== "type-alias") return null;
  return emitQualifiedSymbolName(binding.symbol, `${binding.symbol.name}_fromJsonValue`);
}

function getQualifiedClassStaticAccess(expr: QualifiedMemberExpression, ctx: EmitContext): string | null {
  const objectType = expr.object.resolvedType;
  if (!objectType || objectType.kind !== "class") return null;
  const className = emitClassCppName(objectType.symbol, ctx.module.path);
  if (expr.property === "metadata") {
    return `${className}::_metadata`;
  }
  if (expr.property === "fromJsonValue") {
    return `${className}::fromJsonValue`;
  }
  const field = objectType.symbol.declaration.fields.find(
    (f) => f.names.includes(expr.property) && f.static_,
  );
  if (field) {
    return `${className}::${emitIdentifierSafe(expr.property)}`;
  }

  const method = objectType.symbol.declaration.methods.find(
    (m) => m.name === expr.property && m.static_,
  );
  if (method) {
    return `${className}::${emitIdentifierSafe(expr.property)}`;
  }

  return null;
}

function getQualifiedTypeAliasStaticAccess(expr: QualifiedMemberExpression): string | null {
  if (expr.object.kind !== "identifier") return null;

  const binding = expr.object.resolvedBinding;
  if (expr.property !== "fromJsonValue") return null;
  if (binding?.symbol?.symbolKind !== "type-alias") return null;
  return emitQualifiedSymbolName(binding.symbol, `${binding.symbol.name}_fromJsonValue`);
}

function isClassMetadataUnion(type: ResolvedType | undefined): type is Extract<ResolvedType, { kind: "union" }> {
  return !!type && type.kind === "union" && type.types.length > 0 && type.types.every((t) => t.kind === "class-metadata");
}

function getNullableArrayType(type: ResolvedType | undefined): Extract<ResolvedType, { kind: "array" }> | null {
  if (!type) return null;
  if (type.kind === "array") return type;
  if (type.kind !== "union") return null;

  const nonNull = type.types.filter((t): t is Exclude<ResolvedType, { kind: "null" }> => t.kind !== "null");
  if (nonNull.length !== 1) return null;
  return nonNull[0].kind === "array" ? nonNull[0] : null;
}

function getNullableMapType(type: ResolvedType | undefined): Extract<ResolvedType, { kind: "map" }> | null {
  if (!type) return null;
  if (type.kind === "map") return type;
  if (type.kind !== "union") return null;

  const nonNull = type.types.filter((t): t is Exclude<ResolvedType, { kind: "null" }> => t.kind !== "null");
  if (nonNull.length !== 1) return null;
  return nonNull[0].kind === "map" ? nonNull[0] : null;
}

// ============================================================================
// Binary expressions
// ============================================================================

/** Operators that map 1:1 from Doof to C++. */
const DIRECT_BINARY_OPS = new Set([
  "+", "-", "*", "/", "%",
  "==", "!=", "<", "<=", ">", ">=",
  "&&", "||",
  "&", "|", "^", "<<", ">>",
]);

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "<": 7,
  "<=": 7,
  ">": 7,
  ">=": 7,
  "<<": 8,
  ">>": 8,
  ">>>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "\\": 10,
  "%": 10,
};

const UNARY_PRECEDENCE = 11;

export function emitBinaryExpression(expr: BinaryExpression, ctx: EmitContext): string {
  // Special-case null comparisons on variant union types:
  // variant-backed nullables cannot use == nullptr / != nullptr.
  // Instead use std::holds_alternative<std::monostate>.
  if ((expr.operator === "==" || expr.operator === "!=") &&
      expr.right.kind === "null-literal") {
    const lhsType = expr.left.resolvedType;
    if (lhsType && isMonostateNullable(lhsType)) {
      const lhs = emitBinaryOperand(expr.left, ctx, 20, "left");
      const check = `std::holds_alternative<std::monostate>(${lhs})`;
      return expr.operator === "==" ? check : `!${check}`;
    }
    // optional<T> cannot use == nullptr; emit std::nullopt instead
    if (lhsType && isOptionalNullable(lhsType)) {
      const lhs = emitBinaryOperand(expr.left, ctx, 20, "left");
      return `${lhs} ${expr.operator} std::nullopt`;
    }
  }
  if ((expr.operator === "==" || expr.operator === "!=") &&
      expr.left.kind === "null-literal") {
    const rhsType = expr.right.resolvedType;
    if (rhsType && isMonostateNullable(rhsType)) {
      const rhs = emitBinaryOperand(expr.right, ctx, 20, "right");
      const check = `std::holds_alternative<std::monostate>(${rhs})`;
      return expr.operator === "==" ? check : `!${check}`;
    }
    // optional<T> cannot use == nullptr; emit std::nullopt instead
    if (rhsType && isOptionalNullable(rhsType)) {
      const rhs = emitBinaryOperand(expr.right, ctx, 20, "right");
      return `std::nullopt ${expr.operator} ${rhs}`;
    }
  }

  const precedence = getBinaryPrecedence(expr.operator);
  const left = emitBinaryOperand(expr.left, ctx, precedence, "left");
  const right = emitBinaryOperand(expr.right, ctx, precedence, "right");

  // String concatenation: wrap non-string operands in doof::to_string()
  if (expr.operator === "+") {
    const lhsType = expr.left.resolvedType;
    const rhsType = expr.right.resolvedType;
    const lhsIsString = lhsType?.kind === "primitive" && lhsType.name === "string";
    const rhsIsString = rhsType?.kind === "primitive" && rhsType.name === "string";
    if (lhsIsString && !rhsIsString) {
      return `${left} + doof::to_string(${right})`;
    }
    if (!lhsIsString && rhsIsString) {
      return `doof::to_string(${left}) + ${right}`;
    }
  }

  if (DIRECT_BINARY_OPS.has(expr.operator)) {
    return `${left} ${expr.operator} ${right}`;
  }

  switch (expr.operator) {
    case "\\":
      return `${left} / ${right}`;

    case "**":
      return `std::pow(${left}, ${right})`;

    case ">>>":
      return `static_cast<int32_t>(static_cast<uint32_t>(${left}) >> ${right})`;

    case "??": {
      // shared_ptr (pointer-type nullable) — no dereference needed; both sides are the same shared_ptr type.
      // optional<T> — must dereference to extract the T value.
      const lhsType = expr.left.resolvedType;
      const deref = lhsType && isPointerType(lhsType) ? "" : "*";
      return `(${left} ? ${deref}${left} : ${right})`;
    }

    case "..":
      return `doof::range(${left}, ${right})`;

    case "..<":
      return `doof::range_exclusive(${left}, ${right})`;

    default:
      throw new Error(`Unhandled binary operator in emitter: ${expr.operator}`);
  }
}

// ============================================================================
// Unary expressions
// ============================================================================

export function emitUnaryExpression(expr: UnaryExpression, ctx: EmitContext): string {
  const operand = emitUnaryOperand(expr.operand, ctx);

  switch (expr.operator) {
    case "-": return `-${operand}`;
    case "+": return `+${operand}`;
    case "!": return `!${operand}`;
    case "~": return `~${operand}`;
    case "try!": {
      const tmp = `_try_${ctx.tempCounter++}`;
      const operandType = expr.operand.resolvedType;
      if (operandType && operandType.kind === "result") {
        if (operandType.successType.kind === "void") {
          return `[&]() -> void { auto ${tmp} = ${operand}; if (${tmp}.isFailure()) ${emitPanicAt(`"try! failed: " + doof::to_string(${tmp}.error())`, expr.span, ctx)}; ${tmp}.value(); }()`;
        }
        const valType = emitType(operandType.successType, ctx.module.path);
        return `[&]() -> ${valType} { auto ${tmp} = ${operand}; if (${tmp}.isFailure()) ${emitPanicAt(`"try! failed: " + doof::to_string(${tmp}.error())`, expr.span, ctx)}; return std::move(${tmp}.value()); }()`;
      }
      return `[&]() { auto ${tmp} = ${operand}; if (${tmp}.isFailure()) ${emitPanicAt(`"try! failed"`, expr.span, ctx)}; return std::move(${tmp}.value()); }()`;
    }
    case "try?": {
      const tmp = `_try_${ctx.tempCounter++}`;
      const operandType = expr.operand.resolvedType;
      if (operandType && operandType.kind === "result") {
        if (operandType.successType.kind === "void") {
          throw new Error("try? on Result<void, E> should be rejected by the checker");
        }
        const valType = emitType(operandType.successType, ctx.module.path);
        return `[&]() -> std::optional<${valType}> { auto ${tmp} = ${operand}; if (${tmp}.isFailure()) return std::nullopt; return std::move(${tmp}.value()); }()`;
      }
      return `[&]() -> std::optional<decltype(${operand}.value())> { auto ${tmp} = ${operand}; if (${tmp}.isFailure()) return std::nullopt; return std::move(${tmp}.value()); }()`;
    }
    default:
      throw new Error(`Unhandled unary operator in emitter: ${expr.operator}`);
  }
}

// ============================================================================
// Assignment expressions
// ============================================================================

export function emitAssignmentExpression(expr: AssignmentExpression, ctx: EmitContext): string {
  let target: string;
  if (expr.target.kind === "index-expression") {
    const object = emitExpression(expr.target.object, ctx);
    const index = emitExpression(expr.target.index, ctx);
    const mapType = getNullableMapType(expr.target.object.resolvedType);
    if (mapType) {
      const locationArgs = emitPanicLocationArgs(expr.target.span, ctx);
      target = expr.operator === "="
        ? `doof::map_index(${object}, ${index}, ${locationArgs})`
        : `doof::map_at(${object}, ${index}, ${locationArgs})`;
    } else {
      target = emitExpression(expr.target, ctx);
    }
  } else if (expr.target.kind === "identifier" && ctx.capturedMutables?.has(expr.target.name)) {
    target = `(*${emitIdentifierSafe(expr.target.name)})`;
  } else {
    target = emitExpression(expr.target, ctx);
  }
  const targetType: ResolvedType | undefined = expr.operator === "=" ? expr.target.resolvedType : undefined;
  const value = emitExpression(expr.value, ctx, targetType);

  const directOps = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
  if (directOps.has(expr.operator)) {
    return `${target} ${expr.operator} ${value}`;
  }

  switch (expr.operator) {
    case "\\=":
      return `${target} /= ${value}`;
    case "**=":
      return `${target} = std::pow(${target}, ${value})`;
    case "??=":
      return `if (!${target}) ${target} = ${value}`;
    default:
      throw new Error(`Unhandled assignment operator in emitter: ${expr.operator}`);
  }
}

function getBinaryPrecedence(operator: string): number {
  return BINARY_PRECEDENCE[operator] ?? 0;
}

function getExpressionPrecedence(expr: Expression): number {
  switch (expr.kind) {
    case "binary-expression":
      if (DIRECT_BINARY_OPS.has(expr.operator) || expr.operator === ">>>" || expr.operator === "\\") {
        return getBinaryPrecedence(expr.operator);
      }
      // Function calls and special lowered forms bind tightly enough in emitted C++.
      return 20;
    case "unary-expression":
      return UNARY_PRECEDENCE;
    case "assignment-expression":
      return 0;
    default:
      return 20;
  }
}

function emitBinaryOperand(
  expr: Expression,
  ctx: EmitContext,
  parentPrecedence: number,
  side: "left" | "right",
): string {
  const text = emitExpression(expr, ctx);
  const childPrecedence = getExpressionPrecedence(expr);
  if (childPrecedence < parentPrecedence) {
    return `(${text})`;
  }
  if (side === "right" && childPrecedence === parentPrecedence && expr.kind === "binary-expression") {
    return `(${text})`;
  }
  return text;
}

function emitUnaryOperand(expr: Expression, ctx: EmitContext): string {
  const text = emitExpression(expr, ctx);
  const childPrecedence = getExpressionPrecedence(expr);
  if (expr.kind === "unary-expression" || childPrecedence < UNARY_PRECEDENCE) {
    return `(${text})`;
  }
  return text;
}

// ============================================================================
// Member access
// ============================================================================

export function emitMemberExpression(expr: MemberExpression, ctx: EmitContext): string {
  const prop = emitIdentifierSafe(expr.property);
  const objType = expr.object.resolvedType;

  if (expr.object.kind === "this-expression") {
    return `this->${prop}`;
  }

  if (expr.property === "calls" && objType && objType.kind === "function" && objType.mockCall) {
    if (expr.object.kind === "identifier") {
      return objType.mockCall.storageName;
    }
    if (expr.object.kind === "member-expression") {
      const memberObject = emitExpression(expr.object.object, ctx);
      const memberObjectType = expr.object.object.resolvedType;
      const accessor = memberObjectType && isPointerType(memberObjectType) ? "->" : ".";
      return `${memberObject}${accessor}${objType.mockCall.storageName}`;
    }
  }

  // Namespace import: emit the canonical defining-module symbol.
  if (objType && objType.kind === "namespace") {
    return expr.resolvedNamespaceMemberSymbol
      ? emitSymbolReferenceName(expr.resolvedNamespaceMemberSymbol)
      : prop;
  }

  // Enum instance properties
  if (objType && objType.kind === "enum") {
    if (prop === "value") {
      const object = emitExpression(expr.object, ctx);
      return `static_cast<int32_t>(${object})`;
    }
    if (prop === "name") {
      const object = emitExpression(expr.object, ctx);
      return `${emitEnumHelperName(objType, "_name")}(${object})`;
    }
    // Static variant access (fallback) → EnumName::Variant
    return emitEnumVariantAccess(objType, prop);
  }

  const staticClassAccess = getNamedClassStaticAccess(expr, ctx);
  if (staticClassAccess) {
    return staticClassAccess;
  }

  const staticInterfaceAccess = getNamedInterfaceStaticAccess(expr);
  if (staticInterfaceAccess) {
    return staticInterfaceAccess;
  }

  const staticTypeAliasAccess = getNamedTypeAliasStaticAccess(expr);
  if (staticTypeAliasAccess) {
    return staticTypeAliasAccess;
  }

  // ClassMetadata member access
  if (objType && objType.kind === "class-metadata") {
    const prop = expr.property;
    const object = emitExpression(expr.object, ctx);
    if (prop === "name") return `${object}.name`;
    if (prop === "description") return `${object}.description`;
    if (prop === "methods") return `${object}.methods`;
    if (prop === "defs") return `${object}.defs`;
  }

  if (isClassMetadataUnion(objType)) {
    const object = emitExpression(expr.object, ctx);
    if (expr.resolvedType && expr.resolvedType.kind === "union") {
      const resultType = emitType(expr.resolvedType, ctx.module.path);
      return `std::visit([](auto&& _meta) -> ${resultType} { return ${resultType}{_meta.${prop}}; }, ${object})`;
    }
    return `std::visit([](auto&& _meta) { return _meta.${prop}; }, ${object})`;
  }

  // MethodReflection member access
  if (objType && objType.kind === "method-reflection") {
    const prop = expr.property;
    const object = emitExpression(expr.object, ctx);
    if (prop === "name") return `${object}.name`;
    if (prop === "description") return `${object}.description`;
    if (prop === "inputSchema") return `${object}.inputSchema`;
    if (prop === "outputSchema") return `${object}.outputSchema`;
    if (prop === "invoke") return `${object}.invoke`;
  }

  // Result<T,E>: .value → .value(), .error → .error()
  // (.isSuccess/.isFailure are methods and handled as call expressions)
  if (objType && objType.kind === "result") {
    const object = emitExpression(expr.object, ctx);
    if (expr.property === "value" && objType.successType.kind === "void") {
      throw new Error("Result<void, E>.value should be rejected by the checker");
    }
    if (expr.property === "value") return `${object}.value()`;
    if (expr.property === "error") return `${object}.error()`;
  }

  // Success wrapper: .value → .value() method call
  if (objType && objType.kind === "success-wrapper" && expr.property === "value") {
    if (objType.valueType.kind === "void") {
      throw new Error("Success<void>.value should be rejected by the checker");
    }
    const object = emitExpression(expr.object, ctx);
    return `${object}.value()`;
  }

  // Failure wrapper: .error → .error() method call
  if (objType && objType.kind === "failure-wrapper" && expr.property === "error") {
    const object = emitExpression(expr.object, ctx);
    return `${object}.error()`;
  }

  // String .length → .length()
  if (objType && objType.kind === "primitive" && objType.name === "string" && expr.property === "length") {
    const object = emitExpression(expr.object, ctx);
    return `(int32_t)${object}.length()`;
  }

  // Array .length → .size()
  if (objType && objType.kind === "array" && expr.property === "length") {
    const object = emitExpression(expr.object, ctx);
    return `(int32_t)${object}->size()`;
  }

  // Map .size → .size()
  if (objType && objType.kind === "map" && expr.property === "size") {
    const object = emitExpression(expr.object, ctx);
    return `(int32_t)${object}->size()`;
  }

  // Set .size → .size()
  if (objType && objType.kind === "set" && expr.property === "size") {
    const object = emitExpression(expr.object, ctx);
    return `(int32_t)${object}->size()`;
  }

  const object = emitExpression(expr.object, ctx);

  // Interface-typed field access → std::visit
  if (objType && objType.kind === "interface") {
    return `std::visit([](auto&& _obj) { return _obj->${prop}; }, ${object})`;
  }

  if (objType && objType.kind === "stream") {
    return `std::visit([](auto&& _obj) { return _obj->${prop}; }, ${object})`;
  }

  const useArrow = objType ? isPointerType(objType) : false;
  const accessor = useArrow ? "->" : ".";

  if (expr.optional) {
    if (useArrow) {
      return `(${object} ? ${object}${accessor}${prop} : decltype(${object}${accessor}${prop}){})`;
    }
    return `${object}${accessor}${prop}`;
  }

  if (expr.force) {
    return `${object}${accessor}${prop}`;
  }

  return `${object}${accessor}${prop}`;
}

export function emitQualifiedMemberExpression(expr: QualifiedMemberExpression, ctx: EmitContext): string {
  const classStaticAccess = getQualifiedClassStaticAccess(expr, ctx);
  if (classStaticAccess) {
    return classStaticAccess;
  }

  const typeAliasStaticAccess = getQualifiedTypeAliasStaticAccess(expr);
  if (typeAliasStaticAccess) {
    return typeAliasStaticAccess;
  }

  const objType = expr.object.resolvedType;
  if (objType && objType.kind === "interface") {
    if (expr.property === "metadata" && expr.resolvedType) {
      const object = emitExpression(expr.object, ctx);
      const resultType = emitType(expr.resolvedType, ctx.module.path);
      return `std::visit([](auto&& _obj) -> ${resultType} { using _doof_cls = std::remove_reference_t<decltype(*_obj)>; return ${resultType}{_doof_cls::_metadata}; }, ${object})`;
    }
    throw new Error(`Qualified interface static member "${expr.property}" must be emitted in call position`);
  }

  throw new Error(`Unhandled qualified member access during emission: ${expr.property}`);
}

// ============================================================================
// Index access
// ============================================================================

export function emitIndexExpression(expr: IndexExpression, ctx: EmitContext): string {
  const object = emitExpression(expr.object, ctx);
  const index = emitExpression(expr.index, ctx);
  const locationArgs = emitPanicLocationArgs(expr.span, ctx);
  const objType = expr.object.resolvedType;
  const arrayType = getNullableArrayType(objType);
  const mapType = getNullableMapType(objType);

  if (expr.optional) {
    if (arrayType) {
      const resultType = expr.resolvedType ? emitType(expr.resolvedType, ctx.module.path) : `decltype(doof::array_at(${object}, ${index}, ${locationArgs}))`;
      const nullValue = expr.resolvedType ? emitNullForType(expr.resolvedType) : "{}";
      const arrayObject = objType && isOptionalNullable(objType) ? `*${object}` : object;
      return `[&]() -> ${resultType} { if (${object}) return doof::array_at(${arrayObject}, ${index}, ${locationArgs}); return ${nullValue}; }()`;
    }
    if (mapType) {
      const resultType = expr.resolvedType ? emitType(expr.resolvedType, ctx.module.path) : `decltype(doof::map_at(${object}, ${index}, ${locationArgs}))`;
      const nullValue = expr.resolvedType ? emitNullForType(expr.resolvedType) : "{}";
      const mapObject = objType && isOptionalNullable(objType) ? `*${object}` : object;
      return `[&]() -> ${resultType} { if (${object}) return doof::map_at(${mapObject}, ${index}, ${locationArgs}); return ${nullValue}; }()`;
    }
    return `(${object} ? (*${object})[${index}] : decltype((*${object})[${index}]){})`;
  }

  // Arrays are shared_ptr<vector> and route through a runtime helper so
  // out-of-bounds access becomes a Doof panic instead of C++ UB.
  if (arrayType) {
    return `doof::array_at(${object}, ${index}, ${locationArgs})`;
  }

  // Maps are shared_ptr<doof::ordered_map> and route through a runtime helper so
  // missing-key reads become a Doof panic instead of implicit insertion.
  if (mapType) {
    return `doof::map_at(${object}, ${index}, ${locationArgs})`;
  }

  return `${object}[${index}]`;
}
