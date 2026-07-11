// Expression-level type checking for the self-hosted compiler.
//
// This first checker deliberately covers the core language used by the
// self-hosting front end: lexical bindings, primitive/collection types,
// functions, classes, operators, calls, and conservative return analysis.

import {
  ArrayResolvedType, Binding, CheckResult, ClassType,
  Diagnostic, FunctionParamType, FunctionType as SemanticFunctionType,
  NullType, PrimitiveType, ResolvedType, Scope, SemanticLocation, SemanticSpan, Symbol,
  TupleResolvedType, UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ArrayLiteral, ArrayType, AssignmentExpression, AstLocation, BinaryExpression, Block,
  BoolLiteral, CallExpression, CallerExpression, CharLiteral, ClassDeclaration, ConstructExpression,
  ConstDeclaration, ContinueStatement, DestructuringStatement, DoubleLiteral,
  DotShorthand, EnumDeclaration, ExportDeclaration, ExportList, Expression, ExpressionStatement,
  FloatLiteral, ForOfStatement, ForStatement, FunctionDeclaration, FunctionType,
  IfExpression, IfStatement, ImmutableBinding, Identifier, ImportDeclaration,
  IndexExpression, IntLiteral, InterfaceDeclaration, LetDeclaration,
  LambdaExpression, LongLiteral, MemberExpression, NamedType, NullLiteral,
  NamedImport, NamespaceImport, ObjectLiteral, ObjectProperty, Program,
  ReadonlyDeclaration, ReturnStatement, SourceSpan, Statement, StringLiteral,
  ThisExpression, TupleLiteral, TypeAliasDeclaration, TypeAnnotation,
  UnaryExpression, UnionType, WhileStatement, WithBinding, WithStatement, BreakStatement,
  YieldStatement,
} from "./ast"
import type { Parameter } from "./ast"
import {
  arrayType, classType, functionType, isAssignable, isNumeric, joinTypes,
  nullType, numericResult, primitive, sameType, tupleType, typeName,
  unknownType, voidType,
} from "./checker-types"

export class ModuleChecker {
  result: AnalysisResult
  diagnostics: Diagnostic[] = []
  info: ModuleInfo | null = null
  moduleScope: Scope | null = null

