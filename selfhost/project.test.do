import { Assert } from "std/assert"
import { exists, mkdir, writeText } from "std/fs"
import { readProjectSpec } from "./project"

export function testReadsRootProjectNativeBuildThroughPackageManifestModel(): void {
  root := "/tmp/doof-selfhost-project-native-test"
  if !exists(root) { try! mkdir(root) }
  if !exists(root + "/src") { try! mkdir(root + "/src") }
  try! writeText(
    root + "/doof.json",
    "{\"name\":\"native-root\",\"build\":{\"entry\":\"src/main.do\",\"native\":{\"sourceFiles\":[\"native.cpp\"],\"macos\":{\"frameworks\":[\"Foundation\"]}}}}",
  )
  try! writeText(root + "/src/main.do", "function main(): int => 0")

  project := readProjectSpec(root + "/src/main.do", "macos")
  Assert.equal(project.name, "native-root")
  Assert.equal(project.rootDirectory, root)
  Assert.equal(project.nativeBuild.sourceFiles.length, 1)
  Assert.equal(project.nativeBuild.sourceFiles[0], root + "/native.cpp")
  Assert.equal(project.nativeBuild.frameworks.length, 1)
  Assert.equal(project.nativeBuild.frameworks[0], "Foundation")
}

export function testReadsRootProjectExecutableResources(): void {
  root := "/tmp/doof-selfhost-project-resource-test"
  if !exists(root) { try! mkdir(root) }
  try! writeText(
    root + "/doof.json",
    "{\"name\":\"resource-root\",\"resources\":[{\"from\":\"doof_runtime.h\",\"to\":\".\"}],\"build\":{\"entry\":\"main.do\"}}",
  )
  try! writeText(root + "/main.do", "function main(): int => 0")
  try! writeText(root + "/doof_runtime.h", "runtime")

  project := readProjectSpec(root, "macos")
  Assert.equal(project.resources.length, 1)
  Assert.equal(project.resources[0].sourcePath, root + "/doof_runtime.h")
  Assert.equal(project.resources[0].destination, "")
}
