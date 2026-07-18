// Call, lambda, construction, generic-call, and actor-boundary checking.

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
import { checkBlock } from "./checker-statements"
import { checkExpression } from "./checker-expressions"
import { resolveType, memberType, validateTypeArgumentConstraints } from "./checker-resolution"
import { finish, typeError } from "./checker-common"
import { decorateAnnotationWithResolved, optionalResolvedType, functionParameterIndex, containsString, hasObjectProperty, methodSignature, declare, lookup, isBuiltinPrintlnCall, symbolFor, declarationFor } from "./checker-symbols"
import { inferTypeArgument, functionDeclarationForCallee, constructorForClass, insideConstructorFactory } from "./checker-generics"
import { classModuleFor } from "./checker-interfaces"
import { checkerSemanticSpan } from "./checker-validation"

export function checkCall(state: CheckerState, expression: CallExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
  case expression.callee {
    identifier: Identifier -> {
      if identifier.name == "Success" || identifier.name == "Failure" {
        let expectedResult: ResultResolvedType | null = null
        if expected != null {
          case expected! {
            result: ResultResolvedType -> { expectedResult = result }
            _ -> { }
          }
        }
        let valueType: ResolvedType = unknownType()
        if expression.args.length > 0 {
          let expectedValue: ResolvedType | null = null
          if expectedResult != null { expectedValue = if identifier.name == "Success" then expectedResult!.valueType else expectedResult!.errorType }
          valueType = checkExpression(state, expression.args[0].value, scope, expectedValue)
        }
        if expectedResult != null {
          valueType = if expression.args.length == 0 then (if identifier.name == "Success" then expectedResult!.valueType else expectedResult!.errorType) else valueType
          identifier.resolvedType = optionalResolvedType(functionType([FunctionParamType { name: "value", type_: valueType, hasDefault: false }], expectedResult!))
          identifier.resolvedBinding = Binding { name: identifier.name, kind: "builtin", type_: functionType([FunctionParamType { name: "value", type_: valueType, hasDefault: false }], expectedResult!), mutable: false, span: checkerSemanticSpan(identifier.span), module: state.info!.path }
          return finish(state, expression, expectedResult!)
        }
        typeError(state, identifier.name + " requires an expected Result type", identifier.span)
        if identifier.name == "Success" { return finish(state, expression, resultType(valueType, unknownType())) }
        return finish(state, expression, resultType(unknownType(), valueType))
      }
    }
    _ -> { }
  }
  calleeType := checkExpression(state, expression.callee, scope, null)
  expression.resolvedFunction = functionDeclarationForCallee(expression.callee, calleeType, state.result)
  case calleeType {
    resolvedFunction: FunctionType -> {
      let effectiveFunction: FunctionType = resolvedFunction
      if expression.typeArgs.length > 0 {
        if expression.typeArgs.length != resolvedFunction.typeParams.length {
          typeError(state, 
            "Generic call requires " + string(resolvedFunction.typeParams.length) + " type argument" + (if resolvedFunction.typeParams.length == 1 then "" else "s") + "; received " + string(expression.typeArgs.length),
            expression.span,
          )
        } else {
          let resolvedTypeArgs: ResolvedType[] = []
          for argument of expression.typeArgs { resolvedTypeArgs.push(resolveType(state, argument, state.info!, scope)) }
          expression.resolvedGenericTypeArgs = resolvedTypeArgs
          applyTypeArgumentConstraints(state, expression.resolvedFunction, resolvedTypeArgs, expression.span, scope)
          substituted := substituteTypeParams(resolvedFunction, resolvedFunction.typeParams, resolvedTypeArgs)
          case substituted {
            function_: FunctionType -> { effectiveFunction = function_ }
            _ -> { }
          }
        }
      } else if resolvedFunction.typeParams.length > 0 {
        let inferred: ResolvedType[] = []
        let complete = true
        for typeParam of resolvedFunction.typeParams {
          let inferredType: ResolvedType | null = null
          for i of 0..<expression.args.length {
            if i >= resolvedFunction.params.length { continue }
            // Unresolved type parameters still carry useful callback input
            // types, which are required to type shorthand lambda bindings.
            actual := checkExpression(state, expression.args[i].value, scope, resolvedFunction.params[i].type_)
            candidate := inferTypeArgument(resolvedFunction.params[i].type_, actual, typeParam)
            if candidate != null {
              if inferredType == null { inferredType = candidate }
              else if sameType(inferredType!, candidate!) { }
              else if isAssignable(candidate!, inferredType!) { }
              else if isAssignable(inferredType!, candidate!) { inferredType = candidate }
              else { complete = false }
            }
          }
          if inferredType == null { complete = false; inferred.push(typeParameter(typeParam)) }
          else { inferred.push(inferredType!) }
        }
        if complete {
          expression.resolvedGenericTypeArgs = inferred
          applyTypeArgumentConstraints(state, expression.resolvedFunction, inferred, expression.span, scope)
          substituted := substituteTypeParams(resolvedFunction, resolvedFunction.typeParams, inferred)
          case substituted {
            function_: FunctionType -> { effectiveFunction = function_ }
            _ -> { }
          }
        }
      }
      let named = false
      for argument of expression.args { if argument.name != null { named = true } }
      if named {
        let used: string[] = []
        for argument of expression.args {
          if argument.name == null {
            typeError(state, "Named calls cannot contain positional arguments", argument.span)
            checkExpression(state, argument.value, scope, null)
            continue
          }
          index := functionParameterIndex(effectiveFunction.params, argument.name!)
          if index < 0 {
            typeError(state, "Unknown named argument '" + argument.name! + "'", argument.span)
            checkExpression(state, argument.value, scope, null)
            continue
          }
          if containsString(used, argument.name!) { typeError(state, "Duplicate named argument '" + argument.name! + "'", argument.span) }
          used.push(argument.name!)
          expected := effectiveFunction.params[index].type_
          actual := checkExpression(state, argument.value, scope, optionalResolvedType(expected))
          if !isAssignable(actual, expected) { typeError(state, "Argument '" + argument.name! + "' has type " + typeName(actual) + "; expected " + typeName(expected), argument.span) }
        }
        for parameter of effectiveFunction.params {
          if !parameter.hasDefault && !containsString(used, parameter.name) {
            typeError(state, "Missing required argument '" + parameter.name + "'", expression.span)
          }
        }
      } else {
        let requiredCount = 0
        for parameter of effectiveFunction.params { if !parameter.hasDefault { requiredCount = requiredCount + 1 } }
        if expression.args.length < requiredCount || expression.args.length > effectiveFunction.params.length {
          range := if requiredCount == effectiveFunction.params.length then string(requiredCount) else string(requiredCount) + "-" + string(effectiveFunction.params.length)
          typeError(state, "Expected " + range + " argument(s) but got " + string(expression.args.length), expression.span)
        }
        for i of 0..<expression.args.length {
          expected := if i < effectiveFunction.params.length then effectiveFunction.params[i].type_ else unknownType()
          let argumentExpected: ResolvedType | null = expected
          if isBuiltinPrintlnCall(expression.callee) { argumentExpected = null }
          actual := checkExpression(state, expression.args[i].value, scope, argumentExpected)
          if !isAssignable(actual, expected) { typeError(state, "Argument " + string(i + 1) + " has type " + typeName(actual) + "; expected " + typeName(expected), expression.args[i].span) }
        }
      }
      validateActorMethodBoundary(state, expression, effectiveFunction)
      return finish(state, expression, effectiveFunction.returnType)
    }
    class_: ClassType -> {
      let effectiveClass = class_
      declaration := declarationFor(state.result, class_.symbol)
      if declaration != null && class_.typeArgs.length == 0 {
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            inferred := inferClassTypeArguments(state, expression, scope, class_, classDeclaration)
            if inferred.length == classDeclaration.typeParams.length && inferred.length > 0 {
              effectiveClass = classType(class_.name, class_.symbol, inferred)
              expression.resolvedGenericTypeArgs = inferred
              validateTypeArgumentConstraints(state, classDeclaration.typeParams, classDeclaration.typeParamConstraints, inferred, expression.span, classModuleFor(state.result, class_.symbol), scope)
            }
          }
          _ -> { }
        }
      }
      if !insideConstructorFactory(scope, effectiveClass) { expression.resolvedConstructor = constructorForClass(effectiveClass, state.result) }
      constructorMethod := expression.resolvedConstructor
      if constructorMethod != null {
        let constructorType = constructorMethod!.resolvedType ?? methodSignature(constructorMethod!, classModuleFor(state.result, class_.symbol), state.result)
        if declaration != null {
          case declaration! {
            classDeclaration: ClassDeclaration -> { constructorType = substituteTypeParams(constructorType, classDeclaration.typeParams, effectiveClass.typeArgs) }
            _ -> { }
          }
        }
        case constructorType {
          function_: FunctionType -> {
            validatePositionalConstructorArguments(state, expression, function_.params, scope, effectiveClass)
            return finish(state, expression, function_.returnType)
          }
          _ -> { }
        }
      }
      let constructorParams: FunctionParamType[] = []
      if declaration != null {
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            expression.resolvedClass = classDeclaration
            for field of classDeclaration.fields {
              if field.static_ || field.const_ { continue }
              for name of field.names {
                constructorParams.push(FunctionParamType {
                  name,
                  type_: memberType(state, effectiveClass, name, field.span),
                  hasDefault: field.defaultValue != null,
                })
              }
            }
          }
          _ -> { }
        }
      }
      validatePositionalConstructorArguments(state, expression, constructorParams, scope, effectiveClass)
      return finish(state, expression, effectiveClass)
    }
    _: UnknownType -> {
      for argument of expression.args { checkExpression(state, argument.value, scope, null) }
      return finish(state, expression, unknownType())
    }
    _ -> { typeError(state, "Expression of type " + typeName(calleeType) + " is not callable", expression.span); return finish(state, expression, unknownType()) }
  }
  return finish(state, expression, unknownType())
}