  function check(entry: string): CheckResult {
    diagnostics = []
    info = findModule(result, if entry.endsWith(".do") then entry else entry + ".do")
    if info == null { return CheckResult { diagnostics } }
    moduleScope = Scope { parent: null }
    predeclareModuleBindings(info!, moduleScope!, result)
    for statement of info!.program.statements { checkStatement(statement, moduleScope!) }
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
      _: TypeAliasDeclaration -> { return true }
      if_: IfStatement -> {
        requireBool(checkExpression(if_.condition, scope, null), if_.condition.span)
        thenCompletes := checkBlock(if_.body, scope)
        let allComplete = thenCompletes
        for branch of if_.elseIfs {
          requireBool(checkExpression(branch.condition, scope, null), branch.condition.span)
          allComplete = allComplete || checkBlock(branch.body, scope)
        }
        if if_.else_ == null { return true }
        return allComplete || checkBlock(if_.else_!, scope)
      }
      while_: WhileStatement -> {
        requireBool(checkExpression(while_.condition, scope, null), while_.condition.span)
        checkBlock(while_.body, scope)
        if while_.then_ != null { checkBlock(while_.then_!, scope) }
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
        for name of forOf.bindings {
          if name != "_" { declare(bodyScope, Binding { name, kind: "for-binding", type_: element, mutable: false, span: semanticSpan(forOf.span), module: info!.path }) }
        }
        checkBlock(forOf.body, bodyScope)
        if forOf.then_ != null { checkBlock(forOf.then_!, scope) }
        return true
      }
      with_: WithStatement -> {
        bodyScope := Scope { parent: scope }
        for binding of with_.bindings {
          valueType := checkExpression(binding.value, scope, null)
          declaredType := if binding.type_ == null then valueType else resolveType(binding.type_!, info!, scope)
          if !isAssignable(valueType, declaredType) { typeError("Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), binding.span) }
          declare(bodyScope, Binding { name: binding.name, kind: "with", type_: declaredType, mutable: false, span: semanticSpan(binding.span), module: info!.path })
        }
        checkBlock(with_.body, bodyScope)
        return true
      }
      return_: ReturnStatement -> { return checkReturn(return_, scope) }
      expression: ExpressionStatement -> { checkExpression(expression.expression, scope, null); return true }
      destructuring: DestructuringStatement -> { checkExpression(destructuring.value, scope, null); return true }
      _: ContinueStatement -> { return true }
      _: BreakStatement -> { return true }
      block: Block -> { return checkBlock(block, scope) }
      _ -> { return true }
    }
  }

  private function checkValueDeclaration(declaration: Statement, scope: Scope, kind: string, mutable: bool): bool {
    let name = ""
    let annotation: TypeAnnotation | null = null
    let value: Expression = NullLiteral { kind: "null-literal", span: declaration.span }
    let span = declaration.span
    case declaration {
      const_: ConstDeclaration -> { name = const_.name; annotation = const_.type_; value = const_.value }
      readonly_: ReadonlyDeclaration -> { name = readonly_.name; annotation = readonly_.type_; value = readonly_.value }
      binding: ImmutableBinding -> { name = binding.name; annotation = binding.type_; value = binding.value }
      let_: LetDeclaration -> { name = let_.name; annotation = let_.type_; value = let_.value }
      _ -> { return true }
    }
    valueType := checkExpression(value, scope, if annotation == null then null else resolveType(annotation!, info!, scope))
    declaredType := if annotation == null then valueType else resolveType(annotation!, info!, scope)
    if !isAssignable(valueType, declaredType) { typeError("Cannot assign " + typeName(valueType) + " to " + typeName(declaredType), span) }
    case declaration {
      const_: ConstDeclaration -> { const_.resolvedType = declaredType }
      readonly_: ReadonlyDeclaration -> { readonly_.resolvedType = declaredType }
      binding: ImmutableBinding -> { binding.resolvedType = declaredType }
      let_: LetDeclaration -> { let_.resolvedType = declaredType }
      _ -> { }
    }
    declare(scope, Binding { name, kind, type_: declaredType, mutable, span: semanticSpan(span), module: info!.path })
    return true
  }

  private function checkFunction(fn: FunctionDeclaration, outer: Scope, owner: ClassType | null): ResolvedType {
    returnType := if fn.returnType == null then unknownType() else resolveType(fn.returnType!, info!, outer)
    functionValue := functionType(functionParameters(fn, outer), returnType)
    fn.resolvedType = functionValue
    scope := Scope { parent: outer, returnType, thisType: if owner == null then unknownType() else owner! }
    if owner != null { addClassFields(scope, owner!) }
    for parameter of fn.params {
      parameterType := if parameter.type_ == null then unknownType() else resolveType(parameter.type_!, info!, scope)
      parameter.resolvedType = parameterType
      if parameter.defaultValue != null { checkExpression(parameter.defaultValue!, scope, parameterType) }
      declare(scope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: semanticSpan(parameter.span), module: info!.path })
    }
    let actualReturn = voidType()
    let completes = true
    case fn.body {
      expression: Expression -> { actualReturn = checkExpression(expression, scope, if fn.returnType == null then null else returnType); completes = false }
      block: Block -> { completes = checkBlock(block, scope); actualReturn = inferredReturn(block) }
    }
    if fn.returnType == null && actualReturn.kind != "void" {
      case functionValue {
        resolved: SemanticFunctionType -> { resolved.returnType = actualReturn }
        _ -> { }
      }
    }
    if returnType.kind != "unknown" && returnType.kind != "void" && completes {
      typeError("Function '" + fn.name + "' may complete without returning " + typeName(returnType), fn.span)
    }
    return functionValue
  }

  private function functionParameters(fn: FunctionDeclaration, scope: Scope): FunctionParamType[] {
    let parameters: FunctionParamType[] = []
    for parameter of fn.params {
      parameters.push(FunctionParamType {
        name: parameter.name,
        type_: if parameter.type_ == null then unknownType() else resolveType(parameter.type_!, info!, scope),
        hasDefault: parameter.defaultValue != null,
      })
    }
    return parameters
  }

  private function checkClass(class_: ClassDeclaration, scope: Scope): void {
    owner := classType(class_.name, symbolFor(info!, class_.name)!)
    for field of class_.fields {
      fieldType := if field.type_ == null then unknownType() else resolveType(field.type_!, info!, scope)
      field.resolvedType = fieldType
      if field.defaultValue != null { checkExpression(field.defaultValue!, scope, fieldType) }
    }
    for method of class_.methods { checkFunction(method, scope, owner) }
  }

