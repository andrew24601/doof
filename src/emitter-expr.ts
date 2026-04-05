/**
 * C++ expression emission — converts Doof AST expression nodes to C++ code.
 *
 * This is the central dispatcher. The bulk of the implementation lives in
 * focused sub-modules:
 *
 *   emitter-expr-literals.ts  — literal formatting + identifier sanitisation
 *   emitter-expr-ops.ts       — binary, unary, assignment, member, index
 *   emitter-expr-calls.ts     — call and construct expressions
 *   emitter-expr-control.ts   — if, case, catch expressions
 *   emitter-expr-lambda.ts    — lambda emission + capture analysis
 *   emitter-expr-utils.ts     — shared resolveTypeAnnotation helper
 */

import type { Expression, Block, ArrayLiteral, MapLiteral, TupleLiteral } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitWrapAnyValue, emitAsNarrowExpression } from "./emitter-any.js";
import { emitWrapJsonValue } from "./emitter-json-value.js";
import { emitType } from "./emitter-types.js";
import { emitNullForType } from "./emitter-types.js";
import { isOptionalNullable } from "./emitter-types.js";
import type { EmitContext } from "./emitter-context.js";

// Re-export the public API consumed by other emitter modules.
export { emitIdentifierSafe } from "./emitter-expr-literals.js";
export { scanCapturedMutables } from "./emitter-expr-lambda.js";

import { formatFloat, formatDouble, escapeChar, emitStringLiteral, emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitBinaryExpression, emitUnaryExpression, emitAssignmentExpression, emitMemberExpression, emitQualifiedMemberExpression, emitIndexExpression } from "./emitter-expr-ops.js";
import { emitCallExpression, emitConstructExpression } from "./emitter-expr-calls.js";
import { emitIfExpression, emitCaseExpression, emitCatchExpressionIIFE } from "./emitter-expr-control.js";
import { emitLambdaExpression, emitAsyncExpression, emitActorCreationExpression } from "./emitter-expr-lambda.js";
import {
  buildConstructorFieldInfoList,
  buildFieldTypeList,
  buildFieldTypeMap,
  sortNamedArgsByFieldOrder,
} from "./emitter-expr-utils.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Emit a C++ expression string for a Doof Expression node.
 * The node must have been decorated by the type checker (resolvedType populated).
 *
 * @param targetType Optional target type for context-sensitive null emission.
 *   When a null literal needs to become std::monostate{} (variant) vs nullptr
 *   (shared_ptr), the call site passes the expected target type.
 */
export function emitExpression(expr: Expression, ctx: EmitContext, targetType?: ResolvedType): string {
  const raw = emitExpressionInner(expr, ctx, targetType);
  const sourceType = expr.resolvedType;
  if (targetType?.kind === "any" && sourceType && sourceType.kind !== "any") {
    return emitWrapAnyValue(raw, sourceType, ctx);
  }
  if (targetType?.kind === "json-value" && sourceType && sourceType.kind !== "json-value") {
    return emitWrapJsonValue(raw, sourceType);
  }
  return raw;
}

