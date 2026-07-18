// Runnable self-hosted compiler driver.
//
// The driver keeps filesystem access at the native-runtime boundary.  The
// compiler itself still receives ordinary SourceFile values, so this surface
// exercises the same resolver, analyzer, checker, and emitter used by the
// in-memory tests. The resolver asks this driver for source text only after an
// import is encountered. Bare modules come from doof.json dependencies, while
// local and std/* paths are resolved from their acquired roots.

import { compileWithLoader } from "./compiler"
import { CliRequest, cliUsage, parseCli } from "./cli"
import { ExternalDependencyTarget, acquirePackageExternalDependencies } from "./external-dependency"
import {
  ReachedPackageInput, ResolvedExternalInput, hasMutableStdPackageInputs, resolveExternalInputs,
  selectedPackageSource, validateDependencyPolicy,
} from "./dependency-policy"
import { NativePackageInput, ProjectEmission, planProjectEmission } from "./emitter-project"
import { ModuleNamespaceMapping } from "./emitter-names"
import { ModuleAcquisition, acquiredManifestPath, acquiredModuleDiskPath, acquiredPackageForModule } from "./module-acquisition"
import { NativeCompileTask, batchNativeCompileTasks, planNativeCompile } from "./native-build"
import {
  ExternalDependency, NativeBuildPlan, PackageDependency, PackageManifest, PackageResource, parsePackageManifest,
} from "./package-manifest"
import { ExactPackageSource, acquireExactGitPackage, defaultPackageCacheRoot } from "./package-acquisition"
import { macOSPackageArchiveName } from "./macos-app"
import { assembleMacOSApp, signAndArchiveMacOSApp } from "./macos-app-driver"
import { iosPackageArchiveName, iosTargetTriple } from "./ios-app"
import { assembleIOSApp, configureIOSNativeBuild, signAndArchiveIOSApp } from "./ios-app-driver"
import { resolveIOSDeviceIdentifier, resolveIOSDeviceSigningOptions, signIOSDeviceApp } from "./ios-device"
import { Parser } from "./parser"
import { PkgConfigCommandResult, applyPkgConfigResult } from "./pkg-config"
import { environmentValue, fileName, joinPath, parentPath, readProjectSpec } from "./project"
import { renderBuildProvenance } from "./provenance"
import { SourceLoader } from "./resolver"
import {
  planIOSDeviceInstall, planIOSDeviceLaunch, planIOSSimulatorInstall, planIOSSimulatorLaunch,
  planMacOSAppRun, planNativeProgramRun,
} from "./run-command"
import { Diagnostic, SemanticLocation, SemanticSpan, SourceFile } from "./semantic"
import { StdCatalog, canonicalDependencyUrl, parseStdCatalog, stdCatalogPackage } from "./std-catalog"
import {
  CoverageModuleMetadata, CoverageReport, DiscoveredTest, buildCoverageReport, discoverModuleTests,
  coverageFileRelativePath, filterDiscoveredTests, formatParseFailure, generateTestHarness,
  mergeCoverageOutput, renderCoverageFileHtml, renderCoverageHtml, renderCoverageJson,
  stripCoverageLines, testDisplayPath,
} from "./test-runner"
import { BlobReader } from "std/blob"
import { EntryKind, exists, isDirectory, mkdir, readBlob, readDir, readText, readTextResource, writeBlob, writeText } from "std/fs"
import { ExecOptions, architecture, run, platform } from "std/os"
import { absolute } from "std/path"

readonly MAX_PRINTED_DIAGNOSTICS = 8
readonly MAX_NATIVE_COMPILER_OUTPUT_LINES = 10
readonly MAX_NATIVE_COMPILER_OUTPUT_BYTES = 262144L
readonly MAX_COVERAGE_OUTPUT_BYTES = 16777216L

function hostPlatform(): string {
  value := platform()
  return if value == "darwin" then "macos" else value
}

class NativeCommandResult {
  readonly exitCode: int
  readonly output: readonly byte[] = []
  readonly error: string = ""
  readonly truncated: bool
}

class NativeCompilerBatchResult {
  readonly exitCode: int
  readonly outputs: readonly NativeCommandResult[]
}

isolated function runNativeCommand(
  command: string,
  arguments: string[],
  directory: string | null = null,
  inheritOutput: bool = false,
  // Defaults are emitted in the generated prototype before module values.
  maxOutputBytes: long = 262144L,
): NativeCommandResult {
  executed := run(command, arguments, ExecOptions {
    cwd: directory,
    withStdin: false,
    mergeStderrIntoStdout: true,
    inheritOutput,
    maxOutputBytes,
  }) else error {
    return NativeCommandResult { exitCode: -1, error, truncated: false }
  }
  let output: readonly byte[] = []
  if !inheritOutput { output = executed.stdout }
  return NativeCommandResult {
    exitCode: executed.exitCode,
    output,
    truncated: executed.stdoutTruncated,
  }
}

function printNativeCommandOutput(result: NativeCommandResult, remainingLines: int): int {
  let remaining = remainingLines
  output := if result.error != ""
    then result.error
    else BlobReader(result.output).readString(long(result.output.length))
  for line of output.split("\n") {
    if line == "" { continue }
    if remaining <= 0 { return 0 }
    println(line)
    remaining -= 1
  }
  return remaining
}

/** Owns a serial batch of compiler tasks; up to eight workers overlap. */
class NativeCompilerWorker {
  readonly tasks: readonly NativeCompileTask[]

  compile(): NativeCompilerBatchResult {
    let outputs: NativeCommandResult[] = []
    for task of this.tasks {
      let arguments: string[] = []
      for argument of task.arguments { arguments.push(argument) }
      result := runNativeCommand(task.compiler, arguments)
      outputs.push(result)
      if result.exitCode != 0 {
        return NativeCompilerBatchResult { exitCode: result.exitCode, outputs: outputs.buildReadonly() }
      }
    }
    return NativeCompilerBatchResult { exitCode: 0, outputs: outputs.buildReadonly() }
  }
}

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

class DriverSourceRoot {
  logicalPrefix: string
  diskRoot: string
}

class DriverReachedPackage {
  acquisition: ModuleAcquisition
  manifest: PackageManifest
  introducedBy: string
  sourceKind: string
  sourceUrl: string = ""
  sourceRef: string = ""
  sourceCommit: string = ""
  requestedUrl: string = ""
  requestedRef: string = ""
  requestedCommit: string = ""
  mutable: bool = false
}

