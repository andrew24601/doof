// Contextual array and object literal inference.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, SetResolvedType, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType,
} from "./semantic"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ArrayLiteral, ArrayType, AsExpression, AssignmentExpression, AstLocation, BinaryExpression, Block,
  BoolLiteral, CallExpression, CallerExpression, CharLiteral, ClassDeclaration, ClassField, ConstructExpression,
  ConstDeclaration, ContinueStatement, DestructuringStatement, DoubleLiteral,
  DotShorthand, EnumDeclaration, ExportDeclaration, ExportList, Expression, ExpressionStatement,
  FloatLiteral, ForOfStatement, ForStatement, FunctionDeclaration, AstFunctionType,
  IfExpression, IfStatement, ImmutableBinding, Identifier, ImportDeclaration,
  IndexExpression, IntLiteral, InterfaceDeclaration, LetDeclaration,
  LambdaExpression, LongLiteral, MemberExpression, NamedType, NullLiteral,
  NamedImport, NamespaceImport, ObjectLiteral, ObjectProperty, Program,
  ReadonlyDeclaration, ReturnStatement, SourceSpan, Statement, StringLiteral,
  ThisExpression, TupleLiteral, TypeAliasDeclaration, TypeAnnotation,
  UnaryExpression, UnionType, WhileStatement, WithBinding, WithStatement, BreakStatement,
  YieldStatement, CaseArm, CaseExpression, CasePattern, CaseStatement, TypePattern, ValuePattern, WildcardPattern,
  TryStatement,
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter,
} from "./ast"
import {
  actorType, applyDeepReadonly, arrayType, classType, enumType, functionType, interfaceType, isAssignable, isNumeric, joinTypes,
  isJsonValueType, isSupportedHashCollectionType, jsonObjectType, jsonValueType, mapType, resultType, setType, streamType,
  nullType, numericResult, primitive, promiseType, sameType, tupleType, typeName, unionType,
  substituteTypeParams, typeParameter, unknownType, voidType,
} from "./checker-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization } from "./json-semantics"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"


import { CheckerState } from "./checker-state"
import { checkExpression } from "./checker-expressions"
import { memberType } from "./checker-resolution"
import { finish, typeError } from "./checker-common"
import { optionalResolvedType, hasObjectProperty, lookup, declarationFor } from "./checker-symbols"
import { findClassField } from "./checker-interfaces"