function emitExpressionInner(expr: Expression, ctx: EmitContext, targetType?: ResolvedType): string {
  switch (expr.kind) {
    case "int-literal":
      return String(expr.value);

    case "long-literal":
      return `${expr.value}LL`;

    case "float-literal":
      return formatFloat(expr.value);

    case "double-literal":
      return formatDouble(expr.value);

    case "string-literal":
      return emitStringLiteral(expr, ctx);

    case "char-literal":
      return `U'${escapeChar(expr.value)}'`;

    case "bool-literal":
      return expr.value ? "true" : "false";

    case "null-literal":
      // Emit the appropriate null representation for the target type.
      // variant<monostate, ...> needs monostate{}, optional needs nullopt,
      // shared_ptr/raw ptr needs nullptr.
      if (targetType) return emitNullForType(targetType);
      return "nullptr";

    case "identifier":
      if (ctx.capturedMutables?.has(expr.name)) {
        return `(*${emitIdentifierSafe(expr.name)})`;
      }
      if (expr.resolvedBinding?.kind === "import") {
        return emitIdentifierSafe(expr.resolvedBinding.name);
      }
      return emitIdentifierSafe(expr.name);

    case "binary-expression":
      return emitBinaryExpression(expr, ctx);

    case "unary-expression":
      return emitUnaryExpression(expr, ctx);

    case "assignment-expression":
      return emitAssignmentExpression(expr, ctx);

    case "member-expression":
      return emitMemberExpression(expr, ctx);

    case "qualified-member-expression":
      return emitQualifiedMemberExpression(expr, ctx);

    case "index-expression":
      return emitIndexExpression(expr, ctx);

    case "call-expression":
      return emitCallExpression(expr, ctx);

    case "array-literal":
      return emitArrayLiteral(expr, ctx, targetType);

    case "map-literal":
      return emitMapLiteral(expr, ctx, targetType);

    case "tuple-literal":
      return emitTupleLiteral(expr, ctx);

    case "lambda-expression":
      return emitLambdaExpression(expr, ctx);

    case "if-expression":
      return emitIfExpression(expr, ctx);

    case "case-expression":
      return emitCaseExpression(expr, ctx);

    case "catch-expression":
      return emitCatchExpressionIIFE(expr, ctx);

    case "construct-expression":
      return emitConstructExpression(expr, ctx);

    case "enum-access":
      if (expr.enumName) {
        return `${expr.enumName}::${expr.variant}`;
      }
      return expr.variant;

    case "dot-shorthand":
      if (expr.resolvedType?.kind === "enum") {
        return `${expr.resolvedType.symbol.name}::${expr.name}`;
      }
      throw new Error(`Cannot emit unresolved dot shorthand ".${expr.name}"`);

    case "this-expression":
      return "this";

    case "object-literal":
      return emitObjectLiteral(expr, ctx);

    case "async-expression":
      return emitAsyncExpression(expr, ctx);

    case "actor-creation-expression":
      return emitActorCreationExpression(expr, ctx);

    case "non-null-assertion": {
      const inner = emitExpression(expr.expression, ctx);
      const innerType = expr.expression.resolvedType;
      // For std::optional<T>, unwrap with .value()
      if (innerType && isOptionalNullable(innerType)) {
        return `${inner}.value()`;
      }
      return inner;
    }

    case "as-expression": {
      const sourceType = expr.expression.resolvedType!;
      const targetType = expr.resolvedType!;
      // resolvedType is Result<T, string>; extract the successType
      const narrowTarget = targetType.kind === "result" ? targetType.successType : targetType;
      const sourceExpr = emitExpression(expr.expression, ctx);
      return emitAsNarrowExpression(sourceExpr, sourceType, narrowTarget, ctx);
    }

    default:
      throw new Error(`Unhandled expression kind in emitter: ${(expr as Expression).kind}`);
  }
}

// ============================================================================
// Collection literals
// ============================================================================

function emitArrayLiteral(expr: ArrayLiteral, ctx: EmitContext, targetType?: ResolvedType): string {
  const collectionType = targetType?.kind === "array" || targetType?.kind === "set"
    ? targetType
    : expr.resolvedType?.kind === "array" || expr.resolvedType?.kind === "set"
      ? expr.resolvedType
      : undefined;
  const elementTargetType = collectionType?.elementType;
  const elements = expr.elements.map((e) => emitExpression(e, ctx, elementTargetType)).join(", ");
  if (collectionType?.kind === "array") {
    const elType = emitType(collectionType.elementType);
    return `std::make_shared<std::vector<${elType}>>(std::vector<${elType}>{${elements}})`;
  }
  if (collectionType?.kind === "set") {
    const elType = emitType(collectionType.elementType);
    if (expr.elements.length === 0) {
      return `std::make_shared<std::unordered_set<${elType}>>()`;
    }
    return `std::make_shared<std::unordered_set<${elType}>>(std::unordered_set<${elType}>{${elements}})`;
  }
  if (expr.elements.length === 0) {
    return `std::make_shared<std::vector<int32_t>>()`;
  }
  return `doof::share(std::vector{${elements}})`;
}

