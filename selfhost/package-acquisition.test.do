import { Assert } from "std/assert"
import { BlobReader } from "std/blob"
import { exists, isDirectory, mkdir, readDir, readText, remove, writeText } from "std/fs"
import { parseJsonValue } from "std/json"
import { run } from "std/os"
import { join, tempDirectory } from "std/path"
import {
  ExactPackageSource, acquireExactGitPackage, packageAcquisitionPath, packageAcquisitionReceiptPath,
  workspacePackageAcquisitionRoot,
} from "./package-acquisition"

function acquisitionTestPath(name: string): string => join([tempDirectory(), "doof-selfhost-package-acquisition-" + name])

function removeAcquisitionTestTree(path: string): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { removeAcquisitionTestTree(join([path, entry.name])) }
  }
  try! remove(path)
}

function git(path: string, arguments: string[]): string {
  args := ["-C", path]
  for argument of arguments { args.push(argument) }
  result := try! run("git", args)
  Assert.equal(result.exitCode, 0)
  return BlobReader(result.stdout).readString(long(result.stdout.length)).trim()
}

export function testUsesDirectWorkspacePackageDirectories(): void {
  packagesRoot := workspacePackageAcquisitionRoot("/workspace")
  Assert.equal(packagesRoot, "/workspace/.doof/packages")
  Assert.equal(packageAcquisitionPath(packagesRoot, "std/fs"), "/workspace/.doof/packages/std/fs")
  Assert.equal(packageAcquisitionReceiptPath(packageAcquisitionPath(packagesRoot, "std/fs")), "/workspace/.doof/packages/std/fs/.doof-acquisition.json")
}

export function testRejectsPackageNamesThatEscapeAcquisitionRoot(): void {
  result := acquireExactGitPackage(ExactPackageSource {
    name: "../outside", url: "/unused", ref: "main", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }, acquisitionTestPath("unsafe-name"))
  _ := result else error {
    Assert.stringContains(error, "Invalid acquired package name")
    return
  }
  panic("expected invalid acquired package name")
}

