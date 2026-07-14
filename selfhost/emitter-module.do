// Module-level orchestration for the self-hosted C++ emitter.
//
// Include planning stays at this boundary so expression and statement emitters
// remain independent of module layout. Every analyzed module becomes its own
// header/source pair; there is no project-wide emission mode.

import {
  ClassDeclaration, ConstDeclaration, ExportDeclaration, FunctionDeclaration,
  ImmutableBinding, InterfaceDeclaration, LetDeclaration, Program, ReadonlyDeclaration, Statement, TypeAliasDeclaration,
} from "./ast"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import { createEmitContext, createEmitContextForModule, EmitContext, EmitModuleSurface } from "./emitter-context"
import { emitClassDeclaration, emitClassMethodDefinition, emitFunctionDeclaration, emitFunctionDefinition, emitGeneratedJsonMethods, emitNativeFunctionAdapterDefinition, emitStaticClassFieldDefinitions, emitValueDeclaration } from "./emitter-decl"
import { HeaderPlan, planHeader, renderHeader } from "./emitter-header"
import { buildInstantiationPlan, ClassInstantiation, FunctionInstantiation, InstantiationPlan, MethodInstantiation, nativeTemplateClassKey } from "./emitter-monomorphize"
import { moduleHeaderName, moduleNamespace, moduleSourceName } from "./emitter-names"
import {
  ArrayResolvedType, ClassType, FunctionType, ImportBinding, InterfaceType, MapResolvedType, NamespaceBinding,
  ResolvedType, ResultResolvedType, StreamResolvedType, TupleResolvedType, TypeSubstitution, UnionResolvedType,
} from "./semantic"

export class ModulePlan {
  path: string
  namespaceName: string
  headerName: string
  sourceName: string
  includes: string[] = []
}

export class ModuleGraphPlan {
  modules: ModulePlan[] = []
}

// Plan the names and direct header dependencies before split-module emission.
export function planModuleGraph(result: AnalysisResult): ModuleGraphPlan {
  plan := ModuleGraphPlan {}
  for info of result.modules {
    module := ModulePlan {
      path: info.path,
      namespaceName: moduleNamespace(info.path),
      headerName: moduleHeaderName(info.path),
      sourceName: moduleSourceName(info.path),
    }
    for imported of info.imports { addInclude(module, imported.sourceModule) }
    for imported of info.namespaceImports { addInclude(module, imported.sourceModule) }
    for reExport of info.reExports { addInclude(module, reExport) }
    plan.modules.push(module)
  }
  return plan
}

function addInclude(module: ModulePlan, sourceModule: string): void {
  includeName := moduleHeaderName(sourceModule)
  for existing of module.includes { if existing == includeName { return } }
  module.includes.push(includeName)
}

export class ModuleEmission {
  modulePath: string
  header: string
  source: string
  headerName: string
  sourceName: string
}

export class ModuleGraphEmission {
  modules: ModuleEmission[] = []
}

export class CxxModuleEmitter {
  moduleName: string
  headerNameOverride: string = ""
  sourceNameOverride: string = ""
  namespaceNameOverride: string = ""
  modulePath: string = ""
  allPrograms: Program[] = []
  namespaceImports: NamespaceBinding[] = []
  imports: ImportBinding[] = []
  moduleSurfaces: EmitModuleSurface[] = []
  instantiations: InstantiationPlan | null = null

  function emit(program: Program, moduleIncludes: string[] = [], includeMain: bool = true): ModuleEmission {
    context := if modulePath == "" then createEmitContext(program) else createEmitContextForModule(program, modulePath, allPrograms)
    context.namespaceImports = namespaceImports
    context.imports = imports
    context.moduleSurfaces = moduleSurfaces
    if instantiations != null { configureInstantiationRegistry(context, instantiations!) }
    plan := planHeader(program, context)
    if instantiations != null { addConcreteHeaderDeclarations(plan, context, instantiations!) }
    return emitPlanned([program], context, plan, includeMain, moduleIncludes)
  }

