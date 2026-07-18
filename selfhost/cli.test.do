import { Assert } from "std/assert"
import { parseCli } from "./cli"

export function testParsesEmitRequest(): void {
  result := parseCli(["emit", "main.do", "-o", "build"])
  Assert.equal(result.error, "")
  Assert.equal(result.help, false)
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "emit")
  Assert.equal(result.request!.entry, "main.do")
  Assert.equal(result.request!.outputDirectory, "build")
}

export function testParsesCheckWithoutOutput(): void {
  result := parseCli(["check", "main.do"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "check")
  Assert.equal(result.request!.outputDirectory, "")
}

export function testParsesBuildCompiler(): void {
  result := parseCli(["build", "main.do", "--compiler", "clang++"])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "build")
  Assert.equal(result.request!.compiler, "clang++")
}

export function testParsesRunProgramArgumentsAfterSeparator(): void {
  result := parseCli([
    "run", "demo", "--compiler", "clang++", "--",
    "--listen", "127.0.0.1:8080", "--output-directory", "program-output",
  ])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "run")
  Assert.equal(result.request!.entry, "demo")
  Assert.equal(result.request!.compiler, "clang++")
  Assert.equal(result.request!.programArguments.length, 4)
  Assert.equal(result.request!.programArguments[0], "--listen")
  Assert.equal(result.request!.programArguments[1], "127.0.0.1:8080")
  Assert.equal(result.request!.programArguments[2], "--output-directory")
  Assert.equal(result.request!.programArguments[3], "program-output")
}

export function testRejectsProgramArgumentSeparatorForNonRunCommands(): void {
  result := parseCli(["build", "demo", "--", "--verbose"])
  Assert.equal(result.error, "-- is only supported with the run command")
}

export function testParsesWasmTargetOverride(): void {
  result := parseCli(["build", "main.do", "--target", "wasm"])
  Assert.equal(result.error, "")
  Assert.equal(result.request!.targetOverride, "wasm")
}

export function testRejectsInvalidTargetOverride(): void {
  result := parseCli(["build", "main.do", "--target", "browser"])
  Assert.equal(result.error, "invalid value for --target: browser")
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
    "--ios-device", "device-123",
    "--ios-sign-identity", "Apple Distribution: Example",
    "--ios-provisioning-profile", "profiles/app.mobileprovision",
  ])
  Assert.equal(result.error, "")
  Assert.equal(result.request!.iosDestination, "device")
  Assert.equal(result.request!.iosDevice, "device-123")
  Assert.equal(result.request!.iosSignIdentity, "Apple Distribution: Example")
  Assert.equal(result.request!.iosProvisioningProfile, "profiles/app.mobileprovision")
}

export function testRejectsMissingIOSDevice(): void {
  result := parseCli(["run", "demo", "--ios-device"])
  Assert.equal(result.error, "missing value for --ios-device")
}

export function testRejectsInvalidIOSDestination(): void {
  result := parseCli(["build", "demo", "--ios-destination", "television"])
  Assert.equal(result.error, "invalid value for --ios-destination: television")
}

export function testParsesTestSelectionOptions(): void {
  result := parseCli([
    "test", "src", "--filter", "math", "--list", "--compiler", "clang++",
    "--coverage", "--coverage-output", "reports/coverage.json",
  ])
  Assert.equal(result.error, "")
  Assert.equal(result.request != null, true)
  Assert.equal(result.request!.command, "test")
  Assert.equal(result.request!.entry, "src")
  Assert.equal(result.request!.filter, "math")
  Assert.equal(result.request!.listOnly, true)
  Assert.equal(result.request!.compiler, "clang++")
  Assert.equal(result.request!.coverage, true)
  Assert.equal(result.request!.coverageOutput, "reports/coverage.json")
}

export function testDefaultsTestCoverageToDisabled(): void {
  result := parseCli(["test", "src"])
  Assert.equal(result.error, "")
  Assert.equal(result.request!.coverage, false)
  Assert.equal(result.request!.coverageOutput, "")
}

export function testRejectsMissingCoverageOutput(): void {
  result := parseCli(["test", "src", "--coverage-output"])
  Assert.equal(result.error, "missing value for --coverage-output")
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

export function testRejectsRemovedSourceGraphOverrides(): void {
  for option of ["--source", "--module", "--allow-local-dependencies"] {
    result := parseCli(["check", "main.do", option])
    Assert.equal(result.error, "unknown option '" + option + "'")
  }
}

export function testRecognizesHelp(): void {
  for args of [["--help"], ["help"], ["check", "main.do", "--help"]] {
    result := parseCli(args)
    Assert.equal(result.help, true)
    Assert.equal(result.error, "")
    Assert.equal(result.request == null, true)
  }
}
