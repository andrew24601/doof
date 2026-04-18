import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import { emitProject, type NativeBuildOptions, type ProjectEmitResult } from "./emitter-module.js";
import type { ResolvedDoofBuildTarget } from "./build-targets.js";
import type { FileSystem } from "./resolver.js";
import { dirnameFsPath, isWithinFsRoot, joinFsPath, relativeFsPath, resolveFsPath, toPortablePath } from "./path-utils.js";
import {
  createBuildProvenance,
  createPackageOutputPaths,
  loadPackageGraph,
  narrowPackageGraphForBuild,
  type BuildProvenance,
  type PackageOutputPaths,
  type PackageGraph,
  mergePackageNativeBuild,
  type ResolvedPackageNativeBuild,
} from "./package-manifest.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";

export class RealFS implements FileSystem {
  readFile(absolutePath: string): string | null {
    try {
      return fs.readFileSync(absolutePath, "utf-8");
    } catch {
      return null;
    }
  }

  fileExists(absolutePath: string): boolean {
    try {
      return fs.statSync(absolutePath).isFile();
    } catch {
      return false;
    }
  }
}

export interface DiagnosticLike {
  severity: string;
  message: string;
  module?: string;
  span?: { start: { line: number; column: number } };
}

export interface PipelineResult {
  project: ProjectEmitResult;
  nativeBuild: NativeBuildOptions;
  warningCount: number;
  outputBinaryName: string;
  provenance: BuildProvenance;
  buildManifest: BuildManifestTemplate;
  buildTarget: ResolvedDoofBuildTarget | null;
}

interface BuildManifestTemplate {
  schemaVersion: 2;
  entryPath: string;
  outputBinaryName: string;
  buildTarget: ResolvedDoofBuildTarget | null;
  generatedHeaders: string[];
  generatedSources: string[];
  outputNativeIncludePaths: string[];
  outputNativeSourceFiles: string[];
  outputNativeLibraryPaths: string[];
  nativeIncludePaths: string[];
  nativeSourceFiles: string[];
  libraryPaths: string[];
  linkLibraries: string[];
  frameworks: string[];
  pkgConfigPackages: string[];
  defines: string[];
  compilerFlags: string[];
  linkerFlags: string[];
  packageRoots: string[];
  remoteDependencies: BuildProvenance["dependencies"];
}

export interface DoofBuildManifest {
  schemaVersion: 2;
  entryPath: string;
  outputDir: string;
  outputBinaryName: string;
  buildTarget: ResolvedDoofBuildTarget | null;
  generatedHeaders: string[];
  generatedSources: string[];
  includePaths: string[];
  nativeSourceFiles: string[];
  libraryPaths: string[];
  linkLibraries: string[];
  frameworks: string[];
  pkgConfigPackages: string[];
  defines: string[];
  compilerFlags: string[];
  linkerFlags: string[];
  packageRoots: string[];
  remoteDependencies: BuildProvenance["dependencies"];
}

export type CompilerToolchainKind = "gcc-like" | "msvc";

export interface CompilerToolchain {
  kind: CompilerToolchainKind;
  command: string;
  env?: NodeJS.ProcessEnv;
}

export interface CompilerDetectionHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists(filePath: string): boolean;
  execFile(command: string, args: string[], options?: ExecFileSyncOptions): Buffer;
}

export type CompileMode = "build" | "syntax-only";

export interface BuildCompileArgsOptions {
  toolchain?: CompilerToolchain;
  outputBinaryName?: string;
  mode?: CompileMode;
  extraIncludePaths?: string[];
  platform?: NodeJS.Platform;
}

export interface CompileCommandStep {
  command: string;
  args: string[];
}

export interface CompileCommandPlan {
  outBinary: string;
  commands: CompileCommandStep[];
}

interface BuildCompileInputs {
  outBinary: string;
  absOutDir: string;
  moduleCppFiles: string[];
  includePaths: string[];
  effectiveNativeBuild: NativeBuildOptions;
}

interface WindowsEnvScript {
  filePath: string;
  args: string[];
}

interface NativeCopyPlan {
  outputCopies: ProjectEmitResult["outputNativeCopies"];
  includePaths: string[];
  sourceFiles: string[];
  libraryPaths: string[];
  passthroughNativeBuild: ResolvedPackageNativeBuild;
}

interface ManagedOutputNativeFile {
  sourcePath: string;
  relativePath: string;
}

interface ManagedNativeCopyManifest {
  files: string[];
}

const DEFAULT_GCC_TOOLCHAIN: CompilerToolchain = { kind: "gcc-like", command: "c++" };
const VSWHERE_COMPONENT = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64";
const GCC_LIKE_COMPILERS = ["clang++", "g++", "c++"] as const;
const VISUAL_STUDIO_VERSION_NAMES = ["18", "17", "16", "15", "Preview", "Current"];
const VISUAL_STUDIO_EDITIONS = ["Community", "Professional", "Enterprise", "BuildTools"];

function defaultCompilerDetectionHost(): CompilerDetectionHost {
  return {
    platform: process.platform,
    env: process.env,
    fileExists(filePath: string) {
      return fs.existsSync(filePath);
    },
    execFile(command: string, args: string[], options?: ExecFileSyncOptions) {
      const result = execFileSync(command, args, { stdio: "pipe", timeout: 5000, ...options });
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
    },
  };
}

export function getDefaultOutputBinaryName(platform = process.platform): string {
  return platform === "win32" ? "a.exe" : "a.out";
}

export function normalizeOutputBinaryName(outputBinaryName: string, platform = process.platform): string {
  if (platform !== "win32") {
    return outputBinaryName;
  }

  return path.win32.extname(outputBinaryName) ? outputBinaryName : `${outputBinaryName}.exe`;
}

function getResolvedOutputBinaryName(outputBinaryName: string | undefined, platform = process.platform): string {
  return normalizeOutputBinaryName(outputBinaryName ?? getDefaultOutputBinaryName(platform), platform);
}

export function findCompilerToolchain(): CompilerToolchain {
  return resolveCompilerToolchain(null);
}

export function findCompiler(): string {
  return findCompilerToolchain().command;
}

export function tryFindCompiler(): string | null {
  return tryFindCompilerToolchain()?.command ?? null;
}

