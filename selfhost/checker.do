// Expression-level type checking for the self-hosted compiler.
//
// This first checker deliberately covers the core language used by the
// self-hosting front end: lexical bindings, primitive/collection types,
// functions, classes, operators, calls, and conservative return analysis.

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

export class ModuleChecker {
  result: AnalysisResult
  diagnostics: Diagnostic[] = []
  info: ModuleInfo | null = null
  moduleScope: Scope | null = null

  function check(entry: string): CheckResult {
    diagnostics = []
    info = findModule(result, if entry.endsWith(".do") then entry else entry + ".do")
    if info == null { return CheckResult { diagnostics } }
    discoverInterfaceImplementations(result)
    moduleScope = Scope { parent: null }
    predeclareModuleBindings(info!, moduleScope!, result)
    let retiredActors: Binding[] = []
    for statement of info!.program.statements {
      checkStatement(statement, moduleScope!)
      reportRetiredActorUses(statement, retiredActors, info!.path, diagnostics)
      collectRetiredActorBindings(statement, retiredActors)
    }
    validateInterfaces(info!)
    return CheckResult { diagnostics }
  }

  private function checkStatement(statement: Statement, scope: Scope): bool {
    case statement {
      const_: ConstDeclaration -> { return checkValueDeclaration(const_, scope, "const", false) }
      readonly_: ReadonlyDeclaration -> { return checkValueDeclaration(readonly_, scope, "readonly", false) }
      binding: ImmutableBinding -> { return checkValueDeclaration(binding, scope, "immutable-binding", false) }
      let_: LetDeclaration -> { return checkValueDeclaration(let_, scope, "let", true) }
      fn: FunctionDeclaration -> { checkFunction(fn, scope, null); return true }
      class_: ClassDeclaration -> { checkClass(class_, scope); return true }
      interface_: InterfaceDeclaration -> { checkInterface(interface_, scope); return true }
      enum_: EnumDeclaration -> { checkEnum(enum_, scope); return true }
      alias: TypeAliasDeclaration -> {
        aliasScope := Scope { parent: scope }
        for typeParam of alias.typeParams { aliasScope.typeParams.push(typeParam) }
        resolvedAlias := resolveType(alias.type_, info!, aliasScope)
        alias.resolvedType = optionalResolvedType(resolvedAlias)
        return true
      }
      if_: IfStatement -> {
        requireBool(checkExpression(if_.condition, scope, null), if_.condition.span)
        thenCompletes := checkBlock(if_.body, scope)
        let allComplete = thenCompletes
        for branch of if_.elseIfs {
          requireBool(checkExpression(branch.condition, scope, null), branch.condition.span)
          branchCompletes := checkBlock(branch.body, scope)
          allComplete = allComplete || branchCompletes
        }
        if if_.else_ == null { return true }
        elseCompletes := checkBlock(if_.else_!, scope)
        return allComplete || elseCompletes
      }
      case_: CaseStatement -> { return checkCase(case_, scope) }
      while_: WhileStatement -> {
        requireBool(checkExpression(while_.condition, scope, null), while_.condition.span)
        checkBlock(while_.body, scope)
        if while_.then_ != null { checkBlock(while_.then_!, scope) }
        case while_.condition {
          literal: BoolLiteral -> {
            if literal.value && !blockContainsLoopExit(while_.body) { return false }
          }
          _ -> { }
        }
        return true
      }
      for_: ForStatement -> {
        if for_.init != null { checkStatement(for_.init!, scope) }
        if for_.condition != null {
          condition := for_.condition!
          requireBool(checkExpression(condition, scope, null), condition.span)
        }
        for update of for_.update { checkExpression(update, scope, null) }
        checkBlock(for_.body, scope)
        if for_.then_ != null { checkBlock(for_.then_!, scope) }
        return true
      }
      forOf: ForOfStatement -> {
        iterable := checkExpression(forOf.iterable, scope, null)
        element := iterableElement(iterable)
        bodyScope := Scope { parent: scope }
        case element {
          tuple: TupleResolvedType -> {
            if tuple.elements.length == forOf.bindings.length {
              for i of 0..<forOf.bindings.length {
                name := forOf.bindings[i]
                if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: tuple.elements[i], mutable: false, span: checkerSemanticSpan(forOf.span), module: info!.path }) }
              }
            } else {
              for name of forOf.bindings { if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: element, mutable: false, span: checkerSemanticSpan(forOf.span), module: info!.path }) } }
            }
          }
          _ -> {
            for name of forOf.bindings { if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: element, mutable: false, span: checkerSemanticSpan(forOf.span), module: info!.path }) } }
          }
        }
        checkBlock(forOf.body, bodyScope)
        if forOf.then_ != null { checkBlock(forOf.then_!, scope) }
        return true
      }
      with_: WithStatement -> {
        bodyScope := Scope { parent: scope }
        for binding of with_.bindings {
          valueType := checkExpression(binding.value, bodyScope, null)
          declaredType := if binding.type_ == null then valueType else resolveType(binding.type_!, info!, scope)
          binding.resolvedType = optionalResolvedType(declaredType)
          if !isAssignable(valueType, declaredType) { typeError("Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), binding.span) }
          declare(bodyScope, Binding { name: binding.name, kind: "with", type_: declaredType, mutable: false, span: checkerSemanticSpan(binding.span), module: info!.path })
        }
        checkBlock(with_.body, bodyScope)
        return true
      }
      return_: ReturnStatement -> { return checkReturn(return_, scope) }
      yield_: YieldStatement -> {
        target := valueYieldScope(scope)
        if target == null {
          typeError("'yield' can only be used inside a value-producing block", yield_.span)
          checkExpression(yield_.value, scope, null)
          return false
        }
        expectedYield := target!.yieldType
        valueType := checkExpression(yield_.value, scope, expectedYield)
        if expectedYield == null { target!.yieldType = optionalResolvedType(valueType) }
        else {
          expectedType := expectedYield!
          case expectedType {
            _: UnknownType -> { target!.yieldType = optionalResolvedType(valueType) }
            _ -> {
              if isAssignable(valueType, expectedType) { }
              else if isAssignable(expectedType, valueType) { target!.yieldType = optionalResolvedType(valueType) }
              else { typeError("Cannot yield " + typeName(valueType) + " from block yielding " + typeName(expectedType), yield_.span) }
            }
          }
        }
        return false
      }
      expression: ExpressionStatement -> {
        checkExpression(expression.expression, scope, null)
        return !isPanicCall(expression.expression)
      }
      destructuring: DestructuringStatement -> {
        valueType := checkExpression(destructuring.value, scope, null)
        if !destructuring.kind.endsWith("-assignment") {
          let bindingTypes: ResolvedType[] = []
          case valueType {
            tuple: TupleResolvedType -> { for element of tuple.elements { bindingTypes.push(element) } }
            array: ArrayResolvedType -> { for ignoredName of destructuring.bindings { bindingTypes.push(array.elementType) } }
            _ -> { }
          }
          for i of 0..<destructuring.bindings.length {
            name := destructuring.bindings[i]
            if name != "_" {
              bindingType := if i < bindingTypes.length then bindingTypes[i] else unknownType()
              declare(scope, Binding {
                name,
                kind: if destructuring.bindingKind == "let" then "let" else "immutable-binding",
                type_: bindingType,
                mutable: destructuring.bindingKind == "let",
                span: checkerSemanticSpan(destructuring.span),
                module: info!.path,
              })
            }
          }
        }
        return true
      }
      try_: TryStatement -> { return checkTry(try_, scope) }
      _: ContinueStatement -> { return false }
      _: BreakStatement -> { return false }
      block: Block -> { return checkBlock(block, scope) }
      _ -> { return true }
    }
    return true
  }

  private function checkValueDeclaration(declaration: Statement, scope: Scope, kind: string, mutable: bool): bool {
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
    let expectedValueType: ResolvedType | null = null
    if annotation != null && elseBlock == null { expectedValueType = optionalResolvedType(resolveType(annotation!, info!, scope)) }
    valueType := checkExpression(value, scope, expectedValueType)
    let declaredType: ResolvedType = valueType
    if annotation != null { declaredType = resolveType(annotation!, info!, scope) }
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
          if hasNullMember(union_) {
            narrowedType = nonNullType(valueType)
          } else {
            typeError("declaration-else requires a nullable expression", span)
            validElseSubject = false
          }
        }
        _ -> { typeError("declaration-else requires a Result or nullable expression", span); validElseSubject = false }
      }
      if annotation == null { declaredType = narrowedType }
      else if validElseSubject && !isAssignable(narrowedType, declaredType) {
        typeError("Cannot assign " + typeName(narrowedType) + " to " + typeName(declaredType), span)
      }
      elseScope := Scope { parent: scope }
      if failureName != null {
        if failureType == null {
          typeError("declaration-else failure capture requires a Result expression", span)
        } else if failureName! != "_" {
          declare(elseScope, Binding { name: failureName!, kind: "else-failure", type_: failureType!, mutable: false, span: checkerSemanticSpan(span), module: info!.path })
        }
      } else if name != "_" {
        declare(elseScope, Binding { name, kind: "else-subject", type_: valueType, mutable: false, span: checkerSemanticSpan(span), module: info!.path })
      }
      handlerCompletes := checkBlock(elseBlock!, elseScope)
      if name != "_" && handlerCompletes {
        typeError("Declaration-else block must exit scope", elseBlock!.span)
      }
    } else if !isAssignable(valueType, declaredType) {
      typeError("Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), span)
    }
    case declaration {
      const_: ConstDeclaration -> { const_.resolvedType = optionalResolvedType(declaredType) }
      readonly_: ReadonlyDeclaration -> { readonly_.resolvedType = optionalResolvedType(declaredType) }
      binding: ImmutableBinding -> { binding.resolvedType = optionalResolvedType(declaredType) }
      let_: LetDeclaration -> { let_.resolvedType = optionalResolvedType(declaredType) }
      _ -> { }
    }
    if name != "_" { declare(scope, Binding { name, kind, type_: declaredType, mutable, span: checkerSemanticSpan(span), module: info!.path }) }
    return true
  }

  private function checkFunction(fn: FunctionDeclaration, outer: Scope, owner: ClassType | null): ResolvedType {
    scope := Scope { parent: outer, typeParams: [], thisType: if owner == null then unknownType() else owner!, functionName: fn.name }
    for typeParam of fn.typeParams { scope.typeParams.push(typeParam) }
    if owner != null {
      declaration := declarationFor(result, owner!.symbol)
      if declaration != null {
        case declaration! {
          classDeclaration: ClassDeclaration -> { for typeParam of classDeclaration.typeParams { scope.typeParams.push(typeParam) } }
          _ -> { }
        }
      }
    }
    if owner != null { addClassFields(scope, owner!); addClassMethods(scope, owner!) }
    returnType := if fn.returnType == null then unknownType() else resolveType(fn.returnType!, info!, scope)
    scope.returnType = returnType
    functionValue := functionType(functionParameters(fn, scope), returnType, fn.typeParams)
    fn.resolvedType = optionalResolvedType(functionValue)
    for parameter of fn.params {
      parameterType := if parameter.type_ == null then unknownType() else resolveType(parameter.type_!, info!, scope)
      parameter.resolvedType = optionalResolvedType(parameterType)
      if parameter.defaultValue != null { checkExpression(parameter.defaultValue!, scope, optionalResolvedType(parameterType)) }
      declareShadowing(scope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: checkerSemanticSpan(parameter.span), module: info!.path })
    }
    if fn.bodyless { return functionValue }
    let actualReturn = voidType()
    let completes = true
    case fn.body {
      expression: Expression -> {
        let expectedReturnType: ResolvedType | null = null
        if fn.returnType != null { expectedReturnType = returnType }
        actualReturn = checkExpression(expression, scope, expectedReturnType)
        completes = false
      }
      block: Block -> { completes = checkBlock(block, scope); actualReturn = inferredReturn(block) }
    }
    if fn.returnType == null {
      case functionValue {
        resolved: FunctionType -> { resolved.returnType = actualReturn }
        _ -> { }
      }
    }
    if completes && returnType.kind != "void" && returnType.kind != "unknown" {
      typeError("Function '" + fn.name + "' may complete without returning " + typeName(returnType), fn.span)
    }
    if fn.returnType != null { decorateAnnotationWithResolved(fn.returnType!, returnType) }
    for parameter of fn.params {
      if parameter.type_ != null && parameter.resolvedType != null { decorateAnnotationWithResolved(parameter.type_!, parameter.resolvedType!) }
    }
    return functionValue
  }

  private function functionParameters(fn: FunctionDeclaration, scope: Scope): FunctionParamType[] {
    let parameters: FunctionParamType[] = []
    for parameter of fn.params {
      parameters.push(FunctionParamType {
        name: parameter.name,
        type_: if parameter.resolvedType != null then parameter.resolvedType! else if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info!, result, scope.typeParams),
        hasDefault: parameter.defaultValue != null,
      })
    }
    return parameters
  }

  private function checkClass(class_: ClassDeclaration, scope: Scope): void {
    symbol := symbolFor(info!, class_.name)
    if symbol == null { return }
    classScope := Scope { parent: scope, typeParams: [] }
    for typeParam of class_.typeParams { classScope.typeParams.push(typeParam) }
    let ownerTypeArgs: ResolvedType[] = []
    for typeParam of class_.typeParams { ownerTypeArgs.push(typeParameter(typeParam)) }
    owner := classType(class_.name, symbol!, ownerTypeArgs)
    for field of class_.fields {
      let fieldType = unknownType()
      if field.type_ != null {
        fieldType = resolveType(field.type_!, info!, classScope)
      } else if field.defaultValue != null {
        fieldType = checkExpression(field.defaultValue!, classScope, null)
      }
      if field.readonly_ { fieldType = applyDeepReadonly(fieldType) }
      field.resolvedType = optionalResolvedType(fieldType)
      if field.defaultValue != null && field.type_ != null { checkExpression(field.defaultValue!, classScope, optionalResolvedType(fieldType)) }
    }
    for method of class_.methods { checkFunction(method, classScope, owner) }
    for interfaceRef of class_.implements_ {
      target := resolveType(interfaceRef, info!, classScope)
      case target {
        _: UnknownType -> { if interfaceRef.name != "Stream" { typeError("Interface \"" + interfaceRef.name + "\" is not defined", interfaceRef.span) } }
        interface_: InterfaceType -> {
          if !classSatisfiesConcreteInterface(result, class_, owner, interface_) {
            typeError("Class \"" + class_.name + "\" does not satisfy interface \"" + typeName(target) + "\"", interfaceRef.span)
          } else {
            addImplementedInterfaceType(symbol!, typeName(target))
          }
        }
        _: StreamResolvedType -> {
          if !isAssignable(owner, target) {
            typeError("Class \"" + class_.name + "\" does not satisfy interface \"" + typeName(target) + "\"", interfaceRef.span)
          }
        }
        _ -> { typeError("\"" + interfaceRef.name + "\" is not an interface", interfaceRef.span) }
      }
    }
  }

  private function checkInterface(interface_: InterfaceDeclaration, scope: Scope): void {
    interfaceScope := Scope { parent: scope, typeParams: [] }
    for typeParam of interface_.typeParams { interfaceScope.typeParams.push(typeParam) }
    for field of interface_.fields { field.resolvedType = optionalResolvedType(resolveType(field.type_, info!, interfaceScope)) }
    for method of interface_.methods { checkFunction(method, interfaceScope, null) }
  }

  private function checkEnum(enum_: EnumDeclaration, scope: Scope): void {
    for variant of enum_.variants {
      if variant.value != null {
        valueType := checkExpression(variant.value!, scope, optionalResolvedType(primitive("int")))
        if !isAssignable(valueType, primitive("int")) { typeError("Enum value must be an int", variant.span) }
      }
    }
  }

  private function validateInterfaces(module: ModuleInfo): void {
    for symbol of module.symbols {
      if symbol.kind != "interface" || symbol.implementations.length > 0 { continue }
      declaration := declarationFor(result, symbol)
      if declaration != null {
        case declaration! {
          interface_: InterfaceDeclaration -> { if interface_.typeParams.length == 0 { typeError("Cannot emit interface \"" + symbol.name + "\" without implementing classes", symbolSpan(module, symbol.name)) } }
          _ -> { }
        }
      }
    }
  }

  private function checkReturn(statement: ReturnStatement, scope: Scope): bool {
    if valueYieldScope(scope) != null {
      typeError("'return' cannot be used inside a value-producing block; use 'yield' to produce the block value", statement.span)
      if statement.value != null { checkExpression(statement.value!, scope, null) }
      return false
    }
    target := returnScope(scope)
    if target == null { typeError("Return is only valid inside a function", statement.span); return false }
    returnType := target!.returnType!
    statement.resolvedExpectedType = optionalResolvedType(returnType)
    if statement.value == null {
      if returnType.kind != "void" && returnType.kind != "unknown" {
        typeError("Expected a return value of type " + typeName(returnType), statement.span)
      }
    } else {
      valueType := checkExpression(statement.value!, scope, optionalResolvedType(returnType))
      if !isAssignable(valueType, returnType) { typeError("Cannot return " + typeName(valueType) + " from function returning " + typeName(returnType), statement.span) }
    }
    return false
  }

  private function checkBlock(block: Block, parent: Scope): bool {
    scope := Scope { parent }
    let completes = true
    let retiredActors: Binding[] = []
    for statement of block.statements {
      if completes {
        completes = checkStatement(statement, scope)
      } else {
        // Unreachable statements still need full semantic decoration. The
        // emitter consumes the entire AST, so skipping them would create a
        // hidden unchecked region even though control-flow analysis already
        // knows the block cannot complete normally.
        let ignored = checkStatement(statement, scope)
      }
      reportRetiredActorUses(statement, retiredActors, info!.path, diagnostics)
      collectRetiredActorBindings(statement, retiredActors)
    }
    return completes
  }

  private function checkTry(statement: TryStatement, scope: Scope): bool {
    let value: Expression = Identifier { kind: "identifier", name: "<try>", span: statement.span }
    case statement.binding {
      declaration: ConstDeclaration -> { value = declaration.value }
      declaration: ReadonlyDeclaration -> { value = declaration.value }
      binding: ImmutableBinding -> { value = binding.value }
      declaration: LetDeclaration -> { value = declaration.value }
      expression: ExpressionStatement -> { value = expression.expression }
    }
    resultValue := checkExpression(value, scope, null)
    value.resolvedType = optionalResolvedType(resultValue)
    case resultValue {
      result: ResultResolvedType -> {
        case statement.binding {
          declaration: ConstDeclaration -> {
            declaration.value.resolvedType = optionalResolvedType(resultValue)
            declaration.resolvedType = optionalResolvedType(result.valueType)
            declare(scope, Binding { name: declaration.name, kind: "const", type_: result.valueType, mutable: false, span: checkerSemanticSpan(declaration.span), module: info!.path })
          }
          declaration: ReadonlyDeclaration -> {
            declaration.value.resolvedType = optionalResolvedType(resultValue)
            declaration.resolvedType = optionalResolvedType(result.valueType)
            declare(scope, Binding { name: declaration.name, kind: "readonly", type_: result.valueType, mutable: false, span: checkerSemanticSpan(declaration.span), module: info!.path })
          }
          binding: ImmutableBinding -> {
            binding.value.resolvedType = optionalResolvedType(resultValue)
            binding.resolvedType = optionalResolvedType(result.valueType)
            declare(scope, Binding {
              name: binding.name, kind: "immutable-binding", type_: result.valueType,
              mutable: false, span: checkerSemanticSpan(binding.span), module: info!.path,
            })
          }
          declaration: LetDeclaration -> {
            declaration.value.resolvedType = optionalResolvedType(resultValue)
            declaration.resolvedType = optionalResolvedType(result.valueType)
            declare(scope, Binding { name: declaration.name, kind: "let", type_: result.valueType, mutable: true, span: checkerSemanticSpan(declaration.span), module: info!.path })
          }
          expression: ExpressionStatement -> { expression.expression.resolvedType = optionalResolvedType(resultValue) }
        }
      }
      _ -> { typeError("try requires a Result expression", value.span) }
    }
    return true
  }

  private function checkCase(statement: CaseStatement, scope: Scope): bool {
    subjectType := checkExpression(statement.subject, scope, null)
    let exhaustive = false
    let hasSuccessArm = false
    let hasFailureArm = false
    let allArmsReturn = statement.arms.length > 0
    for arm of statement.arms {
      armScope := Scope { parent: scope }
      checkCasePatterns(arm.patterns, subjectType, armScope)
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
        block: Block -> { armCompletes = checkBlock(block, armScope) }
        expression: Expression -> { checkExpression(expression, armScope, null) }
      }
      if armCompletes { allArmsReturn = false }
    }
    case subjectType {
      _: ResultResolvedType -> { if hasSuccessArm && hasFailureArm { exhaustive = true } }
      _ -> { }
    }
    return !(exhaustive && allArmsReturn)
  }

  private function checkCaseExpression(expression: CaseExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
    subjectType := checkExpression(expression.subject, scope, null)
    let inferredType: ResolvedType = unknownType()
    for arm of expression.arms {
      armScope := Scope { parent: scope }
      checkCasePatterns(arm.patterns, subjectType, armScope)
      let armExpected = expected
      if armExpected == null {
        case inferredType {
          _: UnknownType -> { }
          _ -> { armExpected = inferredType }
        }
      }
      let armType: ResolvedType = unknownType()
      case arm.body {
        block: Block -> {
          armScope.inValueYieldBlock = true
          armScope.yieldType = if armExpected == null then optionalResolvedType(unknownType()) else armExpected
          if checkBlock(block, armScope) { typeError("Block case-expression arms must yield a value on every path", block.span) }
          armType = armScope.yieldType ?? unknownType()
        }
        bodyExpression: Expression -> { armType = checkExpression(bodyExpression, armScope, armExpected) }
      }
      if inferredType.kind == "unknown" { inferredType = armType } else { inferredType = joinTypes(inferredType, armType) }
    }
    expression.resolvedType = optionalResolvedType(inferredType)
    return inferredType
  }

  private function checkCasePatterns(patterns: CasePattern[], subjectType: ResolvedType, scope: Scope): void {
    for pattern of patterns {
      case pattern {
        type_: TypePattern -> {
          let resolved: ResolvedType = unknownType()
          let contextualResultArm = false
          case subjectType {
            _: ResultResolvedType -> {
              case type_.type_ {
                named: NamedType -> {
                  if named.name == "Success" || named.name == "Failure" {
                    contextualResultArm = true
                    resolved = subjectType
                    // Explicit payload arguments still need full decoration.
                    for argument of named.typeArgs { resolveType(argument, info!, scope) }
                  }
                }
                _ -> { }
              }
            }
            _ -> { }
          }
          if !contextualResultArm { resolved = resolveType(type_.type_, info!, scope) }
          case type_.type_ {
            named: NamedType -> { named.resolvedType = optionalResolvedType(resolved) }
            _ -> { }
          }
          type_.resolvedType = optionalResolvedType(resolved)
          if type_.name != "_" {
            declare(scope, Binding {
              name: type_.name,
              kind: "case-binding",
              type_: resolved,
              mutable: false,
              span: checkerSemanticSpan(type_.span),
              module: info!.path,
              casePattern: casePatternName(type_),
            })
          }
        }
        value: ValuePattern -> { checkExpression(value.value, scope, optionalResolvedType(subjectType)) }
        _: WildcardPattern -> { }
      }
    }
  }

  private function checkExpression(expression: Expression, scope: Scope, expected: ResolvedType | null): ResolvedType {
    case expression {
      _: IntLiteral -> { return finish(expression, primitive("int")) }
      _: LongLiteral -> { return finish(expression, primitive("long")) }
      _: FloatLiteral -> { return finish(expression, primitive("float")) }
      _: DoubleLiteral -> { return finish(expression, primitive("double")) }
      string_: StringLiteral -> {
        for interpolation of string_.interpolations { checkExpression(interpolation, scope, null) }
        return finish(expression, primitive("string"))
      }
      _: CharLiteral -> { return finish(expression, primitive("char")) }
      _: BoolLiteral -> { return finish(expression, primitive("bool")) }
      _: NullLiteral -> { return finish(expression, nullType()) }
      _: CallerExpression -> { return finish(expression, builtinSourceLocationType()) }
      dot: DotShorthand -> { return checkDotShorthand(dot, expected) }
      identifier: Identifier -> { return checkIdentifier(identifier, scope) }
      binary: BinaryExpression -> { return checkBinary(binary, scope) }
      unary: UnaryExpression -> { return checkUnary(unary, scope) }
      as_: AsExpression -> { return checkAs(as_, scope) }
      assignment: AssignmentExpression -> { return checkAssignment(assignment, scope) }
      member: MemberExpression -> {
        let objectType = unknownType()
        let namespaceMember: ResolvedType | null = null
        case member.object {
          identifier: Identifier -> {
            if isNamespaceImport(info!, identifier.name) {
              namespaceMember = namespaceMemberType(info!, identifier.name, member.property, result)
            } else if isBuiltinNamespace(identifier.name) {
              identifier.resolvedBinding = Binding {
                name: identifier.name,
                kind: "builtin-type-namespace",
                type_: primitive(identifier.name),
                mutable: false,
                span: checkerSemanticSpan(identifier.span),
                module: info!.path,
              }
              identifier.resolvedType = optionalResolvedType(primitive(identifier.name))
              namespaceMember = builtinNamespaceMemberType(identifier.name, member.property)
            } else {
              objectType = checkExpression(member.object, scope, null)
            }
          }
          _ -> { objectType = checkExpression(member.object, scope, null) }
        }
        if namespaceMember != null { return finish(expression, namespaceMember!) }
        memberValue := memberType(objectType, member.property, member.span)
        member.resolvedStaticOwner = staticMemberOwner(objectType, member.property, result)
        member.resolvedCallableField = callableField(objectType, member.property)
        return finish(expression, memberValue)
      }
      index: IndexExpression -> { return finish(expression, indexType(checkExpression(index.object, scope, null), checkExpression(index.index, scope, optionalResolvedType(primitive("int"))), index.span)) }
      call: CallExpression -> { return checkCall(call, scope, expected) }
      array: ArrayLiteral -> { return checkArray(array, scope, expected) }
      tuple: TupleLiteral -> {
        let elements: ResolvedType[] = []
        for item of tuple.elements { elements.push(checkExpression(item, scope, null)) }
        return finish(expression, tupleType(elements))
      }
      object: ObjectLiteral -> {
        return checkObject(object, scope, expected)
      }
      lambda: LambdaExpression -> { return checkLambda(lambda, scope, expected) }
      if_: IfExpression -> {
        requireBool(checkExpression(if_.condition, scope, optionalResolvedType(primitive("bool"))), if_.condition.span)
        return finish(expression, joinTypes(checkExpression(if_.then_, scope, expected), checkExpression(if_.else_, scope, expected)))
      }
      case_: CaseExpression -> { return finish(expression, checkCaseExpression(case_, scope, expected)) }
      construct: ConstructExpression -> { return checkConstruct(construct, scope, expected) }
      async_: AsyncExpression -> {
        case async_.expression {
          block: Block -> {
            checkBlock(block, scope)
            typeError("`async` is only valid for actor method calls; use a temporary actor for background work", async_.span)
            return finish(expression, promiseType(unknownType()))
          }
          inner: Expression -> {
            innerType := checkExpression(inner, scope, null)
            let actorCall = false
            case inner {
              call: CallExpression -> {
                case call.callee {
                  member: MemberExpression -> {
                    if member.object.resolvedType != null {
                      case member.object.resolvedType! {
                        _: ActorType -> { actorCall = true }
                        _ -> { }
                      }
                    }
                  }
                  _ -> { }
                }
              }
              _ -> { }
            }
            if !actorCall { typeError("`async` is only valid for actor method calls; use a temporary actor for background work", async_.span) }
            return finish(expression, promiseType(innerType))
          }
        }
      }
      retire_: RetireExpression -> {
        retiredType := checkExpression(retire_.actor, scope, null)
        case retiredType {
          actor: ActorType -> { return finish(expression, actor.innerClass) }
          _ -> { typeError("Cannot retire non-actor type \"" + typeName(retiredType) + "\"", retire_.span); return finish(expression, unknownType()) }
        }
      }
      actorCreation: ActorCreationExpression -> {
        symbol := symbolFor(info!, actorCreation.className)
        if symbol == null || symbol!.kind != "class" {
          for argument of actorCreation.args { checkExpression(argument, scope, null) }
          typeError("Actor requires a class type; \"" + actorCreation.className + "\" is not a class", actorCreation.span)
          return finish(expression, unknownType())
        }
        inner := classType(actorCreation.className, symbol!)
        constructorMethod := constructorForClass(inner, result)
        for i of 0..<actorCreation.args.length {
          let expectedArgument: ResolvedType | null = null
          if constructorMethod != null && i < constructorMethod!.params.length { expectedArgument = constructorMethod!.params[i].resolvedType }
          checkExpression(actorCreation.args[i], scope, expectedArgument)
        }
        return finish(expression, actorType(inner))
      }
      _: ThisExpression -> { return finish(expression, currentThisType(scope)) }
      _ -> { return finish(expression, unknownType()) }
    }
    return unknownType()
  }

  private function checkDotShorthand(expression: DotShorthand, expected: ResolvedType | null): ResolvedType {
    if expected == null { return finish(expression, unknownType()) }
    case expected! {
      enum_: EnumType -> {
        expression.resolvedShorthandOwnerName = enum_.name
        expression.resolvedShorthandOwnerKind = "enum"
        expression.resolvedShorthandOwnerModule = enum_.symbol.module
        return finish(expression, enum_)
      }
      class_: ClassType -> {
        expression.resolvedShorthandOwnerName = class_.name
        expression.resolvedShorthandOwnerKind = "class"
        expression.resolvedShorthandOwnerModule = class_.symbol.module
        return finish(expression, memberType(class_, expression.name, expression.span))
      }
      _ -> { }
    }
    return finish(expression, unknownType())
  }

  private function checkIdentifier(identifier: Identifier, scope: Scope): ResolvedType {
    let binding: Binding | null = lookup(scope, identifier.name)
    if binding == null { binding = implicitMethod(scope, identifier.name, identifier.span) }
    if binding == null && isBuiltinCallable(identifier.name) {
      binding = Binding { name: identifier.name, kind: "builtin", type_: builtinCallable(identifier.name), mutable: false, span: checkerSemanticSpan(identifier.span), module: info!.path }
    }
    if binding == null {
      typeError("Unknown identifier '" + identifier.name + "'", identifier.span)
      return finish(identifier, unknownType())
    }
    identifier.resolvedBinding = binding
    return finish(identifier, binding.type_)
  }

  private function implicitMethod(scope: Scope, name: string, span: SourceSpan): Binding | null {
    case currentThisType(scope) {
      owner: ClassType -> {
        declaration := declarationFor(result, owner.symbol)
        if declaration == null { return null }
        case declaration! {
          class_: ClassDeclaration -> {
            for method of class_.methods {
              if method.name == name {
                methodType := method.resolvedType ?? checkFunction(method, scope, owner)
                return Binding {
                  name, kind: "method", type_: methodType, mutable: false,
                  span: checkerSemanticSpan(span), module: info!.path, symbol: owner.symbol,
                }
              }
            }
          }
          _ -> { }
        }
      }
      _ -> { }
    }
    return null
  }

  private function addClassMethods(scope: Scope, owner: ClassType): void {
    declaration := declarationFor(result, owner.symbol)
    if declaration == null { return }
    case declaration! {
      class_: ClassDeclaration -> {
        for method of class_.methods {
          let methodType: ResolvedType = unknownType()
          if method.resolvedType != null {
            methodType = method.resolvedType!
          } else {
            // Predeclare methods without decorating their annotations.  This
            // helper runs while another method is being checked, so its scope
            // does not contain the method's own type parameters.  The owning
            // method check is the authority that decorates those annotations.
            let methodTypeParams: string[] = []
            for typeParam of class_.typeParams { methodTypeParams.push(typeParam) }
            for typeParam of method.typeParams { methodTypeParams.push(typeParam) }
            let parameters: FunctionParamType[] = []
            for parameter of method.params {
              parameterType := if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info!, result, methodTypeParams)
              parameters.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
            }
            returnType := if method.returnType == null then unknownType() else resolveAnnotation(method.returnType!, info!, result, methodTypeParams)
            methodType = functionType(parameters, returnType, method.typeParams)
          }
          declare(scope, Binding {
            name: method.name, kind: "method", type_: methodType, mutable: false,
            span: checkerSemanticSpan(method.span), module: info!.path, symbol: owner.symbol,
          })
        }
      }
      _ -> { }
    }
  }

  private function checkBinary(expression: BinaryExpression, scope: Scope): ResolvedType {
    let left: ResolvedType = unknownType()
    let right: ResolvedType = unknownType()
    case expression.left {
      _: DotShorthand -> {
        right = checkExpression(expression.right, scope, null)
        left = checkExpression(expression.left, scope, optionalResolvedType(right))
      }
      _ -> {
        case expression.right {
          _: DotShorthand -> {
            left = checkExpression(expression.left, scope, null)
            right = checkExpression(expression.right, scope, optionalResolvedType(left))
          }
          _ -> {
            left = checkExpression(expression.left, scope, null)
            right = checkExpression(expression.right, scope, null)
          }
        }
      }
    }
    operator := expression.operator
    if operator == "&&" || operator == "||" {
      requireBool(left, expression.left.span); requireBool(right, expression.right.span)
      return finish(expression, primitive("bool"))
    }
    if operator == "??" {
      return finish(expression, coalescedType(left, right))
    }
    if operator == "..<" || operator == ".." {
      return finish(expression, arrayType(primitive("int")))
    }
    if operator == "==" || operator == "!=" || operator == "<" || operator == "<=" || operator == ">" || operator == ">=" {
      return finish(expression, primitive("bool"))
    }
    if operator == "+" && typeName(left) == "string" && (typeName(right) == "string" || typeName(right) == "unknown") { return finish(expression, primitive("string")) }
    if operator == "+" && typeName(right) == "string" && typeName(left) == "unknown" { return finish(expression, primitive("string")) }
    if isNumeric(left) && isNumeric(right) { return finish(expression, numericResult(left, right)) }
    typeError("Operator '" + operator + "' is not defined for " + typeName(left) + " and " + typeName(right), expression.span)
    return finish(expression, unknownType())
  }

  private function coalescedType(left: ResolvedType, right: ResolvedType): ResolvedType {
    case left {
      union_: UnionResolvedType -> {
        let nonNull: ResolvedType | null = null
        for member of union_.types {
          if member.kind != "null" {
            nonNull = if nonNull == null then member else joinTypes(nonNull!, member)
          }
        }
        if nonNull == null { return right }
        return joinTypes(nonNull!, right)
      }
      _: NullType -> { return right }
      _ -> { return left }
    }
    return unknownType()
  }

  private function checkUnary(expression: UnaryExpression, scope: Scope): ResolvedType {
    value := checkExpression(expression.operand, scope, null)
    // Keep the operand decoration explicit at this boundary.  The emitter
    // consumes the operand node later, and must not reconstruct its type from
    // the unary result (notably for try! over imported Result functions).
          expression.operand.resolvedType = optionalResolvedType(value)
    if expression.operator == "try!" || expression.operator == "try?" {
      case value {
        result: ResultResolvedType -> {
          if result.valueType.kind == "void" {
            if expression.operator == "try?" { typeError("try? requires a Result with a success value", expression.span) }
            return finish(expression, result.valueType)
          }
          if expression.operator == "try?" { return finish(expression, unionType([result.valueType, nullType()])) }
          return finish(expression, result.valueType)
        }
        _ -> { typeError(expression.operator + " requires a Result expression", expression.span) }
      }
      return finish(expression, unknownType())
    }
    if !expression.prefix && expression.operator == "!" {
      case value {
        result: ResultResolvedType -> { return finish(expression, result.valueType) }
        _ -> { }
      }
      return finish(expression, nonNullType(value))
    }
    if expression.operator == "!" { requireBool(value, expression.span); return finish(expression, primitive("bool")) }
    if expression.operator == "+" || expression.operator == "-" || expression.operator == "~" {
      if !isNumeric(value) { typeError("Unary '" + expression.operator + "' requires a numeric operand", expression.span) }
      return finish(expression, value)
    }
    return finish(expression, value)
  }

  /** Validates checked narrowing and preserves its fallible Result shape. */
  private function checkAs(expression: AsExpression, scope: Scope): ResolvedType {
    sourceType := checkExpression(expression.expression, scope, null)
    targetType := resolveType(expression.targetType, info!, scope)
    case sourceType {
      result: ResultResolvedType -> {
        if !isValidAsNarrow(result.valueType, targetType) {
          typeError("Cannot narrow \"" + typeName(sourceType) + "\" to \"" + typeName(targetType) + "\" with \"as\"", expression.span)
          return finish(expression, unknownType())
        }
        return finish(expression, resultType(targetType, unionType([result.errorType, primitive("string")])))
      }
      _ -> { }
    }
    if !isValidAsNarrow(sourceType, targetType) {
      typeError("Cannot narrow \"" + typeName(sourceType) + "\" to \"" + typeName(targetType) + "\" with \"as\"", expression.span)
      return finish(expression, unknownType())
    }
    return finish(expression, resultType(targetType, primitive("string")))
  }

  private function isValidAsNarrow(source: ResolvedType, target: ResolvedType): bool {
    if sameType(source, target) { return true }
    if isNumeric(source) && isNumeric(target) { return true }
    case source {
      _: JsonValueResolvedType -> { return isJsonAsTarget(target) }
      union_: UnionResolvedType -> {
        for member of union_.types { if isValidAsNarrow(member, target) { return true } }
      }
      _: InterfaceType -> {
        case target {
          _: ClassType -> { return true }
          _ -> { }
        }
      }
      _ -> { }
    }
    return false
  }

  private function isJsonAsTarget(target: ResolvedType): bool {
    case target {
      primitiveType: PrimitiveType -> {
        return primitiveType.name == "bool" || primitiveType.name == "string" || isNumeric(primitiveType)
      }
      array: ArrayResolvedType -> { return isJsonValueType(array.elementType) }
      map: MapResolvedType -> { return sameType(map.keyType, primitive("string")) && isJsonValueType(map.valueType) }
      _: JsonValueResolvedType -> { return true }
      _ -> { return false }
    }
    return false
  }

  private function nonNullType(value: ResolvedType): ResolvedType {
    case value {
      union_: UnionResolvedType -> {
        let members: ResolvedType[] = []
        for member of union_.types { if member.kind != "null" { members.push(member) } }
        if members.length == 1 { return members[0] }
        if members.length > 1 { return unionType(members) }
        return unknownType()
      }
      _: NullType -> { return unknownType() }
      _ -> { return value }
    }
    return unknownType()
  }

  private function hasNullMember(value: UnionResolvedType): bool {
    for member of value.types { if member.kind == "null" { return true } }
    return false
  }

  private function checkAssignment(expression: AssignmentExpression, scope: Scope): ResolvedType {
    targetType := checkExpression(expression.target, scope, null)
    // Assignment emission needs the target decoration to choose representation
    // conversions, especially when a member is a nullable AST union field.
    finish(expression.target, targetType)
    case expression.target {
      identifier: Identifier -> {
        binding := lookup(scope, identifier.name)
        if binding != null {
          identifier.resolvedBinding = binding
          identifier.resolvedType = optionalResolvedType(binding!.type_)
        }
      }
      _ -> { }
    }
    value := checkExpression(expression.value, scope, optionalResolvedType(targetType))
    case expression.target {
      identifier: Identifier -> {
        target := lookup(scope, identifier.name)
        if target == null { typeError("Unknown assignment target '" + identifier.name + "'", identifier.span) }
        else {
          if !target!.mutable { typeError("Cannot assign to immutable binding '" + identifier.name + "'", identifier.span) }
          if !isAssignable(value, target!.type_) { typeError("Cannot assign " + typeName(value) + " to " + typeName(target!.type_), expression.span) }
        }
      }
      index: IndexExpression -> {
        objectType := checkExpression(index.object, scope, null)
        case objectType {
          array: ArrayResolvedType -> {
            checkExpression(index.index, scope, optionalResolvedType(primitive("int")))
            if array.readonly_ { typeError("Cannot assign through readonly array", expression.span) }
            if !isAssignable(value, array.elementType) { typeError("Cannot assign " + typeName(value) + " to " + typeName(array.elementType), expression.span) }
          }
          map: MapResolvedType -> {
            key := checkExpression(index.index, scope, optionalResolvedType(map.keyType))
            if !isAssignable(key, map.keyType) { typeError("Cannot use " + typeName(key) + " as map key " + typeName(map.keyType), index.index.span) }
            if map.readonly_ { typeError("Cannot assign through readonly map", expression.span) }
            if !isAssignable(value, map.valueType) { typeError("Cannot assign " + typeName(value) + " to " + typeName(map.valueType), expression.span) }
          }
          _ -> { typeError("Index assignment requires an array or map", expression.span) }
        }
      }
      member: MemberExpression -> {
        checkExpression(member.object, scope, null)
        targetType := memberType(checkExpression(member.object, scope, null), member.property, member.span)
        if !isAssignable(value, targetType) { typeError("Cannot assign " + typeName(value) + " to " + typeName(targetType), expression.span) }
      }
      _ -> { typeError("Assignment target must be a binding", expression.target.span) }
    }
    return finish(expression, value)
  }

  private function checkCall(expression: CallExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
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
            valueType = checkExpression(expression.args[0].value, scope, expectedValue)
          }
          if expectedResult != null {
            valueType = if expression.args.length == 0 then (if identifier.name == "Success" then expectedResult!.valueType else expectedResult!.errorType) else valueType
            identifier.resolvedType = optionalResolvedType(functionType([FunctionParamType { name: "value", type_: valueType, hasDefault: false }], expectedResult!))
            identifier.resolvedBinding = Binding { name: identifier.name, kind: "builtin", type_: functionType([FunctionParamType { name: "value", type_: valueType, hasDefault: false }], expectedResult!), mutable: false, span: checkerSemanticSpan(identifier.span), module: info!.path }
            return finish(expression, expectedResult!)
          }
          typeError(identifier.name + " requires an expected Result type", identifier.span)
          if identifier.name == "Success" { return finish(expression, resultType(valueType, unknownType())) }
          return finish(expression, resultType(unknownType(), valueType))
        }
      }
      _ -> { }
    }
    calleeType := checkExpression(expression.callee, scope, null)
    expression.resolvedFunction = functionDeclarationForCallee(expression.callee, calleeType, result)
    case calleeType {
      resolvedFunction: FunctionType -> {
        let effectiveFunction: FunctionType = resolvedFunction
        if expression.typeArgs.length > 0 {
          if expression.typeArgs.length != resolvedFunction.typeParams.length {
            typeError(
              "Generic call requires " + string(resolvedFunction.typeParams.length) + " type argument" + (if resolvedFunction.typeParams.length == 1 then "" else "s") + "; received " + string(expression.typeArgs.length),
              expression.span,
            )
          } else {
            let resolvedTypeArgs: ResolvedType[] = []
            for argument of expression.typeArgs { resolvedTypeArgs.push(resolveType(argument, info!, scope)) }
            expression.resolvedGenericTypeArgs = resolvedTypeArgs
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
              actual := checkExpression(expression.args[i].value, scope, resolvedFunction.params[i].type_)
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
              typeError("Named calls cannot contain positional arguments", argument.span)
              checkExpression(argument.value, scope, null)
              continue
            }
            index := functionParameterIndex(effectiveFunction.params, argument.name!)
            if index < 0 {
              typeError("Unknown named argument '" + argument.name! + "'", argument.span)
              checkExpression(argument.value, scope, null)
              continue
            }
            if containsString(used, argument.name!) { typeError("Duplicate named argument '" + argument.name! + "'", argument.span) }
            used.push(argument.name!)
            expected := effectiveFunction.params[index].type_
            actual := checkExpression(argument.value, scope, optionalResolvedType(expected))
            if !isAssignable(actual, expected) { typeError("Argument '" + argument.name! + "' has type " + typeName(actual) + "; expected " + typeName(expected), argument.span) }
          }
          for parameter of effectiveFunction.params {
            if !parameter.hasDefault && !containsString(used, parameter.name) {
              typeError("Missing required argument '" + parameter.name + "'", expression.span)
            }
          }
        } else {
          if expression.args.length > effectiveFunction.params.length { typeError("Too many arguments", expression.span) }
          for i of 0..<expression.args.length {
            expected := if i < effectiveFunction.params.length then effectiveFunction.params[i].type_ else unknownType()
            let argumentExpected: ResolvedType | null = expected
            if isBuiltinPrintlnCall(expression.callee) { argumentExpected = null }
            actual := checkExpression(expression.args[i].value, scope, argumentExpected)
            if !isAssignable(actual, expected) { typeError("Argument " + string(i + 1) + " has type " + typeName(actual) + "; expected " + typeName(expected), expression.args[i].span) }
          }
        }
        validateActorMethodBoundary(expression, effectiveFunction)
        return finish(expression, effectiveFunction.returnType)
      }
      class_: ClassType -> {
        if !insideConstructorFactory(scope, class_) { expression.resolvedConstructor = constructorForClass(class_, result) }
        constructorMethod := expression.resolvedConstructor
        for i of 0..<expression.args.length {
          let expectedArgument: ResolvedType | null = null
          if constructorMethod != null && i < constructorMethod!.params.length { expectedArgument = constructorMethod!.params[i].resolvedType }
          checkExpression(expression.args[i].value, scope, expectedArgument)
        }
        if constructorMethod != null {
          constructorType := constructorMethod!.resolvedType ?? methodSignature(constructorMethod!, classModuleFor(result, class_.symbol), result)
          case constructorType {
            function_: FunctionType -> { return finish(expression, function_.returnType) }
            _ -> { }
          }
        }
        return finish(expression, class_)
      }
      _: UnknownType -> {
        for argument of expression.args { checkExpression(argument.value, scope, null) }
        return finish(expression, unknownType())
      }
      _ -> { typeError("Expression of type " + typeName(calleeType) + " is not callable", expression.span); return finish(expression, unknownType()) }
    }
    return finish(expression, unknownType())
  }

  // Actor calls validate the effective method signature after generic
  // substitution; ordinary calls on the same class remain local calls.
  private function validateActorMethodBoundary(expression: CallExpression, method: FunctionType): void {
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
      violation := findActorBoundaryViolation(result, parameter.type_)
      if violation != null {
        typeError(
          "Actor method parameter \"" + parameter.name + "\" of type \"" + typeName(parameter.type_) + "\" cannot cross actor boundary for \"" + typeName(actor!) + "\": " + violation!.reason,
          expression.span,
        )
      }
    }
    returnViolation := findActorBoundaryViolation(result, method.returnType)
    if returnViolation != null {
      typeError(
        "Actor method return type \"" + typeName(method.returnType) + "\" cannot cross actor boundary for \"" + typeName(actor!) + "\": " + returnViolation!.reason,
        expression.span,
      )
    }
  }

  private function checkArray(expression: ArrayLiteral, scope: Scope, expected: ResolvedType | null): ResolvedType {
    if expected != null {
      case expected! {
        _: JsonValueResolvedType -> {
          for item of expression.elements {
            actual := checkExpression(item, scope, optionalResolvedType(jsonValueType()))
            if !isAssignable(actual, jsonValueType()) { typeError("Cannot assign " + typeName(actual) + " to JsonValue", item.span) }
          }
          return finish(expression, expected!)
        }
        union_: UnionResolvedType -> {
          if containsJsonValue(union_) {
            for item of expression.elements {
              actual := checkExpression(item, scope, optionalResolvedType(jsonValueType()))
              if !isAssignable(actual, jsonValueType()) { typeError("Cannot assign " + typeName(actual) + " to JsonValue", item.span) }
            }
            return finish(expression, jsonValueType())
          }
        }
        _ -> { }
      }
    }
    if expression.elements.length == 0 && expected != null {
      case expected! {
        _: ArrayResolvedType -> { return finish(expression, expected!) }
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
        actual := checkExpression(item, scope, optionalResolvedType(expectedElement!))
        if !isAssignable(actual, expectedElement!) { typeError("Cannot assign " + typeName(actual) + " to " + typeName(expectedElement!), item.span) }
      }
      case expected! {
        array: ArrayResolvedType -> { return finish(expression, arrayType(expectedElement!, array.readonly_)) }
        _ -> { }
      }
    }
    let element = unknownType()
    for item of expression.elements { element = joinTypes(element, checkExpression(item, scope, null)) }
    return finish(expression, arrayType(element, expression.readonly_))
  }

  private function checkObject(expression: ObjectLiteral, scope: Scope, expected: ResolvedType | null): ResolvedType {
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
              property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, propertyExpected))
            } else {
              binding := lookup(scope, property.name)
              if binding == null { typeError("Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
              else { property.resolvedType = optionalResolvedType(binding!.type_) }
            }
            if propertyExpected != null && !isAssignable(property.resolvedType!, propertyExpected!) {
              typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(propertyExpected!), property.span)
            }
          }
          if hasValue && hasError { typeError("Result object literal must contain either a 'value' field or an 'error' field, but not both", expression.span) }
          else if !hasValue && !hasError { typeError("Result object literal must contain a 'value' field or an 'error' field", expression.span) }
          else if recognized != expression.properties.length { typeError("Result object literal only supports 'value' and 'error' fields", expression.span) }
          return finish(expression, result)
        }
        class_: ClassType -> {
          declaration := declarationFor(result, class_.symbol)
          if declaration != null {
            case declaration! {
              classDeclaration: ClassDeclaration -> {
                expression.resolvedClass = classDeclaration
                for property of expression.properties {
                  field := findClassField(classDeclaration.fields, property.name)
                  if field == null || field!.static_ {
                    typeError("Unknown field '" + property.name + "' for " + class_.name, property.span)
                    continue
                  }
                  fieldType := memberType(class_, property.name, property.span)
                  if property.value != null { property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, optionalResolvedType(fieldType))) }
                  else {
                    binding := lookup(scope, property.name)
                    if binding == null { typeError("Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
                    else { property.resolvedType = optionalResolvedType(binding!.type_) }
                  }
                  if !isAssignable(property.resolvedType!, fieldType) { typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(fieldType), property.span) }
                }
                for field of classDeclaration.fields {
                  if field.static_ { continue }
                  for name of field.names {
                    if field.defaultValue == null && !hasObjectProperty(expression.properties, name) { typeError("Missing required field '" + name + "'", expression.span) }
                  }
                }
                return finish(expression, class_)
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
          if containsJsonValue(union_) { expectedValue = jsonValueType() }
        }
        map: MapResolvedType -> {
          if !sameType(map.keyType, primitive("string")) { typeError("Object literal keys must be strings", expression.span) }
          expectedValue = map.valueType
        }
        _ -> { }
      }
    }
    for property of expression.properties {
      if property.value != null {
        property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, expectedValue))
        if expectedValue != null && !isAssignable(property.resolvedType!, expectedValue!) {
          typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expectedValue!), property.span)
        }
      }
    }
    if expected != null {
      case expected! {
        _: JsonValueResolvedType -> { return finish(expression, expected!) }
        union_: UnionResolvedType -> { if containsJsonValue(union_) { return finish(expression, jsonValueType()) } }
        _: MapResolvedType -> { return finish(expression, expected!) }
        _ -> { }
      }
    }
    return finish(expression, mapType(primitive("string"), jsonValueType()))
  }

  private function containsJsonValue(union_: UnionResolvedType): bool {
    for member of union_.types { if isJsonValueType(member) { return true } }
    return false
  }

  private function checkLambda(expression: LambdaExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
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
      parameterType := if parameter.type_ == null then if expectedFunction != null && i < expectedFunction!.params.length then expectedFunction!.params[i].type_ else unknownType() else resolveType(parameter.type_!, info!, lambdaScope)
      parameter.resolvedType = optionalResolvedType(parameterType)
      params.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
      declare(lambdaScope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: checkerSemanticSpan(parameter.span), module: info!.path })
    }
    let returnType = if expectedFunction == null then unknownType() else expectedFunction!.returnType
    if expression.returnType != null {
      returnType = resolveType(expression.returnType!, info!, lambdaScope)
      decorateAnnotationWithResolved(expression.returnType!, returnType)
    }
    // A block lambda is its own return target. Without this scope boundary,
    // returns inside an escaping closure are checked against the enclosing
    // function's return type.
    lambdaScope.returnType = returnType
    case expression.body {
      block: Block -> { checkBlock(block, lambdaScope) }
      expressionBody: Expression -> { returnType = checkExpression(expressionBody, lambdaScope, optionalResolvedType(returnType)) }
    }
    return finish(expression, functionType(params, returnType))
  }

  private function checkConstruct(expression: ConstructExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
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
          valueType = checkExpression(property.value!, scope, propertyExpected)
          property.resolvedType = optionalResolvedType(valueType)
        }
      }
      if expectedResult != null { return finish(expression, expectedResult!) }
      if expression.type_ == "Success" { return finish(expression, resultType(valueType, unknownType())) }
      return finish(expression, resultType(unknownType(), valueType))
    }
    symbol := symbolFor(info!, expression.type_)
    if symbol == null { typeError("Unknown constructed type '" + expression.type_ + "'", expression.span); return finish(expression, unknownType()) }
    declaration := declarationFor(result, symbol!)
    if declaration != null {
      case declaration! {
        classDeclaration: ClassDeclaration -> { expression.resolvedClass = classDeclaration }
        _ -> { }
      }
    }
    let resolvedTypeArgs: ResolvedType[] = []
    for argument of expression.typeArgs { resolvedTypeArgs.push(resolveType(argument, info!, scope)) }
    constructed := classType(expression.type_, symbol!, resolvedTypeArgs)
    expression.resolvedConstructedType = optionalResolvedType(constructed)
    constructorMethod := constructorForClass(constructed, result)
    if constructorMethod != null && !insideConstructorFactory(scope, constructed) {
      expression.resolvedConstructor = constructorMethod
      constructorType := constructorMethod!.resolvedType ?? methodSignature(constructorMethod!, classModuleFor(result, symbol!), result)
      case constructorType {
        function_: FunctionType -> {
          for property of expression.args {
            parameterIndex := functionParameterIndex(function_.params, property.name)
            if parameterIndex < 0 {
              typeError("Unknown named argument '" + property.name + "'", property.span)
              if property.value != null { property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, null)) }
              continue
            }
            parameterType := function_.params[parameterIndex].type_
            if property.value != null {
              property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, optionalResolvedType(parameterType)))
            } else {
              binding := lookup(scope, property.name)
              if binding == null { typeError("Unknown shorthand property '" + property.name + "'", property.span); property.resolvedType = optionalResolvedType(unknownType()) }
              else { property.resolvedType = optionalResolvedType(binding!.type_) }
            }
            if !isAssignable(property.resolvedType!, parameterType) {
              typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(parameterType), property.span)
            }
          }
          for parameter of function_.params {
            if !parameter.hasDefault && !hasObjectProperty(expression.args, parameter.name) {
              typeError("Missing required argument '" + parameter.name + "'", expression.span)
            }
          }
          return finish(expression, function_.returnType)
        }
        _ -> { }
      }
    }
    for property of expression.args {
      expected := memberType(constructed, property.name, property.span)
      if property.value != null {
          property.resolvedType = optionalResolvedType(checkExpression(property.value!, scope, optionalResolvedType(expected)))
        if !isAssignable(property.resolvedType!, expected) {
          typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expected), property.span)
        }
      } else {
        binding := lookup(scope, property.name)
        if binding == null {
          typeError("Unknown shorthand property '" + property.name + "'", property.span)
        } else {
          property.resolvedType = optionalResolvedType(binding!.type_)
          if !isAssignable(property.resolvedType!, expected) {
            typeError("Cannot assign " + typeName(property.resolvedType!) + " to " + typeName(expected), property.span)
          }
        }
      }
    }
    return finish(expression, constructed)
  }

  private function callableField(objectType: ResolvedType, property: string): bool {
    let symbol: Symbol | null = null
    case objectType {
      class_: ClassType -> { symbol = class_.symbol }
      interface_: InterfaceType -> { symbol = interface_.symbol }
      _ -> { return false }
    }
    declaration := declarationFor(result, symbol!)
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

  private function resolveType(annotation: TypeAnnotation, module: ModuleInfo, scope: Scope): ResolvedType {
    case annotation {
      named: NamedType -> {
        if named.name == "void" { return decorateType(annotation, voidType()) }
        if named.name == "null" { return decorateType(annotation, nullType()) }
        if named.name == "JsonValue" { return decorateType(annotation, jsonValueType()) }
        if named.name == "JsonObject" { return decorateType(annotation, jsonObjectType()) }
        if named.name == "SourceLocation" { return decorateType(annotation, builtinSourceLocationType()) }
        if hasTypeParam(scope, named.name) { return decorateType(annotation, typeParameter(named.name)) }
        if named.name == "Tuple" {
          let elements: ResolvedType[] = []
          for argument of named.typeArgs { elements.push(resolveType(argument, module, scope)) }
          return decorateType(annotation, tupleType(elements))
        }
        if named.name == "Map" || named.name == "ReadonlyMap" {
          if named.typeArgs.length != 2 { typeError(named.name + " requires two type arguments", named.span); return decorateType(annotation, unknownType()) }
          key := resolveType(named.typeArgs[0], module, scope)
          value := resolveType(named.typeArgs[1], module, scope)
          return decorateType(annotation, mapType(key, value, named.name == "ReadonlyMap"))
        }
        if named.name == "Stream" {
          if named.typeArgs.length != 1 { typeError("Stream requires one type argument", named.span); return decorateType(annotation, unknownType()) }
          return decorateType(annotation, streamType(resolveType(named.typeArgs[0], module, scope)))
        }
        if named.name == "Actor" {
          if named.typeArgs.length != 1 { typeError("Actor requires one type argument", named.span); return decorateType(annotation, unknownType()) }
          inner := resolveType(named.typeArgs[0], module, scope)
          case inner {
            class_: ClassType -> { return decorateType(annotation, actorType(class_)) }
            _ -> { typeError("Actor requires a class type", named.span); return decorateType(annotation, unknownType()) }
          }
        }
        if named.name == "Promise" {
          if named.typeArgs.length != 1 { typeError("Promise requires one type argument", named.span); return decorateType(annotation, unknownType()) }
          return decorateType(annotation, promiseType(resolveType(named.typeArgs[0], module, scope)))
        }
        if named.name == "Result" {
          if named.typeArgs.length != 2 { typeError("Result requires two type arguments", named.span); return decorateType(annotation, unknownType()) }
          return decorateType(annotation, resultType(resolveType(named.typeArgs[0], module, scope), resolveType(named.typeArgs[1], module, scope)))
        }
        if named.name == "Success" || named.name == "Failure" {
          if named.typeArgs.length != 1 { typeError(named.name + " requires one type argument", named.span); return decorateType(annotation, unknownType()) }
          payload := resolveType(named.typeArgs[0], module, scope)
          if named.name == "Success" { return decorateType(annotation, resultType(payload, unknownType())) }
          return decorateType(annotation, resultType(unknownType(), payload))
        }
        if named.name == "byte" || named.name == "int" || named.name == "long" || named.name == "float" || named.name == "double" || named.name == "string" || named.name == "char" || named.name == "bool" {
          return decorateType(annotation, primitive(named.name))
        }
        let symbol: Symbol | null = named.resolvedSymbol
        if symbol == null { symbol = symbolFor(module, named.name) }
        if symbol == null { return decorateType(annotation, unknownType()) }
        if symbol!.kind == "type-alias" {
          declaration := declarationFor(result, symbol!)
          if declaration == null { return decorateType(annotation, unknownType()) }
          case declaration! {
            alias: TypeAliasDeclaration -> {
              if named.typeArgs.length != alias.typeParams.length {
                typeError(alias.name + " requires " + string(alias.typeParams.length) + " type argument" + (if alias.typeParams.length == 1 then "" else "s"), named.span)
                return decorateType(annotation, unknownType())
              }
              aliasScope := Scope { parent: scope }
              for typeParam of alias.typeParams { aliasScope.typeParams.push(typeParam) }
              let resolvedAlias = resolveType(alias.type_, classModuleFor(result, symbol!), aliasScope)
              let typeArgs: ResolvedType[] = []
              for argument of named.typeArgs { typeArgs.push(resolveType(argument, module, scope)) }
              resolvedAlias = substituteTypeParams(resolvedAlias, alias.typeParams, typeArgs)
              return decorateType(annotation, resolvedAlias)
            }
            _ -> { return decorateType(annotation, unknownType()) }
          }
        }
        if symbol!.kind == "interface" {
          let typeArgs: ResolvedType[] = []
          for argument of named.typeArgs { typeArgs.push(resolveType(argument, module, scope)) }
          concreteInterface := interfaceType(named.name, symbol!, typeArgs)
          if concreteTypes(typeArgs) { registerConcreteInterfaceImplementations(result, concreteInterface) }
          return decorateType(annotation, concreteInterface)
        }
        if symbol!.kind == "enum" { return decorateType(annotation, enumType(named.name, symbol!)) }
        let typeArgs: ResolvedType[] = []
        for argument of named.typeArgs { typeArgs.push(resolveType(argument, module, scope)) }
        return decorateType(annotation, classType(named.name, symbol!, typeArgs))
      }
      array: ArrayType -> { return decorateType(annotation, arrayType(resolveType(array.elementType, module, scope), array.readonly_)) }
      union: UnionType -> {
        let members: ResolvedType[] = []
        for item of union.types { members.push(resolveType(item, module, scope)) }
        return decorateType(annotation, unionType(members))
      }
      function_: AstFunctionType -> {
        let params: FunctionParamType[] = []
        for parameter of function_.params { params.push(FunctionParamType { name: parameter.name, type_: resolveType(parameter.type_, module, scope), hasDefault: false }) }
        return decorateType(annotation, functionType(params, resolveType(function_.returnType, module, scope)))
      }
    }
    return decorateType(annotation, unknownType())
  }

  private function decorateType(annotation: TypeAnnotation, resolvedType: ResolvedType): ResolvedType {
    annotation.resolvedType = optionalResolvedType(resolvedType)
    return resolvedType
  }

  private function memberType(object: ResolvedType, property: string, span: SourceSpan): ResolvedType {
    if typeName(object) == "string" {
      if property == "length" { return primitive("int") }
      if property == "startsWith" || property == "endsWith" || property == "contains" { return functionType([FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false }], primitive("bool")) }
      if property == "indexOf" { return functionType([FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false }], primitive("int")) }
      if property == "substring" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "end", type_: primitive("int"), hasDefault: true }], primitive("string")) }
      if property == "replaceAll" { return functionType([FunctionParamType { name: "oldValue", type_: primitive("string"), hasDefault: false }, FunctionParamType { name: "newValue", type_: primitive("string"), hasDefault: false }], primitive("string")) }
      if property == "trim" { return functionType([], primitive("string")) }
      if property == "trimEnd" { return functionType([FunctionParamType { name: "suffix", type_: primitive("char"), hasDefault: true }], primitive("string")) }
      if property == "toLowerCase" || property == "toUpperCase" { return functionType([], primitive("string")) }
      if property == "repeat" { return functionType([FunctionParamType { name: "count", type_: primitive("int"), hasDefault: false }], primitive("string")) }
      if property == "slice" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }], primitive("string")) }
      if property == "charAt" { return functionType([FunctionParamType { name: "index", type_: primitive("int"), hasDefault: false }], primitive("char")) }
      if property == "padStart" { return functionType([FunctionParamType { name: "length", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "fill", type_: primitive("char"), hasDefault: true }], primitive("string")) }
      if property == "split" { return functionType([FunctionParamType { name: "separator", type_: primitive("string"), hasDefault: false }], arrayType(primitive("string"))) }
    }
    case object {
      function_: FunctionType -> {
        if property == "call" { return function_ }
        if property == "post" { return functionType(function_.params, promiseType(function_.returnType)) }
        if property == "dispatch" {
          if function_.returnType.kind != "void" { typeError("Method \"dispatch\" is only available on void-returning callbacks", span); return unknownType() }
          return functionType(function_.params, voidType())
        }
        return unknownType()
      }
      union: UnionResolvedType -> {
        let resolved: ResolvedType | null = null
        for member of union.types {
          memberValue := memberType(member, property, span)
          if memberValue.kind == "unknown" { continue }
          resolved = if resolved == null then memberValue else joinTypes(resolved!, memberValue)
        }
        if resolved != null { return resolved! }
        return unknownType()
      }
      array: ArrayResolvedType -> {
        if property == "length" { return primitive("int") }
        if property == "push" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], voidType()) }
        if property == "contains" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], primitive("bool")) }
        if property == "indexOf" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], primitive("int")) }
        if property == "reserve" { return functionType([FunctionParamType { name: "capacity", type_: primitive("int"), hasDefault: false }], voidType()) }
        if property == "pop" { return functionType([], array.elementType) }
        if property == "some" || property == "every" {
          predicate := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], primitive("bool"))
          return functionType([FunctionParamType { name: "predicate", type_: predicate, hasDefault: false }], primitive("bool"))
        }
        if property == "filter" {
          predicate := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], primitive("bool"))
          return functionType([FunctionParamType { name: "predicate", type_: predicate, hasDefault: false }], arrayType(array.elementType, array.readonly_))
        }
        if property == "map" {
          mapped := typeParameter("U")
          mapper := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], mapped)
          return functionType([FunctionParamType { name: "mapper", type_: mapper, hasDefault: false }], arrayType(mapped, array.readonly_), ["U"])
        }
        if property == "slice" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "end", type_: primitive("int"), hasDefault: false }], arrayType(array.elementType, array.readonly_)) }
        if property == "buildReadonly" { return functionType([], arrayType(array.elementType, true)) }
        return unknownType()
      }
      map: MapResolvedType -> {
        if property == "size" { return primitive("int") }
        if property == "has" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }], primitive("bool")) }
        if property == "get" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }], resultType(map.valueType, primitive("string"))) }
        if property == "set" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }, FunctionParamType { name: "value", type_: map.valueType, hasDefault: false }], voidType()) }
        if property == "buildReadonly" { return functionType([], mapType(map.keyType, map.valueType, true)) }
        return unknownType()
      }
      result: ResultResolvedType -> {
        if property == "value" { return result.valueType }
        if property == "error" { return result.errorType }
        if property == "isSuccess" || property == "isFailure" { return functionType([], primitive("bool")) }
        return unknownType()
      }
      stream: StreamResolvedType -> {
        if property == "next" { return functionType([], primitive("bool")) }
        if property == "value" { return functionType([], stream.elementType) }
        return unknownType()
      }
      actor: ActorType -> { return memberType(actor.innerClass, property, span) }
      promise: PromiseType -> {
        if property == "get" { return functionType([], resultType(promise.valueType, primitive("string"))) }
        return unknownType()
      }
      enum_: EnumType -> {
        if property == "name" { return primitive("string") }
        if property == "value" { return primitive("int") }
        declaration := declarationFor(result, enum_.symbol)
        if declaration != null {
          case declaration! {
            enumDeclaration: EnumDeclaration -> {
              for variant of enumDeclaration.variants { if variant.name == property { return enum_ } }
            }
            _ -> { }
          }
        }
        return unknownType()
      }
      class_: ClassType -> {
        if class_.name == "SourceLocation" && class_.symbol.module == "<builtin>" {
          if property == "fileName" || property == "functionName" { return primitive("string") }
          if property == "line" { return primitive("int") }
          return unknownType()
        }
        declaration := declarationFor(result, class_.symbol)
        if declaration == null { return unknownType() }
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            if property == "toJsonObject" && canGenerateJsonSerialization(classDeclaration) {
              return functionType([], jsonObjectType())
            }
            if property == "fromJsonValue" && canGenerateJsonDeserialization(classDeclaration) {
              return functionType([
                FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false },
                FunctionParamType { name: "lenient", type_: primitive("bool"), hasDefault: true },
              ], resultType(object, primitive("string")))
            }
            if property == "toJsonObject" || property == "fromJsonValue" {
              typeError("Type \"" + classDeclaration.name + "\" does not support automatic JSON " + (if property == "toJsonObject" then "serialization" else "deserialization"), span)
              return unknownType()
            }
            for field of classDeclaration.fields {
              for name of field.names {
                if name == property {
                  fieldType := if field.resolvedType != null then field.resolvedType! else if field.type_ != null then resolveType(field.type_!, info!, moduleScope!) else unknownType()
                  return substituteTypeParams(fieldType, classDeclaration.typeParams, class_.typeArgs)
                }
              }
            }
            for method of classDeclaration.methods {
              if method.name == property {
                methodType := method.resolvedType ?? methodSignature(method, classModuleFor(result, class_.symbol), result)
                return substituteTypeParams(methodType, classDeclaration.typeParams, class_.typeArgs)
              }
            }
          }
          interface_: InterfaceDeclaration -> {
            for field of interface_.fields { if field.name == property { return field.resolvedType ?? resolveType(field.type_, info!, moduleScope!) } }
            for method of interface_.methods { if method.name == property { return method.resolvedType ?? methodSignature(method, classModuleFor(result, class_.symbol), result) } }
          }
          _ -> { }
        }
      }
      _: EnumType -> { return object }
      interfaceType_: InterfaceType -> {
        declaration := declarationFor(result, interfaceType_.symbol)
        if declaration == null { return unknownType() }
        case declaration! {
          interface_: InterfaceDeclaration -> {
            for field of interface_.fields {
              if field.name == property {
                fieldType := field.resolvedType ?? resolveType(field.type_, info!, moduleScope!)
                return substituteTypeParams(fieldType, interface_.typeParams, interfaceType_.typeArgs)
              }
            }
            for method of interface_.methods {
              if method.name == property {
                methodType := method.resolvedType ?? methodSignature(method, classModuleFor(result, interfaceType_.symbol), result)
                return substituteTypeParams(methodType, interface_.typeParams, interfaceType_.typeArgs)
              }
            }
          }
          _ -> { }
        }
      }
      _ -> { }
    }
    return unknownType()
  }

  private function indexType(object: ResolvedType, index: ResolvedType, span: SourceSpan): ResolvedType {
    case object {
      array: ArrayResolvedType -> {
        if !isAssignable(index, primitive("int")) && typeName(index) != "unknown" { typeError("Index must be an int", span) }
        return array.elementType
      }
      map: MapResolvedType -> {
        if !isAssignable(index, map.keyType) && typeName(index) != "unknown" { typeError("Invalid map key type", span) }
        return map.valueType
      }
      _: TupleResolvedType -> { return unknownType() }
      primitive_: PrimitiveType -> {
        if primitive_.name == "string" {
          if !isAssignable(index, primitive("int")) && typeName(index) != "unknown" { typeError("Index must be an int", span) }
          return primitive("char")
        }
      }
      _ -> { }
    }
    return unknownType()
  }

  private function inferredReturn(block: Block): ResolvedType {
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

  private function addClassFields(scope: Scope, owner: ClassType): void {
    declaration := declarationFor(result, owner.symbol)
    if declaration == null { return }
    case declaration! {
      class_: ClassDeclaration -> {
        for field of class_.fields {
          for name of field.names {
            declare(scope, Binding {
              name,
              kind: "field",
              type_: field.resolvedType ?? unknownType(),
              mutable: !field.readonly_,
              span: checkerSemanticSpan(field.span),
              module: info!.path,
            })
          }
        }
      }
      _ -> { }
    }
  }

  private function finish(expression: Expression, resolvedType: ResolvedType): ResolvedType { expression.resolvedType = optionalResolvedType(resolvedType); return resolvedType }
  private function typeError(message: string, span: SourceSpan): void { diagnostics.push(Diagnostic { severity: "error", message, span: checkerSemanticSpan(span), module: info!.path }) }
  private function requireBool(resolvedType: ResolvedType, span: SourceSpan): void { if typeName(resolvedType) != "bool" && typeName(resolvedType) != "unknown" { typeError("Expected bool, got " + typeName(resolvedType), span) } }

  // Keep the full AST union visible in this module's generated header.
  private function keepAstTypes(
    enum_: EnumDeclaration | null = null,
    import_: ImportDeclaration | null = null,
    export_: ExportDeclaration | null = null,
    exports_: ExportList | null = null,
    namedImport: NamedImport | null = null,
    namespaceImport: NamespaceImport | null = null,
    dot: DotShorthand | null = null,
    caller: CallerExpression | null = null,
    yield_: YieldStatement | null = null,
  ): void { }
}

