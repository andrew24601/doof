import { Assert } from "std/assert"
import {
  IOSAppConfig, iosCodesignArguments, iosExactApplicationIdentifier, iosPackageArchiveName, iosTargetTriple,
  renderIOSInfoPlist, renderIOSMainSource,
} from "./ios-app"

export function testRendersIOSSupportFiles(): void {
  custom: JsonObject := {}
  custom.set("NSCameraUsageDescription", "Scan & share")
  config := IOSAppConfig {
    executableName: "DoofDemo",
    bundleId: "dev.doof.demo",
    displayName: "Doof & Demo",
    version: "1.2.3",
    infoPlist: custom,
    minimumDeploymentTarget: "16.0",
  }
  plist := renderIOSInfoPlist(config)
  main := renderIOSMainSource(config.executableName)

  Assert.stringContains(plist, "<string>dev.doof.demo</string>")
  Assert.stringContains(plist, "<string>Doof &amp; Demo</string>")
  Assert.stringContains(plist, "<key>UIDeviceFamily</key>")
  Assert.stringContains(plist, "<key>NSCameraUsageDescription</key>")
  Assert.stringContains(main, "UIApplicationMain")
  Assert.stringContains(main, "doof_entry_main")
}

export function testPlansIOSTargetsArchiveAndSigning(): void {
  Assert.equal(try! iosTargetTriple("16.0", "simulator", "arm64"), "arm64-apple-ios16.0-simulator")
  Assert.equal(try! iosTargetTriple("16.0", "simulator", "x86_64"), "x86_64-apple-ios16.0-simulator")
  Assert.equal(try! iosTargetTriple("16.0", "device", "arm64"), "arm64-apple-ios16.0")
  Assert.equal(iosPackageArchiveName("Demo", "1.0 beta"), "Demo-1.0-beta-ios.ipa")
  arguments := iosCodesignArguments("/tmp/Demo.app", "Apple Distribution: Example", "/tmp/entitlements.plist")
  Assert.equal(arguments.contains("--generate-entitlement-der"), true)
  Assert.equal(arguments[arguments.length - 1], "/tmp/Demo.app")
}

export function testExpandsWildcardProfileApplicationIdentifierForSigning(): void {
  Assert.equal(
    try! iosExactApplicationIdentifier("TEAMID.dev.doof.*", "dev.doof.demo"),
    "TEAMID.dev.doof.demo",
  )
  Assert.equal(
    try! iosExactApplicationIdentifier("TEAMID.dev.doof.demo", "dev.doof.demo"),
    "TEAMID.dev.doof.demo",
  )
}

export function testRejectsMismatchedProfileApplicationIdentifierForSigning(): void {
  result := iosExactApplicationIdentifier("TEAMID.dev.other.*", "dev.doof.demo")
  Assert.equal(result.isFailure(), true)
  case result { failure: Failure<string> -> Assert.stringContains(failure.error, "does not match bundle id") }
}
