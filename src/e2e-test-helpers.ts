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
import {
  buildCompilePlan,
  type CompilerToolchain,
  resolveCompilerToolchain,
  RealFS,
  runPipelineWithFs,
  writeProject,
  tryFindCompilerToolchain,
} from "./cli-core.js";
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
    pkgConfigPackages: options.pkgConfigPackages ?? [],
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
  return tryFindCompilerToolchain() !== null;
}

/** Run the full Doof pipeline and return the generated C++ string. */
export function emitToString(source: string, entry = "/main.do"): string {
  return emitArtifacts(source, entry).code;
}

function emitArtifacts(source: string, entry = "/main.do"): { code: string; project: ReturnType<typeof emitProject> } {
  const vfs = new VirtualFS({ [entry]: source });
  const resolver = createBundledModuleResolver(vfs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(vfs), resolver);
  const result = analyzer.analyzeModule(entry);
  const diagnostics = collectSemanticDiagnostics(result);
  throwIfErrorDiagnostics(diagnostics);
  const project = emitProject(entry, result);
  const entryModule = project.modules.find((module) => module.modulePath === entry);
  if (!entryModule) {
    throw new Error(`Entry module was not emitted: ${entry}`);
  }
  return {
    code: [entryModule.hppCode, entryModule.cppCode].filter((part) => part.length > 0).join("\n"),
    project,
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
  cppToolchain: CompilerToolchain | null = null;

  setup(): void {
    let compiler: CompilerToolchain | null = null;
    try {
      compiler = resolveCompilerToolchain(null);
    } catch {
      compiler = null;
    }
    if (!compiler) {
      console.warn("No C++ compiler found — skipping end-to-end tests");
    }
    this.cppToolchain = compiler;
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
    if (!this.cppToolchain) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: missingCompilerMessage(),
      };
    }

    let cppCode: string;
    let project: ReturnType<typeof emitProject>;
    try {
      const artifacts = emitArtifacts(doofSource);
      cppCode = artifacts.code;
      project = artifacts.project;
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      };
    }

    writeProjectArtifacts(this.tmpDir, project);

    // Compile
    let outBinary = "";
    try {
      const nativeBuild = createNativeBuildOptions();
      const compilePlan = buildCompilePlan(this.tmpDir, project, nativeBuild, {
        extraIncludePaths: getExtraIncludePaths(nativeBuild, [project.runtime, ...project.modules.map((mod) => mod.hppCode), ...project.modules.map((mod) => mod.cppCode)]),
        toolchain: this.cppToolchain,
      });
      outBinary = compilePlan.outBinary;
      for (const command of compilePlan.commands) {
        execFileSync(command.command, command.args, {
          stdio: "pipe",
          cwd: this.tmpDir,
          timeout: 15000,
          env: this.cppToolchain.env ?? process.env,
        });
      }
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: `${formatCompilationFailure(e)}\n\nGenerated C++:\n${cppCode}`,
      };
    }

    try {
      const stdout = execFileSync(outBinary, [], {
        stdio: "pipe",
        timeout: 5000,
        env: this.cppToolchain.env ?? process.env,
      }).toString();
      return { exitCode: 0, stdout: normalizeProcessOutput(stdout), stderr: "" };
    } catch (e: any) {
      return {
        exitCode: e.status ?? 1,
        stdout: normalizeProcessOutput(e.stdout?.toString() ?? ""),
        stderr: normalizeProcessOutput(e.stderr?.toString() ?? ""),
      };
    }
  }

  /**
   * Just compile (syntax check) without running. Returns true if compilation succeeds.
   */
  compileOnly(doofSource: string): { success: boolean; error: string; code: string } {
    if (!this.cppToolchain) {
      return {
        success: false,
        error: missingCompilerMessage(),
        code: "",
      };
    }

    let cppCode: string;
    let project: ReturnType<typeof emitProject>;
    try {
      const artifacts = emitArtifacts(doofSource);
      cppCode = artifacts.code;
      project = artifacts.project;
    } catch (e: any) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        code: "",
      };
    }

    writeProjectArtifacts(this.tmpDir, project);

    try {
      const nativeBuild = createNativeBuildOptions();
      const compilePlan = buildCompilePlan(this.tmpDir, project, nativeBuild, {
        extraIncludePaths: getExtraIncludePaths(nativeBuild, [project.runtime, ...project.modules.map((mod) => mod.hppCode), ...project.modules.map((mod) => mod.cppCode)]),
        mode: "syntax-only",
        toolchain: this.cppToolchain,
      });
      for (const command of compilePlan.commands) {
        execFileSync(command.command, command.args, {
          stdio: "pipe",
          cwd: this.tmpDir,
          timeout: 15000,
          env: this.cppToolchain.env ?? process.env,
        });
      }
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
    if (!this.cppToolchain) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: missingCompilerMessage(),
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
      project = emitProject(entry, result);
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      };
    }

    writeProjectArtifacts(this.tmpDir, project);

    const compilePlan = buildCompilePlan(this.tmpDir, project, nativeBuild, {
      extraIncludePaths: getExtraIncludePaths(nativeBuild, [project.runtime, ...project.modules.map((mod) => mod.hppCode), ...project.modules.map((mod) => mod.cppCode)]),
      toolchain: this.cppToolchain,
    });

    try {
      for (const command of compilePlan.commands) {
        execFileSync(command.command, command.args, {
          stdio: "pipe",
          cwd: this.tmpDir,
          timeout: 15000,
          env: this.cppToolchain.env ?? process.env,
        });
      }
    } catch (e: any) {
      const allCode = project.modules.map(m =>
        `--- ${m.hppPath} ---\n${m.hppCode}\n--- ${m.cppPath} ---\n${m.cppCode}`
      ).join("\n\n");
      return {
        exitCode: -1,
        stdout: "",
        stderr: `${formatCompilationFailure(e)}\n\nGenerated C++:\n${allCode}`,
      };
    }

    // Run
    try {
      const stdout = execFileSync(compilePlan.outBinary, [], {
        stdio: "pipe",
        timeout: 5000,
        env: this.cppToolchain.env ?? process.env,
      }).toString();
      return { exitCode: 0, stdout: normalizeProcessOutput(stdout), stderr: "" };
    } catch (e: any) {
      return {
        exitCode: e.status ?? 1,
        stdout: normalizeProcessOutput(e.stdout?.toString() ?? ""),
        stderr: normalizeProcessOutput(e.stderr?.toString() ?? ""),
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
    if (!this.cppToolchain) {
      return {
        success: false,
        error: missingCompilerMessage(),
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
      project = emitProject(entry, result);
    } catch (e: any) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        codes: "",
      };
    }

    writeProjectArtifacts(this.tmpDir, project);

    const allCode = project.modules.map(m =>
      `--- ${m.hppPath} ---\n${m.hppCode}\n--- ${m.cppPath} ---\n${m.cppCode}`
    ).join("\n\n");

    try {
      const compilePlan = buildCompilePlan(this.tmpDir, project, nativeBuild, {
        extraIncludePaths: getExtraIncludePaths(nativeBuild, [project.runtime, ...project.modules.map((mod) => mod.hppCode), ...project.modules.map((mod) => mod.cppCode)]),
        mode: "syntax-only",
        toolchain: this.cppToolchain,
      });
      for (const command of compilePlan.commands) {
        execFileSync(command.command, command.args, {
          stdio: "pipe",
          cwd: this.tmpDir,
          timeout: 15000,
          env: this.cppToolchain.env ?? process.env,
        });
      }
      return { success: true, error: "", codes: allCode };
    } catch (e: any) {
      return {
        success: false,
        error: e.stderr?.toString() ?? e.message,
        codes: allCode,
      };
    }
  }

  compileAndRunManifestProject(
    entryPath: string,
    nativeBuildOptions: Partial<NativeBuildOptions> = {},
  ): RunResult {
    if (!this.cppToolchain) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: missingCompilerMessage(),
      };
    }

    const nativeBuild = createNativeBuildOptions(nativeBuildOptions);
    let pipeline;
    try {
      pipeline = runPipelineWithFs(
        new RealFS(),
        entryPath,
        false,
        nativeBuild,
        () => {},
        () => {},
      );
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      };
    }

    const outDir = fs.mkdtempSync(path.join(this.tmpDir, "doof-manifest-project-"));
    writeProject(pipeline.project, outDir, false, () => {}, pipeline.provenance, pipeline.buildManifest);

    try {
      const compilePlan = buildCompilePlan(outDir, pipeline.project, pipeline.nativeBuild, {
        extraIncludePaths: getExtraIncludePaths(
          pipeline.nativeBuild,
          [
            pipeline.project.runtime,
            ...pipeline.project.modules.map((mod) => mod.hppCode),
            ...pipeline.project.modules.map((mod) => mod.cppCode),
          ],
        ),
        toolchain: this.cppToolchain,
        outputBinaryName: pipeline.outputBinaryName,
      });
      for (const command of compilePlan.commands) {
        execFileSync(command.command, command.args, {
          stdio: "pipe",
          cwd: outDir,
          timeout: 15000,
          env: this.cppToolchain.env ?? process.env,
        });
      }
    } catch (e: any) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: formatCompilationFailure(e),
      };
    }

    try {
      const outBinary = path.join(outDir, path.basename(pipeline.outputBinaryName));
      const stdout = execFileSync(outBinary, [], {
        stdio: "pipe",
        timeout: 5000,
        env: this.cppToolchain.env ?? process.env,
      }).toString();
      return { exitCode: 0, stdout: normalizeProcessOutput(stdout), stderr: "" };
    } catch (e: any) {
      return {
        exitCode: e.status ?? 1,
        stdout: normalizeProcessOutput(e.stdout?.toString() ?? ""),
        stderr: normalizeProcessOutput(e.stderr?.toString() ?? ""),
      };
    }
  }
}

