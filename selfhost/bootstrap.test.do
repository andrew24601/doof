// Maintained bootstrap acceptance test for the complete self-hosted source graph.
// The final test exercises both the first generated compiler and the second
// compiler produced from the same graph.

import { Assert } from "std/assert"
import { decodeUtf8 } from "std/blob"
import { readText, writeText } from "std/fs"
import { run } from "std/os"
import { compile } from "./compiler"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { emitModuleGraph } from "./emitter-module"
import { SourceFile } from "./semantic"

function selfhostSources(): SourceFile[] {
  paths := [
    "lexer.do", "ast.do", "parser.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "emitter-project.do", "compiler.do",
  ]
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/selfhost/" + path, source: try! readText("selfhost/" + path) })
  }
  return sources
}

function selfhostDriverSources(): SourceFile[] {
  paths := [
    "lexer.do", "ast.do", "parser.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "emitter-project.do", "compiler.do", "driver.do",
  ]
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/selfhost/" + path, source: try! readText("selfhost/" + path) })
  }
  return sources
}

function selfhostDriverPaths(): string[] {
  return [
    "lexer.do", "ast.do", "parser.do", "semantic.do", "resolver.do", "analyzer.do",
    "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do",
    "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do",
    "emitter-names.do", "emitter-module.do", "emitter-project.do", "compiler.do", "driver.do",
  ]
}

