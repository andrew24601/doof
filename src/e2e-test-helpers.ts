/**
 * End-to-end test helpers: compile and run generated C++ programs.
 *
 * Provides an E2EContext class that manages temp directories, C++ compiler
 * detection, and compile/run workflows for end-to-end Doof tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import { buildAnyRuntimePlan } from "./any-runtime.js";
import { buildCompileArgs, findNlohmannInclude, tryFindCompiler } from "./cli-core.js";
import { emitCpp } from "./emitter.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import { emitProject, type NativeBuildOptions } from "./emitter-module.js";
import { findDoofManifestPath, loadPackageGraph } from "./package-manifest.js";
import { collectSemanticDiagnostics, throwIfErrorDiagnostics } from "./pipeline-diagnostics.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";

// ============================================================================
// Types
// ============================================================================

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function createNativeBuildOptions(
  options: Partial<NativeBuildOptions> = {},
): NativeBuildOptions {
  return {
    cppStd: options.cppStd ?? "c++17",
    includePaths: options.includePaths ?? [],
    libraryPaths: options.libraryPaths ?? [],
    linkLibraries: options.linkLibraries ?? [],
    frameworks: options.frameworks ?? [],
    sourceFiles: options.sourceFiles ?? [],
    objectFiles: options.objectFiles ?? [],
    compilerFlags: options.compilerFlags ?? [],
    linkerFlags: options.linkerFlags ?? [],
    defines: options.defines ?? [],
  };
}

// ============================================================================
// Standalone helpers (no state needed)
// ============================================================================

export function hasNativeToolchain(): boolean {
  return tryFindCompiler() !== null;
}

/** Run the full Doof pipeline and return the generated C++ string. */
export function emitToString(source: string, entry = "/main.do"): string {
  return emitArtifacts(source, entry).code;
}

function emitArtifacts(source: string, entry = "/main.do"): { code: string; runtime: string } {
  const vfs = new VirtualFS({ [entry]: source });
  const resolver = createBundledModuleResolver(vfs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(vfs), resolver);
  const result = analyzer.analyzeModule(entry);
  const diagnostics = collectSemanticDiagnostics(result);
  throwIfErrorDiagnostics(diagnostics);
  return {
    code: emitCpp(entry, result),
    runtime: generateRuntimeHeader(buildAnyRuntimePlan(result)),
  };
}

// ============================================================================
// E2EContext — manages temp dir and provides compile/run helpers
// ============================================================================

/**
 * Manages a temporary directory and C++ compiler for end-to-end tests.
 * Call `setup()` in `beforeAll` and `cleanup()` in `afterAll`.
 */
export class E2EContext {
  tmpDir = "";
  cppCompiler = "";
  nlohmannInclude = "";

  setup(): void {
    const compiler = tryFindCompiler();
    if (!compiler) {
      console.warn("No C++ compiler found — skipping end-to-end tests");
    }
    this.cppCompiler = compiler ?? "";
    const includeDir = findNlohmannInclude();
    this.nlohmannInclude = includeDir ? `-I${includeDir}` : "";
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-e2e-"));
  }

  cleanup(): void {
    if (this.tmpDir) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Compile and run a Doof source program. Returns the program's output.
   */
  compileAndRun(doofSource: string): RunResult {
    if (!this.cppCompiler) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: "No C++ compiler found. Install clang++, g++, or set CXX.",
      };
    }

