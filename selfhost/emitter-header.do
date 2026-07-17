// Initial C++ header planner and renderer for the self-hosted emitter.
//
// The planner is intentionally explicit: class declarations, function
// signatures, and future dependency decisions belong here, not in expression
// or statement emission.

import {
  ClassDeclaration, ConstDeclaration, EnumDeclaration, ExportDeclaration, Expression, FunctionDeclaration, InterfaceDeclaration,
  Program, ReadonlyDeclaration, Statement, TypeAliasDeclaration,
} from "./ast"
import { EmitContext, EmitModuleSurface } from "./emitter-context"
import { emitClassDeclaration, emitDescriptionComment, emitFunctionDeclaration, emitFunctionDefinition, emitInterfaceAlias } from "./emitter-decl"
import { emitExpression } from "./emitter-expr"
import { emitType } from "./emitter-types"
import {
  ArrayResolvedType, ClassType, EnumType, FunctionType, ImportBinding, InterfaceType,
  MapResolvedType, PrimitiveType, ResolvedType, ResultResolvedType, SetResolvedType, StreamResolvedType,
  Symbol, TupleResolvedType, UnionResolvedType, WeakResolvedType,
} from "./semantic"
import { moduleHeaderName, moduleNamespace, moduleNativeHeaderPath } from "./emitter-names"

export class HeaderPlan {
  functionSignatures: string[] = []
  nativeAdapterSignatures: string[] = []
  genericFunctionDefinitions: string[] = []
  exportedValueDefinitions: string[] = []
  earlyClassDefinitions: string[] = []
  classDefinitions: string[] = []
  interfaceAliases: string[] = []
  enumDefinitions: string[] = []
  typeAliases: string[] = []
  classForwardDeclarations: string[] = []
  typeOnlyForwardDeclarations: string[] = []
  typeOnlyModuleIncludes: string[] = []
  moduleIncludes: string[] = []
  nativeIncludes: string[] = []
  nativeAliases: string[] = []
  nativeNamespaces: string[] = []
  hasMain: bool = false
  mainReturnsInt: bool = false
  mainAcceptsArgs: bool = false
}

export function planHeader(program: Program, context: EmitContext): HeaderPlan {
  return planHeaders([program], context)
}

export function planHeaders(programs: Program[], context: EmitContext): HeaderPlan {
  plan := HeaderPlan {}
  for program of programs {
    for statement of program.statements { collect(statement, plan, context) }
  }
  for imported of context.imports {
    if imported.symbol != null && (imported.symbol!.kind == "class" || imported.symbol!.kind == "struct") && !surfaceSymbolIsGeneric(context, imported.symbol!) {
      declaration := "namespace " + moduleNamespace(imported.symbol!.module) + " { struct " + imported.symbol!.name + "; }\n"
      addUnique(plan.typeOnlyForwardDeclarations, declaration)
    } else if imported.symbol != null && imported.symbol!.kind == "enum" {
      declaration := "namespace " + moduleNamespace(imported.symbol!.module) + " { enum class " + imported.symbol!.name + "; }\n"
      addUnique(plan.typeOnlyForwardDeclarations, declaration)
    }
    if imported.typeOnly && !hasNonTypeOnlyImport(context.imports, imported.sourceModule) {
      includeName := moduleHeaderName(imported.sourceModule)
      addUnique(plan.typeOnlyModuleIncludes, includeName)
    }
  }
  for namespace of plan.nativeNamespaces {
    if namespace != "" {
      for imported of context.imports {
        if imported.symbol != null {
          if imported.symbol!.kind == "function" {
            if imported.symbol!.native_ || !surfaceFunctionIsGeneric(context, imported.symbol!) {
              target := if imported.symbol!.native_ then imported.symbol!.nativeCppName else moduleNamespace(imported.symbol!.module) + "::" + imported.symbol!.name
              addUnique(plan.nativeAliases, "namespace " + namespace + " { using ::" + target + "; }\n")
            }
          } else if !surfaceSymbolIsGeneric(context, imported.symbol!) {
            addNativeSymbolAlias(imported.symbol!, namespace, plan)
          }
          collectNativeModuleSurfaceAliases(imported.symbol!.module, namespace, plan, context)
        }
      }
    }
  }
  return plan
}

