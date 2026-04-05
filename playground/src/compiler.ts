/**
 * Browser-compatible wrapper around the Doof compiler pipeline.
 *
 * Provides a single `compileDoof(source)` function that runs the full
 * parse → analyze → typecheck → emit pipeline on a single source string,
 * returning the generated C++ code and all diagnostics.
 */
import { parseWithDiagnostics, ParseError } from "@doof/parser.js";
import type { SourceSpan } from "@doof/ast.js";
import type { Diagnostic } from "@doof/types.js";
import type { FileSystem } from "@doof/resolver.js";
import { ModuleAnalyzer } from "@doof/analyzer.js";
import { emitCpp } from "@doof/emitter.js";
import { collectSemanticDiagnostics } from "@doof/pipeline-diagnostics.js";

const MODULE_PATH = "/main.do";

/** Unified diagnostic for display — matches the project Diagnostic shape. */
export interface PlaygroundDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  /** 0-based line & column */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CompileResult {
  cpp: string;
  diagnostics: PlaygroundDiagnostic[];
}

/** Convert a project Diagnostic (with SourceSpan) to PlaygroundDiagnostic.
 *  Compiler spans are 1-based; PlaygroundDiagnostic uses 0-based. */
function fromDiagnostic(d: Diagnostic): PlaygroundDiagnostic {
  return {
    severity: d.severity,
    message: d.message,
    startLine: d.span.start.line - 1,
    startColumn: d.span.start.column - 1,
    endLine: d.span.end.line - 1,
    endColumn: d.span.end.column - 1,
  };
}

/**
 * Compile a Doof source string to C++.
 *
 * Runs the full pipeline: parse → module analysis → type check → emit.
 * Collects all diagnostics from every phase. On error, returns diagnostics
 * with whatever partial output is possible (empty string if parse fails).
 */
export function compileDoof(source: string): CompileResult {
  const diagnostics: PlaygroundDiagnostic[] = [];

  // ---- Phase 0: Parse ----

  let program;
  let lexerDiagnostics;
  try {
    const parsed = parseWithDiagnostics(source);
    program = parsed.program;
    lexerDiagnostics = parsed.lexerDiagnostics;
  } catch (e) {
    if (e instanceof ParseError) {
      diagnostics.push({
        severity: "error",
        message: e.message,
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
      });
    } else {
      diagnostics.push({
        severity: "error",
        message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
      });
    }
    return { cpp: "", diagnostics };
  }

  // Convert lexer diagnostics (1-based line/col → 0-based)
  for (const ld of lexerDiagnostics) {
    diagnostics.push({
      severity: ld.severity,
      message: ld.message,
      startLine: ld.line - 1,
      startColumn: ld.column - 1,
      endLine: ld.line - 1,
      endColumn: ld.column,
    });
  }

  // ---- Phase 1: Module analysis ----

  // Virtual filesystem with just one file
  const vfs: FileSystem = {
    readFile(path: string) {
      return path === MODULE_PATH ? source : null;
    },
    fileExists(path: string) {
      return path === MODULE_PATH;
    },
  };

  const analyzer = new ModuleAnalyzer(vfs);
  const analysisResult = analyzer.analyzeModule(MODULE_PATH);

  // ---- Phase 1-2: Analysis + type checking ----

  const semanticDiagnostics = collectSemanticDiagnostics(analysisResult);

  for (const d of semanticDiagnostics) {
    diagnostics.push(fromDiagnostic(d));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { cpp: "", diagnostics };
  }

  // ---- Phase 3: Emit C++ ----

  let cpp = "";
  try {
    cpp = emitCpp(MODULE_PATH, analysisResult);
  } catch (e) {
    diagnostics.push({
      severity: "error",
      message: `Emit error: ${e instanceof Error ? e.message : String(e)}`,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    });
  }

  return { cpp, diagnostics };
}
