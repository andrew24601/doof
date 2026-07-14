// Resolved-type utilities shared by the self-hosted checker.

import {
  ArrayResolvedType, ClassType, EnumType, FunctionParamType, FunctionType,
  InterfaceType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, ResultResolvedType, StreamResolvedType, Symbol, TupleResolvedType,
  UnionResolvedType, UnknownType, TypeParameterType, VoidType,
} from "./semantic"
import type {
  ArrayType as AstArrayType, AstFunctionType,
  NamedType as AstNamedType, TypeAnnotation, UnionType as AstUnionType,
} from "./ast"

export function primitive(name: string): ResolvedType {
  return PrimitiveType { name }
}

export function unknownType(): ResolvedType { return UnknownType {} }
export function nullType(): ResolvedType { return NullType {} }
export function voidType(): ResolvedType { return VoidType {} }

export function arrayType(element: ResolvedType, readonly_: bool = false): ResolvedType {
  return ArrayResolvedType { elementType: element, readonly_ }
}

export function mapType(key: ResolvedType, value: ResolvedType, readonly_: bool = false): ResolvedType {
  return MapResolvedType { keyType: key, valueType: value, readonly_ }
}

export function streamType(element: ResolvedType): ResolvedType {
  return StreamResolvedType { elementType: element }
}

export function jsonValueType(): ResolvedType { return JsonValueResolvedType {} }

export function isJsonValueType(resolvedType: ResolvedType): bool {
  case resolvedType {
    _: JsonValueResolvedType -> { return true }
    _ -> { return false }
  }
  return false
}

export function jsonObjectType(): ResolvedType { return mapType(primitive("string"), jsonValueType()) }

export function resultType(value: ResolvedType, error: ResolvedType): ResolvedType { return ResultResolvedType { valueType: value, errorType: error } }

export function tupleType(elements: ResolvedType[]): ResolvedType {
  return TupleResolvedType { elements }
}

export function unionType(types: ResolvedType[]): ResolvedType {
  let members: ResolvedType[] = []
  let aliasName = ""
  let aliasModule = ""
  let hasAdditionalMember = false
  for memberType of types {
    case memberType {
      union: UnionResolvedType -> {
        if !hasAdditionalMember && aliasName == "" {
          aliasName = union.aliasName
          aliasModule = union.aliasModule
        }
        for member of union.types { members.push(member) }
      }
      _ -> {
        if memberType.kind != "null" { aliasName = ""; aliasModule = ""; hasAdditionalMember = true }
        members.push(memberType)
      }
    }
  }
  if members.length == 0 { return unknownType() }
  if members.length == 1 { return members[0] }
  return UnionResolvedType { types: members, aliasName, aliasModule }
}

export function functionType(params: FunctionParamType[], returnType: ResolvedType, typeParams: string[] = []): ResolvedType {
  return FunctionType { params, returnType, typeParams }
}

/** Applies the deep readonly surface used by readonly fields and bindings. */
export function applyDeepReadonly(type_: ResolvedType): ResolvedType {
  case type_ {
    array: ArrayResolvedType -> { return arrayType(applyDeepReadonly(array.elementType), true) }
    map: MapResolvedType -> { return mapType(applyDeepReadonly(map.keyType), applyDeepReadonly(map.valueType), true) }
    stream: StreamResolvedType -> { return streamType(applyDeepReadonly(stream.elementType)) }
    result: ResultResolvedType -> { return resultType(applyDeepReadonly(result.valueType), applyDeepReadonly(result.errorType)) }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(applyDeepReadonly(element)) }
      return tupleType(elements)
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(applyDeepReadonly(member)) }
      result := UnionResolvedType { types: members, aliasName: union_.aliasName, aliasModule: union_.aliasModule }
      return result
    }
    class_: ClassType -> {
      let typeArgs: ResolvedType[] = []
      for argument of class_.typeArgs { typeArgs.push(applyDeepReadonly(argument)) }
      return classType(class_.name, class_.symbol, typeArgs)
    }
    interface_: InterfaceType -> {
      let typeArgs: ResolvedType[] = []
      for argument of interface_.typeArgs { typeArgs.push(applyDeepReadonly(argument)) }
      return interfaceType(interface_.name, interface_.symbol, typeArgs)
    }
    _ -> { return type_ }
  }
  return type_
}

