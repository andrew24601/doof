import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import { emitProject, type NativeBuildOptions, type ProjectEmitResult } from "./emitter-module.js";
import type { FileSystem } from "./resolver.js";
import {
  createBuildProvenance,
  loadPackageGraph,
  type BuildProvenance,
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
  warningCount: number;
  outputBinaryName: string;
  provenance: BuildProvenance;
  buildManifest: BuildManifestTemplate;
}

interface BuildManifestTemplate {
  schemaVersion: 1;
  entryPath: string;
  outputBinaryName: string;
  generatedHeaders: string[];
  generatedSources: string[];
  nativeIncludePaths: string[];
  nativeSourceFiles: string[];
  libraryPaths: string[];
  linkLibraries: string[];
  frameworks: string[];
  defines: string[];
  compilerFlags: string[];
  linkerFlags: string[];
  packageRoots: string[];
  remoteDependencies: BuildProvenance["dependencies"];
}

export interface DoofBuildManifest {
  schemaVersion: 1;
  entryPath: string;
  outputDir: string;
  outputBinaryName: string;
  generatedHeaders: string[];
  generatedSources: string[];
  includePaths: string[];
  nativeSourceFiles: string[];
  libraryPaths: string[];
  linkLibraries: string[];
  frameworks: string[];
  defines: string[];
  compilerFlags: string[];
  linkerFlags: string[];
  packageRoots: string[];
  remoteDependencies: BuildProvenance["dependencies"];
}

export function findCompiler(): string {
  for (const cc of ["clang++", "g++"]) {
    try {
      execSync(`which ${cc}`, { stdio: "pipe" });
      return cc;
    } catch {
      continue;
    }
  }

  throw new Error("No C++ compiler found. Install clang++ or g++, or use --compiler <path>");
}

export function findNlohmannInclude(): string | null {
  try {
    const prefix = execSync("brew --prefix nlohmann-json 2>/dev/null", { stdio: "pipe" }).toString().trim();
    if (prefix && fs.existsSync(path.join(prefix, "include", "nlohmann", "json.hpp"))) {
      return path.join(prefix, "include");
    }
  } catch {
    // Ignore missing Homebrew or package.
  }

  for (const dir of ["/usr/local/include", "/usr/include"]) {
    if (fs.existsSync(path.join(dir, "nlohmann", "json.hpp"))) {
      return dir;
    }
  }

  return null;
}

