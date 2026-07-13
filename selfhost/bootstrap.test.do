// Maintained bootstrap acceptance test for the complete self-hosted source graph.
// The final test exercises both the first generated compiler and the second
// compiler produced from the same graph.

import { Assert } from "std/assert"
import { decodeUtf8 } from "std/blob"
import { exists, mkdir, readText, writeText } from "std/fs"
import { run } from "std/os"
import { currentWorkingDirectory } from "std/path"
import { compile } from "./compiler"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { ModuleGraphEmission, emitModuleGraph } from "./emitter-module"
import { moduleHeaderName, moduleSourceName } from "./emitter-names"
import { SourceFile } from "./semantic"

function selfhostSourcePath(path: string): string {
  cwd := try! currentWorkingDirectory()
  direct := cwd + "/selfhost/" + path
  if exists(direct) { return direct }
  return cwd + "/../../../selfhost/" + path
}

function selfhostSources(): SourceFile[] {
  paths := [
    "lexer.do", "ast.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "compiler.do",
  ]
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/selfhost/" + path, source: try! readText(selfhostSourcePath(path)) })
  }
  return sources
}

function selfhostDriverSources(): SourceFile[] {
  paths := [
    "lexer.do", "ast.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "compiler.do", "cli.do", "project.do", "driver.do",
  ]
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/selfhost/" + path, source: try! readText(selfhostSourcePath(path)) })
  }
  sources.push(SourceFile {
    path: "/std/json/index.do",
    source: try! readText("../doof-stdlib/json/index.do"),
  })
  for path of productionStdFsPaths() {
    sources.push(SourceFile { path: "/std/" + path, source: try! readText("../doof-stdlib/" + path) })
  }
  sources.push(SourceFile { path: "/std/time/index.do", source: bootstrapStdTimeSource() })
  return sources
}

function productionStdFsPaths(): string[] {
  return [
    "fs/index.do", "fs/types.do", "path/index.do", "stream/index.do",
    "blob/index.do", "blob/types.do",
  ]
}

function bootstrapStdTimeSource(): string {
  return "export class Instant {\n  epochNanos: long\n  static ofEpochSeconds(seconds: long): Instant => Instant { epochNanos: seconds * 1000000000L }\n}\n"
}

function productionStdFsModuleName(path: string): string {
  return "std/" + path.substring(0, path.length - 3)
}

function writeProductionStdFsSources(): string[] {
  let paths: string[] = []
  for path of productionStdFsPaths() {
    outputPath := "/tmp/doof-selfhost-" + path.replaceAll("/", "-")
    try! writeText(outputPath, try! readText("../doof-stdlib/" + path))
    paths.push(outputPath)
  }
  return paths
}

function selfhostDriverPaths(): string[] {
  return [
    "lexer.do", "ast.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "compiler.do", "cli.do", "project.do", "driver.do",
  ]
}

function writeSelfhostJsonSource(): string {
  path := "/tmp/doof-selfhost-std-json.do"
  try! writeText(path, try! readText("../doof-stdlib/json/index.do"))
  return path
}

function writeSelfhostJsonSupport(): void {
  try! writeText("/tmp/native_json.hpp", try! readText("../doof-stdlib/json/native_json.hpp"))
}

function writeRuntime(): void {
  try! writeText("/tmp/doof_runtime.hpp", try! readText("doof_runtime.h"))
}

function writeBootstrapStdFsSupport(): void {
  try! writeText("/tmp/native_path.hpp", try! readText("../doof-stdlib/path/native_path.hpp"))
  try! writeText("/tmp/native_blob.hpp", try! readText("../doof-stdlib/blob/native_blob.hpp"))
  try! writeText("/tmp/native_fs.hpp", try! readText("../doof-stdlib/fs/native_fs.hpp"))
  try! writeText("/tmp/types.hpp", "#pragma once\n#include \"std_blob_types.hpp\"\n#include \"std_fs_types.hpp\"\nusing EntryKind = ::app_std_fs_types_::EntryKind;\nusing IoError = ::app_std_fs_types_::IoError;\nusing Endian = ::app_std_blob_types_::Endian;\nusing TextEncoding = ::app_std_blob_types_::TextEncoding;\nusing EncodingError = ::app_std_blob_types_::EncodingError;\nusing Instant = ::app_std_time_index_::Instant;\nnamespace doof_fs { using EntryKind = ::app_std_fs_types_::EntryKind; using IoError = ::app_std_fs_types_::IoError; using Instant = ::app_std_time_index_::Instant; using ::app_std_fs_types_::IoError_name; }\n")
}

