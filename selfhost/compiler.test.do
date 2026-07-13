import { Assert } from "std/assert"
import { readText, writeText } from "std/fs"
import { run } from "std/os"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { Compilation, compile, compileWithLoader } from "./compiler"
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
  if entry == "parser.do" {
    analysis := createAnalyzer(sources).analyze("/selfhost/" + entry)
    for module of analysis.modules {
      println("DEBUG module " + module.path + " lines=" + string(module.program.span.end.line) + " symbols=" + string(module.symbols.length) + " imports=" + string(module.imports.length))
      if module.path == "/selfhost/parser.do" {
        for imported of module.imports { println("DEBUG import " + imported.localName + " => " + (if imported.symbol == null then "null" else imported.symbol!.name + "@" + imported.symbol!.module)) }
      }
      if module.path == "/selfhost/parser-declarations.do" {
        for imported of module.imports { println("DEBUG decl import " + imported.localName + " typeOnly=" + string(imported.typeOnly)) }
      }
      for imported of module.imports { if imported.localName == "Parser" { println("DEBUG parser-type " + module.path + " => " + (if imported.symbol == null then "null" else imported.symbol!.name + "@" + imported.symbol!.module)) } }
    }
    debugChecker := createChecker(analysis)
    for module of analysis.modules {
      debugChecked := debugChecker.check(module.path)
      for diagnostic of debugChecked.diagnostics { println("DEBUG checked " + module.path + " => " + diagnostic.module + ":" + string(diagnostic.span.start.line) + ":" + diagnostic.message) }
    }
  }
  return compile(sources, "/selfhost/" + entry)
}

function writeSelfhostRuntime(): void {
  try! writeText("/tmp/doof_runtime.hpp", try! readText("doof_runtime.h"))
}

function productionTimeHeader(): string {
  let header = try! readText("../doof-stdlib/time/doof_time.hpp")
  header = header.replaceAll(
    "namespace std_ {\nnamespace time {\nnamespace temporal {",
    "namespace app_std_time_temporal_ {",
  )
  header = header.replaceAll(
    "}  // namespace temporal\n}  // namespace time\n}  // namespace std_",
    "}  // namespace app_std_time_temporal_",
  )
  return header.replaceAll("::std_::time::temporal::", "::app_std_time_temporal_::")
}

function writeProductionStdFsNativeSupport(): void {
  try! writeText("/tmp/native_fs.hpp", try! readText("../doof-stdlib/fs/native_fs.hpp"))
  try! writeText("/tmp/native_path.hpp", try! readText("../doof-stdlib/path/native_path.hpp"))
  try! writeText("/tmp/native_blob.hpp", try! readText("../doof-stdlib/blob/native_blob.hpp"))
  try! writeText("/tmp/doof_time.hpp", productionTimeHeader())
  try! writeText("/tmp/types.hpp", "#pragma once\n#include \"std_blob_types.hpp\"\n#include \"std_fs_types.hpp\"\nusing EntryKind = ::app_std_fs_types_::EntryKind; using IoError = ::app_std_fs_types_::IoError;\nusing Endian = ::app_std_blob_types_::Endian; using TextEncoding = ::app_std_blob_types_::TextEncoding; using EncodingError = ::app_std_blob_types_::EncodingError;\nnamespace doof_fs { using EntryKind = ::app_std_fs_types_::EntryKind; using IoError = ::app_std_fs_types_::IoError; using Instant = ::app_std_time_temporal_::Instant; using ::app_std_fs_types_::IoError_name; }\n")
}

function productionStdFsSources(mainSource: string): SourceFile[] {
  paths := [
    "fs/index.do", "fs/types.do", "path/index.do", "stream/index.do",
    "blob/index.do", "blob/types.do", "time/index.do", "time/duration.do",
    "time/temporal.do", "time/stopwatch.do",
  ]
  let sources: SourceFile[] = [SourceFile { path: "/main.do", source: mainSource }]
  for path of paths {
    sources.push(SourceFile { path: "/std/" + path, source: try! readText("../doof-stdlib/" + path) })
  }
  return sources
}

