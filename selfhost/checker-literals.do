// Contextual array and object literal inference.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, Symbol,
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
  isJsonValueType, jsonObjectType, jsonValueType, mapType, resultType, streamType,
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
      _ -> { }
    }
  }
  let expectedElement: ResolvedType | null = null
  if expected != null {
    case expected! {
      array: ArrayResolvedType -> { expectedElement = array.elementType }
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
                if field == null || field!.static_ {
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
                if field.static_ { continue }
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
        if !sameType(map.keyType, primitive("string")) { typeError(state, "Object literal keys must be strings", expression.span) }
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