  private function emitPlanned(programs: Program[], context: EmitContext, plan: HeaderPlan, includeMain: bool, moduleIncludes: string[] = []): ModuleEmission {
    headerName := if headerNameOverride == "" then moduleName + ".hpp" else headerNameOverride
    sourceName := if sourceNameOverride == "" then moduleName + ".cpp" else sourceNameOverride
    namespaceName := if namespaceNameOverride == "" then moduleName + "_" else namespaceNameOverride
    plan.moduleIncludes = moduleIncludes
    header := renderHeader(plan, namespaceName)
    let source = "#include \"" + headerName + "\"\n#include <cmath>\n"
    for include of moduleIncludes { source = source + "#include \"" + include + "\"\n" }
    if instantiations != null { source = source + concreteImplementationIncludes(context, instantiations!, moduleIncludes) }
    source = source + "\n"
    source = source + "namespace " + namespaceName + " {\n"
    source = source + emitImportedNamespaces(context)
    for program of programs {
      for statement of program.statements {
        source = source + emitSourceStatement(statement, context)
      }
    }
    if instantiations != null { source = source + emitConcreteFunctions(context, instantiations!) }
    source = source + "}\n"
    nativeMethods := emitNativeClassMethods(programs, context)
    if nativeMethods != "" {
      source = source + "\nusing namespace ::" + namespaceName + ";\n\n" + nativeMethods
    }
    if includeMain && plan.hasMain { source = source + emitMainWrapper(namespaceName, plan) }
    return ModuleEmission { modulePath: context.modulePath, header, source, headerName, sourceName }
  }
}

// Interface variants only require forward declarations in headers, which
// keeps cyclic module graphs legal. Translation units that dispatch through a
// variant need each alternative complete for std::visit, so include those
// implementation headers privately in the owning source file.
function concreteImplementationIncludes(context: EmitContext, plan: InstantiationPlan, existingIncludes: string[]): string {
  let includes: string[] = []
  for interface_ of plan.interfaces {
    if interface_.name != "Stream" && interface_.modulePath != context.modulePath { continue }
    for implementation of interface_.implementations {
      if implementation.modulePath == context.modulePath { continue }
      include := moduleHeaderName(implementation.modulePath)
      if !containsString(existingIncludes, include) { addNamespace(includes, include) }
    }
  }
  let result = ""
  for include of includes { result = result + "#include \"" + include + "\"\n" }
  return result
}

function containsString(values: string[], value: string): bool {
  for existing of values { if existing == value { return true } }
  return false
}

function emitImportedNamespaces(context: EmitContext): string {
  let namespaces: string[] = []
  for imported of context.imports {
    namespace := moduleNamespace(imported.sourceModule)
    addNamespace(namespaces, namespace)
  }
  for imported of context.namespaceImports {
    namespace := moduleNamespace(imported.sourceModule)
    addNamespace(namespaces, namespace)
  }
  let result = ""
  for namespace of namespaces { result = result + "using namespace ::" + namespace + ";\n" }
  return result
}

function addNamespace(namespaces: string[], namespace: string): void {
  for existing of namespaces { if existing == namespace { return } }
  namespaces.push(namespace)
}

// Emit one header/source pair for every analyzed module.
export function emitModuleGraph(result: AnalysisResult, entry: string = "", instantiations: InstantiationPlan | null = null): ModuleGraphEmission {
  graph := ModuleGraphEmission {}
  concretePlan := instantiations ?? buildInstantiationPlan(result)
  plan := planModuleGraph(result)
  for module of plan.modules {
    info := findGraphModule(result, module.path)
    if info == null { continue }
    emitter := CxxModuleEmitter {
      moduleName: module.namespaceName,
      headerNameOverride: module.headerName,
      sourceNameOverride: module.sourceName,
      namespaceNameOverride: module.namespaceName,
      modulePath: module.path,
      allPrograms: allPrograms(result),
      namespaceImports: infoNamespaceImports(result, module.path),
      imports: infoImports(result, module.path),
      moduleSurfaces: emitModuleSurfaces(result),
      instantiations: concretePlan,
    }
    graph.modules.push(emitter.emit(info!.program, module.includes, module.path == entry))
  }
  return graph
}

function configureInstantiationRegistry(context: EmitContext, plan: InstantiationPlan): void {
  for key of plan.nativeTemplateClassKeys { context.nativeTemplateClassKeys.push(key) }
  for instantiation of plan.functions {
    context.concreteFunctionKeys.push(instantiation.key)
    context.concreteFunctionNames.push(instantiation.emittedName)
  }
  for instantiation of plan.classes {
    context.concreteClassKeys.push(instantiation.key)
    context.concreteClassNames.push(instantiation.emittedName)
  }
  for instantiation of plan.methods {
    context.concreteMethodKeys.push(instantiation.key)
    context.concreteMethodNames.push(instantiation.emittedName)
  }
  for instantiation of plan.interfaces {
    context.concreteInterfaceKeys.push(instantiation.key)
    context.concreteInterfaceNames.push(instantiation.emittedName)
  }
}

