// Function and top-level declaration rendering for the self-hosted emitter.
//
// Function signatures are shared by header planning and source rendering so
// the two halves cannot silently drift apart.

import {
  Block, ClassDeclaration, ClassField, ConstDeclaration, Expression, FunctionDeclaration, InterfaceDeclaration,
  ImmutableBinding, LetDeclaration, ReadonlyDeclaration,
} from "./ast"
import {
  ActorType, ArrayResolvedType, ClassType, FunctionType, InterfaceType, PromiseType, ResolvedType, ResultResolvedType, StreamResolvedType, Symbol, TupleResolvedType,
  UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitBlock } from "./emitter-stmt"
import { emitContextType, emitType, specializeEmitType } from "./emitter-types"
import { scanCapturedMutablesInBlock, scanCapturedMutablesInExpression } from "./emitter-expr-lambda"
import { moduleNamespace } from "./emitter-names"
import { MethodInstantiation } from "./emitter-monomorphize"
import { emitGeneratedJsonDeclarations } from "./emitter-json"

export function emitFunctionSignature(fn: FunctionDeclaration, name: string = "", modulePath: string = "", includeDefaults: bool = false, defaultContext: EmitContext | null = null, ownerTypeParams: string[] = []): string {
  let functionType = checkedFunctionType(fn)
  if defaultContext != null {
    case specializeEmitType(functionType, defaultContext!) {
      specialized: FunctionType -> { functionType = specialized }
      _ -> { }
    }
  }
  functionName := cppIdentifier(if name == "" then fn.name else name)
  let genericParams: string[] = []
  for typeParam of ownerTypeParams { genericParams.push(typeParam) }
  for typeParam of fn.typeParams { genericParams.push(typeParam) }
  returnType := if defaultContext == null then emitType(functionType.returnType, modulePath) else emitContextType(functionType.returnType, defaultContext!)
  ensureKnown(functionType.returnType, fn.name + " return type")
  let result = returnType + " " + functionName + "("
  for i of 0..<fn.params.length {
    if i > 0 { result = result + ", " }
    parameterType := fn.params[i].resolvedType ?? functionType.params[i].type_
    parameterText := if defaultContext == null then emitType(parameterType, modulePath) else emitContextType(parameterType, defaultContext!)
    ensureKnown(parameterType, fn.name + " parameter " + fn.params[i].name)
    result = result + parameterText + " " + cppIdentifier(fn.params[i].name)
    if includeDefaults && canEmitDefault(fn, i) {
      if defaultContext == null { panic("Default parameter emission requires an emit context") }
      result = result + " = " + emitExpression(fn.params[i].defaultValue!, defaultContext!, parameterType)
    }
  }
  return result + ")"
}

export function emitFunctionDefinition(fn: FunctionDeclaration, context: EmitContext, name: string = ""): string {
  if fn.bodyless { return "" }
  previousReturnErrorType := context.currentReturnErrorType
  previousFunctionName := context.currentFunctionName
  previousCapturedMutables := context.capturedMutables
  context.currentFunctionName = fn.name
  context.capturedMutables = []
  case fn.body {
    expression: Expression -> { context.capturedMutables = scanCapturedMutablesInExpression(expression) }
    block: Block -> { context.capturedMutables = scanCapturedMutablesInBlock(block) }
  }
  case fn.resolvedType! {
    function_: FunctionType -> {
      case function_.returnType {
        result: ResultResolvedType -> { context.currentReturnErrorType = emitContextType(result.errorType, context) }
        _ -> { context.currentReturnErrorType = "" }
      }
    }
    _ -> { context.currentReturnErrorType = "" }
  }
  let result = (if context.substitution == null then templatePrefix(fn.typeParams) else "") + emitFunctionSignature(fn, name, context.modulePath, false, context) + " {\n"
  case fn.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context, functionReturnType(fn)) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentReturnErrorType = previousReturnErrorType
  context.currentFunctionName = previousFunctionName
  context.capturedMutables = previousCapturedMutables
  return result + "}\n"
}

