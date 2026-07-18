import { Assert } from "std/assert"
import { ReachedPackageInput, ResolvedExternalInput } from "./dependency-policy"
import { ExternalDependency, NativeBuildPlan, parsePackageManifest } from "./package-manifest"
import { renderBuildProvenance } from "./provenance"
import { StdCatalog } from "./std-catalog"

export function testRendersDeterministicGraphProvenance(): void {
  root := try! parsePackageManifest("{\"name\":\"app\"}", "/app/doof.json", "/app", "linux")
  dependency := try! parsePackageManifest("{\"name\":\"dep\"}", "/dep/doof.json", "/dep", "linux")
  packages := [
    ReachedPackageInput { logicalPrefix: "/dep", introducedBy: "", manifest: dependency, sourceKind: "git", sourceUrl: "https://EXAMPLE.com/dep.git", sourceRef: "v1", sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    ReachedPackageInput { logicalPrefix: "/app", introducedBy: "", manifest: root, sourceKind: "root" },
  ]
  vendor := ExternalDependency { name: "vendor", kind: "git", url: "https://example.com/vendor.git", ref: "v1", commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", destination: "vendor/source" }
  external := ResolvedExternalInput { owner: packages[0], dependency: vendor, selectedKind: "git", selectedUrl: vendor.url, selectedRef: vendor.ref, selectedCommit: vendor.commit }
  catalog := StdCatalog { schemaVersion: 1, compilerVersion: "1.2.3", digest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", packages: [] }

  rendered := renderBuildProvenance(packages, [external], NativeBuildPlan { linkLibraries: ["z"] }, catalog)
  Assert.stringContains(rendered, "\"stdCatalogDigest\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"")
  Assert.stringContains(rendered, "\"url\":\"https://example.com/dep\"")
  Assert.stringContains(rendered, "\"introducedBy\":\"/dep\"")
  Assert.stringContains(rendered, "\"linkLibraries\":[\"z\"]")
  Assert.equal(rendered.indexOf("\"logicalPrefix\":\"/app\"") < rendered.indexOf("\"logicalPrefix\":\"/dep\""), true)
}
