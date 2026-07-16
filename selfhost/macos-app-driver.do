// Native macOS bundle, Mach-O embedding, signing, and archive boundary.
//
// The generic compiler driver delegates here after linking. This module owns
// Apple tool invocation and filesystem materialization; macos-app.do retains
// the deterministic metadata and command-argument model.

import { MacOSAppConfig, MacOSPackageConfig, macOSCodesignArguments, renderMacOSInfoPlist } from "./macos-app"
import { BlobReader } from "std/blob"
import { exists, isDirectory, mkdir, readBlob, readDir, remove, writeBlob, writeText } from "std/fs"
import { ExecOptions, platform, run } from "std/os"
import { basename, dirname, join } from "std/path"

readonly MAX_MACOS_COMMAND_OUTPUT_BYTES = 262144L

class MacOSCommandResult {
  exitCode: int
  output: readonly byte[] = []
  error: string = ""
}

function hostPlatform(): string {
  value := platform()
  return if value == "darwin" then "macos" else value
}

function outputPath(directory: string, name: string): string => join([directory, name])
function parentPath(path: string): string => dirname(path)
function fileName(path: string): string => basename(path)

function runMacOSCommand(command: string, arguments: string[]): MacOSCommandResult {
  executed := run(command, arguments, ExecOptions {
    withStdin: false,
    mergeStderrIntoStdout: true,
    maxOutputBytes: MAX_MACOS_COMMAND_OUTPUT_BYTES,
  }) else error {
    return MacOSCommandResult { exitCode: -1, error }
  }
  return MacOSCommandResult { exitCode: executed.exitCode, output: executed.stdout }
}

function ensureDirectory(path: string): void {
  if path == "" || exists(path) { return }
  parent := parentPath(path)
  if parent != path { ensureDirectory(parent) }
  try! mkdir(path)
}

function copyPath(sourcePath: string, destinationPath: string): void {
  if isDirectory(sourcePath) {
    ensureDirectory(destinationPath)
    for entry of try! readDir(sourcePath) {
      copyPath(outputPath(sourcePath, entry.name), outputPath(destinationPath, entry.name))
    }
    return
  }
  ensureDirectory(parentPath(destinationPath))
  try! writeBlob(destinationPath, try! readBlob(sourcePath))
}

function removeTree(path: string): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { removeTree(outputPath(path, entry.name)) }
  }
  try! remove(path)
}

function globBaseDirectory(pattern: string): string {
  let wildcard = pattern.length
  for index of 0..<pattern.length {
    if pattern.substring(index, index + 1) == "*" { wildcard = index; break }
  }
  if wildcard == pattern.length { return parentPath(pattern) }
  let slash = wildcard
  while slash > 0 && pattern.substring(slash - 1, slash) != "/" { slash = slash - 1 }
  return if slash <= 1 then "/" else pattern.substring(0, slash - 1)
}

function globMatches(pattern: string, value: string, patternIndex: int = 0, valueIndex: int = 0): bool {
  if patternIndex == pattern.length { return valueIndex == value.length }
  current := pattern.substring(patternIndex, patternIndex + 1)
  if current != "*" {
    return valueIndex < value.length && current == value.substring(valueIndex, valueIndex + 1) &&
      globMatches(pattern, value, patternIndex + 1, valueIndex + 1)
  }
  doubleStar := patternIndex + 1 < pattern.length && pattern.substring(patternIndex + 1, patternIndex + 2) == "*"
  nextPattern := patternIndex + if doubleStar then 2 else 1
  if globMatches(pattern, value, nextPattern, valueIndex) { return true }
  if valueIndex >= value.length { return false }
  if !doubleStar && value.substring(valueIndex, valueIndex + 1) == "/" { return false }
  return globMatches(pattern, value, patternIndex, valueIndex + 1)
}

function collectResourceFiles(path: string, baseDirectory: string, pattern: string, results: string[]): void {
  if isDirectory(path) {
    for entry of try! readDir(path) { collectResourceFiles(outputPath(path, entry.name), baseDirectory, pattern, results) }
    return
  }
  prefix := if baseDirectory.endsWith("/") then baseDirectory else baseDirectory + "/"
  relative := if path.startsWith(prefix) then path.substring(prefix.length, path.length) else fileName(path)
  relativePattern := if pattern.startsWith(prefix) then pattern.substring(prefix.length, pattern.length) else fileName(pattern)
  if globMatches(relativePattern, relative) { results.push(path) }
}

