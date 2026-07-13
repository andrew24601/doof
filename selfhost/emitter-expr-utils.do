// Shared expression-emission helpers.
//
// These helpers carry decorated-type and contextual-promotion logic so the
// expression dispatcher and its focused lowering modules stay small.

import { Expression, Identifier, ObjectProperty } from "./ast"
import { ClassType, NullType, PrimitiveType, ResolvedType, Symbol, UnionResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { emitExpression } from "./emitter-expr"

export function decoratedExpressionType(expression: Expression): ResolvedType | null {
  case expression {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null { return identifier.resolvedBinding!.type_ }
    }
    _ -> { }
  }
  if expression.resolvedType != null { return expression.resolvedType }
  return null
}

export function optionalExpectedType(value: ResolvedType): ResolvedType | null { return value }

export function emitExpectedExpression(expression: Expression, context: EmitContext, expected: ResolvedType | null): string {
  value := emitExpression(expression, context, expected)
  source := expression.resolvedType
  if needsNullableVariantPromotion(source, expected) {
    return "doof::optional_value(" + value + ")"
  }
  return value
}

export function needsNullableVariantPromotion(source: ResolvedType | null, expected: ResolvedType | null): bool {
  if expected == null || !isNullableVariantType(expected) || source == null { return false }
  case source! {
    _: NullType -> { return false }
    _ -> { }
  }
  return !hasNullMember(source)
}

export function isNullableVariantType(resolvedType: ResolvedType | null): bool {
  if resolvedType == null { return false }
  case resolvedType! {
    union_: UnionResolvedType -> {
      let hasNull = false
      let nonNullCount = 0
      for member of union_.types {
        if member.kind == "null" { hasNull = true }
        else { nonNullCount = nonNullCount + 1 }
      }
      if !hasNull { return false }
      if nonNullCount > 1 { return true }
      for member of union_.types {
        case member {
          class_: ClassType -> { return isAstVariantClass(class_.name) }
          _ -> { }
        }
      }
      return false
    }
    _ -> { return false }
  }
  return false
}

function isAstVariantClass(name: string): bool {
  return name == "Expression" || name == "Statement" || name == "TypeAnnotation"
}

export function hasNullMember(resolvedType: ResolvedType | null): bool {
  if resolvedType == null { return false }
  case resolvedType! {
    _: NullType -> { return true }
    union_: UnionResolvedType -> {
      for member of union_.types { if member.kind == "null" { return true } }
    }
    _ -> { }
  }
  return false
}

export function requireExpressionType(expression: Expression, description: string): ResolvedType {
  if expression.resolvedType == null {
    panic("Missing resolved type for " + description + " at line " + string(expression.span.start.line) + ":" + string(expression.span.start.column))
  }
  return expression.resolvedType!
}

export function hasSinglePrimitiveMember(union_: UnionResolvedType): bool {
  let count = 0
  for member of union_.types {
    if member.kind == "null" { continue }
    if member.kind != "primitive" { return false }
    count = count + 1
  }
  return count == 1
}

export function findProperty(properties: ObjectProperty[], name: string): ObjectProperty | null {
  for property of properties { if property.name == name { return property } }
  return null
}

export function exprModuleNamespaceFor(path: string): string {
  normalized := path.replaceAll("\\", "/")
  withoutRoot := if normalized.startsWith("/") then normalized.substring(1, 1000000) else normalized
  result := withoutRoot.replaceAll("/", "_").replaceAll(".do", "")
    .replaceAll("-", "_").replaceAll(".", "_")
  return "app_" + (if result == "" then "module" else result) + "_"
}

export function emittedSymbolName(symbol: Symbol): string {
  return if symbol.originalName == "" then symbol.name else symbol.originalName
}
