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
  try! writeText("/tmp/index.hpp", "#pragma once\n#include \"std_time_temporal.hpp\"\n")
  try! writeText("/tmp/doof_time.cpp", try! readText("../doof-stdlib/time/doof_time.cpp"))
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

function productionStdHttpSources(): SourceFile[] {
  paths := [
    "http/index.do", "http/types.do", "http/websocket.do",
    "event/index.do", "blob/index.do", "blob/types.do", "stream/index.do",
    "json/index.do", "time/index.do", "time/duration.do", "time/temporal.do", "time/stopwatch.do",
  ]
  let sources: SourceFile[] = [SourceFile {
    path: "/main.do",
    source: try! readText("samples/http-client/main.do"),
  }]
  for path of paths {
    sources.push(SourceFile { path: "/std/" + path, source: try! readText("../doof-stdlib/" + path) })
  }
  return sources
}

export function testCompilesProductionStdHttpGraph(): void {
  result := compile(productionStdHttpSources(), "/main.do")
  for diagnostic of result.diagnostics {
    println(diagnostic.module + ":" + string(diagnostic.span.start.line) + ": " + diagnostic.message)
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
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
  Assert.equal(driver.contains("readTextResource(\"doof_runtime.h\")"), true)
  Assert.equal(driver.contains("runtimeHeaderSourcePath()"), false)
  Assert.equal(runtime.contains("runtime_header_source_path()"), false)
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

export function testMonomorphizesDoofFunctionsAndClasses(): void {
  result := compile([SourceFile {
    path: "/main.do",
    source: "type Value<T> = T\nfunction identity<T>(value: T): T => value\nfunction outer<T>(value: T): T => identity(value)\nclass Box<T> { value: T get(): T => value map<U>(other: U): U => other }\nfunction main(): int { value: Value<int> := outer(3)\nbox := Box<int> { value }\nreturn box.get() + box.map<int>(4) }",
  }], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  module := result.emission!.modules[0]
  Assert.equal(module.header.contains("template <typename T>\nstruct Box"), false)
  Assert.equal(module.header.contains("template <typename T>\nT identity"), false)
  Assert.equal(module.header.contains("struct Box__int"), true)
  Assert.equal(module.header.contains("int32_t identity__int(int32_t value)"), true)
  Assert.equal(module.header.contains("int32_t outer__int(int32_t value)"), true)
  Assert.equal(module.header.contains("int32_t map__int(int32_t other)"), true)
  Assert.equal(module.header.contains("template <typename U>"), false)
  Assert.equal(module.header.contains("using Value"), false)
  Assert.equal(module.source.contains("int32_t identity__int(int32_t value)"), true)
  Assert.equal(module.source.contains("outer__int(3)"), true)
  Assert.equal(module.source.contains("identity__int(value)"), true)
  Assert.equal(module.source.contains("Box__int"), true)
  Assert.equal(module.source.contains("map__int(4)"), true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePaths[0]])
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 12)) }
  Assert.equal(native.exitCode, 0)
}

export function testDiagnosesExpandingGenericInstantiations(): void {
  result := compile([SourceFile {
    path: "/main.do",
    source: "function grow<T>(value: T): int => grow<T[]>([value])\nfunction main(): int => grow<int>(1)",
  }], "/main.do")
  Assert.equal(result.emission == null, true)
  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message.contains("Generic instantiation did not converge"), true)
  Assert.equal(result.diagnostics[0].message.contains("grow__array"), true)
  Assert.equal(result.diagnostics[0].message.contains("->"), true)
}