function materializeMacOSResources(config: MacOSAppConfig, resourcesDirectory: string): void {
  let destinations: string[] = []
  for resource of config.resources {
    let files: string[] = []
    let baseDirectory = globBaseDirectory(resource.sourcePath)
    if resource.sourcePath.contains("*") {
      if exists(baseDirectory) { collectResourceFiles(baseDirectory, baseDirectory, resource.sourcePath, files) }
    } else if isDirectory(resource.sourcePath) {
      collectResourceFiles(resource.sourcePath, resource.sourcePath, resource.sourcePath + "/**", files)
      baseDirectory = resource.sourcePath
    } else if exists(resource.sourcePath) {
      files.push(resource.sourcePath)
      baseDirectory = parentPath(resource.sourcePath)
    }
    if files.length == 0 { panic("No files matched resource pattern: " + resource.sourcePath) }
    prefix := if baseDirectory.endsWith("/") then baseDirectory else baseDirectory + "/"
    for sourcePath of files {
      relative := if sourcePath.startsWith(prefix) then sourcePath.substring(prefix.length, sourcePath.length) else fileName(sourcePath)
      destinationRoot := if resource.destination == "" then resourcesDirectory else outputPath(resourcesDirectory, resource.destination)
      destinationPath := outputPath(destinationRoot, relative)
      if destinations.contains(destinationPath) { panic("Duplicate macOS app resource destination: " + destinationPath) }
      destinations.push(destinationPath)
      copyPath(sourcePath, destinationPath)
    }
  }
}

function runRequiredCommand(command: string, arguments: string[], description: string): Result<void, string> {
  result := runMacOSCommand(command, arguments)
  if result.exitCode != 0 {
    output := if result.error != "" then result.error else BlobReader(result.output).readString(long(result.output.length))
    return Failure(description + " failed: " + output)
  }
  return Success()
}

function generateMacOSIcon(iconPath: string, destinationPath: string, workRoot: string): Result<void, string> {
  iconset := outputPath(workRoot, ".doof-app.iconset")
  removeTree(iconset)
  ensureDirectory(iconset)
  readonly sizes = [16, 32, 32, 64, 128, 256, 256, 512, 512, 1024]
  readonly names = [
    "icon_16x16.png", "icon_16x16@2x.png", "icon_32x32.png", "icon_32x32@2x.png",
    "icon_128x128.png", "icon_128x128@2x.png", "icon_256x256.png", "icon_256x256@2x.png",
    "icon_512x512.png", "icon_512x512@2x.png",
  ]
  for index of 0..<sizes.length {
    try runRequiredCommand("sips", ["-z", string(sizes[index]), string(sizes[index]), iconPath, "--out", outputPath(iconset, names[index])], "macOS icon resize")
  }
  result := runRequiredCommand("iconutil", ["-c", "icns", iconset, "-o", destinationPath], "macOS icon generation")
  removeTree(iconset)
  return result
}

class EmbeddedCode {
  sourcePath: string
  bundledRoot: string
  bundledPath: string
  bundleReference: string
  installId: string = ""
}

function commandText(command: string, arguments: string[], description: string): Result<string, string> {
  result := runMacOSCommand(command, arguments)
  if result.exitCode != 0 {
    output := if result.error != "" then result.error else BlobReader(result.output).readString(long(result.output.length))
    return Failure(description + " failed: " + output)
  }
  return Success(BlobReader(result.output).readString(long(result.output.length)))
}

function resolveEmbeddedLibrary(name: string, libraryPaths: string[], buildDirectory: string): Result<string, string> {
  readonly candidates = ["lib" + name + ".dylib", name + ".dylib", "lib" + name + ".so", name + ".so", name + ".framework"]
  for libraryPath of libraryPaths {
    resolvedRoot := if libraryPath.startsWith("/") then libraryPath else outputPath(buildDirectory, libraryPath)
    for candidate of candidates {
      candidatePath := outputPath(resolvedRoot, candidate)
      if exists(candidatePath) { return Success(candidatePath) }
    }
  }
  return Failure("Could not resolve embedded linked library \"" + name + "\" in configured library paths")
}

function firstNonemptyOutputLine(output: string): string {
  for line of output.split("\n") {
    let start = 0
    while start < line.length && (line.substring(start, start + 1) == " " || line.substring(start, start + 1) == "\t") { start = start + 1 }
    if start < line.length { return line.substring(start, line.length) }
  }
  return ""
}

