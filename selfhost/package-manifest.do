// Focused doof.json parsing for self-hosted package and native-build planning.
//
// Paths are normalized against the owning package root as manifests are read.
// The resulting model is independent of output materialization and native
// compiler invocation, which remain later project-planning stages.

import { parseJsonValue } from "std/json"

import function manifestJoinPath(directory: string, name: string): string from "doof_runtime.hpp" as doof::join_path
import function manifestJsonField(object: JsonObject, name: string): JsonValue from "doof_runtime.hpp" as doof::json_field
import function manifestJsonHas(object: JsonObject, name: string): bool from "doof_runtime.hpp" as doof::json_has

/** Normalized native inputs contributed by one or more reached packages. */
export class NativeBuildPlan {
  includePaths: string[] = []
  sourceFiles: string[] = []
  libraryPaths: string[] = []
  extraCopyPaths: string[] = []
  linkLibraries: string[] = []
  frameworks: string[] = []
  pkgConfigPackages: string[] = []
  defines: string[] = []
  compilerFlags: string[] = []
  linkerFlags: string[] = []
}

/** Package identity and native inputs parsed from a single doof.json. */
export class PackageManifest {
  name: string
  manifestPath: string
  rootDirectory: string
  nativeBuild: NativeBuildPlan
}

/** Parses package identity and host-platform native inputs from doof.json. */
export function parsePackageManifest(
  source: string,
  manifestPath: string,
  rootDirectory: string,
  platform: string,
): Result<PackageManifest, string> {
  try parsed := parseJsonValue(source)
  try root := manifestObject(parsed, manifestPath, "root")

  let name = ""
  if manifestJsonHas(root, "name") {
    try parsedName := manifestString(manifestJsonField(root, "name"), manifestPath, "name")
    name = parsedName
  }

  try nativeBuild := parseManifestNativeBuild(root, manifestPath, rootDirectory, platform)
  return Success(PackageManifest { name, manifestPath, rootDirectory, nativeBuild })
}

/** Merges normalized package plans while preserving first-seen ordering. */
export function mergeNativeBuildPlans(plans: NativeBuildPlan[]): NativeBuildPlan {
  merged := NativeBuildPlan {}
  for plan of plans { appendNativeBuild(merged, plan) }
  return merged
}

function parseManifestNativeBuild(
  root: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  platform: string,
): Result<NativeBuildPlan, string> {
  result := NativeBuildPlan {}
  if !manifestJsonHas(root, "build") { return Success(result) }
  try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
  if !manifestJsonHas(build, "native") { return Success(result) }
  try native := manifestObject(manifestJsonField(build, "native"), manifestPath, "build.native")

  try appendNativeFragment(result, native, manifestPath, rootDirectory, "build.native")
  if platform != "" && manifestJsonHas(native, platform) {
    try platformValue := manifestObject(
      manifestJsonField(native, platform),
      manifestPath,
      "build.native." + platform,
    )
    try appendNativeFragment(result, platformValue, manifestPath, rootDirectory, "build.native." + platform)
  }
  return Success(result)
}

function appendNativeFragment(
  target: NativeBuildPlan,
  fragment: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  fieldPath: string,
): Result<void, string> {
  try appendStringArrayField(target.includePaths, fragment, "includePaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.sourceFiles, fragment, "sourceFiles", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.libraryPaths, fragment, "libraryPaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.extraCopyPaths, fragment, "extraCopyPaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.linkLibraries, fragment, "linkLibraries", manifestPath, fieldPath, "")
  try appendStringArrayField(target.frameworks, fragment, "frameworks", manifestPath, fieldPath, "")
  try appendStringArrayField(target.pkgConfigPackages, fragment, "pkgConfigPackages", manifestPath, fieldPath, "")
  try appendStringArrayField(target.defines, fragment, "defines", manifestPath, fieldPath, "")
  try appendStringArrayField(target.compilerFlags, fragment, "compilerFlags", manifestPath, fieldPath, "")
  try appendStringArrayField(target.linkerFlags, fragment, "linkerFlags", manifestPath, fieldPath, "")
  return Success()
}

function appendStringArrayField(
  target: string[],
  object: JsonObject,
  name: string,
  manifestPath: string,
  fieldPath: string,
  pathRoot: string,
): Result<void, string> {
  if !manifestJsonHas(object, name) { return Success() }
  try values := manifestArray(manifestJsonField(object, name), manifestPath, fieldPath + "." + name)
  for index of 0..<values.length {
    try value := manifestString(
      values[index],
      manifestPath,
      fieldPath + "." + name + "[" + string(index) + "]",
    )
    normalized := if pathRoot == "" then value else manifestJoinPath(pathRoot, value)
    appendUnique(target, normalized)
  }
  return Success()
}

function appendNativeBuild(target: NativeBuildPlan, source: NativeBuildPlan): void {
  appendUniqueValues(target.includePaths, source.includePaths)
  appendUniqueValues(target.sourceFiles, source.sourceFiles)
  appendUniqueValues(target.libraryPaths, source.libraryPaths)
  appendUniqueValues(target.extraCopyPaths, source.extraCopyPaths)
  appendUniqueValues(target.linkLibraries, source.linkLibraries)
  appendUniqueValues(target.frameworks, source.frameworks)
  appendUniqueValues(target.pkgConfigPackages, source.pkgConfigPackages)
  appendUniqueValues(target.defines, source.defines)
  appendUniqueValues(target.compilerFlags, source.compilerFlags)
  appendUniqueValues(target.linkerFlags, source.linkerFlags)
}

function appendUniqueValues(target: string[], values: string[]): void {
  for value of values { appendUnique(target, value) }
}

function appendUnique(target: string[], value: string): void {
  for existing of target { if existing == value { return } }
  target.push(value)
}

function manifestObject(value: JsonValue, manifestPath: string, fieldPath: string): Result<JsonObject, string> {
  case value {
    object: JsonObject -> return Success(object)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be an object")
  }
}

function manifestArray(value: JsonValue, manifestPath: string, fieldPath: string): Result<JsonValue[], string> {
  case value {
    array: JsonValue[] -> return Success(array)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be an array")
  }
}

function manifestString(value: JsonValue, manifestPath: string, fieldPath: string): Result<string, string> {
  case value {
    text: string -> return Success(text)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be a string")
  }
}
