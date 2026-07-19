// Statement, declaration, scope, and control-flow checking.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, SetResolvedType, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType, ResolvedTypeConstraint,
} from "./semantic"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ArrayLiteral, ArrayType, AsExpression, AssignmentExpression, AstLocation, BinaryExpression, Block,
  BoolLiteral, CallExpression, CallerExpression, CharLiteral, ClassDeclaration, ClassField, ConstructExpression,
  ConstDeclaration, ContinueStatement, DestructuringStatement, DoubleLiteral,
  DotShorthand, EnumDeclaration, ExportDeclaration, ExportList, Expression, ExpressionStatement,
  FloatLiteral, ForOfStatement, ForStatement, FunctionDeclaration, AstFunctionType,
  IfExpression, IfStatement, ImmutableBinding, Identifier, ImportDeclaration, MockImportDirective,
  IndexExpression, IntLiteral, InterfaceDeclaration, LetDeclaration,
  LambdaExpression, LongLiteral, MemberExpression, NamedType, NullLiteral,
  NamedImport, NamespaceImport, ObjectLiteral, ObjectProperty, Program,
  ReadonlyDeclaration, ReturnStatement, SourceSpan, Statement, StringLiteral,
  ThisExpression, TupleLiteral, TypeAliasDeclaration, TypeAnnotation,
  UnaryExpression, UnionType, WhileStatement, WithBinding, WithStatement, BreakStatement,
  YieldStatement, YieldBlockExpression, YieldBlockAssignmentStatement, CaseArm, CaseExpression, CasePattern, CaseStatement, TypePattern, ValuePattern, WildcardPattern,
  TryStatement,
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter, TypeParameterConstraint,
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
import { checkCasePatterns, checkExpression, addClassMethods, nonNullType, hasNullMember } from "./checker-expressions"
import { checkOmittedCollectionLiteral } from "./checker-literals"
import { resolveType, memberType } from "./checker-resolution"
import { typeError, requireBool } from "./checker-common"
import { decorateAnnotationWithResolved, blockContainsLoopExit, optionalResolvedType, resolveAnnotation, declare, declareShadowing, lookup, returnScope, valueYieldScope, iterableElement, isPanicCall, symbolFor, declarationFor } from "./checker-symbols"
import { symbolSpan, addImplementedInterfaceType, classSatisfiesConcreteInterface } from "./checker-interfaces"
import { checkerSemanticSpan } from "./checker-validation"

