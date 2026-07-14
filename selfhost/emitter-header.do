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
import { emitClassDeclaration, emitFunctionDeclaration, emitFunctionDefinition, emitInterfaceAlias } from "./emitter-decl"
import { emitExpression } from "./emitter-expr"
import { emitType } from "./emitter-types"
import {
  ArrayResolvedType, ClassType, EnumType, FunctionType, ImportBinding, InterfaceType,
  MapResolvedType, PrimitiveType, ResolvedType, ResultResolvedType, StreamResolvedType,
  Symbol, TupleResolvedType, UnionResolvedType,
} from "./semantic"
import { moduleHeaderName, moduleNamespace } from "./emitter-names"

export class HeaderPlan {
  functionSignatures: string[] = []
  nativeAdapterSignatures: string[] = []
  genericFunctionDefinitions: string[] = []
  exportedValueDefinitions: string[] = []
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
  hasAstHelpers: bool = false
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
    if !imported.typeOnly { continue }
    if hasNonTypeOnlyImport(context.imports, imported.sourceModule) { continue }
    includeName := moduleHeaderName(imported.sourceModule)
    addUnique(plan.typeOnlyModuleIncludes, includeName)
    if imported.symbol != null && (imported.symbol!.kind == "class" || imported.symbol!.kind == "struct") {
      declaration := "namespace " + moduleNamespace(imported.symbol!.module) + " { struct " + imported.symbol!.name + "; }\n"
      addUnique(plan.typeOnlyForwardDeclarations, declaration)
    }
  }
  for namespace of plan.nativeNamespaces {
    if namespace != "" {
      for imported of context.imports {
        if imported.symbol != null {
          if imported.symbol!.kind == "function" {
            target := if imported.symbol!.native_ then imported.symbol!.nativeCppName else moduleNamespace(imported.symbol!.module) + "::" + imported.symbol!.name
            addUnique(plan.nativeAliases, "namespace " + namespace + " { using ::" + target + "; }\n")
          } else {
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
      if imported.symbol != null && isNativeAliasType(imported.symbol!) {
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
      if class_.name == "Block" || class_.name == "IntLiteral" { plan.hasAstHelpers = true }
      if class_.native_ {
        include := if class_.nativeHeader == "" then class_.name + ".hpp" else class_.nativeHeader
        addUnique(plan.nativeIncludes, include)
        namespace := nativeNamespace(class_.nativeCppName)
        addUnique(plan.nativeNamespaces, namespace)
        collectNativeClassAliases(class_, namespace, plan, context)
      } else if class_.typeParams.length == 0 || isNativeTemplateClass(context, class_.name) {
        if class_.typeParams.length == 0 { plan.classForwardDeclarations.push("struct " + class_.name + ";\n") }
        plan.classDefinitions.push(emitClassDeclaration(class_, context))
      }
    }
    interface_: InterfaceDeclaration -> { if interface_.typeParams.length == 0 { plan.interfaceAliases.push(emitInterfaceAlias(interface_, context)) } }
    enum_: EnumDeclaration -> { plan.enumDefinitions.push(emitEnumDeclaration(enum_, context)) }
    // Generic aliases are erased after checker substitution. Concrete uses
    // lower directly to their substituted concrete type.
    alias: TypeAliasDeclaration -> { if alias.typeParams.length == 0 { plan.typeAliases.push(emitTypeAlias(alias, context)) } }
    const_: ConstDeclaration -> { if const_.exported { plan.exportedValueDefinitions.push(emitExportedValue(const_.name, const_.value, context)) } }
    readonly_: ReadonlyDeclaration -> { if readonly_.exported { plan.exportedValueDefinitions.push(emitExportedValue(readonly_.name, readonly_.value, context)) } }
    fn: FunctionDeclaration -> {
      if fn.native_ {
        if fn.nativeHeader != "" { addUnique(plan.nativeIncludes, fn.nativeHeader) }
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
    stream: StreamResolvedType -> { collectNativeTypeAliases(stream.elementType, namespace, plan, context) }
    result: ResultResolvedType -> {
      collectNativeTypeAliases(result.valueType, namespace, plan, context)
      collectNativeTypeAliases(result.errorType, namespace, plan, context)
    }
    tuple: TupleResolvedType -> { for element of tuple.elements { collectNativeTypeAliases(element, namespace, plan, context) } }
    union_: UnionResolvedType -> { for member of union_.types { collectNativeTypeAliases(member, namespace, plan, context) } }
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
  result = result + "#include <memory>\n#include <optional>\n#include <string>\n"
  result = result + "#include <tuple>\n#include <type_traits>\n#include <variant>\n#include <vector>\n"
  for include of plan.moduleIncludes {
    if !containsValue(plan.typeOnlyModuleIncludes, include) { result = result + "#include \"" + include + "\"\n" }
  }
  for declaration of plan.typeOnlyForwardDeclarations { result = result + declaration }
  if plan.typeOnlyForwardDeclarations.length > 0 { result = result + "\n" }
  for alias of plan.nativeAliases { result = result + alias }
  for include of plan.nativeIncludes {
    if include.startsWith("<") { result = result + "#include " + include + "\n" }
    else { result = result + "#include \"" + include + "\"\n" }
  }
  result = result + "\n"
  result = result + "#ifndef DOOF_SELFHOST_COMMON_HELPERS\n#define DOOF_SELFHOST_COMMON_HELPERS\n"
  result = result + "namespace doof {\n"
  result = result + "inline bool ends_with(const std::string& value, const std::string& suffix) { return value.size() >= suffix.size() && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0; }\n"
  result = result + "inline bool starts_with(const std::string& value, const std::string& prefix) { return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0; }\n"
  result = result + "inline std::string substring(const std::string& value, int32_t start, int32_t end) { return value.substr(static_cast<size_t>(start), static_cast<size_t>(end - start)); }\n"
  result = result + "inline std::string substring(const std::string& value, int32_t start) { return value.substr(static_cast<size_t>(start)); }\n"
  result = result + "inline std::string replace_all(std::string value, const std::string& oldValue, const std::string& newValue) { size_t position = 0; while ((position = value.find(oldValue, position)) != std::string::npos) { value.replace(position, oldValue.size(), newValue); position += newValue.size(); } return value; }\n"
  result = result + "inline bool contains(const std::string& value, const std::string& part) { return value.find(part) != std::string::npos; }\n"
  result = result + "inline int32_t length(const std::string& value) { return static_cast<int32_t>(value.size()); }\n"
  result = result + "inline std::string trim(const std::string& value) { const auto start = value.find_first_not_of(\" \\t\\r\\n\"); if (start == std::string::npos) return std::string(); const auto end = value.find_last_not_of(\" \\t\\r\\n\"); return value.substr(start, end - start + 1); }\n"
  result = result + "inline std::string repeat(const std::string& value, int32_t count) { std::string result; for (int32_t i = 0; i < count; ++i) result += value; return result; }\n"
  result = result + "template <typename T> int32_t length(const std::shared_ptr<std::vector<T>>& value) { return static_cast<int32_t>(value->size()); }\n"
  result = result + "template <typename T> auto length(const std::shared_ptr<T>& value) -> decltype(static_cast<int32_t>(value->length)) { return static_cast<int32_t>(value->length); }\n"
  result = result + "template <typename T> bool is_null(const std::shared_ptr<T>& value) { return value == nullptr; }\n"
  result = result + "template <typename T> bool is_null(const std::optional<T>& value) { return !value.has_value(); }\n"
  result = result + "template <typename... T> bool is_null(const std::variant<std::monostate, T...>& value) { return std::holds_alternative<std::monostate>(value); }\n"
  result = result + "template <typename... T> std::string kind(const std::variant<std::shared_ptr<T>...>& value) { return std::visit([](const auto& item) { return item->kind; }, value); }\n"
  result = result + "template <typename... T> std::string kind(const std::variant<std::monostate, std::shared_ptr<T>...>& value) { return std::visit([](const auto& item) { using Item = std::decay_t<decltype(item)>; if constexpr (std::is_same_v<Item, std::monostate>) { return std::string(\"null\"); } else { return item->kind; } }, value); }\n"
  result = result + "template <typename T> auto kind(const std::shared_ptr<T>& value) -> decltype(value->kind) { return value->kind; }\n"
  result = result + "template <typename... T> auto span(const std::variant<std::shared_ptr<T>...>& value) { return std::visit([](const auto& item) { return item->span; }, value); }\n"
  result = result + "template <typename T> auto span(const std::shared_ptr<T>& value) { return value->span; }\n"
  result = result + "template <typename... T> const std::variant<std::monostate, T...>& optional_value(const std::variant<std::monostate, T...>& value) { return value; }\n"
  result = result + "template <typename... T> std::variant<std::monostate, T...> optional_value(const std::variant<T...>& value) { return std::visit([](const auto& item) -> std::variant<std::monostate, T...> { return item; }, value); }\n"
  result = result + "template <typename... T> std::variant<T...> unwrap_optional(const std::variant<std::monostate, T...>& value) { return std::visit([](const auto& item) -> std::variant<T...> { using Item = std::decay_t<decltype(item)>; if constexpr (std::is_same_v<Item, std::monostate>) { throw std::runtime_error(\"unexpected null optional\"); } else { return item; } }, value); }\n"
  result = result + "template <typename T> std::shared_ptr<T> unwrap_optional(const std::shared_ptr<T>& value) { return value; }\n"
  result = result + "template <typename T> T unwrap_optional(const std::optional<T>& value) { return value.value(); }\n"
  result = result + "template <typename T> T pop(const std::shared_ptr<std::vector<T>>& value) { T result = value->back(); value->pop_back(); return result; }\n"
  result = result + "}\n#endif\n\n"
  result = result + "namespace " + guardName + " {\n"
  for declaration of plan.classForwardDeclarations { result = result + "    " + declaration }
  result = result + "}\n\n"
  if plan.hasAstHelpers {
    result = result + "namespace doof {\n"
    result = result + "template <typename... T> std::variant<T..., std::shared_ptr<" + guardName + "::Block>> with_block(const std::variant<T...>& value) { return std::visit([](const auto& item) -> std::variant<T..., std::shared_ptr<" + guardName + "::Block>> { return item; }, value); }\n"
    result = result + "template <typename T> std::variant<" + expressionAlternativesForHeader(guardName) + ", std::shared_ptr<" + guardName + "::Block>> with_block(const std::shared_ptr<T>& value) { return value; }\n"
    result = result + "inline std::variant<" + expressionAlternativesForHeader(guardName) + ", std::shared_ptr<" + guardName + "::Block>> with_block(const std::shared_ptr<" + guardName + "::Block>& value) { return value; }\n"
    result = result + "inline bool is_expression(const std::variant<" + expressionAlternativesForHeader(guardName) + ", std::shared_ptr<" + guardName + "::Block>>& value) { return !std::holds_alternative<std::shared_ptr<" + guardName + "::Block>>(value); }\n"
    result = result + "inline std::variant<" + expressionAlternativesForHeader(guardName) + "> expression_value(const std::variant<" + expressionAlternativesForHeader(guardName) + ", std::shared_ptr<" + guardName + "::Block>>& value) { return std::visit([](const auto& item) -> std::variant<" + expressionAlternativesForHeader(guardName) + "> { using Item = std::decay_t<decltype(item)>; if constexpr (std::is_same_v<Item, std::shared_ptr<" + guardName + "::Block>>) { return std::variant<" + expressionAlternativesForHeader(guardName) + ">{}; } else { return item; } }, value); }\n"
    result = result + "}\n\n"
  }
  result = result + "namespace " + guardName + " {\n"
  for alias of plan.interfaceAliases { result = result + "    " + alias }
  for definition of plan.enumDefinitions { result = result + "    " + definition }
  // Concrete class methods may call module-owned native adapters.
  for signature of plan.nativeAdapterSignatures { result = result + "    " + signature }
  for definition of plan.classDefinitions { result = result + "    " + definition }
  for alias of plan.typeAliases { result = result + "    " + alias }
  for signature of plan.functionSignatures { result = result + "    " + signature }
  result = result + "}\n\n"
  if plan.hasAstHelpers {
    result = result + "namespace doof {\n"
    result = result + "template <typename T> decltype(auto) resolved_type(const std::shared_ptr<T>& value) { return (value->resolvedType); }\n"
    result = result + "inline decltype(auto) resolved_type(const std::variant<" + expressionAlternativesForHeader(guardName) + ">& value) { return std::visit([](const auto& item) -> decltype(auto) { return (item->resolvedType); }, value); }\n"
    result = result + "}\n\n"
  }
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

function expressionAlternativesForHeader(guardName: string): string {
  return "std::shared_ptr<" + guardName + "::IntLiteral>, std::shared_ptr<" + guardName + "::LongLiteral>, std::shared_ptr<" + guardName + "::FloatLiteral>, std::shared_ptr<" + guardName + "::DoubleLiteral>, std::shared_ptr<" + guardName + "::StringLiteral>, std::shared_ptr<" + guardName + "::CharLiteral>, std::shared_ptr<" + guardName + "::BoolLiteral>, std::shared_ptr<" + guardName + "::NullLiteral>, std::shared_ptr<" + guardName + "::Identifier>, std::shared_ptr<" + guardName + "::BinaryExpression>, std::shared_ptr<" + guardName + "::UnaryExpression>, std::shared_ptr<" + guardName + "::AssignmentExpression>, std::shared_ptr<" + guardName + "::MemberExpression>, std::shared_ptr<" + guardName + "::IndexExpression>, std::shared_ptr<" + guardName + "::CallExpression>, std::shared_ptr<" + guardName + "::ArrayLiteral>, std::shared_ptr<" + guardName + "::ObjectLiteral>, std::shared_ptr<" + guardName + "::TupleLiteral>, std::shared_ptr<" + guardName + "::LambdaExpression>, std::shared_ptr<" + guardName + "::IfExpression>, std::shared_ptr<" + guardName + "::CaseExpression>, std::shared_ptr<" + guardName + "::ConstructExpression>, std::shared_ptr<" + guardName + "::DotShorthand>, std::shared_ptr<" + guardName + "::ThisExpression>, std::shared_ptr<" + guardName + "::CallerExpression>"
}

function emitEnumDeclaration(declaration: EnumDeclaration, context: EmitContext): string {
  let result = "enum class " + declaration.name + " {\n"
  for i of 0..<declaration.variants.length {
    variant := declaration.variants[i]
    result = result + "    " + variant.name
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
  return result + "  }\n  return \"\";\n}\n"
}

function emitTypeAlias(alias: TypeAliasDeclaration, context: EmitContext): string {
  if alias.resolvedType == null { panic("Type alias " + alias.name + " was not checked before emission") }
  return "using " + alias.name + " = " + emitType(alias.resolvedType!, context.modulePath) + ";\n"
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