function readMachOInstallId(path: string): Result<string, string> {
  try commandOutput := commandText("otool", ["-D", path], "reading embedded library install name")
  let first = true
  for line of commandOutput.split("\n") {
    if first { first = false; continue }
    trimmed := firstNonemptyOutputLine(line)
    if trimmed != "" { return Success(trimmed) }
  }
  return Success("")
}

function frameworkBinary(frameworkPath: string): Result<string, string> {
  nameWithExtension := fileName(frameworkPath)
  name := nameWithExtension.substring(0, nameWithExtension.length - ".framework".length)
  direct := outputPath(frameworkPath, name)
  if exists(direct) { return Success(direct) }
  versioned := outputPath(frameworkPath, "Versions/Current/" + name)
  if exists(versioned) { return Success(versioned) }
  return Failure("Could not find executable in embedded framework: " + frameworkPath)
}

function frameworkReference(frameworkName: string, installId: string, bundledBinary: string, bundledRoot: string): string {
  marker := frameworkName + "/"
  for index of 0..<(installId.length - marker.length + 1) {
    if installId.substring(index, index + marker.length) == marker {
      return "@rpath/" + frameworkName + "/" + installId.substring(index + marker.length, installId.length)
    }
  }
  prefix := if bundledRoot.endsWith("/") then bundledRoot else bundledRoot + "/"
  relative := if bundledBinary.startsWith(prefix) then bundledBinary.substring(prefix.length, bundledBinary.length) else fileName(bundledBinary)
  return "@rpath/" + frameworkName + "/" + relative
}

function planEmbeddedCode(sourcePath: string, frameworksDirectory: string): Result<EmbeddedCode, string> {
  if !exists(sourcePath) { return Failure("Embedded library not found: " + sourcePath) }
  if sourcePath.endsWith(".framework") {
    if !isDirectory(sourcePath) { return Failure("Embedded framework must be a directory: " + sourcePath) }
    try sourceBinary := frameworkBinary(sourcePath)
    try installId := readMachOInstallId(sourceBinary)
    frameworkName := fileName(sourcePath)
    bundledRoot := outputPath(frameworksDirectory, frameworkName)
    sourcePrefix := if sourcePath.endsWith("/") then sourcePath else sourcePath + "/"
    relativeBinary := sourceBinary.substring(sourcePrefix.length, sourceBinary.length)
    bundledPath := outputPath(bundledRoot, relativeBinary)
    return Success(EmbeddedCode {
      sourcePath, bundledRoot, bundledPath,
      bundleReference: frameworkReference(frameworkName, installId, bundledPath, bundledRoot),
      installId,
    })
  }
  if !sourcePath.endsWith(".dylib") && !sourcePath.endsWith(".so") {
    return Failure("Embedded library must be a .dylib, .so, or .framework: " + sourcePath)
  }
  try installId := readMachOInstallId(sourcePath)
  destinationName := if installId == "" then fileName(sourcePath) else fileName(installId)
  bundledPath := outputPath(frameworksDirectory, destinationName)
  return Success(EmbeddedCode {
    sourcePath,
    bundledRoot: bundledPath,
    bundledPath,
    bundleReference: "@rpath/" + destinationName,
    installId,
  })
}

function machODependencies(path: string): Result<string[], string> {
  try commandOutput := commandText("otool", ["-L", path], "reading Mach-O dependencies")
  let dependencies: string[] = []
  let first = true
  for line of commandOutput.split("\n") {
    if first { first = false; continue }
    trimmed := firstNonemptyOutputLine(line)
    if trimmed == "" { continue }
    let end = 0
    while end < trimmed.length && trimmed.substring(end, end + 1) != " " && trimmed.substring(end, end + 1) != "\t" { end = end + 1 }
    if end > 0 { dependencies.push(trimmed.substring(0, end)) }
  }
  return Success(dependencies)
}

function isSystemMachODependency(path: string): bool {
  return path.startsWith("/System/Library/") || path.startsWith("/usr/lib/")
}

function embeddedDependency(dependency: string, embedded: EmbeddedCode[]): EmbeddedCode | null {
  for code of embedded {
    if dependency == code.bundleReference || dependency == code.sourcePath || dependency == code.installId ||
      fileName(dependency) == fileName(code.bundleReference) { return code }
  }
  return null
}