export function checkStatement(state: CheckerState, statement: Statement, scope: Scope): bool {
  case statement {
    const_: ConstDeclaration -> { return checkValueDeclaration(state, const_, scope, "const", false) }
    readonly_: ReadonlyDeclaration -> { return checkValueDeclaration(state, readonly_, scope, "readonly", false) }
    binding: ImmutableBinding -> { return checkValueDeclaration(state, binding, scope, "immutable-binding", false) }
    let_: LetDeclaration -> { return checkValueDeclaration(state, let_, scope, "let", true) }
    fn: FunctionDeclaration -> { checkFunction(state, fn, scope, null); return true }
    class_: ClassDeclaration -> { checkClass(state, class_, scope); return true }
    interface_: InterfaceDeclaration -> { checkInterface(state, interface_, scope); return true }
    enum_: EnumDeclaration -> { checkEnum(state, enum_, scope); return true }
    alias: TypeAliasDeclaration -> {
      aliasScope := Scope { parent: scope }
      populateTypeParameters(state, aliasScope, alias.typeParams, alias.typeParamConstraints)
      resolvedAlias := resolveType(state, alias.type_, state.info!, aliasScope)
      alias.resolvedType = optionalResolvedType(resolvedAlias)
      return true
    }
    _: MockImportDirective -> { return true }
    if_: IfStatement -> {
      requireBool(state, checkExpression(state, if_.condition, scope, null), if_.condition.span)
      thenCompletes := checkBlock(state, if_.body, scope)
      let allComplete = thenCompletes
      for branch of if_.elseIfs {
        requireBool(state, checkExpression(state, branch.condition, scope, null), branch.condition.span)
        branchCompletes := checkBlock(state, branch.body, scope)
        allComplete = allComplete || branchCompletes
      }
      if if_.else_ == null { return true }
      elseCompletes := checkBlock(state, if_.else_!, scope)
      return allComplete || elseCompletes
    }
    case_: CaseStatement -> { return checkCase(state, case_, scope) }
    while_: WhileStatement -> {
      requireBool(state, checkExpression(state, while_.condition, scope, null), while_.condition.span)
      checkBlock(state, while_.body, scope)
      if while_.then_ != null { checkBlock(state, while_.then_!, scope) }
      case while_.condition {
        literal: BoolLiteral -> {
          if literal.value && !blockContainsLoopExit(while_.body) { return false }
        }
        _ -> { }
      }
      return true
    }
    for_: ForStatement -> {
      if for_.init != null { checkStatement(state, for_.init!, scope) }
      if for_.condition != null {
        condition := for_.condition!
        requireBool(state, checkExpression(state, condition, scope, null), condition.span)
      }
      for update of for_.update { checkExpression(state, update, scope, null) }
      checkBlock(state, for_.body, scope)
      if for_.then_ != null { checkBlock(state, for_.then_!, scope) }
      return true
    }
    forOf: ForOfStatement -> {
      iterable := checkExpression(state, forOf.iterable, scope, null)
      element := iterableElement(iterable)
      bodyScope := Scope { parent: scope }
      case element {
        tuple: TupleResolvedType -> {
          if tuple.elements.length == forOf.bindings.length {
            for i of 0..<forOf.bindings.length {
              name := forOf.bindings[i]
              if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: tuple.elements[i], mutable: false, span: checkerSemanticSpan(forOf.span), module: state.info!.path }) }
            }
          } else {
            for name of forOf.bindings { if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: element, mutable: false, span: checkerSemanticSpan(forOf.span), module: state.info!.path }) } }
          }
        }
        _ -> {
          for name of forOf.bindings { if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: element, mutable: false, span: checkerSemanticSpan(forOf.span), module: state.info!.path }) } }
        }
      }
      checkBlock(state, forOf.body, bodyScope)
      if forOf.then_ != null { checkBlock(state, forOf.then_!, scope) }
      return true
    }
    with_: WithStatement -> {
      bodyScope := Scope { parent: scope }
      for binding of with_.bindings {
        valueType := checkExpression(state, binding.value, bodyScope, null)
        declaredType := if binding.type_ == null then valueType else resolveType(state, binding.type_!, state.info!, scope)
        binding.resolvedType = optionalResolvedType(declaredType)
        if !isAssignable(valueType, declaredType) { typeError(state, "Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), binding.span) }
        declare(bodyScope, Binding { name: binding.name, kind: "with", type_: declaredType, mutable: false, span: checkerSemanticSpan(binding.span), module: state.info!.path })
      }
      checkBlock(state, with_.body, bodyScope)
      return true
    }
    return_: ReturnStatement -> { return checkReturn(state, return_, scope) }
    yield_: YieldStatement -> {
      target := valueYieldScope(scope)
      if target == null {
        typeError(state, "'yield' can only be used inside a value-producing block", yield_.span)
        checkExpression(state, yield_.value, scope, null)
        return false
      }
      expectedYield := target!.yieldType
      valueType := checkExpression(state, yield_.value, scope, expectedYield)
      if expectedYield == null { target!.yieldType = optionalResolvedType(valueType) }
      else {
        expectedType := expectedYield!
        case expectedType {
          _: UnknownType -> { target!.yieldType = optionalResolvedType(valueType) }
          _ -> {
            if isAssignable(valueType, expectedType) { }
            else if isAssignable(expectedType, valueType) { target!.yieldType = optionalResolvedType(valueType) }
            else { typeError(state, "Cannot yield " + typeName(valueType) + " from block yielding " + typeName(expectedType), yield_.span) }
          }
        }
      }
      return false
    }
    assignment: YieldBlockAssignmentStatement -> {
      if scope.parent == null {
        typeError(state, "'<-' yield-block reassignment is only allowed for local variables", assignment.span)
      }
      binding := lookupYieldBinding(scope, assignment.name)
      let expectedType: ResolvedType | null = null
      if binding != null { expectedType = optionalResolvedType(binding!.type_) }
      valueType := checkExpression(state, assignment.value, scope, expectedType)
      if binding == null {
        typeError(state, "Undefined identifier \"" + assignment.name + "\"", assignment.span)
        return true
      }
      if !binding!.mutable {
        typeError(state, "Cannot assign to \"" + assignment.name + "\" because it is immutable", assignment.span)
      }
      if !isAssignable(valueType, binding!.type_) {
        typeError(state, "Cannot assign " + typeName(valueType) + " to " + typeName(binding!.type_), assignment.span)
      }
      assignment.resolvedType = optionalResolvedType(binding!.type_)
      return true
    }
    expression: ExpressionStatement -> {
      expressionType := checkExpression(state, expression.expression, scope, null)
      case expressionType {
        _: ResultResolvedType -> { typeError(state, "Result value must be handled", expression.span) }
        _ -> { }
      }
      return !isPanicCall(expression.expression)
    }
    destructuring: DestructuringStatement -> {
      checkDestructuring(state, destructuring, scope, null)
      return true
    }
    try_: TryStatement -> { return checkTry(state, try_, scope) }
    _: ContinueStatement -> { return false }
    _: BreakStatement -> { return false }
    block: Block -> { return checkBlock(state, block, scope) }
    _ -> { return true }
  }
  return true
}

