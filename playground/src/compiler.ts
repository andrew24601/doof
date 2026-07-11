import {
  compileDoof as compile,
  type CompileResult,
  type PlaygroundCompileOptions,
  type PlaygroundDiagnostic,
} from "../../src/playground-compiler.js";
import { PLAYGROUND_STDLIB_FILES } from "./stdlib-files";

export type { CompileResult, PlaygroundCompileOptions, PlaygroundDiagnostic };

export function compileDoof(source: string): CompileResult {
  return compile(source, { stdlibFiles: PLAYGROUND_STDLIB_FILES });
}
