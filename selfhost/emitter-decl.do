// Function and top-level declaration rendering for the self-hosted emitter.
//
// Function signatures are shared by header planning and source rendering so
// the two halves cannot silently drift apart.

import {
  Block, ClassDeclaration, ClassField, ConstDeclaration, Expression, FunctionDeclaration, InterfaceDeclaration,
  ImmutableBinding, LetDeclaration, ReadonlyDeclaration,
} from "./ast"
import {
  ArrayResolvedType, ClassType, FunctionType, InterfaceType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, ResolvedType, ResultResolvedType, StreamResolvedType, Symbol, TupleResolvedType,
  UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitBlock } from "./emitter-stmt"
import { emitType } from "./emitter-types"

export function emitFunctionSignature(fn: FunctionDeclaration, name: string = "", modulePath: string = "", includeDefaults: bool = false, defaultContext: EmitContext | null = null, ownerTypeParams: string[] = []): string {
  functionType := checkedFunctionType(fn)
  functionName := if name == "" then fn.name else name
  let genericParams: string[] = []
  for typeParam of ownerTypeParams { genericParams.push(typeParam) }
  for typeParam of fn.typeParams { genericParams.push(typeParam) }
  returnType := emitType(functionType.returnType, modulePath)
  ensureKnown(functionType.returnType, fn.name + " return type")
  let result = returnType + " " + functionName + "("
  for i of 0..<fn.params.length {
    if i > 0 { result = result + ", " }
    parameterType := fn.params[i].resolvedType ?? functionType.params[i].type_
    parameterText := emitType(parameterType, modulePath)
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
  previousReturnVariantOptional := context.currentReturnVariantOptional
  previousReturnErrorType := context.currentReturnErrorType
  previousFunctionName := context.currentFunctionName
  context.currentFunctionName = fn.name
  case fn.resolvedType! {
    function_: FunctionType -> {
      context.currentReturnVariantOptional = returnNeedsAstVariant(function_.returnType)
      case function_.returnType {
        result: ResultResolvedType -> { context.currentReturnErrorType = emitType(result.errorType, context.modulePath) }
        _ -> { context.currentReturnErrorType = "" }
      }
    }
    _ -> { context.currentReturnVariantOptional = false; context.currentReturnErrorType = "" }
  }
  let result = templatePrefix(fn.typeParams) + emitFunctionSignature(fn, name, context.modulePath) + " {\n"
  case fn.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context, functionReturnType(fn)) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentReturnVariantOptional = previousReturnVariantOptional
  context.currentReturnErrorType = previousReturnErrorType
  context.currentFunctionName = previousFunctionName
  return result + "}\n"
}

export function emitFunctionDeclaration(fn: FunctionDeclaration, name: string = "", modulePath: string = "", defaultContext: EmitContext | null = null): string {
  return emitFunctionSignature(fn, name, modulePath, true, defaultContext) + ";\n"
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
    _: InterfaceType -> { return (if mutable then "" else "const ") + emitType(resolvedType, context.modulePath) + " " + cppIdentifier(name) }
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
    _ -> { }
  }
}

function returnNeedsAstVariant(resolvedType: ResolvedType): bool {
  case resolvedType {
    union_: UnionResolvedType -> {
      let hasNull = false
      let nonNullCount = 0
      for member of union_.types {
        if member.kind == "null" { hasNull = true }
        else { nonNullCount = nonNullCount + 1 }
      }
      // Nullable unions with multiple non-null arms are represented as a
      // monostate-prefixed variant in C++.  Returns need the same promotion
      // as assignments and constructor fields.
      return hasNull && nonNullCount > 1
    }
    _ -> { return false }
  }
  return false
}