export function emitFunctionDeclaration(fn: FunctionDeclaration, name: string = "", modulePath: string = "", defaultContext: EmitContext | null = null): string {
  template := if defaultContext == null || defaultContext!.substitution == null then templatePrefix(fn.typeParams) else ""
  return template + emitFunctionSignature(fn, name, modulePath, true, defaultContext) + ";\n"
}

// A generic native import is a Doof generic declaration, not a promise that
// the mapped C++ target is a template. Each concrete Doof instantiation calls
// the native overload set with concrete arguments and lets C++ perform normal
// overload resolution or template deduction.
export function emitNativeFunctionAdapterDefinition(fn: FunctionDeclaration, emittedName: string, context: EmitContext): string {
  signature := emitFunctionSignature(fn, emittedName, context.modulePath, false, context)
  nativeName := if fn.nativeCppName == "" then fn.name else fn.nativeCppName
  let call = "::" + nativeName + "("
  for i of 0..<fn.params.length {
    if i > 0 { call = call + ", " }
    call = call + cppIdentifier(fn.params[i].name)
  }
  call = call + ")"
  returnType := specializeEmitType(checkedFunctionType(fn).returnType, context)
  if returnType.kind == "void" { return signature + " {\n    " + call + ";\n}\n" }
  return signature + " {\n    return " + call + ";\n}\n"
}

export function emitValueDeclaration(statement: ConstDeclaration | ReadonlyDeclaration | ImmutableBinding | LetDeclaration, context: EmitContext): string {
  case statement {
    const_: ConstDeclaration -> { return valuePrefix(const_.name, const_.resolvedType!, false, context) + " = " + emitExpression(const_.value, context, const_.resolvedType) + ";\n" }
    readonly_: ReadonlyDeclaration -> { return valuePrefix(readonly_.name, readonly_.resolvedType!, false, context) + " = " + emitExpression(readonly_.value, context, readonly_.resolvedType) + ";\n" }
    binding: ImmutableBinding -> { return valuePrefix(binding.name, binding.resolvedType!, false, context) + " = " + emitExpression(binding.value, context, binding.resolvedType) + ";\n" }
    let_: LetDeclaration -> { return valuePrefix(let_.name, let_.resolvedType!, true, context) + " = " + emitExpression(let_.value, context, let_.resolvedType) + ";\n" }
  }
  return ""
}

function valuePrefix(name: string, resolvedType: ResolvedType, mutable: bool, context: EmitContext): string {
  case resolvedType {
    _: InterfaceType -> { return (if mutable then "" else "const ") + emitContextType(resolvedType, context) + " " + cppIdentifier(name) }
    _: StreamResolvedType -> { return (if mutable then "" else "const ") + emitContextType(resolvedType, context) + " " + cppIdentifier(name) }
    _ -> { return (if mutable then "auto " else "const auto ") + cppIdentifier(name) }
  }
  return "auto " + cppIdentifier(name)
}

function checkedFunctionType(fn: FunctionDeclaration): FunctionType {
  case fn.resolvedType! {
    resolved: FunctionType -> { return resolved }
    _ -> { panic("Function " + fn.name + " was not checked before emission") }
  }
  return FunctionType { params: [], returnType: VoidType {} }
}

function functionReturnType(fn: FunctionDeclaration): ResolvedType | null {
  case fn.resolvedType! {
    function_: FunctionType -> { return function_.returnType }
    _ -> { return null }
  }
  return null
}

function canEmitDefault(fn: FunctionDeclaration, index: int): bool {
  if fn.params[index].defaultValue == null { return false }
  for i of index + 1..<fn.params.length {
    if fn.params[i].defaultValue == null { return false }
  }
  return true
}