// Native headers often consume the complete public type surface around an
// extern signature, including sibling exports and types imported by those
// exports. Bridge that surface into the declared native namespace before the
// header is included.
function collectNativeModuleSurfaceAliases(modulePath: string, namespace: string, plan: HeaderPlan, context: EmitContext): void {
  for surface of context.moduleSurfaces {
    if surface.path != modulePath { continue }
    for symbol of surface.exports {
      if isNativeAliasType(symbol) && !surfaceTypeIsGeneric(surface, symbol.name) { addNativeSymbolAlias(symbol, namespace, plan) }
    }
    for imported of surface.imports {
      if imported.symbol != null && isNativeAliasType(imported.symbol!) && !surfaceSymbolIsGeneric(context, imported.symbol!) {
        addNativeSymbolAlias(imported.symbol!, namespace, plan)
      }
    }
    return
  }
}

function surfaceTypeIsGeneric(surface: EmitModuleSurface, name: string): bool {
  for genericName of surface.genericTypes { if genericName == name { return true } }
  return false
}

function isNativeAliasType(symbol: Symbol): bool {
  return symbol.kind == "class" || symbol.kind == "struct" || symbol.kind == "enum" || symbol.kind == "interface" || symbol.kind == "type-alias"
}

function collect(statement: Statement, plan: HeaderPlan, context: EmitContext): void {
  case statement {
    class_: ClassDeclaration -> {
      if class_.native_ {
        rawInclude := if class_.nativeHeader == "" then class_.name + ".hpp" else class_.nativeHeader
        include := moduleNativeHeaderPath(context.modulePath, rawInclude)
        addUnique(plan.nativeIncludes, include)
        namespace := nativeNamespace(class_.nativeCppName)
        addUnique(plan.nativeNamespaces, namespace)
        collectNativeClassAliases(class_, namespace, plan, context)
      } else if class_.typeParams.length == 0 || isNativeTemplateClass(context, class_.name) {
        if class_.typeParams.length == 0 { plan.classForwardDeclarations.push("struct " + class_.name + ";\n") }
        definition := emitClassDeclaration(class_, context)
        if classCanEmitBeforeModuleIncludes(class_) { plan.earlyClassDefinitions.push(definition) }
        else { plan.classDefinitions.push(definition) }
      }
    }
    interface_: InterfaceDeclaration -> { if interface_.typeParams.length == 0 { plan.interfaceAliases.push(emitInterfaceAlias(interface_, context)) } }
    enum_: EnumDeclaration -> { plan.enumDefinitions.push(emitEnumDeclaration(enum_, context)) }
    // Generic aliases are erased after checker substitution. Concrete uses
    // lower directly to their substituted concrete type.
    alias: TypeAliasDeclaration -> { if alias.typeParams.length == 0 { plan.typeAliases.push(emitTypeAlias(alias, context)) } }
    const_: ConstDeclaration -> { if const_.exported { plan.exportedValueDefinitions.push(emitDescriptionComment(const_.description, "") + emitExportedValue(const_.name, const_.value, context)) } }
    readonly_: ReadonlyDeclaration -> { if readonly_.exported { plan.exportedValueDefinitions.push(emitDescriptionComment(readonly_.description, "") + emitExportedValue(readonly_.name, readonly_.value, context)) } }
    fn: FunctionDeclaration -> {
      if fn.native_ {
        if fn.nativeHeader != "" { addUnique(plan.nativeIncludes, moduleNativeHeaderPath(context.modulePath, fn.nativeHeader)) }
        namespace := nativeNamespace(fn.nativeCppName)
        addUnique(plan.nativeNamespaces, namespace)
        if fn.resolvedType != null { collectNativeTypeAliases(fn.resolvedType!, namespace, plan, context) }
        return
      }
      if fn.name == "main" {
        plan.hasMain = true
        plan.mainReturnsInt = functionReturnsInt(fn)
        plan.mainAcceptsArgs = fn.params.length == 1
        plan.functionSignatures.push(emitFunctionDeclaration(fn, "doof_main", context.modulePath, context))
      } else if fn.typeParams.length > 0 {
        // Concrete definitions are added by the whole-program instantiation
        // plan; never expose a Doof generic as a C++ template.
      } else {
        plan.functionSignatures.push(emitFunctionDeclaration(fn, "", context.modulePath, context))
      }
    }
    export_: ExportDeclaration -> { collect(export_.declaration, plan, context) }
    _ -> { }
  }
}

