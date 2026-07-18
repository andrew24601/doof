// Workspace-local exact Git package acquisition for the self-hosted driver.

import { BlobReader } from "std/blob"
import { exists, isDirectory, mkdir, readDir, readText, remove, rename, writeText } from "std/fs"
import { formatJsonValue, parseJsonValue } from "std/json"
import { ExecOptions, pid, run } from "std/os"
import { dirname, join } from "std/path"
import { canonicalDependencyUrl } from "./std-catalog"

readonly PACKAGE_ACQUISITION_RECEIPT = ".doof-acquisition.json"
readonly PACKAGE_ACQUISITION_SCHEMA_VERSION = 1

export class ExactPackageSource {
  name: string
  expectedManifestName: string = ""
  url: string
  ref: string
  commit: string
}

export class AcquiredPackage {
  source: ExactPackageSource
  rootDirectory: string
  mutable: bool = false
}

/** Returns the disposable package-acquisition root owned by one workspace. */
export function workspacePackageAcquisitionRoot(workspaceRoot: string): string => join([workspaceRoot, ".doof", "packages"])

/** A package's expanded content and acquisition receipt share this directory. */
export function packageAcquisitionPath(packagesRoot: string, packageName: string): string => join([packagesRoot, packageName])

export function packageAcquisitionReceiptPath(packageRoot: string): string => join([packageRoot, PACKAGE_ACQUISITION_RECEIPT])

export function acquireExactGitPackage(
  source: ExactPackageSource,
  packagesRoot: string,
): Result<AcquiredPackage, string> {
  if source.commit.length != 40 { return Failure("Exact package " + source.name + " requires a 40-character commit") }
  if !validPackageAcquisitionName(source.name) { return Failure("Invalid acquired package name " + source.name) }
  root := packageAcquisitionPath(packagesRoot, source.name)
  if reusableAcquiredPackage(root, source) {
    return Success(AcquiredPackage { source, rootDirectory: root })
  }

  try ensurePackageDirectory(dirname(root))
  staging := root + ".staging-" + string(pid())
  if exists(staging) { try removePackageTree(staging) }
  clone := packageCommand("git", ["clone", "--depth", "1", "--branch", source.ref, source.url, staging])
  _ := clone else error { return Failure("Failed to acquire package " + source.name + ": " + error) }
  actual := packageCommand("git", ["-C", staging, "rev-parse", "HEAD"]) else error {
    try removePackageTree(staging)
    return Failure("Failed to inspect package " + source.name + ": " + error)
  }
  if actual.toLowerCase() != source.commit.toLowerCase() {
    try removePackageTree(staging)
    return Failure("Package " + source.name + " commit mismatch: expected " + source.commit.toLowerCase() + ", got " + actual.toLowerCase())
  }
  _ := validateAcquiredPackage(staging, source) else error {
    try removePackageTree(staging)
    return Failure(error)
  }
  _ := removePackageTree(join([staging, ".git"])) else error {
    try removePackageTree(staging)
    return Failure("Could not remove Git metadata for package " + source.name + ": " + error)
  }
  _ := writeText(packageAcquisitionReceiptPath(staging), renderAcquisitionReceipt(source)) else {
    try removePackageTree(staging)
    return Failure("Could not write acquisition receipt for package " + source.name)
  }
  if exists(root) {
    _ := removePackageTree(root) else error {
      try removePackageTree(staging)
      return Failure("Could not replace acquired package " + source.name + ": " + error)
    }
  }
  _ := rename(staging, root) else {
    try removePackageTree(staging)
    return Failure("Could not finalize package " + source.name)
  }
  return Success(AcquiredPackage { source, rootDirectory: root })
}

function validPackageAcquisitionName(name: string): bool {
  if name == "" || name.startsWith("/") || name.contains("\\") { return false }
  for segment of name.split("/") {
    if segment == "" || segment == "." || segment == ".." { return false }
  }
  return true
}

function reusableAcquiredPackage(root: string, source: ExactPackageSource): bool {
  if !isDirectory(root) || !acquisitionReceiptMatches(packageAcquisitionReceiptPath(root), source) { return false }
  _ := validateAcquiredPackage(root, source) else { return false }
  return true
}

function acquisitionReceiptMatches(path: string, source: ExactPackageSource): bool {
  receiptSource := readText(path) else { return false }
  parsed := parseJsonValue(receiptSource) else { return false }
  object := parsed as JsonObject else { return false }
  schemaVersion := acquisitionReceiptInt(object, "schemaVersion")
  name := acquisitionReceiptString(object, "name")
  url := acquisitionReceiptString(object, "url")
  ref := acquisitionReceiptString(object, "ref")
  commit := acquisitionReceiptString(object, "commit")
  return schemaVersion == PACKAGE_ACQUISITION_SCHEMA_VERSION && name == source.name &&
    url == canonicalDependencyUrl(source.url) && ref == source.ref && commit == source.commit.toLowerCase()
}

function acquisitionReceiptString(object: JsonObject, name: string): string | null {
  value := object.get(name) else { return null }
  text := value as string else { return null }
  return text
}

function acquisitionReceiptInt(object: JsonObject, name: string): int | null {
  value := object.get(name) else { return null }
  number := value as int else { return null }
  return number
}

function renderAcquisitionReceipt(source: ExactPackageSource): string {
  let receipt: JsonObject = {}
  receipt.set("schemaVersion", PACKAGE_ACQUISITION_SCHEMA_VERSION)
  receipt.set("name", source.name)
  receipt.set("url", canonicalDependencyUrl(source.url))
  receipt.set("ref", source.ref)
  receipt.set("commit", source.commit.toLowerCase())
  return formatJsonValue(receipt) + "\n"
}

function validateAcquiredPackage(root: string, source: ExactPackageSource): Result<void, string> {
  manifestPath := join([root, "doof.json"])
  manifestSource := readText(manifestPath) else { return Failure("Acquired package " + source.name + " is missing doof.json") }
  parsed := parseJsonValue(manifestSource) else { return Failure("Acquired package " + source.name + " has invalid doof.json") }
  object := parsed as JsonObject else { return Failure("Acquired package " + source.name + " has invalid doof.json") }
  nameValue := object.get("name") else { return Failure("Acquired package must declare name " + source.name) }
  name := nameValue as string else { return Failure("Acquired package name must be a string") }
  if source.expectedManifestName != "" && name != source.expectedManifestName {
    return Failure("Acquired package name mismatch: expected " + source.expectedManifestName + ", got " + name)
  }
  return Success()
}

function packageCommand(command: string, arguments: string[]): Result<string, string> {
  result := run(command, arguments, ExecOptions { withStdin: false, mergeStderrIntoStdout: true }) else error {
    return Failure(command + ": " + error)
  }
  output := BlobReader(result.stdout).readString(long(result.stdout.length)).trim()
  if result.exitCode != 0 { return Failure(command + " exited with code " + string(result.exitCode) + if output == "" then "" else ":\n" + output) }
  return Success(output)
}

function ensurePackageDirectory(path: string): Result<void, string> {
  if path == "" || exists(path) { return Success() }
  parent := dirname(path)
  if parent != path { try ensurePackageDirectory(parent) }
  _ := mkdir(path) else { return Failure("Could not create package acquisition directory " + path) }
  return Success()
}

function removePackageTree(path: string): Result<void, string> {
  if !exists(path) { return Success() }
  if isDirectory(path) {
    entries := readDir(path) else { return Failure("Could not read " + path) }
    for entry of entries { try removePackageTree(join([path, entry.name])) }
  }
  _ := remove(path) else { return Failure("Could not remove " + path) }
  return Success()
}