function inferClassTypeArguments(state: CheckerState, expression: CallExpression, scope: Scope, class_: ClassType, declaration: ClassDeclaration): ResolvedType[] {
  let patterns: FunctionParamType[] = []
  constructor := constructorForClass(class_, state.result)
  if constructor != null {
    signature := constructor!.resolvedType ?? methodSignature(constructor!, classModuleFor(state.result, class_.symbol), state.result)
    case signature {
      function_: FunctionType -> { patterns = function_.params }
      _ -> { }
    }
  } else {
    for field of declaration.fields {
      if field.static_ { continue }
      for name of field.names {
        patterns.push(FunctionParamType { name, type_: memberType(state, class_, name, field.span), hasDefault: field.defaultValue != null })
      }
    }
  }
  let inferred: ResolvedType[] = []
  for typeParam of declaration.typeParams {
    let candidate: ResolvedType | null = null
    for index of 0..<expression.args.length {
      parameterIndex := if expression.args[index].name == null then index else functionParameterIndex(patterns, expression.args[index].name!)
      if parameterIndex < 0 || parameterIndex >= patterns.length { continue }
      actual := checkExpression(state, expression.args[index].value, scope, optionalResolvedType(patterns[parameterIndex].type_))
      next := inferTypeArgument(patterns[parameterIndex].type_, actual, typeParam)
      if next != null { candidate = next }
    }
    if candidate == null { return [] }
    inferred.push(candidate!)
  }
  return inferred
}