// Primitive-only structs can be completed before generated module includes.
// This gives the opposite side of a header cycle the complete value types it
// needs while structs that store imported values still wait for their headers.
function classCanEmitBeforeModuleIncludes(class_: ClassDeclaration): bool {
  if !class_.struct_ || class_.typeParams.length > 0 { return false }
  for field of class_.fields {
    if !field.static_ && field.resolvedType != null && typeNeedsCompleteNominalDefinition(field.resolvedType!) { return false }
  }
  return true
}

function typeNeedsCompleteNominalDefinition(type_: ResolvedType): bool {
  case type_ {
    class_: ClassType -> {
      if class_.symbol.kind == "struct" || class_.symbol.native_ { return true }
      for argument of class_.typeArgs { if typeNeedsCompleteNominalDefinition(argument) { return true } }
      return false
    }
    enum_: EnumType -> { return true }
    interface_: InterfaceType -> {
      for argument of interface_.typeArgs { if typeNeedsCompleteNominalDefinition(argument) { return true } }
      return false
    }
    array: ArrayResolvedType -> { return typeNeedsCompleteNominalDefinition(array.elementType) }
    map: MapResolvedType -> {
      return typeNeedsCompleteNominalDefinition(map.keyType) || typeNeedsCompleteNominalDefinition(map.valueType)
    }
    set_: SetResolvedType -> { return typeNeedsCompleteNominalDefinition(set_.elementType) }
    stream: StreamResolvedType -> { return typeNeedsCompleteNominalDefinition(stream.elementType) }
    result: ResultResolvedType -> {
      return typeNeedsCompleteNominalDefinition(result.valueType) || typeNeedsCompleteNominalDefinition(result.errorType)
    }
    tuple: TupleResolvedType -> {
      for element of tuple.elements { if typeNeedsCompleteNominalDefinition(element) { return true } }
      return false
    }
    union_: UnionResolvedType -> {
      for member of union_.types { if typeNeedsCompleteNominalDefinition(member) { return true } }
      return false
    }
    function_: FunctionType -> {
      for parameter of function_.params { if typeNeedsCompleteNominalDefinition(parameter.type_) { return true } }
      return typeNeedsCompleteNominalDefinition(function_.returnType)
    }
    weak_: WeakResolvedType -> { return typeNeedsCompleteNominalDefinition(weak_.inner) }
    _ -> { return false }
  }
}

function isNativeTemplateClass(context: EmitContext, name: string): bool {
  key := context.modulePath + "::" + name
  for existing of context.nativeTemplateClassKeys { if existing == key { return true } }
  return false
}

function collectNativeClassAliases(class_: ClassDeclaration, namespace: string, plan: HeaderPlan, context: EmitContext): void {
  for field of class_.fields { if field.resolvedType != null { collectNativeTypeAliases(field.resolvedType!, namespace, plan, context) } }
  for method of class_.methods { if method.resolvedType != null { collectNativeTypeAliases(method.resolvedType!, namespace, plan, context) } }
}

