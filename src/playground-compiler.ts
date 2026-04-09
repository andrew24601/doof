import { parseWithDiagnostics, ParseError } from "./parser.js";
import type { Diagnostic } from "./types.js";
import type { FileSystem } from "./resolver.js";
import { ModuleAnalyzer } from "./analyzer.js";
import { emitModuleSplit } from "./emitter-module.js";
import { collectSemanticDiagnostics } from "./pipeline-diagnostics.js";

const MODULE_PATH = "/main.do";

export interface PlaygroundDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CompileResult {
  cpp: string;
  diagnostics: PlaygroundDiagnostic[];
}

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

export function compileDoof(source: string): CompileResult {
  const diagnostics: PlaygroundDiagnostic[] = [];

  let lexerDiagnostics;
  try {
    const parsed = parseWithDiagnostics(source);
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
  const semanticDiagnostics = collectSemanticDiagnostics(analysisResult);
  for (const d of semanticDiagnostics) {
    diagnostics.push(fromDiagnostic(d));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { cpp: "", diagnostics };
  }

  let cpp = "";
  try {
    cpp = emitModuleSplit(MODULE_PATH, analysisResult).cppCode;
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