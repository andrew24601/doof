import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findCompiler, findNlohmannInclude } from "./cli-core.js";
import {
  discoverTests,
  filterTests,
  findTestFiles,
  generateTestHarnessSource,
  runTestCommand,
  type TestReporter,
} from "./test-runner.js";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("test runner discovery", () => {
  it("finds .test.do files recursively", () => {
    const dir = createTempDir();
    writeFile(dir, "alpha.test.do", "export function testAlpha(): void {}\n");
    writeFile(dir, "helper.do", "export function helper(): void {}\n");
    writeFile(dir, "nested/beta.test.do", "export function testBeta(): void {}\n");

    const files = findTestFiles(dir);

    expect(files.map((file) => path.relative(dir, file).replace(/\\/g, "/"))).toEqual([
      "alpha.test.do",
      "nested/beta.test.do",
    ]);
  });

  it("discovers exported zero-argument void tests", () => {
    const dir = createTempDir();
    writeFile(dir, "doof.json", JSON.stringify({ name: "tests" }));
    writeFile(dir, "alpha.test.do", [
      "export function testAlpha(): void {}",
      "export function helper(): void {}",
      "function testPrivate(): void {}",
      "",
    ].join("\n"));
    writeFile(dir, "nested/beta.test.do", [
      "export function testBeta(): void {}",
      "export const testValue = 1",
      "",
    ].join("\n"));

    const tests = discoverTests(dir, findTestFiles(dir));

    expect(tests.map((test) => test.id)).toEqual([
      "alpha.test.do::testAlpha",
      "nested/beta.test.do::testBeta",
    ]);
  });

  it("rejects invalid exported test signatures", () => {
    const dir = createTempDir();
    writeFile(dir, "doof.json", JSON.stringify({ name: "tests" }));
    writeFile(dir, "broken.test.do", "export function testBroken(name: string): void {}\n");

    expect(() => discoverTests(dir, findTestFiles(dir))).toThrow("must not declare parameters");
  });
});

describe("test runner harness", () => {
  it("generates a harness that dispatches by test id", () => {
    const harnessPath = "/tmp/doof-tests/__doof_tests__.do";
    const source = generateTestHarnessSource(harnessPath, [
      {
        id: "alpha.test.do::testAlpha",
        name: "testAlpha",
        modulePath: "/tmp/doof-tests/alpha.test.do",
        moduleDisplayPath: "alpha.test.do",
      },
      {
        id: "nested/beta.test.do::testBeta",
        name: "testBeta",
        modulePath: "/tmp/doof-tests/nested/beta.test.do",
        moduleDisplayPath: "nested/beta.test.do",
      },
    ]);

    expect(source).toContain('import { testAlpha as __doof_test_0 } from "./alpha.test"');
    expect(source).toContain('import { testBeta as __doof_test_1 } from "./nested/beta.test"');
    expect(source).toContain('testId := args[1]');
    expect(source).toContain('println("PASS alpha.test.do::testAlpha")');
    expect(source).toContain('else if testId == "nested/beta.test.do::testBeta"');
  });

  it("filters discovered tests by substring", () => {
    const filtered = filterTests([
      { id: "alpha.test.do::testAlpha", name: "testAlpha", modulePath: "/alpha.test.do", moduleDisplayPath: "alpha.test.do" },
      { id: "beta.test.do::testBeta", name: "testBeta", modulePath: "/beta.test.do", moduleDisplayPath: "beta.test.do" },
    ], "beta");

    expect(filtered.map((test) => test.id)).toEqual(["beta.test.do::testBeta"]);
  });
});

describe("test runner execution", () => {
  it("lists tests without compiling", () => {
    const dir = createTempDir();
    writeFile(dir, "doof.json", JSON.stringify({ name: "tests" }));
    writeFile(dir, "calc.test.do", [
      "export function testAdd(): void {}",
      "export function testSub(): void {}",
      "",
    ].join("\n"));

    const reporter = createReporter();
    const result = runTestCommand({
      targetPath: dir,
      compiler: "clang++",
      nativeBuild: emptyNativeBuildOptions(),
      filter: "Sub",
      listOnly: true,
      verbose: false,
      reporter,
    });

    expect(result).toEqual({ discovered: 1, executed: 0, passed: 0, failed: 0 });
    expect(reporter.logs).toContain("calc.test.do::testSub");
  });

  it("compiles once and reports pass/fail counts", () => {
    const compiler = findCompiler();
    if (!findNlohmannInclude()) {
      return;
    }
    const dir = createTempDir();
    writeFile(dir, "doof.json", JSON.stringify({ name: "tests" }));
    writeFile(dir, "calc.test.do", [
      'import { Assert } from "std/assert"',
      "",
      "export function testPass(): void {",
      "    Assert.equal(1 + 1, 2)",
      "}",
      "",
      "export function testFail(): void {",
      '    Assert.equal(1 + 1, 3, "expected failure")',
      "}",
      "",
    ].join("\n"));

    const reporter = createReporter();
    const result = runTestCommand({
      targetPath: dir,
      compiler,
      nativeBuild: emptyNativeBuildOptions(),
      filter: null,
      listOnly: false,
      verbose: false,
      reporter,
    });

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(reporter.logs.some((line) => line.includes("PASS calc.test.do::testPass"))).toBe(true);
    expect(reporter.errors.some((line) => line.includes("FAIL calc.test.do::testFail"))).toBe(true);
    expect(reporter.errors.some((line) => line.includes("Assertion failed: expected failure: expected values to be equal"))).toBe(true);
  });
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-test-runner-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createReporter(): TestReporter & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log(message: string) {
      logs.push(message);
    },
    error(message: string) {
      errors.push(message);
    },
  };
}

function emptyNativeBuildOptions() {
  return {
    cppStd: "c++17",
    includePaths: [],
    libraryPaths: [],
    linkLibraries: [],
    frameworks: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
  };
}