class DriverAcquiredSource {
  acquisition: ModuleAcquisition
  introducedBy: string
  sourceKind: string
  sourceUrl: string = ""
  sourceRef: string = ""
  sourceCommit: string = ""
  requestedUrl: string = ""
  requestedRef: string = ""
  requestedCommit: string = ""
  mutable: bool = false
}

class DriverSourceState {
  localRoots: DriverSourceRoot[]
  acquisitions: ModuleAcquisition[]
  acquiredSources: DriverAcquiredSource[]
  reachedPackages: DriverReachedPackage[]
  namespaceMappings: ModuleNamespaceMapping[]
  nativePlatform: string
  externalTarget: ExternalDependencyTarget
  rootManifest: PackageManifest
  stdCatalog: StdCatalog
  packageCacheRoot: string
}

let configuredDriverSourceState: DriverSourceState = DriverSourceState {
  localRoots: [],
  acquisitions: [],
  acquiredSources: [],
  reachedPackages: [],
  namespaceMappings: [],
  nativePlatform: "",
  externalTarget: ExternalDependencyTarget { nativeTarget: "" },
  rootManifest: PackageManifest { name: "", manifestPath: "", rootDirectory: "", nativeBuild: NativeBuildPlan {} },
  stdCatalog: StdCatalog { schemaVersion: 1, compilerVersion: "", digest: "", packages: [] },
  packageCacheRoot: "",
}

function driverSourceDiskPath(
  logicalPath: string,
  localRoots: DriverSourceRoot[],
  acquisitions: ModuleAcquisition[],
): string {
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
  localRoots: DriverSourceRoot[],
  acquisitions: ModuleAcquisition[],
): Result<SourceFile | null, Diagnostic> {
  diskPath := driverSourceDiskPath(logicalPath, localRoots, acquisitions)
  if !exists(diskPath) { return Success(null) }
  source := readText(diskPath) else {
    return Failure(driverDiagnostic(logicalPath, "Could not read source file ${diskPath}"))
  }
  return Success(SourceFile { path: logicalPath, source })
}

function configuredDriverSource(logicalPath: string): Result<SourceFile | null, Diagnostic> {
  if logicalPath.startsWith("/std/") {
    _ := ensureStdPackageAcquisition(logicalPath) else error {
      return Failure(driverDiagnostic(logicalPath, error))
    }
  }
  try source := loadDriverSource(
    logicalPath,
    configuredDriverSourceState.localRoots,
    configuredDriverSourceState.acquisitions,
  )
  if source != null {
    package := acquiredPackageForLoadedSource(logicalPath, configuredDriverSourceState)
    if package != null { try registerReachedPackage(package!) }
  }
  return Success(source)
}

function acquiredPackageForLoadedSource(logicalPath: string, state: DriverSourceState): ModuleAcquisition | null {
  for root of state.localRoots {
    if logicalPath == root.logicalPrefix || logicalPath.startsWith(root.logicalPrefix + "/") { return null }
  }
  return acquiredPackageForModule(logicalPath, state.acquisitions)
}

function registerReachedPackage(acquisition: ModuleAcquisition): Result<void, Diagnostic> {
  for reached of configuredDriverSourceState.reachedPackages {
    if reached.acquisition.logicalPrefix == acquisition.logicalPrefix && reached.acquisition.diskRoot == acquisition.diskRoot {
      return Success()
    }
  }

  manifestPath := acquiredManifestPath(acquisition)
  manifestSource := readText(manifestPath) else {
    return Failure(driverDiagnostic(
      manifestPath,
      "Could not read doof.json for acquired package ${acquisition.logicalPrefix} at ${manifestPath}",
    ))
  }
  manifest := parsePackageManifest(manifestSource, manifestPath, acquisition.diskRoot, configuredDriverSourceState.nativePlatform) else error {
    return Failure(driverDiagnostic(manifestPath, error))
  }
  if manifest.packageResolutions.length > 0 || manifest.externalResolutions.length > 0 {
    return Failure(driverDiagnostic(manifestPath, "resolutions are only allowed in the root doof.json"))
  }
  source := acquiredSourceFor(acquisition)
  configuredDriverSourceState.reachedPackages.push(DriverReachedPackage {
    acquisition, manifest,
    introducedBy: if source == null then "" else source!.introducedBy,
    sourceKind: if source == null then "local" else source!.sourceKind,
    sourceUrl: if source == null then "" else source!.sourceUrl,
    sourceRef: if source == null then "" else source!.sourceRef,
    sourceCommit: if source == null then "" else source!.sourceCommit,
    requestedUrl: if source == null then "" else source!.requestedUrl,
    requestedRef: if source == null then "" else source!.requestedRef,
    requestedCommit: if source == null then "" else source!.requestedCommit,
    mutable: if source == null then true else source!.mutable,
  })
  configuredDriverSourceState.namespaceMappings.push(ModuleNamespaceMapping {
    logicalPrefix: acquisition.logicalPrefix,
    packageName: manifest.name,
    outputRoot: driverPackageOutputRoot(acquisition.logicalPrefix),
  })
  return Success()
}

function acquiredSourceFor(acquisition: ModuleAcquisition): DriverAcquiredSource | null {
  for source of configuredDriverSourceState.acquiredSources {
    if source.acquisition.logicalPrefix == acquisition.logicalPrefix && source.acquisition.diskRoot == acquisition.diskRoot {
      return source
    }
  }
  return null
}

function ensureStdPackageAcquisition(logicalPath: string): Result<void, string> {
  if acquiredModuleDiskPath(logicalPath, configuredDriverSourceState.acquisitions) != null { return Success() }
  remainder := logicalPath.substring(5, logicalPath.length)
  slash := remainder.indexOf("/")
  shortName := if slash < 0 then remainder else remainder.substring(0, slash)
  packageName := "std/" + shortName
  package := stdCatalogPackage(configuredDriverSourceState.stdCatalog, packageName)
  if package == null { return Failure("Unknown standard package " + packageName) }
  acquired := acquireExactGitPackage(ExactPackageSource {
    name: package!.name, expectedManifestName: package!.name,
    url: package!.url, ref: package!.ref, commit: package!.commit,
  }, configuredDriverSourceState.packageCacheRoot) else error { return Failure(error) }
  acquisition := ModuleAcquisition { logicalPrefix: "/" + packageName, diskRoot: acquired.rootDirectory }
  configuredDriverSourceState.acquisitions.push(acquisition)
  configuredDriverSourceState.acquiredSources.push(DriverAcquiredSource {
    acquisition, introducedBy: "",
    sourceKind: "git", sourceUrl: package!.url, sourceRef: package!.ref, sourceCommit: package!.commit,
  })
  return Success()
}