  private function checkInterface(interface_: InterfaceDeclaration, scope: Scope): void {
    for field of interface_.fields { field.resolvedType = resolveType(field.type_, info!, scope) }
    for method of interface_.methods { checkFunction(method, scope, null) }
  }

  private function checkReturn(statement: ReturnStatement, scope: Scope): bool {
    target := returnScope(scope)
    if target == null { typeError("Return is only valid inside a function", statement.span); return false }
    returnType := target!.returnType!
    if statement.value == null {
      if returnType.kind != "void" && returnType.kind != "unknown" {
        typeError("Expected a return value of type " + typeName(returnType), statement.span)
      }
    } else {
      valueType := checkExpression(statement.value!, scope, returnType)
      if !isAssignable(valueType, returnType) { typeError("Cannot return " + typeName(valueType) + " from function returning " + typeName(returnType), statement.span) }
    }
    return false
  }

  private function checkBlock(block: Block, parent: Scope): bool {
    scope := Scope { parent }
    let completes = true
    for statement of block.statements {
      if completes { completes = checkStatement(statement, scope) }
    }
    return completes
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
      identifier: Identifier -> { return checkIdentifier(identifier, scope) }
      binary: BinaryExpression -> { return checkBinary(binary, scope) }
      unary: UnaryExpression -> { return checkUnary(unary, scope) }
      assignment: AssignmentExpression -> { return checkAssignment(assignment, scope) }
      member: MemberExpression -> { return finish(expression, memberType(checkExpression(member.object, scope, null), member.property, member.span)) }
      index: IndexExpression -> { return finish(expression, indexType(checkExpression(index.object, scope, null), checkExpression(index.index, scope, primitive("int")), index.span)) }
      call: CallExpression -> { return checkCall(call, scope) }
      array: ArrayLiteral -> { return checkArray(array, scope, expected) }
      tuple: TupleLiteral -> {
        let elements: ResolvedType[] = []
        for item of tuple.elements { elements.push(checkExpression(item, scope, null)) }
        return finish(expression, tupleType(elements))
      }
      object: ObjectLiteral -> {
        for property of object.properties { if property.value != null { checkExpression(property.value!, scope, null) } }
        return finish(expression, unknownType())
      }
      lambda: LambdaExpression -> { return checkLambda(lambda, scope, expected) }
      if_: IfExpression -> {
        requireBool(checkExpression(if_.condition, scope, primitive("bool")), if_.condition.span)
        return finish(expression, joinTypes(checkExpression(if_.then_, scope, expected), checkExpression(if_.else_, scope, expected)))
      }
      construct: ConstructExpression -> { return checkConstruct(construct, scope) }
      _: ThisExpression -> { return finish(expression, scope.thisType ?? unknownType()) }
      _ -> { return finish(expression, unknownType()) }
    }
  }

  private function checkIdentifier(identifier: Identifier, scope: Scope): ResolvedType {
    let binding: Binding | null = lookup(scope, identifier.name)
    if binding == null && isBuiltinCallable(identifier.name) {
      binding = Binding { name: identifier.name, kind: "builtin", type_: builtinCallable(identifier.name), mutable: false, span: semanticSpan(identifier.span), module: info!.path }
    }
    if binding == null {
      typeError("Unknown identifier '" + identifier.name + "'", identifier.span)
      return finish(identifier, unknownType())
    }
    identifier.resolvedBinding = binding
    return finish(identifier, binding.type_)
  }

  private function checkBinary(expression: BinaryExpression, scope: Scope): ResolvedType {
    left := checkExpression(expression.left, scope, null)
    right := checkExpression(expression.right, scope, null)
    operator := expression.operator
    if operator == "&&" || operator == "||" {
      requireBool(left, expression.left.span); requireBool(right, expression.right.span)
      return finish(expression, primitive("bool"))
    }
    if operator == "==" || operator == "!=" || operator == "<" || operator == "<=" || operator == ">" || operator == ">=" {
      return finish(expression, primitive("bool"))
    }
    if operator == "+" && typeName(left) == "string" && typeName(right) == "string" { return finish(expression, primitive("string")) }
    if isNumeric(left) && isNumeric(right) { return finish(expression, numericResult(left, right)) }
    typeError("Operator '" + operator + "' is not defined for " + typeName(left) + " and " + typeName(right), expression.span)
    return finish(expression, unknownType())
  }

  private function checkUnary(expression: UnaryExpression, scope: Scope): ResolvedType {
    value := checkExpression(expression.operand, scope, null)
    if expression.operator == "!" { requireBool(value, expression.span); return finish(expression, primitive("bool")) }
    if expression.operator == "+" || expression.operator == "-" || expression.operator == "~" {
      if !isNumeric(value) { typeError("Unary '" + expression.operator + "' requires a numeric operand", expression.span) }
      return finish(expression, value)
    }
    return finish(expression, value)
  }

  private function checkAssignment(expression: AssignmentExpression, scope: Scope): ResolvedType {
    value := checkExpression(expression.value, scope, null)
    case expression.target {
      identifier: Identifier -> {
        target := lookup(scope, identifier.name)
        if target == null { typeError("Unknown assignment target '" + identifier.name + "'", identifier.span) }
        else {
          if !target!.mutable { typeError("Cannot assign to immutable binding '" + identifier.name + "'", identifier.span) }
          if !isAssignable(value, target!.type_) { typeError("Cannot assign " + typeName(value) + " to " + typeName(target!.type_), expression.span) }
        }
      }
      _ -> { typeError("Assignment target must be a binding", expression.target.span) }
    }
    return finish(expression, value)
  }

  private function checkCall(expression: CallExpression, scope: Scope): ResolvedType {
    calleeType := checkExpression(expression.callee, scope, null)
    case calleeType {
      resolvedFunction: SemanticFunctionType -> {
        if expression.args.length > resolvedFunction.params.length { typeError("Too many arguments", expression.span) }
        for i of 0..<expression.args.length {
          expected := if i < resolvedFunction.params.length then resolvedFunction.params[i].type_ else unknownType()
          actual := checkExpression(expression.args[i].value, scope, expected)
          if !isAssignable(actual, expected) { typeError("Argument " + string(i + 1) + " has type " + typeName(actual) + "; expected " + typeName(expected), expression.args[i].span) }
        }
        return finish(expression, resolvedFunction.returnType)
      }
      _: UnknownType -> {
        for argument of expression.args { checkExpression(argument.value, scope, null) }
        return finish(expression, unknownType())
      }
      _ -> { typeError("Expression of type " + typeName(calleeType) + " is not callable", expression.span); return finish(expression, unknownType()) }
    }
  }

  private function checkArray(expression: ArrayLiteral, scope: Scope, expected: ResolvedType | null): ResolvedType {
    let expectedElement: ResolvedType | null = null
    if expected != null {
      case expected! {
        array: ArrayResolvedType -> { expectedElement = array.elementType }
        _ -> { }
      }
    }
    let element = expectedElement ?? unknownType()
    for item of expression.elements { element = joinTypes(element, checkExpression(item, scope, expectedElement)) }
    return finish(expression, arrayType(element, expression.readonly_))
  }

  private function checkLambda(expression: LambdaExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
    let expectedFunction: SemanticFunctionType | null = null
    if expected != null {
      case expected! {
        resolvedFunction: SemanticFunctionType -> { expectedFunction = resolvedFunction }
        _ -> { }
      }
    }
    lambdaScope := Scope { parent: scope }
    for name of ["it", "index", "acc", "a", "b"] { declare(lambdaScope, Binding { name, kind: "lambda-implicit", type_: unknownType(), mutable: false, span: semanticSpan(expression.span), module: info!.path }) }
    let params: FunctionParamType[] = []
    for i of 0..<expression.params.length {
      parameter := expression.params[i]
      parameterType := if parameter.type_ == null then if expectedFunction != null && i < expectedFunction!.params.length then expectedFunction!.params[i].type_ else unknownType() else resolveType(parameter.type_!, info!, lambdaScope)
      parameter.resolvedType = parameterType
      params.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
      declare(lambdaScope, Binding { name: parameter.name, kind: "parameter", type_: parameterType, mutable: false, span: semanticSpan(parameter.span), module: info!.path })
    }
    let returnType = if expectedFunction == null then unknownType() else expectedFunction!.returnType
    case expression.body {
      block: Block -> { checkBlock(block, lambdaScope) }
      expressionBody: Expression -> { returnType = checkExpression(expressionBody, lambdaScope, returnType) }
    }
    return finish(expression, functionType(params, returnType))
  }

  private function checkConstruct(expression: ConstructExpression, scope: Scope): ResolvedType {
    symbol := symbolFor(info!, expression.type_)
    if symbol == null { typeError("Unknown constructed type '" + expression.type_ + "'", expression.span); return finish(expression, unknownType()) }
    constructed := classType(expression.type_, symbol!)
    for property of expression.args { if property.value != null { checkExpression(property.value!, scope, memberType(constructed, property.name, property.span)) } }
    return finish(expression, constructed)
  }

  private function resolveType(annotation: TypeAnnotation, module: ModuleInfo, scope: Scope): ResolvedType {
    case annotation {
      named: NamedType -> {
        if named.name == "void" { return voidType() }
        if named.name == "null" { return nullType() }
        if named.name == "byte" || named.name == "int" || named.name == "long" || named.name == "float" || named.name == "double" || named.name == "string" || named.name == "char" || named.name == "bool" {
          return primitive(named.name)
        }
        let symbol: Symbol | null = named.resolvedSymbol
        if symbol == null { symbol = symbolFor(module, named.name) }
        if symbol == null { return unknownType() }
        if symbol!.kind == "type-alias" {
          declaration := declarationFor(result, symbol!)
          case declaration! {
            alias: TypeAliasDeclaration -> { return resolveType(alias.type_, module, scope) }
            _ -> { }
          }
        }
        return classType(named.name, symbol!)
      }
      array: ArrayType -> { return arrayType(resolveType(array.elementType, module, scope), array.readonly_) }
      union: UnionType -> {
        let members: ResolvedType[] = []
        for item of union.types { members.push(resolveType(item, module, scope)) }
        return UnionResolvedType { types: members }
      }
      function_: FunctionType -> {
        let params: FunctionParamType[] = []
        for parameter of function_.params { params.push(FunctionParamType { name: parameter.name, type_: resolveType(parameter.type_, module, scope), hasDefault: false }) }
        return functionType(params, resolveType(function_.returnType, module, scope))
      }
    }
    return unknownType()
  }

  private function memberType(object: ResolvedType, property: string, span: SourceSpan): ResolvedType {
    if typeName(object) == "string" && property == "length" { return primitive("int") }
    case object {
      array: ArrayResolvedType -> {
        if property == "length" { return primitive("int") }
        return unknownType()
      }
      class_: ClassType -> {
        declaration := declarationFor(result, class_.symbol)
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            for field of classDeclaration.fields {
              for name of field.names { if name == property { return field.resolvedType ?? unknownType() } }
            }
            for method of classDeclaration.methods { if method.name == property { return method.resolvedType ?? checkFunction(method, moduleScope!, class_) } }
          }
          interface_: InterfaceDeclaration -> {
            for field of interface_.fields { if field.name == property { return field.resolvedType ?? resolveType(field.type_, info!, moduleScope!) } }
            for method of interface_.methods { if method.name == property { return method.resolvedType ?? checkFunction(method, moduleScope!, null) } }
          }
          _ -> { }
        }
      }
      _ -> { }
    }
    return unknownType()
  }

  private function indexType(object: ResolvedType, index: ResolvedType, span: SourceSpan): ResolvedType {
    if !isAssignable(index, primitive("int")) && typeName(index) != "unknown" { typeError("Index must be an int", span) }
    case object {
      array: ArrayResolvedType -> { return array.elementType }
      _: TupleResolvedType -> { return unknownType() }
      primitive_: PrimitiveType -> { if primitive_.name == "string" { return primitive("char") } }
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
    case declaration! {
      class_: ClassDeclaration -> {
        for field of class_.fields {
          for name of field.names {
            declare(scope, Binding {
              name,
              kind: "field",
              type_: field.resolvedType ?? unknownType(),
              mutable: !field.readonly_,
              span: semanticSpan(field.span),
              module: info!.path,
            })
          }
        }
      }
      _ -> { }
    }
  }

  private function finish(expression: Expression, resolvedType: ResolvedType): ResolvedType { expression.resolvedType = resolvedType; return resolvedType }
  private function typeError(message: string, span: SourceSpan): void { diagnostics.push(Diagnostic { severity: "error", message, span: semanticSpan(span), module: info!.path }) }
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

function predeclareModuleBindings(info: ModuleInfo, scope: Scope, result: AnalysisResult): void {
  for symbol of info.symbols {
    if symbol.kind == "function" || symbol.kind == "class" || symbol.kind == "interface" || symbol.kind == "enum" {
      declare(scope, Binding { name: symbol.name, kind: symbol.kind, type_: symbolType(symbol, info, result), mutable: false, span: semanticSpan(symbolSpan(info, symbol.name)), module: info.path, symbol })
    }
  }
  for imported of info.imports {
    if imported.symbol != null { declare(scope, Binding { name: imported.localName, kind: "import", type_: symbolType(imported.symbol!, info, result), mutable: false, span: semanticSpan(symbolSpan(info, imported.localName)), module: info.path, symbol: imported.symbol }) }
  }
}

function symbolType(symbol: Symbol, info: ModuleInfo, result: AnalysisResult): ResolvedType {
  if symbol.kind == "class" || symbol.kind == "interface" || symbol.kind == "enum" { return classType(symbol.name, symbol) }
  declaration := declarationFor(result, symbol)
  case declaration! {
    fn: FunctionDeclaration -> { return functionType(functionParametersFor(fn, info, result), if fn.returnType == null then unknownType() else resolveAnnotation(fn.returnType!, info, result)) }
    alias: TypeAliasDeclaration -> { return resolveAnnotation(alias.type_, info, result) }
    _ -> { return unknownType() }
  }
}

function functionParametersFor(fn: FunctionDeclaration, info: ModuleInfo, result: AnalysisResult): FunctionParamType[] {
  let resultTypes: FunctionParamType[] = []
  for parameter of fn.params { resultTypes.push(FunctionParamType { name: parameter.name, type_: if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info, result), hasDefault: parameter.defaultValue != null }) }
  return resultTypes
}