export function checkValueDeclaration(state: CheckerState, declaration: Statement, scope: Scope, kind: string, mutable: bool): bool {
  let name = ""
  let annotation: TypeAnnotation | null = null
  let value: Expression = NullLiteral { kind: "null-literal", span: declaration.span }
  let span = declaration.span
  let elseBlock: Block | null = null
  let failureName: string | null = null
  case declaration {
    const_: ConstDeclaration -> { name = const_.name; annotation = const_.type_; value = const_.value }
    readonly_: ReadonlyDeclaration -> { name = readonly_.name; annotation = readonly_.type_; value = readonly_.value }
    binding: ImmutableBinding -> { name = binding.name; annotation = binding.type_; value = binding.value; elseBlock = binding.else_; failureName = binding.failureName }
    let_: LetDeclaration -> { name = let_.name; annotation = let_.type_; value = let_.value }
    _ -> { return true }
  }
  case value {
    _: YieldBlockExpression -> {
      if scope.parent == null {
        typeError(state, "'<-' yield blocks are only allowed in local declarations", declaration.span)
      }
    }
    _ -> { }
  }
  let inferredCollectionType: ResolvedType | null = null
  if annotation != null && elseBlock == null { inferredCollectionType = checkOmittedCollectionLiteral(state, annotation!, value, scope) }
  let expectedValueType: ResolvedType | null = null
  if annotation != null && elseBlock == null && inferredCollectionType == null { expectedValueType = optionalResolvedType(resolveType(state, annotation!, state.info!, scope)) }
  let valueType = if inferredCollectionType == null then checkExpression(state, value, scope, expectedValueType) else inferredCollectionType!
  let declaredType: ResolvedType = valueType
  if annotation != null && inferredCollectionType == null { declaredType = resolveType(state, annotation!, state.info!, scope) }
  if kind == "readonly" {
    valueType = applyDeepReadonly(valueType)
    declaredType = applyDeepReadonly(declaredType)
    value.resolvedType = optionalResolvedType(valueType)
  }
  if annotation != null && inferredCollectionType != null { decorateAnnotationWithResolved(annotation!, declaredType) }
  if elseBlock != null {
    let narrowedType: ResolvedType = unknownType()
    let failureType: ResolvedType | null = null
    let validElseSubject = true
    case valueType {
      result: ResultResolvedType -> {
        narrowedType = result.valueType
        failureType = optionalResolvedType(result.errorType)
      }
      union_: UnionResolvedType -> {
        if hasNullMember(state, union_) {
          narrowedType = nonNullType(state, valueType)
        } else {
          typeError(state, "declaration-else requires a nullable expression", span)
          validElseSubject = false
        }
      }
      _ -> { typeError(state, "declaration-else requires a Result or nullable expression", span); validElseSubject = false }
    }
    if annotation == null { declaredType = narrowedType }
    else if validElseSubject && !isAssignable(narrowedType, declaredType) {
      typeError(state, "Cannot assign " + typeName(narrowedType) + " to " + typeName(declaredType), span)
    }
    elseScope := Scope { parent: scope }
    if failureName != null {
      if failureType == null {
        typeError(state, "declaration-else failure capture requires a Result expression", span)
      } else if failureName! != "_" {
        declare(elseScope, Binding { name: failureName!, kind: "else-failure", type_: failureType!, mutable: false, span: checkerSemanticSpan(span), module: state.info!.path })
      }
    } else if name != "_" {
      declare(elseScope, Binding { name, kind: "else-subject", type_: valueType, mutable: false, span: checkerSemanticSpan(span), module: state.info!.path })
    }
    handlerCompletes := checkBlock(state, elseBlock!, elseScope)
    if name != "_" && handlerCompletes {
      typeError(state, "Declaration-else block must exit scope", elseBlock!.span)
    }
  } else if !isAssignable(valueType, declaredType) {
    typeError(state, "Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), span)
  }
  case declaration {
    const_: ConstDeclaration -> { const_.resolvedType = optionalResolvedType(declaredType) }
    readonly_: ReadonlyDeclaration -> { readonly_.resolvedType = optionalResolvedType(declaredType) }
    binding: ImmutableBinding -> { binding.resolvedType = optionalResolvedType(declaredType) }
    let_: LetDeclaration -> { let_.resolvedType = optionalResolvedType(declaredType) }
    _ -> { }
  }
  if name != "_" {
    let declarationSymbol: Symbol | null = null
    if scope.parent == null { declarationSymbol = symbolFor(state.info!, name) }
    declare(scope, Binding { name, kind, type_: declaredType, mutable, span: checkerSemanticSpan(span), module: state.info!.path, symbol: declarationSymbol })
  }
  return true
}

export function checkFunction(state: CheckerState, fn: FunctionDeclaration, outer: Scope, owner: ClassType | null): ResolvedType {
  scope := Scope { parent: outer, typeParams: [], thisType: if owner == null then unknownType() else owner!, functionName: fn.name }
  populateTypeParameters(state, scope, fn.typeParams, fn.typeParamConstraints)
  if owner != null {
    declaration := declarationFor(state.result, owner!.symbol)
    if declaration != null {
      case declaration! {
        classDeclaration: ClassDeclaration -> { populateTypeParameters(state, scope, classDeclaration.typeParams, classDeclaration.typeParamConstraints) }
        _ -> { }
      }
    }
  }
  if owner != null { addClassFields(state, scope, owner!); addClassMethods(state, scope, owner!) }
  returnType := if fn.returnType == null then unknownType() else resolveType(state, fn.returnType!, state.info!, scope)
  scope.returnType = returnType
  functionValue := functionType(functionParameters(state, fn, scope), returnType, fn.typeParams)
  fn.resolvedType = optionalResolvedType(functionValue)
  for parameter of fn.params {
    parameterType := if parameter.type_ == null then unknownType() else resolveType(state, parameter.type_!, state.info!, scope)
    parameter.resolvedType = optionalResolvedType(parameterType)
    if parameter.defaultValue != null { checkExpression(state, parameter.defaultValue!, scope, optionalResolvedType(parameterType)) }
    declareShadowing(scope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: checkerSemanticSpan(parameter.span), module: state.info!.path })
  }
  if fn.bodyless { return functionValue }
  let actualReturn = voidType()
  let completes = true
  case fn.body {
    expression: Expression -> {
      let expectedReturnType: ResolvedType | null = null
      if fn.returnType != null { expectedReturnType = returnType }
      actualReturn = checkExpression(state, expression, scope, expectedReturnType)
      completes = false
    }
    block: Block -> { completes = checkBlock(state, block, scope); actualReturn = inferredReturn(state, block) }
  }
  if fn.returnType == null {
    case functionValue {
      resolved: FunctionType -> { resolved.returnType = actualReturn }
      _ -> { }
    }
  }
  if completes && returnType.kind != "void" && returnType.kind != "unknown" {
    typeError(state, "Function '" + fn.name + "' may complete without returning " + typeName(returnType), fn.span)
  }
  if fn.returnType != null { decorateAnnotationWithResolved(fn.returnType!, returnType) }
  for parameter of fn.params {
    if parameter.type_ != null && parameter.resolvedType != null { decorateAnnotationWithResolved(parameter.type_!, parameter.resolvedType!) }
  }
  return functionValue
}

