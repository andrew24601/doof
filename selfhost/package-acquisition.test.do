import { Assert } from "std/assert"
import { BlobReader } from "std/blob"
import { exists, isDirectory, mkdir, readDir, remove, writeText } from "std/fs"
import { run } from "std/os"
import { join, tempDirectory } from "std/path"
import { ExactPackageSource, acquireExactGitPackage, exactPackageCachePath } from "./package-acquisition"

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
  second := try! acquireExactGitPackage(source, cache)
  Assert.equal(first.rootDirectory, exactPackageCachePath(cache, source))
  Assert.equal(second.rootDirectory, first.rootDirectory)
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