function writeRuntime(): void {
  try! writeText("/tmp/doof_runtime.hpp", "#pragma once\n#include <filesystem>\n#include <fstream>\n#include <iostream>\n#include <sstream>\n#include <stdexcept>\n#include <string>\n#include <utility>\n#include <vector>\nnamespace doof { [[noreturn]] inline void panic(const std::string& message); template <typename T> std::string to_string(const T& value) { return std::to_string(value); } inline std::string to_string(const std::string& value) { return value; } inline std::string to_string(const char& value) { return std::string(1, value); } inline std::string to_string(const char32_t& value) { return std::string(1, static_cast<char>(value)); } inline void println(const std::string& value) { std::cout << value << std::endl; } inline std::string read_file(const std::string& path) { std::ifstream input(path); if (!input) panic(\"cannot read file: \" + path); std::ostringstream contents; contents << input.rdbuf(); return contents.str(); } inline void write_file(const std::string& path, const std::string& contents) { std::ofstream output(path); if (!output) panic(\"cannot write file: \" + path); output << contents; } inline std::string absolute_path(const std::string& path) { return std::filesystem::absolute(path).lexically_normal().string(); } [[noreturn]] inline void panic(const std::string& message) { throw std::runtime_error(message); } }\n")
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
  result := compile(selfhostSources(), "/selfhost/compiler.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)

  headerPath := "/tmp/doof-selfhost-bootstrap.hpp"
  sourcePath := "/tmp/doof-selfhost-bootstrap.cpp"
  source := result.emission!.source.replace("#include \"selfhost.hpp\"", "#include \"doof-selfhost-bootstrap.hpp\"")
  try! writeText(headerPath, result.emission!.header)
  try! writeText(sourcePath, source)
  writeRuntime()

  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testCompilesSplitSelfhostSourceGraph(): void {
  analysis := createAnalyzer(selfhostSources()).analyze("/selfhost/compiler.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  for i of 0..<analysis.modules.length {
    module := analysis.modules[analysis.modules.length - 1 - i]
    checked := checker.check(module.path)
    Assert.equal(checked.diagnostics.length, 0)
  }

  graph := emitModuleGraph(analysis, "/selfhost/compiler.do")
  Assert.equal(graph.modules.length, 18)
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

  driverHeader := "/tmp/doof-selfhost-driver.hpp"
  driverSource := "/tmp/doof-selfhost-driver.cpp"
  driverBinary := "/tmp/doof-selfhost-driver"
  source := result.emission!.source.replace("#include \"selfhost.hpp\"", "#include \"doof-selfhost-driver.hpp\"")
  try! writeText(driverHeader, result.emission!.header)
  try! writeText(driverSource, source)
  writeRuntime()

  linked := try! run("clang++", ["-std=c++17", driverSource, "-o", driverBinary])
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)

  entry := "/tmp/doof-b4-main.do"
  math := "/tmp/doof-b4-math.do"
  outputPrefix := "/tmp/doof-b4-generated"
  try! writeText(entry, "import { add } from \"./doof-b4-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  generated := try! run(driverBinary, [entry, outputPrefix, math])
  if generated.exitCode != 0 { println(decodeUtf8(generated.stdout)!) }
  Assert.equal(generated.exitCode, 0)
  generatedHeader := try! readText(outputPrefix + ".hpp")
  generatedSource := try! readText(outputPrefix + ".cpp")
  Assert.equal(generatedHeader.length > 0, true)
  Assert.equal(generatedSource.length > 0, true)

  targetBinary := "/tmp/doof-b4-generated-program"
  targetSource := outputPrefix + ".cpp"
  target := try! run("clang++", ["-std=c++17", targetSource, "-o", targetBinary])
  if target.exitCode != 0 { println(firstStderrLines(decodeUtf8(target.stderr)!, 8)) }
  Assert.equal(target.exitCode, 0)
  executed := try! run(targetBinary)
  Assert.equal(executed.exitCode, 5)
}

export function testTwoStageBootstrapsSelfhostCompiler(): void {
  result := compile(selfhostDriverSources(), "/selfhost/driver.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)

  driverHeader := "/tmp/doof-selfhost-b5-driver.hpp"
  driverSource := "/tmp/doof-selfhost-b5-driver.cpp"
  driverBinary := "/tmp/doof-selfhost-b5-driver"
  source := result.emission!.source.replace("#include \"selfhost.hpp\"", "#include \"doof-selfhost-b5-driver.hpp\"")
  try! writeText(driverHeader, result.emission!.header)
  try! writeText(driverSource, source)
  writeRuntime()

  linked := try! run("clang++", ["-std=c++17", driverSource, "-o", driverBinary])
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)

  bootstrapPrefix := "/tmp/doof-selfhost-b5-compiler"
  let bootstrapArgs: string[] = [absolutePath("selfhost/driver.do"), bootstrapPrefix]
  for path of selfhostDriverPaths() {
    bootstrapArgs.push(absolutePath("selfhost/" + path))
  }
  generated := try! run(driverBinary, bootstrapArgs)
  if generated.exitCode != 0 { println(decodeUtf8(generated.stdout)!) }
  Assert.equal(generated.exitCode, 0)

  bootstrapBinary := "/tmp/doof-selfhost-b5-compiler-bin"
  linkedBootstrap := try! run("clang++", ["-std=c++17", bootstrapPrefix + ".cpp", "-o", bootstrapBinary])
  if linkedBootstrap.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedBootstrap.stderr)!, 8)) }
  Assert.equal(linkedBootstrap.exitCode, 0)

  entry := "/tmp/doof-b5-main.do"
  math := "/tmp/doof-b5-math.do"
  outputPrefix := "/tmp/doof-b5-generated"
  try! writeText(entry, "import { add } from \"./doof-b5-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  smoke := try! run(bootstrapBinary, [entry, outputPrefix, math])
  if smoke.exitCode != 0 { println(decodeUtf8(smoke.stdout)!) }
  Assert.equal(smoke.exitCode, 0)

  smokeBinary := "/tmp/doof-b5-generated-program"
  linkedSmoke := try! run("clang++", ["-std=c++17", outputPrefix + ".cpp", "-o", smokeBinary])
  if linkedSmoke.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSmoke.stderr)!, 8)) }
  Assert.equal(linkedSmoke.exitCode, 0)
  executed := try! run(smokeBinary)
  Assert.equal(executed.exitCode, 5)

  secondPrefix := "/tmp/doof-selfhost-b6-compiler"
  let secondArgs: string[] = [absolutePath("selfhost/driver.do"), secondPrefix]
  for path of selfhostDriverPaths() { secondArgs.push(absolutePath("selfhost/" + path)) }
  secondGenerated := try! run(bootstrapBinary, secondArgs)
  if secondGenerated.exitCode != 0 { println(decodeUtf8(secondGenerated.stdout)!) }
  Assert.equal(secondGenerated.exitCode, 0)

  secondBinary := "/tmp/doof-selfhost-b6-compiler-bin"
  linkedSecond := try! run("clang++", ["-std=c++17", secondPrefix + ".cpp", "-o", secondBinary])
  if linkedSecond.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSecond.stderr)!, 8)) }
  Assert.equal(linkedSecond.exitCode, 0)

  secondOutputPrefix := "/tmp/doof-b6-generated"
  secondSmoke := try! run(secondBinary, [entry, secondOutputPrefix, math])
  if secondSmoke.exitCode != 0 { println(decodeUtf8(secondSmoke.stdout)!) }
  Assert.equal(secondSmoke.exitCode, 0)

  secondSmokeBinary := "/tmp/doof-b6-generated-program"
  linkedSecondSmoke := try! run("clang++", ["-std=c++17", secondOutputPrefix + ".cpp", "-o", secondSmokeBinary])
  if linkedSecondSmoke.exitCode != 0 { println(firstStderrLines(decodeUtf8(linkedSecondSmoke.stderr)!, 8)) }
  Assert.equal(linkedSecondSmoke.exitCode, 0)
  secondExecuted := try! run(secondSmokeBinary)
  Assert.equal(secondExecuted.exitCode, 5)
}
