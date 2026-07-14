// Project manifest handling for the self-hosted compiler driver.
//
// The resolver handles source discovery transitively. This module only maps a
// requested entry to its manifest/build settings; source contents are loaded by
// the driver's resolver callback when an import is encountered.

import { readText } from "std/fs"
import { parseJsonValue } from "std/json"
import { NativeBuildPlan, parsePackageManifest } from "./package-manifest"

export import function projectManifestPath(path: string): string from "doof_runtime.hpp" as doof::project_manifest_path
export import function isDirectory(path: string): bool from "doof_runtime.hpp" as doof::is_directory
export import function fileName(path: string): string from "doof_runtime.hpp" as doof::file_name
export import function parentPath(path: string): string from "doof_runtime.hpp" as doof::parent_path
export import function joinPath(directory: string, name: string): string from "doof_runtime.hpp" as doof::join_path
export import function jsonObject(value: JsonValue): JsonObject from "doof_runtime.hpp" as doof::json_object
export import function jsonField(object: JsonObject, name: string): JsonValue from "doof_runtime.hpp" as doof::json_field
export import function jsonHas(object: JsonObject, name: string): bool from "doof_runtime.hpp" as doof::json_has
export import function jsonString(value: JsonValue): string from "doof_runtime.hpp" as doof::json_string
export import function environmentValue(name: string): string from "doof_runtime.hpp" as doof::environment_value

export class ProjectSpec {
  rootDirectory: string
  manifestPath: string
  name: string
  entry: string
  buildDirectory: string
  hasManifest: bool
  nativeBuild: NativeBuildPlan
}

export function readProjectSpec(requestedPath: string, platform: string = ""): ProjectSpec {
  absolute := absolutePath(requestedPath)
  directory := if isDirectory(absolute) then absolute else absolutePath(joinPath(absolute, ".."))
  manifest := projectManifestPath(absolute)
  if manifest == "" {
    fallbackEntry := if isDirectory(absolute) then "main.do" else fileName(absolute)
    return ProjectSpec {
      rootDirectory: directory,
      manifestPath: "",
      name: fileName(directory),
      entry: fallbackEntry,
      buildDirectory: "build",
      hasManifest: false,
      nativeBuild: NativeBuildPlan {},
    }
  }

  packageDirectory := parentPath(manifest)
  manifestSource := try! readText(manifest)
  packageManifest := try! parsePackageManifest(manifestSource, manifest, packageDirectory, platform)
  root := jsonObject(try! parseJsonValue(manifestSource))
  let name = fileName(packageDirectory)
  if jsonHas(root, "name") { name = jsonString(jsonField(root, "name")) }
  let entry = "main.do"
  let buildDirectory = "build"
  if jsonHas(root, "build") {
    build := jsonObject(jsonField(root, "build"))
    if jsonHas(build, "entry") { entry = jsonString(jsonField(build, "entry")) }
    if jsonHas(build, "buildDir") { buildDirectory = jsonString(jsonField(build, "buildDir")) }
  }
  // An explicit source file wins over the package default entry. Passing a
  // directory (or omitting the argument) selects build.entry from doof.json.
  if !isDirectory(absolute) { entry = absolute }
  return ProjectSpec {
    rootDirectory: packageDirectory,
    manifestPath: manifest,
    name,
    entry,
    buildDirectory,
    hasManifest: true,
    nativeBuild: packageManifest.nativeBuild,
  }
}