function ensureKnown(resolvedType: ResolvedType, owner: string): void {
  case resolvedType {
    _: UnknownType -> { panic("Cannot emit unresolved type for " + owner) }
    array: ArrayResolvedType -> { ensureKnown(array.elementType, owner + " element") }
    tuple: TupleResolvedType -> {
      for i of 0..<tuple.elements.length { ensureKnown(tuple.elements[i], owner + " tuple element") }
    }
    union_: UnionResolvedType -> {
      for member of union_.types { ensureKnown(member, owner + " union member") }
    }
    function_: FunctionType -> {
      for parameter of function_.params { ensureKnown(parameter.type_, owner + " callback parameter") }
      ensureKnown(function_.returnType, owner + " callback return")
    }
    actor: ActorType -> { ensureKnown(actor.innerClass, owner + " actor state") }
    promise: PromiseType -> { ensureKnown(promise.valueType, owner + " promise value") }
    _ -> { }
  }
}

export function emitClassDeclaration(decl: ClassDeclaration, context: EmitContext, emittedName: string = "", concreteMethods: MethodInstantiation[] = []): string {
  if decl.native_ { return "" }
  className := if emittedName == "" then decl.name else emittedName
  let ownershipName = className
  if emittedName == "" && decl.typeParams.length > 0 {
    ownershipName = ownershipName + "<"
    for index of 0..<decl.typeParams.length {
      if index > 0 { ownershipName = ownershipName + ", " }
      ownershipName = ownershipName + decl.typeParams[index]
    }
    ownershipName = ownershipName + ">"
  }
  let inheritance = if decl.struct_ then "" else " : public std::enable_shared_from_this<" + ownershipName + ">"
  let result = (if context.substitution == null then templatePrefix(decl.typeParams) else "") + "struct " + className + inheritance + " {\n"
  for field of decl.fields {
    for name of field.names {
      effectiveType := fieldTypeForEmission(field)
      fieldType := fieldTypeTextForEmission(field, effectiveType, context)
      ensureKnown(effectiveType, decl.name + "." + name)
      result = result + "    " + (if field.static_ then "static " else "") + fieldType + " " + cppIdentifier(name)
      if field.defaultValue != null && !field.static_ {
        defaultText := emitExpression(field.defaultValue!, context, effectiveType)
        if !defaultNeedsImportedDefinition(defaultText, context) { result = result + " = " + defaultText }
      }
      result = result + ";\n"
    }
  }
  if hasInstanceFields(decl) {
    // C++ only permits defaults on a trailing all-defaulted parameter suffix.
    // Mirror field defaults there so positional construction, including
    // Actor<State>(), can omit the same values as named construction.
    let lastRequiredParameter = -1
    let parameterIndex = 0
    for field of decl.fields {
      if field.static_ { continue }
      for name of field.names {
        if field.defaultValue == null { lastRequiredParameter = parameterIndex }
        parameterIndex = parameterIndex + 1
      }
    }
    let suppressTrailingDefaults = false
    parameterIndex = 0
    for field of decl.fields {
      if field.static_ { continue }
      for name of field.names {
        if parameterIndex > lastRequiredParameter && field.defaultValue != null {
          defaultText := emitExpression(field.defaultValue!, context, fieldTypeForEmission(field))
          if defaultNeedsImportedDefinition(defaultText, context) { suppressTrailingDefaults = true }
        }
        parameterIndex = parameterIndex + 1
      }
    }
    result = result + "    " + className + "("
    let firstParameter = true
    parameterIndex = 0
    for field of decl.fields {
      if field.static_ { continue }
      for name of field.names {
        if !firstParameter { result = result + ", " }
        firstParameter = false
        effectiveType := fieldTypeForEmission(field)
        fieldType := fieldTypeTextForEmission(field, effectiveType, context)
        result = result + fieldType + " " + cppIdentifier(name)
        if !suppressTrailingDefaults && parameterIndex > lastRequiredParameter && field.defaultValue != null {
          defaultText := emitExpression(field.defaultValue!, context, effectiveType)
          if !defaultNeedsImportedDefinition(defaultText, context) { result = result + " = " + defaultText }
        }
        parameterIndex = parameterIndex + 1
      }
    }
    result = result + ") : "
    let firstInitializer = true
    for field of decl.fields {
      if field.static_ { continue }
      for name of field.names {
        if !firstInitializer { result = result + ", " }
        firstInitializer = false
        result = result + cppIdentifier(name) + "(" + cppIdentifier(name) + ")"
      }
    }
    result = result + " {}\n"
  } else if !decl.struct_ {
    result = result + "    " + className + "() {}\n"
  }
  for method of decl.methods {
    if method.typeParams.length > 0 {
      if decl.typeParams.length == 0 {
        result = result + emitInlineClassMethod(decl, method, context)
      } else {
        for instantiation of concreteMethods {
          if instantiation.declaration.name != method.name { continue }
          previousSubstitution := context.substitution
          context.substitution = instantiation.substitution
          result = result + emitInlineClassMethod(decl, method, context, instantiation.emittedName)
          context.substitution = previousSubstitution
        }
      }
    } else if decl.typeParams.length > 0 || context.substitution != null {
      result = result + emitInlineClassMethod(decl, method, context)
    } else {
      staticPrefix := if method.static_ then "static " else ""
      result = result + "    " + templatePrefix(method.typeParams) + staticPrefix + emitFunctionSignature(method, "", context.modulePath, true, context, decl.typeParams) + ";\n"
    }
  }
  if decl.destructor_ != null {
    result = result + "    ~" + className + "() {\n"
    result = result + emitBlock(decl.destructor_!, 2, context)
    result = result + "    }\n"
  }
  result = result + emitGeneratedJsonDeclarations(decl, context)
  return result + "};\n"
}