export function runPipelineWithFs(
  fileSystem: FileSystem,
  entryPath: string,
  verbose: boolean,
  nativeBuild: NativeBuildOptions,
  log: (msg: string) => void,
  onDiagnostic: (diagnostic: DiagnosticLike) => void,
): PipelineResult {
  const normalizedEntryPath = path.resolve(entryPath);
  const pipelineFileSystem = withBundledStdlib(fileSystem);
  if (!pipelineFileSystem.fileExists(normalizedEntryPath)) {
    throw new Error(`File not found: ${normalizedEntryPath}`);
  }

  const packageGraph = loadPackageGraph(fileSystem, normalizedEntryPath);
  const mergedPackageNativeBuild = mergePackageNativeBuild(packageGraph);
  const resolvedNativeBuild = mergeResolvedNativeBuildOptions(mergedPackageNativeBuild, nativeBuild);
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

  if (verbose) log("Emitting C++...");
  const project = emitProject(normalizedEntryPath, analysisResult, resolvedNativeBuild);
  if (verbose) log(`  ${project.modules.length} module(s) emitted`);

  const outputBinaryName = packageGraph.rootPackage.manifest.build?.targetExecutableName ?? "a.out";
  const provenance = createBuildProvenance(packageGraph);

  return {
    project,
    warningCount,
    outputBinaryName,
    provenance,
    buildManifest: createBuildManifestTemplate(
      normalizedEntryPath,
      outputBinaryName,
      project,
      resolvedNativeBuild,
      packageGraph.packages.map((pkg) => pkg.rootDir),
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

  writeFile(path.join(outDir, "CMakeLists.txt"), project.cmake, verbose, log);
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
  outputBinaryName = "a.out",
): { outBinary: string; args: string[] } {
  const absOutDir = path.resolve(outDir);
  const outBinary = path.join(absOutDir, outputBinaryName);
  const moduleCppFiles = project.modules.map((mod) => path.join(absOutDir, mod.cppPath));

  const args = [
    `-std=${nativeBuild.cppStd}`,
    `-I${absOutDir}`,
    ...nativeBuild.includePaths.map((includePath) => `-I${includePath}`),
    ...nativeBuild.defines.map((define) => `-D${define}`),
    ...nativeBuild.compilerFlags,
    "-o",
    outBinary,
    ...moduleCppFiles,
    ...nativeBuild.sourceFiles,
    ...nativeBuild.objectFiles,
    ...nativeBuild.libraryPaths.map((libraryPath) => `-L${libraryPath}`),
    ...nativeBuild.linkLibraries.map((library) => `-l${library}`),
    ...nativeBuild.frameworks.flatMap((framework) => ["-framework", framework]),
    ...nativeBuild.linkerFlags,
  ];

  return { outBinary, args };
}

export function compileCpp(
  outDir: string,
  project: ProjectEmitResult,
  compiler: string,
  nativeBuild: NativeBuildOptions,
  verbose: boolean,
  log: (msg: string) => void,
  outputBinaryName = "a.out",
): string {
  const { outBinary, args } = buildCompileArgs(outDir, project, nativeBuild, outputBinaryName);
  const nlohmannInclude = findNlohmannInclude();
  const compileArgs = nlohmannInclude
    ? [args[0], args[1], `-I${nlohmannInclude}`, ...args.slice(2)]
    : args;
  if (verbose) log(`Compiling: ${[compiler, ...compileArgs].map(formatShellArg).join(" ")}`);

  try {
    execFileSync(compiler, compileArgs, { stdio: "pipe", timeout: 30000 });
  } catch (e: any) {
    throw new Error(`Compilation failed:\n${e.stderr?.toString() ?? e.message}`);
  }

  if (verbose) log(`  binary: ${outBinary}`);
  return outBinary;
}

export function resolveNativeBuildOptions(nativeBuild: NativeBuildOptions): NativeBuildOptions {
  return {
    ...nativeBuild,
    includePaths: nativeBuild.includePaths.map((includePath) => path.resolve(includePath)),
    libraryPaths: nativeBuild.libraryPaths.map((libraryPath) => path.resolve(libraryPath)),
    sourceFiles: nativeBuild.sourceFiles.map((sourceFile) => path.resolve(sourceFile)),
    objectFiles: nativeBuild.objectFiles.map((objectFile) => path.resolve(objectFile)),
  };
}

function createBuildManifestTemplate(
  entryPath: string,
  outputBinaryName: string,
  project: ProjectEmitResult,
  nativeBuild: NativeBuildOptions,
  packageRoots: string[],
  provenance: BuildProvenance,
): BuildManifestTemplate {
  return {
    schemaVersion: 1,
    entryPath,
    outputBinaryName,
    generatedHeaders: project.modules.map((mod) => mod.hppPath).sort(),
    generatedSources: project.modules.map((mod) => mod.cppPath).sort(),
    nativeIncludePaths: [...nativeBuild.includePaths],
    nativeSourceFiles: [...nativeBuild.sourceFiles],
    libraryPaths: [...nativeBuild.libraryPaths],
    linkLibraries: [...nativeBuild.linkLibraries],
    frameworks: [...nativeBuild.frameworks],
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
    generatedHeaders: [...template.generatedHeaders],
    generatedSources: [...template.generatedSources],
    includePaths: uniqueStrings([absOutDir, ...template.nativeIncludePaths]),
    nativeSourceFiles: [...template.nativeSourceFiles],
    libraryPaths: [...template.libraryPaths],
    linkLibraries: [...template.linkLibraries],
    frameworks: [...template.frameworks],
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
    sourceFiles: uniqueStrings([...packageNativeBuild.sourceFiles, ...nativeBuild.sourceFiles]),
    objectFiles: [...nativeBuild.objectFiles],
    compilerFlags: uniqueStrings([...packageNativeBuild.compilerFlags, ...nativeBuild.compilerFlags]),
    linkerFlags: uniqueStrings([...packageNativeBuild.linkerFlags, ...nativeBuild.linkerFlags]),
    defines: uniqueStrings([...packageNativeBuild.defines, ...nativeBuild.defines]),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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