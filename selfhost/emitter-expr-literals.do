// Literal, array, object, tuple, and string expression lowering.

import { ArrayLiteral, ObjectLiteral, StringLiteral, TupleLiteral } from "./ast"
import { ArrayResolvedType, ClassType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, ResultResolvedType, SetResolvedType, UnionResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emittedSymbolName, emitNullableVariantPromotion, exprModuleNamespaceFor, findProperty, needsNullableVariantPromotion } from "./emitter-expr-utils"
import { emitType } from "./emitter-types"

export function emitNullLiteral(expected: ResolvedType | null): string {
  if expected == null { return "nullptr" }
  case expected! {
    class_: ClassType -> {
      if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" { return "std::monostate{}" }
      return "nullptr"
    }
    _: JsonValueResolvedType -> { return "doof::json_value(nullptr)" }
    _: NullType -> { return "std::monostate{}" }
    union_: UnionResolvedType -> {
      let nonNull = 0
      for member of union_.types { if member.kind != "null" { nonNull = nonNull + 1 } }
      if nonNull == 1 {
        for member of union_.types {
          case member {
            _: PrimitiveType -> { return "std::nullopt" }
            class_: ClassType -> {
              if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" { return "std::monostate{}" }
              if class_.symbol.kind == "struct" { return "std::nullopt" }
              return "nullptr"
            }
            _: ArrayResolvedType -> { return "nullptr" }
            _: MapResolvedType -> { return "nullptr" }
            _: SetResolvedType -> { return "nullptr" }
            _ -> { }
          }
        }
      }
      return "std::monostate{}"
    }
    _ -> { return "nullptr" }
  }
  return "nullptr"
}

export function emitChar(value: char): string {
  if value == '\0' { return "U'\\0'" }
  if value == '\\' { return "U'\\\\'" }
  if value == '\'' { return "U'\\''" }
  if value == '\n' { return "U'\\n'" }
  if value == '\r' { return "U'\\r'" }
  if value == '\t' { return "U'\\t'" }
  code := int(value)
  if code <= 65535 {
    return "U'\\u" + hexDigit(code \ 4096) + hexDigit((code \ 256) % 16) + hexDigit((code \ 16) % 16) + hexDigit(code % 16) + "'"
  }
  return "U'\\U" + hexDigit((code \ 268435456) % 16) + hexDigit((code \ 16777216) % 16) + hexDigit((code \ 1048576) % 16) + hexDigit((code \ 65536) % 16) + hexDigit((code \ 4096) % 16) + hexDigit((code \ 256) % 16) + hexDigit((code \ 16) % 16) + hexDigit(code % 16) + "'"
}

function hexDigit(value: int): string {
  digits := "0123456789ABCDEF"
  return digits.substring(value, value + 1)
}

export function emitArray(expression: ArrayLiteral, context: EmitContext, expected: ResolvedType | null): string {
  arrayType := expression.resolvedType
  if arrayType != null {
    case arrayType! {
      array: ArrayResolvedType -> {
        elementType := emitType(array.elementType, context.modulePath)
        let values = ""
        for i of 0..<expression.elements.length {
          if i > 0 { values = values + ", " }
          values = values + emitExpression(expression.elements[i], context)
        }
        return "std::make_shared<std::vector<" + elementType + ">>(std::vector<" + elementType + ">{" + values + "})"
      }
      set_: SetResolvedType -> {
        elementType := emitType(set_.elementType, context.modulePath)
        let values = ""
        for i of 0..<expression.elements.length {
          if i > 0 { values = values + ", " }
          values = values + emitExpression(expression.elements[i], context)
        }
        return "std::make_shared<doof::ordered_set<" + elementType + ">>(doof::ordered_set<" + elementType + ">{" + values + "})"
      }
      _: JsonValueResolvedType -> {
        let values = ""
        for i of 0..<expression.elements.length {
          if i > 0 { values = values + ", " }
          values = values + "doof::json_value(" + emitExpression(expression.elements[i], context) + ")"
        }
        return "doof::json_value(std::make_shared<std::vector<doof::JsonValue>>(std::initializer_list<doof::JsonValue>{" + values + "}))"
      }
      _ -> { }
    }
  }
  panic("Array literal has no checked array type in " + context.modulePath + "::" + context.currentFunctionName)
  return "nullptr"
}

