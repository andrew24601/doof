// Assignment, identifier, operator, member, and index lowering.

import { AsExpression, AssignmentExpression, BinaryExpression, Expression, Identifier, IndexExpression, MemberExpression, ThisExpression, UnaryExpression } from "./ast"
import { ArrayResolvedType, ClassMetadataResolvedType, ClassType, EnumType, FunctionType, InterfaceType, JsonValueResolvedType, MapResolvedType, MethodReflectionResolvedType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, SetResolvedType, StreamResolvedType, TypeParameterType, UnionResolvedType, VoidType } from "./semantic"
import { EmitContext, isCapturedMutable } from "./emitter-context"
import { emitExpression } from "./emitter-expr"
import { decoratedExpressionType, emittedSymbolName, exprModuleNamespaceFor, hasSinglePrimitiveMember, isNullableVariantType, requireExpressionType } from "./emitter-expr-utils"
import { emitType, naturalNullableUnionMember, specializeEmitType, usesVariantRepresentation } from "./emitter-types"
import { isNumeric, sameType } from "./checker-types"

/** Lowers checked `as` conversion to a Result without evaluating its source twice. */
export function emitAs(expression: AsExpression, context: EmitContext): string {
  sourceType := requireExpressionType(expression.expression, "as source")
  resultType := requireExpressionType(expression, "as expression")
  case resultType {
    result: ResultResolvedType -> {
      target := result.valueType
      resultCpp := emitType(result, context.modulePath)
      targetCpp := emitType(target, context.modulePath)
      success := "doof::Success<" + targetCpp + ">"
      failure := "doof::Failure<" + emitType(result.errorType, context.modulePath) + ">"
      source := emitExpression(expression.expression, context)
      if sameType(sourceType, target) { return success + "{" + source + "}" }
      case sourceType {
        sourceResult: ResultResolvedType -> {
          let narrowed = ""
          case sourceResult.valueType {
            _: JsonValueResolvedType -> { narrowed = emitJsonAs("doof::success_value(_as_source)", target, resultCpp, success, failure) }
            _ -> { }
          }
          if narrowed != "" {
            let errorValue = "doof::failure_error(_as_source)"
            if !sameType(sourceResult.errorType, result.errorType) {
              errorValue = "doof::variant_promote<" + emitType(result.errorType, context.modulePath) + ">(" + errorValue + ")"
            }
            return "[&]() -> " + resultCpp + " { auto _as_source = " + source + "; if (doof::is_failure(_as_source)) return " + failure + "{" + errorValue + "}; return " + narrowed + "; }()"
          }
        }
        _ -> { }
      }
      if isNumeric(sourceType) && isNumeric(target) {
        return "[&]() -> " + resultCpp + " { auto _as_checked = doof::checked_numeric_as<" + targetCpp + ">(" + source + "); if (_as_checked.has_value()) return " + success + "{_as_checked.value()}; return " + failure + "{\"Numeric narrowing failed\"}; }()"
      }
      case sourceType {
        _: JsonValueResolvedType -> { return emitJsonAs(source, target, resultCpp, success, failure) }
        interface_: InterfaceType -> {
          case target {
            _: ClassType -> {
              return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (std::holds_alternative<" + targetCpp + ">(_as_value)) return " + success + "{std::get<" + targetCpp + ">(_as_value)}; return " + failure + "{\"Interface narrowing failed\"}; }()"
            }
            _ -> { }
          }
        }
        union_: UnionResolvedType -> {
          if unionContainsJsonValue(union_) {
            narrowedJson := "std::get<doof::JsonValue>(_as_nullable)"
            jsonNarrowing := emitJsonAs(narrowedJson, target, resultCpp, success, failure)
            return "[&]() -> " + resultCpp + " { auto _as_nullable = " + source + "; if (doof::is_null(_as_nullable)) return " + failure + "{\"JsonValue narrowing failed\"}; return " + jsonNarrowing + "; }()"
          }
          member := naturalNullableUnionMember(union_)
          if member != null {
            if sameType(member!, target) {
              case target {
                _: ClassType -> {
                  return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (_as_value) return " + success + "{_as_value}; return " + failure + "{\"Nullable narrowing failed\"}; }()"
                }
                _: ArrayResolvedType -> {
                  return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (_as_value) return " + success + "{_as_value}; return " + failure + "{\"Nullable narrowing failed\"}; }()"
                }
                _: PrimitiveType -> {
                  return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (_as_value.has_value()) return " + success + "{_as_value.value()}; return " + failure + "{\"Nullable narrowing failed\"}; }()"
                }
                _ -> { }
              }
            }
            if isNumeric(member!) && isNumeric(target) {
              return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (!_as_value.has_value()) return " + failure + "{\"Nullable narrowing failed\"}; auto _as_checked = doof::checked_numeric_as<" + targetCpp + ">(_as_value.value()); if (_as_checked.has_value()) return " + success + "{_as_checked.value()}; return " + failure + "{\"Numeric narrowing failed\"}; }()"
            }
          }
          return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (doof::variant_is<" + targetCpp + ">(_as_value)) return " + success + "{doof::variant_narrow<" + targetCpp + ">(_as_value)}; return " + failure + "{\"Union narrowing failed\"}; }()"
        }
        _ -> { }
      }
      return failure + "{\"Unsupported narrowing\"}"
    }
    _ -> { panic("as expression must resolve to Result") }
  }
  return ""
}

function unionContainsJsonValue(union_: UnionResolvedType): bool {
  for member of union_.types {
    case member {
      _: JsonValueResolvedType -> { return true }
      _ -> { }
    }
  }
  return false
}

function emitJsonAs(source: string, target: ResolvedType, resultCpp: string, success: string, failure: string): string {
  let condition = "true"
  let value = source
  case target {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { condition = "doof::json_is_boolean(_as_value)"; value = "doof::json_as_bool(_as_value)" }
      else if primitive.name == "string" { condition = "doof::json_is_string(_as_value)"; value = "doof::json_as_string(_as_value)" }
      else if primitive.name == "int" { condition = "doof::json_is_number(_as_value)"; value = "doof::json_as_int(_as_value)" }
      else if primitive.name == "long" { condition = "doof::json_is_number(_as_value)"; value = "doof::json_as_long(_as_value)" }
      else if primitive.name == "float" { condition = "doof::json_is_number(_as_value)"; value = "doof::json_as_float(_as_value)" }
      else if primitive.name == "double" { condition = "doof::json_is_number(_as_value)"; value = "doof::json_as_double(_as_value)" }
    }
    _: ArrayResolvedType -> { condition = "doof::json_is_array(_as_value)"; value = "std::get<doof::JsonArray>(doof::json_storage(_as_value))" }
    _: MapResolvedType -> { condition = "doof::json_is_object(_as_value)"; value = "doof::json_object(_as_value)" }
    _: JsonValueResolvedType -> { value = "_as_value" }
    _ -> { }
  }
  return "[&]() -> " + resultCpp + " { auto _as_value = " + source + "; if (" + condition + ") return " + success + "{" + value + "}; return " + failure + "{\"JsonValue narrowing failed\"}; }()"
}

export function emitAssignment(expression: AssignmentExpression, context: EmitContext): string {
  operator := if expression.operator == "\\=" then "/=" else expression.operator
  targetType := expression.target.resolvedType
  value := emitExpression(expression.value, context, targetType)
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
  if expression.resolvedBinding != null && expression.resolvedBinding!.mutable && isCapturedMutable(context, expression.name) {
    return "(*" + cppIdentifier(expression.name) + ")"
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
  if name == "char" { return "char_" }
  if name == "short" { return "short_" }
  if name == "delete" { return "delete_" }
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
    operandType := decoratedExpressionType(expression.operand)
    if operandType != null {
      case operandType! {
        result: ResultResolvedType -> {
          valueType := emitType(result.valueType, context.modulePath)
          body := "auto _assert_value = " + operand + "; if (doof::is_failure(_assert_value)) doof::panic(\"! failed\"); "
          case result.valueType {
            _: VoidType -> { return "[&]() -> void { " + body + "}()" }
            _ -> { }
          }
          return "[&]() -> " + valueType + " { " + body + "return std::move(doof::success_value(_assert_value)); }()"
        }
        _ -> { }
      }
    }
    case expression.operand {
      member: MemberExpression -> { return "doof::unwrap_optional(" + operand + ")" }
      _ -> { }
    }
    if operandType != null {
      case operandType! {
        union_: UnionResolvedType -> {
          if hasSinglePrimitiveMember(union_) { return operand + ".value()" }
          if usesVariantRepresentation(union_) {
            let nonNullMembers: ResolvedType[] = []
            for member of union_.types { if member.kind != "null" { nonNullMembers.push(member) } }
            if nonNullMembers.length == 1 { return "std::get<" + emitType(nonNullMembers[0], context.modulePath) + ">(" + operand + ")" }
          }
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
  if expression.operator == ".." {
    return "doof::range(" + emitExpression(expression.left, context) + ", " + emitExpression(expression.right, context) + ")"
  }
  if expression.operator == "..<" {
    return "doof::range_exclusive(" + emitExpression(expression.left, context) + ", " + emitExpression(expression.right, context) + ")"
  }
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
      parameter: TypeParameterType -> {
        specialized := specializeEmitType(parameter, context)
        if expression.property == "metadata" { return "doof::metadata_for_type<" + emitType(specialized, context.modulePath) + ">()" }
        if expression.property == "fromJsonValue" {
          case specialized {
            concrete: ClassType -> { return emitType(concrete, context.modulePath) + "::element_type::fromJsonValue" }
            unresolved: TypeParameterType -> { return cppIdentifier(unresolved.name) + "::element_type::fromJsonValue" }
            _ -> { }
          }
        }
      }
      class_: ClassType -> {
        if expression.resolvedStaticOwner != null {
          owner := expression.resolvedStaticOwner!
          let ownerName = owner.name
          if owner.native_ {
            ownerName = "::" + (if owner.nativeCppName == "" then owner.name else owner.nativeCppName)
          } else if owner.resolvedSymbol != null && owner.resolvedSymbol!.module != context.modulePath && context.modulePath != "" {
            ownerName = "::" + exprModuleNamespaceFor(owner.resolvedSymbol!.module) + "::" + owner.name
          }
          return ownerName + "::" + (if expression.property == "metadata" then "_metadata" else cppIdentifier(expression.property))
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
  if expression.property == "kind" { return "doof::kind(" + object + ")" }
  if expression.property == "resolvedType" { return "doof::resolved_type(" + object + ")" }
  if expression.property == "span" { return "doof::span(" + object + ")" }
  if expression.property == "push" { return object + "->push_back" }
  if expression.property == "value" && object.contains("::") { return "static_cast<int32_t>(" + object + ")" }
  objectType := decoratedExpressionType(expression.object)
  if objectType != null {
    case objectType! {
      function_: FunctionType -> { return object + "." + cppIdentifier(expression.property) }
      _: PromiseType -> { return object + "." + cppIdentifier(expression.property) }
      _: InterfaceType -> { return "std::visit([](auto&& _obj) { return _obj->" + cppIdentifier(expression.property) + "; }, " + object + ")" }
      _: StreamResolvedType -> { return "std::visit([](auto&& _obj) { return _obj->" + cppIdentifier(expression.property) + "; }, " + object + ")" }
      _: ArrayResolvedType -> { if expression.property == "length" { return "static_cast<int32_t>((" + object + ")->size())" } }
      _: MapResolvedType -> { if expression.property == "size" { return object + "->size()" } }
      _: SetResolvedType -> { if expression.property == "size" { return object + "->size()" } }
      _: RangeResolvedType -> {
        if expression.property == "lowerBound" || expression.property == "upperBound" { return object + "." + expression.property }
      }
      primitive: PrimitiveType -> {
        if primitive.name == "string" && expression.property == "length" { return "static_cast<int32_t>(" + object + ".size())" }
        if primitive.name == "string" && expression.property == "toLowerCase" { return "doof::string_toLowerCase" }
        if primitive.name == "string" && expression.property == "toUpperCase" { return "doof::string_toUpperCase" }
      }
      result: ResultResolvedType -> {
        if expression.property == "value" { return "doof::success_value(" + object + ")" }
        if expression.property == "error" { return "doof::failure_error(" + object + ")" }
      }
      _: ClassMetadataResolvedType -> { return object + "." + cppIdentifier(expression.property) }
      _: MethodReflectionResolvedType -> { return object + "." + cppIdentifier(expression.property) }
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