function builtinSourceLocationType(): ClassType {
  return classType("SourceLocation", Symbol {
    kind: "class",
    name: "SourceLocation",
    module: "<builtin>",
    exported: true,
    native_: true,
    nativeHeader: "doof_runtime.hpp",
    nativeCppName: "doof::SourceLocation",
  })
}

function casePatternName(pattern: TypePattern): string {
  case pattern.type_ {
    named: NamedType -> {
      if named.name == "Success" || named.name == "Failure" { return named.name }
    }
    _ -> { }
  }
  return ""
}

function decorateAnnotationWithResolved(annotation: TypeAnnotation, resolved: ResolvedType): void {
  case annotation {
    named: NamedType -> {
      named.resolvedType = optionalResolvedType(resolved)
      case resolved {
        class_: ClassType -> {
          for i of 0..<named.typeArgs.length {
            if i < class_.typeArgs.length { decorateAnnotationWithResolved(named.typeArgs[i], class_.typeArgs[i]) }
          }
        }
        _ -> { }
      }
    }
    array: ArrayType -> {
      array.resolvedType = optionalResolvedType(resolved)
      case resolved {
        arrayResolved: ArrayResolvedType -> { decorateAnnotationWithResolved(array.elementType, arrayResolved.elementType) }
        _ -> { }
      }
    }
    union: UnionType -> {
      union.resolvedType = optionalResolvedType(resolved)
      case resolved {
        unionResolved: UnionResolvedType -> {
          for i of 0..<union.types.length {
            if i < unionResolved.types.length { decorateAnnotationWithResolved(union.types[i], unionResolved.types[i]) }
          }
        }
        _ -> { }
      }
    }
    function_: AstFunctionType -> {
      function_.resolvedType = optionalResolvedType(resolved)
      case resolved {
        functionResolved: FunctionType -> {
          for i of 0..<function_.params.length {
            if i < functionResolved.params.length { decorateAnnotationWithResolved(function_.params[i].type_, functionResolved.params[i].type_) }
          }
          decorateAnnotationWithResolved(function_.returnType, functionResolved.returnType)
        }
        _ -> { }
      }
    }
  }
}