export function emitClassDeclaration(decl: ClassDeclaration, context: EmitContext): string {
  if decl.native_ { return "" }
  let inheritance = ""
  for interfaceRef of decl.implements_ {
    if interfaceRef.name == "Stream" && interfaceRef.typeArgs.length >= 1 {
      case interfaceRef.resolvedType! {
        stream: StreamResolvedType -> { inheritance = " : public doof::StreamBase<" + emitType(stream.elementType, context.modulePath) + ">" }
        _ -> { panic("Stream implementation has no resolved element type") }
      }
    }
  }
  let result = templatePrefix(decl.typeParams) + "struct " + decl.name + inheritance + " {\n"
  for field of decl.fields {
    for name of field.names {
      effectiveType := fieldTypeForEmission(field)
      fieldType := emitType(effectiveType, context.modulePath)
      ensureKnown(effectiveType, decl.name + "." + name)
      result = result + "    " + (if field.static_ then "static " else "") + fieldType + " " + cppIdentifier(name)
      if field.defaultValue != null && !field.static_ {
        result = result + " = " + emitExpression(field.defaultValue!, context, effectiveType)
      }
      result = result + ";\n"
    }
  }
  if hasInstanceFields(decl) {
    result = result + "    " + decl.name + "("
    let firstParameter = true
    for field of decl.fields {
      if field.static_ { continue }
      for name of field.names {
        if !firstParameter { result = result + ", " }
        firstParameter = false
        fieldType := emitType(fieldTypeForEmission(field), context.modulePath)
        result = result + fieldType + " " + cppIdentifier(name)
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
  }
  for method of decl.methods {
    if decl.typeParams.length > 0 {
      result = result + emitInlineClassMethod(decl, method, context)
    } else {
      staticPrefix := if method.static_ then "static " else ""
      result = result + "    " + templatePrefix(method.typeParams) + staticPrefix + emitFunctionSignature(method, "", context.modulePath, true, context, decl.typeParams) + ";\n"
    }
  }
  if decl.typeParams.length == 0 { result = result + "    doof::JsonObject toJsonObject() const;\n" }
  return result + "};\n"
}

function fieldTypeForEmission(field: ClassField): ResolvedType {
  if field.resolvedType == null { panic("Class field was not resolved before emission") }
  return field.resolvedType!
}

function hasInstanceFields(decl: ClassDeclaration): bool {
  for field of decl.fields { if !field.static_ { return true } }
  return false
}

export function emitGeneratedJsonMethods(owner: ClassDeclaration, context: EmitContext): string {
  if owner.native_ || owner.typeParams.length > 0 { return "" }
  let result = "doof::JsonObject " + owner.name + "::toJsonObject() const {\n"
  result = result + "    auto _json = std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>();\n"
  for field of owner.fields {
    for name of field.names {
      if field.resolvedType != null {
        result = result + "    (*_json)[\"" + name + "\"] = " + emitJsonField("this->" + cppIdentifier(name), field.resolvedType!, context) + ";\n"
      }
    }
  }
  return result + "    return _json;\n}\n"
}

export function emitStaticClassFieldDefinitions(owner: ClassDeclaration, context: EmitContext): string {
  if owner.native_ || owner.typeParams.length > 0 { return "" }
  let result = ""
  for field of owner.fields {
    if !field.static_ || field.defaultValue == null { continue }
    for name of field.names {
      resolvedType := fieldTypeForEmission(field)
      result = result + emitType(resolvedType, context.modulePath) + " " + owner.name + "::" + cppIdentifier(name) + " = " + emitExpression(field.defaultValue!, context, resolvedType) + ";\n"
    }
  }
  return result
}

function emitInlineClassMethod(owner: ClassDeclaration, method: FunctionDeclaration, context: EmitContext): string {
  previous := context.currentClass
  previousNative := context.currentClassNative
  previousFunctionName := context.currentFunctionName
  previousFunctionStatic := context.currentFunctionStatic
  previousGenericTypeParams := context.genericTypeParams
  context.currentClass = owner.name
  context.currentClassNative = owner.native_
  context.currentFunctionName = method.name
  context.currentFunctionStatic = method.static_
  context.genericTypeParams = []
  for typeParam of owner.typeParams { context.genericTypeParams.push(typeParam) }
  for typeParam of method.typeParams { context.genericTypeParams.push(typeParam) }
  staticPrefix := if method.static_ then "static " else ""
  let result = "    " + templatePrefix(method.typeParams) + staticPrefix + emitFunctionSignature(method, "", context.modulePath, true, context, owner.typeParams) + " {\n"
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

function emitJsonField(value: string, resolvedType: ResolvedType, context: EmitContext): string {
  case resolvedType {
    _: JsonValueResolvedType -> { return value }
    _: NullType -> { return "doof::json_value(nullptr)" }
    primitive: PrimitiveType -> {
      if primitive.name == "char" { return "doof::json_value(std::string(1, static_cast<char>(" + value + ")))" }
      if primitive.name == "byte" { return "doof::json_value(static_cast<int32_t>(" + value + "))" }
      return "doof::json_value(" + value + ")"
    }
    array: ArrayResolvedType -> {
      if array.elementType.kind == "json-value" { return "doof::json_value(" + value + ")" }
    }
    map: MapResolvedType -> {
      if map.keyType.kind == "primitive" && map.valueType.kind == "json-value" { return "doof::json_value(" + value + ")" }
    }
    class_: ClassType -> {
      if class_.symbol.native_ { return "doof::json_value(nullptr)" }
      return "doof::json_value(" + value + (if class_.symbol.kind == "struct" then "." else "->") + "toJsonObject())"
    }
    _ -> { }
  }
  return "doof::json_value(nullptr)"
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
  normalized := symbol.module.replaceAll("\\", "/")
  withoutRoot := if normalized.startsWith("/") then normalized.substring(1, 1000000) else normalized
  namespace := "app_" + withoutRoot.replaceAll("/", "_").replaceAll(".do", "").replaceAll("-", "_").replaceAll(".", "_") + "_"
  return "::" + namespace + "::" + (if symbol.originalName == "" then symbol.name else symbol.originalName)
}

export function emitClassMethodDefinition(owner: ClassDeclaration, method: FunctionDeclaration, context: EmitContext): string {
  if method.bodyless { return "" }
  previous := context.currentClass
  previousNative := context.currentClassNative
  previousReturnVariantOptional := context.currentReturnVariantOptional
  previousReturnErrorType := context.currentReturnErrorType
  previousFunctionName := context.currentFunctionName
  previousFunctionStatic := context.currentFunctionStatic
  context.currentClass = owner.name
  context.currentClassNative = owner.native_
  context.currentFunctionName = method.name
  context.currentFunctionStatic = method.static_
  case method.resolvedType! {
    function_: FunctionType -> {
      context.currentReturnVariantOptional = returnNeedsAstVariant(function_.returnType)
      case function_.returnType {
        result: ResultResolvedType -> { context.currentReturnErrorType = emitType(result.errorType, context.modulePath) }
        _ -> { context.currentReturnErrorType = "" }
      }
    }
    _ -> { context.currentReturnVariantOptional = false; context.currentReturnErrorType = "" }
  }
  ownerName := if owner.native_ then (if owner.nativeCppName == "" then owner.name else owner.nativeCppName) else owner.name
  let result = emitFunctionSignature(method, ownerName + "::" + method.name, context.modulePath) + " {\n"
  case method.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context, functionReturnType(method)) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentClass = previous
  context.currentClassNative = previousNative
  context.currentReturnVariantOptional = previousReturnVariantOptional
  context.currentReturnErrorType = previousReturnErrorType
  context.currentFunctionName = previousFunctionName
  context.currentFunctionStatic = previousFunctionStatic
  return result + "}\n"
}
