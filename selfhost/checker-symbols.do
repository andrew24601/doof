// Binding, symbol, builtin, annotation, and scope helpers.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, SetResolvedType, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType,
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
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter, WeakType,
  CatchExpression, YieldBlockExpression, YieldBlockAssignmentStatement,
} from "./ast"
import {
  actorType, applyDeepReadonly, arrayType, classType, enumType, functionType, interfaceType, isAssignable, isNumeric, joinTypes,
  isJsonValueType, jsonObjectType, jsonValueType, mapType, resultType, setType, streamType,
  nullType, numericResult, primitive, promiseType, rangeType, sameType, tupleType, typeName, unionType,
  substituteTypeParams, typeParameter, unknownType, voidType, weakType,
} from "./checker-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization } from "./json-semantics"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"


import { symbolSpan, findModule, classModuleFor } from "./checker-interfaces"
import { checkerSemanticSpan } from "./checker-validation"

export function builtinSourceLocationType(): ClassType {
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

export function casePatternName(pattern: TypePattern): string {
  case pattern.type_ {
    named: NamedType -> {
      if named.name == "Success" || named.name == "Failure" { return named.name }
    }
    _ -> { }
  }
  return ""
}

export function decorateAnnotationWithResolved(annotation: TypeAnnotation, resolved: ResolvedType): void {
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
    weak_: WeakType -> {
      weak_.resolvedType = optionalResolvedType(resolved)
      case resolved {
        weakResolved: WeakResolvedType -> { decorateAnnotationWithResolved(weak_.type_, weakResolved.inner) }
        _ -> { }
      }
    }
  }
}

// An unconditional loop completes normally only when its own body can break
// out. Breaks nested inside another loop belong to that inner loop and do not
// make the outer loop complete.
export function blockContainsLoopExit(block: Block): bool {
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

export function optionalResolvedType(value: ResolvedType): ResolvedType | null { return value }

export function functionParameterIndex(parameters: FunctionParamType[], name: string): int {
  for i of 0..<parameters.length { if parameters[i].name == name { return i } }
  return -1
}

export function containsString(values: string[], value: string): bool {
  for existing of values { if existing == value { return true } }
  return false
}

export function hasObjectProperty(properties: ObjectProperty[], name: string): bool {
  for property of properties { if property.name == name { return true } }
  return false
}

export function predeclareModuleBindings(info: ModuleInfo, scope: Scope, result: AnalysisResult): void {
  for symbol of info.symbols {
    if symbol.kind == "function" || symbol.kind == "class" || symbol.kind == "struct" || symbol.kind == "interface" || symbol.kind == "enum" {
      declare(scope, Binding { name: symbol.name, kind: symbol.kind, type_: symbolType(symbol, info, result), mutable: false, span: checkerSemanticSpan(symbolSpan(info, symbol.name)), module: info.path, symbol })
    }
  }
  for imported of info.imports {
    if imported.symbol != null { declare(scope, Binding { name: imported.localName, kind: "import", type_: symbolType(imported.symbol!, info, result), mutable: false, span: checkerSemanticSpan(symbolSpan(info, imported.localName)), module: info.path, symbol: imported.symbol }) }
  }
}

export function isNamespaceImport(info: ModuleInfo, name: string): bool {
  for imported of info.namespaceImports { if imported.localName == name { return true } }
  return false
}

export function isBuiltinNamespace(name: string): bool {
  return name == "byte" || name == "int" || name == "long" || name == "float" || name == "double"
}

export function builtinNamespaceMemberType(namespaceName: string, memberName: string): ResolvedType {
  if memberName == "parse" {
    return functionType([
      FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false },
    ], resultType(primitive(namespaceName), builtinParseErrorType()))
  }
  return unknownType()
}

function builtinParseErrorType(): ResolvedType {
  return enumType("ParseError", Symbol {
    kind: "enum",
    name: "ParseError",
    module: "<builtin>",
    exported: false,
  })
}

export function namespaceMemberType(info: ModuleInfo, namespaceName: string, memberName: string, result: AnalysisResult): ResolvedType {
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

export function symbolType(symbol: Symbol, info: ModuleInfo, result: AnalysisResult): ResolvedType {
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
    const_: ConstDeclaration -> { if const_.resolvedType != null { return const_.resolvedType! } }
    readonly_: ReadonlyDeclaration -> { if readonly_.resolvedType != null { return readonly_.resolvedType! } }
    binding: ImmutableBinding -> { if binding.resolvedType != null { return binding.resolvedType! } }
    _ -> { return unknownType() }
  }
  return unknownType()
}

// Imported member lookup needs a declaration's signature without checking its
// body in the caller's module scope. This also keeps cross-module context
// objects usable when their implementation methods refer to local imports.
export function methodSignature(method: FunctionDeclaration, info: ModuleInfo, result: AnalysisResult): ResolvedType {
  let parameters: FunctionParamType[] = []
  for parameter of method.params {
    parameterType := if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info, result, method.typeParams)
    parameters.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
  }
  return functionType(parameters, if method.returnType == null then unknownType() else resolveAnnotation(method.returnType!, info, result, method.typeParams), method.typeParams)
}

