import { Assert } from "std/assert"
import { parseCli } from "./cli"

export function testParsesEmitRequest(): void {
  result := parseCli(["emit", "main.do", "-o", "build", "--source", "math.do", "--module", "std/assert", "assert.do"])
  Assert.equal(result.error, "")
  Assert.equal(result.help, false)
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "emit")
  Assert.equal(result.request!.entry, "main.do")
  Assert.equal(result.request!.outputDirectory, "build")
  Assert.equal(result.request!.sourcePaths.length, 1)
  Assert.equal(result.request!.sourcePaths[0], "math.do")
  Assert.equal(result.request!.moduleSources.length, 1)
  Assert.equal(result.request!.moduleSources[0].specifier, "std/assert")
  Assert.equal(result.request!.moduleSources[0].sourcePath, "assert.do")
}

export function testParsesCheckWithoutOutput(): void {
  result := parseCli(["check", "main.do", "--source", "math.do", "--source", "types.do"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "check")
  Assert.equal(result.request!.outputDirectory, "")
  Assert.equal(result.request!.sourcePaths.length, 2)
}

export function testParsesBuildCompiler(): void {
  result := parseCli(["build", "main.do", "--compiler", "clang++"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "build")
  Assert.equal(result.request!.compiler, "clang++")
}

export function testParsesPackageCompiler(): void {
  result := parseCli(["package", "main.do", "--compiler", "clang++"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "package")
  Assert.equal(result.request!.compiler, "clang++")
}

export function testParsesMacOSPackageOptions(): void {
  result := parseCli([
    "package", "demo", "--distdir", "artifacts", "--macos-signing", "ad-hoc",
    "--macos-sign-identity", "Developer ID Application: Example", "--macos-sandbox",
    "--macos-entitlements", "release.plist",
  ])
  Assert.equal(result.error, "")
  Assert.equal(result.request!.distDirectory, "artifacts")
  Assert.equal(result.request!.macosSigning, "ad-hoc")
  Assert.equal(result.request!.macosSignIdentity, "Developer ID Application: Example")
  Assert.equal(result.request!.macosSandbox, true)
  Assert.equal(result.request!.macosEntitlements, "release.plist")
}

export function testRejectsInvalidMacOSSigningOption(): void {
  result := parseCli(["package", "demo", "--macos-signing", "mystery"])
  Assert.equal(result.error, "invalid value for --macos-signing: mystery")
}

export function testParsesIOSBuildAndPackageOptions(): void {
  result := parseCli([
    "package", "demo", "--ios-destination", "device",
    "--ios-sign-identity", "Apple Distribution: Example",
    "--ios-provisioning-profile", "profiles/app.mobileprovision",
  ])
  Assert.equal(result.error, "")
  Assert.equal(result.request!.iosDestination, "device")
  Assert.equal(result.request!.iosSignIdentity, "Apple Distribution: Example")
  Assert.equal(result.request!.iosProvisioningProfile, "profiles/app.mobileprovision")
}

export function testRejectsInvalidIOSDestination(): void {
  result := parseCli(["build", "demo", "--ios-destination", "television"])
  Assert.equal(result.error, "invalid value for --ios-destination: television")
}

export function testParsesTestSelectionOptions(): void {
  result := parseCli(["test", "src", "--filter", "math", "--list", "--compiler", "clang++"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "test")
  Assert.equal(result.request!.entry, "src")
  Assert.equal(result.request!.filter, "math")
  Assert.equal(result.request!.listOnly, true)
  Assert.equal(result.request!.compiler, "clang++")
}

export function testRejectsMissingTestFilter(): void {
  result := parseCli(["test", "src", "--filter"])
  Assert.equal(result.error, "missing value for --filter")
}

export function testAllowsManifestDefaults(): void {
  result := parseCli(["emit", "main.do"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.entry, "main.do")
  Assert.equal(result.request!.outputDirectory, "")
}

export function testAllowsOmittedEntryForProjectDiscovery(): void {
  result := parseCli(["check"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.entry, ".")
}

export function testRejectsUnknownCommandsAndOptions(): void {
  unknownCommand := parseCli(["bundle", "main.do"])
  Assert.equal(unknownCommand.error, "unknown command 'bundle'")

  unknownOption := parseCli(["check", "main.do", "--wat"])
  Assert.equal(unknownOption.error, "unknown option '--wat'")
}

export function testRejectsInvalidExternalModuleMappings(): void {
  missingValues := parseCli(["check", "main.do", "--module", "std/assert"])
  Assert.equal(missingValues.error, "missing values for --module")

  relativeSpecifier := parseCli(["check", "main.do", "--module", "./assert", "assert.do"])
  Assert.equal(relativeSpecifier.error, "--module requires a bare module specifier")
}

export function testRecognizesHelp(): void {
  for args of [["--help"], ["help"], ["check", "main.do", "--help"]] {
    result := parseCli(args)
    Assert.equal(result.help, true)
    Assert.equal(result.error, "")
    Assert.equal(result.request == null, true)
  }
}