export function testAcquiresAndReusesExactGitPackage(): void {
  root := acquisitionTestPath("reuse")
  removeAcquisitionTestTree(root)
  try! mkdir(root)
  repository := join([root, "repository"])
  try! mkdir(repository)
  git(repository, ["init"])
  try! writeText(join([repository, "doof.json"]), "{\"name\":\"example\"}")
  git(repository, ["add", "doof.json"])
  git(repository, ["-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "fixture"])
  commit := git(repository, ["rev-parse", "HEAD"])
  branch := git(repository, ["branch", "--show-current"])
  source := ExactPackageSource { name: "example", url: repository, ref: branch, commit }
  cache := join([root, "cache"])

  first := try! acquireExactGitPackage(source, cache)
  try! writeText(join([first.rootDirectory, "reuse-marker"]), "preserved")
  second := try! acquireExactGitPackage(source, cache)
  Assert.equal(first.rootDirectory, packageAcquisitionPath(cache, source.name))
  Assert.equal(second.rootDirectory, first.rootDirectory)
  Assert.equal(exists(join([first.rootDirectory, "doof.json"])), true)
  Assert.equal(exists(join([first.rootDirectory, "reuse-marker"])), true)
  Assert.equal(exists(join([first.rootDirectory, ".git"])), false)
  receipt := try! (try! parseJsonValue(try! readText(packageAcquisitionReceiptPath(first.rootDirectory)))) as JsonObject
  receiptCommit := try! (try! receipt.get("commit")) as string
  Assert.equal(receiptCommit, commit)
  removeAcquisitionTestTree(root)
}

export function testReplacesPackageInPlaceWhenExactRevisionChanges(): void {
  root := acquisitionTestPath("replace")
  removeAcquisitionTestTree(root)
  try! mkdir(root)
  repository := join([root, "repository"])
  try! mkdir(repository)
  git(repository, ["init"])
  try! writeText(join([repository, "doof.json"]), "{\"name\":\"example\"}")
  git(repository, ["add", "doof.json"])
  git(repository, ["-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "first"])
  firstCommit := git(repository, ["rev-parse", "HEAD"])
  branch := git(repository, ["branch", "--show-current"])
  cache := join([root, "cache"])
  first := try! acquireExactGitPackage(ExactPackageSource {
    name: "example", url: repository, ref: branch, commit: firstCommit,
  }, cache)
  try! writeText(join([first.rootDirectory, "stale-marker"]), "remove me")

  try! writeText(join([repository, "current.do"]), "export readonly CURRENT = true")
  git(repository, ["add", "current.do"])
  git(repository, ["-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "second"])
  secondCommit := git(repository, ["rev-parse", "HEAD"])
  second := try! acquireExactGitPackage(ExactPackageSource {
    name: "example", url: repository, ref: branch, commit: secondCommit,
  }, cache)

  Assert.equal(second.rootDirectory, first.rootDirectory)
  Assert.equal(exists(join([second.rootDirectory, "stale-marker"])), false)
  Assert.equal(exists(join([second.rootDirectory, "current.do"])), true)
  receipt := try! (try! parseJsonValue(try! readText(packageAcquisitionReceiptPath(second.rootDirectory)))) as JsonObject
  receiptCommit := try! (try! receipt.get("commit")) as string
  Assert.equal(receiptCommit, secondCommit)
  removeAcquisitionTestTree(root)
}

export function testReacquiresPackageWhenReceiptIsMissingOrInvalid(): void {
  root := acquisitionTestPath("missing-receipt")
  removeAcquisitionTestTree(root)
  try! mkdir(root)
  repository := join([root, "repository"])
  try! mkdir(repository)
  git(repository, ["init"])
  try! writeText(join([repository, "doof.json"]), "{\"name\":\"example\"}")
  git(repository, ["add", "doof.json"])
  git(repository, ["-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "fixture"])
  commit := git(repository, ["rev-parse", "HEAD"])
  branch := git(repository, ["branch", "--show-current"])
  source := ExactPackageSource { name: "example", url: repository, ref: branch, commit }
  cache := join([root, "cache"])
  first := try! acquireExactGitPackage(source, cache)
  try! remove(packageAcquisitionReceiptPath(first.rootDirectory))
  try! writeText(join([first.rootDirectory, "stale-marker"]), "remove me")

  second := try! acquireExactGitPackage(source, cache)
  Assert.equal(second.rootDirectory, first.rootDirectory)
  Assert.equal(exists(join([second.rootDirectory, "stale-marker"])), false)
  Assert.equal(exists(packageAcquisitionReceiptPath(second.rootDirectory)), true)

  try! writeText(packageAcquisitionReceiptPath(second.rootDirectory), "not json")
  try! writeText(join([second.rootDirectory, "invalid-receipt-marker"]), "remove me")
  third := try! acquireExactGitPackage(source, cache)
  Assert.equal(third.rootDirectory, first.rootDirectory)
  Assert.equal(exists(join([third.rootDirectory, "invalid-receipt-marker"])), false)
  removeAcquisitionTestTree(root)
}

export function testRejectsMovedExactPackageRef(): void {
  root := acquisitionTestPath("mismatch")
  removeAcquisitionTestTree(root)
  try! mkdir(root)
  repository := join([root, "repository"])
  try! mkdir(repository)
  git(repository, ["init"])
  try! writeText(join([repository, "doof.json"]), "{\"name\":\"example\"}")
  git(repository, ["add", "doof.json"])
  git(repository, ["-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "fixture"])
  branch := git(repository, ["branch", "--show-current"])
  result := acquireExactGitPackage(ExactPackageSource {
    name: "example", url: repository, ref: branch, commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }, join([root, "cache"]))
  _ := result else error {
    Assert.stringContains(error, "commit mismatch")
    removeAcquisitionTestTree(root)
    return
  }
  removeAcquisitionTestTree(root)
  panic("expected exact commit mismatch")
}
