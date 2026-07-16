import { Assert } from "std/assert"
import { readText } from "std/fs"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { Compilation, compile, compileWithLoader } from "./compiler"
import { emitModuleGraph } from "./emitter-module"
import { Diagnostic, SourceFile } from "./semantic"

function compileSample(path: string): Compilation {
  return compile([
    SourceFile { path: "/sample.do", source: try! readText(path) },
  ], "/sample.do")
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

export function testEmitsCoverageMetadataAndStatementMarks(): void {
  result := compile([
    SourceFile { path: "/main.test.do", source: "import { add } from \"./math\"\nfunction main(): int { value := add(2, 3)\nreturn value }" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int { result := a + b\nreturn result }" },
  ], "/main.test.do", true)

  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  Assert.equal(result.emission!.coverageModules.length, 1)
  Assert.equal(result.emission!.coverageModules[0].modulePath, "/math.do")
  Assert.equal(result.emission!.coverageModules[0].instrumentedLines.length, 2)
  Assert.equal(result.emission!.coverageModules[0].instrumentedLines[0], 1)
  Assert.equal(result.emission!.coverageModules[0].instrumentedLines[1], 2)
  let mathSource = ""
  let testSource = ""
  for module of result.emission!.modules {
    if module.modulePath == "/math.do" { mathSource = module.source }
    if module.modulePath == "/main.test.do" { testSource = module.source }
  }
  Assert.equal(mathSource.contains("doof::coverage::cov_mark(0, 1);"), true)
  Assert.equal(mathSource.contains("doof::coverage::cov_mark(0, 2);"), true)
  Assert.equal(testSource.contains("doof::coverage::cov_mark"), false)
}

export function testCompilesMockImportReplacementInsteadOfOriginalDependency(): void {
  result := compile([
    SourceFile { path: "/main.test.do", source: "mock import for \"./service\" { \"./dep\" => \"./dep.mock\" }\nimport { run } from \"./service\"\nfunction main(): int => run()" },
    SourceFile { path: "/service.do", source: "import { value } from \"./dep\"\nexport function run(): int => value()" },
    SourceFile { path: "/dep.do", source: "export function value(): MissingOriginalType => missingOriginalValue" },
    SourceFile { path: "/dep.mock.do", source: "export function value(): int => 7" },
  ], "/main.test.do")

  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  let sawMock = false
  let sawOriginal = false
  for module of result.emission!.modules {
    if module.modulePath == "/dep.mock.do" { sawMock = true }
    if module.modulePath == "/dep.do" { sawOriginal = true }
  }
  Assert.equal(sawMock, true)
  Assert.equal(sawOriginal, false)
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
}

export function testCompilesWithTransitiveSourceLoading(): void {
  let requested: string[] = []
  loader := (path: string): Result<SourceFile | null, Diagnostic> => {
    requested.push(path)
    if path == "/lib/index.do" {
      return Success(SourceFile { path, source: "export function add(left: int, right: int): int => left + right" })
    }
    if path == "/unused.do" {
      return Success(SourceFile { path, source: "this is not valid Doof" })
    }
    return Success(null)
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

export function testEmitsFocusedNullableVariantSample(): void {
  result := compileSample("selfhost/samples/nullable-variant.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
}

export function testEmitsFocusedNullableAstConstructionSample(): void {
  result := compileSample("selfhost/samples/nullable-ast-construction.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
}

export function testEmitsFocusedNullableAliasAssignmentSample(): void {
  result := compileSample("selfhost/samples/nullable-alias-assignment.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
}

export function testEmitsFocusedRecursiveAstUnionSample(): void {
  result := compileSample("selfhost/samples/recursive-ast-union.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
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

export function testEmitsComputedForOfLifetimeOwner(): void {
  result := compile([SourceFile {
    path: "/computed-iterable.do",
    source: "function values(): int[] => [1, 2, 3]\nfunction main(): int { let total = 0\nfor value of values() { total = total + value }\nreturn total }",
  }], "/computed-iterable.do")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  Assert.equal(result.emission!.modules[0].source.contains("const auto& _iterable_"), true)
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