export function functionParameters(state: CheckerState, fn: FunctionDeclaration, scope: Scope): FunctionParamType[] {
  let parameters: FunctionParamType[] = []
  for parameter of fn.params {
    parameters.push(FunctionParamType {
      name: parameter.name,
      type_: if parameter.resolvedType != null then parameter.resolvedType! else if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, state.info!, state.result, scope.typeParams),
      hasDefault: parameter.defaultValue != null,
    })
  }
  return parameters
}

export function checkClass(state: CheckerState, class_: ClassDeclaration, scope: Scope): void {
  symbol := symbolFor(state.info!, class_.name)
  if symbol == null { return }
  classScope := Scope { parent: scope, typeParams: [] }
  populateTypeParameters(state, classScope, class_.typeParams, class_.typeParamConstraints)
  let ownerTypeArgs: ResolvedType[] = []
  for typeParam of class_.typeParams { ownerTypeArgs.push(typeParameter(typeParam)) }
  owner := classType(class_.name, symbol!, ownerTypeArgs)
  for field of class_.fields {
    for fieldName of field.names {
      if generatedMemberName(fieldName) { typeError(state, "Member name \"" + fieldName + "\" is reserved for compiler-generated reflection and JSON support", field.span) }
    }
    let fieldType = unknownType()
    if field.type_ != null {
      fieldType = resolveType(state, field.type_!, state.info!, classScope)
    } else if field.defaultValue != null {
      fieldType = checkExpression(state, field.defaultValue!, classScope, null)
    }
    if field.readonly_ || field.const_ { fieldType = applyDeepReadonly(fieldType) }
    field.resolvedType = optionalResolvedType(fieldType)
    if class_.struct_ && (field.weak_ || containsWeakType(fieldType)) {
      name := if field.names.length == 0 then "<field>" else field.names[0]
      typeError(state, "Struct field \"" + name + "\" cannot be weak", field.span)
    }
    if field.defaultValue != null && field.type_ != null { checkExpression(state, field.defaultValue!, classScope, optionalResolvedType(fieldType)) }
  }
  for method of class_.methods {
    if generatedMemberName(method.name) { typeError(state, "Method name \"" + method.name + "\" is reserved for compiler-generated reflection and JSON support", method.span) }
    checkFunction(state, method, classScope, owner)
  }
  if class_.destructor_ != null {
    if class_.struct_ {
      typeError(state, "Struct \"" + class_.name + "\" cannot declare a destructor", class_.destructor_!.span)
    } else {
      destructorScope := Scope {
        parent: classScope,
        returnType: voidType(),
        thisType: owner,
        functionName: class_.name + ".destructor",
      }
      addClassFields(state, destructorScope, owner)
      addClassMethods(state, destructorScope, owner)
      checkBlock(state, class_.destructor_!, destructorScope)
    }
  }
  for interfaceRef of class_.implements_ {
    target := resolveType(state, interfaceRef, state.info!, classScope)
    case target {
      _: UnknownType -> { if interfaceRef.name != "Stream" { typeError(state, "Interface \"" + interfaceRef.name + "\" is not defined", interfaceRef.span) } }
      interface_: InterfaceType -> {
        if !classSatisfiesConcreteInterface(state.result, class_, owner, interface_) {
          typeError(state, "Class \"" + class_.name + "\" does not satisfy interface \"" + typeName(target) + "\"", interfaceRef.span)
        } else {
          addImplementedInterfaceType(symbol!, typeName(target))
        }
      }
      _: StreamResolvedType -> {
        if !isAssignable(owner, target) {
          typeError(state, "Class \"" + class_.name + "\" does not satisfy interface \"" + typeName(target) + "\"", interfaceRef.span)
        }
      }
      _ -> { typeError(state, "\"" + interfaceRef.name + "\" is not an interface", interfaceRef.span) }
    }
  }
}

