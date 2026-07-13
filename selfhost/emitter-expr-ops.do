// Assignment, identifier, operator, member, and index lowering.

import { AssignmentExpression, BinaryExpression, Expression, Identifier, IndexExpression, MemberExpression, ThisExpression, UnaryExpression } from "./ast"
import { ArrayResolvedType, ClassType, EnumType, InterfaceType, MapResolvedType, PrimitiveType, ResolvedType, ResultResolvedType, StreamResolvedType, UnionResolvedType, VoidType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { emitExpression } from "./emitter-expr"
import { decoratedExpressionType, emittedSymbolName, exprModuleNamespaceFor, hasNullMember, hasSinglePrimitiveMember, isNullableVariantType, requireExpressionType } from "./emitter-expr-utils"
import { emitType } from "./emitter-types"

export function emitAssignment(expression: AssignmentExpression, context: EmitContext): string {
  operator := if expression.operator == "\\=" then "/=" else expression.operator
  targetType := expression.target.resolvedType
  let value = emitExpression(expression.value, context, targetType)
  valueType := expression.value.resolvedType
  if (isNullableVariantType(targetType) && expression.value.kind != "null-literal" && !hasNullMember(valueType)) {
    value = "doof::optional_value(" + value + ")"
  }
  return "(" + emitAssignmentTarget(expression.target, context) + " " + operator + " " + value + ")"
}

function emitAssignmentTarget(target: Expression, context: EmitContext): string {
  case target {
    member: MemberExpression -> {
      objectType := decoratedExpressionType(member.object)
      if objectType != null && isVariantCarrier(objectType!) {
        object := emitExpression(member.object, context)
        return "std::visit([](auto&& _obj) -> decltype(auto) { return (_obj->" + cppIdentifier(member.property) + "); }, " + object + ")"
      }
    }
    _ -> { }
  }
  return emitExpression(target, context)
}

function isVariantCarrier(resolvedType: ResolvedType): bool {
  case resolvedType {
    _: InterfaceType -> { return true }
    union_: UnionResolvedType -> {
      let nonNull = 0
      for member of union_.types { if member.kind != "null" { nonNull = nonNull + 1 } }
      return nonNull > 1
    }
    _ -> { }
  }
  return false
}

export function emitIdentifier(expression: Identifier, context: EmitContext): string {
  if expression.resolvedBinding != null && expression.resolvedBinding!.kind == "field" && !context.currentFunctionStatic {
    return "this->" + cppIdentifier(expression.name)
  }
  for imported of context.imports {
    if imported.localName == expression.name && imported.symbol != null {
      if imported.symbol!.native_ {
        return "::" + (if imported.symbol!.nativeCppName == "" then imported.symbol!.name else imported.symbol!.nativeCppName)
      }
      return "::" + exprModuleNamespaceFor(imported.symbol!.module) + "::" + cppIdentifier(emittedSymbolName(imported.symbol!))
    }
  }
  if expression.resolvedBinding != null && expression.resolvedBinding!.symbol != null {
    symbol := expression.resolvedBinding!.symbol!
    if symbol.native_ {
      return "::" + (if symbol.nativeCppName == "" then symbol.name else symbol.nativeCppName)
    }
    if context.modulePath != "" && symbol.module != "" && symbol.module != context.modulePath {
      return "::" + exprModuleNamespaceFor(symbol.module) + "::" + cppIdentifier(emittedSymbolName(symbol))
    }
  }
  if expression.resolvedBinding != null && expression.resolvedBinding!.kind == "import" {
    for imported of context.imports {
      if imported.localName == expression.name && imported.symbol != null {
        return "::" + exprModuleNamespaceFor(imported.symbol!.module) + "::" + cppIdentifier(emittedSymbolName(imported.symbol!))
      }
    }
  }
  return cppIdentifier(expression.name)
}

export function cppIdentifier(name: string): string {
  if name == "operator" { return "operator_" }
  if name == "mutable" { return "mutable_" }
  if name == "class" { return "class_" }
  if name == "struct" { return "struct_" }
  if name == "namespace" { return "namespace_" }
  if name == "template" { return "template_" }
  if name == "typename" { return "typename_" }
  if name == "union" { return "union_" }
  return name
}

export function emitUnary(expression: UnaryExpression, context: EmitContext): string {
  if expression.operator == "try!" || expression.operator == "try?" {
    operand := emitExpression(expression.operand, context)
    operandType := requireExpressionType(expression.operand, expression.operator + " operand")
    case operandType {
      result: ResultResolvedType -> {
        valueType := emitType(result.valueType, context.modulePath)
        body := "auto _try_value = " + operand + "; if (doof::is_failure(_try_value)) doof::panic(\"" + expression.operator + " failed\"); "
        case result.valueType {
          _: VoidType -> { return "[&]() -> void { " + body + " }()" }
          _ -> { }
        }
        if expression.operator == "try?" {
          return "[&]() -> std::optional<" + valueType + "> { " + body + "return std::move(doof::success_value(_try_value)); }()"
        }
        return "[&]() -> " + valueType + " { " + body + "return std::move(doof::success_value(_try_value)); }()"
      }
      _ -> { panic(expression.operator + " operand is not a Result") }
    }
  }
  operand := emitExpression(expression.operand, context)
  if !expression.prefix && expression.operator == "!" {
    case expression.operand {
      member: MemberExpression -> { return "doof::unwrap_optional(" + operand + ")" }
      _ -> { }
    }
    operandType := decoratedExpressionType(expression.operand)
    if operandType != null {
      case operandType! {
        union_: UnionResolvedType -> {
          if hasSinglePrimitiveMember(union_) { return operand + ".value()" }
          if isNullableVariantType(operandType) { return "doof::unwrap_optional(" + operand + ")" }
        }
        _ -> { }
      }
    }
    return "doof::unwrap_optional(" + operand + ")"
  }
  return binaryOperator(expression.operator) + operand
}

function binaryOperator(operator: string): string {
  return if operator == "!" then "!" else if operator == "-" then "-" else if operator == "+" then "+" else "~"
}

export function emitBinary(expression: BinaryExpression, context: EmitContext): string {
  if expression.operator == "??" {
    left := emitExpression(expression.left, context)
    right := emitExpression(expression.right, context)
    return "(doof::is_null(" + left + ") ? " + right + " : doof::unwrap_optional(" + left + "))"
  }
  if (expression.operator == "==" || expression.operator == "!=") && expression.right.kind == "null-literal" {
    let test = "doof::is_null(" + emitExpression(expression.left, context) + ")"
    return if expression.operator == "==" then test else "(!" + test + ")"
  }
  if (expression.operator == "==" || expression.operator == "!=") && expression.left.kind == "null-literal" {
    let test = "doof::is_null(" + emitExpression(expression.right, context) + ")"
    return if expression.operator == "==" then test else "(!" + test + ")"
  }
  if expression.operator == "**" {
    return "std::pow(" + emitExpression(expression.left, context) + ", " + emitExpression(expression.right, context) + ")"
  }
  operator := if expression.operator == "\\" then "/" else expression.operator
  return "(" + emitExpression(expression.left, context) + " " + operator + " " + emitExpression(expression.right, context) + ")"
}

export function emitMember(expression: MemberExpression, context: EmitContext): string {
  object := emitExpression(expression.object, context)
  case expression.object {
    _: ThisExpression -> { return "this->" + cppIdentifier(expression.property) }
    _ -> { }
  }
  case expression.object {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null && identifier.resolvedBinding!.casePattern != "" && (expression.property == "value" || expression.property == "error") {
        return object + "." + cppIdentifier(expression.property)
      }
    }
    _ -> { }
  }
  case expression.object {
    identifier: Identifier -> {
      for namespace of context.namespaceImports {
        if namespace.localName == identifier.name {
          return "::" + exprModuleNamespaceFor(namespace.sourceModule) + "::" + cppIdentifier(expression.property)
        }
      }
    }
    _ -> { }
  }
  staticObjectType := decoratedExpressionType(expression.object)
  if staticObjectType != null {
    case staticObjectType! {
      class_: ClassType -> {
        if expression.resolvedStaticOwner != null {
          owner := expression.resolvedStaticOwner!
          ownerName := if owner.native_ then "::" + (if owner.nativeCppName == "" then owner.name else owner.nativeCppName) else object
          return ownerName + "::" + cppIdentifier(expression.property)
        }
      }
      _ -> { }
    }
  }
  // Nominal fields and methods take precedence over builtin and aggregate
  // pseudo-members. This keeps ordinary members named length, kind,
  // resolvedType, span, push, or value from being rewritten as accessors.
  if staticObjectType != null {
    case staticObjectType! {
      class_: ClassType -> {
        if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" {
          if expression.property == "kind" { return "doof::kind(" + object + ")" }
          if expression.property == "resolvedType" { return "doof::resolved_type(" + object + ")" }
          if expression.property == "span" { return "doof::span(" + object + ")" }
        } else {
          return object + (if class_.symbol.kind == "struct" then "." else "->") + cppIdentifier(expression.property)
        }
      }
      _ -> { }
    }
  }
  if expression.property == "length" { return "doof::length(" + object + ")" }
  if expression.property == "kind" { return "doof::kind(" + object + ")" }
  if expression.property == "resolvedType" { return "doof::resolved_type(" + object + ")" }
  if expression.property == "span" { return "doof::span(" + object + ")" }
  if expression.property == "push" { return object + "->push_back" }
  if expression.property == "value" && object.contains("::") { return "static_cast<int32_t>(" + object + ")" }
  objectType := decoratedExpressionType(expression.object)
  if objectType != null {
    case objectType! {
      _: InterfaceType -> { return "std::visit([](auto&& _obj) { return _obj->" + cppIdentifier(expression.property) + "; }, " + object + ")" }
      _: StreamResolvedType -> { return object + "->" + cppIdentifier(expression.property) }
      _: ArrayResolvedType -> { if expression.property == "length" { return "(" + object + ")->size()" } }
      primitive: PrimitiveType -> { if primitive.name == "string" && expression.property == "length" { return object + ".size()" } }
      result: ResultResolvedType -> { if expression.property == "value" || expression.property == "error" { return object + "." + cppIdentifier(expression.property) } }
      enum_: EnumType -> {
        if expression.property == "value" { return "static_cast<int32_t>(" + object + ")" }
        return object + "::" + cppIdentifier(expression.property)
      }
      _ -> { }
    }
  }
  return object + "->" + cppIdentifier(expression.property)
}

export function emitIndex(expression: IndexExpression, context: EmitContext): string {
  object := emitExpression(expression.object, context)
  objectType := decoratedExpressionType(expression.object)
  if objectType != null {
    case objectType! {
      _: ArrayResolvedType -> { return "(*" + object + ")[" + emitExpression(expression.index, context) + "]" }
      _: MapResolvedType -> { return "(*" + object + ")[" + emitExpression(expression.index, context) + "]" }
      _ -> { }
    }
  }
  return object + "[" + emitExpression(expression.index, context) + "]"
}
