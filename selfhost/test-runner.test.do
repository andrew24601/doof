import { Assert } from "std/assert"
import { Parser } from "./parser"
import {
  discoverModuleTests, filterDiscoveredTests, formatParseFailure, generateTestHarness, testDisplayPath,
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