export function functionParametersFor(fn: FunctionDeclaration, info: ModuleInfo, result: AnalysisResult): FunctionParamType[] {
  let resultTypes: FunctionParamType[] = []
  for parameter of fn.params {
    parameterType := if parameter.resolvedType != null then parameter.resolvedType! else if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, info, result, fn.typeParams)
    resultTypes.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
  }
  return resultTypes
}

export function resolveAnnotation(annotation: TypeAnnotation, info: ModuleInfo, result: AnalysisResult, typeParams: string[] = []): ResolvedType {
  // ModuleChecker performs the full alias walk.  This helper handles the
  // declaration types needed to predeclare recursive functions.
  case annotation {
    named: NamedType -> {
      if named.name == "void" { return voidType() }
      if named.name == "null" { return nullType() }
      if named.name == "JsonValue" { return jsonValueType() }
      if named.name == "JsonObject" { return jsonObjectType() }
      if named.name == "SourceLocation" { return builtinSourceLocationType() }
      if named.name == "Range" { return rangeType() }
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
      if named.name == "Set" || named.name == "ReadonlySet" {
        element := if named.typeArgs.length >= 1 then resolveAnnotation(named.typeArgs[0], info, result, typeParams) else unknownType()
        return setType(element, named.name == "ReadonlySet")
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
    weak_: WeakType -> { return weakType(resolveAnnotation(weak_.type_, info, result, typeParams)) }
  }
  return unknownType()
}

export function declare(scope: Scope, binding: Binding): void {
  for existing of scope.bindings { if existing.name == binding.name { return } }
  scope.bindings.push(binding)
}

// Parameters intentionally shadow implicit field and method bindings.
export function declareShadowing(scope: Scope, binding: Binding): void {
  for index of 0..<scope.bindings.length {
    if scope.bindings[index].name == binding.name {
      scope.bindings[index] = binding
      return
    }
  }
  scope.bindings.push(binding)
}

export function hasTypeParam(scope: Scope, name: string): bool {
  let current: Scope | null = scope
  while current != null {
    for typeParam of current!.typeParams { if typeParam == name { return true } }
    current = current!.parent
  }
  return false
}

export function typeParamConstraintName(scope: Scope, name: string): string {
  let current: Scope | null = scope
  while current != null {
    for index of 0..<current!.typeParams.length {
      if current!.typeParams[index] == name && index < current!.typeParamConstraintNames.length {
        return current!.typeParamConstraintNames[index]
      }
    }
    current = current!.parent
  }
  return ""
}

export function typeParamConstraint(scope: Scope, name: string): ResolvedType | null {
  let current: Scope | null = scope
  while current != null {
    for index of 0..<current!.typeParams.length {
      if current!.typeParams[index] == name && index < current!.typeParamConstraints.length {
        return current!.typeParamConstraints[index].type_
      }
    }
    current = current!.parent
  }
  return null
}

export function lookup(scope: Scope, name: string): Binding | null {
  let current: Scope | null = scope
  while current != null {
    for binding of current!.bindings { if binding.name == name { return binding } }
    current = current!.parent
  }
  return null
}

export function returnScope(scope: Scope): Scope | null {
  let current: Scope | null = scope
  while current != null {
    if current!.returnType != null { return current }
    current = current!.parent
  }
  return null
}

export function valueYieldScope(scope: Scope): Scope | null {
  let current: Scope | null = scope
  while current != null {
    if current!.inValueYieldBlock { return current }
    current = current!.parent
  }
  return null
}

export function currentThisType(scope: Scope): ResolvedType {
  let current: Scope | null = scope
  while current != null {
    if current!.thisType != null { return current!.thisType! }
    current = current!.parent
  }
  return unknownType()
}

export function iterableElement(iterable: ResolvedType): ResolvedType {
  case iterable {
    array: ArrayResolvedType -> { return array.elementType }
    map: MapResolvedType -> { return tupleType([map.keyType, map.valueType]) }
    set: SetResolvedType -> { return set.elementType }
    stream: StreamResolvedType -> { return stream.elementType }
    _: RangeResolvedType -> { return primitive("int") }
    _ -> { return unknownType() }
  }
  return unknownType()
}

export function isBuiltinCallable(name: string): bool {
  return name == "byte" || name == "string" || name == "int" || name == "long" || name == "float" || name == "double" || name == "bool" || name == "println" || name == "panic" || name == "assert" || name == "catchPanic" || name == "Success" || name == "Failure"
}

export function isPanicCall(expression: Expression): bool {
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

export function builtinCallable(name: string): ResolvedType {
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

export function isBuiltinPrintlnCall(callee: Expression): bool {
  case callee {
    identifier: Identifier -> { return identifier.name == "println" }
    _ -> { return false }
  }
}

export function symbolFor(info: ModuleInfo, name: string): Symbol | null {
  for symbol of info.symbols { if symbol.name == name { return symbol } }
  for imported of info.imports { if imported.localName == name { return imported.symbol } }
  return null
}

export function declarationFor(result: AnalysisResult, symbol: Symbol): Statement | null {
  module := findModule(result, symbol.module)
  if module == null { return null }
  for statement of module!.program.statements {
    if statement.kind == "export-list" { continue }
    candidate := symbolName(statement)
    if candidate == symbol.name { return statement }
  }
  return null
}

export function symbolName(statement: Statement): string {
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