/** Substitutes explicit generic call arguments through a resolved signature. */
export function substituteTypeParams(type_: ResolvedType, names: string[], arguments: ResolvedType[]): ResolvedType {
  case type_ {
    parameter: TypeParameterType -> {
      for i of 0..<names.length {
        if names[i] == parameter.name && i < arguments.length { return arguments[i] }
      }
      return type_
    }
    array: ArrayResolvedType -> { return arrayType(substituteTypeParams(array.elementType, names, arguments), array.readonly_) }
    map: MapResolvedType -> { return mapType(substituteTypeParams(map.keyType, names, arguments), substituteTypeParams(map.valueType, names, arguments), map.readonly_) }
    stream: StreamResolvedType -> { return streamType(substituteTypeParams(stream.elementType, names, arguments)) }
    result: ResultResolvedType -> { return resultType(substituteTypeParams(result.valueType, names, arguments), substituteTypeParams(result.errorType, names, arguments)) }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(substituteTypeParams(element, names, arguments)) }
      return tupleType(elements)
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(substituteTypeParams(member, names, arguments)) }
      return UnionResolvedType { types: members, aliasName: union_.aliasName, aliasModule: union_.aliasModule }
    }
    class_: ClassType -> {
      let typeArgs: ResolvedType[] = []
      for argument of class_.typeArgs { typeArgs.push(substituteTypeParams(argument, names, arguments)) }
      return classType(class_.name, class_.symbol, typeArgs)
    }
    interface_: InterfaceType -> {
      let typeArgs: ResolvedType[] = []
      for argument of interface_.typeArgs { typeArgs.push(substituteTypeParams(argument, names, arguments)) }
      return interfaceType(interface_.name, interface_.symbol, typeArgs)
    }
    function_: FunctionType -> {
      let params: FunctionParamType[] = []
      for parameter of function_.params {
        params.push(FunctionParamType { name: parameter.name, type_: substituteTypeParams(parameter.type_, names, arguments), hasDefault: parameter.hasDefault })
      }
      return functionType(params, substituteTypeParams(function_.returnType, names, arguments), function_.typeParams)
    }
    _ -> { return type_ }
  }
  return type_
}

export function typeParameter(name: string): ResolvedType {
  return TypeParameterType { name }
}

export function classType(name: string, symbol: Symbol, typeArgs: ResolvedType[] = []): ClassType {
  return ClassType { name, symbol, typeArgs }
}

export function enumType(name: string, symbol: Symbol): EnumType {
  return EnumType { name, symbol }
}

export function interfaceType(name: string, symbol: Symbol, typeArgs: ResolvedType[] = []): InterfaceType {
  return InterfaceType { name, symbol, typeArgs }
}

export function typeName(resolvedType: ResolvedType): string {
  case resolvedType {
    primitive_: PrimitiveType -> { return primitive_.name }
    class_: ClassType -> {
      if class_.typeArgs.length == 0 { return class_.name }
      let result = class_.name + "<"
      for i of 0..<class_.typeArgs.length {
        if i > 0 { result = result + ", " }
        result = result + typeName(class_.typeArgs[i])
      }
      return result + ">"
    }
    enum_: EnumType -> { return enum_.name }
    interface_: InterfaceType -> {
      if interface_.typeArgs.length == 0 { return interface_.name }
      let result = interface_.name + "<"
      for i of 0..<interface_.typeArgs.length {
        if i > 0 { result = result + ", " }
        result = result + typeName(interface_.typeArgs[i])
      }
      return result + ">"
    }
    function_: FunctionType -> { return "function" }
    array: ArrayResolvedType -> { return (if array.readonly_ then "readonly " else "") + typeName(array.elementType) + "[]" }
    map: MapResolvedType -> { return (if map.readonly_ then "readonly " else "") + "Map<" + typeName(map.keyType) + ", " + typeName(map.valueType) + ">" }
    stream: StreamResolvedType -> { return "Stream<" + typeName(stream.elementType) + ">" }
    _: JsonValueResolvedType -> { return "JsonValue" }
    result: ResultResolvedType -> { return "Result<" + typeName(result.valueType) + ", " + typeName(result.errorType) + ">" }
    tuple: TupleResolvedType -> {
      let result = "("
      for i of 0..<tuple.elements.length {
        if i > 0 { result = result + ", " }
        result = result + typeName(tuple.elements[i])
      }
      return result + ")"
    }
    union: UnionResolvedType -> {
      let result = ""
      for i of 0..<union.types.length {
        if i > 0 { result = result + " | " }
        result = result + typeName(union.types[i])
      }
      return result
    }
    _: NullType -> { return "null" }
    _: VoidType -> { return "void" }
    _: UnknownType -> { return "unknown" }
    parameter: TypeParameterType -> { return parameter.name }
  }
  return "unknown"
}

