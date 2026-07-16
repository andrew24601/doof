import { Assert } from "std/assert"
import { AnalysisResult, ModuleInfo, createAnalyzer, createAnalyzerWithLoader } from "./analyzer"
import { Diagnostic, SemanticLocation, SemanticSpan, SourceFile } from "./semantic"
import { ClassDeclaration, FunctionDeclaration, NamedType } from "./ast"

function moduleAt(result: AnalysisResult, path: string): ModuleInfo {
  for module of result.modules { if module.path == path { return module } }
  panic("missing analyzed module: " + path)
}

function hasDiagnostic(result: AnalysisResult, message: string): bool {
  for diagnostic of result.diagnostics { if diagnostic.message == message { return true } }
  return false
}

export function testRewritesMockImportsFromGeneratedHarnessRoot(): void {
  result := createAnalyzer([
    SourceFile { path: "/build/__doof_tests__.do", source: "import { testScene } from \"../game/tests/scene.test\"\nfunction main(): void { testScene() }" },
    SourceFile { path: "/game/tests/scene.test.do", source: "mock import for \"../scene\" {\n  \"./event\" => \"./scene_event.mock\",\n  \"./model\" => \"./scene_model.mock\"\n}\nimport { Scene } from \"../scene\"\nexport function testScene(): void { ignored := Scene() }" },
    SourceFile { path: "/game/scene.do", source: "import { GameEvent } from \"./event\"\nimport { SimpleModel } from \"./model\"\nexport class Scene { event: GameEvent = GameEvent() model: SimpleModel = SimpleModel() }" },
    SourceFile { path: "/game/event.do", source: "export class GameEvent {}" },
    SourceFile { path: "/game/model.do", source: "export class SimpleModel {}" },
    SourceFile { path: "/game/tests/scene_event.mock.do", source: "export class GameEvent {}" },
    SourceFile { path: "/game/tests/scene_model.mock.do", source: "export class SimpleModel {}" },
  ]).analyze("/build/__doof_tests__.do")

  Assert.equal(result.diagnostics.length, 0)
  scene := moduleAt(result, "/game/scene.do")
  Assert.equal(scene.mockRootPath, "/game/tests/scene.test.do")
  Assert.equal(scene.imports[0].sourceModule, "/game/tests/scene_event.mock.do")
  Assert.equal(scene.imports[1].sourceModule, "/game/tests/scene_model.mock.do")
  Assert.equal(result.modules.length, 5)
}

export function testAppliesOnlyExactMockImportSourceMatches(): void {
  result := createAnalyzer([
    SourceFile { path: "/tests/main.test.do", source: "mock import for \"./feature/exact\" { \"./dep\" => \"./exact.mock\" }\nmock import for \"./feature/single\" { \"./dep\" => \"./single.mock\" }\nmock import for \"./feature/nested/deep\" { \"./dep\" => \"./deep.mock\" }\nimport { exact } from \"./feature/exact\"\nimport { single } from \"./feature/single\"\nimport { deep } from \"./feature/nested/deep\"\nimport { other } from \"./other\"" },
    SourceFile { path: "/tests/feature/exact.do", source: "import { value } from \"./dep\"\nexport function exact(): int => value" },
    SourceFile { path: "/tests/feature/single.do", source: "import { value } from \"./dep\"\nexport function single(): int => value" },
    SourceFile { path: "/tests/feature/nested/deep.do", source: "import { value } from \"./dep\"\nexport function deep(): int => value" },
    SourceFile { path: "/tests/other.do", source: "import { value } from \"./dep\"\nexport function other(): int => value" },
    SourceFile { path: "/tests/exact.mock.do", source: "export readonly value = 1" },
    SourceFile { path: "/tests/single.mock.do", source: "export readonly value = 2" },
    SourceFile { path: "/tests/deep.mock.do", source: "export readonly value = 3" },
    SourceFile { path: "/tests/dep.do", source: "export readonly value = 4" },
  ]).analyze("/tests/main.test.do")

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(moduleAt(result, "/tests/feature/exact.do").imports[0].sourceModule, "/tests/exact.mock.do")
  Assert.equal(moduleAt(result, "/tests/feature/single.do").imports[0].sourceModule, "/tests/single.mock.do")
  Assert.equal(moduleAt(result, "/tests/feature/nested/deep.do").imports[0].sourceModule, "/tests/deep.mock.do")
  Assert.equal(moduleAt(result, "/tests/other.do").imports[0].sourceModule, "/tests/dep.do")
}

