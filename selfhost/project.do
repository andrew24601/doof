// Project manifest handling for the self-hosted compiler driver.
//
// The resolver handles source discovery transitively. This module only maps a
// requested entry to its manifest/build settings; source contents are loaded by
// the driver's resolver callback when an import is encountered.

import { isDirectory, isFile, readText } from "std/fs"
import { parseJsonValue } from "std/json"
import { env } from "std/os"
import { absolute, basename, dirname, join } from "std/path"
import { NativeBuildPlan, PackageResource, parsePackageManifest } from "./package-manifest"

export function projectManifestPath(path: string): string {
  let directory = if isDirectory(path) then path else dirname(path)
  while true {
    candidate := join([directory, "doof.json"])
    if isFile(candidate) { return candidate }
    parent := dirname(directory)
    if parent == directory { return "" }
    directory = parent
  }
  return ""
}

export function environmentValue(name: string): string {
  value := env(name) else { return "" }
  return value
}

export function fileName(path: string): string => basename(path)
export function parentPath(path: string): string => dirname(path)
export function joinPath(directory: string, name: string): string => join([directory, name])

export class ProjectSpec {
  rootDirectory: string
  manifestPath: string
  name: string
  entry: string
  buildDirectory: string
  hasManifest: bool
  resources: PackageResource[] = []
  nativeBuild: NativeBuildPlan
}

export function readProjectSpec(requestedPath: string, platform: string = ""): ProjectSpec {
  absolutePath := try! absolute(requestedPath)
  directory := if isDirectory(absolutePath) then absolutePath else parentPath(absolutePath)
  manifest := projectManifestPath(absolutePath)
  if manifest == "" {
    fallbackEntry := if isDirectory(absolutePath) then "main.do" else fileName(absolutePath)
    return ProjectSpec {
      rootDirectory: directory,
      manifestPath: "",
      name: fileName(directory),
      entry: fallbackEntry,
      buildDirectory: "build",
      hasManifest: false,
      resources: [],
      nativeBuild: NativeBuildPlan {},
    }
  }

  packageDirectory := parentPath(manifest)
  manifestSource := try! readText(manifest)
  packageManifest := try! parsePackageManifest(manifestSource, manifest, packageDirectory, platform)
  root := try! (try! parseJsonValue(manifestSource)) as JsonObject
  let name = fileName(packageDirectory)
  if root.has("name") { name = try! (try! root.get("name")) as string }
  let entry = "main.do"
  let buildDirectory = "build"
  if root.has("build") {
    build := try! (try! root.get("build")) as JsonObject
    if build.has("entry") { entry = try! (try! build.get("entry")) as string }
    if build.has("buildDir") { buildDirectory = try! (try! build.get("buildDir")) as string }
  }
  // An explicit source file wins over the package default entry. Passing a
  // directory (or omitting the argument) selects build.entry from doof.json.
  if !isDirectory(absolutePath) { entry = absolutePath }
  return ProjectSpec {
    rootDirectory: packageDirectory,
    manifestPath: manifest,
    name,
    entry,
    buildDirectory,
    hasManifest: true,
    resources: packageManifest.resources,
    nativeBuild: packageManifest.nativeBuild,
  }
}