function applyTypeArgumentConstraints(state: CheckerState, declaration: FunctionDeclaration | null, arguments: ResolvedType[], span: SourceSpan, scope: Scope): void {
  if declaration == null { return }
  validateTypeArgumentConstraints(state, declaration!.typeParams, declaration!.typeParamConstraints, arguments, span, state.info!, scope)
}

// Positional class calls share function-call assignability rules, but report
// the nominal constructor range so invalid calls never reach C++ emission.
export function validatePositionalConstructorArguments(state: CheckerState, expression: CallExpression, params: FunctionParamType[], scope: Scope, class_: ClassType): void {
  let requiredCount = 0
  for parameter of params { if !parameter.hasDefault { requiredCount = requiredCount + 1 } }
  if expression.args.length < requiredCount || expression.args.length > params.length {
    range := if requiredCount == params.length then string(requiredCount) else string(requiredCount) + "-" + string(params.length)
    kind := if class_.symbol.kind == "struct" then "Struct" else "Class"
    typeError(state, kind + " \"" + class_.name + "\" expects " + range + " constructor argument(s) but got " + string(expression.args.length), expression.span)
  }
  for i of 0..<expression.args.length {
    let expected: ResolvedType | null = null
    if i < params.length { expected = params[i].type_ }
    actual := checkExpression(state, expression.args[i].value, scope, expected)
    if expected != null && !isAssignable(actual, expected!) {
      typeError(state, "Argument " + string(i + 1) + " has type " + typeName(actual) + "; expected " + typeName(expected!), expression.args[i].span)
    }
  }
}

