// Automatic JSON method lowering for the self-hosted emitter.
//
// Eligibility and lowering deliberately share one recursive surface so the
// checker never advertises synthetic methods the emitter cannot define.

import { ClassDeclaration, ClassField, IntLiteral, InterfaceDeclaration, StringLiteral } from "./ast"
import { ArrayResolvedType, ClassType, EnumType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, TupleResolvedType, UnionResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitClassInnerType, emitContextType, usesVariantRepresentation } from "./emitter-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization, interfaceJsonDiscriminator, nullableJsonMember } from "./json-semantics"

export function emitInterfaceJsonDeclaration(owner: InterfaceDeclaration): string {
  if !owner.needsJson { return "" }
  return "doof::Result<" + owner.name + ", std::string> " + owner.name + "_fromJsonValue(const doof::JsonValue& _json, bool _lenient = false);\n"
}

export function emitInterfaceJsonDefinition(owner: InterfaceDeclaration, context: EmitContext): string {
  if !owner.needsJson { return "" }
  discriminator := interfaceJsonDiscriminator(owner, context.allPrograms)
  if discriminator == null { return "" }
  failureType := "doof::Failure<std::string>"
  successType := "doof::Success<" + owner.name + ">"
  let result = "\ndoof::Result<" + owner.name + ", std::string> " + owner.name + "_fromJsonValue(const doof::JsonValue& _json, bool _lenient) {\n"
  result = result + "    const auto* _object = doof::json_as_object(_json);\n"
  result = result + "    if (_object == nullptr) { return " + failureType + "{\"Expected JSON object\"}; }\n"
  result = result + "    auto _discriminator_iterator = _object->find(\"" + discriminator!.fieldName + "\");\n"
  result = result + "    if (_discriminator_iterator == _object->end() || !doof::json_is_string(_discriminator_iterator->second)) { return " + failureType + "{\"Missing or invalid discriminator field \\\"" + discriminator!.fieldName + "\\\"\"}; }\n"
  result = result + "    auto _discriminator = doof::json_as_string(_discriminator_iterator->second);\n"
  for i of 0..<discriminator!.entries.length {
    entry := discriminator!.entries[i]
    classType_ := ClassType { name: entry.declaration.name, symbol: entry.declaration.resolvedSymbol! }
    className := emitClassInnerType(classType_, context.modulePath)
    result = result + "    " + (if i == 0 then "if" else "else if") + " (_discriminator == \"" + entry.value + "\") {\n"
    result = result + "        auto _result = " + className + "::fromJsonValue(_json, _lenient);\n"
    result = result + "        if (doof::is_success(_result)) { return " + successType + "{" + owner.name + "{doof::success_value(_result)}}; }\n"
    result = result + "        return " + failureType + "{doof::failure_error(_result)};\n"
    result = result + "    }\n"
  }
  return result + "    return " + failureType + "{\"Unknown " + discriminator!.fieldName + ": \\\"\" + _discriminator + \"\\\"\"};\n}\n"
}

/** Emits automatic JSON declarations owned by a concrete class or struct. */
export function emitGeneratedJsonDeclarations(owner: ClassDeclaration, context: EmitContext): string {
  if (!canGenerateJsonSerialization(owner, context.allPrograms)) { return "" }
  let result = "    doof::JsonObject toJsonObject() const;\n"
  if canGenerateJsonDeserialization(owner, context.allPrograms) {
    valueType := jsonResultValueType(owner)
    result = result + "    static doof::Result<" + valueType + ", std::string> fromJsonValue(const doof::JsonValue& _json, bool _lenient = false);\n"
  }
  return result
}

/** Emits automatic JSON definitions after the owning class declaration. */
export function emitGeneratedJsonMethods(owner: ClassDeclaration, context: EmitContext): string {
  if !canGenerateJsonSerialization(owner, context.allPrograms) { return "" }
  let result = emitToJsonObject(owner, context)
  if canGenerateJsonDeserialization(owner, context.allPrograms) { result = result + emitFromJsonValue(owner, context) }
  return result
}

function emitToJsonObject(owner: ClassDeclaration, context: EmitContext): string {
  let result = "doof::JsonObject " + owner.name + "::toJsonObject() const {\n"
  result = result + "    auto _json = std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>();\n"
  for field of owner.fields {
    if field.static_ { continue }
    for name of field.names {
      result = result + "    (*_json)[\"" + name + "\"] = " + emitJsonField("this->" + cppIdentifier(name), field.resolvedType!, context) + ";\n"
    }
  }
  return result + "    return _json;\n}\n"
}

