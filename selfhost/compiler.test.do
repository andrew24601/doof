import { Assert } from "std/assert"
import { readText, writeText } from "std/fs"
import { run } from "std/os"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { Compilation, compile } from "./compiler"
import { ModuleGraphEmission, emitModuleGraph } from "./emitter-module"
import { decodeUtf8 } from "std/blob"
import { SourceFile } from "./semantic"

function compileSample(path: string): Compilation {
  return compile([
    SourceFile { path: "/sample.do", source: try! readText(path) },
  ], "/sample.do")
}

function compileSelfhostSlice(paths: string[], entry: string): Compilation {
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/selfhost/" + path, source: try! readText("selfhost/" + path) })
  }
  return compile(sources, "/selfhost/" + entry)
}

function writeSelfhostRuntime(): void {
  try! writeText("/tmp/doof_runtime.hpp", "#pragma once\n#include <stdexcept>\n#include <string>\nnamespace doof { template <typename T> std::string to_string(const T& value) { return std::to_string(value); } [[noreturn]] inline void panic(const std::string& message) { throw std::runtime_error(message); } }\n")
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

function writeFocusedArtifact(result: Compilation, name: string): string {
  headerName := "doof-" + name + ".hpp"
  headerPath := "/tmp/" + headerName
  sourcePath := "/tmp/doof-" + name + ".cpp"
  source := result.emission!.source.replace("#include \"selfhost.hpp\"", "#include \"" + headerName + "\"")
  try! writeText(headerPath, result.emission!.header)
  try! writeText(sourcePath, source)
  return sourcePath
}

function runNativeSelfhostSlice(paths: string[], entry: string, name: string): int {
  result := compileSelfhostSlice(paths, entry)
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePath := writeFocusedArtifact(result, name)
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  try! writeText("/tmp/doof-" + name + ".exit", string(native.exitCode))
  if native.exitCode != 0 {
    println(firstStderrLines(decodeUtf8(native.stderr)!, 8))
  }
  return native.exitCode
}

function assertNativeSelfhostSlice(paths: string[], entry: string, name: string): void {
  nativeExitCode := runNativeSelfhostSlice(paths, entry, name)
  Assert.equal(nativeExitCode, 0)
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

export function testCompilesAnImportedProject(): void {
  result := compile([
    SourceFile { path: "/main.do", source: "import { add } from \"./math\"\nfunction main(): int => add(2, 3)" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  Assert.equal(result.emission!.header.contains("int32_t add"), true)
}

export function testEmitsSplitImportedProject(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { sum } from \"./index\"\nfunction main(): int => sum(2, 3)" },
    SourceFile { path: "/index.do", source: "export { add as sum } from \"./lib/math\"" },
    SourceFile { path: "/lib/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  for i of 0..<analysis.modules.length {
    module := analysis.modules[analysis.modules.length - 1 - i]
    checked := checker.check(module.path)
    Assert.equal(checked.diagnostics.length, 0)
  }

  graph := emitModuleGraph(analysis, "/main.do")
  Assert.equal(graph.modules.length, 3)
  Assert.equal(graph.modules[0].headerName, "main.hpp")
  Assert.equal(graph.modules[0].sourceName, "main.cpp")
  Assert.equal(graph.modules[0].header.contains("#include \"index.hpp\""), true)
  Assert.equal(graph.modules[0].header.contains("namespace app_main_"), true)
  Assert.equal(graph.modules[1].header.contains("#include \"lib_math.hpp\""), true)
  Assert.equal(graph.modules[2].header.contains("namespace app_lib_math_"), true)
  Assert.equal(graph.modules[0].source.contains("::app_lib_math_::add(2, 3)"), true)

  sourcePaths := writeSplitArtifacts(graph)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testStopsBeforeEmissionOnAnalyzerErrors(): void {
  result := compile([
    SourceFile { path: "/main.do", source: "import { missing } from \"./math\"\nfunction main(): int => missing" },
    SourceFile { path: "/math.do", source: "export function add(): int => 1" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.emission == null, true)
}

export function testTruncatesNativeStderr(): void {
  Assert.equal(firstStderrLines("1\n2\n3\n4\n5\n6\n7\n8\n9", 8), "1\n2\n3\n4\n5\n6\n7\n8\n... stderr truncated ...")
}

export function testEmitsFocusedNullableVariantSample(): void {
  result := compileSample("selfhost/samples/nullable-variant.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePath := writeFocusedArtifact(result, "selfhost-nullable-variant")
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedNullableAstConstructionSample(): void {
  result := compileSample("selfhost/samples/nullable-ast-construction.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePath := writeFocusedArtifact(result, "selfhost-nullable-ast-construction")
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedNullableAliasAssignmentSample(): void {
  result := compileSample("selfhost/samples/nullable-alias-assignment.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePath := writeFocusedArtifact(result, "selfhost-nullable-alias-assignment")
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedRecursiveAstUnionSample(): void {
  result := compileSample("selfhost/samples/recursive-ast-union.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePath := writeFocusedArtifact(result, "selfhost-recursive-ast-union")
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePath])
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedLambdaBodyUnionSample(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "samples/lambda-body-union.do"], "samples/lambda-body-union.do", "selfhost-lambda-body-union")
}

export function testCompilesSelfhostParserSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do"], "parser.do", "selfhost-parser")
}

export function testCompilesSelfhostAnalyzerSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do"], "analyzer.do", "selfhost-analyzer")
}

export function testCompilesSelfhostCheckerSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do"], "checker.do", "selfhost-checker")
}

export function testCompilesSelfhostEmitterExprSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr.do"], "emitter-expr.do", "selfhost-emitter-expr")
}

export function testCompilesSelfhostEmitterStmtSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr.do", "emitter-stmt.do"], "emitter-stmt.do", "selfhost-emitter-stmt")
}

export function testCompilesSelfhostEmitterDeclSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do"], "emitter-decl.do", "selfhost-emitter-decl")
}

export function testCompilesSelfhostEmitterHeaderSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do"], "emitter-header.do", "selfhost-emitter-header")
}
