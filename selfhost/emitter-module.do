// Module-level orchestration for the self-hosted C++ emitter.
//
// Include planning stays at this boundary so expression and statement emitters
// remain independent of module layout. Every analyzed module becomes its own
// header/source pair; there is no project-wide emission mode.

import {
  ClassDeclaration, ConstDeclaration, ExportDeclaration, FunctionDeclaration,
  ImmutableBinding, LetDeclaration, Program, ReadonlyDeclaration, Statement,
} from "./ast"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import { createEmitContext, createEmitContextForModule, EmitContext } from "./emitter-context"
import { emitClassMethodDefinition, emitFunctionDefinition, emitGeneratedJsonMethods, emitStaticClassFieldDefinitions, emitValueDeclaration } from "./emitter-decl"
import { HeaderPlan, planHeader, renderHeader } from "./emitter-header"
import { moduleHeaderName, moduleNamespace, moduleSourceName } from "./emitter-names"
import { ImportBinding, NamespaceBinding } from "./semantic"

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

  function emit(program: Program, moduleIncludes: string[] = [], includeMain: bool = true): ModuleEmission {
    context := if modulePath == "" then createEmitContext(program) else createEmitContextForModule(program, modulePath, allPrograms)
    context.namespaceImports = namespaceImports
    context.imports = imports
    plan := planHeader(program, context)
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
    source = source + "\n"
    source = source + "namespace " + namespaceName + " {\n"
    source = source + emitImportedNamespaces(context)
    for program of programs {
      for statement of program.statements {
        source = source + emitSourceStatement(statement, context)
      }
    }
    source = source + "}\n"
    nativeMethods := emitNativeClassMethods(programs, context)
    if nativeMethods != "" {
      source = source + "\nusing namespace ::" + namespaceName + ";\n\n" + nativeMethods
    }
    if includeMain && plan.hasMain { source = source + emitMainWrapper(namespaceName, plan) }
    return ModuleEmission { modulePath: context.modulePath, header, source, headerName, sourceName }
  }
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
export function emitModuleGraph(result: AnalysisResult, entry: string = ""): ModuleGraphEmission {
  graph := ModuleGraphEmission {}
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
    }
    graph.modules.push(emitter.emit(info!.program, module.includes, module.path == entry))
  }
  return graph
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
    const_: ConstDeclaration -> { return emitValueDeclaration(const_, context) }
    readonly_: ReadonlyDeclaration -> { return emitValueDeclaration(readonly_, context) }
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
