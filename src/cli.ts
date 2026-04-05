#!/usr/bin/env node

/**
 * Doof CLI — command-line interface for the Doof-to-C++ transpiler.
 *
 * Usage:
 *   doof emit <entry.do>       — Emit C++ source files to an output directory
 *   doof build <entry.do>      — Emit + compile with clang++/g++
 *   doof run <entry.do>        — Emit + compile + run the program
 *   doof check <entry.do>      — Type-check only (no C++ output)
 *
 * Options:
 *   -o, --outdir <dir>         — Output directory (default: ./build)
 *   --compiler <path>          — C++ compiler to use (default: auto-detect)
 *   --std <standard>           — C++ standard (default: c++17)
 *   -v, --verbose              — Print detailed progress information
 *   -h, --help                 — Show this help message
 *   --version                  — Show version
 */

import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NativeBuildOptions } from "./emitter-module.js";
import {
  buildCompileArgs,
  compileCpp,
  findCompiler,
  printDiagnostic,
  RealFS,
  resolveNativeBuildOptions,
  runPipelineWithFs,
  writeProject,
} from "./cli-core.js";
import { runTestCommand } from "./test-runner.js";

// ============================================================================
// CLI argument parsing
// ============================================================================

type Command = "emit" | "build" | "run" | "check" | "test" | "help" | "version";

export interface CliArgs {
  command: Command;
  entry: string;
  outDir: string;
  compiler: string | null;
  cppStd: string;
  verbose: boolean;
  testFilter: string | null;
  listTests: boolean;
  nativeBuild: NativeBuildOptions;
}

const HELP_TEXT = `
doof — Doof-to-C++ transpiler

Usage:
  doof <command> [options] <entry.do>

Commands:
  emit   <entry.do>    Emit C++ source files to an output directory
  build  <entry.do>    Emit and compile to a native binary
  run    <entry.do>    Emit, compile, and run the program
  check  <entry.do>    Type-check only (no C++ output)
  test   <path>        Discover and run exported Doof tests

Options:
  -o, --outdir <dir>   Output directory (default: ./build)
  --compiler <path>    C++ compiler (default: auto-detect clang++ or g++)
  --std <standard>     C++ standard (default: c++17)
  --include-path <dir> Additional header search path (repeatable)
  --lib-path <dir>     Additional library search path (repeatable)
  --link-lib <name>    Link library by name (repeatable)
  --framework <name>   Link Apple framework by name (repeatable)
  --source <path>      Additional source file to compile and link (repeatable)
  --object <path>      Additional object file to link (repeatable)
  --define <name>      Preprocessor definition, optionally NAME=value (repeatable)
  --cxxflag <flag>     Additional compiler flag (repeatable)
  --ldflag <flag>      Additional linker flag (repeatable)
  --filter <text>      Run only tests whose id contains the filter text
  --list               List discovered tests without compiling or running them
  -v, --verbose        Print detailed progress information
  -h, --help           Show this help message
  --version            Show version

Examples:
  doof run samples/hello.do
  doof build -o dist samples/fibonacci.do
  doof emit --verbose samples/classes.do
  doof check samples/hello.do
  doof test samples
  doof build --include-path ./vendor/include --lib-path ./vendor/lib --link-lib curl samples/http.do
`.trimStart();

const COMMANDS = new Set<Command>(["emit", "build", "run", "check", "test"]);
const FALLBACK_VERSION = "0.0.0";

function createEmptyNativeBuildOptions(cppStd = "c++17"): NativeBuildOptions {
  return {
    cppStd,
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

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "help",
    entry: "",
    outDir: "./build",
    compiler: null,
    cppStd: "c++17",
    verbose: false,
    testFilter: null,
    listTests: false,
    nativeBuild: createEmptyNativeBuildOptions(),
  };

  const rest = argv.slice(2);
  if (rest.length === 0) return args;

  let i = 0;
  const first = rest[i];

  // Check for top-level flags
  if (first === "-h" || first === "--help") { args.command = "help"; return args; }
  if (first === "--version") { args.command = "version"; return args; }

  // Parse command (or default to "run")
  if (COMMANDS.has(first as Command)) {
    args.command = first as Command;
    i++;
  } else {
    args.command = "run";
  }

  // Parse remaining options and positional args
  while (i < rest.length) {
    const arg = rest[i];
    switch (arg) {
      case "-o": case "--outdir":
        args.outDir = rest[++i] ?? fatal("Missing value for --outdir");
        break;
      case "--compiler":
        args.compiler = rest[++i] ?? fatal("Missing value for --compiler");
        break;
      case "--std":
        args.cppStd = rest[++i] ?? fatal("Missing value for --std");
        args.nativeBuild.cppStd = args.cppStd;
        break;
      case "--include-path":
        args.nativeBuild.includePaths.push(rest[++i] ?? fatal("Missing value for --include-path"));
        break;
      case "--lib-path":
        args.nativeBuild.libraryPaths.push(rest[++i] ?? fatal("Missing value for --lib-path"));
        break;
      case "--link-lib":
        args.nativeBuild.linkLibraries.push(normalizeLinkLibrary(rest[++i] ?? fatal("Missing value for --link-lib")));
        break;
      case "--framework":
        args.nativeBuild.frameworks.push(rest[++i] ?? fatal("Missing value for --framework"));
        break;
      case "--source":
        args.nativeBuild.sourceFiles.push(rest[++i] ?? fatal("Missing value for --source"));
        break;
      case "--object":
        args.nativeBuild.objectFiles.push(rest[++i] ?? fatal("Missing value for --object"));
        break;
      case "--define":
        args.nativeBuild.defines.push(normalizeDefine(rest[++i] ?? fatal("Missing value for --define")));
        break;
      case "--cxxflag":
        args.nativeBuild.compilerFlags.push(rest[++i] ?? fatal("Missing value for --cxxflag"));
        break;
      case "--ldflag":
        args.nativeBuild.linkerFlags.push(rest[++i] ?? fatal("Missing value for --ldflag"));
        break;
      case "--filter":
        args.testFilter = rest[++i] ?? fatal("Missing value for --filter");
        break;
      case "--list":
        args.listTests = true;
        break;
      case "-v": case "--verbose":
        args.verbose = true;
        break;
      case "-h": case "--help":
        args.command = "help";
        return args;
      default:
        if (arg.startsWith("-")) fatal(`Unknown option: ${arg}`);
        args.entry = arg;
    }
    i++;
  }

  return args;
}

