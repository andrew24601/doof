import { Assert } from "std/assert"
import { NativeBuildPlan, mergeNativeBuildPlans, parsePackageManifest } from "./package-manifest"

export function testParsesExternalArchiveAndGitDependencies(): void {
  manifest := try! parsePackageManifest(
    "{\"externalDependencies\":{\"curl\":{\"kind\":\"archive\",\"url\":\"https://example.com/curl.tar.xz\",\"sha256\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\",\"destination\":\"vendor/curl\",\"stripComponents\":0,\"copyFiles\":[{\"from\":\"COPYING\",\"to\":\"LICENSE\"}],\"commands\":[{\"program\":\"sh\",\"args\":[\"\${packageRoot}/build.sh\",\"\${nativeTarget}\"],\"env\":{\"SDKROOT\":\"\${sdkPath}\"},\"workingDirectory\":\"build\"}]},\"quickjs\":{\"kind\":\"git\",\"url\":\"https://example.com/quickjs.git\",\"ref\":\"v1\",\"commit\":\"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\",\"destination\":\"vendor/quickjs\"}}}",
    "/app/doof.json",
    "/app",
    "macos",
  )

  Assert.equal(manifest.externalDependencies.length, 2)
  Assert.equal(manifest.externalDependencies[0].name, "curl")
  Assert.equal(manifest.externalDependencies[0].sha256, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  Assert.equal(manifest.externalDependencies[0].stripComponents, 0)
  Assert.equal(manifest.externalDependencies[0].copyFiles[0].destination, "LICENSE")
  Assert.equal(manifest.externalDependencies[0].commands[0].args[1], "\${nativeTarget}")
  Assert.equal(try! manifest.externalDependencies[0].commands[0].env.get("SDKROOT"), "\${sdkPath}")
  Assert.equal(manifest.externalDependencies[1].kind, "git")
  Assert.equal(manifest.externalDependencies[1].commit, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}

export function testParsesExactPackageDependencies(): void {
  manifest := try! parsePackageManifest(
    "{\"dependencies\":{\"local\":{\"path\":\"../local\"},\"remote\":{\"url\":\"https://example.com/remote.git\",\"ref\":\"v1.2.3\",\"commit\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}}}",
    "/app/doof.json", "/app", "linux",
  )

  Assert.equal(manifest.dependencies.length, 2)
  Assert.equal(manifest.dependencies[0].path, "/local")
  Assert.equal(manifest.dependencies[1].ref, "v1.2.3")
  Assert.equal(manifest.dependencies[1].commit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

export function testRejectsFloatingPackageDependencies(): void {
  result := parsePackageManifest(
    "{\"dependencies\":{\"remote\":{\"url\":\"https://example.com/remote.git\",\"version\":\"1.2\"}}}",
    "/app/doof.json", "/app", "linux",
  )
  _ := result else error {
    Assert.stringContains(error, "dependencies.remote.ref is required")
    return
  }
  panic("expected floating package dependency failure")
}

export function testParsesRootResolutionsAndPolicy(): void {
  manifest := try! parsePackageManifest(
    "{\"resolutions\":{\"packages\":{\"remote\":{\"url\":\"https://example.com/remote.git\",\"ref\":\"v2\",\"commit\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}},\"externalDependencies\":{\"quickjs\":{\"kind\":\"archive\",\"url\":\"https://example.com/quickjs.tar.xz\",\"sha256\":\"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\"}}},\"policy\":{\"allowedPackageSources\":[\"https://example.com/remote.git\"],\"allowedExternalSources\":[\"https://example.com/quickjs.tar.xz\"],\"native\":{\"allowedLinkLibraries\":[\"z\"],\"allowedFrameworks\":[\"Foundation\"],\"allowedPkgConfigPackages\":[\"libcurl\"]}}}",
    "/app/doof.json", "/app", "macos",
  )

  Assert.equal(manifest.packageResolutions[0].commit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  Assert.equal(manifest.externalResolutions[0].sha256, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
  Assert.equal(manifest.policy.hasPackageSourceAllowlist, true)
  Assert.equal(manifest.policy.allowedExternalSources[0], "https://example.com/quickjs.tar.xz")
  Assert.equal(manifest.policy.allowedLinkLibraries[0], "z")
  Assert.equal(manifest.policy.allowedFrameworks[0], "Foundation")
  Assert.equal(manifest.policy.allowedPkgConfigPackages[0], "libcurl")
}

export function testRejectsInvalidExternalDependencyConfiguration(): void {
  missingChecksum := parsePackageManifest(
    "{\"externalDependencies\":{\"bad\":{\"kind\":\"archive\",\"url\":\"https://example.com/a.tar.gz\",\"destination\":\"vendor/a\"}}}",
    "/app/doof.json", "/app", "linux",
  )
  _ := missingChecksum else error {
    Assert.stringContains(error, "externalDependencies.bad.sha256 is required")
  }

  escapingDestination := parsePackageManifest(
    "{\"externalDependencies\":{\"bad\":{\"kind\":\"git\",\"url\":\"https://example.com/a.git\",\"ref\":\"main\",\"commit\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"destination\":\"../a\"}}}",
    "/app/doof.json", "/app", "linux",
  )
  _ := escapingDestination else error {
    Assert.stringContains(error, "externalDependencies.bad.destination must stay within the package root")
    return
  }
  panic("expected invalid external dependency failure")
}

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

export function testSelectsWasmNativeFragmentForWasmTargets(): void {
  manifest := try! parsePackageManifest(
    "{\"build\":{\"target\":\"wasm\",\"native\":{\"defines\":[\"BASE\"],\"linux\":{\"defines\":[\"LINUX\"]},\"wasm\":{\"sourceFiles\":[\"native_wasm.cpp\"],\"defines\":[\"WASM\"]}}}}",
    "/app/doof.json",
    "/app",
    "linux",
  )

  Assert.equal(manifest.target, "wasm")
  Assert.equal(manifest.nativeBuild.sourceFiles[0], "/app/native_wasm.cpp")
  Assert.equal(manifest.nativeBuild.defines.contains("BASE"), true)
  Assert.equal(manifest.nativeBuild.defines.contains("WASM"), true)
  Assert.equal(manifest.nativeBuild.defines.contains("LINUX"), false)
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

export function testParsesCompactMacOSAppAndReleaseSettings(): void {
  manifest := try! parsePackageManifest(
    "{\"name\":\"demo-app\",\"version\":\"1.2\",\"target\":\"macos-app\",\"executable\":\"Demo\",\"id\":\"dev.example.demo\",\"title\":\"Demo App\",\"icon\":\"icon.png\",\"resources\":[\"assets\"],\"build\":{\"macosApp\":{\"category\":\"public.app-category.games\",\"embeddedLibraries\":[{\"library\":\"SDL3\"},{\"path\":\"vendor/Foo.framework\"}]},\"package\":{\"distDir\":\"artifacts\",\"macos\":{\"signing\":\"ad-hoc\",\"sandbox\":true,\"entitlements\":\"release.plist\"}}}}",
    "/app/doof.json",
    "/app",
    "macos",
  )

  Assert.equal(manifest.target, "macos-app")
  Assert.equal(manifest.macosApp != null, true)
  Assert.equal(manifest.macosApp!.executableName, "Demo")
  Assert.equal(manifest.macosApp!.bundleId, "dev.example.demo")
  Assert.equal(manifest.macosApp!.displayName, "Demo App")
  Assert.equal(manifest.macosApp!.version, "1.2")
  Assert.equal(manifest.macosApp!.iconPath, "/app/icon.png")
  Assert.equal(manifest.macosApp!.resources[0].sourcePath, "/app/assets")
  Assert.equal(manifest.macosApp!.embeddedLibraries[0].library, "SDL3")
  Assert.equal(manifest.macosApp!.embeddedLibraries[1].path, "/app/vendor/Foo.framework")
  Assert.equal(manifest.packageConfig!.distDirectory, "/app/artifacts")
  Assert.equal(manifest.packageConfig!.signing, "ad-hoc")
  Assert.equal(manifest.packageConfig!.sandbox, true)
  Assert.equal(manifest.packageConfig!.entitlementsPath, "/app/release.plist")
}

export function testRejectsManagedMacOSInfoPlistOverrides(): void {
  result := parsePackageManifest(
    "{\"name\":\"demo\",\"build\":{\"target\":\"macos-app\",\"macosApp\":{\"infoPlist\":{\"CFBundleIdentifier\":\"override\"}}}}",
    "/app/doof.json",
    "/app",
    "macos",
  )
  _ := result else error {
    Assert.stringContains(error, "CFBundleIdentifier conflicts with a Doof-managed Info.plist key")
    return
  }
  panic("expected managed plist override failure")
}

export function testParsesIOSAppAndPackageSettings(): void {
  manifest := try! parsePackageManifest(
    "{\"name\":\"demo-ios\",\"version\":\"2.0\",\"target\":\"ios-app\",\"executable\":\"Demo\",\"build\":{\"iosApp\":{\"bundleId\":\"dev.example.ios\",\"displayName\":\"Demo iOS\",\"minimumDeploymentTarget\":\"17.0\",\"icon\":\"icon.png\",\"resources\":[{\"from\":\"assets\",\"to\":\"Data\"}]},\"package\":{\"ios\":{\"identity\":\"Apple Distribution: Example\",\"provisioningProfile\":\"profiles/app.mobileprovision\"}},\"native\":{\"frameworks\":[\"Base\"],\"iosDevice\":{\"frameworks\":[\"UIKit\"]}}}}",
    "/app/doof.json",
    "/app",
    "ios-device",
  )

  Assert.equal(manifest.iosApp != null, true)
  Assert.equal(manifest.iosApp!.executableName, "Demo")
  Assert.equal(manifest.iosApp!.bundleId, "dev.example.ios")
  Assert.equal(manifest.iosApp!.minimumDeploymentTarget, "17.0")
  Assert.equal(manifest.iosApp!.iconPath, "/app/icon.png")
  Assert.equal(manifest.iosApp!.resources[0].destination, "Data")
  Assert.equal(manifest.nativeBuild.frameworks.contains("UIKit"), true)
  Assert.equal(manifest.iosPackageConfig!.identity, "Apple Distribution: Example")
  Assert.equal(manifest.iosPackageConfig!.provisioningProfilePath, "/app/profiles/app.mobileprovision")
}

export function testRejectsManagedIOSInfoPlistOverrides(): void {
  result := parsePackageManifest(
    "{\"name\":\"demo\",\"build\":{\"target\":\"ios-app\",\"iosApp\":{\"infoPlist\":{\"CFBundleIdentifier\":\"override\"}}}}",
    "/app/doof.json",
    "/app",
    "ios-simulator",
  )
  _ := result else error {
    Assert.stringContains(error, "CFBundleIdentifier conflicts with a Doof-managed Info.plist key")
    return
  }
  panic("expected managed plist override failure")
}

export function testRejectsInvalidMacOSSigningMode(): void {
  result := parsePackageManifest(
    "{\"name\":\"demo\",\"build\":{\"package\":{\"macos\":{\"signing\":\"mystery\"}}}}",
    "/app/doof.json",
    "/app",
    "macos",
  )
  _ := result else error {
    Assert.stringContains(error, "build.package.macos.signing")
    return
  }
  panic("expected invalid signing mode failure")
}

export function testRejectsMacOSPackagePathsOutsidePackageRoot(): void {
  result := parsePackageManifest(
    "{\"name\":\"demo\",\"build\":{\"package\":{\"distDir\":\"../artifacts\"}}}",
    "/app/doof.json",
    "/app",
    "macos",
  )
  _ := result else error {
    Assert.stringContains(error, "build.package.distDir must stay within the package root")
    return
  }
  panic("expected invalid dist directory failure")
}
