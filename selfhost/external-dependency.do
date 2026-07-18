// External archive/Git vendor acquisition for the self-hosted driver.
//
// The manifest parser owns validation. This module owns host mutation, stable
// sentinels, target command interpolation, and subprocess execution.

import { ExternalDependency, ExternalDependencyCommand, PackageManifest } from "./package-manifest"
import { BlobReader } from "std/blob"
import { sha256Hex, sha256HexString } from "std/crypto"
import { exists, isDirectory, mkdir, readBlob, readDir, readText, remove, rename, writeBlob, writeText } from "std/fs"
import { createClient, get } from "std/http"
import { formatJsonValue, parseJsonValue } from "std/json"
import { ExecOptions, platform, run } from "std/os"
import { dirname, join } from "std/path"

readonly EXTERNAL_SOURCE_MARKER = ".doof-external.json"
readonly MAX_EXTERNAL_COMMAND_OUTPUT_BYTES = 1048576L

/** Target values available to external dependency build commands. */
export class ExternalDependencyTarget {
  nativeTarget: string
  sdkPath: string = ""
  targetTriple: string = ""
  configureHost: string = ""
  jobs: int = 1
}

function externalPath(directory: string, name: string): string => join([directory, name])

function ensureExternalDirectory(path: string): Result<void, string> {
  if path == "" || exists(path) { return Success() }
  parent := dirname(path)
  if parent != path { try ensureExternalDirectory(parent) }
  _ := mkdir(path) else error { return Failure("Could not create directory " + path) }
  return Success()
}

function removeExternalTree(path: string): Result<void, string> {
  if !exists(path) { return Success() }
  if isDirectory(path) {
    entries := readDir(path) else error { return Failure("Could not read directory " + path) }
    for entry of entries { try removeExternalTree(externalPath(path, entry.name)) }
  }
  _ := remove(path) else error { return Failure("Could not remove " + path) }
  return Success()
}

function copyExternalPath(sourcePath: string, destinationPath: string): Result<void, string> {
  if isDirectory(sourcePath) {
    try ensureExternalDirectory(destinationPath)
    entries := readDir(sourcePath) else error { return Failure("Could not read directory " + sourcePath) }
    for entry of entries {
      try copyExternalPath(externalPath(sourcePath, entry.name), externalPath(destinationPath, entry.name))
    }
    return Success()
  }
  try ensureExternalDirectory(dirname(destinationPath))
  blob := readBlob(sourcePath) else error { return Failure("Could not read " + sourcePath) }
  _ := writeBlob(destinationPath, blob) else error { return Failure("Could not write " + destinationPath) }
  return Success()
}

function externalPathWithinRoot(path: string, root: string): bool {
  boundary := if root.endsWith("/") then root else root + "/"
  return path == root || path.startsWith(boundary)
}

function commandOutput(command: string, arguments: string[], options: ExecOptions = ExecOptions {}): Result<string, string> {
  result := run(command, arguments, options) else error { return Failure(command + ": " + error) }
  output := BlobReader(result.stdout).readString(long(result.stdout.length)).trim()
  if result.exitCode != 0 {
    return Failure(command + " exited with code " + string(result.exitCode) + if output == "" then "" else ":\n" + output)
  }
  return Success(output)
}

function externalCommandFingerprint(command: ExternalDependencyCommand): string {
  let result = command.program + "\n" + command.workingDirectory + "\n"
  for argument of command.args { result += "arg=" + argument + "\n" }
  for key, value of command.env { result += "env=" + key + "=" + value + "\n" }
  return result
}

function externalSourceFingerprint(dependency: ExternalDependency): string {
  let value = "schema=1\nname=" + dependency.name + "\nkind=" + dependency.kind + "\nurl=" + dependency.url +
    "\ndestination=" + dependency.destination + "\nsha256=" + dependency.sha256 +
    "\nstrip=" + string(dependency.stripComponents) + "\nref=" + dependency.ref + "\ncommit=" + dependency.commit + "\n"
  for copyFile of dependency.copyFiles {
    value += "copy=" + copyFile.source + "\u0000" + copyFile.destination + "\n"
  }
  return sha256HexString(value)
}

function externalNativeFingerprint(
  dependency: ExternalDependency,
  target: ExternalDependencyTarget,
): string {
  let value = "schema=1\ntarget=" + target.nativeTarget + "\nsdk=" + target.sdkPath +
    "\ntriple=" + target.targetTriple + "\nhost=" + target.configureHost + "\n"
  for command of dependency.commands { value += externalCommandFingerprint(command) }
  return sha256HexString(value)
}