// An unconditional loop completes normally only when its own body can break
// out. Breaks nested inside another loop belong to that inner loop and do not
// make the outer loop complete.
function blockContainsLoopExit(block: Block): bool {
  for statement of block.statements {
    case statement {
      _: BreakStatement -> { return true }
      if_: IfStatement -> {
        if blockContainsLoopExit(if_.body) { return true }
        for branch of if_.elseIfs { if blockContainsLoopExit(branch.body) { return true } }
        if if_.else_ != null && blockContainsLoopExit(if_.else_!) { return true }
      }
      case_: CaseStatement -> {
        for arm of case_.arms {
          case arm.body {
            armBlock: Block -> { if blockContainsLoopExit(armBlock) { return true } }
            _ -> { }
          }
        }
      }
      with_: WithStatement -> { if blockContainsLoopExit(with_.body) { return true } }
      nested: Block -> { if blockContainsLoopExit(nested) { return true } }
      _ -> { }
    }
  }
  return false
}

function optionalResolvedType(value: ResolvedType): ResolvedType | null { return value }

function functionParameterIndex(parameters: FunctionParamType[], name: string): int {
  for i of 0..<parameters.length { if parameters[i].name == name { return i } }
  return -1
}

function containsString(values: string[], value: string): bool {
  for existing of values { if existing == value { return true } }
  return false
}