function generatedMemberName(name: string): bool {
  return name == "metadata" || name == "toJsonObject" || name == "fromJsonValue"
}

function containsWeakType(type_: ResolvedType): bool {
  case type_ {
    _: WeakResolvedType -> { return true }
    array: ArrayResolvedType -> { return containsWeakType(array.elementType) }
    map: MapResolvedType -> { return containsWeakType(map.keyType) || containsWeakType(map.valueType) }
    set_: SetResolvedType -> { return containsWeakType(set_.elementType) }
    tuple: TupleResolvedType -> { for item of tuple.elements { if containsWeakType(item) { return true } } }
    union_: UnionResolvedType -> { for member of union_.types { if containsWeakType(member) { return true } } }
    result: ResultResolvedType -> { return containsWeakType(result.valueType) || containsWeakType(result.errorType) }
    promise: PromiseType -> { return containsWeakType(promise.valueType) }
    _ -> { }
  }
  return false
}

export function checkInterface(state: CheckerState, interface_: InterfaceDeclaration, scope: Scope): void {
  interfaceScope := Scope { parent: scope, typeParams: [] }
  populateTypeParameters(state, interfaceScope, interface_.typeParams, interface_.typeParamConstraints)
  for field of interface_.fields {
    let fieldType = resolveType(state, field.type_, state.info!, interfaceScope)
    if field.readonly_ { fieldType = applyDeepReadonly(fieldType) }
    field.resolvedType = optionalResolvedType(fieldType)
  }
  for method of interface_.methods { checkFunction(state, method, interfaceScope, null) }
}

