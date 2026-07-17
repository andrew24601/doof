// Resolved-type utilities shared by the self-hosted checker.

import {
  ActorType, ArrayResolvedType, ClassMetadataResolvedType, ClassType, EnumType, FunctionParamType, FunctionType,
  InterfaceType,
  JsonValueResolvedType, MapResolvedType, MethodReflectionResolvedType, NullType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, SetResolvedType, StreamResolvedType, Symbol, TupleResolvedType,
  UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType,
} from "./semantic"
import type {
  ArrayType as AstArrayType, AstFunctionType,
  NamedType as AstNamedType, TypeAnnotation, UnionType as AstUnionType, WeakType,
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

export function setType(element: ResolvedType, readonly_: bool = false): ResolvedType {
  return SetResolvedType { elementType: element, readonly_ }
}

export function streamType(element: ResolvedType): ResolvedType {
  return StreamResolvedType { elementType: element }
}

export function rangeType(): ResolvedType { return RangeResolvedType {} }

export function jsonValueType(): ResolvedType { return JsonValueResolvedType {} }

export function isJsonValueType(resolvedType: ResolvedType): bool {
  case resolvedType {
    _: JsonValueResolvedType -> { return true }
    _ -> { return false }
  }
  return false
}

export function jsonObjectType(): ResolvedType { return mapType(primitive("string"), jsonValueType()) }

export function classMetadataType(classType_: ClassType): ResolvedType { return ClassMetadataResolvedType { classType: classType_ } }

export function methodReflectionType(classType_: ClassType): ResolvedType { return MethodReflectionResolvedType { classType: classType_ } }

export function resultType(value: ResolvedType, error: ResolvedType): ResolvedType { return ResultResolvedType { valueType: value, errorType: error } }

export function actorType(innerClass: ClassType): ResolvedType { return ActorType { innerClass } }

export function promiseType(valueType: ResolvedType): ResolvedType { return PromiseType { valueType } }

export function weakType(inner: ResolvedType): ResolvedType { return WeakResolvedType { inner } }

export function tupleType(elements: ResolvedType[]): ResolvedType {
  return TupleResolvedType { elements }
}

export function unionType(types: ResolvedType[]): ResolvedType {
  let members: ResolvedType[] = []
  for memberType of types {
    case memberType {
      union: UnionResolvedType -> {
        for member of union.types { pushUniqueType(members, member) }
      }
      _ -> { pushUniqueType(members, memberType) }
    }
  }
  if members.length == 0 { return unknownType() }
  if members.length == 1 { return members[0] }
  return UnionResolvedType { types: members }
}

function pushUniqueType(types: ResolvedType[], candidate: ResolvedType): void {
  for existing of types { if sameType(existing, candidate) { return } }
  types.push(candidate)
}

export function functionType(params: FunctionParamType[], returnType: ResolvedType, typeParams: string[] = []): ResolvedType {
  return FunctionType { params, returnType, typeParams }
}

/** Applies the deep readonly surface used by readonly fields and bindings. */
export function applyDeepReadonly(type_: ResolvedType): ResolvedType {
  case type_ {
    array: ArrayResolvedType -> { return arrayType(applyDeepReadonly(array.elementType), true) }
    map: MapResolvedType -> { return mapType(applyDeepReadonly(map.keyType), applyDeepReadonly(map.valueType), true) }
    set: SetResolvedType -> { return setType(applyDeepReadonly(set.elementType), true) }
    stream: StreamResolvedType -> { return streamType(applyDeepReadonly(stream.elementType)) }
    result: ResultResolvedType -> { return resultType(applyDeepReadonly(result.valueType), applyDeepReadonly(result.errorType)) }
    weak_: WeakResolvedType -> { return weakType(weak_.inner) }
    actor: ActorType -> {
      let typeArgs: ResolvedType[] = []
      for argument of actor.innerClass.typeArgs { typeArgs.push(applyDeepReadonly(argument)) }
      return actorType(classType(actor.innerClass.name, actor.innerClass.symbol, typeArgs))
    }
    promise: PromiseType -> { return promiseType(applyDeepReadonly(promise.valueType)) }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(applyDeepReadonly(element)) }
      return tupleType(elements)
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(applyDeepReadonly(member)) }
      result := UnionResolvedType { types: members }
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
    set: SetResolvedType -> { return setType(substituteTypeParams(set.elementType, names, arguments), set.readonly_) }
    stream: StreamResolvedType -> { return streamType(substituteTypeParams(stream.elementType, names, arguments)) }
    result: ResultResolvedType -> { return resultType(substituteTypeParams(result.valueType, names, arguments), substituteTypeParams(result.errorType, names, arguments)) }
    weak_: WeakResolvedType -> { return weakType(substituteTypeParams(weak_.inner, names, arguments)) }
    actor: ActorType -> {
      let typeArgs: ResolvedType[] = []
      for argument of actor.innerClass.typeArgs { typeArgs.push(substituteTypeParams(argument, names, arguments)) }
      return actorType(classType(actor.innerClass.name, actor.innerClass.symbol, typeArgs))
    }
    promise: PromiseType -> { return promiseType(substituteTypeParams(promise.valueType, names, arguments)) }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(substituteTypeParams(element, names, arguments)) }
      return tupleType(elements)
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(substituteTypeParams(member, names, arguments)) }
      return UnionResolvedType { types: members }
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
    set: SetResolvedType -> { return (if set.readonly_ then "ReadonlySet" else "Set") + "<" + typeName(set.elementType) + ">" }
    stream: StreamResolvedType -> { return "Stream<" + typeName(stream.elementType) + ">" }
    _: RangeResolvedType -> { return "Range" }
    _: JsonValueResolvedType -> { return "JsonValue" }
    result: ResultResolvedType -> { return "Result<" + typeName(result.valueType) + ", " + typeName(result.errorType) + ">" }
    weak_: WeakResolvedType -> { return "weak " + typeName(weak_.inner) }
    actor: ActorType -> { return "Actor<" + typeName(actor.innerClass) + ">" }
    promise: PromiseType -> { return "Promise<" + typeName(promise.valueType) + ">" }
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
    metadata: ClassMetadataResolvedType -> { return "ClassMetadata<" + typeName(metadata.classType) + ">" }
    reflection: MethodReflectionResolvedType -> { return "MethodReflection<" + typeName(reflection.classType) + ">" }
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
    leftSet: SetResolvedType -> {
      case right {
        rightSet: SetResolvedType -> {
          return leftSet.readonly_ == rightSet.readonly_ && sameType(leftSet.elementType, rightSet.elementType)
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
    leftWeak: WeakResolvedType -> {
      case right {
        rightWeak: WeakResolvedType -> { return sameType(leftWeak.inner, rightWeak.inner) }
        _ -> { return false }
      }
    }
    leftActor: ActorType -> {
      case right {
        rightActor: ActorType -> { return sameType(leftActor.innerClass, rightActor.innerClass) }
        _ -> { return false }
      }
    }
    leftPromise: PromiseType -> {
      case right {
        rightPromise: PromiseType -> { return sameType(leftPromise.valueType, rightPromise.valueType) }
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
    valueSet: SetResolvedType -> {
      case target {
        targetSet: SetResolvedType -> {
          if targetSet.readonly_ != valueSet.readonly_ { return false }
          return sameType(valueSet.elementType, targetSet.elementType)
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
    valueWeak: WeakResolvedType -> {
      case target {
        targetWeak: WeakResolvedType -> { return isAssignable(valueWeak.inner, targetWeak.inner) }
        _ -> { }
      }
    }
    valueActor: ActorType -> {
      case target {
        targetActor: ActorType -> { return sameType(valueActor.innerClass, targetActor.innerClass) }
        _ -> { }
      }
    }
    valuePromise: PromiseType -> {
      case target {
        targetPromise: PromiseType -> { return isAssignable(valuePromise.valueType, targetPromise.valueType) }
        _ -> { }
      }
    }
    _: JsonValueResolvedType -> {
      if sameType(value, target) { return true }
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
    array: ArrayResolvedType -> { return isJsonValueType(array.elementType) }
    map: MapResolvedType -> { return sameType(map.keyType, primitive("string")) && isJsonValueType(map.valueType) }
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

/** Hash collections deliberately support only stable primitive and enum keys. */
export function isSupportedHashCollectionType(type_: ResolvedType): bool {
  case type_ {
    primitive_: PrimitiveType -> {
      return primitive_.name == "byte" || primitive_.name == "string" || primitive_.name == "int" || primitive_.name == "long" ||
        primitive_.name == "char" || primitive_.name == "bool"
    }
    _: EnumType -> { return true }
    _: TypeParameterType -> { return true }
    _: UnknownType -> { return true }
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
    weak_: WeakType -> { return weakType(typeFromAnnotation(weak_.type_)) }
  }
  return unknownType()
}