function emitFromJsonValue(owner: ClassDeclaration, context: EmitContext): string {
  valueType := jsonResultValueType(owner)
  failureType := "doof::Failure<std::string>"
  let result = "doof::Result<" + valueType + ", std::string> " + owner.name + "::fromJsonValue(const doof::JsonValue& _json, bool _lenient) {\n"
  result = result + "    const auto* _object = doof::json_as_object(_json);\n"
  result = result + "    if (_object == nullptr) { return " + failureType + "{\"Expected JSON object\"}; }\n"
  for field of owner.fields {
    if field.static_ { continue }
    for name of field.names {
      if field.const_ { result = result + emitJsonConstFieldValidation(field, name, failureType) }
      else { result = result + emitJsonFieldRead(field, name, context, failureType) }
    }
  }
  let arguments = ""
  for field of owner.fields {
    if field.static_ || field.const_ { continue }
    for name of field.names {
      if arguments != "" { arguments = arguments + ", " }
      arguments = arguments + "_field_" + cppIdentifier(name)
      if field.defaultValue != null { arguments = arguments + ".value()" }
    }
  }
  let constructed = owner.name + "{" + arguments + "}"
  if !owner.struct_ { constructed = "std::make_shared<" + owner.name + ">(" + arguments + ")" }
  return result + "    return doof::Success<" + valueType + ">{" + constructed + "};\n}\n"
}

function emitJsonConstFieldValidation(field: ClassField, name: string, failureType: string): string {
  if field.defaultValue == null { return "" }
  iterator := "_iterator_" + cppIdentifier(name)
  case field.defaultValue! {
    value: StringLiteral -> {
      let result = "    if (auto " + iterator + " = _object->find(\"" + name + "\"); " + iterator + " != _object->end()) {\n"
      result = result + "        if (!doof::json_is_string(" + iterator + "->second) || doof::json_as_string(" + iterator + "->second) != \"" + value.value + "\") { return " + failureType + "{\"Field \\\"" + name + "\\\" must be \\\"" + value.value + "\\\"\"}; }\n"
      return result + "    }\n"
    }
    value: IntLiteral -> {
      let result = "    if (auto " + iterator + " = _object->find(\"" + name + "\"); " + iterator + " != _object->end()) {\n"
      result = result + "        if (!doof::json_is_number(" + iterator + "->second) || doof::json_as_int(" + iterator + "->second) != " + string(value.value) + ") { return " + failureType + "{\"Field \\\"" + name + "\\\" must be " + string(value.value) + "\"}; }\n"
      return result + "    }\n"
    }
    _ -> { return "" }
  }
  return ""
}

