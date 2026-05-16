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
  parseCoverageOutput,
  stripCoverageLines,
  buildCoverageReport,
  deriveCoverageHtmlPath,
  deriveCoverageFileHtmlDir,
  deriveCoverageFileHtmlPath,
  renderCoverageHtml,
  renderCoverageFileHtml,
  escapeHtml,
  type TestReporter,
} from "./test-runner.js";
import { DOOF_STDLIB_ROOT_ENV } from "./std-packages.js";

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

    expect(source).toContain('import { testAlpha } from "./alpha.test"');
    expect(source).toContain('import { testBeta } from "./nested/beta.test"');
    expect(source).toContain('testId := args[1]');
    expect(source).toContain('testAlpha()');
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

describe("coverage helpers", () => {
  it("parses __COV__ lines from stdout", () => {
    const hits = new Map<number, Set<number>>();
    parseCoverageOutput("__COV__ 0 5\n__COV__ 0 7\n__COV__ 1 3\nPASS foo::test\n", hits);

    expect(hits.get(0)).toEqual(new Set([5, 7]));
    expect(hits.get(1)).toEqual(new Set([3]));
  });

  it("ignores non-COV lines", () => {
    const hits = new Map<number, Set<number>>();
    parseCoverageOutput("PASS foo::test\nsome output\n", hits);
    expect(hits.size).toBe(0);
  });

  it("accumulates hits across multiple calls", () => {
    const hits = new Map<number, Set<number>>();
    parseCoverageOutput("__COV__ 0 5\n", hits);
    parseCoverageOutput("__COV__ 0 7\n__COV__ 0 5\n", hits);

    expect(hits.get(0)).toEqual(new Set([5, 7]));
  });

  it("strips __COV__ lines from stdout before display", () => {
    const result = stripCoverageLines("__COV__ 0 5\nAssertion failed: oops\n__COV__ 1 3\n");
    expect(result).toBe("Assertion failed: oops");
    expect(result).not.toContain("__COV__");
  });

  it("builds a coverage report with hit and missed lines", () => {
    const modules = [
      { moduleId: 0, modulePath: "/project/src/calc.do", instrumentedLines: [3, 5, 7, 9] },
      { moduleId: 1, modulePath: "/project/src/math.do", instrumentedLines: [1, 2] },
    ];
    const hits = new Map<string, Set<number>>([
      ["/project/src/calc.do", new Set([3, 7])],
      ["/project/src/math.do", new Set([1, 2])],
    ]);
    const report = buildCoverageReport(modules, hits, "/project");

    expect(report.totals.covered).toBe(4);
    expect(report.totals.total).toBe(6);
    expect(report.totals.percent).toBe(66.7);

    const calcFile = report.files.find((f) => f.path.includes("calc"));
    expect(calcFile?.covered).toBe(2);
    expect(calcFile?.total).toBe(4);
    expect(calcFile?.hitLines).toEqual([3, 7]);
    expect(calcFile?.missedLines).toEqual([5, 9]);

    const mathFile = report.files.find((f) => f.path.includes("math"));
    expect(mathFile?.covered).toBe(2);
    expect(mathFile?.total).toBe(2);
    expect(mathFile?.percent).toBe(100);
  });

  it("skips modules with no instrumented lines", () => {
    const modules = [
      { moduleId: 0, modulePath: "/project/src/empty.do", instrumentedLines: [] },
      { moduleId: 1, modulePath: "/project/src/math.do", instrumentedLines: [1, 2] },
    ];
    const hits = new Map<string, Set<number>>([["/project/src/math.do", new Set([1])]]);
    const report = buildCoverageReport(modules, hits, "/project");

    expect(report.files).toHaveLength(1);
    expect(report.files[0].path).toContain("math");
  });

  it("reports 100% when a module with all lines hit", () => {
    const modules = [{ moduleId: 0, modulePath: "/project/src/all.do", instrumentedLines: [1, 2, 3] }];
    const hits = new Map<string, Set<number>>([["/project/src/all.do", new Set([1, 2, 3])]]);
    const report = buildCoverageReport(modules, hits, "/project");

    expect(report.totals.percent).toBe(100);
    expect(report.files[0].missedLines).toEqual([]);
  });

  it("reports 0% when no lines were hit", () => {
    const modules = [{ moduleId: 0, modulePath: "/project/src/none.do", instrumentedLines: [1, 2] }];
    const hits = new Map<string, Set<number>>();
    const report = buildCoverageReport(modules, hits, "/project");

    expect(report.totals.covered).toBe(0);
    expect(report.totals.percent).toBe(0);
    expect(report.files[0].missedLines).toEqual([1, 2]);
  });

  it("derives a sibling html path from the json output path", () => {
    expect(deriveCoverageHtmlPath("/tmp/doof-test-coverage.json")).toBe("/tmp/doof-test-coverage.html");
    expect(deriveCoverageHtmlPath("/tmp/custom-report")).toBe("/tmp/custom-report.html");
  });

  it("derives per-file html output paths under a sibling directory", () => {
    expect(deriveCoverageFileHtmlDir("/tmp/doof-test-coverage.html")).toBe("/tmp/doof-test-coverage_files");
    expect(deriveCoverageFileHtmlPath("/tmp/doof-test-coverage.html", "src/calc.do"))
      .toBe(path.join("/tmp/doof-test-coverage_files", "src", "calc.do.html"));
  });

  it("renders an html summary report with file links and escaped content", () => {
    const report = {
      timestamp: "2026-04-30T12:00:00.000Z",
      totals: { covered: 3, total: 4, percent: 75 },
      files: [
        {
          path: 'src/<calc>.do',
          covered: 3,
          total: 4,
          percent: 75,
          hitLines: [1, 3, 5],
          missedLines: [7],
        },
      ],
    };
    const fileLinks = new Map([["src/<calc>.do", "doof-test-coverage_files/src/calc.do.html"]]);

    const html = renderCoverageHtml(report, fileLinks);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Doof Coverage");
    expect(html).toContain("75.0%");
    expect(html).toContain("src/&lt;calc&gt;.do");
    expect(html).toContain("Open file report");
    expect(html).not.toContain("Hit Lines");
    expect(html).not.toContain("Missed Lines");
    expect(html).toContain("width: 75%;");
  });

  it("renders a per-file html report with source highlighting", () => {
    const file = {
      path: "src/calc.do",
      covered: 2,
      total: 3,
      percent: 66.7,
      hitLines: [1, 3],
      missedLines: [2],
    };

    const html = renderCoverageFileHtml(file, "const x = 1\nconst y = 2\nconst z = 3\n", "../doof-test-coverage.html");

    expect(html).toContain("Back to coverage summary");
    expect(html).toContain("class=\"source-line covered\"");
    expect(html).toContain("class=\"source-line missed\"");
    expect(html).toContain("class=\"source-line neutral\"");
    expect(html).toContain("Coverage 66.7%");
    expect(html).toContain("const y = 2");
  });

  it("escapes html metacharacters", () => {
    expect(escapeHtml('<tag attr="x">&\'')).toBe("&lt;tag attr=&quot;x&quot;&gt;&amp;&#39;");
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
    const originalStdlibRoot = process.env[DOOF_STDLIB_ROOT_ENV];
    const stdlibRoot = path.join(originalCwd, "stdlib");
    process.env[DOOF_STDLIB_ROOT_ENV] = stdlibRoot;
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
      if (originalStdlibRoot === undefined) {
        delete process.env[DOOF_STDLIB_ROOT_ENV];
      } else {
        process.env[DOOF_STDLIB_ROOT_ENV] = originalStdlibRoot;
      }
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