// Bare Map/Set annotations are declaration-local inference requests. Keep the
// literal inspection here so contextual literal typing and collection
// finalization share one owner in the self-hosted checker.
export function checkOmittedCollectionLiteral(state: CheckerState, annotation: TypeAnnotation, expression: Expression, scope: Scope): ResolvedType | null {
  case annotation {
    named: NamedType -> {
      if named.typeArgs.length != 0 { return null }
      if named.name == "Set" || named.name == "ReadonlySet" {
        case expression {
          array: ArrayLiteral -> {
            if array.elements.length == 0 {
              typeError(state, "Cannot infer " + named.name + " element type from an empty set literal; provide a full " + named.name + "<T> annotation", array.span)
              return finish(state, expression, setType(unknownType(), named.name == "ReadonlySet"))
            }
            inferred := checkArray(state, array, scope, null)
            case inferred {
              arrayType_: ArrayResolvedType -> {
                let hasConcreteElement = true
                case arrayType_.elementType {
                  _: UnknownType -> { hasConcreteElement = false; typeError(state, "Cannot infer " + named.name + " element type from this set literal; provide a full " + named.name + "<T> annotation", array.span) }
                  _: UnionResolvedType -> { hasConcreteElement = false; typeError(state, "Cannot infer " + named.name + " element type from heterogeneous set elements; provide a full " + named.name + "<T> annotation", array.span) }
                  _ -> { }
                }
                if hasConcreteElement && !isSupportedHashCollectionType(arrayType_.elementType) {
                  typeError(state, "Set element type \"" + typeName(arrayType_.elementType) + "\" is not supported; set elements must be byte, string, int, long, char, bool, or enum", array.span)
                }
                return finish(state, expression, setType(arrayType_.elementType, named.name == "ReadonlySet"))
              }
              _ -> { return finish(state, expression, setType(unknownType(), named.name == "ReadonlySet")) }
            }
          }
          _ -> {
            checkExpression(state, expression, scope, null)
            typeError(state, "Omitted type arguments for " + named.name + " require a same-site non-empty set literal", expression.span)
            return setType(unknownType(), named.name == "ReadonlySet")
          }
        }
      }
      if named.name == "Map" || named.name == "ReadonlyMap" {
        case expression {
          object: ObjectLiteral -> {
            if object.properties.length == 0 {
              typeError(state, "Cannot infer " + named.name + " type arguments from an empty map literal; provide a full " + named.name + "<K, V> annotation", object.span)
              return finish(state, expression, mapType(unknownType(), unknownType(), named.name == "ReadonlyMap"))
            }
            let valueType = unknownType()
            for property of object.properties {
              let propertyType = unknownType()
              if property.value != null { propertyType = checkExpression(state, property.value!, scope, null) }
              else {
                binding := lookup(scope, property.name)
                if binding == null { typeError(state, "Unknown shorthand property '" + property.name + "'", property.span) }
                else { propertyType = binding!.type_ }
              }
              property.resolvedType = optionalResolvedType(propertyType)
              valueType = joinTypes(valueType, propertyType)
            }
            case valueType {
              _: UnknownType -> { typeError(state, "Cannot infer " + named.name + " type arguments from this map literal; provide a full " + named.name + "<K, V> annotation", object.span) }
              _: UnionResolvedType -> { typeError(state, "Cannot infer " + named.name + " value type from heterogeneous map values; provide a full " + named.name + "<K, V> annotation", object.span) }
              _ -> { }
            }
            return finish(state, expression, mapType(primitive("string"), valueType, named.name == "ReadonlyMap"))
          }
          _ -> {
            checkExpression(state, expression, scope, null)
            typeError(state, "Omitted type arguments for " + named.name + " require a same-site non-empty map literal", expression.span)
            return mapType(unknownType(), unknownType(), named.name == "ReadonlyMap")
          }
        }
      }
    }
    _ -> { }
  }
  return null
}

export function checkArray(state: CheckerState, expression: ArrayLiteral, scope: Scope, expected: ResolvedType | null): ResolvedType {
  if expected != null {
    case expected! {
      _: JsonValueResolvedType -> {
        for item of expression.elements {
          actual := checkExpression(state, item, scope, optionalResolvedType(jsonValueType()))
          if !isAssignable(actual, jsonValueType()) { typeError(state, "Cannot assign " + typeName(actual) + " to JsonValue", item.span) }
        }
        return finish(state, expression, expected!)
      }
      union_: UnionResolvedType -> {
        if containsJsonValue(state, union_) {
          for item of expression.elements {
            actual := checkExpression(state, item, scope, optionalResolvedType(jsonValueType()))
            if !isAssignable(actual, jsonValueType()) { typeError(state, "Cannot assign " + typeName(actual) + " to JsonValue", item.span) }
          }
          return finish(state, expression, jsonValueType())
        }
      }
      _ -> { }
    }
  }
  if expression.elements.length == 0 && expected != null {
    case expected! {
      _: ArrayResolvedType -> { return finish(state, expression, expected!) }
      _: SetResolvedType -> { return finish(state, expression, expected!) }
      _ -> { }
    }
  }
  let expectedElement: ResolvedType | null = null
  if expected != null {
    case expected! {
      array: ArrayResolvedType -> { expectedElement = array.elementType }
      set: SetResolvedType -> { expectedElement = set.elementType }
      _ -> { }
    }
  }
  if expectedElement != null {
    for item of expression.elements {
      actual := checkExpression(state, item, scope, optionalResolvedType(expectedElement!))
      if !isAssignable(actual, expectedElement!) { typeError(state, "Cannot assign " + typeName(actual) + " to " + typeName(expectedElement!), item.span) }
    }
    case expected! {
      array: ArrayResolvedType -> { return finish(state, expression, arrayType(expectedElement!, array.readonly_)) }
      set: SetResolvedType -> { return finish(state, expression, setType(expectedElement!, set.readonly_)) }
      _ -> { }
    }
  }
  let element = unknownType()
  for item of expression.elements { element = joinTypes(element, checkExpression(state, item, scope, null)) }
  return finish(state, expression, arrayType(element, expression.readonly_))
}

