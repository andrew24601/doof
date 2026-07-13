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
  unknownCommand := parseCli(["build", "main.do"])
  Assert.equal(unknownCommand.error, "unknown command 'build'")

  unknownOption := parseCli(["check", "main.do", "--compiler", "clang++"])
  Assert.equal(unknownOption.error, "unknown option '--compiler'")
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
