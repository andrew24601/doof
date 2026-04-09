/**
 * Shared test helpers for emitter test suites.
 *
 * Provides pipeline helpers that run: parse → analyze → type-check → emit.
 */

import { ModuleAnalyzer } from "./analyzer.js";
import {
  emitModuleSplit,
  emitProject,
  type ModuleEmitResult,
  type NativeBuildOptions,
  type ProjectEmitResult,
} from "./emitter-module.js";
import { collectSemanticDiagnostics, throwIfErrorDiagnostics } from "./pipeline-diagnostics.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";

/**
 * Run full pipeline on a single source file and return C++ code.
 */
export function emit(source: string, entry = "/main.do"): string {
  const files: Record<string, string> = { [entry]: source };
  return emitMulti(files, entry);
}

/**
 * Run full pipeline on multiple source files and return C++ code for the entry.
 */
export function emitMulti(
  files: Record<string, string>,
  entry: string,
): string {
  return combineModuleOutput(emitSplitMulti(files, entry));
}

/**
 * Run full pipeline on a single source file and return module split (hpp/cpp).
 */
export function emitSplit(source: string, entry = "/main.do"): ModuleEmitResult {
  const files: Record<string, string> = { [entry]: source };
  return emitSplitMulti(files, entry);
}

/**
 * Run full pipeline on multiple source files and return module split for entry.
 */
export function emitSplitMulti(
  files: Record<string, string>,
  entry: string,
): ModuleEmitResult {
  const fs = new VirtualFS(files);
  const resolver = createBundledModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fs), resolver);
  const result = analyzer.analyzeModule(entry);
  const diagnostics = collectSemanticDiagnostics(result);
  throwIfErrorDiagnostics(diagnostics);

  return emitModuleSplit(entry, result);
}

/**
 * Run full pipeline on multiple source files and return full project output.
 */
export function emitProjectHelper(
  files: Record<string, string>,
  entry: string,
  nativeBuildOptions: Partial<NativeBuildOptions> = {},
): ProjectEmitResult {
  const fs = new VirtualFS(files);
  const resolver = createBundledModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fs), resolver);
  const result = analyzer.analyzeModule(entry);
  const diagnostics = collectSemanticDiagnostics(result);
  throwIfErrorDiagnostics(diagnostics);

  return emitProject(entry, result, nativeBuildOptions);
}

function combineModuleOutput(module: ModuleEmitResult): string {
  return [module.hppCode, module.cppCode].filter((part) => part.length > 0).join("\n");
}