function hasObjectProperty(properties: ObjectProperty[], name: string): bool {
  for property of properties { if property.name == name { return true } }
  return false
}

function predeclareModuleBindings(info: ModuleInfo, scope: Scope, result: AnalysisResult): void {
  for symbol of info.symbols {
    if symbol.kind == "function" || symbol.kind == "class" || symbol.kind == "struct" || symbol.kind == "interface" || symbol.kind == "enum" {
      declare(scope, Binding { name: symbol.name, kind: symbol.kind, type_: symbolType(symbol, info, result), mutable: false, span: checkerSemanticSpan(symbolSpan(info, symbol.name)), module: info.path, symbol })
    }
  }
  for imported of info.imports {
    if imported.symbol != null { declare(scope, Binding { name: imported.localName, kind: "import", type_: symbolType(imported.symbol!, info, result), mutable: false, span: checkerSemanticSpan(symbolSpan(info, imported.localName)), module: info.path, symbol: imported.symbol }) }
  }
}

function isNamespaceImport(info: ModuleInfo, name: string): bool {
  for imported of info.namespaceImports { if imported.localName == name { return true } }
  return false
}

function isBuiltinNamespace(name: string): bool {
  return name == "byte" || name == "int" || name == "long" || name == "float" || name == "double"
}

function builtinNamespaceMemberType(namespaceName: string, memberName: string): ResolvedType {
  if memberName == "parse" {
    return functionType([
      FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false },
    ], resultType(primitive(namespaceName), primitive("string")))
  }
  return unknownType()
}

