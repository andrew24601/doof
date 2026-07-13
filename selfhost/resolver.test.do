import { Assert } from "std/assert"
import { ModuleResolver, noSourceLoader } from "./resolver"
import { SourceFile } from "./semantic"

export function testResolvesStdlibPackageBarrels(): void {
  resolver := ModuleResolver { sources: [
    SourceFile { path: "/main.do", source: "" },
    SourceFile { path: "/std/fs/index.do", source: "" },
    SourceFile { path: "/std/fs/runtime.do", source: "" },
  ], loader: noSourceLoader }

  Assert.equal(resolver.resolve("/main.do", "std/fs"), "/std/fs/index.do")
  Assert.equal(resolver.resolve("/main.do", "std/fs/runtime"), "/std/fs/runtime.do")
}

export function testExplicitStdlibMappingWinsOverBarrel(): void {
  resolver := ModuleResolver { sources: [
    SourceFile { path: "/main.do", source: "" },
    SourceFile { path: "/std/fs.do", source: "" },
    SourceFile { path: "/std/fs/index.do", source: "" },
  ], loader: noSourceLoader }

  Assert.equal(resolver.resolve("/main.do", "std/fs"), "/std/fs.do")
}

export function testBareAndRelativeResolutionRemainUnchanged(): void {
  resolver := ModuleResolver { sources: [SourceFile { path: "/main.do", source: "" }], loader: noSourceLoader }

  Assert.equal(resolver.resolve("/main.do", "vendor/math"), "/vendor/math.do")
  Assert.equal(resolver.resolve("/nested/main.do", "../shared"), "/shared.do")
}

export function testLoadsCandidatesOnDemandAndCachesThem(): void {
  let requested: string[] = []
  loader := (path: string): SourceFile | null => {
    requested.push(path)
    if path == "/lib/index.do" { return SourceFile { path, source: "" } }
    return null
  }
  resolver := ModuleResolver { sources: [SourceFile { path: "/main.do", source: "" }], loader }

  Assert.equal(resolver.resolve("/main.do", "./lib"), "/lib/index.do")
  Assert.equal(resolver.resolve("/main.do", "./lib"), "/lib/index.do")
  Assert.equal(requested.length, 2)
  Assert.equal(requested[0], "/lib.do")
  Assert.equal(requested[1], "/lib/index.do")
  Assert.equal(resolver.find("/lib/index.do") != null, true)
}