function markerMatches(path: string, fingerprint: string): bool {
  if !exists(path) { return false }
  source := readText(path) else { return false }
  parsed := parseJsonValue(source) else { return false }
  case parsed {
    object: JsonObject -> {
      if !object.has("fingerprint") { return false }
      value := object.get("fingerprint") else { return false }
      case value {
        text: string -> return text == fingerprint
        _ -> return false
      }
    }
    _ -> return false
  }
}

function markerContentMatches(path: string, expected: string): bool {
  if !exists(path) { return false }
  source := readText(path) else { return false }
  return source == expected
}

function externalJsonSet(object: JsonObject, key: string, value: JsonValue): void {
  object.set(key, value)
}

function externalCommandsJson(commands: ExternalDependencyCommand[]): JsonValue[] {
  let values: JsonValue[] = []
  for command of commands {
    let object: JsonObject = {}
    externalJsonSet(object, "program", command.program)
    let arguments: JsonValue[] = []
    for argument of command.args { arguments.push(argument) }
    externalJsonSet(object, "args", arguments)
    let environment: JsonObject = {}
    for key, value of command.env { externalJsonSet(environment, key, value) }
    externalJsonSet(object, "env", environment)
    if command.workingDirectory != "" { externalJsonSet(object, "workingDirectory", command.workingDirectory) }
    values.push(object)
  }
  return values
}

function externalSourceMarkerContent(dependency: ExternalDependency, fingerprint: string): string {
  let marker: JsonObject = {}
  externalJsonSet(marker, "schemaVersion", 1)
  externalJsonSet(marker, "name", dependency.name)
  externalJsonSet(marker, "kind", dependency.kind)
  externalJsonSet(marker, "url", dependency.url)
  externalJsonSet(marker, "destination", dependency.destination)
  externalJsonSet(marker, "acquiredAt", "")
  externalJsonSet(marker, "platform", platform())
  externalJsonSet(marker, "fingerprint", fingerprint)
  if dependency.kind == "archive" {
    externalJsonSet(marker, "sha256", dependency.sha256)
    externalJsonSet(marker, "stripComponents", dependency.stripComponents)
    let copies: JsonValue[] = []
    for copyFile of dependency.copyFiles {
      let copy: JsonObject = {}
      externalJsonSet(copy, "from", copyFile.source)
      externalJsonSet(copy, "to", copyFile.destination)
      copies.push(copy)
    }
    externalJsonSet(marker, "copyFiles", copies)
  } else {
    externalJsonSet(marker, "ref", dependency.ref)
    externalJsonSet(marker, "commit", dependency.commit)
  }
  return formatJsonValue(marker) + "\n"
}

function externalNativeMarkerContent(
  dependency: ExternalDependency,
  target: ExternalDependencyTarget,
  fingerprint: string,
): string {
  let marker: JsonObject = {}
  externalJsonSet(marker, "schemaVersion", 1)
  externalJsonSet(marker, "nativeTarget", target.nativeTarget)
  externalJsonSet(marker, "builtAt", "")
  externalJsonSet(marker, "sdkPath", target.sdkPath)
  externalJsonSet(marker, "targetTriple", target.targetTriple)
  externalJsonSet(marker, "configureHost", target.configureHost)
  externalJsonSet(marker, "commands", externalCommandsJson(dependency.commands))
  externalJsonSet(marker, "fingerprint", fingerprint)
  return formatJsonValue(marker) + "\n"
}

function isEmptyExternalDirectory(path: string): bool {
  if !isDirectory(path) { return false }
  entries := readDir(path) else { return false }
  return entries.length == 0
}

function copyArchiveContents(sourceRoot: string, destination: string): Result<void, string> {
  if !isDirectory(sourceRoot) { return Failure("stripped archive root is not a directory: " + sourceRoot) }
  try ensureExternalDirectory(destination)
  entries := readDir(sourceRoot) else error { return Failure("Could not read extracted archive") }
  for entry of entries { try copyExternalPath(externalPath(sourceRoot, entry.name), externalPath(destination, entry.name)) }
  return Success()
}

function strippedArchiveRoot(extractRoot: string, count: int, dependencyName: string): Result<string, string> {
  let current = extractRoot
  for ignored of 0..<count {
    entries := readDir(current) else error { return Failure("Could not inspect archive for " + dependencyName) }
    let selected = ""
    let selectedCount = 0
    for entry of entries {
      if entry.name == "__MACOSX" { continue }
      selected = entry.name
      selectedCount += 1
    }
    if selectedCount != 1 {
      return Failure("External dependency " + dependencyName + " archive cannot strip " + string(count) + " component(s) from multiple roots")
    }
    current = externalPath(current, selected)
  }
  return Success(current)
}

