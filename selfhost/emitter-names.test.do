import { Assert } from "std/assert"

import { ModuleNamespaceMapping, configureModuleNamespaces, moduleDiagnosticPath, moduleNamespace } from "./emitter-names"

export function testUsesPackageIdentityForOwnedModuleNamespaces(): void {
  configureModuleNamespaces([
    ModuleNamespaceMapping { logicalPrefix: "/std/time", packageName: "std/time" },
    ModuleNamespaceMapping { logicalPrefix: "/vendor/cache", packageName: "acme-clock" },
  ])
  Assert.equal(moduleNamespace("/std/time/temporal.do"), "std_::time::temporal")
  Assert.equal(moduleNamespace("/vendor/cache/index.do"), "acme_clock::index")
  configureModuleNamespaces([])
}

export function testChoosesMostSpecificPackageNamespaceMapping(): void {
  configureModuleNamespaces([
    ModuleNamespaceMapping { logicalPrefix: "/vendor", packageName: "umbrella" },
    ModuleNamespaceMapping { logicalPrefix: "/vendor/clock", packageName: "acme/clock" },
  ])
  Assert.equal(moduleNamespace("/vendor/clock/index.do"), "acme::clock::index")
  configureModuleNamespaces([])
}

export function testRetainsPathNamespaceWithoutPackageOwnership(): void {
  configureModuleNamespaces([])
  Assert.equal(moduleNamespace("/app/main.do"), "app_app_main_")
}

export function testFormatsPackageRelativeDiagnosticPaths(): void {
  configureModuleNamespaces([
    ModuleNamespaceMapping { logicalPrefix: "/workspace/assert", packageName: "std/assert" },
  ])
  Assert.equal(moduleDiagnosticPath("/workspace/assert/tests/assert.test.do", true), "tests/assert.test")
  Assert.equal(moduleDiagnosticPath("/workspace/assert/tests/assert.test.do", false), "tests/assert.test.do")
  configureModuleNamespaces([])
}