// Imported static calls require a complete type, which may be unavailable
// while breaking a generated-header cycle. Call sites already materialize
// Doof defaults, so those expressions do not also belong in the C++ header.
function defaultNeedsImportedDefinition(defaultText: string, context: EmitContext): bool {
  for imported of context.imports {
    if defaultText.contains("::" + moduleNamespace(imported.sourceModule) + "::") { return true }
  }
  return false
}

function fieldTypeForEmission(field: ClassField): ResolvedType {
  if field.resolvedType == null { panic("Class field was not resolved before emission") }
  return field.resolvedType!
}

function fieldTypeTextForEmission(field: ClassField, resolvedType: ResolvedType, context: EmitContext): string {
  typeText := emitContextType(resolvedType, context)
  if field.defaultValue == null { return typeText }
  defaultText := emitExpression(field.defaultValue!, context, resolvedType)
  if defaultText == "std::monostate{}" && typeText.startsWith("std::variant<") && !typeText.startsWith("std::variant<std::monostate") {
    return "std::variant<std::monostate, " + typeText.substring(13, 1000000)
  }
  return typeText
}

function hasInstanceFields(decl: ClassDeclaration): bool {
  for field of decl.fields { if !field.static_ { return true } }
  return false
}

export function emitStaticClassFieldDefinitions(owner: ClassDeclaration, context: EmitContext): string {
  if owner.native_ || owner.typeParams.length > 0 { return "" }
  let result = ""
  for field of owner.fields {
    if !field.static_ || field.defaultValue == null { continue }
    for name of field.names {
      resolvedType := fieldTypeForEmission(field)
      result = result + fieldTypeTextForEmission(field, resolvedType, context) + " " + owner.name + "::" + cppIdentifier(name) + " = " + emitExpression(field.defaultValue!, context, resolvedType) + ";\n"
    }
  }
  return result
}

function emitInlineClassMethod(owner: ClassDeclaration, method: FunctionDeclaration, context: EmitContext, emittedName: string = ""): string {
  previous := context.currentClass
  previousNative := context.currentClassNative
  previousFunctionName := context.currentFunctionName
  previousFunctionStatic := context.currentFunctionStatic
  previousGenericTypeParams := context.genericTypeParams
  previousCapturedMutables := context.capturedMutables
  context.currentClass = owner.name
  context.currentClassNative = owner.native_
  context.currentFunctionName = method.name
  context.currentFunctionStatic = method.static_
  context.genericTypeParams = []
  context.capturedMutables = []
  case method.body {
    expression: Expression -> { context.capturedMutables = scanCapturedMutablesInExpression(expression) }
    block: Block -> { context.capturedMutables = scanCapturedMutablesInBlock(block) }
  }
  for typeParam of owner.typeParams { context.genericTypeParams.push(typeParam) }
  for typeParam of method.typeParams { context.genericTypeParams.push(typeParam) }
  staticPrefix := if method.static_ then "static " else ""
  template := if context.substitution == null then templatePrefix(method.typeParams) else ""
  let result = "    " + template + staticPrefix + emitFunctionSignature(method, emittedName, context.modulePath, true, context, owner.typeParams) + " {\n"
  case method.body {
    expression: Expression -> { result = result + "        return " + emitExpression(expression, context, functionReturnType(method)) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 2, context) }
  }
  result = result + "    }\n"
  context.currentClass = previous
  context.currentClassNative = previousNative
  context.currentFunctionName = previousFunctionName
  context.currentFunctionStatic = previousFunctionStatic
  context.genericTypeParams = previousGenericTypeParams
  context.capturedMutables = previousCapturedMutables
  return result
}