function downloadExternalArchive(url: string): Result<readonly byte[], string> {
  // Local URLs keep acquisition fixtures hermetic; network transport remains
  // owned by std/http rather than a host curl executable.
  if url.startsWith("file://") {
    path := url.substring(7, url.length)
    blob := readBlob(path) else error { return Failure("Could not read local archive " + path) }
    return Success(blob)
  }
  client := createClient()
  response := get(client, url) else error {
    return Failure("HTTP request failed [" + error.kind + ", code=" + error.code + "]: " + error.message)
  }
  if !response.ok() {
    return Failure("HTTP request failed with status " + string(response.status) + " " + response.statusText)
  }
  return Success(response.getBlob())
}

function acquireArchive(dependency: ExternalDependency, destination: string, stagingRoot: string): Result<void, string> {
  archivePath := externalPath(stagingRoot, "source")
  extractRoot := externalPath(stagingRoot, "extract")
  payloadRoot := externalPath(stagingRoot, "payload")
  try ensureExternalDirectory(extractRoot)
  try archive := downloadExternalArchive(dependency.url)
  _ := writeBlob(archivePath, archive) else error { return Failure("Could not stage downloaded archive") }
  actualSha256 := sha256Hex(archive)
  if actualSha256 != dependency.sha256 {
    return Failure("External dependency " + dependency.name + " checksum mismatch: expected " + dependency.sha256 + ", got " + actualSha256)
  }
  if dependency.url.toLowerCase().endsWith(".zip") {
    try ignoredUnzip := commandOutput("unzip", ["-q", archivePath, "-d", extractRoot])
  } else {
    try ignoredTar := commandOutput("tar", ["-xf", archivePath, "-C", extractRoot])
  }
  try sourceRoot := strippedArchiveRoot(extractRoot, dependency.stripComponents, dependency.name)
  try copyArchiveContents(sourceRoot, payloadRoot)
  for copyFile of dependency.copyFiles {
    sourcePath := externalPath(payloadRoot, copyFile.source)
    destinationPath := externalPath(payloadRoot, copyFile.destination)
    if !externalPathWithinRoot(sourcePath, payloadRoot) || !externalPathWithinRoot(destinationPath, payloadRoot) {
      return Failure("External dependency " + dependency.name + " copyFiles entries must stay within the destination")
    }
    try copyExternalPath(sourcePath, destinationPath)
  }
  _ := rename(payloadRoot, destination) else error { return Failure("Could not install external dependency " + dependency.name) }
  return Success()
}

function acquireGit(dependency: ExternalDependency, destination: string, stagingRoot: string): Result<void, string> {
  repositoryRoot := externalPath(stagingRoot, "repository")
  try ignoredClone := commandOutput(
    "git", ["clone", "--depth", "1", "--branch", dependency.ref, dependency.url, repositoryRoot],
    ExecOptions { withStdin: false, mergeStderrIntoStdout: true, maxOutputBytes: MAX_EXTERNAL_COMMAND_OUTPUT_BYTES },
  )
  try actualCommit := commandOutput("git", ["-C", repositoryRoot, "rev-parse", "HEAD"])
  if actualCommit.toLowerCase() != dependency.commit {
    return Failure("External dependency " + dependency.name + " commit mismatch: expected " + dependency.commit + ", got " + actualCommit)
  }
  try removeExternalTree(externalPath(repositoryRoot, ".git"))
  _ := rename(repositoryRoot, destination) else error { return Failure("Could not install external dependency " + dependency.name) }
  return Success()
}

/** Applies the documented external command substitutions without shell interpolation. */
export function applyExternalDependencySubstitutions(
  value: string,
  packageRoot: string,
  destination: string,
  target: ExternalDependencyTarget,
): string {
  return value.replaceAll("\${packageRoot}", packageRoot)
    .replaceAll("\${destination}", destination)
    .replaceAll("\${jobs}", string(if target.jobs < 1 then 1 else target.jobs))
    .replaceAll("\${nativeTarget}", target.nativeTarget)
    .replaceAll("\${sdkPath}", target.sdkPath)
    .replaceAll("\${targetTriple}", target.targetTriple)
    .replaceAll("\${configureHost}", target.configureHost)
}