function addConcreteHeaderDeclarations(plan: HeaderPlan, context: EmitContext, instantiations: InstantiationPlan): void {
  for interface_ of instantiations.interfaces {
    if interface_.name != "Stream" && interface_.modulePath != context.modulePath { continue }
    let alternatives = ""
    for implementation of interface_.implementations {
      if alternatives != "" { alternatives = alternatives + ", " }
      let typeName = implementation.typeName
      if implementation.modulePath != context.modulePath {
        namespace := moduleNamespace(implementation.modulePath)
        plan.typeOnlyForwardDeclarations.push("namespace " + namespace + " { struct " + implementation.typeName + "; }\n")
        typeName = "::" + namespace + "::" + typeName
      }
      alternatives = alternatives + "std::shared_ptr<" + typeName + ">"
    }
    if alternatives == "" { alternatives = "std::monostate" }
    plan.interfaceAliases.push("using " + interface_.emittedName + " = std::variant<" + alternatives + ">;\n")
  }
  for instantiation of instantiations.classes {
    if instantiation.modulePath != context.modulePath { continue }
    for argument of instantiation.substitution.arguments { addConcreteTypeForwardDeclarations(plan, context, argument) }
    plan.classForwardDeclarations.push("struct " + instantiation.emittedName + ";\n")
    context.substitution = instantiation.substitution
    let methods: MethodInstantiation[] = []
    for method of instantiations.methods { if method.ownerKey == instantiation.key { methods.push(method) } }
    plan.classDefinitions.push(emitClassDeclaration(instantiation.declaration, context, instantiation.emittedName, methods))
    clearInstantiation(context)
  }
  for instantiation of instantiations.functions {
    if instantiation.modulePath != context.modulePath { continue }
    for argument of instantiation.substitution.arguments { addConcreteTypeForwardDeclarations(plan, context, argument) }
    context.substitution = instantiation.substitution
    signature := emitFunctionDeclaration(instantiation.declaration, instantiation.emittedName, context.modulePath, context)
    if instantiation.declaration.native_ { plan.nativeAdapterSignatures.push(signature) }
    else { plan.functionSignatures.push(signature) }
    clearInstantiation(context)
  }
}

function addConcreteTypeForwardDeclarations(plan: HeaderPlan, context: EmitContext, type_: ResolvedType): void {
  case type_ {
    class_: ClassType -> {
      if class_.symbol.module != "" && class_.symbol.module != context.modulePath {
        declaration := "namespace " + moduleNamespace(class_.symbol.module) + " { struct " + class_.name + "; }\n"
        if !containsString(plan.typeOnlyForwardDeclarations, declaration) { plan.typeOnlyForwardDeclarations.push(declaration) }
      }
      for argument of class_.typeArgs { addConcreteTypeForwardDeclarations(plan, context, argument) }
    }
    interface_: InterfaceType -> { for argument of interface_.typeArgs { addConcreteTypeForwardDeclarations(plan, context, argument) } }
    array: ArrayResolvedType -> { addConcreteTypeForwardDeclarations(plan, context, array.elementType) }
    map: MapResolvedType -> { addConcreteTypeForwardDeclarations(plan, context, map.keyType); addConcreteTypeForwardDeclarations(plan, context, map.valueType) }
    stream: StreamResolvedType -> { addConcreteTypeForwardDeclarations(plan, context, stream.elementType) }
    result_: ResultResolvedType -> { addConcreteTypeForwardDeclarations(plan, context, result_.valueType); addConcreteTypeForwardDeclarations(plan, context, result_.errorType) }
    tuple: TupleResolvedType -> { for element of tuple.elements { addConcreteTypeForwardDeclarations(plan, context, element) } }
    union_: UnionResolvedType -> { for member of union_.types { addConcreteTypeForwardDeclarations(plan, context, member) } }
    function_: FunctionType -> {
      for parameter of function_.params { addConcreteTypeForwardDeclarations(plan, context, parameter.type_) }
      addConcreteTypeForwardDeclarations(plan, context, function_.returnType)
    }
    _ -> { }
  }
}

function emitConcreteFunctions(context: EmitContext, instantiations: InstantiationPlan): string {
  let result = ""
  for instantiation of instantiations.functions {
    if instantiation.modulePath != context.modulePath { continue }
    context.substitution = instantiation.substitution
    if instantiation.declaration.native_ { result = result + emitNativeFunctionAdapterDefinition(instantiation.declaration, instantiation.emittedName, context) }
    else { result = result + emitFunctionDefinition(instantiation.declaration, context, instantiation.emittedName) }
    clearInstantiation(context)
  }
  return result
}

function withInstantiation(context: EmitContext, names: string[], arguments: ResolvedType[]): void {
  context.substitution = TypeSubstitution { names, arguments }
}

function clearInstantiation(context: EmitContext): void {
  context.substitution = null
}

