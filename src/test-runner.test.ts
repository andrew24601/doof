import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCompilerToolchain } from "./cli-core.js";
import {
  discoverTests,
  filterTests,
  findTestFiles,
  generateTestHarnessSource,
  groupTestsByModule,
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

  it("groups selected tests by source module", () => {
    const groups = groupTestsByModule([
      { id: "alpha.test.do::testOne", name: "testOne", modulePath: "/alpha.test.do", moduleDisplayPath: "alpha.test.do" },
      { id: "nested/beta.test.do::testBeta", name: "testBeta", modulePath: "/nested/beta.test.do", moduleDisplayPath: "nested/beta.test.do" },
      { id: "alpha.test.do::testTwo", name: "testTwo", modulePath: "/alpha.test.do", moduleDisplayPath: "alpha.test.do" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].moduleDisplayPath).toBe("alpha.test.do");
    expect(groups[0].tests.map((test) => test.name)).toEqual(["testOne", "testTwo"]);
    expect(groups[1].moduleDisplayPath).toBe("nested/beta.test.do");
    expect(groups[1].tests.map((test) => test.name)).toEqual(["testBeta"]);
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
      compiler: { kind: "gcc-like", command: "clang++" },
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
    let compiler;
    try {
      compiler = resolveCompilerToolchain(null);
    } catch {
      return;
    }
    const dir = createTempDir();
    // Provide a local std/assert dependency so the test doesn't rely on a bundled stdlib
    writeFile(dir, "doof.json", JSON.stringify({
      name: "tests",
      dependencies: { "std/assert": { path: "./deps/std-assert" } },
    }));

    writeFile(dir, "deps/std-assert/doof.json", JSON.stringify({
      name: "std/assert",
      dependencies: {},
    }));

    writeFile(dir, "deps/std-assert/index.do", [
      "export class Assert {",
      "    static equal<T>(actual: T, expected: T, message: string | null = null): void {",
      "        if actual == expected {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected values to be equal\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected values to be equal\")",
      "        }",
      "    }",
      "",
      "    static notEqual<T>(actual: T, expected: T, message: string | null = null): void {",
      "        if !(actual == expected) {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected values to differ\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected values to differ\")",
      "        }",
      "    }",
      "",
      "    static isTrue(value: bool, message: string | null = null): void {",
      "        if value {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected value to be true\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected value to be true\")",
      "        }",
      "    }",
      "",
      "    static isFalse(value: bool, message: string | null = null): void {",
      "        if !value {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected value to be false\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected value to be false\")",
      "        }",
      "    }",
      "",
      "    static fail(message: string | null = null): void {",
      "        if message == null {",
      "            assert(false, \"test failed\")",
      "        } else {",
      "            assert(false, message ?? \"test failed\")",
      "        }",
      "    }",
      "}",
    ].join("\n"));

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

  it("runs tests from the owning package root", () => {
    let compiler;
    try {
      compiler = resolveCompilerToolchain(null);
    } catch {
      return;
    }

    const workspaceDir = createTempDir();
    const packageDir = path.join(workspaceDir, "pkg");
    const invocationDir = path.join(workspaceDir, "pkg", "tests");
    const outsideDir = path.join(workspaceDir, "somewhere-else");
    fs.mkdirSync(path.join(packageDir, "build", "tests"), { recursive: true });
    fs.mkdirSync(path.join(outsideDir, "build", "tests"), { recursive: true });

    writeFile(packageDir, "doof.json", JSON.stringify({ name: "pkg-tests" }));
    writeFile(packageDir, "tests/runtime.test.do", [
      'import { writeText } from "std/fs"',
      "",
      "export function testWritesRelativeArtifact(): void {",
      '    try! writeText("build/tests/runtime-cwd.txt", "ok")',
      "}",
      "",
    ].join("\n"));

    const reporter = createReporter();
    const originalCwd = process.cwd();
    process.chdir(outsideDir);

    try {
      const result = runTestCommand({
        targetPath: path.join(invocationDir, "runtime.test.do"),
        compiler,
        nativeBuild: emptyNativeBuildOptions(),
        filter: null,
        listOnly: false,
        verbose: false,
        reporter,
      });

      expect(result).toMatchObject({ passed: 1, failed: 0 });
    } finally {
      process.chdir(originalCwd);
    }

    expect(fs.readFileSync(path.join(packageDir, "build", "tests", "runtime-cwd.txt"), "utf8")).toBe("ok");
    expect(fs.existsSync(path.join(outsideDir, "build", "tests", "runtime-cwd.txt"))).toBe(false);
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
    pkgConfigPackages: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
  };
}