function createResolverForEntry(vfs: VirtualFS, entry: string) {
  const manifestPath = findDoofManifestPath(vfs, entry);
  if (!manifestPath) {
    return createBundledModuleResolver(vfs);
  }

  const graph = loadPackageGraph(vfs, entry, {
    implicitStdDependencies: false,
  });
  return createBundledModuleResolver(vfs, {
    packages: graph.packages.map((pkg) => ({
      rootDir: pkg.rootDir,
      dependencies: pkg.dependencyRoots,
    })),
  });
}

function writeProjectArtifacts(tmpDir: string, project: ReturnType<typeof emitProject>): void {
  fs.writeFileSync(path.join(tmpDir, "doof_runtime.hpp"), project.runtime);
  for (const mod of project.modules) {
    const hppFile = path.join(tmpDir, mod.hppPath);
    const cppFile = path.join(tmpDir, mod.cppPath);
    fs.mkdirSync(path.dirname(hppFile), { recursive: true });
    fs.mkdirSync(path.dirname(cppFile), { recursive: true });
    fs.writeFileSync(hppFile, mod.hppCode);
    fs.writeFileSync(cppFile, mod.cppCode);
  }
  for (const supportFile of project.supportFiles) {
    const filePath = path.join(tmpDir, supportFile.relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, supportFile.content);
  }
}

function missingCompilerMessage(): string {
  return process.platform === "win32"
    ? "No C++ compiler found. Install Visual Studio with MSVC tools, or set CXX."
    : "No C++ compiler found. Install clang++, g++, or set CXX.";
}

function getExtraIncludePaths(nativeBuild: NativeBuildOptions, generatedArtifacts: string[]): string[] {
  return [];
}

function formatCompilationFailure(error: any): string {
  const stdout = error?.stdout?.toString()?.trim();
  const stderr = error?.stderr?.toString()?.trim();
  const details = [stdout, stderr].filter((value): value is string => Boolean(value && value.length > 0));
  return details.length > 0
    ? `Compilation failed:\n${details.join("\n")}`
    : `Compilation failed:\n${error?.message ?? String(error)}`;
}

function normalizeProcessOutput(output: string): string {
  return output.replace(/\r\n/g, "\n");
}
