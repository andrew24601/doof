import { Assert } from "std/assert"
import { Parser } from "./parser"
import { compile } from "./compiler"
import { SourceFile } from "./semantic"
import {
  CoverageModuleMetadata, buildCoverageReport, discoverModuleTests, filterDiscoveredTests,
  coverageFileRelativePath, formatParseFailure, generateTestHarness, mergeCoverageOutput,
  renderCoverageFileHtml, renderCoverageHtml, renderCoverageJson, stripCoverageLines, testDisplayPath,
} from "./test-runner"

export function testDiscoversAndValidatesExportedTestFunctions(): void {
  program := Parser { source:
    "export function testPasses(): void {}\n" +
    "function helper(): void {}\n" +
    "export function testWithParameter(value: int): void {}\n" +
    "export function testGeneric<T>(): void {}\n" +
    "export function testReturnsInt(): int => 1\n"
  }.parse()
  discovery := discoverModuleTests(program, "/work/math.test.do", "/work")

  Assert.equal(discovery.tests.length, 1)
  Assert.equal(discovery.tests[0].id, "math.test.do::testPasses")
  Assert.equal(discovery.errors.length, 3)
  Assert.equal(discovery.errors[0].contains("must not declare parameters"), true)
  Assert.equal(discovery.errors[1].contains("must not declare type parameters"), true)
  Assert.equal(discovery.errors[2].contains("must return void"), true)
}

export function testDiscoversBlockBodiedTestWithImplicitVoidReturn(): void {
  program := Parser { source: "export function testAll() {}\n" }.parse()
  discovery := discoverModuleTests(program, "/work/blob.test.do", "/work")

  Assert.equal(discovery.errors.length, 0)
  Assert.equal(discovery.tests.length, 1)
  Assert.equal(discovery.tests[0].name, "testAll")
}

export function testRejectsExpressionBodiedTestWithInferredValueReturn(): void {
  program := Parser { source: "export function testValue() => 1\n" }.parse()
  discovery := discoverModuleTests(program, "/work/value.test.do", "/work")

  Assert.equal(discovery.tests.length, 0)
  Assert.equal(discovery.errors.length, 1)
  Assert.equal(discovery.errors[0].contains("must return void"), true)
}

export function testDiscoversLocallyAliasedExportLists(): void {
  program := Parser { source:
    "function original(): void {}\n" +
    "export { original as testAliased }\n"
  }.parse()
  discovery := discoverModuleTests(program, "/work/alias.test.do", "/work")

  Assert.equal(discovery.errors.length, 0)
  Assert.equal(discovery.tests.length, 1)
  Assert.equal(discovery.tests[0].name, "testAliased")
}

export function testFiltersTestIdsCaseInsensitively(): void {
  program := Parser { source:
    "export function testAdds(): void {}\n" +
    "export function testSubtracts(): void {}\n"
  }.parse()
  tests := discoverModuleTests(program, "/work/MATH.test.do", "/work").tests

  selected := filterDiscoveredTests(tests, "math.TEST.do::testa")
  Assert.equal(selected.length, 1)
  Assert.equal(selected[0].name, "testAdds")
}

export function testGeneratesPerIdHarnessWithRelativeImport(): void {
  program := Parser { source: "export function testAdds(): void {}\n" }.parse()
  tests := discoverModuleTests(program, "/work/src/math.test.do", "/work").tests
  harness := generateTestHarness("/work/build/.doof-tests/math/__doof_tests__.do", tests)

  Assert.equal(harness.contains("import { testAdds } from \"../../../src/math.test\""), true)
  Assert.equal(harness.contains("if testId == \"src/math.test.do::testAdds\""), true)
  Assert.equal(harness.contains("testAdds()"), true)
  Assert.equal(harness.contains("PASS src/math.test.do::testAdds"), false)
}

export function testGeneratedHarnessPreservesTestMockImportRoot(): void {
  program := Parser { source: "mock import for \"../scene\" { \"./event\" => \"./scene_event.mock\" }\nexport function testScene(): void { ignored := Scene() }\nimport { Scene } from \"../scene\"\n" }.parse()
  tests := discoverModuleTests(program, "/game/tests/scene.test.do", "/game")
  harnessPath := "/game/build/.doof-tests/scene/__doof_tests__.do"
  harness := generateTestHarness(harnessPath, tests.tests)
  result := compile([
    SourceFile { path: harnessPath, source: harness },
    SourceFile { path: "/game/tests/scene.test.do", source: "mock import for \"../scene\" { \"./event\" => \"./scene_event.mock\" }\nimport { Scene } from \"../scene\"\nexport function testScene(): void { ignored := Scene() }" },
    SourceFile { path: "/game/scene.do", source: "import { GameEvent } from \"./event\"\nexport class Scene { event: GameEvent = GameEvent() }" },
    SourceFile { path: "/game/event.do", source: "export class GameEvent { missing: UnknownProductionType }" },
    SourceFile { path: "/game/tests/scene_event.mock.do", source: "export class GameEvent {}" },
  ], harnessPath)

  for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
}

export function testBuildsPortableDisplayPaths(): void {
  Assert.equal(testDisplayPath("/work/", "/work/src/math.test.do"), "src/math.test.do")
  Assert.equal(testDisplayPath("C:\\work", "C:\\work\\math.test.do"), "math.test.do")
}

export function testFormatsParseFailuresWithSourceAndCaret(): void {
  rendered := formatParseFailure(
    "/work/math.test.do",
    "first := 1\nloader := (path: string): int => path",
    2,
    19,
    "Expected ')' before ':'",
  )
  Assert.equal(rendered.contains("/work/math.test.do:2:19: error: Expected ')' before ':'"), true)
  Assert.equal(rendered.contains("loader := (path: string): int => path"), true)
  Assert.equal(rendered.endsWith("                  ^"), true)
}

export function testBuildsCoverageReportFromRuntimeOutput(): void {
  modules := [CoverageModuleMetadata {
    moduleId: 3,
    modulePath: "/work/src/math.do",
    instrumentedLines: [1, 2, 4],
  }]
  let hitsByModule: int[][] = [[]]
  mergeCoverageOutput("hello\n__COV__ 3 4\n__COV__ 3 1\n__COV__ 3 4\n", modules, hitsByModule)
  report := buildCoverageReport(modules, hitsByModule, "/work")

  Assert.equal(report.files.length, 1)
  Assert.equal(report.files[0].path, "src/math.do")
  Assert.equal(report.files[0].covered, 2)
  Assert.equal(report.files[0].total, 3)
  Assert.equal(report.files[0].hitLines.length, 2)
  Assert.equal(report.files[0].missedLines.length, 1)
  Assert.equal(report.files[0].missedLines[0], 2)
  Assert.equal(report.totalCovered, 2)
  Assert.equal(report.totalLines, 3)
  json := renderCoverageJson(report)
  Assert.equal(json.contains("\"path\": \"src/math.do\""), true)
  Assert.equal(json.contains("\"hitLines\": [1, 4]"), true)
  html := renderCoverageHtml(report, "coverage_files")
  Assert.equal(html.contains("coverage_files/src/math.do.html"), true)
  fileHtml := renderCoverageFileHtml(report.files[0], "first\nsecond\nthird\nfourth", "../../coverage.html")
  Assert.equal(fileHtml.contains("line covered"), true)
  Assert.equal(fileHtml.contains("line missed"), true)
  Assert.equal(coverageFileRelativePath("../shared/math.do"), "_external/shared/math.do.html")
  Assert.equal(stripCoverageLines("before\n__COV__ 3 1\nafter\n"), "before\nafter")
}