function collectNativeTypeAliases(type_: ResolvedType, namespace: string, plan: HeaderPlan, context: EmitContext): void {
  case type_ {
    class_: ClassType -> {
      if !surfaceSymbolIsGeneric(context, class_.symbol) { addNativeSymbolAlias(class_.symbol, namespace, plan) }
      for argument of class_.typeArgs { collectNativeTypeAliases(argument, namespace, plan, context) }
    }
    enum_: EnumType -> { addNativeSymbolAlias(enum_.symbol, namespace, plan) }
    interface_: InterfaceType -> { if !surfaceSymbolIsGeneric(context, interface_.symbol) { addNativeSymbolAlias(interface_.symbol, namespace, plan) } }
    array: ArrayResolvedType -> { collectNativeTypeAliases(array.elementType, namespace, plan, context) }
    map: MapResolvedType -> {
      collectNativeTypeAliases(map.keyType, namespace, plan, context)
      collectNativeTypeAliases(map.valueType, namespace, plan, context)
    }
    set_: SetResolvedType -> { collectNativeTypeAliases(set_.elementType, namespace, plan, context) }
    stream: StreamResolvedType -> { collectNativeTypeAliases(stream.elementType, namespace, plan, context) }
    result: ResultResolvedType -> {
      collectNativeTypeAliases(result.valueType, namespace, plan, context)
      collectNativeTypeAliases(result.errorType, namespace, plan, context)
    }
    tuple: TupleResolvedType -> { for element of tuple.elements { collectNativeTypeAliases(element, namespace, plan, context) } }
    union_: UnionResolvedType -> { for member of union_.types { collectNativeTypeAliases(member, namespace, plan, context) } }
    weak_: WeakResolvedType -> { collectNativeTypeAliases(weak_.inner, namespace, plan, context) }
    function_: FunctionType -> {
      for parameter of function_.params { collectNativeTypeAliases(parameter.type_, namespace, plan, context) }
      collectNativeTypeAliases(function_.returnType, namespace, plan, context)
    }
    _ -> { }
  }
}

function surfaceSymbolIsGeneric(context: EmitContext, symbol: Symbol): bool {
  for surface of context.moduleSurfaces {
    if surface.path == symbol.module { return surfaceTypeIsGeneric(surface, symbol.name) }
  }
  return false
}

function surfaceFunctionIsGeneric(context: EmitContext, symbol: Symbol): bool {
  for surface of context.moduleSurfaces {
    if surface.path == symbol.module {
      for genericName of surface.genericFunctions { if genericName == symbol.name { return true } }
      return false
    }
  }
  return false
}

function addNativeSymbolAlias(symbol: Symbol, namespace: string, plan: HeaderPlan): void {
  if symbol.native_ || symbol.module == "" { return }
  if symbol.kind == "class" || symbol.kind == "struct" || symbol.kind == "interface" {
    addUnique(plan.typeOnlyForwardDeclarations, "namespace " + moduleNamespace(symbol.module) + " { struct " + symbol.name + "; }\n")
  } else if symbol.kind == "enum" {
    addUnique(plan.typeOnlyForwardDeclarations, "namespace " + moduleNamespace(symbol.module) + " { enum class " + symbol.name + "; }\n")
  }
  alias := "using " + symbol.name + " = ::" + moduleNamespace(symbol.module) + "::" + symbol.name + ";"
  addUnique(plan.nativeAliases, if namespace == "" then alias + "\n" else "namespace " + namespace + " { " + alias + " }\n")
}

export function renderHeader(plan: HeaderPlan, guardName: string): string {
  let result = "#pragma once\n"
  // Keep the runtime as the first header so GCC can consume its adjacent .gch.
  result = result + "#include \"doof_runtime.hpp\"\n"
  result = result + "#include <cstdint>\n#include <cmath>\n#include <functional>\n"
  result = result + "#include <memory>\n#include <optional>\n#include <ostream>\n#include <string>\n"
  result = result + "#include <tuple>\n#include <type_traits>\n#include <variant>\n#include <vector>\n"
  for declaration of plan.typeOnlyForwardDeclarations { result = result + declaration }
  if plan.typeOnlyForwardDeclarations.length > 0 { result = result + "\n" }
  result = result + "namespace " + guardName + " {\n"
  for declaration of plan.classForwardDeclarations { result = result + "    " + declaration }
  result = result + "}\n\n"
  if plan.earlyClassDefinitions.length > 0 {
    result = result + "namespace " + guardName + " {\n"
    for definition of plan.earlyClassDefinitions { result = result + "    " + definition }
    result = result + "}\n\n"
  }
  for include of plan.moduleIncludes {
    if !containsValue(plan.typeOnlyModuleIncludes, include) { result = result + "#include \"" + include + "\"\n" }
  }
  if plan.moduleIncludes.length > 0 { result = result + "\n" }
  for alias of plan.nativeAliases { result = result + alias }
  for include of plan.nativeIncludes {
    if include.startsWith("<") { result = result + "#include " + include + "\n" }
    else { result = result + "#include \"" + include + "\"\n" }
  }
  if plan.nativeAliases.length > 0 || plan.nativeIncludes.length > 0 { result = result + "\n" }
  result = result + "namespace " + guardName + " {\n"
  for alias of plan.interfaceAliases { result = result + "    " + alias }
  for definition of plan.enumDefinitions { result = result + "    " + definition }
  // Concrete class methods may call module-owned native adapters.
  for signature of plan.nativeAdapterSignatures { result = result + "    " + signature }
  for definition of plan.classDefinitions { result = result + "    " + definition }
  for alias of plan.typeAliases { result = result + "    " + alias }
  for signature of plan.functionSignatures { result = result + "    " + signature }
  result = result + "}\n\n"
  result = result + "namespace " + guardName + " {\n"
  for definition of plan.exportedValueDefinitions { result = result + "    " + definition }
  for definition of plan.genericFunctionDefinitions { result = result + definition }
  return result + "}\n"
}