export function checkObject(state: CheckerState, expression: ObjectLiteral, scope: Scope, expected: ResolvedType | null): ResolvedType {
  if expected != null {
    case expected! {
      result: ResultResolvedType -> {
        let recognized = 0
        let hasValue = false
        let hasError = false
        for property of expression.properties {
          let propertyExpected: ResolvedType | null = null
          if property.name == "value" { recognized = recognized + 1; hasValue = true; propertyExpected = result.valueType }
          else if property.name == "error" { recognized = recognized + 1; hasError = true; propertyExpected = result.errorType }
          if property.value != null {
            property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, propertyExpected))
          } else {
            binding := lookup(scope, property.name)
            if binding == null { typeError(state, "Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
            else { property.resolvedType = optionalResolvedType(binding!.type_) }
          }
          if propertyExpected != null && !isAssignable(property.resolvedType!, propertyExpected!) {
            typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(propertyExpected!), property.span)
          }
        }
        if hasValue && hasError { typeError(state, "Result object literal must contain either a 'value' field or an 'error' field, but not both", expression.span) }
        else if !hasValue && !hasError { typeError(state, "Result object literal must contain a 'value' field or an 'error' field", expression.span) }
        else if recognized != expression.properties.length { typeError(state, "Result object literal only supports 'value' and 'error' fields", expression.span) }
        return finish(state, expression, result)
      }
      class_: ClassType -> {
        declaration := declarationFor(state.result, class_.symbol)
        if declaration != null {
          case declaration! {
            classDeclaration: ClassDeclaration -> {
              expression.resolvedClass = classDeclaration
              for property of expression.properties {
                field := findClassField(classDeclaration.fields, property.name)
                if field == null || field!.static_ || field!.const_ {
                  typeError(state, "Unknown field '" + property.name + "' for " + class_.name, property.span)
                  continue
                }
                fieldType := memberType(state, class_, property.name, property.span)
                if property.value != null { property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, optionalResolvedType(fieldType))) }
                else {
                  binding := lookup(scope, property.name)
                  if binding == null { typeError(state, "Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
                  else { property.resolvedType = optionalResolvedType(binding!.type_) }
                }
                if !isAssignable(property.resolvedType!, fieldType) { typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(fieldType), property.span) }
              }
              for field of classDeclaration.fields {
                if field.static_ || field.const_ { continue }
                for name of field.names {
                  if field.defaultValue == null && !hasObjectProperty(expression.properties, name) { typeError(state, "Missing required field '" + name + "'", expression.span) }
                }
              }
              return finish(state, expression, class_)
            }
            _ -> { }
          }
        }
      }
      _ -> { }
    }
  }
  let expectedValue: ResolvedType | null = null
  if expected != null {
    case expected! {
      _: JsonValueResolvedType -> { expectedValue = jsonValueType() }
      union_: UnionResolvedType -> {
        if containsJsonValue(state, union_) { expectedValue = jsonValueType() }
      }
      map: MapResolvedType -> {
        if expression.properties.length > 0 && !sameType(map.keyType, primitive("string")) { typeError(state, "Object literal keys must be strings", expression.span) }
        expectedValue = map.valueType
      }
      _ -> { }
    }
  }
  for property of expression.properties {
    if property.value != null {
      property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, expectedValue))
      if expectedValue != null && !isAssignable(property.resolvedType!, expectedValue!) {
        typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expectedValue!), property.span)
      }
    }
  }
  if expected != null {
    case expected! {
      _: JsonValueResolvedType -> { return finish(state, expression, expected!) }
      union_: UnionResolvedType -> { if containsJsonValue(state, union_) { return finish(state, expression, jsonValueType()) } }
      _: MapResolvedType -> { return finish(state, expression, expected!) }
      _ -> { }
    }
  }
  return finish(state, expression, mapType(primitive("string"), jsonValueType()))
}

export function containsJsonValue(state: CheckerState, union_: UnionResolvedType): bool {
  for member of union_.types { if isJsonValueType(member) { return true } }
  return false
}