// Constraint annotations live in the declaration scope so ordinary constraints
// participate in body checking while the two constraint-only intrinsics retain
// their dedicated member semantics.
function populateTypeParameters(state: CheckerState, scope: Scope, names: string[], constraints: TypeParameterConstraint[]): void {
  for name of names {
    scope.typeParams.push(name)
    scope.typeParamConstraintNames.push("")
    scope.typeParamConstraints.push(ResolvedTypeConstraint {})
  }
  for index of 0..<names.length {
    if index >= constraints.length || constraints[index].type_ == null { continue }
    annotation := constraints[index].type_!
    case annotation {
      named: NamedType -> {
        if named.typeArgs.length == 0 && (named.name == "JsonSerializable" || named.name == "Reflectable") {
          scope.typeParamConstraintNames[index] = named.name
          continue
        }
      }
      _ -> { }
    }
    scope.typeParamConstraints[index].type_ = resolveType(state, annotation, state.info!, scope)
  }
}

export function checkEnum(state: CheckerState, enum_: EnumDeclaration, scope: Scope): void {
  for variant of enum_.variants {
    if variant.value != null {
      valueType := checkExpression(state, variant.value!, scope, optionalResolvedType(primitive("int")))
      if !isAssignable(valueType, primitive("int")) { typeError(state, "Enum value must be an int", variant.span) }
    }
  }
}

export function validateInterfaces(state: CheckerState, module: ModuleInfo): void {
  for symbol of module.symbols {
    if symbol.kind != "interface" || symbol.implementations.length > 0 { continue }
    declaration := declarationFor(state.result, symbol)
    if declaration != null {
      case declaration! {
        interface_: InterfaceDeclaration -> { if interface_.typeParams.length == 0 { typeError(state, "Cannot emit interface \"" + symbol.name + "\" without implementing classes", symbolSpan(module, symbol.name)) } }
        _ -> { }
      }
    }
  }
}

export function checkReturn(state: CheckerState, statement: ReturnStatement, scope: Scope): bool {
  if valueYieldScope(scope) != null {
    typeError(state, "'return' cannot be used inside a value-producing block; use 'yield' to produce the block value", statement.span)
    if statement.value != null { checkExpression(state, statement.value!, scope, null) }
    return false
  }
  target := returnScope(scope)
  if target == null { typeError(state, "Return is only valid inside a function", statement.span); return false }
  returnType := target!.returnType!
  statement.resolvedExpectedType = optionalResolvedType(returnType)
  if statement.value == null {
    if returnType.kind != "void" && returnType.kind != "unknown" {
      typeError(state, "Expected a return value of type " + typeName(returnType), statement.span)
    }
  } else {
    valueType := checkExpression(state, statement.value!, scope, optionalResolvedType(returnType))
    if !isAssignable(valueType, returnType) { typeError(state, "Cannot return " + typeName(valueType) + " from function returning " + typeName(returnType), statement.span) }
  }
  return false
}

export function checkBlock(state: CheckerState, block: Block, parent: Scope): bool {
  scope := Scope { parent }
  let completes = true
  let retiredActors: Binding[] = []
  for statement of block.statements {
    if completes {
      completes = checkStatement(state, statement, scope)
    } else {
      // Unreachable statements still need full semantic decoration. The
      // emitter consumes the entire AST, so skipping them would create a
      // hidden unchecked region even though control-flow analysis already
      // knows the block cannot complete normally.
      let ignored = checkStatement(state, statement, scope)
    }
    reportRetiredActorUses(statement, retiredActors, state.info!.path, state.diagnostics)
    collectRetiredActorBindings(statement, retiredActors)
  }
  return completes
}

