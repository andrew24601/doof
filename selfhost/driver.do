// Runnable self-hosted compiler driver.
//
// The driver keeps filesystem access at the native-runtime boundary.  The
// compiler itself still receives ordinary SourceFile values, so this surface
// exercises the same resolver, analyzer, checker, and emitter used by the
// in-memory tests. The resolver asks this driver for source text only after an
// import is encountered. --module remains an explicit mapping for external
// modules, while local and std/* paths are resolved from their roots.

import { compileWithLoader } from "./compiler"
import { CliRequest, ModuleSource, cliUsage, parseCli } from "./cli"
import { NativePackageInput, ProjectEmission, planProjectEmission } from "./emitter-project"
import { ModuleNamespaceMapping } from "./emitter-names"
import { ModuleAcquisition, acquiredManifestPath, acquiredModuleDiskPath, acquiredPackageForModule } from "./module-acquisition"
import { planNativeCompile } from "./native-build"
import { PackageManifest, parsePackageManifest } from "./package-manifest"
import { environmentValue, joinPath, parentPath, readProjectSpec } from "./project"
import { SourceLoader } from "./resolver"
import { Diagnostic, SourceFile } from "./semantic"
import { exists, isDirectory, mkdir, readBlob, readDir, readText, writeBlob, writeText } from "std/fs"

import function runtimeHeaderSourcePath(): string from "doof_runtime.hpp" as doof::runtime_header_source_path
import function hostPlatform(): string from "doof_runtime.hpp" as doof::host_platform
import function runNativeCompiler(command: string, arguments: string[]): int from "doof_runtime.hpp" as doof::run_command

function driverWithExtension(path: string): string {
  if path.endsWith(".do") { return path }
  return path + ".do"
}

function driverLogicalPath(path: string): string {
  withExtension := driverWithExtension(path)
  if withExtension.startsWith("/") {
    return driverSelfhostSuffix(withExtension)
  }
  return "/" + withExtension
}

function driverExternalLogicalPath(specifier: string): string {
  withExtension := driverWithExtension(specifier)
  if withExtension.startsWith("/") { return withExtension }
  return "/" + withExtension
}

function driverSelfhostSuffix(path: string): string {
  marker := "/selfhost/"
  let index = 0
  while index + marker.length <= path.length {
    if path.substring(index, index + marker.length) == marker {
      return path.substring(index, path.length)
    }
    index = index + 1
  }
  return path
}

function driverOutputPath(directory: string, name: string): string {
  if directory.endsWith("/") { return directory + name }
  return directory + "/" + name
}

class DriverSourceMapping {
  logicalPath: string
  diskPath: string
}

class DriverSourceRoot {
  logicalPrefix: string
  diskRoot: string
}

class DriverReachedPackage {
  acquisition: ModuleAcquisition
  manifest: PackageManifest
}

class DriverSourceState {
  localMappings: DriverSourceMapping[]
  localRoots: DriverSourceRoot[]
  moduleSources: ModuleSource[]
  acquisitions: ModuleAcquisition[]
  reachedPackages: DriverReachedPackage[]
  namespaceMappings: ModuleNamespaceMapping[]
}

let configuredDriverSourceState: DriverSourceState = DriverSourceState {
  localMappings: [],
  localRoots: [],
  moduleSources: [],
  acquisitions: [],
  reachedPackages: [],
  namespaceMappings: [],
}

function driverSourceMapping(logicalPath: string, diskPath: string): DriverSourceMapping {
  return DriverSourceMapping { logicalPath, diskPath: absolutePath(diskPath) }
}

function driverSourceDiskPath(
  logicalPath: string,
  localMappings: DriverSourceMapping[],
  localRoots: DriverSourceRoot[],
  moduleSources: ModuleSource[],
  acquisitions: ModuleAcquisition[],
): string {
  for mapping of localMappings {
    if mapping.logicalPath == logicalPath { return mapping.diskPath }
  }
  for mapping of moduleSources {
    if driverExternalLogicalPath(mapping.specifier) == logicalPath {
      return absolutePath(driverWithExtension(mapping.sourcePath))
    }
  }
  for root of localRoots {
    if logicalPath == root.logicalPrefix { return root.diskRoot }
    prefix := root.logicalPrefix + "/"
    if logicalPath.startsWith(prefix) {
      return joinPath(root.diskRoot, logicalPath.substring(prefix.length, logicalPath.length))
    }
  }
  acquiredPath := acquiredModuleDiskPath(logicalPath, acquisitions)
  if acquiredPath != null { return acquiredPath! }
  return logicalPath
}

function loadDriverSource(
  logicalPath: string,
  localMappings: DriverSourceMapping[],
  localRoots: DriverSourceRoot[],
  moduleSources: ModuleSource[],
  acquisitions: ModuleAcquisition[],
): SourceFile | null {
  diskPath := driverSourceDiskPath(logicalPath, localMappings, localRoots, moduleSources, acquisitions)
  if !exists(diskPath) { return null }
  source := readText(diskPath) else {
    return null
  }
  return SourceFile { path: logicalPath, source }
}