function emitModuleSurfaces(result: AnalysisResult): EmitModuleSurface[] {
  let surfaces: EmitModuleSurface[] = []
  for module of result.modules {
    let genericTypes: string[] = []
    for statement of module.program.statements { collectGenericSurfaceTypes(statement, genericTypes) }
    surfaces.push(EmitModuleSurface { path: module.path, exports: module.exports, imports: module.imports, genericTypes })
  }
  return surfaces
}

function collectGenericSurfaceTypes(statement: Statement, names: string[]): void {
  case statement {
    class_: ClassDeclaration -> { if class_.typeParams.length > 0 { names.push(class_.name) } }
    interface_: InterfaceDeclaration -> { if interface_.typeParams.length > 0 { names.push(interface_.name) } }
    alias: TypeAliasDeclaration -> { if alias.typeParams.length > 0 { names.push(alias.name) } }
    export_: ExportDeclaration -> { collectGenericSurfaceTypes(export_.declaration, names) }
    _ -> { }
  }
}

function allPrograms(result: AnalysisResult): Program[] {
  let programs: Program[] = []
  for module of result.modules { programs.push(module.program) }
  return programs
}

function infoNamespaceImports(result: AnalysisResult, path: string): NamespaceBinding[] {
  for module of result.modules { if module.path == path { return module.namespaceImports } }
  return []
}

function infoImports(result: AnalysisResult, path: string): ImportBinding[] {
  for module of result.modules { if module.path == path { return module.imports } }
  return []
}

function findGraphModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

export function emitModule(program: Program, moduleName: string = "main"): ModuleEmission {
  let emptyIncludes: string[] = []
  return CxxModuleEmitter { moduleName }.emit(program, emptyIncludes, true)
}

function emitSourceStatement(statement: Statement, context: EmitContext): string {
  case statement {
    fn: FunctionDeclaration -> {
      if fn.typeParams.length > 0 { return "" }
      return emitFunctionDefinition(fn, context, if fn.name == "main" then "doof_main" else fn.name)
    }
    class_: ClassDeclaration -> {
      if class_.native_ { return "" }
      let result = "\n" + emitStaticClassFieldDefinitions(class_, context)
      if class_.typeParams.length == 0 {
        for method of class_.methods { result = result + emitClassMethodDefinition(class_, method, context) }
      }
      result = result + emitGeneratedJsonMethods(class_, context)
      return result
    }
    const_: ConstDeclaration -> { return if const_.exported then "" else emitValueDeclaration(const_, context) }
    readonly_: ReadonlyDeclaration -> { return if readonly_.exported then "" else emitValueDeclaration(readonly_, context) }
    binding: ImmutableBinding -> { return emitValueDeclaration(binding, context) }
    let_: LetDeclaration -> { return emitValueDeclaration(let_, context) }
    export_: ExportDeclaration -> { return emitSourceStatement(export_.declaration, context) }
    _ -> { return "" }
  }
  return ""
}

function emitNativeClassMethods(programs: Program[], context: EmitContext): string {
  let result = ""
  for program of programs {
    for statement of program.statements {
      result = result + emitNativeClassMethodsForStatement(statement, context)
    }
  }
  return result
}

function emitNativeClassMethodsForStatement(statement: Statement, context: EmitContext): string {
  case statement {
    class_: ClassDeclaration -> {
      if !class_.native_ { return "" }
      let result = ""
      for method of class_.methods {
        if !method.bodyless { result = result + emitClassMethodDefinition(class_, method, context) }
      }
      return result
    }
    export_: ExportDeclaration -> { return emitNativeClassMethodsForStatement(export_.declaration, context) }
    _ -> { return "" }
  }
  return ""
}

function emitMainWrapper(moduleName: string, plan: HeaderPlan): string {
  if plan.mainAcceptsArgs {
    if plan.mainReturnsInt {
      return "\nint main(int argc, char** argv) { std::vector<std::string> args; for (int i = 1; i < argc; ++i) args.emplace_back(argv[i]); return " + moduleName + "::doof_main(std::make_shared<std::vector<std::string>>(std::move(args))); }\n"
    }
    return "\nint main(int argc, char** argv) { std::vector<std::string> args; for (int i = 1; i < argc; ++i) args.emplace_back(argv[i]); " + moduleName + "::doof_main(std::make_shared<std::vector<std::string>>(std::move(args))); return 0; }\n"
  }
  if plan.mainReturnsInt { return "\nint main() { return " + moduleName + "::doof_main(); }\n" }
  return "\nint main() { " + moduleName + "::doof_main(); return 0; }\n"
}