export function checkTry(state: CheckerState, statement: TryStatement, scope: Scope): bool {
  if valueYieldScope(scope) != null && catchErrorScope(scope) == null {
    typeError(state, "'try' cannot be used inside a value-producing block; handle the Result outside the block", statement.span)
  }
  let value: Expression = Identifier { kind: "identifier", name: "<try>", span: statement.span }
  case statement.binding {
    declaration: ConstDeclaration -> { value = declaration.value }
    declaration: ReadonlyDeclaration -> { value = declaration.value }
    binding: ImmutableBinding -> { value = binding.value }
    declaration: LetDeclaration -> { value = declaration.value }
    expression: ExpressionStatement -> { value = expression.expression }
    destructuring: DestructuringStatement -> { value = destructuring.value }
  }
  resultValue := checkExpression(state, value, scope, null)
  value.resolvedType = optionalResolvedType(resultValue)
  case resultValue {
    result: ResultResolvedType -> {
      collector := catchErrorScope(scope)
      if collector != null { collector!.catchErrorTypes.push(result.errorType) }
      case statement.binding {
        declaration: ConstDeclaration -> {
          declaration.value.resolvedType = optionalResolvedType(resultValue)
          declaration.resolvedType = optionalResolvedType(result.valueType)
          declare(scope, Binding { name: declaration.name, kind: "const", type_: result.valueType, mutable: false, span: checkerSemanticSpan(declaration.span), module: state.info!.path })
        }
        declaration: ReadonlyDeclaration -> {
          declaration.value.resolvedType = optionalResolvedType(resultValue)
          declaration.resolvedType = optionalResolvedType(result.valueType)
          declare(scope, Binding { name: declaration.name, kind: "readonly", type_: result.valueType, mutable: false, span: checkerSemanticSpan(declaration.span), module: state.info!.path })
        }
        binding: ImmutableBinding -> {
          binding.value.resolvedType = optionalResolvedType(resultValue)
          binding.resolvedType = optionalResolvedType(result.valueType)
          declare(scope, Binding {
            name: binding.name, kind: "immutable-binding", type_: result.valueType,
            mutable: false, span: checkerSemanticSpan(binding.span), module: state.info!.path,
          })
        }
        declaration: LetDeclaration -> {
          declaration.value.resolvedType = optionalResolvedType(resultValue)
          declaration.resolvedType = optionalResolvedType(result.valueType)
          declare(scope, Binding { name: declaration.name, kind: "let", type_: result.valueType, mutable: true, span: checkerSemanticSpan(declaration.span), module: state.info!.path })
        }
        expression: ExpressionStatement -> { expression.expression.resolvedType = optionalResolvedType(resultValue) }
        destructuring: DestructuringStatement -> {
          destructuring.value.resolvedType = optionalResolvedType(resultValue)
          checkDestructuring(state, destructuring, scope, result.valueType)
        }
      }
    }
    _ -> { typeError(state, "try requires a Result expression", value.span) }
  }
  return true
}

/** Checks declaration and assignment destructuring against an already-resolved source shape. */
function checkDestructuring(state: CheckerState, statement: DestructuringStatement, scope: Scope, sourceType: ResolvedType | null): void {
  valueType := if sourceType == null then checkExpression(state, statement.value, scope, null) else sourceType!
  let bindingTypes: ResolvedType[] = []

  if statement.kind.startsWith("array-destructuring") {
    case valueType {
      array: ArrayResolvedType -> { for ignored of statement.bindings { bindingTypes.push(array.elementType) } }
      _ -> { typeError(state, "Array destructuring requires a T[] value, but got \"" + typeName(valueType) + "\"", statement.value.span) }
    }
  } else if statement.kind.startsWith("positional-destructuring") {
    bindingTypes = positionalDestructuringTypes(state, valueType, statement.value.span)
    if bindingTypes.length < statement.bindings.length {
      typeError(state, "Positional destructuring expected at least " + string(statement.bindings.length) + " values, but got " + string(bindingTypes.length), statement.span)
    }
  }

  if statement.kind.startsWith("named-destructuring") {
    for named of statement.namedBindings {
      localName := named.alias ?? named.name
      fieldType := memberType(state, valueType, named.name, named.span)
      if fieldType.kind == "unknown" { typeError(state, "Type \"" + typeName(valueType) + "\" has no field \"" + named.name + "\"", named.span) }
      if statement.kind.endsWith("-assignment") { validateDestructuringTarget(state, scope, localName, fieldType, named.span) }
      else { declareDestructuredBinding(state, scope, localName, fieldType, statement.bindingKind, named.span) }
    }
    return
  }

  for i of 0..<statement.bindings.length {
    name := statement.bindings[i]
    if name == "_" { continue }
    bindingType := if i < bindingTypes.length then bindingTypes[i] else unknownType()
    if statement.kind.endsWith("-assignment") { validateDestructuringTarget(state, scope, name, bindingType, statement.span) }
    else { declareDestructuredBinding(state, scope, name, bindingType, statement.bindingKind, statement.span) }
  }
}