function emitMapLiteral(expr: MapLiteral, ctx: EmitContext, targetType?: ResolvedType): string {
  const mapType = targetType?.kind === "map"
    ? targetType
    : expr.resolvedType?.kind === "map"
      ? expr.resolvedType
      : undefined;
  const entries = expr.entries
    .map((e) => {
      const key = emitExpression(e.key, ctx, mapType?.keyType);
      const value = emitExpression(e.value, ctx, mapType?.valueType);
      return `{${key}, ${value}}`;
    })
    .join(", ");
  if (mapType?.kind === "map") {
    const k = emitType(mapType.keyType);
    const v = emitType(mapType.valueType);
    return `std::make_shared<std::unordered_map<${k}, ${v}>>(std::unordered_map<${k}, ${v}>{${entries}})`;
  }
  if (expr.entries.length === 0) {
    return `doof::share(std::unordered_map<int32_t, int32_t>{})`;
  }
  return `doof::share(std::unordered_map{${entries}})`;
}

function emitTupleLiteral(expr: TupleLiteral, ctx: EmitContext): string {
  if (expr.resolvedType?.kind === "class") {
    const sym = expr.resolvedType.symbol;
    const cppName = sym.extern_?.cppName ?? sym.name;
    const fieldTypes = buildFieldTypeList(sym);
    const elements = expr.elements.map((e, i) => {
      const fieldType = i < fieldTypes.length ? fieldTypes[i] : undefined;
      return emitExpression(e, ctx, fieldType);
    }).join(", ");
    return `std::make_shared<${cppName}>(${elements})`;
  }
  const elements = expr.elements.map((e) => emitExpression(e, ctx)).join(", ");
  return `std::make_tuple(${elements})`;
}

// ============================================================================
// Object literal (standalone)
// ============================================================================

function emitObjectLiteral(
  expr: import("./ast.js").ObjectLiteral,
  ctx: EmitContext,
): string {
  if (!expr.resolvedType || expr.resolvedType.kind === "unknown") {
    throw new Error("Object literal requires contextual type information or an explicit annotation");
  }
  // Empty object literal with Map expected type → empty map
  if (expr.resolvedType?.kind === "map" && expr.properties.length === 0) {
    const k = emitType(expr.resolvedType.keyType);
    const v = emitType(expr.resolvedType.valueType);
    return `std::make_shared<std::unordered_map<${k}, ${v}>>()`;
  }
  if (expr.resolvedType?.kind === "class") {
    const sym = expr.resolvedType.symbol;
    const cppName = sym.extern_?.cppName ?? sym.name;
    const propMap = new Map(expr.properties.map((prop) => [prop.name, prop]));
    const args = buildConstructorFieldInfoList(sym).map((field) => {
      const prop = propMap.get(field.name);
      if (prop) {
        return prop.value ? emitExpression(prop.value, ctx, field.type) : emitIdentifierSafe(prop.name);
      }
      if (field.defaultValue) {
        return emitExpression(field.defaultValue, ctx, field.type);
      }
      throw new Error(`Missing constructor field \"${field.name}\" during object literal emission`);
    }).join(", ");
    return `std::make_shared<${cppName}>(${args})`;
  }
  if (expr.resolvedType?.kind === "map") {
    const mapType = expr.resolvedType;
    const k = emitType(mapType.keyType);
    const v = emitType(mapType.valueType);
    const entries = expr.properties
      .map((p) => {
        const key = JSON.stringify(p.name);
        const value = p.value
          ? emitExpression(p.value, ctx, mapType.valueType)
          : emitIdentifierSafe(p.name);
        return `{${key}, ${value}}`;
      })
      .join(", ");
    return `std::make_shared<std::unordered_map<${k}, ${v}>>(std::unordered_map<${k}, ${v}>{${entries}})`;
  }
  const props = expr.properties
    .map((p) => {
      const val = p.value ? emitExpression(p.value, ctx) : emitIdentifierSafe(p.name);
      return `${emitIdentifierSafe(p.name)}: ${val}`;
    })
    .join(", ");
  return `{${props}}`;
}

// ============================================================================
// Utilities (re-exported for other emitter modules)
// ============================================================================

/** Produce indentation string for the current context level. */
export function indent(ctx: { indent: number }): string {
  return "    ".repeat(ctx.indent);
}

/** Emit block body lines. Delegates back to the statement emitter via ctx. */
export function emitBlockBody(block: Block, ctx: EmitContext): string {
  return ctx.emitBlock(block, ctx);
}