export function sameType(left: ResolvedType, right: ResolvedType): bool {
  if typeName(left) == typeName(right) { return true }
  case left {
    leftArray: ArrayResolvedType -> {
      case right {
        rightArray: ArrayResolvedType -> {
          return leftArray.readonly_ == rightArray.readonly_ && sameType(leftArray.elementType, rightArray.elementType)
        }
        _ -> { return false }
      }
    }
    leftMap: MapResolvedType -> {
      case right {
        rightMap: MapResolvedType -> {
          return leftMap.readonly_ == rightMap.readonly_ && sameType(leftMap.keyType, rightMap.keyType) && sameType(leftMap.valueType, rightMap.valueType)
        }
        _ -> { return false }
      }
    }
    leftStream: StreamResolvedType -> {
      case right {
        rightStream: StreamResolvedType -> { return sameType(leftStream.elementType, rightStream.elementType) }
        _ -> { return false }
      }
    }
    leftResult: ResultResolvedType -> {
      case right {
        rightResult: ResultResolvedType -> { return sameType(leftResult.valueType, rightResult.valueType) && sameType(leftResult.errorType, rightResult.errorType) }
        _ -> { return false }
      }
    }
    leftTuple: TupleResolvedType -> {
      case right {
        rightTuple: TupleResolvedType -> {
          if leftTuple.elements.length != rightTuple.elements.length { return false }
          for i of 0..<leftTuple.elements.length {
            if !sameType(leftTuple.elements[i], rightTuple.elements[i]) { return false }
          }
          return true
        }
        _ -> { return false }
      }
    }
    leftFunction: FunctionType -> {
      case right {
        rightFunction: FunctionType -> {
          if leftFunction.params.length != rightFunction.params.length { return false }
          for i of 0..<leftFunction.params.length {
            if !sameType(leftFunction.params[i].type_, rightFunction.params[i].type_) { return false }
          }
          return sameType(leftFunction.returnType, rightFunction.returnType)
        }
        _ -> { return false }
      }
    }
    leftClass: ClassType -> {
      case right {
        rightClass: ClassType -> {
          return leftClass.symbol.module == rightClass.symbol.module &&
            leftClass.symbol.name == rightClass.symbol.name &&
            leftClass.typeArgs.length == rightClass.typeArgs.length &&
            sameTypeArguments(leftClass.typeArgs, rightClass.typeArgs)
        }
        _ -> { return false }
      }
    }
    leftInterface: InterfaceType -> {
      case right {
        rightInterface: InterfaceType -> {
          return leftInterface.symbol.module == rightInterface.symbol.module &&
            leftInterface.symbol.name == rightInterface.symbol.name &&
            leftInterface.typeArgs.length == rightInterface.typeArgs.length &&
            sameTypeArguments(leftInterface.typeArgs, rightInterface.typeArgs)
        }
        _ -> { return false }
      }
    }
    leftUnion: UnionResolvedType -> {
      case right {
        rightUnion: UnionResolvedType -> {
          if leftUnion.types.length != rightUnion.types.length { return false }
          for leftMember of leftUnion.types {
            let found = false
            for rightMember of rightUnion.types {
              if sameType(leftMember, rightMember) {
                found = true
                break
              }
            }
            if !found { return false }
          }
          return true
        }
        _ -> { return false }
      }
    }
    _ -> { return false }
  }
  return false
}