export function testMonomorphizesNativeFunctionAdapters(): void {
  result := compile([
    SourceFile { path: "/math.do", source: "export import function sin<T: float | double>(x: T): T from \"<cmath>\" as std::sin\nexport import function abs<T: float | double>(x: T): T from \"<cmath>\" as std::abs\nexport import function pow<T: float | double>(x: T, y: int = 2): T from \"<cmath>\" as std::pow" },
    SourceFile { path: "/facade.do", source: "export { sin, abs, pow } from \"./math\"" },
    SourceFile { path: "/main.do", source: "import { sin, abs, pow } from \"./facade\"\nfunction main(): int { a := sin<float>{ x: 1.0f }\nb := sin(1.0)\nc := abs(-2.0f)\nd := pow<float>{ x: 2.0f }\nreturn int(a + c + d + float(b)) }" },
  ], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  let mathHeader = ""
  let mathSource = ""
  let mainSource = ""
  for module of result.emission!.modules {
    if module.modulePath == "/math.do" { mathHeader = module.header; mathSource = module.source }
    if module.modulePath == "/main.do" { mainSource = module.source }
  }
  Assert.equal(mathHeader.contains("float sin__float(float x)"), true)
  Assert.equal(mathHeader.contains("double sin__double(double x)"), true)
  Assert.equal(mathSource.contains("return ::std::sin(x);"), true)
  Assert.equal(mathSource.contains("std::sin<float>"), false)
  Assert.equal(mathSource.contains("return ::std::abs(x);"), true)
  Assert.equal(mathSource.contains("std::abs<float>"), false)
  Assert.equal(mathSource.contains("return ::std::pow(x, y);"), true)
  Assert.equal(mainSource.contains("::app_math_::sin__float(1.0f)"), true)
  Assert.equal(mainSource.contains("::app_math_::sin__double(1.0)"), true)
  Assert.equal(mainSource.contains("::app_math_::abs__float"), true)
  Assert.equal(mainSource.contains("-2.0f"), true)
  Assert.equal(mainSource.contains("::app_math_::pow__float(2.0f, 2)"), true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 12)) }
  Assert.equal(native.exitCode, 0)
}

export function testMonomorphizesClosedWorldStreams(): void {
  result := compile([SourceFile {
    path: "/main.do",
    source: "class Counter implements Stream<int> { current: int end: int value_: int = 0 next(): bool { if current < end { value_ = current\ncurrent = current + 1\nreturn true }\nreturn false } value(): int => value_ }\nclass Chain<T> implements Stream<T> { source: Stream<T> next(): bool => source.next() value(): T => source.value() }\nclass MappedStream<T, U> implements Stream<U> { source: Stream<T> mapped: U next(): bool => source.next() value(): U => mapped }\nfunction main(): int { base: Stream<int> := Counter { current: 1, end: 4 }\nstream: Stream<int> := Chain<int> { source: base }\nwords: Stream<string> := MappedStream<int, string> { source: stream, mapped: \"value\" }\nlet total = 0\nfor value of stream { total = total + value }\nreturn total + int(words.value().length) }",
  }], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  module := result.emission!.modules[0]
  Assert.equal(module.header.contains("using Stream__int = std::variant<"), true)
  Assert.equal(module.header.contains("std::shared_ptr<Counter>"), true)
  Assert.equal(module.header.contains("std::shared_ptr<Chain__int>"), true)
  Assert.equal(module.header.contains("using Stream__string = std::variant<std::shared_ptr<MappedStream__int__string>>"), true)
  Assert.equal(module.header.contains("struct MappedStream__int__string"), true)
  Assert.equal(module.header.contains("StreamBase"), false)
  Assert.equal(module.source.contains("std::visit([](auto&& _obj) { return _obj->next(); }"), true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePaths[0]])
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 16)) }
  Assert.equal(native.exitCode, 0)
}

