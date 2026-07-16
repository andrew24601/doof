import { Assert } from "std/assert"
import { MacOSAppConfig, macOSCodesignArguments, macOSPackageArchiveName, renderMacOSInfoPlist } from "./macos-app"

export function testRendersMacOSInfoPlistAndCustomMetadata(): void {
  custom: JsonObject := {}
  custom.set("NSLocalNetworkUsageDescription", "Find nearby players & hosts.")
  services: JsonValue[] := ["_doof._tcp"]
  custom.set("NSBonjourServices", services)
  plist := renderMacOSInfoPlist(MacOSAppConfig {
    executableName: "DoofDemo",
    bundleId: "dev.doof.demo",
    displayName: "Doof & Demo",
    version: "1.2.3",
    iconPath: "/app/icon.png",
    infoPlist: custom,
    category: "public.app-category.games",
    minimumSystemVersion: "12.0",
  })

  Assert.stringContains(plist, "<string>dev.doof.demo</string>")
  Assert.stringContains(plist, "<string>Doof &amp; Demo</string>")
  Assert.stringContains(plist, "<string>DoofDemo.icns</string>")
  Assert.stringContains(plist, "<key>NSBonjourServices</key>")
  Assert.stringContains(plist, "<array>")
}

export function testPlansMacOSPackageNamesAndSigningArguments(): void {
  Assert.equal(macOSPackageArchiveName("Demo", "1.0 beta"), "Demo-1.0-beta-macos.zip")
  arguments := macOSCodesignArguments("/tmp/Demo.app", "-", "ad-hoc", "/tmp/entitlements.plist")
  Assert.equal(arguments.contains("--timestamp=none"), true)
  Assert.equal(arguments.contains("--entitlements"), true)
  Assert.equal(arguments[arguments.length - 1], "/tmp/Demo.app")
}
