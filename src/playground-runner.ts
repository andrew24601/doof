import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import { buildAnyRuntimePlan } from "./any-runtime.js";
import {
  buildCompileArgs,
  resolveCompilerToolchain,
  resolveNlohmannInclude,
  type CompilerToolchain,
} from "./cli-core.js";
import { emitCpp } from "./emitter.js";
import type { NativeBuildOptions, ProjectEmitResult } from "./emitter-module.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import {
  collectSemanticDiagnostics,
  throwIfErrorDiagnostics,
} from "./pipeline-diagnostics.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";

const ENTRY_PATH = "/main.do";

export type PlaygroundRunStatus =
  | "succeeded"
  | "compile-failed"
  | "build-failed"
  | "run-failed";

export interface PlaygroundRunResult {
  status: PlaygroundRunStatus;
  message: string;
  cpp: string;
  buildCommand: string;
  buildStdout: string;
  buildStderr: string;
  runCommand: string;
  runStdout: string;
  runStderr: string;
  exitCode: number | null;
  elapsedMs: number;
}

export interface PlaygroundRunnerHost {
  now(): number;
  createTempDir(): string;
  removeDir(dirPath: string): void;
  writeFile(filePath: string, contents: string): void;
  spawnFile(
    command: string,
    args: readonly string[],
    options: SpawnSyncOptions,
  ): SpawnSyncReturns<Buffer>;
  resolveCompilerToolchain(compiler: string | null | undefined): CompilerToolchain;
}

export interface RunPlaygroundSourceOptions {
  compiler?: string | null;
  host?: PlaygroundRunnerHost;
}

interface EmittedArtifacts {
  cpp: string;
  runtime: string;
}

interface ProcessResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  failed: boolean;
  failureMessage: string;
}

export function runPlaygroundSource(
  source: string,
  options: RunPlaygroundSourceOptions = {},
): PlaygroundRunResult {
  const host = options.host ?? createDefaultHost();
  const startedAt = host.now();

  let artifacts: EmittedArtifacts;
  try {
    artifacts = emitPlaygroundArtifacts(source);
  } catch (error: unknown) {
    return {
      status: "compile-failed",
      message: error instanceof Error ? error.message : String(error),
      cpp: "",
      buildCommand: "",
      buildStdout: "",
      buildStderr: "",
      runCommand: "",
      runStdout: "",
      runStderr: "",
      exitCode: null,
      elapsedMs: host.now() - startedAt,
    };
  }

  let toolchain: CompilerToolchain;
  try {
    toolchain = host.resolveCompilerToolchain(options.compiler ?? null);
  } catch (error: unknown) {
    return {
      status: "build-failed",
      message: error instanceof Error ? error.message : String(error),
      cpp: artifacts.cpp,
      buildCommand: "",
      buildStdout: "",
      buildStderr: "",
      runCommand: "",
      runStdout: "",
      runStderr: "",
      exitCode: null,
      elapsedMs: host.now() - startedAt,
    };
  }

  const tempDir = host.createTempDir();

  try {
    const cppFilePath = path.join(tempDir, "main.cpp");
    const runtimeFilePath = path.join(tempDir, "doof_runtime.hpp");
    host.writeFile(cppFilePath, artifacts.cpp);
    host.writeFile(runtimeFilePath, artifacts.runtime);

    const nativeBuild = createNativeBuildOptions();
    const nlohmannInclude = resolveNlohmannInclude(nativeBuild.includePaths, {
      allowProvision: true,
    });
    const { outBinary, args } = buildCompileArgs(
      tempDir,
      createSingleFileProject("main.cpp"),
      nativeBuild,
      {
        toolchain,
        extraIncludePaths: nlohmannInclude ? [nlohmannInclude] : [],
      },
    );
    const buildProcess = runProcess(host, toolchain.command, args, {
      cwd: tempDir,
      env: toolchain.env ?? process.env,
      stdio: "pipe",
      timeout: 30000,
    });

    if (buildProcess.failed) {
      return {
        status: "build-failed",
        message: buildProcess.failureMessage,
        cpp: artifacts.cpp,
        buildCommand: buildProcess.command,
        buildStdout: buildProcess.stdout,
        buildStderr: buildProcess.stderr,
        runCommand: "",
        runStdout: "",
        runStderr: "",
        exitCode: null,
        elapsedMs: host.now() - startedAt,
      };
    }

    const runProcessResult = runProcess(host, outBinary, [], {
      cwd: tempDir,
      env: toolchain.env ?? process.env,
      stdio: "pipe",
      timeout: 5000,
    });

    if (runProcessResult.failed) {
      return {
        status: "run-failed",
        message: runProcessResult.failureMessage,
        cpp: artifacts.cpp,
        buildCommand: buildProcess.command,
        buildStdout: buildProcess.stdout,
        buildStderr: buildProcess.stderr,
        runCommand: runProcessResult.command,
        runStdout: runProcessResult.stdout,
        runStderr: runProcessResult.stderr,
        exitCode: runProcessResult.exitCode,
        elapsedMs: host.now() - startedAt,
      };
    }

    return {
      status: "succeeded",
      message: "Build and run succeeded.",
      cpp: artifacts.cpp,
      buildCommand: buildProcess.command,
      buildStdout: buildProcess.stdout,
      buildStderr: buildProcess.stderr,
      runCommand: runProcessResult.command,
      runStdout: runProcessResult.stdout,
      runStderr: runProcessResult.stderr,
      exitCode: runProcessResult.exitCode,
      elapsedMs: host.now() - startedAt,
    };
  } finally {
    host.removeDir(tempDir);
  }
}