function namespaceMemberType(info: ModuleInfo, namespaceName: string, memberName: string, result: AnalysisResult): ResolvedType {
  for imported of info.namespaceImports {
    if imported.localName != namespaceName { continue }
    source := findModule(result, imported.sourceModule)
    if source == null { return unknownType() }
    for symbol of source!.exports {
      if symbol.name == memberName { return symbolType(symbol, source!, result) }
    }
  }
  return unknownType()
}

function symbolType(symbol: Symbol, info: ModuleInfo, result: AnalysisResult): ResolvedType {
  if symbol.kind == "class" || symbol.kind == "struct" { return classType(symbol.name, symbol) }
  if symbol.kind == "interface" { return interfaceType(symbol.name, symbol) }
  if symbol.kind == "enum" { return enumType(symbol.name, symbol) }
  declaration := declarationFor(result, symbol)
  if declaration == null { return unknownType() }
  case declaration! {
    fn: FunctionDeclaration -> {
      if fn.resolvedType != null {
        case fn.resolvedType! {
          resolved: FunctionType -> { return resolved }
          _ -> { }
        }
      }
      return functionType(functionParametersFor(fn, info, result), if fn.returnType == null then unknownType() else resolveAnnotation(fn.returnType!, info, result, fn.typeParams), fn.typeParams)
    }
    alias: TypeAliasDeclaration -> { return resolveAnnotation(alias.type_, info, result) }
    _ -> { return unknownType() }
  }
  return unknownType()
}