export function testSelfhostRuntimeHasNoLegacyJsonOrIoShims(): void {
  driver := try! readText("selfhost/driver.do")
  project := try! readText("selfhost/project.do")
  runtime := try! readText("doof_runtime.h")
  Assert.equal(driver.contains("readFile("), false)
  Assert.equal(driver.contains("writeFile("), false)
  Assert.equal(driver.contains("read_file"), false)
  Assert.equal(driver.contains("write_file"), false)
  Assert.equal(driver.contains("class JsonParser"), false)
  Assert.equal(driver.contains("parse_json"), false)
  Assert.equal(project.contains("readFile("), false)
  Assert.equal(runtime.contains("read_file"), false)
  Assert.equal(runtime.contains("write_file"), false)
  Assert.equal(runtime.contains("ProjectJsonParser"), false)
  Assert.equal(runtime.contains("parse_json"), false)
  Assert.equal(driver.contains("function runtimeHeader()"), false)
  Assert.equal(driver.contains("runtimeHeaderSourcePath()"), true)
  Assert.equal(runtime.contains("runtime_header_source_path()"), true)
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

function writeFocusedArtifacts(result: Compilation): string[] {
  let sourcePaths: string[] = []
  for module of result.emission!.modules {
    try! writeText("/tmp/" + module.headerName, module.header)
    sourcePath := "/tmp/" + module.sourceName
    try! writeText(sourcePath, module.source)
    sourcePaths.push(sourcePath)
  }
  return sourcePaths
}

function runNativeSelfhostSlice(paths: string[], entry: string, name: string): int {
  result := compileSelfhostSlice(paths, entry)
  for diagnostic of result.diagnostics { println(diagnostic.module + ":" + string(diagnostic.span.start.line) + ":" + string(diagnostic.span.start.column) + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
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
  Assert.equal(result.emission!.modules.length, 2)
  Assert.equal(result.emission!.modules[0].header.contains("int32_t main_"), false)
  Assert.equal(result.emission!.modules[0].header.contains("#include \"math.hpp\""), true)
}

export function testCompilesWithTransitiveSourceLoading(): void {
  let requested: string[] = []
  loader := (path: string): SourceFile | null => {
    requested.push(path)
    if path == "/lib/index.do" {
      return SourceFile { path, source: "export function add(left: int, right: int): int => left + right" }
    }
    if path == "/unused.do" {
      return SourceFile { path, source: "this is not valid Doof" }
    }
    return null
  }
  result := compileWithLoader([
    SourceFile { path: "/main.do", source: "import { add } from \"./lib\"\nfunction main(): int => add(2, 3)" },
  ], "/main.do", loader)

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  Assert.equal(result.emission!.modules.length, 2)
  Assert.equal(requested.length, 2)
  Assert.equal(requested[0], "/lib.do")
  Assert.equal(requested[1], "/lib/index.do")
}

export function testCompilesStdJsonModule(): void {
  jsonSource := try! readText("../doof-stdlib/json/index.do")
  result := compile([
    SourceFile { path: "/main.do", source: "import { parseJsonValue } from \"std/json\"\nfunction main(): int => 0" },
    SourceFile { path: "/std/json/index.do", source: jsonSource },
  ], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
}

export function testCompilesStdJsonNativeSupport(): void {
  jsonSource := try! readText("../doof-stdlib/json/index.do")
  result := compile([
    SourceFile { path: "/main.do", source: "import { formatJsonValue } from \"std/json\"\nfunction main(): string => formatJsonValue({ ok: true })" },
    SourceFile { path: "/std/json/index.do", source: jsonSource },
  ], "/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  try! writeText("/tmp/native_json.hpp", try! readText("../doof-stdlib/json/native_json.hpp"))
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testCompilesStdFsSourceGraph(): void {
  sources := productionStdFsSources("import { readText, writeText, exists, mkdir } from \"std/fs\"\nfunction main(): int => 0")
  analysis := createAnalyzer(sources).analyze("/main.do")
  for diagnostic of analysis.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  for module of analysis.modules {
    checked := checker.check(module.path)
    for diagnostic of checked.diagnostics { println(diagnostic.module + ":" + string(diagnostic.span.start.line) + ":" + string(diagnostic.span.start.column) + ": " + diagnostic.message) }
    Assert.equal(checked.diagnostics.length, 0)
  }
}

export function testEmitsProductionStdFsSourceGraph(): void {
  result := compile(productionStdFsSources("import { readText, writeText } from \"std/fs\"\nfunction main(): int {\n    path := \"/tmp/doof-production-fs-gate.txt\"\n    try! writeText(path, \"production fs\")\n    content := try! readText(path)\n    if content == \"production fs\" { return 0 }\n    return 1\n}"), "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  writeProductionStdFsNativeSupport()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 20)) }
  Assert.equal(native.exitCode, 0)
  linked := try! run("clang++", ["-std=c++17", "-o", "/tmp/doof-production-fs-gate", "/tmp/main.cpp", "-framework", "CoreFoundation"])
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 20)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run("/tmp/doof-production-fs-gate", [])
  if executed.exitCode != 0 { println(firstStderrLines(decodeUtf8(executed.stderr)!, 20)) }
  Assert.equal(executed.exitCode, 0)
}

export function testChecksRealStdFsSourceGraph(): void {
  paths := [
    "fs/index.do", "fs/types.do", "path/index.do", "stream/index.do",
    "blob/index.do", "blob/types.do", "time/index.do", "time/duration.do",
    "time/temporal.do", "time/stopwatch.do",
  ]
  let sources: SourceFile[] = []
  for path of paths {
    sources.push(SourceFile { path: "/std/" + path, source: try! readText("../doof-stdlib/" + path) })
  }
  analysis := createAnalyzer(sources).analyze("/std/fs/index.do")
  for diagnostic of analysis.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  for module of analysis.modules {
    checked := checker.check(module.path)
    for diagnostic of checked.diagnostics { println(diagnostic.module + ":" + string(diagnostic.span.start.line) + ":" + string(diagnostic.span.start.column) + ": " + diagnostic.message) }
    Assert.equal(checked.diagnostics.length, 0)
  }
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

export function testEmitsContextualEmptyArrayForConstructedField(): void {
  result := compile([
    SourceFile {
      path: "/main.do",
      source: "import { Container, countItems } from \"./model\"\nfunction make(): Container => Container { items: [] }\nfunction main(): int => make().items.length + countItems([])",
    },
    SourceFile {
      path: "/model.do",
      source: "export class Item {}\nexport class Container { items: Item[] }\nexport function countItems(items: Item[]): int => items.length",
    },
  ], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  for module of result.emission!.modules {
    Assert.equal(module.source.contains("std::variant<>"), false)
  }
  sourcePaths := writeFocusedArtifacts(result)
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

export function testStopsBeforeEmissionOnUnknownCheckedTypes(): void {
  result := compile([
    SourceFile { path: "/main.do", source: "function main(): int { values := []\nreturn 0 }" },
  ], "/main.do")
  let foundUnknownDiagnostic = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("Unknown resolved type") { foundUnknownDiagnostic = true }
  }
  Assert.equal(foundUnknownDiagnostic, true)
  Assert.equal(result.emission == null, true)
}

export function testTruncatesNativeStderr(): void {
  Assert.equal(firstStderrLines("1\n2\n3\n4\n5\n6\n7\n8\n9", 8), "1\n2\n3\n4\n5\n6\n7\n8\n... stderr truncated ...")
}

export function testEmitsFocusedNullableVariantSample(): void {
  result := compileSample("selfhost/samples/nullable-variant.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedNullableAstConstructionSample(): void {
  result := compileSample("selfhost/samples/nullable-ast-construction.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedNullableAliasAssignmentSample(): void {
  result := compileSample("selfhost/samples/nullable-alias-assignment.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedRecursiveAstUnionSample(): void {
  result := compileSample("selfhost/samples/recursive-ast-union.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testEmitsFocusedLambdaBodyUnionSample(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "samples/lambda-body-union.do"], "samples/lambda-body-union.do", "selfhost-lambda-body-union")
}

export function testCompilesAndRunsNativeClassInterop(): void {
  try! writeText("/tmp/client.hpp", "#pragma once\n#include <cstdint>\n#include <memory>\nnamespace native { struct Client : std::enable_shared_from_this<Client> { int32_t value; explicit Client(int32_t value): value(value) {} int32_t get() { return value; } static std::shared_ptr<Client> make(int32_t value) { return std::make_shared<Client>(value); } std::shared_ptr<Client> same(); }; }\n")
  result := compile([SourceFile {
    path: "/native-main.do",
    source: "import class Client from \"client.hpp\" as native::Client { value: int get(): int static make(value: int): Client same(): Client { return this } }\nfunction main(): int { client := Client { value: 4 }\nmade := Client.make(6)\nsame := client.same()\nreturn client.get() + made.get() + same.get() }",
  }], "/native-main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  binaryPath := "/tmp/doof-selfhost-native-class"
  let nativeArgs: string[] = ["-std=c++17"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  nativeArgs.push("-I")
  nativeArgs.push("/tmp")
  nativeArgs.push("-o")
  nativeArgs.push(binaryPath)
  linked := try! run("clang++", nativeArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run(binaryPath)
  Assert.equal(executed.exitCode, 14)
}

export function testCompilesAndRunsInterfaceDispatch(): void {
  result := compile([SourceFile {
    path: "/interface-main.do",
    source: "interface Drawable { value: int\nrender(): int }\nclass Point implements Drawable { readonly value: int\nfunction render(): int => value * 2 }\nfunction main(): int { point := Point { value: 6 }\nshape: Drawable := point\nreturn shape.render() + shape.value }",
  }], "/interface-main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  binaryPath := "/tmp/doof-selfhost-interface"
  let nativeArgs: string[] = ["-std=c++17"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  nativeArgs.push("-o")
  nativeArgs.push(binaryPath)
  linked := try! run("clang++", nativeArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run(binaryPath)
  Assert.equal(executed.exitCode, 18)
}

export function testCompilesSelfhostParserSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do"], "parser.do", "selfhost-parser")
}

export function testCompilesSelfhostAnalyzerSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do"], "analyzer.do", "selfhost-analyzer")
}

export function testCompilesSelfhostCheckerSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do"], "checker.do", "selfhost-checker")
}

export function testCompilesSelfhostEmitterExprSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do"], "emitter-expr.do", "selfhost-emitter-expr")
}

export function testCompilesSelfhostEmitterStmtSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do"], "emitter-stmt.do", "selfhost-emitter-stmt")
}

export function testCompilesSelfhostEmitterDeclSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do"], "emitter-decl.do", "selfhost-emitter-decl")
}

export function testCompilesSelfhostEmitterHeaderSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "checker.do", "emitter-context.do", "emitter-names.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr.do", "emitter-stmt.do", "emitter-decl.do", "emitter-header.do"], "emitter-header.do", "selfhost-emitter-header")
}