export function testRewritesMockedSourceReExports(): void {
  result := createAnalyzer([
    SourceFile { path: "/main.test.do", source: "mock import for \"./facade\" { \"./dep\" => \"./dep.mock\" }\nimport { value } from \"./facade\"" },
    SourceFile { path: "/facade.do", source: "export { value } from \"./dep\"" },
    SourceFile { path: "/dep.do", source: "export readonly value = 1" },
    SourceFile { path: "/dep.mock.do", source: "export readonly value = 2" },
  ]).analyze("/main.test.do")

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(moduleAt(result, "/facade.do").reExports[0], "/dep.mock.do")
  Assert.equal(result.modules.length, 3)
}

export function testValidatesMockImportPlacementAndSelfSubstitution(): void {
  nonTest := createAnalyzer([SourceFile {
    path: "/main.do", source: "mock import for \"./service\" { \"./dep\" => \"./mock\" }",
  }]).analyze("/main.do")
  Assert.equal(hasDiagnostic(nonTest, "mock import directives are only valid in .test.do files"), true)

  misplaced := createAnalyzer([
    SourceFile { path: "/main.test.do", source: "import { value } from \"./dep\"\nmock import for \"./dep\" { \"./leaf\" => \"./mock\" }" },
    SourceFile { path: "/dep.do", source: "export readonly value = 1" },
  ]).analyze("/main.test.do")
  Assert.equal(hasDiagnostic(misplaced, "mock import directives must appear at the top of the file before other statements"), true)

  selfMapping := createAnalyzer([SourceFile {
    path: "/main.test.do", source: "mock import for \"./service\" { \"./dep\" => \"./dep\" }",
  }]).analyze("/main.test.do")
  Assert.equal(hasDiagnostic(selfMapping, "mock import cannot substitute \"./dep\" with itself"), true)
}

export function testRejectsNestedMockRootsAndTestImports(): void {
  nested := createAnalyzer([
    SourceFile { path: "/main.test.do", source: "mock import for \"./service\" {}\nimport { value } from \"./service\"" },
    SourceFile { path: "/service.do", source: "mock import for \"./leaf\" {}\nexport readonly value = 1" },
  ]).analyze("/main.test.do")
  Assert.equal(hasDiagnostic(nested, "mock import directives are only valid in the root test file"), true)

  testImport := createAnalyzer([
    SourceFile { path: "/main.test.do", source: "mock import for \"./service\" {}\nimport { helper } from \"./helper.test\"" },
    SourceFile { path: "/helper.test.do", source: "export function helper(): void {}" },
  ]).analyze("/main.test.do")
  Assert.equal(hasDiagnostic(testImport, "Test file \"/main.test.do\" cannot import another test file \"/helper.test.do\""), true)
}

export function testResetsMockEnvironmentBetweenAnalyses(): void {
  analyzer := createAnalyzer([
    SourceFile { path: "/first.test.do", source: "mock import for \"./service\" { \"./dep\" => \"./first.mock\" }\nimport { run } from \"./service\"" },
    SourceFile { path: "/second.test.do", source: "mock import for \"./service\" { \"./dep\" => \"./second.mock\" }\nimport { run } from \"./service\"" },
    SourceFile { path: "/service.do", source: "import { value } from \"./dep\"\nexport function run(): int => value" },
    SourceFile { path: "/first.mock.do", source: "export readonly value = 1" },
    SourceFile { path: "/second.mock.do", source: "export readonly value = 2" },
  ])
  first := analyzer.analyze("/first.test.do")
  Assert.equal(moduleAt(first, "/service.do").imports[0].sourceModule, "/first.mock.do")
  second := analyzer.analyze("/second.test.do")
  Assert.equal(moduleAt(second, "/service.do").imports[0].sourceModule, "/second.mock.do")
}

export function testResolvesImportsAndExports(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { add } from \"./math\"\nfunction main(): int => add(1, 2)" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(result.modules[0].imports.length, 1)
  Assert.equal(result.modules[0].imports[0].localName, "add")
  Assert.equal(result.modules[0].imports[0].symbol != null, true)
}

export function testSuppressesMissingExportsWhenDependencyFailsToParse(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { first, second } from \"./broken\"\nfunction main(): void { }" },
    SourceFile { path: "/broken.do", source: "export readonly value: readonly string = \"broken\"" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].module, "/broken.do")
  Assert.equal(result.diagnostics[0].message.contains("Unexpected readonly type modifier"), true)
}

export function testResolvesExplicitBareModuleSources(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { add } from \"vendor/math\"\nfunction main(): int => add(1, 2)" },
    SourceFile { path: "/vendor/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(result.modules[0].imports[0].sourceModule, "/vendor/math.do")
}