// Actor calls validate the effective method signature after generic
// substitution; ordinary calls on the same class remain local calls.
export function validateActorMethodBoundary(state: CheckerState, expression: CallExpression, method: FunctionType): void {
  let actor: ActorType | null = null
  case expression.callee {
    member: MemberExpression -> {
      if member.object.resolvedType != null {
        case member.object.resolvedType! {
          actorType_: ActorType -> { actor = actorType_ }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  if actor == null { return }
  for parameter of method.params {
    violation := findActorBoundaryViolation(state.result, parameter.type_)
    if violation != null {
      typeError(state, 
        "Actor method parameter \"" + parameter.name + "\" of type \"" + typeName(parameter.type_) + "\" cannot cross actor boundary for \"" + typeName(actor!) + "\": " + violation!.reason,
        expression.span,
      )
    }
  }
  returnViolation := findActorBoundaryViolation(state.result, method.returnType)
  if returnViolation != null {
    typeError(state, 
      "Actor method return type \"" + typeName(method.returnType) + "\" cannot cross actor boundary for \"" + typeName(actor!) + "\": " + returnViolation!.reason,
      expression.span,
    )
  }
}

export function checkLambda(state: CheckerState, expression: LambdaExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
  let expectedFunction: FunctionType | null = null
  if expected != null {
    case expected! {
      resolvedFunction: FunctionType -> { expectedFunction = resolvedFunction }
      _ -> { }
    }
  }
  // `=> body` inherits the complete callback signature. Materializing those
  // parameters on the decorated AST keeps checking, generic inference,
  // capture analysis, and C++ emission aligned on the same representation.
  if expression.parameterless && expression.params.length == 0 && expectedFunction != null {
    for expectedParameter of expectedFunction!.params {
      expression.params.push(Parameter {
        name: expectedParameter.name,
        type_: null,
        defaultValue: null,
        resolvedType: expectedParameter.type_,
        span: expression.span,
      })
    }
  }
  lambdaScope := Scope { parent: scope }
  let params: FunctionParamType[] = []
  for i of 0..<expression.params.length {
    parameter := expression.params[i]
    parameterType := if parameter.type_ == null then if expectedFunction != null && i < expectedFunction!.params.length then expectedFunction!.params[i].type_ else unknownType() else resolveType(state, parameter.type_!, state.info!, lambdaScope)
    parameter.resolvedType = optionalResolvedType(parameterType)
    params.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
    declare(lambdaScope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: checkerSemanticSpan(parameter.span), module: state.info!.path })
  }
  let returnType = if expectedFunction == null then unknownType() else expectedFunction!.returnType
  if expression.returnType != null {
    returnType = resolveType(state, expression.returnType!, state.info!, lambdaScope)
    decorateAnnotationWithResolved(expression.returnType!, returnType)
  }
  // A block lambda is its own return target. Without this scope boundary,
  // returns inside an escaping closure are checked against the enclosing
  // function's return type.
  lambdaScope.returnType = returnType
  case expression.body {
    block: Block -> { checkBlock(state, block, lambdaScope) }
    expressionBody: Expression -> { returnType = checkExpression(state, expressionBody, lambdaScope, optionalResolvedType(returnType)) }
  }
  return finish(state, expression, functionType(params, returnType))
}

export function checkConstruct(state: CheckerState, expression: ConstructExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
  if expression.type_ == "Success" || expression.type_ == "Failure" {
    let expectedResult: ResultResolvedType | null = null
    if expected != null {
      case expected! {
        result: ResultResolvedType -> { expectedResult = result }
        _ -> { }
      }
    }
    let valueType: ResolvedType = unknownType()
    for property of expression.args {
      if property.value != null {
        let propertyExpected: ResolvedType | null = null
        if expectedResult != null {
          propertyExpected = if expression.type_ == "Success" then expectedResult!.valueType else expectedResult!.errorType
        }
        valueType = checkExpression(state, property.value!, scope, propertyExpected)
        property.resolvedType = optionalResolvedType(valueType)
      }
    }
    if expectedResult != null { return finish(state, expression, expectedResult!) }
    if expression.type_ == "Success" { return finish(state, expression, resultType(valueType, unknownType())) }
    return finish(state, expression, resultType(unknownType(), valueType))
  }
  symbol := symbolFor(state.info!, expression.type_)
  if symbol == null { typeError(state, "Unknown constructed type '" + expression.type_ + "'", expression.span); return finish(state, expression, unknownType()) }
  declaration := declarationFor(state.result, symbol!)
  if declaration != null {
    case declaration! {
      classDeclaration: ClassDeclaration -> { expression.resolvedClass = classDeclaration }
      _ -> { }
    }
  }
  let resolvedTypeArgs: ResolvedType[] = []
  for argument of expression.typeArgs { resolvedTypeArgs.push(resolveType(state, argument, state.info!, scope)) }
  if expression.resolvedClass != null {
    validateTypeArgumentConstraints(state, expression.resolvedClass!.typeParams, expression.resolvedClass!.typeParamConstraints, resolvedTypeArgs, expression.span, classModuleFor(state.result, symbol!), scope)
  }
  constructed := classType(expression.type_, symbol!, resolvedTypeArgs)
  expression.resolvedConstructedType = optionalResolvedType(constructed)
  constructorMethod := constructorForClass(constructed, state.result)
  if constructorMethod != null && !insideConstructorFactory(scope, constructed) {
    expression.resolvedConstructor = constructorMethod
    constructorType := constructorMethod!.resolvedType ?? methodSignature(constructorMethod!, classModuleFor(state.result, symbol!), state.result)
    case constructorType {
      function_: FunctionType -> {
        for property of expression.args {
          parameterIndex := functionParameterIndex(function_.params, property.name)
          if parameterIndex < 0 {
            typeError(state, "Unknown named argument '" + property.name + "'", property.span)
            if property.value != null { property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, null)) }
            continue
          }
          parameterType := function_.params[parameterIndex].type_
          if property.value != null {
            property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, optionalResolvedType(parameterType)))
          } else {
            binding := lookup(scope, property.name)
            if binding == null { typeError(state, "Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
            else { property.resolvedType = optionalResolvedType(binding!.type_) }
          }
          if !isAssignable(property.resolvedType!, parameterType) {
            typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(parameterType), property.span)
          }
        }
        for parameter of function_.params {
          if !parameter.hasDefault && !hasObjectProperty(expression.args, parameter.name) {
            typeError(state, "Missing required argument '" + parameter.name + "'", expression.span)
          }
        }
        return finish(state, expression, function_.returnType)
      }
      _ -> { }
    }
  }
  for property of expression.args {
    expected := memberType(state, constructed, property.name, property.span)
    if property.value != null {
        property.resolvedType = optionalResolvedType(checkExpression(state, property.value!, scope, optionalResolvedType(expected)))
      if !isAssignable(property.resolvedType!, expected) {
        typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expected), property.span)
      }
    } else {
      binding := lookup(scope, property.name)
      if binding == null {
        typeError(state, "Unknown shorthand property '" + property.name + "'", property.span)
      } else {
        property.resolvedType = optionalResolvedType(binding!.type_)
        if !isAssignable(property.resolvedType!, expected) {
          typeError(state, "Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expected), property.span)
        }
      }
    }
  }
  return finish(state, expression, constructed)
}

export function callableField(state: CheckerState, objectType: ResolvedType, property: string): bool {
  let symbol: Symbol | null = null
  case objectType {
    class_: ClassType -> { symbol = class_.symbol }
    interface_: InterfaceType -> { symbol = interface_.symbol }
    _ -> { return false }
  }
  declaration := declarationFor(state.result, symbol!)
  if declaration == null { return false }
  case declaration! {
    class_: ClassDeclaration -> {
      for field of class_.fields {
        for name of field.names { if name == property { return true } }
      }
    }
    interface_: InterfaceDeclaration -> {
      for field of interface_.fields { if field.name == property { return true } }
    }
    _ -> { }
  }
  return false
}