export function testMonomorphizesGenericStructuralInterfaces(): void {
  result := compile([SourceFile {
    path: "/main.do",
    source: "interface Reader<T> { read(): T }\nclass IntReader { value: int read(): int => value }\nfunction read(reader: Reader<int>): int => reader.read()\nfunction main(): int { reader: Reader<int> := IntReader { value: 7 }\nreturn read(reader) }",
  }], "/main.do")
  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  module := result.emission!.modules[0]
  Assert.equal(module.header.contains("using Reader__int = std::variant<std::shared_ptr<IntReader>>"), true)
  Assert.equal(module.header.contains("struct Reader"), false)
  Assert.equal(module.source.contains("std::visit([&](auto&& _obj) { return _obj->read(); }, reader)"), true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  native := try! run("clang++", ["-std=c++17", "-fsyntax-only", sourcePaths[0]])
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 16)) }
  Assert.equal(native.exitCode, 0)
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
  let linkArgs: string[] = ["-std=c++17", "-o", "/tmp/doof-production-fs-gate"]
  for sourcePath of sourcePaths { linkArgs.push(sourcePath) }
  linkArgs.push("/tmp/doof_time.cpp")
  linkArgs.push("-framework")
  linkArgs.push("CoreFoundation")
  linked := try! run("clang++", linkArgs)
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

export function testFlattensLambdaBodyUnionVariants(): void {
  result := compileSelfhostSlice(["semantic.do", "ast.do", "samples/lambda-body-union.do"], "samples/lambda-body-union.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  for module of result.emission!.modules {
    Assert.equal(module.header.contains("std::variant<std::variant"), false)
    Assert.equal(module.source.contains("std::variant<std::variant"), false)
  }
}