// Imported member lookup needs a declaration's signature without checking its
// body in the caller's module scope. This also keeps cross-module context
// objects usable when their implementation methods refer to local imports.
function methodSignature(method: FunctionDeclaration, info: ModuleInfo, result: AnalysisResult): ResolvedType {
  let parameters: FunctionParamType[] = []
  for parameter of method.params {
    parameterType := if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info, result, method.typeParams)
    parameters.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
  }
  return functionType(parameters, if method.returnType == null then unknownType() else resolveAnnotation(method.returnType!, info, result, method.typeParams), method.typeParams)
}

function functionParametersFor(fn: FunctionDeclaration, info: ModuleInfo, result: AnalysisResult): FunctionParamType[] {
  let resultTypes: FunctionParamType[] = []
  for parameter of fn.params {
    parameterType := if parameter.resolvedType != null then parameter.resolvedType! else if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info, result, fn.typeParams)
    resultTypes.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
  }
  return resultTypes
}

function resolveAnnotation(annotation: TypeAnnotation, info: ModuleInfo, result: AnalysisResult, typeParams: string[] = []): ResolvedType {
  // ModuleChecker performs the full alias walk.  This helper handles the
  // declaration types needed to predeclare recursive functions.
  case annotation {
    named: NamedType -> {
      if named.name == "void" { return voidType() }
      if named.name == "null" { return nullType() }
      if named.name == "JsonValue" { return jsonValueType() }
      if named.name == "JsonObject" { return jsonObjectType() }
      if named.name == "SourceLocation" { return builtinSourceLocationType() }
      for typeParam of typeParams { if named.name == typeParam { return typeParameter(named.name) } }
      if named.name == "Tuple" {
        let elements: ResolvedType[] = []
        for argument of named.typeArgs { elements.push(resolveAnnotation(argument, info, result, typeParams)) }
        return tupleType(elements)
      }
      if named.name == "Map" || named.name == "ReadonlyMap" {
        let key: ResolvedType = unknownType()
        let value: ResolvedType = unknownType()
        if named.typeArgs.length >= 2 {
          key = resolveAnnotation(named.typeArgs[0], info, result, typeParams)
          value = resolveAnnotation(named.typeArgs[1], info, result, typeParams)
        }
        return mapType(key, value, named.name == "ReadonlyMap")
      }
      if named.name == "Stream" && named.typeArgs.length >= 1 { return streamType(resolveAnnotation(named.typeArgs[0], info, result, typeParams)) }
      if named.name == "Actor" && named.typeArgs.length == 1 {
        inner := resolveAnnotation(named.typeArgs[0], info, result, typeParams)
        case inner {
          class_: ClassType -> { return actorType(class_) }
          _ -> { return unknownType() }
        }
      }
      if named.name == "Promise" && named.typeArgs.length == 1 { return promiseType(resolveAnnotation(named.typeArgs[0], info, result, typeParams)) }
      if named.name == "Result" && named.typeArgs.length >= 2 {
        let value: ResolvedType | null = null
        let error: ResolvedType | null = null
        let index = 0
        for typeArg of named.typeArgs {
          if index == 0 { value = resolveAnnotation(typeArg, info, result, typeParams) }
          if index == 1 { error = resolveAnnotation(typeArg, info, result, typeParams) }
          index = index + 1
        }
        return resultType(value!, error!)
      }
      if (named.name == "Success" || named.name == "Failure") && named.typeArgs.length == 1 {
        payload := resolveAnnotation(named.typeArgs[0], info, result, typeParams)
        if named.name == "Success" { return resultType(payload, unknownType()) }
        return resultType(unknownType(), payload)
      }
      if named.name == "byte" || named.name == "int" || named.name == "long" || named.name == "float" || named.name == "double" || named.name == "string" || named.name == "char" || named.name == "bool" { return primitive(named.name) }
      symbol := named.resolvedSymbol ?? symbolFor(info, named.name)
      if symbol == null { return unknownType() }
      if symbol!.kind == "type-alias" {
        declaration := declarationFor(result, symbol!)
        if declaration == null { return unknownType() }
        case declaration! {
          alias: TypeAliasDeclaration -> {
            let aliasParams: string[] = []
            for outer of typeParams { aliasParams.push(outer) }
            for parameter of alias.typeParams { aliasParams.push(parameter) }
            resolvedAlias := resolveAnnotation(alias.type_, classModuleFor(result, symbol!), result, aliasParams)
            let arguments: ResolvedType[] = []
            for argument of named.typeArgs { arguments.push(resolveAnnotation(argument, info, result, typeParams)) }
            return substituteTypeParams(resolvedAlias, alias.typeParams, arguments)
          }
          _ -> { return unknownType() }
        }
      }
      if symbol!.kind == "interface" {
        let typeArgs: ResolvedType[] = []
        for argument of named.typeArgs { typeArgs.push(resolveAnnotation(argument, info, result, typeParams)) }
        return interfaceType(named.name, symbol!, typeArgs)
      }
      if symbol!.kind == "enum" { return enumType(named.name, symbol!) }
      let typeArgs: ResolvedType[] = []
      for argument of named.typeArgs { typeArgs.push(resolveAnnotation(argument, info, result, typeParams)) }
      return classType(named.name, symbol!, typeArgs)
    }
    array: ArrayType -> { return arrayType(resolveAnnotation(array.elementType, info, result, typeParams), array.readonly_) }
    union: UnionType -> {
      let members: ResolvedType[] = []
      for item of union.types { members.push(resolveAnnotation(item, info, result, typeParams)) }
      return unionType(members)
    }
    function_: AstFunctionType -> {
      let params: FunctionParamType[] = []
      for parameter of function_.params {
        params.push(FunctionParamType { name: parameter.name, type_: resolveAnnotation(parameter.type_, info, result, typeParams), hasDefault: false })
      }
      return functionType(params, resolveAnnotation(function_.returnType, info, result, typeParams))
    }
  }
  return unknownType()
}

function declare(scope: Scope, binding: Binding): void {
  for existing of scope.bindings { if existing.name == binding.name { return } }
  scope.bindings.push(binding)
}

// Parameters intentionally shadow implicit field and method bindings.
function declareShadowing(scope: Scope, binding: Binding): void {
  for index of 0..<scope.bindings.length {
    if scope.bindings[index].name == binding.name {
      scope.bindings[index] = binding
      return
    }
  }
  scope.bindings.push(binding)
}

function hasTypeParam(scope: Scope, name: string): bool {
  let current: Scope | null = scope
  while current != null {
    for typeParam of current!.typeParams { if typeParam == name { return true } }
    current = current!.parent
  }
  return false
}

function lookup(scope: Scope, name: string): Binding | null {
  let current: Scope | null = scope
  while current != null {
    for binding of current!.bindings { if binding.name == name { return binding } }
    current = current!.parent
  }
  return null
}

function returnScope(scope: Scope): Scope | null {
  let current: Scope | null = scope
  while current != null {
    if current!.returnType != null { return current }
    current = current!.parent
  }
  return null
}

function valueYieldScope(scope: Scope): Scope | null {
  let current: Scope | null = scope
  while current != null {
    if current!.inValueYieldBlock { return current }
    current = current!.parent
  }
  return null
}

function currentThisType(scope: Scope): ResolvedType {
  let current: Scope | null = scope
  while current != null {
    if current!.thisType != null { return current!.thisType! }
    current = current!.parent
  }
  return unknownType()
}

function iterableElement(iterable: ResolvedType): ResolvedType {
  case iterable {
    array: ArrayResolvedType -> { return array.elementType }
    map: MapResolvedType -> { return tupleType([map.keyType, map.valueType]) }
    stream: StreamResolvedType -> { return stream.elementType }
    _ -> { return unknownType() }
  }
  return unknownType()
}

function isBuiltinCallable(name: string): bool {
  return name == "byte" || name == "string" || name == "int" || name == "long" || name == "float" || name == "double" || name == "bool" || name == "println" || name == "panic" || name == "assert" || name == "catchPanic" || name == "absolutePath" || name == "Success" || name == "Failure"
}