export function getCliVersion(packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))): string {
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

// ============================================================================
// Commands
// ============================================================================

export { buildCompileArgs } from "./cli-core.js";

function runPipeline(entryFile: string, verbose: boolean, nativeBuild: NativeBuildOptions) {
  return runPipelineWithFs(new RealFS(), entryFile, verbose, nativeBuild, log, printDiagnostic);
}

function cmdCheck(entry: string, verbose: boolean): void {
  const { warningCount } = runPipeline(entry, verbose, createEmptyNativeBuildOptions());
  log(warningCount > 0
    ? `Check passed with ${pluralize(warningCount, "warning")}`
    : "Check passed — no errors");
}

function cmdEmit(entry: string, outDir: string, verbose: boolean, nativeBuild: NativeBuildOptions): void {
  const resolvedNativeBuild = resolveNativeBuildOptions(nativeBuild);
  const { project, provenance, buildManifest } = runPipeline(entry, verbose, resolvedNativeBuild);
  writeProject(project, outDir, verbose, log, provenance, buildManifest);
  log(`Emitted ${project.modules.length} module(s) to ${outDir}/`);
}

function cmdBuildOrRun(args: CliArgs, run: boolean): void {
  const compiler = args.compiler ?? findCompiler();
  const nativeBuild = resolveNativeBuildOptions(args.nativeBuild);
  const { project, outputBinaryName, provenance, buildManifest } = runPipeline(args.entry, args.verbose, nativeBuild);
  writeProject(project, args.outDir, args.verbose, log, provenance, buildManifest);
  const binary = compileCpp(args.outDir, project, compiler, nativeBuild, args.verbose, log, outputBinaryName);

  if (!run) {
    log(`Build complete: ${binary}`);
    return;
  }

  if (args.verbose) log(`Running: ${binary}`);
  try {
    execFileSync(binary, [], { stdio: "inherit", timeout: 30000 });
  } catch (e: any) {
    process.exit(e.status ?? 1);
  }
}

function cmdTest(args: CliArgs): void {
  const compiler = args.compiler ?? findCompiler();
  const nativeBuild = resolveNativeBuildOptions(args.nativeBuild);
  const result = runTestCommand({
    targetPath: args.entry,
    compiler,
    nativeBuild,
    filter: args.testFilter,
    listOnly: args.listTests,
    verbose: args.verbose,
    reporter: { log, error },
  });

  if (!args.listTests && result.failed > 0) {
    process.exit(1);
  }
}

// ============================================================================
// Output helpers
// ============================================================================

function log(msg: string): void { console.log(`[doof] ${msg}`); }
function error(msg: string): void { console.error(`[doof] error: ${msg}`); }
function fatal(msg: string): never { error(msg); process.exit(1); }
function pluralize(n: number, word: string): string { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function normalizeDefine(value: string): string {
  return value.startsWith("-D") ? value.slice(2) : value;
}

function normalizeLinkLibrary(value: string): string {
  return value.startsWith("-l") ? value.slice(2) : value;
}

// ============================================================================
// Main
// ============================================================================

export function main(argv = process.argv): void {
  try {
    const args = parseArgs(argv);

    switch (args.command) {
      case "help":
        console.log(HELP_TEXT);
        break;
      case "version":
        console.log(`doof ${getCliVersion()}`);
        break;
      case "check":
        if (!args.entry) fatal("Missing entry file. Usage: doof check <file.do>");
        cmdCheck(args.entry, args.verbose);
        break;
      case "test":
        if (!args.entry) fatal("Missing test path. Usage: doof test <path>");
        cmdTest(args);
        break;
      case "emit":
        if (!args.entry) fatal("Missing entry file. Usage: doof emit <file.do>");
        cmdEmit(args.entry, args.outDir, args.verbose, resolveNativeBuildOptions(args.nativeBuild));
        break;
      case "build":
        if (!args.entry) fatal("Missing entry file. Usage: doof build <file.do>");
        cmdBuildOrRun(args, false);
        break;
      case "run":
        if (!args.entry) fatal("Missing entry file. Usage: doof run <file.do>");
        cmdBuildOrRun(args, true);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(message);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}