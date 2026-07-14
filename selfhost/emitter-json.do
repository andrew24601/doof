// Automatic JSON method lowering for the self-hosted emitter.
//
// This first deserialization slice deliberately supports only non-generic
// classes/structs whose instance fields are primitives, JsonValue, or nullable
// primitives. Keeping eligibility and lowering together prevents the checker
// and generated C++ surface from promising methods the emitter cannot define.

import { ClassDeclaration, ClassField } from "./ast"
import { ArrayResolvedType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, UnionResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitContextType } from "./emitter-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization, nullableJsonPrimitive } from "./json-semantics"

/** Emits automatic JSON declarations owned by a concrete class or struct. */
export function emitGeneratedJsonDeclarations(owner: ClassDeclaration, context: EmitContext): string {
  if (!canGenerateJsonSerialization(owner)) { return "" }
  let result = "    doof::JsonObject toJsonObject() const;\n"
  if canGenerateJsonDeserialization(owner) {
    valueType := jsonResultValueType(owner)
    result = result + "    static doof::Result<" + valueType + ", std::string> fromJsonValue(const doof::JsonValue& _json);\n"
  }
  return result
}

/** Emits automatic JSON definitions after the owning class declaration. */
export function emitGeneratedJsonMethods(owner: ClassDeclaration, context: EmitContext): string {
  if !canGenerateJsonSerialization(owner) { return "" }
  let result = emitToJsonObject(owner, context)
  if canGenerateJsonDeserialization(owner) { result = result + emitFromJsonValue(owner, context) }
  return result
}

function emitToJsonObject(owner: ClassDeclaration, context: EmitContext): string {
  let result = "doof::JsonObject " + owner.name + "::toJsonObject() const {\n"
  result = result + "    auto _json = std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>();\n"
  for field of owner.fields {
    if field.static_ { continue }
    for name of field.names {
      result = result + "    (*_json)[\"" + name + "\"] = " + emitJsonField("this->" + cppIdentifier(name), field.resolvedType!) + ";\n"
    }
  }
  return result + "    return _json;\n}\n"
}

function emitFromJsonValue(owner: ClassDeclaration, context: EmitContext): string {
  valueType := jsonResultValueType(owner)
  failureType := "doof::Failure<std::string>"
  let result = "doof::Result<" + valueType + ", std::string> " + owner.name + "::fromJsonValue(const doof::JsonValue& _json) {\n"
  result = result + "    const auto* _object = doof::json_as_object(_json);\n"
  result = result + "    if (_object == nullptr) { return " + failureType + "{\"Expected JSON object\"}; }\n"
  for field of owner.fields {
    if field.static_ { continue }
    for name of field.names { result = result + emitJsonFieldRead(field, name, context, failureType) }
  }
  let arguments = ""
  for field of owner.fields {
    if field.static_ { continue }
    for name of field.names {
      if arguments != "" { arguments = arguments + ", " }
      arguments = arguments + "_field_" + cppIdentifier(name)
    }
  }
  let constructed = owner.name + "{" + arguments + "}"
  if !owner.struct_ { constructed = "std::make_shared<" + owner.name + ">(" + constructed + ")" }
  return result + "    return doof::Success<" + valueType + ">{" + constructed + "};\n}\n"
}

function emitJsonFieldRead(field: ClassField, name: string, context: EmitContext, failureType: string): string {
  type_ := field.resolvedType!
  safeName := cppIdentifier(name)
  iterator := "_iterator_" + safeName
  value := "_field_" + safeName
  typeText := emitContextType(type_, context)
  let result = ""
  if field.defaultValue != null {
    result = result + "    " + typeText + " " + value + ";\n"
    result = result + "    if (auto " + iterator + " = _object->find(\"" + name + "\"); " + iterator + " != _object->end()) {\n"
    result = result + emitJsonValidation(iterator + "->second", type_, name, failureType, 2)
    result = result + "        " + value + " = " + emitJsonRead(iterator + "->second", type_, context) + ";\n"
    result = result + "    } else {\n"
    result = result + "        " + value + " = " + emitExpression(field.defaultValue!, context, type_) + ";\n"
    return result + "    }\n"
  }
  result = result + "    auto " + iterator + " = _object->find(\"" + name + "\");\n"
  result = result + "    if (" + iterator + " == _object->end()) { return " + failureType + "{\"Missing required field \\\"" + name + "\\\"\"}; }\n"
  result = result + emitJsonValidation(iterator + "->second", type_, name, failureType, 1)
  return result + "    auto " + value + " = " + emitJsonRead(iterator + "->second", type_, context) + ";\n"
}