function emitJsonFieldRead(field: ClassField, name: string, context: EmitContext, failureType: string): string {
  type_ := field.resolvedType!
  safeName := cppIdentifier(name)
  iterator := "_iterator_" + safeName
  value := "_field_" + safeName
  typeText := emitContextType(type_, context)
  let result = ""
  if field.defaultValue != null {
    result = result + "    std::optional<" + typeText + "> " + value + ";\n"
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

export function emitJsonTypeCheck(json: string, type_: ResolvedType): string {
  case type_ {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { return "(_lenient ? doof::json_is_lenient_boolean(" + json + ") : doof::json_is_boolean(" + json + "))" }
      if primitive.name == "string" || primitive.name == "char" { return "(_lenient ? doof::json_is_lenient_string(" + json + ") : doof::json_is_string(" + json + "))" }
      return "(_lenient ? doof::json_is_lenient_number(" + json + ") : doof::json_is_number(" + json + "))"
    }
    _: JsonValueResolvedType -> { return "true" }
    _: ClassType -> { return "doof::json_is_object(" + json + ")" }
    _: EnumType -> { return "doof::json_is_string(" + json + ")" }
    _: ArrayResolvedType -> { return "doof::json_is_array(" + json + ")" }
    tuple: TupleResolvedType -> { return "doof::json_is_array(" + json + ") && doof::json_as_array(" + json + ")->size() == " + string(tuple.elements.length) }
    _: MapResolvedType -> { return "doof::json_is_object(" + json + ")" }
    union_: UnionResolvedType -> {
      inner := nullableJsonMember(union_)!
      return "doof::json_is_null(" + json + ") || " + emitJsonTypeCheck(json, inner)
    }
    _ -> { return "false" }
  }
  return "false"
}

export function emitJsonRead(json: string, type_: ResolvedType, context: EmitContext): string {
  case type_ {
    primitive: PrimitiveType -> { return emitPrimitiveJsonRead(json, primitive.name) }
    _: JsonValueResolvedType -> { return json }
    class_: ClassType -> {
      return "doof::success_value(" + emitClassInnerType(class_, context.modulePath) + "::fromJsonValue(" + json + ", _lenient))"
    }
    enum_: EnumType -> {
      return emitContextType(enum_, context) + "_fromName(doof::json_as_string(" + json + ")).value()"
    }
    array: ArrayResolvedType -> {
      elementType := emitContextType(array.elementType, context)
      elementValue := emitJsonRead("_element", array.elementType, context)
      return "[&]() { const auto* _array = doof::json_as_array(" + json + "); auto _values = std::make_shared<std::vector<" + elementType + ">>(); _values->reserve(_array->size()); for (const auto& _element : *_array) { _values->push_back(" + elementValue + "); } return _values; }()"
    }
    tuple: TupleResolvedType -> {
      let elements = ""
      for i of 0..<tuple.elements.length {
        if i > 0 { elements = elements + ", " }
        elements = elements + emitJsonRead("(*_tuple)[" + string(i) + "]", tuple.elements[i], context)
      }
      return "[&]() { const auto* _tuple = doof::json_as_array(" + json + "); return std::make_tuple(" + elements + "); }()"
    }
    map: MapResolvedType -> {
      valueType := emitContextType(map.valueType, context)
      entryValue := emitJsonRead("_entry.second", map.valueType, context)
      return "[&]() { const auto* _object_value = doof::json_as_object(" + json + "); auto _values = std::make_shared<doof::ordered_map<std::string, " + valueType + ">>(); for (const auto& _entry : *_object_value) { (*_values)[_entry.first] = " + entryValue + "; } return _values; }()"
    }
    union_: UnionResolvedType -> {
      inner := nullableJsonMember(union_)!
      if usesVariantRepresentation(type_) {
        optionalType := emitContextType(type_, context)
        return "(doof::json_is_null(" + json + ") ? " + optionalType + "{std::monostate{}} : " + optionalType + "{" + emitJsonRead(json, inner, context) + "})"
      }
      case inner {
        class_: ClassType -> {
          if class_.symbol.kind != "struct" { return "(doof::json_is_null(" + json + ") ? nullptr : " + emitJsonRead(json, inner, context) + ")" }
        }
        _: ArrayResolvedType -> {
          return "(doof::json_is_null(" + json + ") ? nullptr : " + emitJsonRead(json, inner, context) + ")"
        }
        _: MapResolvedType -> {
          return "(doof::json_is_null(" + json + ") ? nullptr : " + emitJsonRead(json, inner, context) + ")"
        }
        _ -> { }
      }
      optionalType := emitContextType(type_, context)
      return "(doof::json_is_null(" + json + ") ? " + optionalType + "{std::nullopt} : " + optionalType + "{" + emitJsonRead(json, inner, context) + "})"
    }
    _ -> { return "{}" }
  }
  return "{}"
}

function emitPrimitiveJsonRead(json: string, name: string): string {
  if name == "bool" { return "(_lenient ? doof::json_as_bool_lenient(" + json + ") : doof::json_as_bool(" + json + "))" }
  if name == "byte" { return "static_cast<uint8_t>(_lenient ? doof::json_as_int_lenient(" + json + ") : doof::json_as_int(" + json + "))" }
  if name == "int" { return "(_lenient ? doof::json_as_int_lenient(" + json + ") : doof::json_as_int(" + json + "))" }
  if name == "long" { return "(_lenient ? doof::json_as_long_lenient(" + json + ") : doof::json_as_long(" + json + "))" }
  if name == "float" { return "(_lenient ? doof::json_as_float_lenient(" + json + ") : doof::json_as_float(" + json + "))" }
  if name == "double" { return "(_lenient ? doof::json_as_double_lenient(" + json + ") : doof::json_as_double(" + json + "))" }
  if name == "char" { return "static_cast<char32_t>(doof::json_as_string(" + json + ")[0])" }
  return "(_lenient ? doof::json_as_string_lenient(" + json + ") : doof::json_as_string(" + json + "))"
}

export function jsonTypeName(type_: ResolvedType): string {
  case type_ {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { return "boolean" }
      if primitive.name == "string" || primitive.name == "char" { return "string" }
      return "number"
    }
    _: JsonValueResolvedType -> { return "json" }
    _: ClassType -> { return "object" }
    _: EnumType -> { return "string" }
    _: ArrayResolvedType -> { return "array" }
    _: TupleResolvedType -> { return "array" }
    _: MapResolvedType -> { return "object" }
    union_: UnionResolvedType -> { return jsonTypeName(nullableJsonMember(union_)!) + " or null" }
    _ -> { return "value" }
  }
  return "value"
}