export function testDecoratesNamedTypes(): void {
  sources := [SourceFile {
    path: "/main.do",
    source: "class Point { x: int }\nfunction read(point: Point): int => point.x",
  }]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  case result.modules[0].program.statements[1] {
    fn: FunctionDeclaration -> {
      case fn.params[0].type_! {
        named: NamedType -> { Assert.equal(named.resolvedSymbol != null, true) }
        _ -> { panic("expected a named type") }
      }
    }
    _ -> { panic("expected a function") }
  }
}

export function testRecognizesBuiltinTupleType(): void {
  result := createAnalyzer([SourceFile {
    path: "/main.do",
    source: "function pair<T>(value: T): Tuple<T, T> => (value, value)",
  }]).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesReExportsToDefiningModule(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { sum } from \"./index\"\nfunction main(): int => sum(1, 2)" },
    SourceFile { path: "/index.do", source: "export { add as sum } from \"./math\"" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules[1].reExports.length, 1)
  Assert.equal(result.modules[0].imports[0].symbol != null, true)
  Assert.equal(result.modules[0].imports[0].symbol!.module, "/math.do")
}

export function testRecordsNativeClassMetadata(): void {
  result := createAnalyzer([SourceFile {
    path: "/main.do",
    source: "export import class Client from \"client.hpp\" as native::Client { get(): int }",
  }]).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  case result.modules[0].program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.native_, true)
      Assert.equal(result.modules[0].symbols[0].native_, true)
      Assert.equal(result.modules[0].symbols[0].nativeHeader, "client.hpp")
      Assert.equal(result.modules[0].symbols[0].nativeCppName, "native::Client")
    }
    _ -> { panic("expected native class declaration") }
  }
}

export function testPreservesNativeClassMetadataThroughLocalExportList(): void {
  result := createAnalyzer([
    SourceFile { path: "/main.do", source: "import { NativeImage } from \"./native\"\nfunction load(image: NativeImage): NativeImage => image" },
    SourceFile { path: "/native.do", source: "import class NativeImage from \"native_image.hpp\" as doof_image::NativeImage {}\nexport { NativeImage }" },
  ]).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 0)
  symbol := moduleAt(result, "/main.do").imports[0].symbol!
  Assert.equal(symbol.native_, true)
  Assert.equal(symbol.nativeHeader, "native_image.hpp")
  Assert.equal(symbol.nativeCppName, "doof_image::NativeImage")
}

export function testPreservesNativeClassMetadataThroughSourceReExport(): void {
  result := createAnalyzer([
    SourceFile { path: "/main.do", source: "import { ImageHandle } from \"./index\"\nfunction load(image: ImageHandle): ImageHandle => image" },
    SourceFile { path: "/index.do", source: "export { NativeImage as ImageHandle } from \"./native\"" },
    SourceFile { path: "/native.do", source: "export import class NativeImage from \"native_image.hpp\" as doof_image::NativeImage {}" },
  ]).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 0)
  symbol := moduleAt(result, "/main.do").imports[0].symbol!
  Assert.equal(symbol.name, "ImageHandle")
  Assert.equal(symbol.originalName, "NativeImage")
  Assert.equal(symbol.native_, true)
  Assert.equal(symbol.nativeHeader, "native_image.hpp")
  Assert.equal(symbol.nativeCppName, "doof_image::NativeImage")
}

export function testAnalyzesOnlyTransitiveSourcesWithLoader(): void {
  let requested: string[] = []
  loader := (path: string): Result<SourceFile | null, Diagnostic> => {
    requested.push(path)
    if path == "/math.do" {
      return Success(SourceFile { path, source: "export function add(left: int, right: int): int => left + right" })
    }
    if path == "/unused.do" {
      return Success(SourceFile { path, source: "this is not valid Doof" })
    }
    return Success(null)
  }
  result := createAnalyzerWithLoader([
    SourceFile { path: "/main.do", source: "import { add } from \"./math\"\nfunction main(): int => add(1, 2)" },
  ], loader).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(requested.length, 1)
  Assert.equal(requested[0], "/math.do")
}

export function testReportsLoaderFailureWithoutModuleNotFoundDiagnostic(): void {
  zero := SemanticLocation { line: 0, column: 0, offset: 0 }
  loader := (path: string): Result<SourceFile | null, Diagnostic> => Failure(Diagnostic {
    severity: "error",
    message: "Could not read source file: permission denied",
    span: SemanticSpan { start: zero, end: zero },
    module: path,
  })
  result := createAnalyzerWithLoader([], loader).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message, "Could not read source file: permission denied")
}