/** Makes an implicitly required standard package part of the reached graph. */
function ensureStdPackageReached(packageName: string): Result<void, string> {
  logicalPath := "/" + packageName + "/index.do"
  try ensureStdPackageAcquisition(logicalPath)
  acquisition := acquiredPackageForModule(logicalPath, configuredDriverSourceState.acquisitions)
  if acquisition == null { return Failure("Could not resolve required standard package " + packageName) }
  _ := registerReachedPackage(acquisition!) else error { return Failure(error.message) }
  return Success()
}

function driverDiagnostic(module: string, message: string): Diagnostic {
  zero := SemanticLocation { line: 0, column: 0, offset: 0 }
  return Diagnostic {
    severity: "error",
    message,
    span: SemanticSpan { start: zero, end: zero },
    module,
  }
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
  stdlibRoot: string,
  namespaceMappings: ModuleNamespaceMapping[],
  rootManifest: PackageManifest,
  nativePlatform: string = "",
  externalTarget: ExternalDependencyTarget | null = null,
): Result<SourceLoader, string> {
  let localRoots: DriverSourceRoot[] = []
  selfhostRoot := driverSelfhostDiskRoot(entryPath)
  if selfhostRoot != "" {
    localRoots.push(DriverSourceRoot { logicalPrefix: "/selfhost", diskRoot: selfhostRoot })
  }
  let acquisitions: ModuleAcquisition[] = []
  let acquiredSources: DriverAcquiredSource[] = []
  if stdlibRoot != "" {
    acquisition := ModuleAcquisition { logicalPrefix: "/std", diskRoot: try! absolute(stdlibRoot) }
    acquisitions.push(acquisition)
    acquiredSources.push(DriverAcquiredSource {
      acquisition, introducedBy: driverLogicalPrefix(rootManifest.rootDirectory), sourceKind: "local", mutable: true,
    })
  }
  catalogSource := readTextResource("std-catalog.json") else { return Failure("Could not read embedded std-catalog.json") }
  try catalog := parseStdCatalog(catalogSource)
  try packageCacheRoot := defaultPackageCacheRoot()
  platformName := if nativePlatform == "" then hostPlatform() else nativePlatform
  try configureDeclaredDependencies(
    rootManifest, "", rootManifest, packageCacheRoot,
    platformName, acquisitions, acquiredSources,
  )
  configuredDriverSourceState = DriverSourceState {
    localRoots,
    acquisitions,
    acquiredSources,
    reachedPackages: [],
    namespaceMappings,
    nativePlatform: if nativePlatform == "" then hostPlatform() else nativePlatform,
    externalTarget: if externalTarget == null
      then ExternalDependencyTarget { nativeTarget: if nativePlatform == "" then hostPlatform() else nativePlatform }
      else externalTarget!,
    rootManifest,
    stdCatalog: catalog,
    packageCacheRoot,
  }
  return Success(configuredDriverSource)
}

function configureDeclaredDependencies(
  manifest: PackageManifest,
  ownerPrefix: string,
  rootManifest: PackageManifest,
  packageCacheRoot: string,
  nativePlatform: string,
  acquisitions: ModuleAcquisition[],
  acquiredSources: DriverAcquiredSource[],
): Result<void, string> {
  for requested of manifest.dependencies {
    if requested.name.startsWith("std/") { continue }
    selected := selectedPackageSource(requested, rootManifest.packageResolutions)
    logicalPrefix := "/" + requested.name
    let diskRoot = ""
    let sourceKind = "local"
    let sourceUrl = ""
    let sourceRef = ""
    let sourceCommit = ""
    let mutable = false
    if selected.path != "" {
      diskRoot = try! absolute(selected.path)
      mutable = true
    } else {
      acquired := acquireExactGitPackage(ExactPackageSource {
        name: selected.name, url: selected.url, ref: selected.ref, commit: selected.commit,
      }, packageCacheRoot) else error { return Failure(error) }
      diskRoot = acquired.rootDirectory
      sourceKind = "git"
      sourceUrl = canonicalDependencyUrl(selected.url)
      sourceRef = selected.ref
      sourceCommit = selected.commit
    }
    for existing of acquiredSources {
      if sourceUrl != "" && existing.sourceUrl != "" && canonicalDependencyUrl(existing.sourceUrl) == sourceUrl &&
        existing.sourceCommit != sourceCommit {
        return Failure("Conflicting package revisions for " + sourceUrl + "; add a root resolutions.packages entry")
      }
      if existing.acquisition.logicalPrefix == logicalPrefix {
        if existing.acquisition.diskRoot != diskRoot {
          return Failure("Package import prefix " + logicalPrefix + " resolves to multiple packages")
        }
        diskRoot = ""
      }
    }
    if diskRoot == "" { continue }
    acquisition := ModuleAcquisition { logicalPrefix, diskRoot }
    acquisitions.push(acquisition)
    acquiredSources.push(DriverAcquiredSource {
      acquisition, introducedBy: ownerPrefix, sourceKind, sourceUrl, sourceRef, sourceCommit,
      requestedUrl: if requested.url == "" then "" else canonicalDependencyUrl(requested.url),
      requestedRef: requested.ref, requestedCommit: requested.commit, mutable,
    })
    dependencyManifestPath := acquiredManifestPath(acquisition)
    dependencySource := readText(dependencyManifestPath) else {
      return Failure("Could not read dependency manifest " + dependencyManifestPath)
    }
    try dependencyManifest := parsePackageManifest(dependencySource, dependencyManifestPath, diskRoot, nativePlatform)
    if dependencyManifest.name == "" { return Failure("Dependency package must declare a name: " + dependencyManifestPath) }
    if dependencyManifest.packageResolutions.length > 0 || dependencyManifest.externalResolutions.length > 0 {
      return Failure("resolutions are only allowed in the root doof.json: " + dependencyManifestPath)
    }
    try configureDeclaredDependencies(
      dependencyManifest, logicalPrefix, rootManifest, packageCacheRoot,
      nativePlatform, acquisitions, acquiredSources,
    )
  }
  return Success()
}

