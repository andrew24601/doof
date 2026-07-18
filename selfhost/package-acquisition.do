// Exact Git package acquisition for the self-hosted driver.

import { BlobReader } from "std/blob"
import { sha256HexString } from "std/crypto"
import { exists, isDirectory, mkdir, readDir, readText, remove, rename } from "std/fs"
import { parseJsonValue } from "std/json"
import { ExecOptions, env, pid, run } from "std/os"
import { absolute, cacheDirectory, dirname, join } from "std/path"
import { canonicalDependencyUrl } from "./std-catalog"

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

export function defaultPackageCacheRoot(): Result<string, string> {
  override := env("DOOF_PACKAGE_CACHE") else { return defaultPlatformPackageCacheRoot() }
  if override != "" { return absolute(override) }
  return defaultPlatformPackageCacheRoot()
}

function defaultPlatformPackageCacheRoot(): Result<string, string> {
  try root := cacheDirectory("doof")
  return Success(join([root, "packages"]))
}

export function exactPackageCachePath(cacheRoot: string, source: ExactPackageSource): string {
  coordinate := sha256HexString(canonicalDependencyUrl(source.url))
  return join([cacheRoot, coordinate, source.commit.toLowerCase()])
}

export function acquireExactGitPackage(
  source: ExactPackageSource,
  cacheRoot: string,
): Result<AcquiredPackage, string> {
  if source.commit.length != 40 { return Failure("Exact package " + source.name + " requires a 40-character commit") }
  root := exactPackageCachePath(cacheRoot, source)
  if exists(root) {
    try validateAcquiredPackage(root, source)
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
  _ := rename(staging, root) else {
    try removePackageTree(staging)
    return Failure("Could not finalize package " + source.name)
  }
  return Success(AcquiredPackage { source, rootDirectory: root })
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
  if exists(join([root, ".git"])) {
    actual := packageCommand("git", ["-C", root, "rev-parse", "HEAD"]) else error { return Failure(error) }
    if actual.toLowerCase() != source.commit.toLowerCase() {
      return Failure("Cached package " + source.name + " commit mismatch: expected " + source.commit.toLowerCase() + ", got " + actual.toLowerCase())
    }
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
  _ := mkdir(path) else { return Failure("Could not create package cache directory " + path) }
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