export function emitObject(expression: ObjectLiteral, context: EmitContext, expected: ResolvedType | null): string {
  if expected != null {
    case expected! {
      result: ResultResolvedType -> {
        value := findProperty(expression.properties, "value")
        error := findProperty(expression.properties, "error")
        if value != null {
          emitted := if value!.value == null then cppIdentifier(value!.name) else emitExpression(value!.value!, context, result.valueType)
          return "doof::Success<" + emitType(result.valueType, context.modulePath) + ">{ " + emitted + " }"
        }
        if error != null {
          emitted := if error!.value == null then cppIdentifier(error!.name) else emitExpression(error!.value!, context, result.errorType)
          return "doof::Failure<" + emitType(result.errorType, context.modulePath) + ">{ " + emitted + " }"
        }
      }
      class_: ClassType -> { return emitClassObject(expression, context, class_) }
      _ -> { }
    }
  }
  if expected != null {
    case expected! {
      map: MapResolvedType -> { return emitMapObject(expression, context, map) }
      _ -> { }
    }
  }
  let values = ""
  let first = true
  for property of expression.properties {
    if !first { values = values + ", " }
    first = false
    key := quote(property.name)
    value := if property.value == null then "doof::json_value(nullptr)" else "doof::json_value(" + emitExpression(property.value!, context) + ")"
    values = values + "{" + key + ", " + value + "}"
  }
  if expected != null {
    case expected! {
      _: JsonValueResolvedType -> { return "doof::json_value(std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>(std::initializer_list<std::pair<std::string, doof::JsonValue>>{" + values + "}))" }
      _ -> { }
    }
  }
  return "doof::json_value(std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>(std::initializer_list<std::pair<std::string, doof::JsonValue>>{" + values + "}))"
}

function emitClassObject(expression: ObjectLiteral, context: EmitContext, resolved: ClassType): string {
  class_ := expression.resolvedClass
  if class_ == null { panic("Object literal has no resolved class in " + context.modulePath) }
  let cppName = emittedSymbolName(resolved.symbol)
  if resolved.symbol.module != "" && resolved.symbol.module != context.modulePath { cppName = "::" + exprModuleNamespaceFor(resolved.symbol.module) + "::" + cppName }
  let values = ""
  let first = true
  for field of class_!.fields {
    if field.static_ { continue }
    for name of field.names {
      if !first { values = values + ", " }
      first = false
      property := findProperty(expression.properties, name)
      let value = "{}"
      if property != null {
        value = if property!.value == null then cppIdentifier(name) else emitExpression(property!.value!, context, field.resolvedType)
        if property!.value == null && needsNullableVariantPromotion(property!.resolvedType, field.resolvedType) { value = emitNullableVariantPromotion(value, property!.resolvedType, field.resolvedType, context.modulePath) }
      } else if field.defaultValue != null {
        value = emitExpression(field.defaultValue!, context, field.resolvedType)
      }
      values = values + value
    }
  }
  if resolved.symbol.kind == "struct" { return cppName + "{" + values + "}" }
  return "std::make_shared<" + cppName + ">(" + values + ")"
}

function emitMapObject(expression: ObjectLiteral, context: EmitContext, map: MapResolvedType): string {
  let values = ""
  for i of 0..<expression.properties.length {
    if i > 0 { values = values + ", " }
    property := expression.properties[i]
    value := if property.value == null then "{}" else emitExpression(property.value!, context, map.valueType)
    key := if property.key == null then quote(property.name) else emitExpression(property.key!, context, map.keyType)
    values = values + "{" + key + ", " + value + "}"
  }
  keyType := emitType(map.keyType, context.modulePath)
  valueType := emitType(map.valueType, context.modulePath)
  return "std::make_shared<doof::ordered_map<" + keyType + ", " + valueType + ">>(std::initializer_list<std::pair<" + keyType + ", " + valueType + ">>{" + values + "})"
}

export function emitTuple(expression: TupleLiteral, context: EmitContext): string {
  let values = ""
  for i of 0..<expression.elements.length {
    if i > 0 { values = values + ", " }
    values = values + emitExpression(expression.elements[i], context)
  }
  return "std::make_tuple(" + values + ")"
}

export function emitString(expression: StringLiteral, context: EmitContext): string {
  if expression.interpolations.length == 0 { return "std::string(" + quote(expression.parts[0]) + ")" }
  let result = "std::string(" + quote(expression.parts[0]) + ")"
  for i of 0..<expression.interpolations.length {
    result = result + " + doof::to_string(" + emitExpression(expression.interpolations[i], context) + ")"
    partIndex := i * 2 + 2
    if partIndex < expression.parts.length { result = result + " + std::string(" + quote(expression.parts[partIndex]) + ")" }
  }
  return result
}

export function quote(value: string): string {
  escaped := value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t")
  return "\"" + escaped + "\""
}
