import type { AnalysisResult } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import type { Diagnostic } from "./types.js";

export function collectSemanticDiagnostics(
  analysisResult: AnalysisResult,
): Diagnostic[] {
  const diagnostics = [...analysisResult.diagnostics];
  const checker = new TypeChecker(analysisResult);

  for (const [modulePath] of analysisResult.modules) {
    diagnostics.push(...checker.checkModule(modulePath).diagnostics);
  }

  return diagnostics;
}

export function hasErrorDiagnostics(
  diagnostics: readonly Diagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function throwIfErrorDiagnostics(
  diagnostics: readonly Diagnostic[],
  stage = "Semantic analysis",
): void {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return;

  const noun = errors.length === 1 ? "error" : "errors";
  const details = errors.map(formatDiagnostic).join("\n");
  throw new Error(`${stage} failed with ${errors.length} ${noun}:\n${details}`);
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.module}:${diagnostic.span.start.line}:${diagnostic.span.start.column}: ${diagnostic.message}`;
}