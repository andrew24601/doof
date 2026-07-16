// Shared semantic eligibility for compiler-generated JSON methods.
//
// The checker and emitter both consume this boundary so a synthetic method is
// never advertised without a matching generated definition.

import {
  ArrayType, BoolLiteral, CharLiteral, ClassDeclaration, ClassField, DoubleLiteral, FloatLiteral,
  ExportDeclaration, IntLiteral, LongLiteral, NamedType, Program, Statement, StringLiteral, TypeAnnotation, UnionType,
} from "./ast"
import { ArrayResolvedType, ClassType, EnumType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, Symbol, UnionResolvedType } from "./semantic"

export function canGenerateJsonSerialization(owner: ClassDeclaration, programs: Program[] = []): bool {
  let visited: string[] = []
  return canGenerateJsonSerializationInner(owner, programs, visited)
}

function canGenerateJsonSerializationInner(owner: ClassDeclaration, programs: Program[], visited: string[]): bool {
  if owner.native_ || owner.typeParams.length > 0 || hasDedicatedConstructor(owner) { return false }
  if markJsonOwnerVisited(owner, visited) { return true }
  for field of owner.fields {
    if field.static_ { continue }
    if !isGeneratedJsonSerializationField(field, programs, visited) { return false }
  }
  return true
}

export function canGenerateJsonDeserialization(owner: ClassDeclaration, programs: Program[] = []): bool {
  let visited: string[] = []
  return canGenerateJsonDeserializationInner(owner, programs, visited)
}

function canGenerateJsonDeserializationInner(owner: ClassDeclaration, programs: Program[], visited: string[]): bool {
  if owner.native_ || owner.typeParams.length > 0 || hasDedicatedConstructor(owner) { return false }
  if markJsonOwnerVisited(owner, visited) { return true }
  for field of owner.fields {
    if field.static_ { continue }
    if !isGeneratedJsonDeserializationField(field, programs, visited) { return false }
  }
  return true
}

export function nullableJsonMember(type_: ResolvedType): ResolvedType | null {
  case type_ {
    union_: UnionResolvedType -> { return nullableJsonMemberUnchecked(union_) }
    _ -> { return null }
  }
  return null
}

function isGeneratedJsonType(type_: ResolvedType, programs: Program[] = [], visited: string[] = []): bool {
  case type_ {
    _: PrimitiveType -> { return true }
    _: JsonValueResolvedType -> { return true }
    _: NullType -> { return true }
    _: EnumType -> { return true }
    class_: ClassType -> {
      if class_.symbol.native_ || class_.typeArgs.length > 0 { return false }
      declaration := findJsonClassDeclaration(programs, class_.symbol)
      if declaration == null { return programs.length == 0 }
      return canGenerateJsonDeserializationInner(declaration!, programs, visited)
    }
    array: ArrayResolvedType -> { return isGeneratedJsonType(array.elementType, programs, visited) }
    union_: UnionResolvedType -> {
      inner := nullableJsonMemberUnchecked(union_)
      return inner != null && isGeneratedJsonType(inner!, programs, visited)
    }
    _ -> { return false }
  }
  return false
}