function reachedPackageInputs(rootManifest: PackageManifest): ReachedPackageInput[] {
  let result: ReachedPackageInput[] = [ReachedPackageInput {
    logicalPrefix: driverLogicalPrefix(rootManifest.rootDirectory), introducedBy: "", manifest: rootManifest,
    sourceKind: "root",
  }]
  for reached of configuredDriverSourceState.reachedPackages {
    result.push(ReachedPackageInput {
      logicalPrefix: reached.acquisition.logicalPrefix,
      introducedBy: reached.introducedBy,
      manifest: reached.manifest,
      sourceKind: reached.sourceKind,
      sourceUrl: reached.sourceUrl,
      sourceRef: reached.sourceRef,
      sourceCommit: reached.sourceCommit,
      requestedUrl: reached.requestedUrl,
      requestedRef: reached.requestedRef,
      requestedCommit: reached.requestedCommit,
      mutable: reached.mutable,
    })
  }
  return result
}

function resolvedDependencyInputs(rootManifest: PackageManifest): Result<ResolvedExternalInput[], string> {
  packages := reachedPackageInputs(rootManifest)
  try externals := resolveExternalInputs(packages, rootManifest)
  try validateDependencyPolicy(packages, externals, rootManifest)
  return Success(externals)
}

function acquireResolvedExternalInputs(
  inputs: ResolvedExternalInput[],
  target: ExternalDependencyTarget,
): Result<void, string> {
  for input of inputs {
    dependency := selectedExternalDependency(input)
    manifest := PackageManifest {
      name: input.owner.manifest.name,
      manifestPath: input.owner.manifest.manifestPath,
      rootDirectory: input.owner.manifest.rootDirectory,
      externalDependencies: [dependency],
      nativeBuild: NativeBuildPlan {},
    }
    try acquirePackageExternalDependencies(manifest, target)
  }
  return Success()
}

function selectedExternalDependency(input: ResolvedExternalInput): ExternalDependency {
  requested := input.dependency
  return ExternalDependency {
    name: requested.name,
    kind: input.selectedKind,
    url: input.selectedUrl,
    destination: requested.destination,
    sha256: input.selectedSha256,
    stripComponents: requested.stripComponents,
    copyFiles: requested.copyFiles,
    ref: input.selectedRef,
    commit: input.selectedCommit,
    commands: requested.commands,
  }
}

function externalTargetForRequest(
  target: string,
  nativePlatform: string,
  iosDestination: string,
  iosMinimumVersion: string,
): Result<ExternalDependencyTarget, string> {
  if target == "wasm" {
    return Success(ExternalDependencyTarget {
      nativeTarget: "wasm",
      targetTriple: "wasm32-unknown-emscripten",
      configureHost: "wasm32-unknown-emscripten",
    })
  }
  if !nativePlatform.startsWith("ios-") {
    return Success(ExternalDependencyTarget { nativeTarget: nativePlatform })
  }
  sdkName := if iosDestination == "device" then "iphoneos" else "iphonesimulator"
  sdkResult := runNativeCommand("xcrun", ["--sdk", sdkName, "--show-sdk-path"])
  if sdkResult.exitCode != 0 { return Failure("Could not resolve the " + sdkName + " SDK for external dependencies") }
  sdkPath := BlobReader(sdkResult.output).readString(long(sdkResult.output.length)).trim()
  hostArchitecture := architecture()
  try targetTriple := iosTargetTriple(iosMinimumVersion, iosDestination, hostArchitecture)
  configureHost := if iosDestination == "device"
    then "aarch64-apple-darwin"
    else if hostArchitecture == "x86_64" || hostArchitecture == "x64" then "x86_64-apple-darwin" else "aarch64-apple-darwin"
  return Success(ExternalDependencyTarget {
    nativeTarget: nativePlatform,
    sdkPath,
    targetTriple,
    configureHost,
  })
}

function driverLogicalPrefix(path: string): string {
  absolutePath := try! absolute(path)
  if absolutePath.startsWith("/") { return driverSelfhostSuffix(absolutePath) }
  return "/" + absolutePath
}

function driverPackageOutputRoot(logicalPrefix: string): string {
  let start = 0
  while start < logicalPrefix.length && logicalPrefix[start] == '/' { start = start + 1 }
  return logicalPrefix.substring(start, logicalPrefix.length)
}

