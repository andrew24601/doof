// Function and top-level declaration rendering for the self-hosted emitter.
//
// Function signatures are shared by header planning and source rendering so
// the two halves cannot silently drift apart.

import {
  Block, ClassDeclaration, ConstDeclaration, Expression, FunctionDeclaration,
  ImmutableBinding, LetDeclaration, ReadonlyDeclaration,
} from "./ast"
import {
  ArrayResolvedType, ClassType, FunctionType, ResolvedType, TupleResolvedType,
  UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitBlock } from "./emitter-stmt"
import { emitType } from "./emitter-types"

export function emitFunctionSignature(fn: FunctionDeclaration, name: string = "", modulePath: string = ""): string {
  functionType := checkedFunctionType(fn)
  functionName := if name == "" then fn.name else name
  ensureKnown(functionType.returnType, fn.name + " return type")
  let result = emitType(functionType.returnType, modulePath) + " " + functionName + "("
  for i of 0..<fn.params.length {
    if i > 0 { result = result + ", " }
    parameterType := fn.params[i].resolvedType ?? functionType.params[i].type_
    ensureKnown(parameterType, fn.name + " parameter " + fn.params[i].name)
    result = result + emitType(parameterType, modulePath) + " " + cppIdentifier(fn.params[i].name)
  }
  return result + ")"
}

export function emitFunctionDefinition(fn: FunctionDeclaration, context: EmitContext, name: string = ""): string {
  if fn.bodyless { return "" }
  previousReturnVariantOptional := context.currentReturnVariantOptional
  previousFunctionName := context.currentFunctionName
  context.currentFunctionName = fn.name
  case fn.resolvedType! {
    function_: FunctionType -> {
      context.currentReturnVariantOptional = returnNeedsAstVariant(function_.returnType)
    }
    _ -> { context.currentReturnVariantOptional = false }
  }
  let result = emitFunctionSignature(fn, name, context.modulePath) + " {\n"
  case fn.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentReturnVariantOptional = previousReturnVariantOptional
  context.currentFunctionName = previousFunctionName
  return result + "}\n"
}

export function emitFunctionDeclaration(fn: FunctionDeclaration, name: string = "", modulePath: string = ""): string {
  return emitFunctionSignature(fn, name, modulePath) + ";\n"
}

export function emitValueDeclaration(statement: ConstDeclaration | ReadonlyDeclaration | ImmutableBinding | LetDeclaration, context: EmitContext): string {
  case statement {
    const_: ConstDeclaration -> { return "const auto " + cppIdentifier(const_.name) + " = " + emitExpression(const_.value, context, const_.resolvedType) + ";\n" }
    readonly_: ReadonlyDeclaration -> { return "const auto " + cppIdentifier(readonly_.name) + " = " + emitExpression(readonly_.value, context, readonly_.resolvedType) + ";\n" }
    binding: ImmutableBinding -> { return "const auto " + cppIdentifier(binding.name) + " = " + emitExpression(binding.value, context, binding.resolvedType) + ";\n" }
    let_: LetDeclaration -> { return "auto " + cppIdentifier(let_.name) + " = " + emitExpression(let_.value, context, let_.resolvedType) + ";\n" }
  }
  return ""
}

function checkedFunctionType(fn: FunctionDeclaration): FunctionType {
  case fn.resolvedType! {
    resolved: FunctionType -> { return resolved }
    _ -> { panic("Function " + fn.name + " was not checked before emission") }
  }
  return FunctionType { params: [], returnType: VoidType {} }
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
  let result = "struct " + decl.name + " {\n"
  for field of decl.fields {
    for name of field.names {
      ensureKnown(field.resolvedType!, decl.name + "." + name)
      result = result + "    " + emitType(field.resolvedType!, context.modulePath) + " " + cppIdentifier(name)
      if field.defaultValue != null {
        result = result + " = " + emitExpression(field.defaultValue!, context, field.resolvedType)
      }
      result = result + ";\n"
    }
  }
  for method of decl.methods {
    staticPrefix := if method.static_ then "static " else ""
    result = result + "    " + staticPrefix + emitFunctionSignature(method, "", context.modulePath) + ";\n"
  }
  return result + "};\n"
}

export function emitClassMethodDefinition(owner: ClassDeclaration, method: FunctionDeclaration, context: EmitContext): string {
  if method.bodyless { return "" }
  previous := context.currentClass
  previousNative := context.currentClassNative
  previousReturnVariantOptional := context.currentReturnVariantOptional
  previousFunctionName := context.currentFunctionName
  context.currentClass = owner.name
  context.currentClassNative = owner.native_
  context.currentFunctionName = method.name
  case method.resolvedType! {
    function_: FunctionType -> {
      context.currentReturnVariantOptional = returnNeedsAstVariant(function_.returnType)
    }
    _ -> { context.currentReturnVariantOptional = false }
  }
  ownerName := if owner.native_ then (if owner.nativeCppName == "" then owner.name else owner.nativeCppName) else owner.name
  let result = emitFunctionSignature(method, ownerName + "::" + method.name, context.modulePath) + " {\n"
  case method.body {
    expression: Expression -> { result = result + "    return " + emitExpression(expression, context) + ";\n" }
    block: Block -> { result = result + emitBlock(block, 1, context) }
  }
  context.currentClass = previous
  context.currentClassNative = previousNative
  context.currentReturnVariantOptional = previousReturnVariantOptional
  context.currentFunctionName = previousFunctionName
  return result + "}\n"
}
