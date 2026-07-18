// Deterministic build provenance for exact package and native inputs.

import { ReachedPackageInput, ResolvedExternalInput } from "./dependency-policy"
import { NativeBuildPlan } from "./package-manifest"
import { StdCatalog, canonicalDependencyUrl } from "./std-catalog"
import { formatJsonValue } from "std/json"

export function renderBuildProvenance(
  packages: ReachedPackageInput[],
  externals: ResolvedExternalInput[],
  nativeBuild: NativeBuildPlan,
  catalog: StdCatalog,
): string {
  let root: JsonObject = {}
  provenanceSet(root, "schemaVersion", 2)
  let compiler: JsonObject = {}
  provenanceSet(compiler, "implementation", "selfhost")
  provenanceSet(compiler, "version", catalog.compilerVersion)
  provenanceSet(compiler, "stdCatalogDigest", catalog.digest)
  provenanceSet(root, "compiler", compiler)

  let packageValues: JsonValue[] = []
  for package of sortedProvenancePackages(packages) { packageValues.push(provenancePackage(package)) }
  provenanceSet(root, "packages", packageValues)

  let externalValues: JsonValue[] = []
  for input of sortedProvenanceExternals(externals) { externalValues.push(provenanceExternal(input)) }
  provenanceSet(root, "externalDependencies", externalValues)
  provenanceSet(root, "native", provenanceNative(nativeBuild))
  return formatJsonValue(root) + "\n"
}

function provenancePackage(package: ReachedPackageInput): JsonObject {
  let value: JsonObject = {}
  provenanceSet(value, "name", package.manifest.name)
  provenanceSet(value, "logicalPrefix", package.logicalPrefix)
  provenanceSet(value, "introducedBy", package.introducedBy)
  provenanceSet(value, "kind", package.sourceKind)
  provenanceSet(value, "mutable", package.mutable)
  if package.sourceUrl != "" { provenanceSet(value, "url", canonicalDependencyUrl(package.sourceUrl)) }
  if package.sourceRef != "" { provenanceSet(value, "ref", package.sourceRef) }
  if package.sourceCommit != "" { provenanceSet(value, "commit", package.sourceCommit) }
  if package.requestedCommit != "" && (
    canonicalDependencyUrl(package.requestedUrl) != canonicalDependencyUrl(package.sourceUrl) ||
    package.requestedCommit != package.sourceCommit
  ) {
    let requested: JsonObject = {}
    provenanceSet(requested, "url", canonicalDependencyUrl(package.requestedUrl))
    provenanceSet(requested, "ref", package.requestedRef)
    provenanceSet(requested, "commit", package.requestedCommit)
    provenanceSet(value, "requested", requested)
  }
  if package.sourceKind == "local" { provenanceSet(value, "path", package.manifest.rootDirectory) }
  return value
}

function provenanceExternal(input: ResolvedExternalInput): JsonObject {
  let value: JsonObject = {}
  provenanceSet(value, "name", input.dependency.name)
  provenanceSet(value, "introducedBy", input.owner.logicalPrefix)
  provenanceSet(value, "kind", input.selectedKind)
  provenanceSet(value, "url", canonicalDependencyUrl(input.selectedUrl))
  provenanceSet(value, "overridden", input.overridden)
  if input.selectedKind == "git" {
    provenanceSet(value, "ref", input.selectedRef)
    provenanceSet(value, "commit", input.selectedCommit)
  } else {
    provenanceSet(value, "sha256", input.selectedSha256)
  }
  if input.overridden {
    let requested: JsonObject = {}
    provenanceSet(requested, "kind", input.dependency.kind)
    provenanceSet(requested, "url", canonicalDependencyUrl(input.dependency.url))
    if input.dependency.kind == "git" {
      provenanceSet(requested, "ref", input.dependency.ref)
      provenanceSet(requested, "commit", input.dependency.commit)
    } else {
      provenanceSet(requested, "sha256", input.dependency.sha256)
    }
    provenanceSet(value, "requested", requested)
  }
  return value
}

function provenanceNative(nativeBuild: NativeBuildPlan): JsonObject {
  let value: JsonObject = {}
  provenanceSet(value, "linkLibraries", provenanceStrings(nativeBuild.linkLibraries))
  provenanceSet(value, "frameworks", provenanceStrings(nativeBuild.frameworks))
  provenanceSet(value, "pkgConfigPackages", provenanceStrings(nativeBuild.pkgConfigPackages))
  provenanceSet(value, "sourceFiles", provenanceStrings(nativeBuild.sourceFiles))
  return value
}

function provenanceStrings(values: string[]): JsonValue[] {
  let result: JsonValue[] = []
  for value of values { result.push(value) }
  return result
}

function sortedProvenancePackages(values: ReachedPackageInput[]): ReachedPackageInput[] {
  let result: ReachedPackageInput[] = []
  for value of values {
    result.push(value)
    let index = result.length - 1
    while index > 0 && result[index].logicalPrefix < result[index - 1].logicalPrefix {
      previous := result[index - 1]
      result[index - 1] = result[index]
      result[index] = previous
      index -= 1
    }
  }
  return result
}

function sortedProvenanceExternals(values: ResolvedExternalInput[]): ResolvedExternalInput[] {
  let result: ResolvedExternalInput[] = []
  for value of values {
    result.push(value)
    let index = result.length - 1
    while index > 0 {
      key := canonicalDependencyUrl(result[index].selectedUrl) + "\u0000" + result[index].owner.logicalPrefix + "\u0000" + result[index].dependency.name
      previousKey := canonicalDependencyUrl(result[index - 1].selectedUrl) + "\u0000" + result[index - 1].owner.logicalPrefix + "\u0000" + result[index - 1].dependency.name
      if key >= previousKey { break }
      previous := result[index - 1]
      result[index - 1] = result[index]
      result[index] = previous
      index -= 1
    }
  }
  return result
}

function provenanceSet(object: JsonObject, name: string, value: JsonValue): void {
  object.set(name, value)
}
