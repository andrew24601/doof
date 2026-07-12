// Resolved-type utilities shared by the self-hosted checker.

import {
  ArrayResolvedType, ClassType, EnumType, FunctionParamType, FunctionType,
  InterfaceType,
  NullType, PrimitiveType, ResolvedType, Symbol, TupleResolvedType,
  UnionResolvedType, UnknownType, VoidType,
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

export function tupleType(elements: ResolvedType[]): ResolvedType {
  return TupleResolvedType { elements }
}

export function unionType(types: ResolvedType[]): ResolvedType {
  let members: ResolvedType[] = []
  for memberType of types {
    case memberType {
      union: UnionResolvedType -> {
        for member of union.types { members.push(member) }
      }
      _ -> { members.push(memberType) }
    }
  }
  if members.length == 0 { return unknownType() }
  if members.length == 1 { return members[0] }
  return UnionResolvedType { types: members }
}

export function functionType(params: FunctionParamType[], returnType: ResolvedType): ResolvedType {
  return FunctionType { params, returnType }
}

export function classType(name: string, symbol: Symbol): ClassType {
  return ClassType { name, symbol }
}

export function enumType(name: string, symbol: Symbol): EnumType {
  return EnumType { name, symbol }
}

export function interfaceType(name: string, symbol: Symbol): InterfaceType {
  return InterfaceType { name, symbol }
}

export function typeName(resolvedType: ResolvedType): string {
  case resolvedType {
    primitive_: PrimitiveType -> { return primitive_.name }
    class_: ClassType -> { return class_.name }
    function_: FunctionType -> { return "function" }
    array: ArrayResolvedType -> { return (if array.readonly_ then "readonly " else "") + typeName(array.elementType) + "[]" }
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
          if targetArray.readonly_ == false && valueArray.readonly_ == true { return false }
          return isAssignable(valueArray.elementType, targetArray.elementType)
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  if sameType(value, target) { return true }
  case target {
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