export function tryFindCompilerToolchain(host: CompilerDetectionHost = defaultCompilerDetectionHost()): CompilerToolchain | null {
  const explicitCompiler = host.env.CXX?.trim();
  if (explicitCompiler) {
    return tryResolveCompilerToolchain(explicitCompiler, host);
  }

  if (host.platform === "win32") {
    const msvcToolchain = tryResolveMsvcToolchain("cl.exe", host);
    if (msvcToolchain) {
      return msvcToolchain;
    }
  }

  for (const compiler of GCC_LIKE_COMPILERS) {
    const toolchain = tryResolveGccLikeToolchain(compiler, host);
    if (toolchain) {
      return toolchain;
    }
  }

  return null;
}

export function resolveCompilerToolchain(
  compiler: string | null | undefined,
  host: CompilerDetectionHost = defaultCompilerDetectionHost(),
): CompilerToolchain {
  if (compiler) {
    const explicitToolchain = tryResolveCompilerToolchain(compiler, host);
    if (explicitToolchain) {
      return explicitToolchain;
    }

    throw new Error(`Unable to use C++ compiler: ${compiler}`);
  }

  const autoDetected = tryFindCompilerToolchain(host);
  if (autoDetected) {
    return autoDetected;
  }

  if (host.platform === "win32") {
    throw new Error("No C++ compiler found. Install Visual Studio with MSVC tools, or use --compiler <path>");
  }

  throw new Error("No C++ compiler found. Install clang++ or g++, or use --compiler <path>");
}

export function runPipelineWithFs(
  fileSystem: FileSystem,
  entryPath: string,
  verbose: boolean,
  nativeBuild: NativeBuildOptions,
  log: (msg: string) => void,
  onDiagnostic: (diagnostic: DiagnosticLike) => void,
): PipelineResult {
  const normalizedEntryPath = resolveFsPath(entryPath);
  const pipelineFileSystem = withBundledStdlib(fileSystem);
  if (!pipelineFileSystem.fileExists(normalizedEntryPath)) {
    throw new Error(`File not found: ${normalizedEntryPath}`);
  }

  const packageGraph = loadPackageGraph(fileSystem, normalizedEntryPath, {
    implicitStdDependencies: fileSystem instanceof RealFS,
  });
  const resolver = createBundledModuleResolver(fileSystem, {
    packages: packageGraph.packages.map((pkg) => ({
      rootDir: pkg.rootDir,
      dependencies: pkg.dependencyRoots,
    })),
  });
  const analyzer = new ModuleAnalyzer(pipelineFileSystem, resolver);

  if (verbose) log("Analyzing modules...");
  const analysisResult = analyzer.analyzeModule(normalizedEntryPath);

  let warningCount = 0;
  for (const diagnostic of analysisResult.diagnostics) {
    onDiagnostic(diagnostic);
    if (diagnostic.severity === "warning") warningCount++;
  }

  const analyzerErrors = analysisResult.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (analyzerErrors.length > 0) {
    throw new Error(`Analysis failed with ${pluralize(analyzerErrors.length, "error")}`);
  }
  if (verbose) log(`  ${analysisResult.modules.size} module(s) analyzed`);

  const buildPackageGraph = narrowPackageGraphForBuild(packageGraph, analysisResult.modules.keys());
  const mergedPackageNativeBuild = mergePackageNativeBuild(buildPackageGraph);
  const packageOutputPaths = createPackageOutputPaths(buildPackageGraph, normalizedEntryPath);
  const nativeCopyPlan = fileSystem instanceof RealFS
    ? createNativeCopyPlan(buildPackageGraph, packageOutputPaths)
    : null;
  const resolvedNativeBuild = mergeResolvedNativeBuildOptions(
    nativeCopyPlan?.passthroughNativeBuild ?? mergedPackageNativeBuild,
    nativeBuild,
  );
  const hostResolvedNativeBuild = resolvePkgConfigNativeBuild(resolvedNativeBuild);

  if (verbose) log("Type checking...");
  const checker = new TypeChecker(analysisResult);
  let errorCount = 0;
  for (const [modulePath] of analysisResult.modules) {
    const info = checker.checkModule(modulePath);
    for (const diagnostic of info.diagnostics) {
      onDiagnostic(diagnostic);
      if (diagnostic.severity === "warning") warningCount++;
    }
    errorCount += info.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  }
  if (errorCount > 0) {
    throw new Error(`Type checking failed with ${pluralize(errorCount, "error")}`);
  }
  if (verbose) log("  No type errors");

  const outputBinaryName = getResolvedOutputBinaryName(packageGraph.rootPackage.manifest.build?.targetExecutableName);
  const buildTarget = packageGraph.rootPackage.buildTarget;

  if (verbose) log("Emitting C++...");
  const emittedProject = emitProject(normalizedEntryPath, analysisResult, {
    outputBinaryName,
    buildTarget,
    packageOutputPaths,
  });
  const project: ProjectEmitResult = nativeCopyPlan
    ? {
      ...emittedProject,
      outputNativeCopies: nativeCopyPlan.outputCopies,
      outputNativeIncludePaths: nativeCopyPlan.includePaths,
      outputNativeSourceFiles: nativeCopyPlan.sourceFiles,
      outputNativeLibraryPaths: nativeCopyPlan.libraryPaths,
    }
    : emittedProject;
  if (verbose) log(`  ${project.modules.length} module(s) emitted`);

  const provenance = createBuildProvenance(buildPackageGraph);

  return {
    project,
    nativeBuild: hostResolvedNativeBuild,
    warningCount,
    outputBinaryName,
    provenance,
    buildTarget,
    buildManifest: createBuildManifestTemplate(
      normalizedEntryPath,
      outputBinaryName,
      buildTarget,
      project,
      hostResolvedNativeBuild,
      buildPackageGraph.packages.map((pkg) => pkg.rootDir),
      provenance,
    ),
  };
}