function configuredDriverSource(logicalPath: string): SourceFile | null {
  source := loadDriverSource(
    logicalPath,
    configuredDriverSourceState.localMappings,
    configuredDriverSourceState.localRoots,
    configuredDriverSourceState.moduleSources,
    configuredDriverSourceState.acquisitions,
  )
  if source != null {
    package := acquiredPackageForLoadedSource(logicalPath, configuredDriverSourceState)
    if package != null { registerReachedPackage(package!) }
  }
  return source
}

function acquiredPackageForLoadedSource(logicalPath: string, state: DriverSourceState): ModuleAcquisition | null {
  for mapping of state.localMappings { if mapping.logicalPath == logicalPath { return null } }
  for mapping of state.moduleSources {
    if driverExternalLogicalPath(mapping.specifier) == logicalPath { return null }
  }
  for root of state.localRoots {
    if logicalPath == root.logicalPrefix || logicalPath.startsWith(root.logicalPrefix + "/") { return null }
  }
  return acquiredPackageForModule(logicalPath, state.acquisitions)
}

function registerReachedPackage(acquisition: ModuleAcquisition): void {
  for reached of configuredDriverSourceState.reachedPackages {
    if reached.acquisition.logicalPrefix == acquisition.logicalPrefix && reached.acquisition.diskRoot == acquisition.diskRoot {
      return
    }
  }

  manifestPath := acquiredManifestPath(acquisition)
  manifestSource := readText(manifestPath) else {
    panic("Missing doof.json for acquired package " + acquisition.logicalPrefix + " at " + manifestPath)
  }
  manifest := try! parsePackageManifest(manifestSource, manifestPath, acquisition.diskRoot, hostPlatform())
  configuredDriverSourceState.reachedPackages.push(DriverReachedPackage { acquisition, manifest })
  configuredDriverSourceState.namespaceMappings.push(ModuleNamespaceMapping {
    logicalPrefix: acquisition.logicalPrefix,
    packageName: manifest.name,
  })
}

function driverSelfhostDiskRoot(path: string): string {
  marker := "/selfhost/"
  let index = 0
  while index + marker.length <= path.length {
    if path.substring(index, index + marker.length) == marker {
      return path.substring(0, index + marker.length - 1)
    }
    index = index + 1
  }
  return ""
}

function sourceLoaderForRequest(
  entryPath: string,
  extraPaths: string[],
  moduleSources: ModuleSource[],
  stdlibRoot: string,
  namespaceMappings: ModuleNamespaceMapping[],
): SourceLoader {
  let localMappings: DriverSourceMapping[] = [driverSourceMapping(driverLogicalPath(entryPath), entryPath)]
  let localRoots: DriverSourceRoot[] = []
  selfhostRoot := driverSelfhostDiskRoot(entryPath)
  if selfhostRoot != "" {
    localRoots.push(DriverSourceRoot { logicalPrefix: "/selfhost", diskRoot: selfhostRoot })
  }
  for path of extraPaths {
    absolute := absolutePath(driverWithExtension(path))
    localMappings.push(driverSourceMapping(driverLogicalPath(absolute), absolute))
  }
  let acquisitions: ModuleAcquisition[] = []
  if stdlibRoot != "" {
    acquisitions.push(ModuleAcquisition { logicalPrefix: "/std", diskRoot: absolutePath(stdlibRoot) })
  }
  configuredDriverSourceState = DriverSourceState {
    localMappings,
    localRoots,
    moduleSources,
    acquisitions,
    reachedPackages: [],
    namespaceMappings,
  }
  return configuredDriverSource
}

function driverLogicalPrefix(path: string): string {
  absolute := absolutePath(path)
  if absolute.startsWith("/") { return driverSelfhostSuffix(absolute) }
  return "/" + absolute
}

function driverPackageOutputRoot(logicalPrefix: string): string {
  let start = 0
  while start < logicalPrefix.length && logicalPrefix[start] == '/' { start = start + 1 }
  return logicalPrefix.substring(start, logicalPrefix.length)
}

function projectNativePackages(projectRoot: string, projectManifest: PackageManifest): NativePackageInput[] {
  let packages: NativePackageInput[] = [NativePackageInput {
    logicalPrefix: driverLogicalPrefix(projectRoot),
    outputRoot: "",
    manifest: projectManifest,
  }]
  for reached of configuredDriverSourceState.reachedPackages {
    packages.push(NativePackageInput {
      logicalPrefix: reached.acquisition.logicalPrefix,
      outputRoot: driverPackageOutputRoot(reached.acquisition.logicalPrefix),
      manifest: reached.manifest,
    })
  }
  return packages
}

function ensureOutputDirectory(path: string): void {
  if path == "" || exists(path) { return }
  parent := parentPath(path)
  if parent != path { ensureOutputDirectory(parent) }
  try! mkdir(path)
}

function materializeNativeCopy(sourcePath: string, outputPath: string): void {
  if isDirectory(sourcePath) {
    ensureOutputDirectory(outputPath)
    for entry of try! readDir(sourcePath) {
      materializeNativeCopy(joinPath(sourcePath, entry.name), joinPath(outputPath, entry.name))
    }
    return
  }
  ensureOutputDirectory(parentPath(outputPath))
  try! writeBlob(outputPath, try! readBlob(sourcePath))
}

