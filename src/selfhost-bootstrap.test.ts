import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import { emitProject } from "./emitter-module.js";
import { collectSemanticDiagnostics, throwIfErrorDiagnostics } from "./pipeline-diagnostics.js";
import { RealFS, resolveCompilerToolchain, tryFindCompilerToolchain } from "./cli-core.js";

const SELFHOST_MODULES = [
  "lexer.do", "ast.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "semantic.do", "resolver.do", "analyzer.do",
  "checker-types.do", "checker.do", "emitter-context.do", "emitter-monomorphize.do", "emitter-types.do",
  "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do",
  "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr-lambda.do",
  "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
  "emitter-names.do", "emitter-module.do", "compiler.do",
];

describe("self-host bootstrap artifacts", () => {
  it("emits C++ translation units for the selfhost source graph", () => {
    const compiler = tryFindCompilerToolchain();
    if (!compiler) return;

    const entry = path.resolve("selfhost/compiler.do");
    const analysis = new ModuleAnalyzer(new RealFS()).analyzeModule(entry);
    throwIfErrorDiagnostics(collectSemanticDiagnostics(analysis));
    const project = emitProject(entry, analysis);
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "doof-selfhost-"));

    try {
      fs.writeFileSync(path.join(output, "doof_runtime.hpp"), project.runtime);
      for (const module of project.modules) {
        const headerPath = path.join(output, module.hppPath);
        const sourcePath = path.join(output, module.cppPath);
        fs.mkdirSync(path.dirname(headerPath), { recursive: true });
        fs.writeFileSync(headerPath, module.hppCode);
        fs.writeFileSync(sourcePath, module.cppCode);
      }

      const sources = project.modules.map((module) => path.join(output, module.cppPath));
      execFileSync(compiler.command, ["-std=c++17", "-fsyntax-only", "-I", output, ...sources], {
        cwd: output,
        env: compiler.env ?? process.env,
        stdio: "pipe",
      });
      expect(project.modules.map((module) => path.basename(module.modulePath)).sort())
        .toEqual([...SELFHOST_MODULES].sort());
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  }, 120_000);
});
