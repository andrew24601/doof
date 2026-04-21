import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import {
  buildCompilePlan,
  resolveCompilerToolchain,
  type CompilerToolchain,
} from "./cli-core.js";
import { emitProject } from "./emitter-module.js";
import type { NativeBuildOptions, ProjectEmitResult } from "./emitter-module.js";
import {
  collectSemanticDiagnostics,
  throwIfErrorDiagnostics,
} from "./pipeline-diagnostics.js";
import { createNodeBundledModuleResolver, withNodeBundledStdlib } from "./stdlib-node.js";
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
  project: ProjectEmitResult;
  cpp: string;
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
    const runtimeFilePath = path.join(tempDir, "doof_runtime.hpp");
    host.writeFile(runtimeFilePath, artifacts.project.runtime);
    for (const module of artifacts.project.modules) {
      host.writeFile(path.join(tempDir, module.hppPath), module.hppCode);
      host.writeFile(path.join(tempDir, module.cppPath), module.cppCode);
    }

    const nativeBuild = createNativeBuildOptions();
    const compilePlan = buildCompilePlan(
      tempDir,
      artifacts.project,
      nativeBuild,
      {
        toolchain,
      },
    );
    let lastBuildProcess: ReturnType<typeof runProcess> | null = null;
    for (const command of compilePlan.commands) {
      const buildProcess = runProcess(host, command.command, command.args, {
        cwd: tempDir,
        env: toolchain.env ?? process.env,
        stdio: "pipe",
        timeout: 30000,
      });
      lastBuildProcess = buildProcess;

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
    }

    const runProcessResult = runProcess(host, compilePlan.outBinary, [], {
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
        buildCommand: lastBuildProcess?.command ?? "",
        buildStdout: lastBuildProcess?.stdout ?? "",
        buildStderr: lastBuildProcess?.stderr ?? "",
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
      buildCommand: lastBuildProcess?.command ?? "",
      buildStdout: lastBuildProcess?.stdout ?? "",
      buildStderr: lastBuildProcess?.stderr ?? "",
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
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
  const resolver = createNodeBundledModuleResolver(fileSystem);
  const analyzer = new ModuleAnalyzer(withNodeBundledStdlib(fileSystem), resolver);
  const analysisResult = analyzer.analyzeModule(ENTRY_PATH);
  const diagnostics = collectSemanticDiagnostics(analysisResult);

  throwIfErrorDiagnostics(diagnostics);

  const project = emitProject(ENTRY_PATH, analysisResult);
  const entryModule = project.modules.find((module) => module.modulePath === ENTRY_PATH);
  if (!entryModule) {
    throw new Error(`Entry module was not emitted: ${ENTRY_PATH}`);
  }

  return {
    project,
    cpp: entryModule.cppCode,
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
    pkgConfigPackages: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
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