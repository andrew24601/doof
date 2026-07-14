// Shared semantic eligibility for compiler-generated JSON methods.
//
// The checker and emitter both consume this boundary so a synthetic method is
// never advertised without a matching generated definition.

import {
  ArrayType, BoolLiteral, CharLiteral, ClassDeclaration, ClassField, DoubleLiteral, FloatLiteral,
  IntLiteral, LongLiteral, NamedType, StringLiteral, TypeAnnotation, UnionType,
} from "./ast"
import { ArrayResolvedType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, UnionResolvedType } from "./semantic"

export function canGenerateJsonSerialization(owner: ClassDeclaration): bool {
  if owner.native_ || owner.typeParams.length > 0 { return false }
  for field of owner.fields {
    if field.static_ { continue }
    if !isGeneratedJsonSerializationField(field) { return false }
  }
  return true
}

export function canGenerateJsonDeserialization(owner: ClassDeclaration): bool {
  if owner.native_ || owner.typeParams.length > 0 { return false }
  for field of owner.fields {
    if field.static_ { continue }
    if !isGeneratedJsonDeserializationField(field) { return false }
  }
  return true
}

export function nullableJsonPrimitive(type_: ResolvedType): ResolvedType | null {
  case type_ {
    union_: UnionResolvedType -> {
      let primitiveValues: ResolvedType[] = []
      let nullCount = 0
      for member of union_.types {
        case member {
          primitive: PrimitiveType -> {
            if primitiveValues.length > 0 { return null }
            primitiveValues.push(primitive)
          }
          _: NullType -> { nullCount = nullCount + 1 }
          _ -> { return null }
        }
      }
      if primitiveValues.length != 1 || nullCount != 1 || union_.types.length != 2 { return null }
      return primitiveValues[0]
    }
    _ -> { return null }
  }
  return null
}

function isGeneratedJsonFieldType(type_: ResolvedType): bool {
  case type_ {
    _: PrimitiveType -> { return true }
    _: JsonValueResolvedType -> { return true }
    _: UnionResolvedType -> { return nullableJsonPrimitive(type_) != null }
    _ -> { return false }
  }
  return false
}

function isGeneratedJsonSerializationType(type_: ResolvedType): bool {
  if isGeneratedJsonFieldType(type_) { return true }
  case type_ {
    _: NullType -> { return true }
    array: ArrayResolvedType -> { return array.elementType.kind == "json-value" }
    map: MapResolvedType -> {
      case map.keyType {
        key: PrimitiveType -> { return key.name == "string" && map.valueType.kind == "json-value" }
        _ -> { return false }
      }
    }
    _ -> { return false }
  }
  return false
}

// Static member lookup can precede the class declaration in source order.
// Use syntax/default literals until the normal class-checking pass decorates
// the field, then defer to the resolved semantic type thereafter.
function isGeneratedJsonDeserializationField(field: ClassField): bool {
  if field.resolvedType != null { return isGeneratedJsonFieldType(field.resolvedType!) }
  if field.type_ != null { return isGeneratedJsonDeserializationAnnotation(field.type_!) }
  if field.defaultValue == null { return false }
  case field.defaultValue! {
    _: IntLiteral -> { return true }
    _: LongLiteral -> { return true }
    _: FloatLiteral -> { return true }
    _: DoubleLiteral -> { return true }
    _: StringLiteral -> { return true }
    _: CharLiteral -> { return true }
    _: BoolLiteral -> { return true }
    _ -> { return false }
  }
  return false
}

function isGeneratedJsonSerializationField(field: ClassField): bool {
  if field.resolvedType != null { return isGeneratedJsonSerializationType(field.resolvedType!) }
  if field.type_ != null { return isGeneratedJsonSerializationAnnotation(field.type_!) }
  return isGeneratedJsonDeserializationField(field)
}

function isGeneratedJsonDeserializationAnnotation(annotation: TypeAnnotation): bool {
  case annotation {
    named: NamedType -> {
      return named.name == "byte" || named.name == "int" || named.name == "long" ||
        named.name == "float" || named.name == "double" || named.name == "string" ||
        named.name == "char" || named.name == "bool" || named.name == "JsonValue"
    }
    union_: UnionType -> {
      if union_.types.length != 2 { return false }
      let hasNull = false
      let hasPrimitive = false
      for member of union_.types {
        case member {
          named: NamedType -> {
            if named.name == "null" { hasNull = true }
            else if named.name != "JsonValue" && isGeneratedJsonDeserializationAnnotation(member) { hasPrimitive = true }
            else { return false }
          }
          _ -> { return false }
        }
      }
      return hasNull && hasPrimitive
    }
    _ -> { return false }
  }
  return false
}

function isGeneratedJsonSerializationAnnotation(annotation: TypeAnnotation): bool {
  if isGeneratedJsonDeserializationAnnotation(annotation) { return true }
  case annotation {
    named: NamedType -> {
      if named.name == "null" { return true }
      if named.name == "Map" && named.typeArgs.length == 2 {
        case named.typeArgs[0] {
          key: NamedType -> {
            case named.typeArgs[1] {
              value: NamedType -> { return key.name == "string" && value.name == "JsonValue" }
              _ -> { return false }
            }
          }
          _ -> { return false }
        }
      }
      return false
    }
    array: ArrayType -> {
      case array.elementType {
        element: NamedType -> { return element.name == "JsonValue" }
        _ -> { return false }
      }
    }
    _ -> { return false }
  }
  return false
}