function resolveAnnotation(annotation: TypeAnnotation, info: ModuleInfo, result: AnalysisResult): ResolvedType {
  // ModuleChecker performs the full alias walk.  This helper handles the
  // declaration types needed to predeclare recursive functions.
  case annotation {
    named: NamedType -> {
      if named.name == "void" { return voidType() }
      if named.name == "null" { return nullType() }
      if named.name == "byte" || named.name == "int" || named.name == "long" || named.name == "float" || named.name == "double" || named.name == "string" || named.name == "char" || named.name == "bool" { return primitive(named.name) }
      symbol := named.resolvedSymbol ?? symbolFor(info, named.name)
      return if symbol == null then unknownType() else classType(named.name, symbol!)
    }
    array: ArrayType -> { return arrayType(resolveAnnotation(array.elementType, info, result), array.readonly_) }
    union: UnionType -> {
      let members: ResolvedType[] = []
      for item of union.types { members.push(resolveAnnotation(item, info, result)) }
      return UnionResolvedType { types: members }
    }
    function_: FunctionType -> {
      let params: FunctionParamType[] = []
      for parameter of function_.params {
        params.push(FunctionParamType { name: parameter.name, type_: resolveAnnotation(parameter.type_, info, result), hasDefault: false })
      }
      return functionType(params, resolveAnnotation(function_.returnType, info, result))
    }
  }
  return unknownType()
}