function emitExportedValue(name: string, value: Expression, context: EmitContext): string {
  return "inline const auto " + name + " = " + emitExpression(value, context) + ";\n"
}

function addUnique(values: string[], value: string): void {
  for existing of values { if existing == value { return } }
  values.push(value)
}

function hasNonTypeOnlyImport(imports: ImportBinding[], sourceModule: string): bool {
  for imported of imports {
    if imported.sourceModule == sourceModule && !imported.typeOnly { return true }
  }
  return false
}

function containsValue(values: string[], value: string): bool {
  for existing of values { if existing == value { return true } }
  return false
}

function nativeNamespace(cppName: string): string {
  let separator = -1
  for i of 0..<cppName.length {
    if i + 1 < cppName.length && cppName.substring(i, i + 2) == "::" {
      separator = i
    }
  }
  if separator < 0 { return "" }
  return cppName.substring(0, separator)
}

function emitEnumDeclaration(declaration: EnumDeclaration, context: EmitContext): string {
  let result = emitDescriptionComment(declaration.description, "") + "enum class " + declaration.name + " {\n"
  for i of 0..<declaration.variants.length {
    variant := declaration.variants[i]
    result = result + emitDescriptionComment(variant.description, "    ") + "    " + variant.name
    if variant.value != null { result = result + " = " + emitExpression(variant.value!, context) }
    if i + 1 < declaration.variants.length { result = result + "," }
    result = result + "\n"
  }
  result = result + "};\n"
  result = result + "inline const char* " + declaration.name + "_name(" + declaration.name + " value) {\n"
  result = result + "  switch (value) {\n"
  for variant of declaration.variants {
    result = result + "    case " + declaration.name + "::" + variant.name + ": return \"" + variant.name + "\";\n"
  }
  result = result + "  }\n  return \"\";\n}\n"
  result = result + "inline std::optional<" + declaration.name + "> " + declaration.name + "_fromName(std::string_view value) {\n"
  for variant of declaration.variants {
    result = result + "  if (value == \"" + variant.name + "\") return " + declaration.name + "::" + variant.name + ";\n"
  }
  result = result + "  return std::nullopt;\n}\n"
  return result + "inline std::ostream& operator<<(std::ostream& output, " + declaration.name + " value) { return output << " + declaration.name + "_name(value); }\n"
}

function emitTypeAlias(alias: TypeAliasDeclaration, context: EmitContext): string {
  if alias.resolvedType == null { panic("Type alias " + alias.name + " was not checked before emission") }
  return emitDescriptionComment(alias.description, "") + "using " + alias.name + " = " + emitType(alias.resolvedType!, context.modulePath) + ";\n"
}

function functionReturnsInt(fn: FunctionDeclaration): bool {
  case fn.resolvedType! {
    function_: FunctionType -> {
      case function_.returnType {
        primitive: PrimitiveType -> { return primitive.name == "int" }
        _ -> { return false }
      }
    }
    _ -> { return false }
  }
  return false
}