function templatePrefix(typeParams: string[]): string {
  if typeParams.length == 0 { return "" }
  let result = "template <"
  for i of 0..<typeParams.length {
    if i > 0 { result = result + ", " }
    result = result + "typename " + typeParams[i]
  }
  return result + ">\n"
}

export function emitInterfaceAlias(decl: InterfaceDeclaration, context: EmitContext): string {
  if decl.resolvedSymbol == null { panic("Interface " + decl.name + " was not analyzed") }
  implementations := decl.resolvedSymbol!.implementations
  if implementations.length == 0 { panic("Interface " + decl.name + " has no implementing classes") }
  let result = "using " + decl.name + " = std::variant<"
  let first = true
  for symbol of implementations {
    if !first { result = result + ", " }
    first = false
    className := if symbol.native_ then "::" + (if symbol.nativeCppName == "" then symbol.name else symbol.nativeCppName) else ownedClassName(symbol, context.modulePath)
    result = result + "std::shared_ptr<" + className + ">"
  }
  return result + ">;\n"
}

function ownedClassName(symbol: Symbol, currentModulePath: string): string {
  if symbol.module == currentModulePath || currentModulePath == "" { return if symbol.originalName == "" then symbol.name else symbol.originalName }
  return "::" + moduleNamespace(symbol.module) + "::" + (if symbol.originalName == "" then symbol.name else symbol.originalName)
}

export function emitClassMethodDefinition(owner: ClassDeclaration, method: FunctionDeclaration, context: EmitContext): string {
  if method.bodyless || method.typeParams.length > 0 { return "" }
  previous := context.currentClass
  previousNative := context.currentClassNative
  previousReturnErrorType := context.currentReturnErrorType
  previousFunctionName := context.currentFunctionName
  previousFunctionStatic := context.currentFunctionStatic
  previousCapturedMutables := context.capturedMutables
  context.currentClass = owner.name
  context.currentClassNative = owner.native_
  context.currentFunctionName = method.name
  context.currentFunctionStatic = method.static_
  context.capturedMutables = []
  case method.body {
    expression: Expression -> { context.capturedMutables = scanCapturedMutablesInExpression(expression) }
    block: Block -> { context.capturedMutables = scanCapturedMutablesInBlock(block) }
  }
  case method.resolvedType! {
    function_: FunctionType -> {
      case function_.returnType {
        result: ResultResolvedType -> { context.currentReturnErrorType = emitContextType(result.errorType, context) }
        _ -> { context.currentReturnErrorType = "" }
      }
    }
    _ -> { context.currentReturnErrorType = "" }
  }
  ownerName := if owner.native_ then (if owner.nativeCppName == "" then owner.name else owner.nativeCppName) else owner.name
  let result = emitFunctionSignature(method, ownerName + "::" + cppIdentifier(method.name), context.modulePath, false, context) + " {\n"
  case method.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context, functionReturnType(method)) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentClass = previous
  context.currentClassNative = previousNative
  context.currentReturnErrorType = previousReturnErrorType
  context.currentFunctionName = previousFunctionName
  context.currentFunctionStatic = previousFunctionStatic
  context.capturedMutables = previousCapturedMutables
  return result + "}\n"
}