function isPanicCall(expression: Expression): bool {
  case expression {
    call: CallExpression -> {
      case call.callee {
        identifier: Identifier -> {
          return identifier.name == "panic" && identifier.resolvedBinding != null && identifier.resolvedBinding!.kind == "builtin"
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return false
}

function builtinCallable(name: string): ResolvedType {
  if name == "absolutePath" {
    return functionType([FunctionParamType { name: "path", type_: primitive("string"), hasDefault: false }], primitive("string"))
  }
  if name == "println" { return functionType([FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false }], voidType()) }
  if name == "panic" { return functionType([FunctionParamType { name: "message", type_: primitive("string"), hasDefault: false }], voidType()) }
  if name == "assert" {
    return functionType([
      FunctionParamType { name: "condition", type_: primitive("bool"), hasDefault: false },
      FunctionParamType { name: "message", type_: primitive("string"), hasDefault: false },
    ], voidType())
  }
  if name == "catchPanic" {
    successType := typeParameter("T")
    callbackType := functionType([], successType)
    return functionType([
      FunctionParamType { name: "f", type_: callbackType, hasDefault: false },
    ], resultType(successType, primitive("string")), ["T"])
  }
  result := primitive(name)
  return functionType([FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false }], result)
}

function isBuiltinPrintlnCall(callee: Expression): bool {
  case callee {
    identifier: Identifier -> { return identifier.name == "println" }
    _ -> { return false }
  }
}

function symbolFor(info: ModuleInfo, name: string): Symbol | null {
  for symbol of info.symbols { if symbol.name == name { return symbol } }
  for imported of info.imports { if imported.localName == name { return imported.symbol } }
  return null
}

function declarationFor(result: AnalysisResult, symbol: Symbol): Statement | null {
  module := findModule(result, symbol.module)
  if module == null { return null }
  for statement of module!.program.statements {
    if statement.kind == "export-list" { continue }
    candidate := symbolName(statement)
    if candidate == symbol.name { return statement }
  }
  return null
}

function symbolName(statement: Statement): string {
  case statement {
    class_: ClassDeclaration -> { return class_.name }
    fn: FunctionDeclaration -> { return fn.name }
    interface_: InterfaceDeclaration -> { return interface_.name }
    enum_: EnumDeclaration -> { return enum_.name }
    alias: TypeAliasDeclaration -> { return alias.name }
    const_: ConstDeclaration -> { return const_.name }
    readonly_: ReadonlyDeclaration -> { return readonly_.name }
    binding: ImmutableBinding -> { return binding.name }
    let_: LetDeclaration -> { return let_.name }
    _ -> { return "" }
  }
  return ""
}

// Infer one generic argument by structurally matching a checked parameter
// pattern against the concrete argument type. Conflicting candidates are
// rejected by the caller before substitution.
function inferTypeArgument(pattern: ResolvedType, actual: ResolvedType, name: string): ResolvedType | null {
  case pattern {
    parameter: TypeParameterType -> { if parameter.name == name { return actual } }
    array: ArrayResolvedType -> {
      case actual {
        concrete: ArrayResolvedType -> { return inferTypeArgument(array.elementType, concrete.elementType, name) }
        _ -> { }
      }
    }
    map: MapResolvedType -> {
      case actual {
        concrete: MapResolvedType -> {
          key := inferTypeArgument(map.keyType, concrete.keyType, name)
          if key != null { return key }
          return inferTypeArgument(map.valueType, concrete.valueType, name)
        }
        _ -> { }
      }
    }
    stream: StreamResolvedType -> {
      case actual {
        concrete: StreamResolvedType -> { return inferTypeArgument(stream.elementType, concrete.elementType, name) }
        _ -> { }
      }
    }
    class_: ClassType -> {
      case actual {
        concrete: ClassType -> {
          if class_.symbol.module != concrete.symbol.module || class_.symbol.name != concrete.symbol.name { return null }
          for i of 0..<class_.typeArgs.length {
            if i < concrete.typeArgs.length {
              candidate := inferTypeArgument(class_.typeArgs[i], concrete.typeArgs[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    interface_: InterfaceType -> {
      case actual {
        concrete: InterfaceType -> {
          for i of 0..<interface_.typeArgs.length {
            if i < concrete.typeArgs.length {
              candidate := inferTypeArgument(interface_.typeArgs[i], concrete.typeArgs[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    function_: FunctionType -> {
      case actual {
        concrete: FunctionType -> {
          for i of 0..<function_.params.length {
            if i < concrete.params.length {
              candidate := inferTypeArgument(function_.params[i].type_, concrete.params[i].type_, name)
              if candidate != null { return candidate }
            }
          }
          return inferTypeArgument(function_.returnType, concrete.returnType, name)
        }
        _ -> { }
      }
    }
    result_: ResultResolvedType -> {
      case actual {
        concrete: ResultResolvedType -> {
          value := inferTypeArgument(result_.valueType, concrete.valueType, name)
          if value != null { return value }
          return inferTypeArgument(result_.errorType, concrete.errorType, name)
        }
        _ -> { }
      }
    }
    tuple: TupleResolvedType -> {
      case actual {
        concrete: TupleResolvedType -> {
          for i of 0..<tuple.elements.length {
            if i < concrete.elements.length {
              candidate := inferTypeArgument(tuple.elements[i], concrete.elements[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return null
}

function symbolSpan(info: ModuleInfo, name: string): SourceSpan {
  for statement of info.program.statements { if symbolName(statement) == name { return statement.span } }
  return info.program.span
}

function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

// Interface lowering is closed-world: every class in the analyzed graph is a
// candidate, including classes that do not spell an explicit `implements` list.
// Populate this map before checking expressions so ordinary assignment and
// return compatibility can use the same structural result as emission.
function discoverInterfaceImplementations(result: AnalysisResult): void {
  for interfaceModule of result.modules {
    for interfaceSymbol of interfaceModule.symbols {
      if interfaceSymbol.kind != "interface" { continue }
      for classModule of result.modules {
        for classSymbol of classModule.symbols {
          if classSymbol.kind != "class" { continue }
          if classSatisfiesInterface(result, classSymbol, interfaceSymbol) {
            if !containsImplementation(interfaceSymbol.implementations, classSymbol) {
              interfaceSymbol.implementations.push(classSymbol)
            }
          }
        }
      }
    }
  }
}

function containsImplementation(implementations: Symbol[], candidate: Symbol): bool {
  for implementation of implementations {
    if implementation.module == candidate.module && implementation.name == candidate.name { return true }
  }
  return false
}

function addImplementedInterfaceType(symbol: Symbol, name: string): void {
  for existing of symbol.implementedInterfaceTypes { if existing == name { return } }
  symbol.implementedInterfaceTypes.push(name)
}

// Concrete generic interfaces remain structural. Record matching ordinary
// classes as soon as a concrete interface use is resolved so subsequent
// assignment and call compatibility can use the normal assignability path.
function registerConcreteInterfaceImplementations(result: AnalysisResult, interface_: InterfaceType): void {
  for module of result.modules {
    for symbol of module.symbols {
      if symbol.kind != "class" { continue }
      declaration := declarationFor(result, symbol)
      if declaration == null { continue }
      case declaration! {
        class_: ClassDeclaration -> {
          if class_.typeParams.length == 0 && classSatisfiesConcreteInterface(result, class_, classType(class_.name, symbol), interface_) {
            addImplementedInterfaceType(symbol, typeName(interface_))
          }
        }
        _ -> { }
      }
    }
  }
}

function concreteTypes(types: ResolvedType[]): bool {
  for type_ of types {
    case type_ {
      _: TypeParameterType -> { return false }
      class_: ClassType -> { if !concreteTypes(class_.typeArgs) { return false } }
      interface_: InterfaceType -> { if !concreteTypes(interface_.typeArgs) { return false } }
      array: ArrayResolvedType -> { if !concreteTypes([array.elementType]) { return false } }
      map: MapResolvedType -> { if !concreteTypes([map.keyType, map.valueType]) { return false } }
      stream: StreamResolvedType -> { if !concreteTypes([stream.elementType]) { return false } }
      result_: ResultResolvedType -> { if !concreteTypes([result_.valueType, result_.errorType]) { return false } }
      tuple: TupleResolvedType -> { if !concreteTypes(tuple.elements) { return false } }
      union_: UnionResolvedType -> { if !concreteTypes(union_.types) { return false } }
      function_: FunctionType -> {
        for parameter of function_.params { if !concreteTypes([parameter.type_]) { return false } }
        if !concreteTypes([function_.returnType]) { return false }
      }
      _ -> { }
    }
  }
  return true
}

function classSatisfiesConcreteInterface(result: AnalysisResult, class_: ClassDeclaration, classType_: ClassType, interfaceType_: InterfaceType): bool {
  declaration := declarationFor(result, interfaceType_.symbol)
  if declaration == null { return false }
  case declaration! {
    interface_: InterfaceDeclaration -> {
      for required of interface_.fields {
        actualField := findClassField(class_.fields, required.name)
        if actualField == null || actualField!.type_ == null { return false }
        actualBase := if actualField!.resolvedType == null then resolveAnnotation(actualField!.type_!, classModuleFor(result, classType_.symbol), result, class_.typeParams) else actualField!.resolvedType!
        requiredBase := if required.resolvedType == null then resolveAnnotation(required.type_, classModuleFor(result, interfaceType_.symbol), result, interface_.typeParams) else required.resolvedType!
        actual := substituteTypeParams(actualBase, class_.typeParams, classType_.typeArgs)
        expected := substituteTypeParams(requiredBase, interface_.typeParams, interfaceType_.typeArgs)
        if !isAssignable(actual, expected) { return false }
      }
      for requiredMethod of interface_.methods {
        actualMethod := findClassMethod(class_.methods, requiredMethod.name, requiredMethod.static_)
        if actualMethod == null { return false }
        actualBase := if actualMethod!.resolvedType == null then methodSignature(actualMethod!, classModuleFor(result, classType_.symbol), result) else actualMethod!.resolvedType!
        requiredBase := if requiredMethod.resolvedType == null then methodSignature(requiredMethod, classModuleFor(result, interfaceType_.symbol), result) else requiredMethod.resolvedType!
        actual := substituteTypeParams(actualBase, class_.typeParams, classType_.typeArgs)
        expected := substituteTypeParams(requiredBase, interface_.typeParams, interfaceType_.typeArgs)
        if !sameConcreteMethodType(actual, expected) { return false }
      }
      return true
    }
    _ -> { return false }
  }
  return false
}

function classSatisfiesInterface(result: AnalysisResult, classSymbol: Symbol, interfaceSymbol: Symbol): bool {
  classDeclaration := declarationFor(result, classSymbol)
  interfaceDeclaration := declarationFor(result, interfaceSymbol)
  if classDeclaration == null || interfaceDeclaration == null { return false }
  case classDeclaration! {
    class_: ClassDeclaration -> {
      case interfaceDeclaration! {
        interface_: InterfaceDeclaration -> {
          for required of interface_.fields {
            classField := findClassField(class_.fields, required.name)
            if classField == null { return false }
            actual := if classField!.resolvedType == null then resolveAnnotation(classField!.type_!, classModuleFor(result, classSymbol), result) else classField!.resolvedType!
            expected := if required.resolvedType == null then resolveAnnotation(required.type_, classModuleFor(result, interfaceSymbol), result) else required.resolvedType!
            if !isAssignable(actual, expected) { return false }
          }
          for requiredMethod of interface_.methods {
            classMethod := findClassMethod(class_.methods, requiredMethod.name, requiredMethod.static_)
            if classMethod == null || classMethod!.params.length != requiredMethod.params.length { return false }
            if !sameFunctionSignature(classMethod!, requiredMethod, result, classSymbol, interfaceSymbol) { return false }
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

function sameConcreteMethodType(actual: ResolvedType, expected: ResolvedType): bool {
  case actual {
    actualFunction: FunctionType -> {
      case expected {
        expectedFunction: FunctionType -> {
          if actualFunction.params.length != expectedFunction.params.length { return false }
          for index of 0..<actualFunction.params.length {
            if !sameType(actualFunction.params[index].type_, expectedFunction.params[index].type_) { return false }
          }
          return sameType(actualFunction.returnType, expectedFunction.returnType)
        }
        _ -> { return false }
      }
    }
    _ -> { return sameType(actual, expected) }
  }
  return false
}

function findClassField(fields: ClassField[], name: string): ClassField | null {
  for field of fields { for fieldName of field.names { if fieldName == name { return field } } }
  return null
}

function findClassMethod(methods: FunctionDeclaration[], name: string, static_: bool): FunctionDeclaration | null {
  for method of methods { if method.name == name && method.static_ == static_ { return method } }
  return null
}

function sameFunctionSignature(classMethod: FunctionDeclaration, interfaceMethod: FunctionDeclaration, result: AnalysisResult, classSymbol: Symbol, interfaceSymbol: Symbol): bool {
  classModule := classModuleFor(result, classSymbol)
  interfaceModule := classModuleFor(result, interfaceSymbol)
  for i of 0..<classMethod.params.length {
    actualParameterType := if classMethod.params[i].resolvedType == null then resolveAnnotation(classMethod.params[i].type_!, classModule, result) else classMethod.params[i].resolvedType!
    interfaceType_ := if interfaceMethod.params[i].resolvedType == null then resolveAnnotation(interfaceMethod.params[i].type_!, interfaceModule, result) else interfaceMethod.params[i].resolvedType!
    if !sameType(actualParameterType, interfaceType_) { return false }
  }
  if classMethod.returnType == null || interfaceMethod.returnType == null { return classMethod.returnType == null && interfaceMethod.returnType == null }
  classReturn := resolveAnnotation(classMethod.returnType!, classModule, result)
  interfaceReturn := resolveAnnotation(interfaceMethod.returnType!, interfaceModule, result)
  return isAssignable(classReturn, interfaceReturn)
}

function classModuleFor(result: AnalysisResult, symbol: Symbol): ModuleInfo {
  module := findModule(result, symbol.module)
  if module == null { panic("Missing module for symbol " + symbol.name) }
  return module!
}

export function createChecker(result: AnalysisResult): ModuleChecker {
  return ModuleChecker { result }
}

// Resolve declaration targets while the checker still owns the module graph.
// The emitter receives these pointers as part of the decorated AST and never
// scans declarations to rediscover call defaults, constructors, or static
// members.
function functionDeclarationForCallee(callee: Expression, calleeType: ResolvedType, result: AnalysisResult): FunctionDeclaration | null {
  case callee {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null && identifier.resolvedBinding!.symbol != null {
        symbol := identifier.resolvedBinding!.symbol!
        declaration := declarationFor(result, symbol)
        if declaration != null {
          case declaration! {
            fn: FunctionDeclaration -> { return fn }
            class_: ClassDeclaration -> {
              let method = findClassMethod(class_.methods, identifier.name, false)
              if method != null { return method }
              method = findClassMethod(class_.methods, identifier.name, true)
              if method != null { return method }
            }
            _ -> { }
          }
        }
      }
    }
    member: MemberExpression -> {
      objectType := member.object.resolvedType
      if objectType != null {
        case objectType! {
          class_: ClassType -> {
            declaration := declarationFor(result, class_.symbol)
            if declaration != null {
              case declaration! {
                classDeclaration: ClassDeclaration -> {
                  let method = findClassMethod(classDeclaration.methods, member.property, false)
                  if method != null { return method }
                  method = findClassMethod(classDeclaration.methods, member.property, true)
                  if method != null { return method }
                }
                _ -> { }
              }
            }
          }
          interface_: InterfaceType -> {
            declaration := declarationFor(result, interface_.symbol)
            if declaration != null {
              case declaration! {
                interfaceDeclaration: InterfaceDeclaration -> {
                  for method of interfaceDeclaration.methods { if method.name == member.property { return method } }
                }
                _ -> { }
              }
            }
          }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  return null
}

function constructorForClass(class_: ClassType, result: AnalysisResult): FunctionDeclaration | null {
  declaration := declarationFor(result, class_.symbol)
  if declaration == null { return null }
  case declaration! {
    classDeclaration: ClassDeclaration -> {
      for method of classDeclaration.methods { if method.name == "constructor" { return method } }
    }
    _ -> { }
  }
  return null
}

function insideConstructorFactory(scope: Scope, class_: ClassType): bool {
  let current: Scope | null = scope
  while current != null {
    if current!.functionName != "" {
      if current!.functionName != "constructor" { return false }
      if current!.thisType == null { return false }
      case current!.thisType! {
        owner: ClassType -> { return owner.symbol.module == class_.symbol.module && owner.symbol.name == class_.symbol.name }
        _ -> { return false }
      }
    }
    current = current!.parent
  }
  return false
}

function staticMemberOwner(objectType: ResolvedType, property: string, result: AnalysisResult): ClassDeclaration | null {
  case objectType {
    class_: ClassType -> {
      declaration := declarationFor(result, class_.symbol)
      if declaration != null {
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            if property == "fromJsonValue" && canGenerateJsonDeserialization(classDeclaration) { return classDeclaration }
            for method of classDeclaration.methods { if method.name == property && method.static_ { return classDeclaration } }
            for field of classDeclaration.fields {
              for name of field.names { if name == property && field.static_ { return classDeclaration } }
            }
          }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  return null
}

// Emission is intentionally a pure consumer of decorated AST data.  This
// graph-wide validation is the last front-end boundary: a missing decoration
// or an UnknownType anywhere in a declaration, binding, annotation, or nested
// expression is a compilation error, so the emitter never needs recovery
// lookups or syntactic fallbacks.
export function validateCheckedTypes(result: AnalysisResult): Diagnostic[] {
  let diagnostics: Diagnostic[] = []
  for module of result.modules {
    for statement of module.program.statements { validateStatement(statement, module.path, diagnostics) }
  }
  return diagnostics
}

function validateStatement(statement: Statement, module: string, diagnostics: Diagnostic[]): void {
  case statement {
    const_: ConstDeclaration -> { validateValue(const_, const_.resolvedType, const_.type_, module, diagnostics); validateExpression(const_.value, module, diagnostics) }
    readonly_: ReadonlyDeclaration -> { validateValue(readonly_, readonly_.resolvedType, readonly_.type_, module, diagnostics); validateExpression(readonly_.value, module, diagnostics) }
    binding: ImmutableBinding -> {
      validateValue(binding, binding.resolvedType, binding.type_, module, diagnostics)
      validateExpression(binding.value, module, diagnostics)
      if binding.else_ != null { validateBlock(binding.else_!, module, diagnostics) }
    }
    let_: LetDeclaration -> { validateValue(let_, let_.resolvedType, let_.type_, module, diagnostics); validateExpression(let_.value, module, diagnostics) }
    fn: FunctionDeclaration -> { validateFunction(fn, module, diagnostics) }
    class_: ClassDeclaration -> {
      if class_.resolvedSymbol == null { addValidationError(module, class_.span, "Class '" + class_.name + "' has no resolved symbol", diagnostics) }
      for implementation of class_.implements_ { validateTypeAnnotation(implementation, module, diagnostics) }
      for field of class_.fields {
        if field.type_ != null { validateTypeAnnotation(field.type_!, module, diagnostics) }
        validateResolved(field.resolvedType, field.span, module, "field " + class_.name, diagnostics)
        if field.defaultValue != null { validateExpression(field.defaultValue!, module, diagnostics) }
      }
      for method of class_.methods { validateFunction(method, module, diagnostics) }
    }
    interface_: InterfaceDeclaration -> {
      if interface_.resolvedSymbol == null { addValidationError(module, interface_.span, "Interface '" + interface_.name + "' has no resolved symbol", diagnostics) }
      for field of interface_.fields {
        validateTypeAnnotation(field.type_, module, diagnostics)
        validateResolved(field.resolvedType, field.span, module, "interface field " + interface_.name, diagnostics)
      }
      for method of interface_.methods { validateFunction(method, module, diagnostics) }
    }
    enum_: EnumDeclaration -> { for variant of enum_.variants { if variant.value != null { validateExpression(variant.value!, module, diagnostics) } } }
    alias: TypeAliasDeclaration -> {
      validateTypeAnnotation(alias.type_, module, diagnostics)
      validateResolved(alias.resolvedType, alias.span, module, "type alias " + alias.name, diagnostics)
    }
    if_: IfStatement -> {
      validateExpression(if_.condition, module, diagnostics); validateBlock(if_.body, module, diagnostics)
      for branch of if_.elseIfs { validateExpression(branch.condition, module, diagnostics); validateBlock(branch.body, module, diagnostics) }
      if if_.else_ != null { validateBlock(if_.else_!, module, diagnostics) }
    }
    case_: CaseStatement -> {
      validateExpression(case_.subject, module, diagnostics)
      for arm of case_.arms {
        for pattern of arm.patterns { validatePattern(pattern, module, diagnostics) }
        case arm.body {
          block: Block -> { validateBlock(block, module, diagnostics) }
          expression: Expression -> { validateExpression(expression, module, diagnostics) }
        }
      }
    }
    while_: WhileStatement -> { validateExpression(while_.condition, module, diagnostics); validateBlock(while_.body, module, diagnostics); if while_.then_ != null { validateBlock(while_.then_!, module, diagnostics) } }
    for_: ForStatement -> {
      if for_.init != null { validateStatement(for_.init!, module, diagnostics) }
      if for_.condition != null { validateExpression(for_.condition!, module, diagnostics) }
      for update of for_.update { validateExpression(update, module, diagnostics) }
      validateBlock(for_.body, module, diagnostics); if for_.then_ != null { validateBlock(for_.then_!, module, diagnostics) }
    }
    forOf: ForOfStatement -> { validateExpression(forOf.iterable, module, diagnostics); validateBlock(forOf.body, module, diagnostics); if forOf.then_ != null { validateBlock(forOf.then_!, module, diagnostics) } }
    with_: WithStatement -> {
      for binding of with_.bindings {
        if binding.type_ != null { validateTypeAnnotation(binding.type_!, module, diagnostics) }
        validateExpression(binding.value, module, diagnostics)
      }
      validateBlock(with_.body, module, diagnostics)
    }
    return_: ReturnStatement -> { if return_.value != null { validateExpression(return_.value!, module, diagnostics) } }
    yield_: YieldStatement -> { validateExpression(yield_.value, module, diagnostics) }
    expression: ExpressionStatement -> { validateExpression(expression.expression, module, diagnostics) }
    destructuring: DestructuringStatement -> { validateExpression(destructuring.value, module, diagnostics) }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { validateStatement(declaration, module, diagnostics) }
        declaration: ReadonlyDeclaration -> { validateStatement(declaration, module, diagnostics) }
        binding: ImmutableBinding -> { validateStatement(binding, module, diagnostics) }
        declaration: LetDeclaration -> { validateStatement(declaration, module, diagnostics) }
        expression: ExpressionStatement -> { validateStatement(expression, module, diagnostics) }
      }
    }
    export_: ExportDeclaration -> { validateStatement(export_.declaration, module, diagnostics) }
    block: Block -> { validateBlock(block, module, diagnostics) }
    _ -> { }
  }
}

function validateValue(statement: Statement, resolvedType: ResolvedType | null, annotation: TypeAnnotation | null, module: string, diagnostics: Diagnostic[]): void {
  if annotation != null { validateTypeAnnotation(annotation!, module, diagnostics) }
  validateResolved(resolvedType, statement.span, module, "value", diagnostics)
}

function validateFunction(fn: FunctionDeclaration, module: string, diagnostics: Diagnostic[]): void {
  validateResolved(fn.resolvedType, fn.span, module, "function " + fn.name, diagnostics)
  if fn.returnType != null { validateTypeAnnotation(fn.returnType!, module, diagnostics) }
  for parameter of fn.params {
    if parameter.type_ != null { validateTypeAnnotation(parameter.type_!, module, diagnostics) }
    validateResolved(parameter.resolvedType, parameter.span, module, "parameter " + parameter.name, diagnostics)
    if parameter.defaultValue != null { validateExpression(parameter.defaultValue!, module, diagnostics) }
  }
  case fn.body {
    block: Block -> { validateBlock(block, module, diagnostics) }
    expression: Expression -> { validateExpression(expression, module, diagnostics) }
  }
}

function validateBlock(block: Block, module: string, diagnostics: Diagnostic[]): void {
  for statement of block.statements { validateStatement(statement, module, diagnostics) }
}

function validatePattern(pattern: CasePattern, module: string, diagnostics: Diagnostic[]): void {
  case pattern {
    type_: TypePattern -> { validateTypeAnnotation(type_.type_, module, diagnostics); validateResolved(type_.resolvedType, type_.span, module, "case pattern", diagnostics) }
    value: ValuePattern -> { validateExpression(value.value, module, diagnostics) }
    _: WildcardPattern -> { }
  }
}

function validateExpression(expression: Expression, module: string, diagnostics: Diagnostic[]): void {
  validateResolved(expression.resolvedType, expression.span, module, "expression " + expression.kind, diagnostics)
  case expression {
    string_: StringLiteral -> { for interpolation of string_.interpolations { validateExpression(interpolation, module, diagnostics) } }
    binary: BinaryExpression -> { validateExpression(binary.left, module, diagnostics); validateExpression(binary.right, module, diagnostics) }
    unary: UnaryExpression -> { validateExpression(unary.operand, module, diagnostics) }
    assignment: AssignmentExpression -> { validateExpression(assignment.target, module, diagnostics); validateExpression(assignment.value, module, diagnostics) }
    member: MemberExpression -> { validateExpression(member.object, module, diagnostics) }
    index: IndexExpression -> { validateExpression(index.object, module, diagnostics); validateExpression(index.index, module, diagnostics) }
    call: CallExpression -> {
      validateExpression(call.callee, module, diagnostics)
      for argument of call.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
      for argument of call.resolvedGenericTypeArgs { validateResolved(optionalResolvedType(argument), call.span, module, "generic call argument", diagnostics) }
      for argument of call.args { validateExpression(argument.value, module, diagnostics) }
    }
    array: ArrayLiteral -> { for item of array.elements { validateExpression(item, module, diagnostics) } }
    object: ObjectLiteral -> {
      if object.spread != null { validateExpression(object.spread!, module, diagnostics) }
      for property of object.properties { validateResolved(property.resolvedType, property.span, module, "object property", diagnostics); if property.value != null { validateExpression(property.value!, module, diagnostics) } }
    }
    tuple: TupleLiteral -> { for item of tuple.elements { validateExpression(item, module, diagnostics) } }
    lambda: LambdaExpression -> {
      if lambda.returnType != null { validateTypeAnnotation(lambda.returnType!, module, diagnostics) }
      for parameter of lambda.params {
        if parameter.type_ != null { validateTypeAnnotation(parameter.type_!, module, diagnostics) }
        validateResolved(parameter.resolvedType, parameter.span, module, "lambda parameter", diagnostics)
        if parameter.defaultValue != null { validateExpression(parameter.defaultValue!, module, diagnostics) }
      }
      case lambda.body {
        block: Block -> { validateBlock(block, module, diagnostics) }
        expression: Expression -> { validateExpression(expression, module, diagnostics) }
      }
    }
    if_: IfExpression -> { validateExpression(if_.condition, module, diagnostics); validateExpression(if_.then_, module, diagnostics); validateExpression(if_.else_, module, diagnostics) }
    case_: CaseExpression -> {
      validateExpression(case_.subject, module, diagnostics); validateResolved(case_.resolvedType, case_.span, module, "case expression", diagnostics)
      for arm of case_.arms {
        for pattern of arm.patterns { validatePattern(pattern, module, diagnostics) }
        case arm.body {
          block: Block -> { validateBlock(block, module, diagnostics) }
          bodyExpression: Expression -> { validateExpression(bodyExpression, module, diagnostics) }
        }
      }
    }
    construct: ConstructExpression -> {
      if construct.resolvedConstructedType != null { validateResolved(construct.resolvedConstructedType, construct.span, module, "constructed type", diagnostics) }
      for argument of construct.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
      for property of construct.args {
        validateResolved(property.resolvedType, property.span, module, "constructor property", diagnostics)
        if property.value != null { validateExpression(property.value!, module, diagnostics) }
      }
    }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { validateBlock(block, module, diagnostics) }
        inner: Expression -> { validateExpression(inner, module, diagnostics) }
      }
    }
    retire_: RetireExpression -> { validateExpression(retire_.actor, module, diagnostics) }
    actor: ActorCreationExpression -> { for argument of actor.args { validateExpression(argument, module, diagnostics) } }
    identifier: Identifier -> {
      if identifier.resolvedBinding == null { addValidationError(module, identifier.span, "Identifier '" + identifier.name + "' has no resolved binding", diagnostics) }
      else { validateResolved(identifier.resolvedBinding!.type_, identifier.span, module, "binding " + identifier.name, diagnostics) }
    }
    _ -> { }
  }
}

function validateTypeAnnotation(annotation: TypeAnnotation, module: string, diagnostics: Diagnostic[]): void {
  case annotation {
    named: NamedType -> {
      validateResolved(named.resolvedType, named.span, module, "type annotation", diagnostics)
      for argument of named.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
    }
    array: ArrayType -> {
      validateResolved(array.resolvedType, array.span, module, "type annotation", diagnostics)
      validateTypeAnnotation(array.elementType, module, diagnostics)
    }
    union: UnionType -> {
      validateResolved(union.resolvedType, union.span, module, "type annotation", diagnostics)
      for member of union.types { validateTypeAnnotation(member, module, diagnostics) }
    }
    function_: AstFunctionType -> {
      validateResolved(function_.resolvedType, function_.span, module, "type annotation", diagnostics)
      for parameter of function_.params { validateTypeAnnotation(parameter.type_, module, diagnostics) }
      validateTypeAnnotation(function_.returnType, module, diagnostics)
    }
  }
}

function validateResolved(resolvedType: ResolvedType | null, span: SourceSpan, module: string, owner: string, diagnostics: Diagnostic[]): void {
  if resolvedType == null { addValidationError(module, span, "Missing resolved type for " + owner, diagnostics); return }
  case resolvedType! {
    _: UnknownType -> { addValidationError(module, span, "Unknown resolved type for " + owner, diagnostics) }
    class_: ClassType -> { for argument of class_.typeArgs { validateResolved(argument, span, module, owner + " type argument", diagnostics) } }
    array: ArrayResolvedType -> { validateResolved(array.elementType, span, module, owner + " element", diagnostics) }
    map: MapResolvedType -> { validateResolved(map.keyType, span, module, owner + " key", diagnostics); validateResolved(map.valueType, span, module, owner + " value", diagnostics) }
    stream: StreamResolvedType -> { validateResolved(stream.elementType, span, module, owner + " element", diagnostics) }
    result: ResultResolvedType -> { validateResolved(result.valueType, span, module, owner + " success", diagnostics); validateResolved(result.errorType, span, module, owner + " error", diagnostics) }
    actor: ActorType -> { validateResolved(optionalResolvedType(actor.innerClass), span, module, owner + " actor state", diagnostics) }
    promise: PromiseType -> { validateResolved(promise.valueType, span, module, owner + " promise value", diagnostics) }
    tuple: TupleResolvedType -> { for item of tuple.elements { validateResolved(item, span, module, owner + " tuple element", diagnostics) } }
    union_: UnionResolvedType -> {
      if union_.types.length == 0 { addValidationError(module, span, "Empty resolved union for " + owner, diagnostics) }
      for member of union_.types { validateResolved(member, span, module, owner + " union member", diagnostics) }
    }
    function_: FunctionType -> {
      for parameter of function_.params { validateResolved(parameter.type_, span, module, owner + " parameter", diagnostics) }
      validateResolved(function_.returnType, span, module, owner + " return", diagnostics)
    }
    _ -> { }
  }
}

function addValidationError(module: string, span: SourceSpan, message: string, diagnostics: Diagnostic[]): void {
  diagnostics.push(Diagnostic { severity: "error", message: message + " at " + string(span.start.line) + ":" + string(span.start.column), span: checkerSemanticSpan(span), module })
}

function checkerSemanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}