export function emitJsonField(value: string, resolvedType: ResolvedType, context: EmitContext): string {
  case resolvedType {
    _: JsonValueResolvedType -> { return value }
    _: NullType -> { return "doof::json_value(nullptr)" }
    primitive: PrimitiveType -> {
      if primitive.name == "char" { return "doof::json_value(std::string(1, static_cast<char>(" + value + ")))" }
      if primitive.name == "byte" { return "doof::json_value(static_cast<int32_t>(" + value + "))" }
      return "doof::json_value(" + value + ")"
    }
    class_: ClassType -> {
      if class_.symbol.kind == "struct" { return "doof::json_value(" + value + ".toJsonObject())" }
      return "doof::json_value(" + value + "->toJsonObject())"
    }
    enum_: EnumType -> {
      return "doof::json_value(" + emitContextType(enum_, context) + "_name(" + value + "))"
    }
    union_: UnionResolvedType -> {
      inner := nullableJsonMember(union_)!
      if usesVariantRepresentation(resolvedType) {
        innerType := emitContextType(inner, context)
        return "(std::holds_alternative<std::monostate>(" + value + ") ? doof::json_value(nullptr) : " + emitJsonField("std::get<" + innerType + ">(" + value + ")", inner, context) + ")"
      }
      case inner {
        class_: ClassType -> {
          if class_.symbol.kind == "struct" { return "(" + value + ".has_value() ? " + emitJsonField(value + ".value()", inner, context) + " : doof::json_value(nullptr))" }
          return "(" + value + " ? " + emitJsonField(value, inner, context) + " : doof::json_value(nullptr))"
        }
        _: ArrayResolvedType -> { return "(" + value + " ? " + emitJsonField(value, inner, context) + " : doof::json_value(nullptr))" }
        _: MapResolvedType -> { return "(" + value + " ? " + emitJsonField(value, inner, context) + " : doof::json_value(nullptr))" }
        _ -> { return "(" + value + ".has_value() ? " + emitJsonField(value + ".value()", inner, context) + " : doof::json_value(nullptr))" }
      }
    }
    array: ArrayResolvedType -> {
      if array.elementType.kind == "json-value" { return "doof::json_value(" + value + ")" }
      element := emitJsonField("_element", array.elementType, context)
      return "[&]() { auto _array = std::make_shared<std::vector<doof::JsonValue>>(); _array->reserve(" + value + "->size()); for (const auto& _element : *" + value + ") { _array->push_back(" + element + "); } return doof::json_value(_array); }()"
    }
    tuple: TupleResolvedType -> {
      let elements = ""
      for i of 0..<tuple.elements.length {
        if i > 0 { elements = elements + ", " }
        elements = elements + emitJsonField("std::get<" + string(i) + ">(" + value + ")", tuple.elements[i], context)
      }
      return "doof::json_value(std::make_shared<std::vector<doof::JsonValue>>(std::initializer_list<doof::JsonValue>{" + elements + "}))"
    }
    map: MapResolvedType -> {
      if map.keyType.kind == "primitive" && map.valueType.kind == "json-value" { return "doof::json_value(" + value + ")" }
      entryValue := emitJsonField("_entry.second", map.valueType, context)
      return "[&]() { auto _object_value = std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>(); for (const auto& _entry : *" + value + ") { (*_object_value)[_entry.first] = " + entryValue + "; } return doof::json_value(_object_value); }()"
    }
    _ -> { return "doof::json_value(nullptr)" }
  }
  return "doof::json_value(nullptr)"
}

function jsonResultValueType(owner: ClassDeclaration): string {
  if owner.struct_ { return owner.name }
  return "std::shared_ptr<" + owner.name + ">"
}