function materializeProject(outputDirectory: string, project: ProjectEmission): void {
  ensureOutputDirectory(outputDirectory)
  for module of project.modules {
    try! writeText(driverOutputPath(outputDirectory, module.headerName), module.header)
    try! writeText(driverOutputPath(outputDirectory, module.sourceName), module.source)
  }
  for supportFile of project.supportFiles {
    outputPath := driverOutputPath(outputDirectory, supportFile.relativePath)
    ensureOutputDirectory(parentPath(outputPath))
    try! writeText(outputPath, supportFile.content)
  }
  for nativeCopy of project.nativeCopies {
    materializeNativeCopy(
      nativeCopy.sourcePath,
      driverOutputPath(outputDirectory, nativeCopy.relativePath),
    )
  }
}

function materializeRuntimeHeader(outputDirectory: string): void {
  // The canonical header is both the compiler's runtime dependency and the
  // source asset copied into generated projects. The override supports moving
  // a compiler binary independently from the header it was built against.
  let sourcePath = environmentValue("DOOF_RUNTIME_HEADER")
  if sourcePath == "" { sourcePath = runtimeHeaderSourcePath() }
  try! writeText(driverOutputPath(outputDirectory, "doof_runtime.hpp"), try! readText(sourcePath))
}

function buildOutputName(projectName: string): string {
  return projectName.replaceAll("/", "-").replaceAll("\\", "-")
}

function buildProject(
  request: CliRequest,
  outputDirectory: string,
  outputPath: string,
  project: ProjectEmission,
  release: bool = false,
): int {
  if project.nativeBuild.pkgConfigPackages.length > 0 {
    println("error: self-hosted build does not yet resolve pkg-config packages")
    return 1
  }
  let compiler = request.compiler
  if compiler == "" { compiler = environmentValue("CXX") }
  if compiler == "" { compiler = "c++" }
  plan := planNativeCompile(compiler, outputDirectory, outputPath, project.modules, project.nativeBuild, release, hostPlatform())
  if plan.precompiledHeaderArguments.length > 0 {
    pchExitCode := runNativeCompiler(plan.compiler, plan.precompiledHeaderArguments)
    if pchExitCode != 0 {
      println("error: native compiler failed to build the precompiled runtime header with code " + string(pchExitCode))
      return pchExitCode
    }
  }
  exitCode := runNativeCompiler(plan.compiler, plan.arguments)
  if exitCode != 0 {
    println("error: native compiler exited with code " + string(exitCode))
  }
  return exitCode
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for diagnostic of diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
}

function emitRequest(request: CliRequest): int {
  project := readProjectSpec(request.entry, hostPlatform())
  entryPath := joinPath(project.rootDirectory, project.entry)
  entry := driverLogicalPath(entryPath)
  stdlibRoot := environmentValue("DOOF_STDLIB_ROOT")
  let namespaceMappings: ModuleNamespaceMapping[] = [ModuleNamespaceMapping {
    logicalPrefix: driverLogicalPrefix(project.rootDirectory),
    packageName: project.name,
  }]
  loader := sourceLoaderForRequest(entryPath, request.sourcePaths, request.moduleSources, stdlibRoot, namespaceMappings)
  result := compileWithLoader([], entry, loader, namespaceMappings)
  if result.diagnostics.length > 0 {
    printDiagnostics(result.diagnostics)
    return 1
  }
  if request.command == "check" { return 0 }
  if result.emission == null { panic("self-hosted compiler produced no emission") }

  buildDirectory := if request.outputDirectory == ""
    then joinPath(project.rootDirectory, project.buildDirectory)
    else absolutePath(request.outputDirectory)
  outputDirectory := if request.command == "package"
    then joinPath(buildDirectory, "release")
    else buildDirectory
  rootManifest := PackageManifest {
    name: project.name,
    manifestPath: project.manifestPath,
    rootDirectory: project.rootDirectory,
    nativeBuild: project.nativeBuild,
  }
  emission := planProjectEmission(
    result.emission!,
    projectNativePackages(project.rootDirectory, rootManifest),
  )
  materializeProject(outputDirectory, emission)
  materializeRuntimeHeader(outputDirectory)
  if request.command == "build" {
    outputPath := driverOutputPath(outputDirectory, buildOutputName(project.name))
    return buildProject(request, outputDirectory, outputPath, emission)
  }
  if request.command == "package" {
    distDirectory := joinPath(project.rootDirectory, "dist")
    ensureOutputDirectory(distDirectory)
    outputPath := driverOutputPath(distDirectory, buildOutputName(project.name))
    return buildProject(request, outputDirectory, outputPath, emission, true)
  }
  return 0
}

function main(args: string[]): int {
  parsed := parseCli(args)
  if parsed.help {
    println(cliUsage())
    return 0
  }
  if parsed.error != "" {
    println("error: " + parsed.error)
    println(cliUsage())
    return 2
  }
  return emitRequest(parsed.request!)
}
