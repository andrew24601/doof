// Root-owned conflict selection and transitive input policy.

import {
  DependencyPolicy, DependencyResolution, ExternalDependency, PackageDependency, PackageManifest,
} from "./package-manifest"
import { canonicalDependencyUrl } from "./std-catalog"

export class ReachedPackageInput {
  logicalPrefix: string
  introducedBy: string
  manifest: PackageManifest
  sourceKind: string
  sourceUrl: string = ""
  sourceRef: string = ""
  sourceCommit: string = ""
  requestedUrl: string = ""
  requestedRef: string = ""
  requestedCommit: string = ""
  mutable: bool = false
}

export class ResolvedExternalInput {
  owner: ReachedPackageInput
  dependency: ExternalDependency
  selectedKind: string
  selectedUrl: string
  selectedRef: string = ""
  selectedCommit: string = ""
  selectedSha256: string = ""
  overridden: bool = false
}

/** Reports whether the reached graph selected mutable standard packages. */
export function hasMutableStdPackageInputs(packages: ReachedPackageInput[]): bool {
  for package of packages {
    if package.mutable && package.logicalPrefix.startsWith("/std/") { return true }
  }
  return false
}

export function resolutionForUrl(
  resolutions: DependencyResolution[],
  url: string,
): DependencyResolution | null {
  canonical := canonicalDependencyUrl(url)
  for resolution of resolutions {
    if canonicalDependencyUrl(resolution.url) == canonical { return resolution }
  }
  return null
}

export function selectedPackageSource(
  dependency: PackageDependency,
  resolutions: DependencyResolution[],
): PackageDependency {
  if dependency.url == "" { return dependency }
  resolution := resolutionForUrl(resolutions, dependency.url)
  if resolution == null { return dependency }
  return PackageDependency {
    name: dependency.name,
    url: canonicalDependencyUrl(resolution!.url),
    ref: resolution!.ref,
    commit: resolution!.commit,
  }
}

export function resolveExternalInputs(
  packages: ReachedPackageInput[],
  rootManifest: PackageManifest,
): Result<ResolvedExternalInput[], string> {
  let result: ResolvedExternalInput[] = []
  for owner of packages {
    for dependency of owner.manifest.externalDependencies {
      resolution := resolutionForUrl(rootManifest.externalResolutions, dependency.url)
      if resolution != null && resolution!.kind != dependency.kind {
        return Failure("External resolution for " + canonicalDependencyUrl(dependency.url) + " must keep kind " + dependency.kind)
      }
      selected := resolvedExternalInput(owner, dependency, resolution)
      for existing of result {
        if canonicalDependencyUrl(existing.selectedUrl) != canonicalDependencyUrl(selected.selectedUrl) { continue }
        if !sameSelectedExternal(existing, selected) && resolution == null {
          return Failure(
            "Conflicting external dependency " + canonicalDependencyUrl(dependency.url) + " requested by " +
            existing.owner.logicalPrefix + " and " + owner.logicalPrefix +
            "; add a root resolutions.externalDependencies entry",
          )
        }
      }
      result.push(selected)
    }
  }
  return Success(result)
}

export function validateDependencyPolicy(
  packages: ReachedPackageInput[],
  externals: ResolvedExternalInput[],
  rootManifest: PackageManifest,
): Result<void, string> {
  policy := rootManifest.policy
  for package of packages {
    if package.sourceKind == "root" { continue }
    if package.introducedBy != "" && package.sourceKind == "git" && policy.hasPackageSourceAllowlist {
      if resolutionForUrl(rootManifest.packageResolutions, package.sourceUrl) == null &&
        !containsCanonicalUrl(policy.allowedPackageSources, package.sourceUrl) {
        return Failure("Policy rejected transitive package " + package.sourceUrl + " introduced by " + package.introducedBy)
      }
    }
    try validateTransitiveNativePolicy(package, policy)
  }
  for external of externals {
    if external.owner.sourceKind == "root" { continue }
    if rootManifest.policy.hasExternalSourceAllowlist &&
      resolutionForUrl(rootManifest.externalResolutions, external.selectedUrl) == null &&
      !containsCanonicalUrl(rootManifest.policy.allowedExternalSources, external.selectedUrl) {
      return Failure(
        "Policy rejected transitive external dependency " + canonicalDependencyUrl(external.selectedUrl) +
        " introduced by " + external.owner.logicalPrefix,
      )
    }
  }
  return Success()
}

function resolvedExternalInput(
  owner: ReachedPackageInput,
  dependency: ExternalDependency,
  resolution: DependencyResolution | null,
): ResolvedExternalInput {
  if resolution == null {
    return ResolvedExternalInput {
      owner, dependency, selectedKind: dependency.kind, selectedUrl: canonicalDependencyUrl(dependency.url),
      selectedRef: dependency.ref, selectedCommit: dependency.commit, selectedSha256: dependency.sha256,
    }
  }
  return ResolvedExternalInput {
    owner, dependency, selectedKind: resolution!.kind, selectedUrl: canonicalDependencyUrl(resolution!.url),
    selectedRef: resolution!.ref, selectedCommit: resolution!.commit, selectedSha256: resolution!.sha256,
    overridden: resolution!.kind != dependency.kind || resolution!.ref != dependency.ref ||
      resolution!.commit != dependency.commit || resolution!.sha256 != dependency.sha256,
  }
}

function sameSelectedExternal(left: ResolvedExternalInput, right: ResolvedExternalInput): bool {
  if left.selectedKind != right.selectedKind { return false }
  if left.selectedKind == "git" { return left.selectedCommit == right.selectedCommit }
  return left.selectedSha256 == right.selectedSha256
}

function containsCanonicalUrl(values: string[], value: string): bool {
  canonical := canonicalDependencyUrl(value)
  for existing of values { if canonicalDependencyUrl(existing) == canonical { return true } }
  return false
}

function validateTransitiveNativePolicy(
  package: ReachedPackageInput,
  policy: DependencyPolicy,
): Result<void, string> {
  if policy.hasLinkLibraryAllowlist {
    for value of package.manifest.nativeBuild.linkLibraries {
      if !policy.allowedLinkLibraries.contains(value) {
        return Failure("Policy rejected transitive link library " + value + " introduced by " + package.logicalPrefix)
      }
    }
  }
  if policy.hasFrameworkAllowlist {
    for value of package.manifest.nativeBuild.frameworks {
      if !policy.allowedFrameworks.contains(value) {
        return Failure("Policy rejected transitive framework " + value + " introduced by " + package.logicalPrefix)
      }
    }
  }
  if policy.hasPkgConfigAllowlist {
    for value of package.manifest.nativeBuild.pkgConfigPackages {
      if !policy.allowedPkgConfigPackages.contains(value) {
        return Failure("Policy rejected transitive pkg-config package " + value + " introduced by " + package.logicalPrefix)
      }
    }
  }
  return Success()
}
