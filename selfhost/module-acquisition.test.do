import { Assert } from "std/assert"
import { ModuleAcquisition, acquiredManifestPath, acquiredModuleDiskPath, acquiredPackageForModule } from "./module-acquisition"

export function testMapsModulesFromAnUmbrellaRoot(): void {
  acquisitions := [ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" }]

  Assert.equal(acquiredModuleDiskPath("/std/time/index.do", acquisitions), "/opt/doof/stdlib/time/index.do")
}

export function testUsesTheMostSpecificAcquiredFolder(): void {
  acquisitions := [
    ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" },
    ModuleAcquisition { logicalPrefix: "/std/time", diskRoot: "/cache/time-v1" },
  ]

  Assert.equal(acquiredModuleDiskPath("/std/time/temporal.do", acquisitions), "/cache/time-v1/temporal.do")
  Assert.equal(acquiredModuleDiskPath("/std/fs/index.do", acquisitions), "/opt/doof/stdlib/fs/index.do")
}

export function testDoesNotMatchPartialPrefixSegments(): void {
  acquisitions := [ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" }]

  Assert.equal(acquiredModuleDiskPath("/stdlib/time.do", acquisitions), null)
}

export function testReturnsNullForAnUnacquiredModule(): void {
  acquisitions := [ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" }]

  Assert.equal(acquiredModuleDiskPath("/vendor/time.do", acquisitions), null)
}

export function testBuildsTheAcquiredPackageManifestPath(): void {
  acquisition := ModuleAcquisition { logicalPrefix: "/std/time", diskRoot: "/cache/time-v1/" }

  Assert.equal(acquiredManifestPath(acquisition), "/cache/time-v1/doof.json")
}

export function testIdentifiesThePackageReachedThroughAnUmbrellaRoot(): void {
  acquisitions := [ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" }]

  package := acquiredPackageForModule("/std/time/temporal.do", acquisitions)
  Assert.equal(package != null, true)
  Assert.equal(package!.logicalPrefix, "/std/time")
  Assert.equal(package!.diskRoot, "/opt/doof/stdlib/time")
}

export function testKeepsAPackageSpecificAcquisitionAsTheOwner(): void {
  acquisitions := [
    ModuleAcquisition { logicalPrefix: "/std", diskRoot: "/opt/doof/stdlib" },
    ModuleAcquisition { logicalPrefix: "/std/time", diskRoot: "/cache/time-v1" },
  ]

  package := acquiredPackageForModule("/std/time/index.do", acquisitions)
  Assert.equal(package != null, true)
  Assert.equal(package!.logicalPrefix, "/std/time")
  Assert.equal(package!.diskRoot, "/cache/time-v1")
}
