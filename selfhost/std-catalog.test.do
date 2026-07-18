import { Assert } from "std/assert"
import { canonicalDependencyUrl, parseStdCatalog, stdCatalogPackage } from "./std-catalog"

export function testCanonicalizesDependencyUrls(): void {
  Assert.equal(canonicalDependencyUrl("HTTPS://GitHub.COM/doof-lang/time.git/"), "https://github.com/doof-lang/time")
  Assert.equal(canonicalDependencyUrl("/tmp/repository/"), "/tmp/repository")
}

export function testParsesSortedExactCatalog(): void {
  catalog := try! parseStdCatalog("{\"schemaVersion\":1,\"compilerVersion\":\"1.0.0\",\"digest\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"packages\":[{\"name\":\"std/time\",\"url\":\"https://github.com/doof-lang/time.git\",\"ref\":\"v1\",\"version\":\"1.0.0\",\"commit\":\"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\"}]}")
  package := stdCatalogPackage(catalog, "std/time")
  Assert.equal(package != null, true)
  Assert.equal(package!.url, "https://github.com/doof-lang/time")
  Assert.equal(package!.commit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

export function testRejectsUnknownCatalogSchema(): void {
  result := parseStdCatalog("{\"schemaVersion\":2,\"compilerVersion\":\"1.0.0\",\"digest\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"packages\":[]}")
  _ := result else error {
    Assert.stringContains(error, "Unsupported std catalog schema")
    return
  }
  panic("expected catalog schema failure")
}
