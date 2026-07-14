import { Assert } from "std/assert"
import { readText } from "std/fs"
import { NativeBuildPlan, mergeNativeBuildPlans, parsePackageManifest } from "./package-manifest"

export function testParsesAndNormalizesExecutableResources(): void {
  manifest := try! parsePackageManifest(
    "{\"name\":\"doof\",\"resources\":[{\"from\":\"doof_runtime.h\",\"to\":\".\"},\"assets\"]}",
    "/compiler/doof.json",
    "/compiler",
    "macos",
  )

  Assert.equal(manifest.resources.length, 2)
  Assert.equal(manifest.resources[0].sourcePath, "/compiler/doof_runtime.h")
  Assert.equal(manifest.resources[0].destination, "")
  Assert.equal(manifest.resources[1].sourcePath, "/compiler/assets")
  Assert.equal(manifest.resources[1].destination, "assets")
}

export function testUsesBuildResourcesWhenRootResourcesAreAbsent(): void {
  manifest := try! parsePackageManifest(
    "{\"build\":{\"resources\":[\"assets\"]}}",
    "/app/doof.json",
    "/app",
    "linux",
  )

  Assert.equal(manifest.resources.length, 1)
  Assert.equal(manifest.resources[0].sourcePath, "/app/assets")
  Assert.equal(manifest.resources[0].destination, "assets")
}

export function testRejectsExecutableResourceDestinationsOutsideResourceDirectory(): void {
  result := parsePackageManifest(
    "{\"resources\":[{\"from\":\"runtime.h\",\"to\":\"../runtime.h\"}]}",
    "/bad/doof.json",
    "/bad",
    "linux",
  )
  _ := result else error {
    Assert.stringContains(error, "resources[0].to must stay within the executable resource directory")
    return
  }
  panic("expected invalid resource destination failure")
}

export function testParsesAndNormalizesBaseNativeInputs(): void {
  manifest := try! parsePackageManifest(
    "{\"name\":\"std/time\",\"build\":{\"native\":{\"includePaths\":[\"include\"],\"sourceFiles\":[\"./doof_time.cpp\"],\"extraCopyPaths\":[\"doof_time.hpp\"],\"defines\":[\"DOOF_TIME=1\"]}}}",
    "/stdlib/time/doof.json",
    "/stdlib/time",
    "macos",
  )

  Assert.equal(manifest.name, "std/time")
  Assert.equal(manifest.nativeBuild.includePaths.length, 1)
  Assert.equal(manifest.nativeBuild.includePaths[0], "/stdlib/time/include")
  Assert.equal(manifest.nativeBuild.sourceFiles.length, 1)
  Assert.equal(manifest.nativeBuild.sourceFiles[0], "/stdlib/time/doof_time.cpp")
  Assert.equal(manifest.nativeBuild.extraCopyPaths.length, 1)
  Assert.equal(manifest.nativeBuild.extraCopyPaths[0], "/stdlib/time/doof_time.hpp")
  Assert.equal(manifest.nativeBuild.defines.length, 1)
  Assert.equal(manifest.nativeBuild.defines[0], "DOOF_TIME=1")
}

export function testMergesOnlyTheSelectedPlatformFragment(): void {
  manifest := try! parsePackageManifest(
    "{\"name\":\"std/path\",\"build\":{\"native\":{\"frameworks\":[\"Base\"],\"macos\":{\"frameworks\":[\"CoreFoundation\"],\"sourceFiles\":[\"path.mm\"]},\"linux\":{\"linkLibraries\":[\"pthread\"],\"sourceFiles\":[\"path.cpp\"]}}}}",
    "/stdlib/path/doof.json",
    "/stdlib/path",
    "macos",
  )

  Assert.equal(manifest.nativeBuild.frameworks.length, 2)
  Assert.equal(manifest.nativeBuild.frameworks[0], "Base")
  Assert.equal(manifest.nativeBuild.frameworks[1], "CoreFoundation")
  Assert.equal(manifest.nativeBuild.sourceFiles.length, 1)
  Assert.equal(manifest.nativeBuild.sourceFiles[0], "/stdlib/path/path.mm")
  Assert.equal(manifest.nativeBuild.linkLibraries.length, 0)
}

export function testDeduplicatesManifestAndMergedNativeInputs(): void {
  first := try! parsePackageManifest(
    "{\"build\":{\"native\":{\"frameworks\":[\"CoreFoundation\",\"CoreFoundation\"]}}}",
    "/one/doof.json",
    "/one",
    "macos",
  )
  second := NativeBuildPlan { frameworks: ["CoreFoundation", "Foundation"] }

  merged := mergeNativeBuildPlans([first.nativeBuild, second])
  Assert.equal(merged.frameworks.length, 2)
  Assert.equal(merged.frameworks[0], "CoreFoundation")
  Assert.equal(merged.frameworks[1], "Foundation")
}

export function testRejectsInvalidNativeStringArrays(): void {
  result := parsePackageManifest(
    "{\"build\":{\"native\":{\"sourceFiles\":[4]}}}",
    "/bad/doof.json",
    "/bad",
    "linux",
  )
  _ := result else error {
    Assert.stringContains(error, "build.native.sourceFiles[0] must be a string")
    return
  }
  panic("expected invalid manifest failure")
}

export function testDiscoversRealStdTimeNativeFiles(): void {
  root := absolutePath("../doof-stdlib/time")
  manifest := try! parsePackageManifest(
    try! readText(root + "/doof.json"),
    root + "/doof.json",
    root,
    "macos",
  )

  Assert.equal(manifest.nativeBuild.sourceFiles.contains(root + "/doof_time.cpp"), true)
  Assert.equal(manifest.nativeBuild.extraCopyPaths.contains(root + "/doof_time.hpp"), true)
}

export function testDiscoversRealStdPathPlatformFramework(): void {
  root := absolutePath("../doof-stdlib/path")
  manifest := try! parsePackageManifest(
    try! readText(root + "/doof.json"),
    root + "/doof.json",
    root,
    "macos",
  )

  Assert.equal(manifest.nativeBuild.frameworks.contains("CoreFoundation"), true)
}