function positionalDestructuringTypes(state: CheckerState, valueType: ResolvedType, span: SourceSpan): ResolvedType[] {
  let result: ResolvedType[] = []
  case valueType {
    tuple: TupleResolvedType -> { for element of tuple.elements { result.push(element) } }
    class_: ClassType -> {
      declaration := declarationFor(state.result, class_.symbol)
      if declaration != null { case declaration! {
        owner: ClassDeclaration -> {
          for field of owner.fields {
            if field.static_ { continue }
            for name of field.names { result.push(memberType(state, class_, name, field.span)) }
          }
        }
        _ -> { }
      } }
    }
    _ -> { typeError(state, "Positional destructuring requires a tuple or nominal object value, but got \"" + typeName(valueType) + "\"", span) }
  }
  return result
}

function declareDestructuredBinding(state: CheckerState, scope: Scope, name: string, type_: ResolvedType, bindingKind: string, span: SourceSpan): void {
  declare(scope, Binding {
    name,
    kind: if bindingKind == "let" then "let" else "immutable-binding",
    type_, mutable: bindingKind == "let", span: checkerSemanticSpan(span), module: state.info!.path,
  })
}

function validateDestructuringTarget(state: CheckerState, scope: Scope, name: string, valueType: ResolvedType, span: SourceSpan): void {
  target := lookup(scope, name)
  if target == null { typeError(state, "Destructuring assignment target \"" + name + "\" is not defined", span); return }
  if !target!.mutable { typeError(state, "Cannot assign to \"" + name + "\" because it is immutable", span) }
  if !isAssignable(valueType, target!.type_) { typeError(state, "Cannot assign " + typeName(valueType) + " to " + typeName(target!.type_), span) }
}

function catchErrorScope(scope: Scope): Scope | null {
  let current: Scope | null = scope
  while current != null {
    if current!.capturesTryErrors { return current }
    current = current!.parent
  }
  return null
}

function lookupYieldBinding(scope: Scope, name: string): Binding | null {
  let current: Scope | null = scope
  while current != null {
    for binding of current!.bindings { if binding.name == name { return binding } }
    current = current!.parent
  }
  return null
}

export function checkCase(state: CheckerState, statement: CaseStatement, scope: Scope): bool {
  subjectType := checkExpression(state, statement.subject, scope, null)
  let exhaustive = false
  let hasSuccessArm = false
  let hasFailureArm = false
  let allArmsReturn = statement.arms.length > 0
  for arm of statement.arms {
    armScope := Scope { parent: scope }
    checkCasePatterns(state, arm.patterns, subjectType, armScope)
    for pattern of arm.patterns {
      case pattern {
        _: WildcardPattern -> { exhaustive = true }
        type_: TypePattern -> {
          case type_.type_ {
            named: NamedType -> {
              if named.name == "Success" { hasSuccessArm = true }
              if named.name == "Failure" { hasFailureArm = true }
            }
            _ -> { }
          }
        }
        _ -> { }
      }
    }
    let armCompletes = true
    case arm.body {
      block: Block -> { armCompletes = checkBlock(state, block, armScope) }
      expression: Expression -> { checkExpression(state, expression, armScope, null) }
    }
    if armCompletes { allArmsReturn = false }
  }
  case subjectType {
    _: ResultResolvedType -> { if hasSuccessArm && hasFailureArm { exhaustive = true } }
    _ -> { }
  }
  return !(exhaustive && allArmsReturn)
}

export function inferredReturn(state: CheckerState, block: Block): ResolvedType {
  for statement of block.statements {
    case statement {
      return_: ReturnStatement -> {
        if return_.value == null { return voidType() }
        value := return_.value!
        return value.resolvedType ?? unknownType()
      }
      _ -> { }
    }
  }
  return voidType()
}

export function addClassFields(state: CheckerState, scope: Scope, owner: ClassType): void {
  declaration := declarationFor(state.result, owner.symbol)
  if declaration == null { return }
  case declaration! {
    class_: ClassDeclaration -> {
      for field of class_.fields {
        for name of field.names {
          declare(scope, Binding {
            name,
            kind: "field",
            type_: field.resolvedType ?? unknownType(),
            mutable: !field.readonly_ && !field.const_,
            span: checkerSemanticSpan(field.span),
            module: state.info!.path,
          })
        }
      }
    }
    _ -> { }
  }
}
