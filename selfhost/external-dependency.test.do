import { Assert } from "std/assert"
import { BlobReader } from "std/blob"
import { sha256Hex } from "std/crypto"
import { exists, isDirectory, mkdir, readBlob, readDir, readText, remove, writeText } from "std/fs"
import { parseJsonValue } from "std/json"
import { ExecOptions, run } from "std/os"
import { join } from "std/path"
import { ExternalDependencyTarget, acquirePackageExternalDependencies, applyExternalDependencySubstitutions } from "./external-dependency"
import { ExternalDependency, ExternalDependencyCommand, PackageManifest } from "./package-manifest"

function testPath(directory: string, name: string): string => join([directory, name])

function removeTestTree(path: string): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { removeTestTree(testPath(path, entry.name)) }
  }
  try! remove(path)
}

function runTestCommand(command: string, arguments: string[]): string {
  result := try! run(command, arguments, ExecOptions { withStdin: false, mergeStderrIntoStdout: true })
  output := BlobReader(result.stdout).readString(long(result.stdout.length)).trim()
  if result.exitCode != 0 { panic(command + " failed: " + output) }
  return output
}

export function testAppliesExternalCommandSubstitutions(): void {
  target := ExternalDependencyTarget {
    nativeTarget: "ios-device",
    sdkPath: "/SDK",
    targetTriple: "arm64-apple-ios17.0",
    configureHost: "aarch64-apple-darwin",
    jobs: 8,
  }
  actual := applyExternalDependencySubstitutions(
    "\${packageRoot}|\${destination}|\${jobs}|\${nativeTarget}|\${sdkPath}|\${targetTriple}|\${configureHost}",
    "/app", "/app/vendor/lib", target,
  )
  Assert.equal(actual, "/app|/app/vendor/lib|8|ios-device|/SDK|arm64-apple-ios17.0|aarch64-apple-darwin")
}

export function testAcquiresArchiveRunsCommandsAndReusesSentinels(): void {
  root := "/tmp/doof-selfhost-external-dependency-test"
  removeTestTree(root)
  try! mkdir(root)
  sourceRoot := testPath(root, "source")
  archiveRoot := testPath(sourceRoot, "hello-1")
  try! mkdir(sourceRoot)
  try! mkdir(archiveRoot)
  try! writeText(testPath(archiveRoot, "hello.h"), "first")
  archivePath := testPath(root, "hello.tar.gz")
  archived := try! run("tar", ["-czf", archivePath, "-C", sourceRoot, "hello-1"], ExecOptions { withStdin: false })
  Assert.equal(archived.exitCode, 0)
  checksum := sha256Hex(try! readBlob(archivePath))
  command := ExternalDependencyCommand {
    program: "cp",
    args: ["\${destination}/hello.h", "\${destination}/built-\${nativeTarget}.h"],
  }
  dependency := ExternalDependency {
    name: "hello",
    kind: "archive",
    url: "file://" + archivePath,
    destination: "vendor/hello",
    sha256: checksum,
    commands: [command],
  }
  manifest := PackageManifest {
    name: "fixture",
    manifestPath: testPath(root, "doof.json"),
    rootDirectory: root,
    nativeBuild: {},
    externalDependencies: [dependency],
  }
  try! writeText(manifest.manifestPath, "{}")
  target := ExternalDependencyTarget { nativeTarget: "linux", jobs: 2 }

  try! acquirePackageExternalDependencies(manifest, target)
  destination := testPath(root, "vendor/hello")
  Assert.equal(try! readText(testPath(destination, "hello.h")), "first")
  Assert.equal(try! readText(testPath(destination, "built-linux.h")), "first")
  Assert.equal(exists(testPath(destination, ".doof-external.json")), true)
  Assert.equal(exists(testPath(destination, ".doof-external-native-linux.json")), true)
  sourceMarker := try! (try! parseJsonValue(try! readText(testPath(destination, ".doof-external.json")))) as JsonObject
  nativeMarker := try! (try! parseJsonValue(try! readText(testPath(destination, ".doof-external-native-linux.json")))) as JsonObject
  Assert.equal(try! ((try! sourceMarker.get("kind")) as string), "archive")
  Assert.equal(try! ((try! sourceMarker.get("destination")) as string), "vendor/hello")
  Assert.equal(try! ((try! nativeMarker.get("nativeTarget")) as string), "linux")

  // A matching source sentinel preserves local timestamps/content and a
  // matching native sentinel prevents the command from running again.
  try! writeText(testPath(destination, "hello.h"), "locally-preserved")
  try! acquirePackageExternalDependencies(manifest, target)
  Assert.equal(try! readText(testPath(destination, "hello.h")), "locally-preserved")
  Assert.equal(try! readText(testPath(destination, "built-linux.h")), "first")
  removeTestTree(root)
}

export function testAcquiresPinnedGitCommitAndRejectsMismatch(): void {
  root := "/tmp/doof-selfhost-external-git-test"
  removeTestTree(root)
  try! mkdir(root)
  repository := testPath(root, "repository")
  try! mkdir(repository)
  ignoredInit := runTestCommand("git", ["-C", repository, "init"])
  try! writeText(testPath(repository, "native.h"), "git-source")
  ignoredAdd := runTestCommand("git", ["-C", repository, "add", "native.h"])
  ignoredCommit := runTestCommand("git", ["-C", repository, "-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "fixture"])
  commit := runTestCommand("git", ["-C", repository, "rev-parse", "HEAD"])
  branch := runTestCommand("git", ["-C", repository, "branch", "--show-current"])
  manifestPath := testPath(root, "doof.json")
  try! writeText(manifestPath, "{}")
  target := ExternalDependencyTarget { nativeTarget: "linux" }

  valid := PackageManifest {
    name: "fixture", manifestPath, rootDirectory: root, nativeBuild: {},
    externalDependencies: [ExternalDependency {
      name: "native", kind: "git", url: repository, ref: branch, commit, destination: "vendor/native",
    }],
  }
  try! acquirePackageExternalDependencies(valid, target)
  Assert.equal(try! readText(testPath(root, "vendor/native/native.h")), "git-source")
  Assert.equal(exists(testPath(root, "vendor/native/.git")), false)

  invalid := PackageManifest {
    name: "fixture", manifestPath, rootDirectory: root, nativeBuild: {},
    externalDependencies: [ExternalDependency {
      name: "bad", kind: "git", url: repository, ref: branch,
      commit: "0000000000000000000000000000000000000000", destination: "vendor/bad",
    }],
  }
  mismatch := acquirePackageExternalDependencies(invalid, target)
  _ := mismatch else error {
    Assert.stringContains(error, "commit mismatch")
    removeTestTree(root)
    return
  }
  panic("expected Git commit mismatch")
}