function runExternalCommands(
  dependency: ExternalDependency,
  packageRoot: string,
  destination: string,
  target: ExternalDependencyTarget,
): Result<void, string> {
  nativeMarker := externalPath(destination, ".doof-external-native-" + target.nativeTarget + ".json")
  fingerprint := externalNativeFingerprint(dependency, target)
  if markerMatches(nativeMarker, fingerprint) {
    content := externalNativeMarkerContent(dependency, target, fingerprint)
    if !markerContentMatches(nativeMarker, content) {
      _ := writeText(nativeMarker, content) else error {
        return Failure("Could not refresh external dependency native marker")
      }
    }
    return Success()
  }
  for index of 0..<dependency.commands.length {
    command := dependency.commands[index]
    workingDirectory := if command.workingDirectory == ""
      then destination
      else externalPath(destination, applyExternalDependencySubstitutions(command.workingDirectory, packageRoot, destination, target))
    if !externalPathWithinRoot(workingDirectory, destination) {
      return Failure("External dependency " + dependency.name + " command workingDirectory must stay within the destination")
    }
    let environment: Map<string, string> = {}
    for key, value of command.env {
      environment.set(key, applyExternalDependencySubstitutions(value, packageRoot, destination, target))
    }
    program := applyExternalDependencySubstitutions(command.program, packageRoot, destination, target)
    let arguments: string[] = []
    for argument of command.args {
      arguments.push(applyExternalDependencySubstitutions(argument, packageRoot, destination, target))
    }
    _ := commandOutput(program, arguments, ExecOptions {
      cwd: workingDirectory, env: environment.buildReadonly(), withStdin: false, mergeStderrIntoStdout: true,
      maxOutputBytes: MAX_EXTERNAL_COMMAND_OUTPUT_BYTES,
    }) else error {
      return Failure("External dependency " + dependency.name + " command " + string(index + 1) + " failed: " + error)
    }
  }
  _ := writeText(nativeMarker, externalNativeMarkerContent(dependency, target, fingerprint)) else error {
    return Failure("Could not write external dependency native marker")
  }
  return Success()
}

/** Acquires and target-configures every vendored tree owned by one package. */
export function acquirePackageExternalDependencies(
  manifest: PackageManifest,
  target: ExternalDependencyTarget,
): Result<void, string> {
  if manifest.manifestPath == "" { return Success() }
  for dependency of manifest.externalDependencies {
    destination := externalPath(manifest.rootDirectory, dependency.destination)
    sourceMarker := externalPath(destination, EXTERNAL_SOURCE_MARKER)
    fingerprint := externalSourceFingerprint(dependency)
    if !markerMatches(sourceMarker, fingerprint) {
      if exists(destination) {
        if !exists(sourceMarker) && !isEmptyExternalDirectory(destination) {
          return Failure("External dependency " + dependency.name + " destination already exists without " + EXTERNAL_SOURCE_MARKER + ": " + destination)
        }
        try removeExternalTree(destination)
      }
      parent := dirname(destination)
      try ensureExternalDirectory(parent)
      stagingRoot := externalPath(parent, ".doof-" + dependency.name + "-staging")
      if exists(stagingRoot) { try removeExternalTree(stagingRoot) }
      try ensureExternalDirectory(stagingRoot)
      acquisition := if dependency.kind == "archive"
        then acquireArchive(dependency, destination, stagingRoot)
        else acquireGit(dependency, destination, stagingRoot)
      _ := acquisition else error {
        try removeExternalTree(destination)
        try removeExternalTree(stagingRoot)
        return Failure("Failed to acquire external dependency " + dependency.name + ": " + error)
      }
      try removeExternalTree(stagingRoot)
    }
    // Refresh matching older self-host sentinels into the reference-compatible
    // schema without reacquiring their payload.
    content := externalSourceMarkerContent(dependency, fingerprint)
    if !markerContentMatches(sourceMarker, content) {
      _ := writeText(sourceMarker, content) else error {
        return Failure("Could not refresh external dependency marker")
      }
    }
    if dependency.commands.length > 0 {
      _ := runExternalCommands(dependency, manifest.rootDirectory, destination, target) else error {
        nativeMarker := externalPath(destination, ".doof-external-native-" + target.nativeTarget + ".json")
        if exists(nativeMarker) { try removeExternalTree(nativeMarker) }
        return Failure("Failed to build external dependency " + dependency.name + " for " + target.nativeTarget + ": " + error)
      }
    }
  }
  return Success()
}