function rewriteEmbeddedDependencies(codePath: string, embedded: EmbeddedCode[]): Result<void, string> {
  try dependencies := machODependencies(codePath)
  for dependency of dependencies {
    if isSystemMachODependency(dependency) { continue }
    target := embeddedDependency(dependency, embedded)
    if target == null {
      return Failure("Mach-O file " + codePath + " references non-system dependency " + dependency + ", which is not listed in embeddedLibraries")
    }
    if dependency != target!.bundleReference {
      try runRequiredCommand("install_name_tool", ["-change", dependency, target!.bundleReference, codePath], "rewriting embedded library dependency")
    }
  }
  return Success()
}

function ensureMachORPath(codePath: string, rpath: string): Result<void, string> {
  try loadCommands := commandText("otool", ["-l", codePath], "reading Mach-O rpaths")
  if loadCommands.contains("path " + rpath + " ") { return Success() }
  return runRequiredCommand("install_name_tool", ["-add_rpath", rpath, codePath], "adding bundled library rpath")
}

function embedMacOSLibraries(
  executablePath: string,
  config: MacOSAppConfig,
  libraryPaths: string[],
  buildDirectory: string,
  contentsDirectory: string,
): Result<void, string> {
  if config.embeddedLibraries.length == 0 { return Success() }
  frameworksDirectory := outputPath(contentsDirectory, "Frameworks")
  ensureDirectory(frameworksDirectory)
  let embedded: EmbeddedCode[] = []
  let destinations: string[] = []
  for entry of config.embeddedLibraries {
    let sourcePath = entry.path
    if sourcePath == "" {
      try resolvedSourcePath := resolveEmbeddedLibrary(entry.library, libraryPaths, buildDirectory)
      sourcePath = resolvedSourcePath
    }
    try code := planEmbeddedCode(sourcePath, frameworksDirectory)
    if destinations.contains(code.bundledRoot) { return Failure("Duplicate embedded library destination: " + code.bundledRoot) }
    destinations.push(code.bundledRoot)
    removeTree(code.bundledRoot)
    copyPath(code.sourcePath, code.bundledRoot)
    if !isDirectory(code.bundledRoot) { try runRequiredCommand("chmod", ["+x", code.bundledRoot], "marking embedded library executable") }
    embedded.push(code)
  }
  try rewriteEmbeddedDependencies(executablePath, embedded)
  for code of embedded {
    try rewriteEmbeddedDependencies(code.bundledPath, embedded)
    try runRequiredCommand("install_name_tool", ["-id", code.bundleReference, code.bundledPath], "setting embedded library install name")
    try ensureMachORPath(code.bundledPath, "@loader_path")
  }
  try ensureMachORPath(executablePath, "@executable_path/../Frameworks")
  return Success()
}

function collectNestedMacOSCode(path: string, results: string[]): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { collectNestedMacOSCode(outputPath(path, entry.name), results) }
    if path.endsWith(".framework") || path.endsWith(".appex") || path.endsWith(".xpc") { results.push(path) }
    return
  }
  if path.endsWith(".dylib") || path.endsWith(".so") { results.push(path) }
}

/** Assembles and ad-hoc signs one runnable development app bundle. */
export function assembleMacOSApp(
  buildDirectory: string,
  executablePath: string,
  config: MacOSAppConfig,
  libraryPaths: string[],
): Result<string, string> {
  if hostPlatform() != "macos" { return Failure("macOS app builds are only supported on macOS") }
  appPath := outputPath(buildDirectory, config.executableName + ".app")
  removeTree(appPath)
  contentsDirectory := outputPath(appPath, "Contents")
  macosDirectory := outputPath(contentsDirectory, "MacOS")
  resourcesDirectory := outputPath(contentsDirectory, "Resources")
  ensureDirectory(macosDirectory)
  ensureDirectory(resourcesDirectory)
  bundleExecutable := outputPath(macosDirectory, config.executableName)
  copyPath(executablePath, bundleExecutable)
  try runRequiredCommand("chmod", ["+x", bundleExecutable], "marking bundled executable")
  try! writeText(outputPath(contentsDirectory, "Info.plist"), renderMacOSInfoPlist(config))
  try! writeText(outputPath(contentsDirectory, "PkgInfo"), "APPL????")
  if config.iconPath != "" {
    try generateMacOSIcon(config.iconPath, outputPath(resourcesDirectory, config.executableName + ".icns"), buildDirectory)
  }
  materializeMacOSResources(config, resourcesDirectory)
  try embedMacOSLibraries(bundleExecutable, config, libraryPaths, buildDirectory, contentsDirectory)
  let nested: string[] = []
  collectNestedMacOSCode(outputPath(contentsDirectory, "Frameworks"), nested)
  for path of nested {
    try runRequiredCommand("codesign", macOSCodesignArguments(path, "-", "ad-hoc"), "ad-hoc signing nested macOS code")
  }
  try runRequiredCommand("codesign", macOSCodesignArguments(appPath, "-", "ad-hoc"), "ad-hoc signing macOS app")
  return Success(appPath)
}

