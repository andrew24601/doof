// Self-hosted compiler orchestration.
//
// The compiler deliberately checks every analyzed module before emission.
// Emission consumes decorated ASTs, so allowing an unchecked dependency into
// the project emitter would turn a front-end omission into a C++ failure.

import { AnalysisResult, ModuleInfo, createAnalyzerWithLoader } from "./analyzer"
import { emitModuleGraph, ModuleGraphEmission } from "./emitter-module"
import { createChecker, ModuleChecker, validateCheckedTypes } from "./checker"
import { SourceLoader } from "./resolver"
import { CheckResult, Diagnostic, SourceFile } from "./semantic"

export class Compilation {
  emission: ModuleGraphEmission | null
  diagnostics: Diagnostic[]
}

function compilerNoSourceLoader(path: string): SourceFile | null => null

export function compile(sources: SourceFile[], entry: string): Compilation {
  return compileInternal(sources, entry, compilerNoSourceLoader)
}

export function compileWithLoader(sources: SourceFile[], entry: string, loader: SourceLoader): Compilation {
  return compileInternal(sources, entry, loader)
}

function compileInternal(sources: SourceFile[], entry: string, loader: SourceLoader): Compilation {
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
  return Compilation { emission: emitModuleGraph(analysis, entry), diagnostics }
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
  let ignored = visitingPaths.pop()
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
