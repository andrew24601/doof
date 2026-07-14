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