export function isAssignable(value: ResolvedType, target: ResolvedType): bool {
  case value {
    _: TypeParameterType -> {
      case target {
        _: TypeParameterType -> { return sameType(value, target) }
        _ -> { }
      }
    }
    _: UnknownType -> { return true }
    valueUnion: UnionResolvedType -> {
      // A value union is assignable only when every possible arm is accepted
      // by the target. This is what makes `Expression | null` useful for
      // aliases such as the self-hosted AST Expression union.
      for valueMember of valueUnion.types {
        if !isAssignable(valueMember, target) { return false }
      }
      return true
    }
    valueArray: ArrayResolvedType -> {
      case target {
        targetArray: ArrayResolvedType -> {
          if targetArray.readonly_ != valueArray.readonly_ { return false }
          return isAssignable(valueArray.elementType, targetArray.elementType)
        }
        _ -> { }
      }
    }
    valueMap: MapResolvedType -> {
      case target {
        targetMap: MapResolvedType -> {
          if targetMap.readonly_ != valueMap.readonly_ { return false }
          return sameType(valueMap.keyType, targetMap.keyType) && isAssignable(valueMap.valueType, targetMap.valueType)
        }
        _ -> { }
      }
    }
    valueStream: StreamResolvedType -> {
      case target {
        targetStream: StreamResolvedType -> { return isAssignable(valueStream.elementType, targetStream.elementType) }
        _ -> { }
      }
    }
    _: JsonValueResolvedType -> {
      return sameType(value, target)
    }
    _ -> { }
  }
  if sameType(value, target) { return true }
  case target {
    _: JsonValueResolvedType -> { return isJsonValueAssignable(value) }
    _ -> { }
  }
  case value {
    class_: ClassType -> {
      case target {
        interface_: InterfaceType -> {
          for implementedType of class_.symbol.implementedInterfaceTypes {
            if implementedType == typeName(interface_) { return true }
          }
          for implementation of interface_.symbol.implementations {
            if implementation.module == class_.symbol.module && implementation.name == class_.symbol.name { return true }
          }
          return false
        }
        _: StreamResolvedType -> { return true }
        _ -> { }
      }
    }
    _ -> { }
  }
  case target {
    _: TypeParameterType -> { return true }
    _: UnknownType -> { return true }
    union: UnionResolvedType -> {
      for member of union.types { if isAssignable(value, member) { return true } }
      return false
    }
    _ -> { }
  }
  case value {
    primitiveValue: PrimitiveType -> {
      case target {
        primitiveTarget: PrimitiveType -> {
          if primitiveValue.name == "int" && primitiveTarget.name == "long" { return true }
          if primitiveValue.name == "int" && primitiveTarget.name == "byte" { return true }
          if primitiveValue.name == "float" && primitiveTarget.name == "double" { return true }
        }
        _ -> { }
      }
    }
    _: NullType -> {
      case target {
        union: UnionResolvedType -> {
          for member of union.types {
            case member {
              _: NullType -> { return true }
              _ -> { }
            }
          }
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return false
}

function sameTypeArguments(left: ResolvedType[], right: ResolvedType[]): bool {
  for i of 0..<left.length {
    if !sameType(left[i], right[i]) { return false }
  }
  return true
}

function isJsonValueAssignable(value: ResolvedType): bool {
  case value {
    _: UnknownType -> { return true }
    _: JsonValueResolvedType -> { return true }
    _: NullType -> { return true }
    primitiveValue: PrimitiveType -> {
      return primitiveValue.name == "byte" || primitiveValue.name == "int" || primitiveValue.name == "long" ||
        primitiveValue.name == "float" || primitiveValue.name == "double" || primitiveValue.name == "string" || primitiveValue.name == "char" || primitiveValue.name == "bool"
    }
    // Collection literals are checked contextually by the checker. A typed
    // collection value is not implicitly a JsonValue in this bootstrap type
    // model; keeping this boundary strict prevents recovery conversions from
    // masking missing collection element information.
    _ -> { return false }
  }
  return false
}

export function joinTypes(left: ResolvedType, right: ResolvedType): ResolvedType {
  if isAssignable(left, right) { return right }
  if isAssignable(right, left) { return left }
  return unionType([left, right])
}

export function isNumeric(resolvedType: ResolvedType): bool {
  case resolvedType {
    primitive: PrimitiveType -> {
      return primitive.name == "byte" || primitive.name == "int" || primitive.name == "long" ||
        primitive.name == "float" || primitive.name == "double"
    }
    _ -> { return false }
  }
  return false
}

export function numericResult(left: ResolvedType, right: ResolvedType): ResolvedType {
  if typeName(left) == "double" || typeName(right) == "double" { return primitive("double") }
  if typeName(left) == "float" || typeName(right) == "float" { return primitive("float") }
  if typeName(left) == "long" || typeName(right) == "long" { return primitive("long") }
  return primitive("int")
}

export function typeFromAnnotation(annotation: TypeAnnotation): ResolvedType {
  // Used only for the syntactic shape in diagnostics; the checker resolves
  // names through the module symbol table before calling this helper.
  case annotation {
    array: AstArrayType -> { return arrayType(typeFromAnnotation(array.elementType), array.readonly_) }
    union: AstUnionType -> {
      let members: ResolvedType[] = []
      for item of union.types { members.push(typeFromAnnotation(item)) }
      return unionType(members)
    }
    _: AstNamedType -> { return unknownType() }
    _: AstFunctionType -> { return unknownType() }
  }
  return unknownType()
}
