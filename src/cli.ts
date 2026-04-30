#!/usr/bin/env node

/**
 * Doof CLI — command-line interface for the Doof-to-C++ transpiler.
 *
 * Usage:
 *   doof emit [entry.do|dir]   — Emit C++ source files to an output directory
 *   doof build [entry.do|dir]  — Emit + compile with an auto-detected native C++ compiler
 *   doof run [entry.do|dir]    — Emit + compile + run the program
 *   doof check [entry.do|dir]  — Type-check only (no C++ output)
 *
 * Options:
 *   -o, --outdir <dir>         — Output directory (default: package build/ or build.buildDir)
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
import { isDoofBuildTarget, type DoofBuildTarget, type IOSAppDestination } from "./build-targets.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { findDoofManifestPath, resolvePackageBuildContext } from "./package-manifest.js";
import { joinFsPath, resolveFsPath, resolveFsPathFrom } from "./path-utils.js";
import type { FileSystem } from "./resolver.js";
import { assembleIOSAppBundle } from "./ios-app-target.js";
import {
  buildIOSDeviceNativeBuild,
  buildIOSSimulatorNativeBuild,
  installAndLaunchIOSDeviceApp,
  installAndLaunchIOSSimulatorApp,
  resolveIOSDeviceIdentifier,
  resolveIOSDeviceBuildSettings,
  resolveIOSDeviceSigningOptionsForBundle,
  resolveIOSSimulatorBuildSettings,
  signIOSDeviceApp,
} from "./ios-app-target-node.js";
import { assembleMacOSAppBundle } from "./macos-app-target.js";
import { generateMacOSAppIconWithShell } from "./macos-app-target-node.js";
import {
  buildCompileArgs,
  buildCompilePlan,
  compileCpp,
  findCompilerToolchain,
  printDiagnostic,
  RealFS,
  resolveCompilerToolchain,
  resolveNativeBuildOptions,
  runPipelineWithFs,
  writeProject,
} from "./cli-core.js";
import { runTestCommand } from "./test-runner.js";

// ============================================================================
// CLI argument parsing
// ============================================================================

type Command = "emit" | "build" | "run" | "check" | "test" | "help" | "version";
type PipelineCommand = "emit" | "build" | "run" | "check";

export interface CliArgs {
  command: Command;
  entry: string;
  outDir: string;
  outDirExplicit: boolean;
  targetOverride: DoofBuildTarget | null;
  iosDestination: IOSAppDestination;
  iosDevice: string | null;
  iosSignIdentity: string | null;
  iosProvisioningProfile: string | null;
  compiler: string | null;
  cppStd: string;
  verbose: boolean;
  testFilter: string | null;
  listTests: boolean;
  coverage: boolean;
  coverageOutput: string;
  nativeBuild: NativeBuildOptions;
}

const HELP_TEXT = `
doof — Doof-to-C++ transpiler

Usage:
  doof <command> [options] [entry.do | package-dir]

Commands:
  emit   [path]        Emit C++ source files to an output directory
  build  [path]        Emit and compile to a native binary
  run    [path]        Emit, compile, and run the program
  check  [path]        Type-check only (no C++ output)
  test   <path>        Discover and run exported Doof tests

Options:
  -o, --outdir <dir>   Output directory (default: package build/ or build.buildDir)
  --compiler <path>    C++ compiler (default: auto-detect clang++/g++, or Visual Studio cl.exe on Windows)
  --target <kind>      Override the manifest build target (macos-app or ios-app)
  --ios-destination <kind>
                       iOS destination for ios-app builds (simulator or device)
  --ios-device <id>    Connected iOS device identifier or name for ios-app run when using --ios-destination device
  --ios-sign-identity <name>
                       Code signing identity for ios-app device builds
  --ios-provisioning-profile <path>
                       Provisioning profile for ios-app device builds
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
  --coverage           Collect and report line coverage for Doof source files
  --coverage-output <path>
                       Path for the JSON coverage report (default: build/coverage/doof-test-coverage.json)
  -v, --verbose        Print detailed progress information
  -h, --help           Show this help message
  --version            Show version

Environment:
  DOOF_RUN_TIMEOUT_MS  Max runtime in ms for doof run (default: unlimited)

Examples:
  doof run samples/hello.do
  doof build -o dist samples/fibonacci.do
  doof build samples/solitaire
  doof build --target ios-app samples/solitaire
  doof run --target ios-app --ios-destination device samples/solitaire
  doof run --target ios-app --ios-destination device --ios-device <udid> --ios-sign-identity "Apple Development: Name (TEAMID)" --ios-provisioning-profile ~/Library/MobileDevice/Provisioning\ Profiles/profile.mobileprovision samples/solitaire
  doof build
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
    pkgConfigPackages: [],
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
    outDirExplicit: false,
    targetOverride: null,
    iosDestination: "simulator",
    iosDevice: null,
    iosSignIdentity: null,
    iosProvisioningProfile: null,
    compiler: null,
    cppStd: "c++17",
    verbose: false,
    testFilter: null,
    listTests: false,
    coverage: false,
    coverageOutput: "",
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
        args.outDirExplicit = true;
        break;
      case "--compiler":
        args.compiler = rest[++i] ?? fatal("Missing value for --compiler");
        break;
      case "--target": {
        const value = rest[++i] ?? fatal("Missing value for --target");
        if (!isDoofBuildTarget(value)) {
          fatal(`Invalid value for --target: ${value}`);
        }
        args.targetOverride = value;
        break;
      }
      case "--ios-destination": {
        const value = rest[++i] ?? fatal("Missing value for --ios-destination");
        if (value !== "simulator" && value !== "device") {
          fatal(`Invalid value for --ios-destination: ${value}`);
        }
        args.iosDestination = value;
        break;
      }
      case "--ios-device":
        args.iosDevice = rest[++i] ?? fatal("Missing value for --ios-device");
        break;
      case "--ios-sign-identity":
        args.iosSignIdentity = rest[++i] ?? fatal("Missing value for --ios-sign-identity");
        break;
      case "--ios-provisioning-profile":
        args.iosProvisioningProfile = rest[++i] ?? fatal("Missing value for --ios-provisioning-profile");
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
      case "--coverage":
        args.coverage = true;
        break;
      case "--coverage-output":
        args.coverageOutput = rest[++i] ?? fatal("Missing value for --coverage-output");
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

export function resolveCliPipelineInputs(fileSystem: FileSystem, cwd: string, args: CliArgs): { entry: string; outDir: string } {
  const requestedPath = args.entry ? resolveFsPathFrom(cwd, args.entry) : resolveFsPath(cwd);
  const packageContext = resolveRequestedPackageContext(fileSystem, requestedPath, args.entry);
  if (packageContext) {
    return {
      entry: packageContext.entryPath,
      outDir: args.outDirExplicit ? args.outDir : packageContext.buildDir,
    };
  }

  const manifestPath = findDoofManifestPath(fileSystem, requestedPath);
  return {
    entry: requestedPath,
    outDir: !args.outDirExplicit && manifestPath
      ? resolvePackageBuildContext(fileSystem, requestedPath).buildDir
      : args.outDir,
  };
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

export { buildCompileArgs, buildCompilePlan } from "./cli-core.js";

function runPipeline(
  entryFile: string,
  verbose: boolean,
  nativeBuild: NativeBuildOptions,
  targetOverride: DoofBuildTarget | null,
  iosDestination: IOSAppDestination,
) {
  return runPipelineWithFs(new RealFS(), entryFile, verbose, nativeBuild, log, printDiagnostic, {
    buildTargetOverride: targetOverride ?? undefined,
    iosDestinationOverride: iosDestination,
  });
}

function cmdCheck(entry: string, verbose: boolean, targetOverride: DoofBuildTarget | null, iosDestination: IOSAppDestination): void {
  const { warningCount } = runPipeline(entry, verbose, createEmptyNativeBuildOptions(), targetOverride, iosDestination);
  log(warningCount > 0
    ? `Check passed with ${pluralize(warningCount, "warning")}`
    : "Check passed — no errors");
}

function cmdEmit(
  entry: string,
  outDir: string,
  verbose: boolean,
  nativeBuild: NativeBuildOptions,
  targetOverride: DoofBuildTarget | null,
  iosDestination: IOSAppDestination,
): void {
  const resolvedNativeBuild = resolveNativeBuildOptions(nativeBuild);
  const { project, provenance, buildManifest } = runPipeline(entry, verbose, resolvedNativeBuild, targetOverride, iosDestination);
  writeProject(project, outDir, verbose, log, provenance, buildManifest);
  log(`Emitted ${project.modules.length} module(s) to ${outDir}/`);
}

function cmdBuildOrRun(args: CliArgs, run: boolean): void {
  const toolchain = resolveCompilerToolchain(args.compiler);
  const nativeBuild = resolveNativeBuildOptions(args.nativeBuild);
  const { project, nativeBuild: resolvedNativeBuild, outputBinaryName, provenance, buildManifest, buildTarget } = runPipeline(
    args.entry,
    args.verbose,
    nativeBuild,
    args.targetOverride,
    args.iosDestination,
  );
  writeProject(project, args.outDir, args.verbose, log, provenance, buildManifest);
  const effectiveNativeBuild = buildTarget?.kind === "ios-app"
    ? args.iosDestination === "device"
      ? buildIOSDeviceNativeBuild(
        resolvedNativeBuild,
        args.outDir,
        resolveIOSDeviceBuildSettings(buildTarget.config),
      )
      : buildIOSSimulatorNativeBuild(
        resolvedNativeBuild,
        args.outDir,
        resolveIOSSimulatorBuildSettings(buildTarget.config),
      )
    : resolvedNativeBuild;
  const binary = compileCpp(args.outDir, project, toolchain, effectiveNativeBuild, args.verbose, log, outputBinaryName);
  let builtArtifactPath = binary;
  let runBinaryPath = binary;

  if (buildTarget?.kind === "macos-app") {
    const bundle = assembleMacOSAppBundle({
      outputDir: args.outDir,
      executablePath: binary,
      executableName: outputBinaryName,
      config: buildTarget.config,
      log: args.verbose ? log : undefined,
      generateIcon: generateMacOSAppIconWithShell,
    });
    builtArtifactPath = bundle.appPath;
    runBinaryPath = bundle.binaryPath;
  }

  if (buildTarget?.kind === "ios-app") {
    const bundle = assembleIOSAppBundle({
      outputDir: args.outDir,
      executablePath: binary,
      executableName: outputBinaryName,
      config: buildTarget.config,
      log: args.verbose ? log : undefined,
    });
    builtArtifactPath = bundle.appPath;
    runBinaryPath = bundle.binaryPath;

    if (args.iosDestination === "device") {
      const signing = resolveIOSDeviceSigningOptions(args, buildTarget.config.bundleId);
      if (args.verbose) log(`Signing iOS device app: ${builtArtifactPath}`);
      signIOSDeviceApp(builtArtifactPath, buildTarget.config.bundleId, signing);
    }
  }

  if (!run) {
    log(`Build complete: ${builtArtifactPath}`);
    return;
  }

  if (buildTarget?.kind === "ios-app") {
    if (args.iosDestination === "device") {
      const deviceIdentifier = resolveIOSDeviceTargetIdentifier(args);
      if (args.verbose) log(`Installing on iOS device ${deviceIdentifier}: ${builtArtifactPath}`);
      installAndLaunchIOSDeviceApp(builtArtifactPath, deviceIdentifier, buildTarget.config.bundleId, true);
      log(`Launched iOS device app: ${builtArtifactPath}`);
      return;
    }

    if (args.verbose) log(`Installing on booted iOS simulator: ${builtArtifactPath}`);
    installAndLaunchIOSSimulatorApp(builtArtifactPath, buildTarget.config.bundleId, true);
    log(`Launched iOS simulator app: ${builtArtifactPath}`);
    return;
  }

  if (args.verbose) log(`Running: ${runBinaryPath}`);
  const runTimeout = resolveRunTimeoutMs(process.env);
  try {
    execFileSync(runBinaryPath, [], {
      stdio: "inherit",
      timeout: runTimeout,
      env: toolchain.env ?? process.env,
    });
  } catch (e: any) {
    if (runTimeout > 0 && isTimedOutRunError(e)) {
      error(formatRunTimeoutMessage(runTimeout));
      process.exit(124);
    }
    process.exit(e.status ?? 1);
  }
}

function cmdTest(args: CliArgs): void {
  const compiler = args.compiler ? resolveCompilerToolchain(args.compiler) : findCompilerToolchain();
  const nativeBuild = resolveNativeBuildOptions(args.nativeBuild);
  const result = runTestCommand({
    targetPath: args.entry,
    compiler,
    nativeBuild,
    filter: args.testFilter,
    listOnly: args.listTests,
    verbose: args.verbose,
    reporter: { log, error },
    coverage: args.coverage,
    coverageOutput: args.coverageOutput || undefined,
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

function resolveIOSDeviceSigningOptions(
  args: CliArgs,
  bundleId: string,
): { signIdentity: string; provisioningProfilePath: string } {
  try {
    return resolveIOSDeviceSigningOptionsForBundle(bundleId, {
      signIdentity: args.iosSignIdentity,
      provisioningProfilePath: args.iosProvisioningProfile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(message);
  }
}

function resolveIOSDeviceTargetIdentifier(args: CliArgs): string {
  try {
    return resolveIOSDeviceIdentifier(args.iosDevice);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(message);
  }
}

export function resolveRunTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DOOF_RUN_TIMEOUT_MS?.trim();
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function isTimedOutRunError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  };

  return candidate.code === "ETIMEDOUT"
    || candidate.errno === "ETIMEDOUT"
    || (typeof candidate.message === "string" && candidate.message.includes("ETIMEDOUT"));
}

export function formatRunTimeoutMessage(timeoutMs: number): string {
  return `Program exceeded DOOF_RUN_TIMEOUT_MS=${timeoutMs} and was terminated`;
}

function isPipelineCommand(command: Command): command is PipelineCommand {
  return command === "emit" || command === "build" || command === "run" || command === "check";
}

function resolveRequestedPackageContext(fileSystem: FileSystem, requestedPath: string, rawEntry: string) {
  if (!rawEntry) {
    return resolvePackageBuildContext(fileSystem, requestedPath);
  }

  if (isManifestPath(requestedPath)) {
    return resolvePackageBuildContext(fileSystem, requestedPath);
  }

  if (fileSystem.readFile(joinFsPath(requestedPath, "doof.json")) !== null) {
    return resolvePackageBuildContext(fileSystem, requestedPath);
  }

  if (fileSystem.readFile(requestedPath) !== null) {
    return null;
  }

  return path.extname(rawEntry) === ""
    ? resolvePackageBuildContext(fileSystem, requestedPath)
    : null;
}

function isManifestPath(pathValue: string): boolean {
  return pathValue === "doof.json"
    || pathValue.endsWith("/doof.json")
    || pathValue.endsWith("\\doof.json");
}

// ============================================================================
// Main
// ============================================================================

export function main(argv = process.argv): void {
  try {
    const args = parseArgs(argv);
    const resolvedArgs = isPipelineCommand(args.command)
      ? { ...args, ...resolveCliPipelineInputs(new RealFS(), process.cwd(), args) }
      : args;

    switch (resolvedArgs.command) {
      case "help":
        console.log(HELP_TEXT);
        break;
      case "version":
        console.log(`doof ${getCliVersion()}`);
        break;
      case "check":
        cmdCheck(resolvedArgs.entry, resolvedArgs.verbose, resolvedArgs.targetOverride, resolvedArgs.iosDestination);
        break;
      case "test":
        if (!resolvedArgs.entry) fatal("Missing test path. Usage: doof test <path>");
        cmdTest(resolvedArgs);
        break;
      case "emit":
        cmdEmit(
          resolvedArgs.entry,
          resolvedArgs.outDir,
          resolvedArgs.verbose,
          resolveNativeBuildOptions(resolvedArgs.nativeBuild),
          resolvedArgs.targetOverride,
          resolvedArgs.iosDestination,
        );
        break;
      case "build":
        cmdBuildOrRun(resolvedArgs, false);
        break;
      case "run":
        cmdBuildOrRun(resolvedArgs, true);
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