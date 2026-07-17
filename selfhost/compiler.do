// Self-hosted compiler orchestration.
//
// The compiler deliberately checks every analyzed module before emission.
// Emission consumes decorated ASTs, so allowing an unchecked dependency into
// the project emitter would turn a front-end omission into a C++ failure.

import { AnalysisResult, ModuleInfo, createAnalyzerWithLoader } from "./analyzer"
import { emitModuleGraph, ModuleGraphEmission } from "./emitter-module"
import { buildInstantiationPlan } from "./emitter-monomorphize"
import { emitWasmSupport } from "./emitter-wasm"
import { ModuleNamespaceMapping, configureModuleNamespaces } from "./emitter-names"
import { createChecker, ModuleChecker, validateCheckedTypes } from "./checker"
import { SourceLoader, noSourceLoader } from "./resolver"
import { CheckResult, Diagnostic, SemanticLocation, SemanticSpan, SourceFile } from "./semantic"

export class Compilation {
  emission: ModuleGraphEmission | null
  diagnostics: Diagnostic[]
}

export function compile(sources: SourceFile[], entry: string, coverage: bool = false): Compilation {
  return compileInternal(sources, entry, noSourceLoader, [], "executable", coverage)
}

export function compileWithLoader(
  sources: SourceFile[],
  entry: string,
  loader: SourceLoader,
  namespaceMappings: ModuleNamespaceMapping[] = [],
  entryMode: string = "executable",
  coverage: bool = false,
): Compilation {
  return compileInternal(sources, entry, loader, namespaceMappings, entryMode, coverage)
}

function compileInternal(
  sources: SourceFile[],
  entry: string,
  loader: SourceLoader,
  namespaceMappings: ModuleNamespaceMapping[],
  entryMode: string = "executable",
  coverage: bool = false,
): Compilation {
  configureModuleNamespaces(namespaceMappings)
  analysis := createAnalyzerWithLoader(sources, loader).analyze(entry)
  let diagnostics: Diagnostic[] = []
  for diagnostic of analysis.diagnostics { diagnostics.push(diagnostic) }

  if diagnostics.length == 0 {
    checker := createChecker(analysis)
    let checkedPaths: string[] = []
    let visitingPaths: string[] = []
    for module of analysis.modules {
      checkModuleDependencies(module.path, analysis, checker, checkedPaths, visitingPaths, diagnostics)
    }
  }

  if diagnostics.length > 0 {
    return Compilation { emission: null, diagnostics }
  }
  for diagnostic of validateCheckedTypes(analysis) { diagnostics.push(diagnostic) }
  if diagnostics.length > 0 {
    return Compilation { emission: null, diagnostics }
  }
  instantiations := buildInstantiationPlan(analysis)
  if instantiations.overflow {
    let trace = ""
    for item of instantiations.overflowTrace { trace = trace + (if trace == "" then "" else " -> ") + item }
    zero := SemanticLocation { line: 0, column: 0, offset: 0 }
    diagnostics.push(Diagnostic {
      severity: "error",
      message: "Generic instantiation did not converge after 256 concrete instantiations" + (if trace == "" then "" else ": " + trace),
      span: SemanticSpan { start: zero, end: zero },
      module: entry,
    })
    return Compilation { emission: null, diagnostics }
  }
  emission := emitModuleGraph(analysis, entry, instantiations, entryMode, coverage)
  if entryMode == "wasm" {
    wasm := emitWasmSupport(analysis, entry) else message {
      zero := SemanticLocation { line: 0, column: 0, offset: 0 }
      diagnostics.push(Diagnostic { severity: "error", message, span: SemanticSpan { start: zero, end: zero }, module: entry })
      return Compilation { emission: null, diagnostics }
    }
    emission.wasmSupportSource = wasm.source
    emission.wasmExportNames = wasm.exportNames
  }
  return Compilation { emission, diagnostics }
}

// Analyzer discovery order is driven by import syntax, not by a fixed source
// list.  Check dependencies first so imported class declarations are fully
// decorated before callers construct or inspect them.
function checkModuleDependencies(
  path: string,
  analysis: AnalysisResult,
  checker: ModuleChecker,
  checkedPaths: string[],
  visitingPaths: string[],
  diagnostics: Diagnostic[],
): void {
  if containsPath(checkedPaths, path) || containsPath(visitingPaths, path) { return }
  module := findAnalysisModule(analysis, path)
  if module == null { return }
  visitingPaths.push(path)
  for imported of module!.imports {
    checkModuleDependencies(imported.sourceModule, analysis, checker, checkedPaths, visitingPaths, diagnostics)
  }
  for reExport of module!.reExports {
    checkModuleDependencies(reExport, analysis, checker, checkedPaths, visitingPaths, diagnostics)
  }
  let ignored = try! visitingPaths.pop()
  checked := checker.check(path)
  for diagnostic of checked.diagnostics { diagnostics.push(diagnostic) }
  checkedPaths.push(path)
}

function containsPath(paths: string[], path: string): bool {
  for existing of paths { if existing == path { return true } }
  return false
}

function findAnalysisModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}
