import { Assert } from "std/assert"
import {
  ReachedPackageInput, hasMutableStdPackageInputs, resolveExternalInputs, selectedPackageSource,
  validateDependencyPolicy,
} from "./dependency-policy"
import { PackageDependency, PackageManifest, parsePackageManifest } from "./package-manifest"

function policyManifest(source: string, path: string): PackageManifest {
  return try! parsePackageManifest(source, path + "/doof.json", path, "linux")
}

export function testDetectsOnlyReachedMutableStandardPackages(): void {
  manifest := policyManifest("{\"name\":\"dep\"}", "/dep")
  Assert.equal(hasMutableStdPackageInputs([
    ReachedPackageInput { logicalPrefix: "/std/fs", introducedBy: "/app", manifest, sourceKind: "local", mutable: true },
  ]), true)
  Assert.equal(hasMutableStdPackageInputs([
    ReachedPackageInput { logicalPrefix: "/std/fs", introducedBy: "/app", manifest, sourceKind: "git" },
    ReachedPackageInput { logicalPrefix: "/tools", introducedBy: "/app", manifest, sourceKind: "local", mutable: true },
  ]), false)
}

export function testRequiresRootResolutionForExternalCommitConflict(): void {
  root := policyManifest("{\"name\":\"app\"}", "/app")
  one := policyManifest("{\"name\":\"one\",\"externalDependencies\":{\"quickjs\":{\"kind\":\"git\",\"url\":\"https://example.com/quickjs.git\",\"ref\":\"v1\",\"commit\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"destination\":\"vendor/quickjs\"}}}", "/one")
  two := policyManifest("{\"name\":\"two\",\"externalDependencies\":{\"quickjs\":{\"kind\":\"git\",\"url\":\"https://EXAMPLE.com/quickjs/\",\"ref\":\"v2\",\"commit\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"destination\":\"vendor/quickjs\"}}}", "/two")
  result := resolveExternalInputs([
    ReachedPackageInput { logicalPrefix: "/one", introducedBy: "/app", manifest: one, sourceKind: "git" },
    ReachedPackageInput { logicalPrefix: "/two", introducedBy: "/app", manifest: two, sourceKind: "git" },
  ], root)
  _ := result else error {
    Assert.stringContains(error, "Conflicting external dependency")
    return
  }
  panic("expected external conflict")
}

export function testRootResolutionSelectsOneExternalCommit(): void {
  root := policyManifest("{\"name\":\"app\",\"resolutions\":{\"externalDependencies\":{\"quickjs\":{\"kind\":\"git\",\"url\":\"https://example.com/quickjs\",\"ref\":\"v2\",\"commit\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}}}}", "/app")
  one := policyManifest("{\"name\":\"one\",\"externalDependencies\":{\"quickjs\":{\"kind\":\"git\",\"url\":\"https://example.com/quickjs.git\",\"ref\":\"v1\",\"commit\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"destination\":\"vendor/quickjs\"}}}", "/one")
  resolved := try! resolveExternalInputs([
    ReachedPackageInput { logicalPrefix: "/one", introducedBy: "/app", manifest: one, sourceKind: "git" },
  ], root)
  Assert.equal(resolved[0].selectedCommit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
  Assert.equal(resolved[0].dependency.destination, "vendor/quickjs")
  Assert.equal(resolved[0].overridden, true)
}

export function testRootResolutionSelectsOnePackageCommit(): void {
  root := policyManifest("{\"name\":\"app\",\"resolutions\":{\"packages\":{\"shared\":{\"url\":\"https://example.com/shared.git\",\"ref\":\"v2\",\"commit\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}}}}", "/app")
  selected := selectedPackageSource(PackageDependency {
    name: "shared", url: "https://EXAMPLE.com/shared/", ref: "v1",
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }, root.packageResolutions)
  Assert.equal(selected.url, "https://example.com/shared")
  Assert.equal(selected.ref, "v2")
  Assert.equal(selected.commit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

export function testPolicyRejectsNewFourthPartyAndNativeInputs(): void {
  root := policyManifest("{\"name\":\"app\",\"policy\":{\"allowedExternalSources\":[],\"native\":{\"allowedLinkLibraries\":[]}}}", "/app")
  dependency := policyManifest("{\"name\":\"dep\",\"externalDependencies\":{\"new\":{\"kind\":\"git\",\"url\":\"https://example.com/new.git\",\"ref\":\"v1\",\"commit\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"destination\":\"vendor/new\"}}}", "/dep")
  reached := [ReachedPackageInput { logicalPrefix: "/dep", introducedBy: "/app", manifest: dependency, sourceKind: "git" }]
  externals := try! resolveExternalInputs(reached, root)
  result := validateDependencyPolicy(reached, externals, root)
  _ := result else error {
    Assert.stringContains(error, "Policy rejected transitive external dependency")
    return
  }
  panic("expected fourth-party policy rejection")
}

export function testPolicyRejectsTransitiveNativeLinkInput(): void {
  root := policyManifest("{\"name\":\"app\",\"policy\":{\"native\":{\"allowedLinkLibraries\":[]}}}", "/app")
  dependency := policyManifest("{\"name\":\"dep\",\"build\":{\"native\":{\"linkLibraries\":[\"surprise\"]}}}", "/dep")
  reached := [ReachedPackageInput { logicalPrefix: "/dep", introducedBy: "", manifest: dependency, sourceKind: "git" }]
  result := validateDependencyPolicy(reached, [], root)
  _ := result else error {
    Assert.stringContains(error, "Policy rejected transitive link library surprise introduced by /dep")
    return
  }
  panic("expected transitive native policy rejection")
}