function emitJsonValidation(json: string, type_: ResolvedType, name: string, failureType: string, indent: int): string {
  prefix := if indent == 2 then "        " else "    "
  check := emitJsonTypeCheck(json, type_)
  expected := jsonTypeName(type_)
  return prefix + "if (!(" + check + ")) { return " + failureType + "{\"Field \\\"" + name + "\\\" expected " + expected + " but got \" + std::string(doof::json_type_name(" + json + "))}; }\n"
}

function emitJsonTypeCheck(json: string, type_: ResolvedType): string {
  case type_ {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { return "doof::json_is_boolean(" + json + ")" }
      if primitive.name == "string" || primitive.name == "char" { return "doof::json_is_string(" + json + ")" }
      return "doof::json_is_number(" + json + ")"
    }
    _: JsonValueResolvedType -> { return "true" }
    union_: UnionResolvedType -> {
      inner := nullableJsonPrimitive(union_)!
      return "doof::json_is_null(" + json + ") || " + emitJsonTypeCheck(json, inner)
    }
    _ -> { return "false" }
  }
  return "false"
}

function emitJsonRead(json: string, type_: ResolvedType, context: EmitContext): string {
  case type_ {
    primitive: PrimitiveType -> { return emitPrimitiveJsonRead(json, primitive.name) }
    _: JsonValueResolvedType -> { return json }
    union_: UnionResolvedType -> {
      inner := nullableJsonPrimitive(union_)!
      optionalType := emitContextType(type_, context)
      return "(doof::json_is_null(" + json + ") ? " + optionalType + "{std::nullopt} : " + optionalType + "{" + emitJsonRead(json, inner, context) + "})"
    }
    _ -> { return "{}" }
  }
  return "{}"
}

function emitPrimitiveJsonRead(json: string, name: string): string {
  if name == "bool" { return "doof::json_as_bool(" + json + ")" }
  if name == "byte" { return "static_cast<uint8_t>(doof::json_as_int(" + json + "))" }
  if name == "int" { return "doof::json_as_int(" + json + ")" }
  if name == "long" { return "doof::json_as_long(" + json + ")" }
  if name == "float" { return "doof::json_as_float(" + json + ")" }
  if name == "double" { return "doof::json_as_double(" + json + ")" }
  if name == "char" { return "static_cast<char32_t>(doof::json_as_string(" + json + ")[0])" }
  return "doof::json_as_string(" + json + ")"
}

function jsonTypeName(type_: ResolvedType): string {
  case type_ {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { return "boolean" }
      if primitive.name == "string" || primitive.name == "char" { return "string" }
      return "number"
    }
    _: JsonValueResolvedType -> { return "json" }
    union_: UnionResolvedType -> { return jsonTypeName(nullableJsonPrimitive(union_)!) + " or null" }
    _ -> { return "value" }
  }
  return "value"
}

function emitJsonField(value: string, resolvedType: ResolvedType): string {
  case resolvedType {
    _: JsonValueResolvedType -> { return value }
    _: NullType -> { return "doof::json_value(nullptr)" }
    primitive: PrimitiveType -> {
      if primitive.name == "char" { return "doof::json_value(std::string(1, static_cast<char>(" + value + ")))" }
      if primitive.name == "byte" { return "doof::json_value(static_cast<int32_t>(" + value + "))" }
      return "doof::json_value(" + value + ")"
    }
    union_: UnionResolvedType -> {
      inner := nullableJsonPrimitive(union_)!
      return "(" + value + ".has_value() ? " + emitJsonField(value + ".value()", inner) + " : doof::json_value(nullptr))"
    }
    array: ArrayResolvedType -> {
      if array.elementType.kind == "json-value" { return "doof::json_value(" + value + ")" }
    }
    map: MapResolvedType -> {
      if map.keyType.kind == "primitive" && map.valueType.kind == "json-value" { return "doof::json_value(" + value + ")" }
    }
    _ -> { return "doof::json_value(nullptr)" }
  }
  return "doof::json_value(nullptr)"
}

function jsonResultValueType(owner: ClassDeclaration): string {
  if owner.struct_ { return owner.name }
  return "std::shared_ptr<" + owner.name + ">"
}