function writeBootstrapStdTimeSource(): string {
  path := "/tmp/doof-selfhost-std-time-index.do"
  try! writeText(path, bootstrapStdTimeSource())
  return path
}

function writeSplitArtifacts(graph: ModuleGraphEmission): string[] {
  let sourcePaths: string[] = []
  for module of graph.modules {
    try! writeText("/tmp/" + module.headerName, module.header)
    sourcePath := "/tmp/" + module.sourceName
    try! writeText(sourcePath, module.source)
    sourcePaths.push(sourcePath)
  }
  return sourcePaths
}

function firstStderrLines(stderr: string, maxLines: int): string {
  lines := stderr.split("\n")
  limit := if lines.length < maxLines then lines.length else maxLines
  let result = ""
  for i of 0..<limit {
    if i > 0 { result = result + "\n" }
    result = result + lines[i]
  }
  if lines.length > maxLines { result = result + "\n... stderr truncated ..." }
  return result
}

export function testCompilesSelfhostSourceGraph(): void {
  sources := selfhostSources()
  analysis := createAnalyzer(sources).analyze("/selfhost/compiler.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  for i of 0..<analysis.modules.length {
    module := analysis.modules[analysis.modules.length - 1 - i]
    checked := checker.check(module.path)
    Assert.equal(checked.diagnostics.length, 0)
  }

  graph := emitModuleGraph(analysis, "/selfhost/compiler.do")
  Assert.equal(graph.modules.length, sources.length)
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for module of graph.modules {
    try! writeText("/tmp/" + module.headerName, module.header)
    sourcePath := "/tmp/" + module.sourceName
    try! writeText(sourcePath, module.source)
    nativeArgs.push(sourcePath)
  }
  writeRuntime()
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testRunsSelfhostCompilerDriver(): void {
  result := compile(selfhostDriverSources(), "/selfhost/driver.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)

  driverSources := writeSplitArtifacts(result.emission!)
  driverBinary := "/tmp/doof-selfhost-driver"
  writeRuntime()
  writeBootstrapStdFsSupport()
  writeSelfhostJsonSupport()

  let linkArgs: string[] = ["-std=c++17", "-framework", "CoreFoundation"]
  for sourcePath of driverSources { linkArgs.push(sourcePath) }
  linkArgs.push("-o")
  linkArgs.push(driverBinary)
  linked := try! run("clang++", linkArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)

  entry := "/tmp/doof-b4-main.do"
  math := "/tmp/doof-b4-math.do"
  outputDirectory := "/tmp/doof-b4-generated"
  try! writeText(entry, "import { add } from \"doof-b4-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  generated := try! run(driverBinary, ["emit", entry, "-o", outputDirectory, "--module", "doof-b4-math", math])
  if generated.exitCode != 0 { println(decodeUtf8(generated.stdout)!) }
  if generated.exitCode != 0 { println(decodeUtf8(generated.stderr)!) }
  Assert.equal(generated.exitCode, 0)
  Assert.equal(
    try! readText(outputDirectory + "/doof_runtime.hpp"),
    try! readText("doof_runtime.h"),
  )
  generatedHeader := try! readText(outputDirectory + "/" + moduleHeaderName(entry))
  generatedSource := try! readText(outputDirectory + "/" + moduleSourceName(entry))
  Assert.equal(generatedHeader.length > 0, true)
  Assert.equal(generatedSource.length > 0, true)

  checked := try! run(driverBinary, ["check", entry, "--module", "doof-b4-math", math])
  Assert.equal(checked.exitCode, 0)

  targetBinary := "/tmp/doof-b4-generated-program"
  targetSource := outputDirectory + "/" + moduleSourceName(entry)
  targetDependency := outputDirectory + "/" + moduleSourceName("/doof-b4-math.do")
  target := try! run("clang++", ["-std=c++17", targetSource, targetDependency, "-I", outputDirectory, "-o", targetBinary])
  if target.exitCode != 0 { println(firstStderrLines(decodeUtf8(target.stderr)!, 8)) }
  Assert.equal(target.exitCode, 0)
  executed := try! run(targetBinary)
  Assert.equal(executed.exitCode, 5)

  manifestProject := "/tmp/doof-selfhost-manifest-project"
  manifestEntry := manifestProject + "/src/main.do"
  if !exists(manifestProject) { try! mkdir(manifestProject) }
  if !exists(manifestProject + "/src") { try! mkdir(manifestProject + "/src") }
  try! writeText(manifestProject + "/doof.json", "{\n  \"name\": \"manifest-demo\",\n  \"build\": { \"entry\": \"src/main.do\", \"buildDir\": \"generated\" }\n}\n")
  try! writeText(manifestEntry, "function main(): int => 7\n")
  manifestCheck := try! run(driverBinary, ["check", manifestProject])
  if manifestCheck.exitCode != 0 { println(decodeUtf8(manifestCheck.stdout)!) }
  Assert.equal(manifestCheck.exitCode, 0)
  manifestEmit := try! run(driverBinary, ["emit", manifestProject])
  if manifestEmit.exitCode != 0 { println(decodeUtf8(manifestEmit.stdout)!) }
  if manifestEmit.exitCode != 0 { println(decodeUtf8(manifestEmit.stderr)!) }
  Assert.equal(manifestEmit.exitCode, 0)
  Assert.equal((try! readText(manifestProject + "/generated/" + moduleHeaderName("/tmp/doof-selfhost-manifest-project/src/main.do"))).length > 0, true)

}

export function testTwoStageBootstrapsSelfhostCompiler(): void {
  result := compile(selfhostDriverSources(), "/selfhost/driver.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)

  driverSources := writeSplitArtifacts(result.emission!)
  driverBinary := "/tmp/doof-selfhost-b5-driver"
  writeRuntime()
  writeBootstrapStdFsSupport()
  writeSelfhostJsonSupport()

  let linkArgs: string[] = ["-std=c++17", "-framework", "CoreFoundation"]
  for sourcePath of driverSources { linkArgs.push(sourcePath) }
  linkArgs.push("-o")
  linkArgs.push(driverBinary)
  linked := try! run("clang++", linkArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)

  bootstrapDirectory := "/tmp/doof-selfhost-b5-compiler"
  bootstrapEntry := selfhostSourcePath("driver.do")
  jsonSourcePath := writeSelfhostJsonSource()
  fsSourcePaths := writeProductionStdFsSources()
  timeSourcePath := writeBootstrapStdTimeSource()
  let bootstrapArgs: string[] = ["emit", bootstrapEntry, "-o", bootstrapDirectory]
  for path of selfhostDriverPaths() {
    bootstrapArgs.push("--source")
    bootstrapArgs.push(selfhostSourcePath(path))
  }
  bootstrapArgs.push("--module")
  bootstrapArgs.push("std/json/index")
  bootstrapArgs.push(jsonSourcePath)
  bootstrapArgs.push("--module")
  bootstrapArgs.push("std/time/index")
  bootstrapArgs.push(timeSourcePath)
  for i of 0..<productionStdFsPaths().length {
    bootstrapArgs.push("--module")
    bootstrapArgs.push(productionStdFsModuleName(productionStdFsPaths()[i]))
    bootstrapArgs.push(fsSourcePaths[i])
  }
  generated := try! run(driverBinary, bootstrapArgs)
  if generated.exitCode != 0 { println(decodeUtf8(generated.stdout)!) }
  if generated.exitCode != 0 { println(decodeUtf8(generated.stderr)!) }
  Assert.equal(generated.exitCode, 0)

  bootstrapBinary := "/tmp/doof-selfhost-b5-compiler-bin"
  let bootstrapLinkArgs: string[] = ["-std=c++17", "-framework", "CoreFoundation"]
  for path of selfhostDriverPaths() {
    bootstrapLinkArgs.push(bootstrapDirectory + "/" + moduleSourceName("/selfhost/" + path))
  }
  bootstrapLinkArgs.push("-o")
  bootstrapLinkArgs.push(bootstrapBinary)
  linkedBootstrap := try! run("clang++", bootstrapLinkArgs)
  if linkedBootstrap.exitCode != 0 { println("B5 link exit: " + string(linkedBootstrap.exitCode)) }
  if linkedBootstrap.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedBootstrap.stderr)!, 40)) }
  if linkedBootstrap.exitCode != 0 { println(decodeUtf8(linkedBootstrap.stdout)!) }
  Assert.equal(linkedBootstrap.exitCode, 0)

  entry := "/tmp/doof-b5-main.do"
  math := "/tmp/doof-b5-math.do"
  outputDirectory := "/tmp/doof-b5-generated"
  try! writeText(entry, "import { add } from \"doof-b5-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  smoke := try! run(bootstrapBinary, ["emit", entry, "-o", outputDirectory, "--module", "doof-b5-math", math])
  if smoke.exitCode != 0 { println("B5 smoke exit: " + string(smoke.exitCode)) }
  if smoke.exitCode != 0 { println(decodeUtf8(smoke.stdout)!) }
  if smoke.exitCode != 0 { println(decodeUtf8(smoke.stderr)!) }
  Assert.equal(smoke.exitCode, 0)

  smokeBinary := "/tmp/doof-b5-generated-program"
  linkedSmoke := try! run("clang++", ["-std=c++17", outputDirectory + "/" + moduleSourceName(entry), outputDirectory + "/" + moduleSourceName("/doof-b5-math.do"), "-I", outputDirectory, "-o", smokeBinary])
  if linkedSmoke.exitCode != 0 { println("B5 smoke link exit: " + string(linkedSmoke.exitCode)) }
  if linkedSmoke.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSmoke.stderr)!, 8)) }
  Assert.equal(linkedSmoke.exitCode, 0)
  executed := try! run(smokeBinary)
  println("B5 program exit: " + string(executed.exitCode))
  Assert.equal(executed.exitCode, 5)

  secondDirectory := "/tmp/doof-selfhost-b6-compiler"
  secondJsonSourcePath := writeSelfhostJsonSource()
  secondFsSourcePaths := writeProductionStdFsSources()
  secondTimeSourcePath := writeBootstrapStdTimeSource()
  let secondArgs: string[] = ["emit", bootstrapEntry, "-o", secondDirectory]
  for path of selfhostDriverPaths() {
    secondArgs.push("--source")
    secondArgs.push(selfhostSourcePath(path))
  }
  secondArgs.push("--module")
  secondArgs.push("std/json/index")
  secondArgs.push(secondJsonSourcePath)
  secondArgs.push("--module")
  secondArgs.push("std/time/index")
  secondArgs.push(secondTimeSourcePath)
  for i of 0..<productionStdFsPaths().length {
    secondArgs.push("--module")
    secondArgs.push(productionStdFsModuleName(productionStdFsPaths()[i]))
    secondArgs.push(secondFsSourcePaths[i])
  }
  secondGenerated := try! run(bootstrapBinary, secondArgs)
  if secondGenerated.exitCode != 0 { println(decodeUtf8(secondGenerated.stdout)!) }
  if secondGenerated.exitCode != 0 { println(decodeUtf8(secondGenerated.stderr)!) }
  Assert.equal(secondGenerated.exitCode, 0)

  secondBinary := "/tmp/doof-selfhost-b6-compiler-bin"
  let secondLinkArgs: string[] = ["-std=c++17", "-framework", "CoreFoundation"]
  for path of selfhostDriverPaths() {
    secondLinkArgs.push(secondDirectory + "/" + moduleSourceName("/selfhost/" + path))
  }
  secondLinkArgs.push("-o")
  secondLinkArgs.push(secondBinary)
  linkedSecond := try! run("clang++", secondLinkArgs)
  if linkedSecond.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSecond.stderr)!, 8)) }
  Assert.equal(linkedSecond.exitCode, 0)

  secondOutputDirectory := "/tmp/doof-b6-generated"
  secondSmoke := try! run(secondBinary, ["emit", entry, "-o", secondOutputDirectory, "--module", "doof-b5-math", math])
  if secondSmoke.exitCode != 0 { println("B6 smoke exit: " + string(secondSmoke.exitCode)) }
  if secondSmoke.exitCode != 0 { println(decodeUtf8(secondSmoke.stdout)!) }
  if secondSmoke.exitCode != 0 { println(decodeUtf8(secondSmoke.stderr)!) }
  Assert.equal(secondSmoke.exitCode, 0)

  secondSmokeBinary := "/tmp/doof-b6-generated-program"
  linkedSecondSmoke := try! run("clang++", ["-std=c++17", secondOutputDirectory + "/" + moduleSourceName(entry), secondOutputDirectory + "/" + moduleSourceName("/doof-b5-math.do"), "-I", secondOutputDirectory, "-o", secondSmokeBinary])
  if linkedSecondSmoke.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSecondSmoke.stderr)!, 8)) }
  Assert.equal(linkedSecondSmoke.exitCode, 0)
  secondExecuted := try! run(secondSmokeBinary)
  println("B6 program exit: " + string(secondExecuted.exitCode))
  Assert.equal(secondExecuted.exitCode, 5)
}