function declare(scope: Scope, binding: Binding): void {
  for existing of scope.bindings { if existing.name == binding.name { return } }
  scope.bindings.push(binding)
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

function iterableElement(iterable: ResolvedType): ResolvedType {
  case iterable {
    array: ArrayResolvedType -> { return array.elementType }
    _ -> { return unknownType() }
  }
}

function isBuiltinCallable(name: string): bool {
  return name == "string" || name == "int" || name == "long" || name == "float" || name == "double" || name == "bool" || name == "println" || name == "panic"
}

function builtinCallable(name: string): ResolvedType {
  result := if name == "println" || name == "panic" then voidType() else primitive(name)
  return functionType([FunctionParamType { name: "value", type_: unknownType(), hasDefault: false }], result)
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
    alias: TypeAliasDeclaration -> { return alias.name }
    const_: ConstDeclaration -> { return const_.name }
    readonly_: ReadonlyDeclaration -> { return readonly_.name }
    binding: ImmutableBinding -> { return binding.name }
    let_: LetDeclaration -> { return let_.name }
    _ -> { return "" }
  }
}

function symbolSpan(info: ModuleInfo, name: string): SourceSpan {
  for statement of info.program.statements { if symbolName(statement) == name { return statement.span } }
  return info.program.span
}

function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

export function createChecker(result: AnalysisResult): ModuleChecker {
  return ModuleChecker { result }
}

function semanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}