function developerIdIdentity(configured: string): Result<string, string> {
  if configured != "" { return Success(configured) }
  result := runMacOSCommand("security", ["find-identity", "-v", "-p", "codesigning"])
  if result.exitCode != 0 { return Failure("Could not discover Developer ID Application signing identities") }
  commandOutput := BlobReader(result.output).readString(long(result.output.length))
  let identities: string[] = []
  readonly marker = "\"Developer ID Application:"
  for line of commandOutput.split("\n") {
    let start = -1
    for index of 0..<(line.length - marker.length + 1) {
      if line.substring(index, index + marker.length) == marker { start = index + 1; break }
    }
    if start < 0 { continue }
    let end = start
    while end < line.length && line.substring(end, end + 1) != "\"" { end = end + 1 }
    if end > start { identities.push(line.substring(start, end)) }
  }
  if identities.length == 0 { return Failure("No Developer ID Application signing identity found; pass --macos-sign-identity or use --macos-signing ad-hoc") }
  if identities.length > 1 { return Failure("Multiple Developer ID Application identities found; pass --macos-sign-identity") }
  return Success(identities[0])
}

function effectiveEntitlements(config: MacOSPackageConfig, buildDirectory: string): Result<string, string> {
  if !config.sandbox { return Success(config.entitlementsPath) }
  destinationPath := outputPath(buildDirectory, ".doof-package-entitlements.plist")
  if config.entitlementsPath != "" {
    copyPath(config.entitlementsPath, destinationPath)
    sandboxValue := runMacOSCommand("plutil", ["-extract", "com.apple.security.app-sandbox", "raw", "-o", "-", destinationPath])
    if sandboxValue.exitCode == 0 {
      value := BlobReader(sandboxValue.output).readString(long(sandboxValue.output.length)).toLowerCase()
      if value.contains("false") {
        return Failure("macOS sandbox is enabled but the supplied entitlements explicitly disable it")
      }
    }
    replaced := runMacOSCommand("plutil", ["-replace", "com.apple.security.app-sandbox", "-bool", "YES", destinationPath])
    if replaced.exitCode != 0 {
      try runRequiredCommand("plutil", ["-insert", "com.apple.security.app-sandbox", "-bool", "YES", destinationPath], "enabling App Sandbox")
    }
  } else {
    try! writeText(destinationPath, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>\n")
  }
  return Success(destinationPath)
}

/** Applies release signing, verifies the bundle, and creates the distributable zip. */
export function signAndArchiveMacOSApp(
  appPath: string,
  archivePath: string,
  config: MacOSPackageConfig,
  buildDirectory: string,
): Result<void, string> {
  let identity = "-"
  if config.signing != "ad-hoc" {
    try resolvedIdentity := developerIdIdentity(config.identity)
    identity = resolvedIdentity
  }
  try entitlementsPath := effectiveEntitlements(config, buildDirectory)
  let nested: string[] = []
  collectNestedMacOSCode(outputPath(appPath, "Contents/Frameworks"), nested)
  collectNestedMacOSCode(outputPath(appPath, "Contents/PlugIns"), nested)
  collectNestedMacOSCode(outputPath(appPath, "Contents/XPCServices"), nested)
  for path of nested { try runRequiredCommand("codesign", macOSCodesignArguments(path, identity, config.signing), "signing nested macOS code") }
  try runRequiredCommand("codesign", macOSCodesignArguments(appPath, identity, config.signing, entitlementsPath), "signing macOS app")
  try runRequiredCommand("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "verifying macOS app signature")
  ensureDirectory(parentPath(archivePath))
  if exists(archivePath) { try! remove(archivePath) }
  try runRequiredCommand("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath], "archiving macOS app")
  return Success()
}