export function formatShellCommand(parts: readonly string[]): string {
  return parts.map(formatShellArg).join(" ");
}

function createDefaultHost(): PlaygroundRunnerHost {
  return {
    now() {
      return Date.now();
    },
    createTempDir() {
      return fs.mkdtempSync(path.join(os.tmpdir(), "doof-playground-"));
    },
    removeDir(dirPath: string) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    },
    writeFile(filePath: string, contents: string) {
      fs.writeFileSync(filePath, contents);
    },
    spawnFile(command, args, options) {
      return spawnSync(command, [...args], { ...options, encoding: "buffer" });
    },
    resolveCompilerToolchain(compiler) {
      return resolveCompilerToolchain(compiler);
    },
  };
}

function emitPlaygroundArtifacts(source: string): EmittedArtifacts {
  const fileSystem = new VirtualFS({ [ENTRY_PATH]: source });
  const resolver = createBundledModuleResolver(fileSystem);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fileSystem), resolver);
  const analysisResult = analyzer.analyzeModule(ENTRY_PATH);
  const diagnostics = collectSemanticDiagnostics(analysisResult);

  throwIfErrorDiagnostics(diagnostics);

  return {
    cpp: emitCpp(ENTRY_PATH, analysisResult),
    runtime: generateRuntimeHeader(buildAnyRuntimePlan(analysisResult)),
  };
}

function runProcess(
  host: PlaygroundRunnerHost,
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
): ProcessResult {
  const result = host.spawnFile(command, args, options);
  const stdout = normalizeProcessOutput(result.stdout);
  const stderr = normalizeProcessOutput(result.stderr);
  const exitCode = result.status ?? null;
  const formattedCommand = formatShellCommand([command, ...args]);

  if (result.error) {
    return {
      command: formattedCommand,
      stdout,
      stderr,
      exitCode,
      failed: true,
      failureMessage: formatProcessFailure(result.error, stdout, stderr, result.signal, exitCode),
    };
  }

  if (exitCode !== 0) {
    return {
      command: formattedCommand,
      stdout,
      stderr,
      exitCode,
      failed: true,
      failureMessage: formatExitFailure(exitCode, result.signal, stdout, stderr),
    };
  }

  return {
    command: formattedCommand,
    stdout,
    stderr,
    exitCode,
    failed: false,
    failureMessage: "",
  };
}

function createNativeBuildOptions(): NativeBuildOptions {
  return {
    cppStd: "c++17",
    includePaths: [],
    libraryPaths: [],
    linkLibraries: [],
    frameworks: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
  };
}

function createSingleFileProject(cppPath: string): ProjectEmitResult {
  return {
    modules: [
      {
        modulePath: ENTRY_PATH,
        hppPath: "main.hpp",
        cppPath,
        hppCode: "",
        cppCode: "",
      },
    ],
    runtime: "",
    cmake: "",
  };
}

function normalizeProcessOutput(output: Buffer | string | null | undefined): string {
  if (output === null || output === undefined) {
    return "";
  }

  const text = Buffer.isBuffer(output) ? output.toString("utf8") : output;
  return text.replace(/\r\n/g, "\n");
}

function formatProcessFailure(
  error: Error,
  stdout: string,
  stderr: string,
  signal: NodeJS.Signals | null,
  exitCode: number | null,
): string {
  const details = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0);
  if (details.length > 0) {
    return details.join("\n");
  }

  if (signal) {
    return `Process terminated with signal ${signal}.`;
  }

  if (exitCode !== null) {
    return `Process exited with code ${exitCode}.`;
  }

  return error.message;
}

function formatExitFailure(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): string {
  const details = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0);
  if (details.length > 0) {
    return details.join("\n");
  }

  if (signal) {
    return `Process terminated with signal ${signal}.`;
  }

  if (exitCode !== null) {
    return `Process exited with code ${exitCode}.`;
  }

  return "Process failed.";
}

function formatShellArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"'\\$`]/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}