function isGeneratedJsonSerializationType(type_: ResolvedType, programs: Program[] = [], visited: string[] = []): bool {
  case type_ {
    class_: ClassType -> {
      if class_.symbol.native_ || class_.typeArgs.length > 0 { return false }
      declaration := findJsonClassDeclaration(programs, class_.symbol)
      if declaration == null { return programs.length == 0 }
      return canGenerateJsonSerializationInner(declaration!, programs, visited)
    }
    array: ArrayResolvedType -> {
      if array.elementType.kind == "json-value" { return true }
      return isGeneratedJsonSerializationType(array.elementType, programs, visited)
    }
    union_: UnionResolvedType -> {
      inner := nullableJsonMemberUnchecked(union_)
      if inner == null { return false }
      case inner! {
        _: ClassType -> { return isGeneratedJsonSerializationType(inner!, programs, visited) }
        _: ArrayResolvedType -> { return isGeneratedJsonSerializationType(inner!, programs, visited) }
        _: MapResolvedType -> { return isGeneratedJsonSerializationType(inner!, programs, visited) }
        _ -> { return isGeneratedJsonType(inner!, programs, visited) }
      }
    }
    _ -> { }
  }
  if isGeneratedJsonType(type_, programs, visited) { return true }
  case type_ {
    _: NullType -> { return true }
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

function nullableJsonMemberUnchecked(union_: UnionResolvedType): ResolvedType | null {
  let value: ResolvedType | null = null
  let nullCount = 0
  for member of union_.types {
    case member {
      _: NullType -> { nullCount = nullCount + 1 }
      _ -> {
        if value != null { return null }
        value = member
      }
    }
  }
  if value == null || nullCount != 1 || union_.types.length != 2 { return null }
  return value
}

// Static member lookup can precede the class declaration in source order.
// Use syntax/default literals until the normal class-checking pass decorates
// the field, then defer to the resolved semantic type thereafter.
function isGeneratedJsonDeserializationField(field: ClassField, programs: Program[], visited: string[]): bool {
  if field.resolvedType != null { return isGeneratedJsonType(field.resolvedType!, programs, visited) }
  if field.type_ != null { return isGeneratedJsonDeserializationAnnotation(field.type_!, programs, visited) }
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

function isGeneratedJsonSerializationField(field: ClassField, programs: Program[], visited: string[]): bool {
  if field.resolvedType != null { return isGeneratedJsonSerializationType(field.resolvedType!, programs, visited) }
  if field.type_ != null { return isGeneratedJsonSerializationAnnotation(field.type_!, programs, visited) }
  return isGeneratedJsonDeserializationField(field, programs, visited)
}

function isGeneratedJsonDeserializationAnnotation(annotation: TypeAnnotation, programs: Program[], visited: string[]): bool {
  if annotation.resolvedType != null { return isGeneratedJsonType(annotation.resolvedType!, programs, visited) }
  case annotation {
    named: NamedType -> {
      if named.name == "byte" || named.name == "int" || named.name == "long" ||
        named.name == "float" || named.name == "double" || named.name == "string" ||
        named.name == "char" || named.name == "bool" || named.name == "JsonValue" { return true }
      if named.typeArgs.length != 0 || named.resolvedSymbol == null || named.resolvedSymbol!.native_ { return false }
      if named.resolvedSymbol!.kind == "enum" { return true }
      if named.resolvedSymbol!.kind != "class" && named.resolvedSymbol!.kind != "struct" { return false }
      declaration := findJsonClassDeclaration(programs, named.resolvedSymbol!)
      if declaration == null { return programs.length == 0 }
      return canGenerateJsonDeserializationInner(declaration!, programs, visited)
    }
    array: ArrayType -> {
      return isGeneratedJsonDeserializationAnnotation(array.elementType, programs, visited)
    }
    union_: UnionType -> {
      if union_.types.length != 2 { return false }
      let hasNull = false
      let hasPrimitive = false
      for member of union_.types {
        case member {
          named: NamedType -> {
            if named.name == "null" { hasNull = true }
            else if named.name != "JsonValue" && isGeneratedJsonDeserializationAnnotation(member, programs, visited) { hasPrimitive = true }
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

function isGeneratedJsonSerializationAnnotation(annotation: TypeAnnotation, programs: Program[], visited: string[]): bool {
  if annotation.resolvedType != null { return isGeneratedJsonSerializationType(annotation.resolvedType!, programs, visited) }
  case annotation {
    named: NamedType -> {
      if named.resolvedSymbol != null && (named.resolvedSymbol!.kind == "class" || named.resolvedSymbol!.kind == "struct") {
        declaration := findJsonClassDeclaration(programs, named.resolvedSymbol!)
        if declaration == null { return programs.length == 0 }
        return canGenerateJsonSerializationInner(declaration!, programs, visited)
      }
    }
    array: ArrayType -> {
      return isGeneratedJsonSerializationAnnotation(array.elementType, programs, visited)
    }
    _ -> { }
  }
  if isGeneratedJsonDeserializationAnnotation(annotation, programs, visited) { return true }
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

function markJsonOwnerVisited(owner: ClassDeclaration, visited: string[]): bool {
  module := if owner.resolvedSymbol == null then "" else owner.resolvedSymbol!.module
  key := module + "::" + owner.name
  for existing of visited { if existing == key { return true } }
  visited.push(key)
  return false
}

function findJsonClassDeclaration(programs: Program[], symbol: Symbol): ClassDeclaration | null {
  for program of programs {
    for statement of program.statements {
      declaration := jsonClassDeclaration(statement)
      if declaration == null || declaration!.resolvedSymbol == null { continue }
      if declaration!.resolvedSymbol!.module == symbol.module && declaration!.name == symbol.name { return declaration }
    }
  }
  return null
}

function jsonClassDeclaration(statement: Statement): ClassDeclaration | null {
  case statement {
    class_: ClassDeclaration -> { return class_ }
    export_: ExportDeclaration -> { return jsonClassDeclaration(export_.declaration) }
    _ -> { return null }
  }
  return null
}

function hasDedicatedConstructor(owner: ClassDeclaration): bool {
  for method of owner.methods {
    if method.static_ && method.name == "constructor" { return true }
  }
  return false
}