export function testEmitsActorAffineLambdaCaptures(): void {
  result := compile([SourceFile {
    path: "/lambda-captures.do",
    source: "function makeCounter(offset: int): (): int {\nlet count = offset\nreturn (): int => { count = count + 1\nreturn count }\n}",
  }], "/lambda-captures.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  source := result.emission!.modules[0].source
  Assert.equal(source.contains("auto count = std::make_shared<int32_t>(offset);"), true)
  Assert.equal(source.contains("doof::callback<int32_t()>([count]() -> int32_t"), true)
  Assert.equal(source.contains("(*count) = ((*count) + 1)"), true)
  Assert.equal(source.contains("return (*count);"), true)
  Assert.equal(source.contains("std::function"), false)
}

export function testRunsSelfhostActorProgram(): void {
  result := compile([SourceFile {
    path: "/actor-main.do",
    source: "class Accumulator { value: int\nfunction add(amount: int): int { this.value = this.value + amount\nreturn this.value } }\nfunction main(): int { worker := Actor<Accumulator>(1)\nfirst := worker.add(2)\npromise := async worker.add(4)\nstate := retire worker\nsecond := try! promise.get()\nreturn state.value + second }",
  }], "/actor-main.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  let nativeArgs: string[] = ["-std=c++17"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  nativeArgs.push("-o")
  nativeArgs.push("/tmp/doof-selfhost-actor-program")
  linked := try! run("clang++", nativeArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 12)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run("/tmp/doof-selfhost-actor-program")
  Assert.equal(executed.exitCode, 14)
}

export function testEmitsImmutableLambdaCaptureByValue(): void {
  result := compile([SourceFile {
    path: "/immutable-lambda-capture.do",
    source: "function makeValue(base: int): (): int {\nreturn (): int => base\n}",
  }], "/immutable-lambda-capture.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  source := result.emission!.modules[0].source
  Assert.equal(source.contains("doof::callback<int32_t()>([base]() -> int32_t"), true)
  Assert.equal(source.contains("std::make_shared<int32_t>(base)"), false)
}

export function testDoesNotBoxUncapturedMutableLambdaLocal(): void {
  result := compile([SourceFile {
    path: "/lambda-local.do",
    source: "function main(): int {\ncallback := (): int => {\nlet value = 1\nvalue = value + 1\nreturn value\n}\nreturn callback()\n}",
  }], "/lambda-local.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  source := result.emission!.modules[0].source
  Assert.equal(source.contains("auto value = 1;"), true)
  Assert.equal(source.contains("std::make_shared<int32_t>(1)"), false)
  Assert.equal(source.contains("doof::callback<int32_t()>([]() -> int32_t"), true)
}

export function testCompilesAndRunsEscapingMutableLambda(): void {
  result := compile([SourceFile {
    path: "/escaping-lambda.do",
    source: "function makeCounter(): (): int {\nlet count = 0\nreturn (): int => { count = count + 1\nreturn count }\n}\nfunction main(): int {\ncounter := makeCounter()\ncounter()\ncounter()\nreturn counter()\n}",
  }], "/escaping-lambda.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  binaryPath := "/tmp/doof-selfhost-escaping-lambda"
  let nativeArgs: string[] = ["-std=c++17"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  nativeArgs.push("-o")
  nativeArgs.push(binaryPath)
  linked := try! run("clang++", nativeArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run(binaryPath)
  Assert.equal(executed.exitCode, 3)
}

export function testCompilesAndRunsStrictJsonDeserialization(): void {
  result := compile([SourceFile {
    path: "/json-deserialization.do",
    source: "class Config { name: string\nenabled: bool\ncount: int = 10\nnotes: string | null = null }\nfunction main(): int { config := Config.fromJsonValue({ name: \"Ada\", enabled: true }) else { return 90 }\nignored := Config.fromJsonValue({ name: 4, enabled: true }) else error { if error.contains(\"Field \\\"name\\\" expected string\") { return config.count }\nreturn 91 }\nreturn 92 }",
  }], "/json-deserialization.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  sourcePaths := writeFocusedArtifacts(result)
  writeSelfhostRuntime()
  binaryPath := "/tmp/doof-selfhost-json-deserialization"
  let nativeArgs: string[] = ["-std=c++17"]
  for sourcePath of sourcePaths { nativeArgs.push(sourcePath) }
  nativeArgs.push("-o")
  nativeArgs.push(binaryPath)
  linked := try! run("clang++", nativeArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run(binaryPath)
  Assert.equal(executed.exitCode, 10)
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
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "json-semantics.do", "checker-actor-boundary.do", "checker-actor-lifecycle.do", "checker.do"], "checker.do", "selfhost-checker")
}

export function testCompilesSelfhostEmitterExprSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "json-semantics.do", "checker-actor-boundary.do", "checker-actor-lifecycle.do", "checker.do", "emitter-context.do", "emitter-names.do", "emitter-monomorphize.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr-actor.do", "emitter-expr-lambda.do", "emitter-expr.do", "emitter-stmt.do"], "emitter-expr.do", "selfhost-emitter-expr")
}

export function testCompilesSelfhostEmitterStmtSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "json-semantics.do", "checker-actor-boundary.do", "checker-actor-lifecycle.do", "checker.do", "emitter-context.do", "emitter-names.do", "emitter-monomorphize.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr-actor.do", "emitter-expr-lambda.do", "emitter-expr.do", "emitter-stmt.do"], "emitter-stmt.do", "selfhost-emitter-stmt")
}

export function testCompilesSelfhostEmitterDeclSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "json-semantics.do", "checker-actor-boundary.do", "checker-actor-lifecycle.do", "checker.do", "emitter-context.do", "emitter-names.do", "emitter-monomorphize.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr-actor.do", "emitter-expr-lambda.do", "emitter-expr.do", "emitter-stmt.do", "emitter-json.do", "emitter-decl.do"], "emitter-decl.do", "selfhost-emitter-decl")
}

export function testCompilesSelfhostEmitterHeaderSlice(): void {
  assertNativeSelfhostSlice(["semantic.do", "ast.do", "lexer.do", "parser.do", "parser-declarations.do", "parser-statements.do", "parser-types.do", "parser-expressions.do", "resolver.do", "analyzer.do", "checker-types.do", "json-semantics.do", "checker-actor-boundary.do", "checker-actor-lifecycle.do", "checker.do", "emitter-context.do", "emitter-names.do", "emitter-monomorphize.do", "emitter-types.do", "emitter-expr-utils.do", "emitter-expr-literals.do", "emitter-expr-ops.do", "emitter-expr-calls.do", "emitter-expr-control.do", "emitter-expr-actor.do", "emitter-expr-lambda.do", "emitter-expr.do", "emitter-stmt.do", "emitter-json.do", "emitter-decl.do", "emitter-header.do"], "emitter-header.do", "selfhost-emitter-header")
}