export function writeProject(
  project: ProjectEmitResult,
  outDir: string,
  verbose: boolean,
  log: (msg: string) => void,
  provenance?: BuildProvenance,
  buildManifest?: BuildManifestTemplate,
): void {
  fs.mkdirSync(outDir, { recursive: true });

  writeFile(path.join(outDir, "doof_runtime.hpp"), project.runtime, verbose, log);

  for (const mod of project.modules) {
    writeFile(path.join(outDir, mod.hppPath), mod.hppCode, verbose, log);
    writeFile(path.join(outDir, mod.cppPath), mod.cppCode, verbose, log);
  }

  for (const supportFile of project.supportFiles) {
    writeFile(path.join(outDir, supportFile.relativePath), supportFile.content, verbose, log);
    if (supportFile.executable) {
      fs.chmodSync(path.join(outDir, supportFile.relativePath), 0o755);
    }
  }

  syncOutputNativeFiles(outDir, project, verbose, log);

  if (provenance) {
    writeFile(path.join(outDir, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n", verbose, log);
  }
  if (buildManifest) {
    const finalBuildManifest = finalizeBuildManifest(buildManifest, outDir);
    writeFile(path.join(outDir, "doof-build.json"), JSON.stringify(finalBuildManifest, null, 2) + "\n", verbose, log);
  }
}

export function buildCompileArgs(
  outDir: string,
  project: ProjectEmitResult,
  nativeBuild: NativeBuildOptions,
  options: BuildCompileArgsOptions = {},
): { outBinary: string; args: string[] } {
  const toolchain = options.toolchain ?? DEFAULT_GCC_TOOLCHAIN;
  const mode = options.mode ?? "build";
  const inputs = resolveBuildCompileInputs(outDir, project, nativeBuild, options);

  const args = toolchain.kind === "msvc"
    ? buildMsvcCompileArgs(inputs.outBinary, inputs.moduleCppFiles, inputs.includePaths, inputs.effectiveNativeBuild, mode)
    : buildGccLikeCompileArgs(inputs.outBinary, inputs.moduleCppFiles, inputs.includePaths, inputs.effectiveNativeBuild, mode);

  return { outBinary: inputs.outBinary, args };
}

export function buildCompilePlan(
  outDir: string,
  project: ProjectEmitResult,
  nativeBuild: NativeBuildOptions,
  options: BuildCompileArgsOptions = {},
): CompileCommandPlan {
  const toolchain = options.toolchain ?? DEFAULT_GCC_TOOLCHAIN;
  const mode = options.mode ?? "build";
  const platform = options.platform ?? process.platform;
  const inputs = resolveBuildCompileInputs(outDir, project, nativeBuild, options);

  if (toolchain.kind !== "gcc-like") {
    return {
      outBinary: inputs.outBinary,
      commands: [{
        command: toolchain.command,
        args: buildMsvcCompileArgs(
          inputs.outBinary,
          inputs.moduleCppFiles,
          inputs.includePaths,
          inputs.effectiveNativeBuild,
          mode,
        ),
      }],
    };
  }

  const cSourceFiles = inputs.effectiveNativeBuild.sourceFiles.filter(isNativeCSource);
  const otherSourceFiles = inputs.effectiveNativeBuild.sourceFiles.filter((sourceFile) => !isNativeCSource(sourceFile));
  const generatedObjectFiles: string[] = [];
  const commands: CompileCommandStep[] = [];

  if (mode === "build") {
    const cCompiler = deriveGccLikeCCompilerCommand(toolchain.command);
    cSourceFiles.forEach((sourceFile, index) => {
      const objectFile = buildNativeObjectFilePath(inputs.absOutDir, sourceFile, index, platform);
      fs.mkdirSync(path.dirname(objectFile), { recursive: true });
      generatedObjectFiles.push(objectFile);
      commands.push({
        command: cCompiler,
        args: buildGccLikeCCompileArgs(objectFile, sourceFile, inputs.includePaths, inputs.effectiveNativeBuild),
      });
    });
  }

  if (mode === "syntax-only") {
    const cCompiler = deriveGccLikeCCompilerCommand(toolchain.command);
    cSourceFiles.forEach((sourceFile) => {
      commands.push({
        command: cCompiler,
        args: buildGccLikeCSyntaxArgs(sourceFile, inputs.includePaths, inputs.effectiveNativeBuild),
      });
    });
  }

  const finalNativeBuild: NativeBuildOptions = {
    ...inputs.effectiveNativeBuild,
    sourceFiles: otherSourceFiles,
    objectFiles: [...inputs.effectiveNativeBuild.objectFiles, ...generatedObjectFiles],
  };

  commands.push({
    command: toolchain.command,
    args: buildGccLikeCompileArgs(
      inputs.outBinary,
      inputs.moduleCppFiles,
      inputs.includePaths,
      finalNativeBuild,
      mode,
    ),
  });

  return {
    outBinary: inputs.outBinary,
    commands,
  };
}

export function compileCpp(
  outDir: string,
  project: ProjectEmitResult,
  toolchain: CompilerToolchain,
  nativeBuild: NativeBuildOptions,
  verbose: boolean,
  log: (msg: string) => void,
  outputBinaryName = getDefaultOutputBinaryName(),
): string {
  const plan = buildCompilePlan(outDir, project, nativeBuild, {
    toolchain,
    outputBinaryName,
  });
  for (const step of plan.commands) {
    if (verbose) log(`Compiling: ${[step.command, ...step.args].map(formatShellArg).join(" ")}`);
    try {
      execFileSync(step.command, step.args, {
        stdio: "pipe",
        timeout: 30000,
        env: toolchain.env ?? process.env,
      });
    } catch (e: any) {
      throw new Error(formatProcessFailure("Compilation failed", e));
    }
  }

  if (verbose) log(`  binary: ${plan.outBinary}`);
  return plan.outBinary;
}

function resolveBuildCompileInputs(
  outDir: string,
  project: ProjectEmitResult,
  nativeBuild: NativeBuildOptions,
  options: BuildCompileArgsOptions,
): BuildCompileInputs {
  const platform = options.platform ?? process.platform;
  const absOutDir = platform === "win32" ? path.resolve(outDir) : resolveFsPath(outDir);
  const outBinary = platform === "win32"
    ? path.win32.join(absOutDir, getResolvedOutputBinaryName(options.outputBinaryName, platform))
    : joinFsPath(absOutDir, getResolvedOutputBinaryName(options.outputBinaryName, platform));
  const moduleCppFiles = project.modules.map((mod) => platform === "win32"
    ? path.win32.join(absOutDir, mod.cppPath)
    : joinFsPath(absOutDir, mod.cppPath));
  const outputNativeIncludePaths = project.outputNativeIncludePaths.map((relativePath) =>
    resolveOutputRelativePath(absOutDir, relativePath, platform)
  );
  const outputNativeSourceFiles = project.outputNativeSourceFiles.map((relativePath) =>
    resolveOutputRelativePath(absOutDir, relativePath, platform)
  );
  const outputNativeLibraryPaths = project.outputNativeLibraryPaths.map((relativePath) =>
    resolveOutputRelativePath(absOutDir, relativePath, platform)
  );
  const includePaths = uniqueStrings([
    absOutDir,
    ...(options.extraIncludePaths ?? []),
    ...outputNativeIncludePaths,
    ...nativeBuild.includePaths,
  ]);
  const effectiveNativeBuild: NativeBuildOptions = {
    ...nativeBuild,
    sourceFiles: uniqueStrings([...outputNativeSourceFiles, ...nativeBuild.sourceFiles]),
    libraryPaths: uniqueStrings([...outputNativeLibraryPaths, ...nativeBuild.libraryPaths]),
  };

  return {
    outBinary,
    absOutDir,
    moduleCppFiles,
    includePaths,
    effectiveNativeBuild,
  };
}

export function resolveNativeBuildOptions(nativeBuild: NativeBuildOptions): NativeBuildOptions {
  return {
    ...nativeBuild,
    includePaths: nativeBuild.includePaths.map((includePath) => path.resolve(includePath)),
    libraryPaths: nativeBuild.libraryPaths.map((libraryPath) => path.resolve(libraryPath)),
    pkgConfigPackages: [...nativeBuild.pkgConfigPackages],
    sourceFiles: nativeBuild.sourceFiles.map((sourceFile) => path.resolve(sourceFile)),
    objectFiles: nativeBuild.objectFiles.map((objectFile) => path.resolve(objectFile)),
  };
}

export function resolvePkgConfigNativeBuild(
  nativeBuild: NativeBuildOptions,
  host: CompilerDetectionHost = defaultCompilerDetectionHost(),
): NativeBuildOptions {
  if (nativeBuild.pkgConfigPackages.length === 0) {
    return nativeBuild;
  }

  const resolved: NativeBuildOptions = {
    ...nativeBuild,
    includePaths: [...nativeBuild.includePaths],
    libraryPaths: [...nativeBuild.libraryPaths],
    linkLibraries: [...nativeBuild.linkLibraries],
    frameworks: [...nativeBuild.frameworks],
    pkgConfigPackages: [...nativeBuild.pkgConfigPackages],
    sourceFiles: [...nativeBuild.sourceFiles],
    objectFiles: [...nativeBuild.objectFiles],
    compilerFlags: [...nativeBuild.compilerFlags],
    linkerFlags: [...nativeBuild.linkerFlags],
    defines: [...nativeBuild.defines],
  };

  for (const packageName of nativeBuild.pkgConfigPackages) {
    applyPkgConfigTokens(execPkgConfig(host, ["--cflags", packageName], packageName), resolved, "cflags");
    applyPkgConfigTokens(execPkgConfig(host, ["--libs", packageName], packageName), resolved, "libs");
  }

  return {
    ...resolved,
    includePaths: uniqueStrings(resolved.includePaths),
    libraryPaths: uniqueStrings(resolved.libraryPaths),
    linkLibraries: uniqueStrings(resolved.linkLibraries),
    frameworks: uniqueStrings(resolved.frameworks),
    compilerFlags: uniqueStrings(resolved.compilerFlags),
    linkerFlags: uniqueStrings(resolved.linkerFlags),
    defines: uniqueStrings(resolved.defines),
  };
}

function createBuildManifestTemplate(
  entryPath: string,
  outputBinaryName: string,
  buildTarget: ResolvedDoofBuildTarget | null,
  project: ProjectEmitResult,
  nativeBuild: NativeBuildOptions,
  packageRoots: string[],
  provenance: BuildProvenance,
): BuildManifestTemplate {
  return {
    schemaVersion: 2,
    entryPath,
    outputBinaryName,
    buildTarget,
    generatedHeaders: project.modules.map((mod) => mod.hppPath).sort(),
    generatedSources: project.modules.map((mod) => mod.cppPath).sort(),
    outputNativeIncludePaths: [...project.outputNativeIncludePaths],
    outputNativeSourceFiles: [...project.outputNativeSourceFiles],
    outputNativeLibraryPaths: [...project.outputNativeLibraryPaths],
    nativeIncludePaths: [...nativeBuild.includePaths],
    nativeSourceFiles: [...nativeBuild.sourceFiles],
    libraryPaths: [...nativeBuild.libraryPaths],
    linkLibraries: [...nativeBuild.linkLibraries],
    frameworks: [...nativeBuild.frameworks],
    pkgConfigPackages: [...nativeBuild.pkgConfigPackages],
    defines: [...nativeBuild.defines],
    compilerFlags: [...nativeBuild.compilerFlags],
    linkerFlags: [...nativeBuild.linkerFlags],
    packageRoots: [...packageRoots],
    remoteDependencies: provenance.dependencies,
  };
}

function finalizeBuildManifest(template: BuildManifestTemplate, outDir: string): DoofBuildManifest {
  const absOutDir = path.resolve(outDir);

  return {
    schemaVersion: template.schemaVersion,
    entryPath: template.entryPath,
    outputDir: absOutDir,
    outputBinaryName: template.outputBinaryName,
    buildTarget: template.buildTarget,
    generatedHeaders: [...template.generatedHeaders],
    generatedSources: [...template.generatedSources],
    includePaths: uniqueStrings([
      absOutDir,
      ...template.outputNativeIncludePaths.map((relativePath) => path.join(absOutDir, relativePath)),
      ...template.nativeIncludePaths,
    ]),
    nativeSourceFiles: uniqueStrings([
      ...template.outputNativeSourceFiles.map((relativePath) => path.join(absOutDir, relativePath)),
      ...template.nativeSourceFiles,
    ]),
    libraryPaths: uniqueStrings([
      ...template.outputNativeLibraryPaths.map((relativePath) => path.join(absOutDir, relativePath)),
      ...template.libraryPaths,
    ]),
    linkLibraries: [...template.linkLibraries],
    frameworks: [...template.frameworks],
    pkgConfigPackages: [...template.pkgConfigPackages],
    defines: [...template.defines],
    compilerFlags: [...template.compilerFlags],
    linkerFlags: [...template.linkerFlags],
    packageRoots: [...template.packageRoots],
    remoteDependencies: template.remoteDependencies,
  };
}

function mergeResolvedNativeBuildOptions(
  packageNativeBuild: ResolvedPackageNativeBuild,
  nativeBuild: NativeBuildOptions,
): NativeBuildOptions {
  return {
    cppStd: nativeBuild.cppStd,
    includePaths: uniqueStrings([...packageNativeBuild.includePaths, ...nativeBuild.includePaths]),
    libraryPaths: uniqueStrings([...packageNativeBuild.libraryPaths, ...nativeBuild.libraryPaths]),
    linkLibraries: uniqueStrings([...packageNativeBuild.linkLibraries, ...nativeBuild.linkLibraries]),
    frameworks: uniqueStrings([...packageNativeBuild.frameworks, ...nativeBuild.frameworks]),
    pkgConfigPackages: uniqueStrings([...packageNativeBuild.pkgConfigPackages, ...nativeBuild.pkgConfigPackages]),
    sourceFiles: uniqueStrings([...packageNativeBuild.sourceFiles, ...nativeBuild.sourceFiles]),
    objectFiles: [...nativeBuild.objectFiles],
    compilerFlags: uniqueStrings([...packageNativeBuild.compilerFlags, ...nativeBuild.compilerFlags]),
    linkerFlags: uniqueStrings([...packageNativeBuild.linkerFlags, ...nativeBuild.linkerFlags]),
    defines: uniqueStrings([...packageNativeBuild.defines, ...nativeBuild.defines]),
  };
}

function createNativeCopyPlan(graph: PackageGraph, packageOutputPaths: PackageOutputPaths): NativeCopyPlan {
  const outputCopies: ProjectEmitResult["outputNativeCopies"] = [];
  const copiedIncludePaths: string[] = [];
  const copiedSourceFiles: string[] = [];
  const copiedLibraryPaths: string[] = [];
  const destinationSources = new Map<string, string>();
  const passthroughNativeBuild = createEmptyResolvedPackageNativeBuild();

  for (const pkg of graph.packages) {
    const packageOutputRoot = packageOutputPaths.byRootDir.get(pkg.rootDir) ?? "";
    const packageCopyRoots: ProjectEmitResult["outputNativeCopies"] = [];

    const addCopyRoot = (sourcePath: string, kind: "file" | "directory" | "auto"): string => {
      const relativeWithinPackage = toPortablePath(relativeFsPath(pkg.rootDir, sourcePath));
      const relativePath = joinOutputRelativePath(packageOutputRoot, relativeWithinPackage);
      const existingSource = destinationSources.get(relativePath);
      if (existingSource && existingSource !== sourcePath) {
        throw new Error(
          `Native package copy collision for ${relativePath}: ${existingSource} conflicts with ${sourcePath}`,
        );
      }
      destinationSources.set(relativePath, sourcePath);

      if (!packageCopyRoots.some((entry) => entry.sourcePath === sourcePath && entry.relativePath === relativePath)) {
        packageCopyRoots.push({ sourcePath, relativePath, kind });
      }

      return relativePath;
    };

    for (const includePath of pkg.nativeBuild.includePaths) {
      copiedIncludePaths.push(addCopyRoot(includePath, "directory"));
    }

    for (const sourceFile of pkg.nativeBuild.sourceFiles) {
      copiedSourceFiles.push(addCopyRoot(sourceFile, "file"));
    }

    for (const extraCopyPath of pkg.nativeBuild.extraCopyPaths) {
      addCopyRoot(extraCopyPath, "auto");
    }

    outputCopies.push(...packageCopyRoots);

    for (const libraryPath of pkg.nativeBuild.libraryPaths) {
      const copiedLibraryPath = rewriteOutputNativePath(libraryPath, packageCopyRoots);
      if (copiedLibraryPath) {
        copiedLibraryPaths.push(copiedLibraryPath);
      } else {
        passthroughNativeBuild.libraryPaths.push(libraryPath);
      }
    }

    appendUnique(passthroughNativeBuild.linkLibraries, pkg.nativeBuild.linkLibraries);
    appendUnique(passthroughNativeBuild.frameworks, pkg.nativeBuild.frameworks);
    appendUnique(passthroughNativeBuild.pkgConfigPackages, pkg.nativeBuild.pkgConfigPackages);
    appendUnique(passthroughNativeBuild.defines, pkg.nativeBuild.defines);
    appendUnique(passthroughNativeBuild.compilerFlags, pkg.nativeBuild.compilerFlags);
    appendUnique(passthroughNativeBuild.linkerFlags, pkg.nativeBuild.linkerFlags);
  }

  return {
    outputCopies,
    includePaths: uniqueStrings(copiedIncludePaths),
    sourceFiles: uniqueStrings(copiedSourceFiles),
    libraryPaths: uniqueStrings(copiedLibraryPaths),
    passthroughNativeBuild,
  };
}

function createEmptyResolvedPackageNativeBuild(): ResolvedPackageNativeBuild {
  return {
    includePaths: [],
    sourceFiles: [],
    libraryPaths: [],
    extraCopyPaths: [],
    linkLibraries: [],
    frameworks: [],
    pkgConfigPackages: [],
    defines: [],
    compilerFlags: [],
    linkerFlags: [],
  };
}

function getOutputRelativePath(baseDir: string, targetPath: string): string {
  return anchorOutputRelativePath(toPortablePath(relativeFsPath(baseDir, targetPath)));
}

function anchorOutputRelativePath(relativePath: string): string {
  const parts = relativePath.split("/");
  while (parts.length > 0 && parts[0] === "..") {
    parts.shift();
  }
  return parts.join("/");
}

function joinOutputRelativePath(basePath: string, childPath: string): string {
  if (!basePath) {
    return childPath;
  }
  if (!childPath) {
    return basePath;
  }
  return `${basePath}/${childPath}`;
}

function rewriteOutputNativePath(
  sourcePath: string,
  outputCopies: ReadonlyArray<ProjectEmitResult["outputNativeCopies"][number]>,
): string | null {
  for (const entry of outputCopies) {
    if (entry.sourcePath === sourcePath) {
      return entry.relativePath;
    }
    if (entry.kind === "file" || !isWithinFsRoot(sourcePath, entry.sourcePath)) {
      continue;
    }

    const suffix = toPortablePath(relativeFsPath(entry.sourcePath, sourcePath));
    return joinOutputRelativePath(entry.relativePath, suffix);
  }

  return null;
}

function resolveOutputRelativePath(outDir: string, relativePath: string, platform: NodeJS.Platform): string {
  if (!relativePath) {
    return outDir;
  }
  return platform === "win32" ? path.win32.join(outDir, relativePath) : joinFsPath(outDir, relativePath);
}

function syncOutputNativeFiles(
  outDir: string,
  project: ProjectEmitResult,
  verbose: boolean,
  log: (msg: string) => void,
): void {
  const outputNativeFiles = project.outputNativeCopies.length > 0
    ? expandOutputNativeCopies(project.outputNativeCopies)
    : [];
  const reservedPaths = new Set<string>([
    "doof_runtime.hpp",
    "doof-build.json",
    "provenance.json",
    ...project.modules.flatMap((mod) => [mod.hppPath, mod.cppPath]),
    ...project.supportFiles.map((file) => file.relativePath),
  ]);

  for (const outputNativeFile of outputNativeFiles) {
    if (reservedPaths.has(outputNativeFile.relativePath)) {
      throw new Error(`Native package copy would overwrite generated output: ${outputNativeFile.relativePath}`);
    }
  }

  removeStaleOutputNativeFiles(outDir, outputNativeFiles.map((file) => file.relativePath));

  for (const outputNativeFile of outputNativeFiles) {
    const destinationPath = path.join(outDir, outputNativeFile.relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(outputNativeFile.sourcePath, destinationPath);
    const mode = fs.statSync(outputNativeFile.sourcePath).mode & 0o777;
    if ((mode & 0o111) !== 0) {
      fs.chmodSync(destinationPath, mode);
    }
    if (verbose) {
      log(`  copied: ${outputNativeFile.relativePath}`);
    }
  }

  writeManagedNativeCopyManifest(outDir, outputNativeFiles.map((file) => file.relativePath));
}

function expandOutputNativeCopies(
  outputCopies: ReadonlyArray<ProjectEmitResult["outputNativeCopies"][number]>,
): ManagedOutputNativeFile[] {
  const expanded = new Map<string, string>();

  for (const entry of outputCopies) {
    const sourceStat = fs.statSync(entry.sourcePath);
    const kind = entry.kind === "auto"
      ? (sourceStat.isDirectory() ? "directory" : "file")
      : entry.kind;

    if (kind === "file") {
      const existing = expanded.get(entry.relativePath);
      if (existing && existing !== entry.sourcePath) {
        throw new Error(`Native package copy collision for ${entry.relativePath}`);
      }
      expanded.set(entry.relativePath, entry.sourcePath);
      continue;
    }

    for (const childPath of listFilesRecursive(entry.sourcePath)) {
      const childRelativePath = toPortablePath(relativeFsPath(entry.sourcePath, childPath));
      const destinationRelativePath = joinOutputRelativePath(entry.relativePath, childRelativePath);
      const existing = expanded.get(destinationRelativePath);
      if (existing && existing !== childPath) {
        throw new Error(`Native package copy collision for ${destinationRelativePath}`);
      }
      expanded.set(destinationRelativePath, childPath);
    }
  }

  return [...expanded.entries()]
    .map(([relativePath, sourcePath]) => ({ relativePath, sourcePath }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function listFilesRecursive(rootPath: string): string[] {
  const rootStat = fs.statSync(rootPath);
  if (!rootStat.isDirectory()) {
    return [rootPath];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const childPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(childPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(childPath);
    }
  }
  return files;
}

function removeStaleOutputNativeFiles(outDir: string, nextFiles: readonly string[]): void {
  const previousFiles = readManagedNativeCopyManifest(outDir).files;
  const nextFileSet = new Set(nextFiles);

  for (const relativePath of previousFiles) {
    if (!nextFileSet.has(relativePath)) {
      fs.rmSync(path.join(outDir, relativePath), { force: true });
    }
  }
}

function readManagedNativeCopyManifest(outDir: string): ManagedNativeCopyManifest {
  const manifestPath = path.join(outDir, ".doof-native-copy-manifest.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManagedNativeCopyManifest;
    return { files: [...(parsed.files ?? [])] };
  } catch {
    return { files: [] };
  }
}

function writeManagedNativeCopyManifest(outDir: string, files: readonly string[]): void {
  const manifestPath = path.join(outDir, ".doof-native-copy-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ files: [...files].sort() }, null, 2) + "\n", "utf8");
}

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function execPkgConfig(host: CompilerDetectionHost, args: string[], packageName: string): string[] {
  try {
    const output = host.execFile("pkg-config", args, { timeout: 5000, env: host.env }).toString().trim();
    return output.length === 0 ? [] : output.split(/\s+/);
  } catch (error: any) {
    throw new Error(
      `Failed to resolve pkg-config package ${JSON.stringify(packageName)}. Install pkg-config and the package metadata, or remove it from build.native.pkgConfigPackages.\n${formatProcessFailure("pkg-config failed", error)}`,
    );
  }
}

function applyPkgConfigTokens(
  tokens: string[],
  nativeBuild: NativeBuildOptions,
  mode: "cflags" | "libs",
): void {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === "-framework") {
      const framework = tokens[index + 1];
      if (framework) {
        nativeBuild.frameworks.push(framework);
        index++;
      }
      continue;
    }

    if (token === "-I" || token === "-L" || token === "-D") {
      const value = tokens[index + 1];
      if (value) {
        if (token === "-I") nativeBuild.includePaths.push(value);
        if (token === "-L") nativeBuild.libraryPaths.push(value);
        if (token === "-D") nativeBuild.defines.push(value);
        index++;
      }
      continue;
    }

    if (token.startsWith("-I")) {
      nativeBuild.includePaths.push(token.slice(2));
      continue;
    }

    if (token.startsWith("-L")) {
      nativeBuild.libraryPaths.push(token.slice(2));
      continue;
    }

    if (token.startsWith("-l")) {
      nativeBuild.linkLibraries.push(token.slice(2));
      continue;
    }

    if (token.startsWith("-D")) {
      nativeBuild.defines.push(token.slice(2));
      continue;
    }

    if (mode === "cflags") {
      nativeBuild.compilerFlags.push(token);
    } else {
      nativeBuild.linkerFlags.push(token);
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatProcessFailure(prefix: string, error: any): string {
  const stdout = error?.stdout?.toString()?.trim();
  const stderr = error?.stderr?.toString()?.trim();
  const details = [stdout, stderr].filter((value): value is string => Boolean(value && value.length > 0));
  return details.length > 0
    ? `${prefix}:\n${details.join("\n")}`
    : `${prefix}:\n${error?.message ?? String(error)}`;
}

function tryResolveCompilerToolchain(compiler: string, host: CompilerDetectionHost): CompilerToolchain | null {
  return isMsvcCompilerCommand(compiler, host.platform)
    ? tryResolveMsvcToolchain(compiler, host)
    : tryResolveGccLikeToolchain(compiler, host);
}

function tryResolveGccLikeToolchain(compiler: string, host: CompilerDetectionHost): CompilerToolchain | null {
  try {
    host.execFile(compiler, ["--version"], { timeout: 5000 });
    return { kind: "gcc-like", command: compiler };
  } catch {
    return null;
  }
}

function tryResolveMsvcToolchain(compiler: string, host: CompilerDetectionHost): CompilerToolchain | null {
  if (canRunMsvcCompiler(compiler, host.env, host)) {
    return { kind: "msvc", command: compiler, env: host.env };
  }

  const installationPath = findVisualStudioInstallationPath(host);
  if (!installationPath) {
    return null;
  }

  const envScript = findVisualStudioEnvScript(installationPath, host.fileExists);
  if (!envScript) {
    return null;
  }

  const preparedEnv = loadWindowsBuildEnvironment(envScript, host);
  const resolvedCompiler = hasPathSeparators(compiler)
    ? compiler
    : findCommandInPath(compiler, getEnvValue(preparedEnv, "PATH"), host.fileExists);
  if (!resolvedCompiler || !canRunMsvcCompiler(resolvedCompiler, preparedEnv, host)) {
    return null;
  }

  return {
    kind: "msvc",
    command: resolvedCompiler,
    env: preparedEnv,
  };
}

function canRunMsvcCompiler(compiler: string, env: NodeJS.ProcessEnv, host: CompilerDetectionHost): boolean {
  try {
    host.execFile(compiler, ["/?"], { timeout: 5000, env });
    return true;
  } catch {
    return false;
  }
}

function isMsvcCompilerCommand(compiler: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") {
    return false;
  }

  const baseName = path.win32.basename(compiler).toLowerCase();
  return baseName === "cl" || baseName === "cl.exe";
}

function findVisualStudioInstallationPath(host: CompilerDetectionHost): string | null {
  for (const vswherePath of getVswhereCandidates(host.env, host.fileExists)) {
    try {
      const result = host.execFile(vswherePath, [
        "-latest",
        "-products",
        "*",
        "-requires",
        VSWHERE_COMPONENT,
        "-property",
        "installationPath",
      ], { timeout: 5000 });
      const installationPath = result.toString().trim().split(/\r?\n/)[0]?.trim();
      if (installationPath) {
        return installationPath;
      }
    } catch {
      continue;
    }
  }

  for (const candidate of getVisualStudioInstallationFallbacks(host.env, host.fileExists)) {
    return candidate;
  }

  return null;
}

function getVswhereCandidates(env: NodeJS.ProcessEnv, fileExists: (filePath: string) => boolean): string[] {
  const candidates: string[] = [];
  const programFilesX86 = env["ProgramFiles(x86)"] ?? env.ProgramFiles;
  if (programFilesX86) {
    const defaultPath = path.win32.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (fileExists(defaultPath)) {
      candidates.push(defaultPath);
    }
  }

  candidates.push("vswhere.exe");
  return uniqueStrings(candidates);
}

function getVisualStudioInstallationFallbacks(
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
): string[] {
  return getVisualStudioInstallationCandidates(env).filter((installationPath) =>
    hasVisualStudioBuildEnvironment(installationPath, fileExists));
}

function getVisualStudioInstallationCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = uniqueStrings([
    env.ProgramFiles ? path.win32.join(env.ProgramFiles, "Microsoft Visual Studio") : "",
    env["ProgramFiles(x86)"] ? path.win32.join(env["ProgramFiles(x86)"], "Microsoft Visual Studio") : "",
  ].filter(Boolean));

  const candidates: string[] = [];
  for (const root of roots) {
    for (const versionName of VISUAL_STUDIO_VERSION_NAMES) {
      for (const edition of VISUAL_STUDIO_EDITIONS) {
        candidates.push(path.win32.join(root, versionName, edition));
      }
    }
  }

  return uniqueStrings(candidates);
}

function findVisualStudioEnvScript(
  installationPath: string,
  fileExists: (filePath: string) => boolean,
): WindowsEnvScript | null {
  const candidates: WindowsEnvScript[] = [
    { filePath: path.win32.join(installationPath, "VC", "Auxiliary", "Build", "vcvars64.bat"), args: [] },
    { filePath: path.win32.join(installationPath, "VC", "Auxiliary", "Build", "vcvarsall.bat"), args: ["x64"] },
    { filePath: path.win32.join(installationPath, "Common7", "Tools", "VsDevCmd.bat"), args: [] },
  ];

  return candidates.find((candidate) => fileExists(candidate.filePath)) ?? null;
}

function hasVisualStudioBuildEnvironment(
  installationPath: string,
  fileExists: (filePath: string) => boolean,
): boolean {
  return fileExists(path.win32.join(installationPath, "VC", "Auxiliary", "Build", "vcvars64.bat"))
    || fileExists(path.win32.join(installationPath, "VC", "Auxiliary", "Build", "vcvarsall.bat"))
    || fileExists(path.win32.join(installationPath, "Common7", "Tools", "VsDevCmd.bat"));
}

function loadWindowsBuildEnvironment(script: WindowsEnvScript, host: CompilerDetectionHost): NodeJS.ProcessEnv {
  const output = host.execFile("cmd.exe", [
    "/d",
    "/c",
    "call",
    script.filePath,
    ...script.args,
    ">",
    "nul",
    "&&",
    "set",
  ], {
    timeout: 15000,
    env: host.env,
  }).toString();

  return parseEnvironmentBlock(output, host.env);
}

function parseEnvironmentBlock(output: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }

    const equalsIndex = rawLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = rawLine.slice(0, equalsIndex);
    const value = rawLine.slice(equalsIndex + 1);
    env[key] = value;
  }

  return env;
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const directValue = env[key];
  if (directValue !== undefined) {
    return directValue;
  }

  const normalizedKey = key.toLowerCase();
  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === normalizedKey);
  return actualKey ? env[actualKey] : undefined;
}

function findCommandInPath(
  command: string,
  pathValue: string | undefined,
  fileExists: (filePath: string) => boolean,
): string | null {
  if (!pathValue) {
    return null;
  }

  for (const segment of pathValue.split(";")) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      continue;
    }

    const candidate = path.win32.join(trimmedSegment, command);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function hasPathSeparators(value: string): boolean {
  return value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value);
}

function buildGccLikeCompileArgs(
  outBinary: string,
  moduleCppFiles: string[],
  includePaths: string[],
  nativeBuild: NativeBuildOptions,
  mode: CompileMode,
): string[] {
  const compileArgs = [
    `-std=${nativeBuild.cppStd}`,
    ...includePaths.map((includePath) => `-I${includePath}`),
    ...nativeBuild.defines.map((define) => `-D${define}`),
    ...nativeBuild.compilerFlags,
  ];

  const compileSources = buildGccLikeCompileSources(moduleCppFiles, nativeBuild.sourceFiles);
  if (mode === "syntax-only") {
    return [...compileArgs, "-fsyntax-only", ...compileSources];
  }

  return [
    ...compileArgs,
    "-o",
    outBinary,
    ...compileSources,
    ...nativeBuild.objectFiles,
    ...nativeBuild.libraryPaths.map((libraryPath) => `-L${libraryPath}`),
    ...nativeBuild.linkLibraries.map((library) => `-l${library}`),
    ...nativeBuild.frameworks.flatMap((framework) => ["-framework", framework]),
    ...nativeBuild.linkerFlags,
  ];
}

function buildGccLikeCompileSources(moduleCppFiles: string[], nativeSourceFiles: string[]): string[] {
  return [...moduleCppFiles, ...nativeSourceFiles];
}

function buildGccLikeCCompileArgs(
  objectFile: string,
  sourceFile: string,
  includePaths: string[],
  nativeBuild: NativeBuildOptions,
): string[] {
  return [
    ...includePaths.map((includePath) => `-I${includePath}`),
    ...nativeBuild.defines.map((define) => `-D${define}`),
    ...nativeBuild.compilerFlags,
    "-x",
    "c",
    "-c",
    sourceFile,
    "-o",
    objectFile,
  ];
}

function buildGccLikeCSyntaxArgs(
  sourceFile: string,
  includePaths: string[],
  nativeBuild: NativeBuildOptions,
): string[] {
  return [
    ...includePaths.map((includePath) => `-I${includePath}`),
    ...nativeBuild.defines.map((define) => `-D${define}`),
    ...nativeBuild.compilerFlags,
    "-x",
    "c",
    "-fsyntax-only",
    sourceFile,
  ];
}

function isNativeCSource(sourceFile: string): boolean {
  return path.extname(sourceFile).toLowerCase() === ".c";
}

function buildNativeObjectFilePath(
  outDir: string,
  sourceFile: string,
  index: number,
  platform: NodeJS.Platform,
): string {
  const objectExtension = platform === "win32" ? ".obj" : ".o";
  const objectRoot = platform === "win32"
    ? path.win32.join(outDir, ".doof-native-objects")
    : joinFsPath(outDir, ".doof-native-objects");
  const relativeSourcePath = getNativeObjectRelativeSourcePath(outDir, sourceFile, index, platform);

  return platform === "win32"
    ? path.win32.join(objectRoot, `${relativeSourcePath}${objectExtension}`)
    : joinFsPath(objectRoot, `${relativeSourcePath}${objectExtension}`);
}

function getNativeObjectRelativeSourcePath(
  outDir: string,
  sourceFile: string,
  index: number,
  platform: NodeJS.Platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path;
  const relativePath = pathApi.relative(outDir, sourceFile);
  if (relativePath.length > 0 && !relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath)) {
    return relativePath;
  }

  const safeBaseName = path.basename(sourceFile).replace(/[^A-Za-z0-9_.-]/g, "_");
  return platform === "win32"
    ? path.win32.join("external", `__doof_native_${index}_${safeBaseName}`)
    : joinFsPath("external", `__doof_native_${index}_${safeBaseName}`);
}

function deriveGccLikeCCompilerCommand(cppCompilerCommand: string): string {
  const dir = path.dirname(cppCompilerCommand);
  const baseName = path.basename(cppCompilerCommand);
  let cCompilerBaseName: string;

  if (baseName === "clang++") {
    cCompilerBaseName = "clang";
  } else if (baseName === "g++") {
    cCompilerBaseName = "gcc";
  } else if (baseName === "c++") {
    cCompilerBaseName = "cc";
  } else if (baseName.endsWith("++")) {
    cCompilerBaseName = baseName.slice(0, -2);
  } else {
    cCompilerBaseName = baseName;
  }

  return dir === "." ? cCompilerBaseName : path.join(dir, cCompilerBaseName);
}

function buildMsvcCompileArgs(
  outBinary: string,
  moduleCppFiles: string[],
  includePaths: string[],
  nativeBuild: NativeBuildOptions,
  mode: CompileMode,
): string[] {
  const compileArgs = [
    "/nologo",
    `/std:${toMsvcCppStandard(nativeBuild.cppStd)}`,
    "/EHsc",
    ...includePaths.map((includePath) => `/I${includePath}`),
    ...nativeBuild.defines.map((define) => `/D${define}`),
    ...nativeBuild.compilerFlags,
  ];

  const compileSources = [...moduleCppFiles, ...nativeBuild.sourceFiles];
  if (mode === "syntax-only") {
    return [...compileArgs, "/Zs", ...compileSources];
  }

  const linkArgs = [
    ...nativeBuild.libraryPaths.map((libraryPath) => `/LIBPATH:${libraryPath}`),
    ...nativeBuild.linkLibraries.map(normalizeMsvcLibraryName),
    ...nativeBuild.linkerFlags,
  ];

  return [
    ...compileArgs,
    `/Fe${outBinary}`,
    ...compileSources,
    ...nativeBuild.objectFiles,
    ...(linkArgs.length > 0 ? ["/link", ...linkArgs] : []),
  ];
}

function toMsvcCppStandard(cppStd: string): string {
  switch (cppStd) {
    case "gnu++14":
      return "c++14";
    case "gnu++17":
      return "c++17";
    case "gnu++20":
      return "c++20";
    case "gnu++23":
    case "c++23":
      return "c++latest";
    default:
      return cppStd;
  }
}

function normalizeMsvcLibraryName(library: string): string {
  return library.toLowerCase().endsWith(".lib") ? library : `${library}.lib`;
}

export function formatDiagnostic(diagnostic: DiagnosticLike): string {
  const location = diagnostic.span
    ? `${diagnostic.module ?? "<unknown>"}:${diagnostic.span.start.line + 1}:${diagnostic.span.start.column + 1}`
    : diagnostic.module ?? "<unknown>";
  const prefix = diagnostic.severity === "error" ? "error" : "warning";
  return `${location}: ${prefix}: ${diagnostic.message}`;
}

export function printDiagnostic(diagnostic: DiagnosticLike): void {
  console.error(formatDiagnostic(diagnostic));
}

export function formatShellArg(value: string): string {
  return /[^A-Za-z0-9_./:=+-]/.test(value)
    ? JSON.stringify(value)
    : value;
}

function writeFile(filePath: string, content: string, verbose: boolean, log: (msg: string) => void): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (verbose) log(`  wrote ${filePath}`);
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}