    let cppCode: string;
    let runtimeCode: string;
    try {
      const artifacts = emitArtifacts(doofSource);
      cppCode = artifacts.code;
      runtimeCode = artifacts.runtime;
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      };
    }

    const cppFile = path.join(this.tmpDir, "main.cpp");
    const runtimeFile = path.join(this.tmpDir, "doof_runtime.hpp");
    const outFile = path.join(this.tmpDir, "a.out");

    fs.writeFileSync(cppFile, cppCode);
    fs.writeFileSync(runtimeFile, runtimeCode);

    // Compile
    try {
      const compileArgs = [
        "-std=c++17",
        "-o",
        outFile,
        cppFile,
        `-I${this.tmpDir}`,
        ...(this.nlohmannInclude ? [this.nlohmannInclude] : []),
      ];
      execFileSync(this.cppCompiler, compileArgs, { stdio: "pipe", cwd: this.tmpDir, timeout: 15000 });
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: `Compilation failed:\n${e.stderr?.toString() ?? e.message}\n\nGenerated C++:\n${cppCode}`,
      };
    }

    // Run
    try {
      const stdout = execFileSync(outFile, [], {
        stdio: "pipe",
        timeout: 5000,
      }).toString();
      return { exitCode: 0, stdout, stderr: "" };
    } catch (e: any) {
      return {
        exitCode: e.status ?? 1,
        stdout: e.stdout?.toString() ?? "",
        stderr: e.stderr?.toString() ?? "",
      };
    }
  }

  /**
   * Just compile (syntax check) without running. Returns true if compilation succeeds.
   */
  compileOnly(doofSource: string): { success: boolean; error: string; code: string } {
    if (!this.cppCompiler) {
      return {
        success: false,
        error: "No C++ compiler found. Install clang++, g++, or set CXX.",
        code: "",
      };
    }

    let cppCode: string;
    let runtimeCode: string;
    try {
      const artifacts = emitArtifacts(doofSource);
      cppCode = artifacts.code;
      runtimeCode = artifacts.runtime;
    } catch (e: any) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        code: "",
      };
    }

    const cppFile = path.join(this.tmpDir, "check.cpp");
    const runtimeFile = path.join(this.tmpDir, "doof_runtime.hpp");

    fs.writeFileSync(cppFile, cppCode);
    fs.writeFileSync(runtimeFile, runtimeCode);

    try {
      const compileArgs = [
        "-std=c++17",
        "-fsyntax-only",
        cppFile,
        `-I${this.tmpDir}`,
        ...(this.nlohmannInclude ? [this.nlohmannInclude] : []),
      ];
      execFileSync(this.cppCompiler, compileArgs, { stdio: "pipe", cwd: this.tmpDir, timeout: 15000 });
      return { success: true, error: "", code: cppCode };
    } catch (e: any) {
      return {
        success: false,
        error: e.stderr?.toString() ?? e.message,
        code: cppCode,
      };
    }
  }

  /**
   * Compile and run a multi-module project using the .hpp/.cpp split emitter.
   */
  compileAndRunProject(
    files: Record<string, string>,
    entry: string,
    nativeBuildOptions: Partial<NativeBuildOptions> = {},
  ): RunResult {
    if (!this.cppCompiler) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: "No C++ compiler found. Install clang++, g++, or set CXX.",
      };
    }

    const vfs = new VirtualFS(files);
    const resolver = createResolverForEntry(vfs, entry);
    const analyzer = new ModuleAnalyzer(withBundledStdlib(vfs), resolver);
    const result = analyzer.analyzeModule(entry);

    const nativeBuild = createNativeBuildOptions(nativeBuildOptions);
    let project;
    try {
      const diagnostics = collectSemanticDiagnostics(result);
      throwIfErrorDiagnostics(diagnostics);
      project = emitProject(entry, result, nativeBuild);
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      };
    }

    // Write runtime header
    fs.writeFileSync(path.join(this.tmpDir, "doof_runtime.hpp"), project.runtime);

    // Write all module .hpp and .cpp files
    const cppFiles: string[] = [];
    for (const mod of project.modules) {
      const hppFile = path.join(this.tmpDir, mod.hppPath);
      const cppFile = path.join(this.tmpDir, mod.cppPath);
      fs.mkdirSync(path.dirname(hppFile), { recursive: true });
      fs.mkdirSync(path.dirname(cppFile), { recursive: true });
      fs.writeFileSync(hppFile, mod.hppCode);
      fs.writeFileSync(cppFile, mod.cppCode);
      cppFiles.push(cppFile);
    }

    const { outBinary, args } = buildCompileArgs(this.tmpDir, project, nativeBuild);

    try {
      const allArgs = this.nlohmannInclude ? [...args, this.nlohmannInclude] : args;
      execFileSync(this.cppCompiler, allArgs, { stdio: "pipe", cwd: this.tmpDir, timeout: 15000 });
    } catch (e: any) {
      const allCode = project.modules.map(m =>
        `--- ${m.hppPath} ---\n${m.hppCode}\n--- ${m.cppPath} ---\n${m.cppCode}`
      ).join("\n\n");
      return {
        exitCode: -1,
        stdout: "",
        stderr: `Compilation failed:\n${e.stderr?.toString() ?? e.message}\n\nGenerated C++:\n${allCode}`,
      };
    }

    // Run
    try {
      const stdout = execFileSync(outBinary, [], {
        stdio: "pipe",
        timeout: 5000,
      }).toString();
      return { exitCode: 0, stdout, stderr: "" };
    } catch (e: any) {
      return {
        exitCode: e.status ?? 1,
        stdout: e.stdout?.toString() ?? "",
        stderr: e.stderr?.toString() ?? "",
      };
    }
  }

  /**
   * Just compile a multi-module project (syntax check).
   */
  compileOnlyProject(
    files: Record<string, string>,
    entry: string,
    nativeBuildOptions: Partial<NativeBuildOptions> = {},
  ): { success: boolean; error: string; codes: string } {
    if (!this.cppCompiler) {
      return {
        success: false,
        error: "No C++ compiler found. Install clang++, g++, or set CXX.",
        codes: "",
      };
    }

    const vfs = new VirtualFS(files);
    const resolver = createResolverForEntry(vfs, entry);
    const analyzer = new ModuleAnalyzer(withBundledStdlib(vfs), resolver);
    const result = analyzer.analyzeModule(entry);

    const nativeBuild = createNativeBuildOptions(nativeBuildOptions);
    let project;
    try {
      const diagnostics = collectSemanticDiagnostics(result);
      throwIfErrorDiagnostics(diagnostics);
      project = emitProject(entry, result, nativeBuild);
    } catch (e: any) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        codes: "",
      };
    }

    // Write runtime header
    fs.writeFileSync(path.join(this.tmpDir, "doof_runtime.hpp"), project.runtime);

    // Write all module files
    const cppFiles: string[] = [];
    for (const mod of project.modules) {
      const hppFile = path.join(this.tmpDir, mod.hppPath);
      const cppFile = path.join(this.tmpDir, mod.cppPath);
      fs.mkdirSync(path.dirname(hppFile), { recursive: true });
      fs.mkdirSync(path.dirname(cppFile), { recursive: true });
      fs.writeFileSync(hppFile, mod.hppCode);
      fs.writeFileSync(cppFile, mod.cppCode);
      cppFiles.push(cppFile);
    }

    const allCode = project.modules.map(m =>
      `--- ${m.hppPath} ---\n${m.hppCode}\n--- ${m.cppPath} ---\n${m.cppCode}`
    ).join("\n\n");

    try {
      const { args } = buildCompileArgs(this.tmpDir, project, nativeBuild);
      const syntaxArgs = [
        ...args.filter((arg) => arg !== "-o" && arg !== path.join(this.tmpDir, "a.out")),
        "-fsyntax-only",
      ];
      const allArgs = this.nlohmannInclude ? [...syntaxArgs, this.nlohmannInclude] : syntaxArgs;
      execFileSync(this.cppCompiler, allArgs, { stdio: "pipe", cwd: this.tmpDir, timeout: 15000 });
      return { success: true, error: "", codes: allCode };
    } catch (e: any) {
      return {
        success: false,
        error: e.stderr?.toString() ?? e.message,
        codes: allCode,
      };
    }
  }
}

function createResolverForEntry(vfs: VirtualFS, entry: string) {
  const manifestPath = findDoofManifestPath(vfs, entry);
  if (!manifestPath) {
    return createBundledModuleResolver(vfs);
  }

  const graph = loadPackageGraph(vfs, entry);
  return createBundledModuleResolver(vfs, {
    packages: graph.packages.map((pkg) => ({
      rootDir: pkg.rootDir,
      dependencies: pkg.dependencyRoots,
    })),
  });
}