function projectNativePackages(projectRoot: string, projectManifest: PackageManifest, stdlibRoot: string = ""): NativePackageInput[] {
  let packages: NativePackageInput[] = [NativePackageInput {
    logicalPrefix: driverLogicalPrefix(projectRoot),
    outputRoot: "",
    manifest: projectManifest,
  }]
  if projectManifest.target == "wasm" && stdlibRoot != "" {
    jsonRoot := joinPath(stdlibRoot, "json")
    jsonManifestPath := joinPath(jsonRoot, "doof.json")
    jsonManifest := try! parsePackageManifest(try! readText(jsonManifestPath), jsonManifestPath, jsonRoot, "wasm")
    packages.push(NativePackageInput {
      logicalPrefix: "/std/json",
      outputRoot: "std/json",
      manifest: jsonManifest,
    })
  }
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

function materializeExecutableResources(resources: PackageResource[], outputDirectory: string): void {
  for resource of resources {
    destinationRoot := driverOutputPath(outputDirectory, resource.destination)
    outputPath := if isDirectory(resource.sourcePath)
      then destinationRoot
      else driverOutputPath(destinationRoot, fileName(resource.sourcePath))
    materializeNativeCopy(resource.sourcePath, outputPath)
  }
}

function materializeRuntimeHeader(outputDirectory: string): void {
  // Packaged compilers carry the canonical header as an executable resource.
  // The override remains useful when developing against an alternate runtime.
  let sourcePath = environmentValue("DOOF_RUNTIME_HEADER")
  runtimeSource := if sourcePath == ""
    then readTextResource("doof_runtime.h")
    else readText(sourcePath)
  try! writeText(driverOutputPath(outputDirectory, "doof_runtime.hpp"), try! runtimeSource)
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
  for packageName of project.nativeBuild.pkgConfigPackages {
    for mode of ["cflags", "libs"] {
      pkgConfigResult := runNativeCommand("pkg-config", ["--" + mode, packageName])
      output := BlobReader(pkgConfigResult.output).readString(long(pkgConfigResult.output.length))
      applied := applyPkgConfigResult(
        project.nativeBuild,
        packageName,
        mode,
        PkgConfigCommandResult {
          exitCode: pkgConfigResult.exitCode,
          output,
          error: pkgConfigResult.error,
        },
      )
      _ := applied else error {
        println("error: " + error)
        return 1
      }
    }
  }
  wasm := outputPath.endsWith(".wasm")
  let compiler = request.compiler
  if compiler == "" && wasm { compiler = "em++" }
  if compiler == "" { compiler = environmentValue("CXX") }
  if compiler == "" { compiler = "c++" }
  plan := planNativeCompile(compiler, outputDirectory, outputPath, project.modules, project.nativeBuild, release, hostPlatform(), project.wasmExportNames, wasm)
  let remainingOutputLines = MAX_NATIVE_COMPILER_OUTPUT_LINES
  let truncationReported = false
  if plan.precompiledHeaderArguments.length > 0 {
    pchResult := runNativeCommand(plan.compiler, plan.precompiledHeaderArguments)
    remainingOutputLines = printNativeCommandOutput(pchResult, remainingOutputLines)
    if pchResult.truncated {
      println("... native compiler output capture truncated after " + string(MAX_NATIVE_COMPILER_OUTPUT_BYTES) + " bytes")
      truncationReported = true
    }
    if pchResult.exitCode != 0 {
      println("error: native compiler failed to build the precompiled runtime header with code " + string(pchResult.exitCode))
      return pchResult.exitCode
    }
  }

  // A bounded set of actor domains prevents large graphs from spawning one
  // compiler process per translation unit while still overlapping eight jobs.
  let workers: Actor<NativeCompilerWorker>[] = []
  let promises: Promise<NativeCompilerBatchResult>[] = []
  for task of plan.compileTasks {
    ensureOutputDirectory(parentPath(task.outputPath))
  }
  compileBatches := batchNativeCompileTasks(plan.compileTasks)
  for batch of compileBatches {
    worker := Actor<NativeCompilerWorker>(batch)
    workers.push(worker)
    promises.push(async worker.compile())
  }
  let compileExitCode = 0
  for index of 0..<promises.length {
    batchResult := try! promises[index].get()
    retire workers[index]
    for commandResult of batchResult.outputs {
      remainingOutputLines = printNativeCommandOutput(commandResult, remainingOutputLines)
      if commandResult.truncated && !truncationReported {
        println("... native compiler output capture truncated after " + string(MAX_NATIVE_COMPILER_OUTPUT_BYTES) + " bytes")
        truncationReported = true
      }
    }
    if compileExitCode == 0 && batchResult.exitCode != 0 { compileExitCode = batchResult.exitCode }
  }
  if remainingOutputLines == 0 && !truncationReported {
    println("... native compiler output truncated after " + string(MAX_NATIVE_COMPILER_OUTPUT_LINES) + " lines")
    truncationReported = true
  }
  if compileExitCode != 0 {
    println("error: native object compiler exited with code " + string(compileExitCode))
    return compileExitCode
  }

  linkResult := runNativeCommand(plan.linker, plan.linkArguments)
  ignoredRemainingLines := printNativeCommandOutput(linkResult, remainingOutputLines)
  if linkResult.truncated && !truncationReported {
    println("... native linker output capture truncated after " + string(MAX_NATIVE_COMPILER_OUTPUT_BYTES) + " bytes")
  }
  if linkResult.exitCode != 0 {
    println("error: native linker exited with code " + string(linkResult.exitCode))
  }
  return linkResult.exitCode
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  displayCount := if diagnostics.length < MAX_PRINTED_DIAGNOSTICS then diagnostics.length else MAX_PRINTED_DIAGNOSTICS
  for index of 0..<displayCount {
    diagnostic := diagnostics[index]
    println(
      diagnostic.module + ":" + string(diagnostic.span.start.line) + ":" + string(diagnostic.span.start.column) +
      ": " + diagnostic.severity + ": " + diagnostic.message,
    )
  }
  if diagnostics.length > displayCount {
    println("... " + string(diagnostics.length - displayCount) + " more diagnostics omitted")
  }
}

function collectTestFiles(path: string, results: string[], root: bool = true): void {
  if !isDirectory(path) {
    if path.endsWith(".do") { results.push(path) }
    return
  }
  if !root && exists(joinPath(path, "doof.json")) { return }
  entries := try! readDir(path)
  for entry of entries {
    entryPath := joinPath(path, entry.name)
    if entry.kind == EntryKind.Directory {
      collectTestFiles(entryPath, results, false)
    } else if entry.kind == EntryKind.File && entry.name.endsWith(".test.do") {
      results.push(entryPath)
    }
  }
}

function sortedTestFiles(values: string[]): string[] {
  let result: string[] = []
  let last = ""
  for count of 0..<values.length {
    let candidate: string | null = null
    for value of values {
      if (result.length == 0 || value > last) && (candidate == null || value < candidate!) { candidate = value }
    }
    if candidate != null { result.push(candidate!); last = candidate! }
  }
  return result
}

function sortedDiscoveredTests(values: DiscoveredTest[]): DiscoveredTest[] {
  let result: DiscoveredTest[] = []
  let last = ""
  for count of 0..<values.length {
    let candidate: DiscoveredTest | null = null
    for value of values {
      if (result.length == 0 || value.id > last) && (candidate == null || value.id < candidate!.id) { candidate = value }
    }
    if candidate != null { result.push(candidate!); last = candidate!.id }
  }
  return result
}

function selectedModuleTests(tests: DiscoveredTest[], modulePath: string): DiscoveredTest[] {
  let selected: DiscoveredTest[] = []
  for test of tests { if test.modulePath == modulePath { selected.push(test) } }
  return selected
}

function safeTestOutputName(displayPath: string): string {
  return displayPath.replaceAll("/", "_").replaceAll("\\", "_").replaceAll(".", "_").replaceAll("-", "_")
}

function mergeCoverageGroup(
  groupModules: CoverageModuleMetadata[],
  groupHits: int[][],
  allModules: CoverageModuleMetadata[],
  allHits: int[][],
): void {
  for groupIndex of 0..<groupModules.length {
    groupModule := groupModules[groupIndex]
    diskPath := driverSourceDiskPath(
      groupModule.modulePath,
      configuredDriverSourceState.localRoots,
      configuredDriverSourceState.acquisitions,
    )
    let targetIndex = -1
    for index of 0..<allModules.length {
      if allModules[index].modulePath == diskPath { targetIndex = index }
    }
    if targetIndex < 0 {
      let lines: int[] = []
      for line of groupModule.instrumentedLines { lines.push(line) }
      allModules.push(CoverageModuleMetadata {
        moduleId: allModules.length,
        modulePath: diskPath,
        instrumentedLines: lines,
      })
      allHits.push([])
      targetIndex = allModules.length - 1
    }
    if groupIndex < groupHits.length {
      for line of groupHits[groupIndex] {
        let found = false
        for existing of allHits[targetIndex] { if existing == line { found = true } }
        if !found { allHits[targetIndex].push(line) }
      }
    }
  }
}

function printCoverageSummary(report: CoverageReport): void {
  println("Coverage summary:")
  for file of report.files {
    percent := string(file.percentTenths \ 10) + "." + string(file.percentTenths % 10)
    println("  " + file.path + ": " + string(file.covered) + "/" + string(file.total) + " lines (" + percent + "%)")
  }
  overall := string(report.totalPercentTenths \ 10) + "." + string(report.totalPercentTenths % 10)
  println("Overall: " + string(report.totalCovered) + "/" + string(report.totalLines) + " lines (" + overall + "%)")
}

function coverageHtmlPath(jsonPath: string): string {
  if jsonPath.endsWith(".json") { return jsonPath.substring(0, jsonPath.length - 5) + ".html" }
  return jsonPath + ".html"
}

function writeCoverageHtml(report: CoverageReport, jsonPath: string, rootDirectory: string): string {
  indexPath := coverageHtmlPath(jsonPath)
  filesDirectory := indexPath.substring(0, indexPath.length - 5) + "_files"
  filesDirectoryName := fileName(filesDirectory)
  for file of report.files {
    relativePage := coverageFileRelativePath(file.path)
    pagePath := joinPath(filesDirectory, relativePage)
    ensureOutputDirectory(parentPath(pagePath))
    let depth = 1
    for index of 0..<relativePage.length { if relativePage[index] == '/' { depth += 1 } }
    indexHref := "../".repeat(depth) + fileName(indexPath)
    sourcePath := joinPath(rootDirectory, file.path)
    let source = ""
    if exists(sourcePath) { source = try! readText(sourcePath) }
    try! writeText(pagePath, renderCoverageFileHtml(file, source, indexHref))
  }
  try! writeText(indexPath, renderCoverageHtml(report, filesDirectoryName))
  return indexPath
}

/** Runs the TypeScript-compatible one-harness-per-module test convention. */
function testRequest(request: CliRequest): int {
  target := try! absolute(request.entry)
  if !exists(target) {
    println("error: File not found: " + target)
    return 1
  }
  rootDirectory := if isDirectory(target) then target else parentPath(target)
  let testFiles: string[] = []
  collectTestFiles(target, testFiles)
  testFiles = sortedTestFiles(testFiles)
  let discovered: DiscoveredTest[] = []
  for testFile of testFiles {
    source := readText(testFile) else {
      println("error: Could not read test file: " + testFile)
      return 1
    }
    parser := Parser { source }
    parsed := catchPanic(=> parser.parse())
    program := parsed else failure {
      if parser.errorMessage == "" { panic(failure) }
      println(formatParseFailure(testFile, source, parser.errorLine, parser.errorColumn, parser.errorMessage))
      return 1
    }
    discovery := discoverModuleTests(program, testFile, rootDirectory)
    for error of discovery.errors { println(error) }
    if discovery.errors.length > 0 { return 1 }
    for test of discovery.tests { discovered.push(test) }
  }
  discovered = sortedDiscoveredTests(discovered)
  selected := filterDiscoveredTests(discovered, request.filter)
  if selected.length == 0 {
    suffix := if request.filter == "" then "" else " matching \"" + request.filter + "\""
    println("error: No tests found under " + target + suffix)
    return 1
  }

  let passed = 0
  let failed = 0
  let coverageModules: CoverageModuleMetadata[] = []
  let coverageHits: int[][] = []
  for testFile of testFiles {
    moduleTests := selectedModuleTests(selected, testFile)
    if moduleTests.length == 0 { continue }
    project := readProjectSpec(testFile, hostPlatform())
    buildRoot := if request.outputDirectory == ""
      then joinPath(project.rootDirectory, project.buildDirectory)
      else try! absolute(request.outputDirectory)
    outputDirectory := joinPath(joinPath(buildRoot, ".doof-tests"), safeTestOutputName(testDisplayPath(rootDirectory, testFile)))
    harnessPath := joinPath(outputDirectory, "__doof_tests__.do")
    ensureOutputDirectory(outputDirectory)
    try! writeText(harnessPath, generateTestHarness(harnessPath, moduleTests))

    stdlibRoot := environmentValue("DOOF_STDLIB_ROOT")
    let namespaceMappings: ModuleNamespaceMapping[] = [ModuleNamespaceMapping {
      logicalPrefix: driverLogicalPrefix(project.rootDirectory),
      packageName: project.name,
      outputRoot: "",
    }]
    loader := sourceLoaderForRequest(
      harnessPath, stdlibRoot, namespaceMappings, project.manifest,
    ) else error {
      println("error: " + error)
      return 1
    }
    result := compileWithLoader([], driverLogicalPath(harnessPath), loader, namespaceMappings, "executable", request.coverage)
    if result.diagnostics.length > 0 {
      printDiagnostics(result.diagnostics)
      return 1
    }
    if request.listOnly {
      for test of moduleTests { println(test.id) }
      continue
    }
    if result.emission == null { panic("self-hosted test compiler produced no emission") }
    rootManifest := project.manifest
    testExternalTarget := ExternalDependencyTarget { nativeTarget: hostPlatform() }
    externalInputs := resolvedDependencyInputs(rootManifest) else error {
      println("error: " + error)
      return 1
    }
    _ := acquireResolvedExternalInputs(externalInputs, testExternalTarget) else error {
      println("error: " + error)
      return 1
    }
    emission := planProjectEmission(result.emission!, projectNativePackages(project.rootDirectory, rootManifest))
    if request.coverage { emission.nativeBuild.defines.push("DOOF_COVERAGE") }
    materializeProject(outputDirectory, emission)
    materializeRuntimeHeader(outputDirectory)
    binary := joinPath(outputDirectory, "doof-tests")
    println("BUILD " + testDisplayPath(rootDirectory, testFile))
    buildExitCode := buildProject(request, outputDirectory, binary, emission)
    if buildExitCode != 0 { return buildExitCode }

    for test of moduleTests {
      testResult := runNativeCommand(
        binary,
        [test.id],
        project.rootDirectory,
        !request.coverage,
        if request.coverage then MAX_COVERAGE_OUTPUT_BYTES else MAX_NATIVE_COMPILER_OUTPUT_BYTES,
      )
      if request.coverage {
        if testResult.truncated {
          println("error: coverage output exceeded " + string(MAX_COVERAGE_OUTPUT_BYTES) + " bytes for " + test.id)
          return 1
        }
        output := BlobReader(testResult.output).readString(long(testResult.output.length))
        let groupHits: int[][] = []
        for ignored of result.emission!.coverageModules { groupHits.push([]) }
        mergeCoverageOutput(output, result.emission!.coverageModules, groupHits)
        mergeCoverageGroup(result.emission!.coverageModules, groupHits, coverageModules, coverageHits)
        if testResult.exitCode != 0 {
          visibleOutput := stripCoverageLines(output)
          if visibleOutput != "" { println(visibleOutput) }
        }
      }
      exitCode := testResult.exitCode
      if exitCode == 0 {
        passed = passed + 1
        println("PASS " + test.id)
      } else {
        failed = failed + 1
        println("FAIL " + test.id)
      }
    }
  }
  if request.listOnly { return 0 }
  println("Tests finished: " + string(passed) + " passed, " + string(failed) + " failed")
  if request.coverage && coverageModules.length > 0 {
    report := buildCoverageReport(coverageModules, coverageHits, rootDirectory)
    printCoverageSummary(report)
    outputPath := if request.coverageOutput == ""
      then joinPath(joinPath(rootDirectory, "build"), "coverage/doof-test-coverage.json")
      else try! absolute(request.coverageOutput)
    ensureOutputDirectory(parentPath(outputPath))
    try! writeText(outputPath, renderCoverageJson(report))
    println("Coverage report written to " + outputPath)
    htmlPath := writeCoverageHtml(report, outputPath, rootDirectory)
    println("Coverage HTML report written to " + htmlPath)
  }
  return if failed == 0 then 0 else 1
}

function emitRequest(request: CliRequest): int {
  let project = readProjectSpec(request.entry, hostPlatform(), request.targetOverride)
  iosDestination := if request.command == "package" then "device" else request.iosDestination
  nativePlatform := if project.iosApp == null then hostPlatform() else "ios-" + iosDestination
  if project.iosApp != null { project = readProjectSpec(request.entry, nativePlatform, request.targetOverride) }
  iosMinimumVersion := if project.iosApp == null then "" else project.iosApp!.minimumDeploymentTarget
  externalTarget := externalTargetForRequest(project.target, nativePlatform, iosDestination, iosMinimumVersion) else error {
    println("error: " + error)
    return 1
  }
  rootManifest := project.manifest
  entryPath := joinPath(project.rootDirectory, project.entry)
  entry := driverLogicalPath(entryPath)
  stdlibRoot := environmentValue("DOOF_STDLIB_ROOT")
  let namespaceMappings: ModuleNamespaceMapping[] = [ModuleNamespaceMapping {
    logicalPrefix: driverLogicalPrefix(project.rootDirectory),
    packageName: project.name,
    outputRoot: "",
  }]
  loader := sourceLoaderForRequest(
    entryPath, stdlibRoot, namespaceMappings, rootManifest, nativePlatform, externalTarget,
  ) else error {
    println("error: " + error)
    return 1
  }
  if project.target == "wasm" {
    _ := ensureStdPackageReached("std/json") else error {
      println("error: " + error)
      return 1
    }
  }
  entryMode := if project.target == "wasm" then "wasm" else if project.iosApp == null then "executable" else "ios-app"
  result := compileWithLoader([], entry, loader, namespaceMappings, entryMode)
  if result.diagnostics.length > 0 {
    printDiagnostics(result.diagnostics)
    return 1
  }
  if request.command == "package" && hasMutableStdPackageInputs(reachedPackageInputs(rootManifest)) {
    println("warning: packaging with standard packages overridden by DOOF_STDLIB_ROOT; provenance.json will record them as mutable inputs")
  }
  externalInputs := resolvedDependencyInputs(rootManifest) else error {
    println("error: " + error)
    return 1
  }
  if request.command == "check" { return 0 }
  if result.emission == null { panic("self-hosted compiler produced no emission") }
  _ := acquireResolvedExternalInputs(externalInputs, externalTarget) else error {
    println("error: " + error)
    return 1
  }

  buildDirectory := if request.outputDirectory == ""
    then joinPath(project.rootDirectory, project.buildDirectory)
    else try! absolute(request.outputDirectory)
  outputDirectory := if request.command == "package"
    then joinPath(buildDirectory, "release")
    else buildDirectory
  emission := planProjectEmission(
    result.emission!,
    projectNativePackages(project.rootDirectory, rootManifest, stdlibRoot),
  )
  materializeProject(outputDirectory, emission)
  materializeRuntimeHeader(outputDirectory)
  try! writeText(
    driverOutputPath(outputDirectory, "provenance.json"),
    renderBuildProvenance(
      reachedPackageInputs(rootManifest), externalInputs, emission.nativeBuild, configuredDriverSourceState.stdCatalog,
    ),
  )
  if project.iosApp != null {
    _ := configureIOSNativeBuild(outputDirectory, project.iosApp!, iosDestination, emission.nativeBuild) else error {
      println("error: " + error)
      return 1
    }
  }
  if request.command == "build" || request.command == "run" {
    if request.command == "run" && project.target == "wasm" {
      println("error: doof run is not supported for --target wasm; instantiate the generated .wasm from your host runtime")
      return 1
    }
    executableName := if project.target == "wasm" then buildOutputName(project.name) + ".wasm" else if project.macosApp != null then project.macosApp!.executableName else if project.iosApp != null then project.iosApp!.executableName else buildOutputName(project.name)
    outputPath := driverOutputPath(outputDirectory, executableName)
    if project.macosApp == null && project.iosApp == null { materializeExecutableResources(project.resources, outputDirectory) }
    exitCode := buildProject(request, outputDirectory, outputPath, emission)
    if exitCode != 0 { return exitCode }
    if project.iosApp != null {
      appPath := assembleIOSApp(outputDirectory, outputPath, project.iosApp!, iosDestination) else error {
        println("error: " + error)
        return 1
      }
      if request.command == "build" { return 0 }
      if iosDestination == "device" {
        signingWorkDirectory := driverOutputPath(outputDirectory, ".doof-ios-signing-resolution")
        signing := resolveIOSDeviceSigningOptions(
          project.iosApp!.bundleId,
          request.iosSignIdentity,
          request.iosProvisioningProfile,
          signingWorkDirectory,
        ) else error {
          println("error: " + error)
          return 1
        }
        _ := signIOSDeviceApp(
          appPath,
          project.iosApp!.bundleId,
          signing,
          driverOutputPath(outputDirectory, ".doof-ios-sign"),
        ) else error {
          println("error: " + error)
          return 1
        }
        deviceIdentifier := resolveIOSDeviceIdentifier(
          request.iosDevice,
          driverOutputPath(outputDirectory, ".doof-ios-device-discovery"),
        ) else error {
          println("error: " + error)
          return 1
        }
        installPlan := planIOSDeviceInstall(appPath, deviceIdentifier, project.rootDirectory)
        installResult := runNativeCommand(installPlan.command, installPlan.arguments, installPlan.directory, true)
        if installResult.error != "" { println("error: " + installResult.error) }
        if installResult.exitCode != 0 { return installResult.exitCode }
        launchPlan := planIOSDeviceLaunch(project.iosApp!.bundleId, deviceIdentifier, project.rootDirectory)
        launchResult := runNativeCommand(launchPlan.command, launchPlan.arguments, launchPlan.directory, true)
        if launchResult.error != "" { println("error: " + launchResult.error) }
        return launchResult.exitCode
      }
      installPlan := planIOSSimulatorInstall(appPath, project.rootDirectory)
      installResult := runNativeCommand(installPlan.command, installPlan.arguments, installPlan.directory, true)
      if installResult.error != "" { println("error: " + installResult.error) }
      if installResult.exitCode != 0 { return installResult.exitCode }
      launchPlan := planIOSSimulatorLaunch(project.iosApp!.bundleId, project.rootDirectory)
      launchResult := runNativeCommand(launchPlan.command, launchPlan.arguments, launchPlan.directory, true)
      if launchResult.error != "" { println("error: " + launchResult.error) }
      return launchResult.exitCode
    }
    if project.macosApp != null {
      appPath := assembleMacOSApp(outputDirectory, outputPath, project.macosApp!, emission.nativeBuild.libraryPaths) else error {
        println("error: " + error)
        return 1
      }
      if request.command == "build" { return 0 }
      launchPlan := planMacOSAppRun(appPath, project.rootDirectory)
      launchResult := runNativeCommand(launchPlan.command, launchPlan.arguments, launchPlan.directory, true)
      if launchResult.error != "" { println("error: " + launchResult.error) }
      return launchResult.exitCode
    }
    if request.command == "build" { return 0 }
    runPlan := planNativeProgramRun(outputPath, request.programArguments, project.rootDirectory)
    runResult := runNativeCommand(runPlan.command, runPlan.arguments, runPlan.directory, true)
    if runResult.error != "" { println("error: " + runResult.error) }
    return runResult.exitCode
  }
  if request.command == "package" {
    if project.packageConfig == null { panic("project package settings were not resolved") }
    distDirectory := if request.distDirectory != "" then try! absolute(request.distDirectory) else project.packageConfig!.distDirectory
    ensureOutputDirectory(distDirectory)
    executableName := if project.target == "wasm" then buildOutputName(project.name) + ".wasm" else if project.macosApp != null then project.macosApp!.executableName else if project.iosApp != null then project.iosApp!.executableName else buildOutputName(project.name)
    outputPath := if project.macosApp == null && project.iosApp == null
      then driverOutputPath(distDirectory, executableName)
      else driverOutputPath(outputDirectory, executableName)
    exitCode := buildProject(request, outputDirectory, outputPath, emission, true)
    if exitCode != 0 { return exitCode }
    if project.macosApp == null && project.iosApp == null {
      materializeExecutableResources(project.resources, distDirectory)
      return 0
    }
    if project.iosApp != null {
      appPath := assembleIOSApp(outputDirectory, outputPath, project.iosApp!, iosDestination) else error {
        println("error: " + error)
        return 1
      }
      if project.iosPackageConfig == null { panic("iOS package settings were not resolved") }
      iosConfig := project.iosPackageConfig!
      environmentIdentity := environmentValue("DOOF_IOS_SIGN_IDENTITY")
      if environmentIdentity != "" { iosConfig.identity = environmentIdentity }
      if request.iosSignIdentity != "" { iosConfig.identity = request.iosSignIdentity }
      environmentProfile := environmentValue("DOOF_IOS_PROVISIONING_PROFILE")
      if environmentProfile != "" { iosConfig.provisioningProfilePath = try! absolute(environmentProfile) }
      if request.iosProvisioningProfile != "" { iosConfig.provisioningProfilePath = try! absolute(request.iosProvisioningProfile) }
      archivePath := driverOutputPath(distDirectory, iosPackageArchiveName(project.iosApp!.executableName, project.iosApp!.version))
      _ := signAndArchiveIOSApp(appPath, archivePath, project.iosApp!.bundleId, iosConfig, outputDirectory) else error {
        println("error: " + error)
        return 1
      }
      println("Package: " + archivePath)
      return 0
    }
    appPath := assembleMacOSApp(outputDirectory, outputPath, project.macosApp!, emission.nativeBuild.libraryPaths) else error {
      println("error: " + error)
      return 1
    }
    packageConfig := project.packageConfig!
    if request.macosSigning != "" { packageConfig.signing = request.macosSigning }
    environmentIdentity := environmentValue("DOOF_MACOS_SIGN_IDENTITY")
    if environmentIdentity != "" { packageConfig.identity = environmentIdentity }
    if request.macosSignIdentity != "" { packageConfig.identity = request.macosSignIdentity }
    if request.macosSandbox { packageConfig.sandbox = true }
    if request.macosEntitlements != "" { packageConfig.entitlementsPath = try! absolute(request.macosEntitlements) }
    archivePath := driverOutputPath(distDirectory, macOSPackageArchiveName(project.macosApp!.executableName, project.macosApp!.version))
    _ := signAndArchiveMacOSApp(appPath, archivePath, packageConfig, outputDirectory) else error {
      println("error: " + error)
      return 1
    }
    println("Package: " + archivePath)
    return 0
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
  if parsed.request!.command == "test" { return testRequest(parsed.request!) }
  return emitRequest(parsed.request!)
}
