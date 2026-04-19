import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ModuleAnalyzer } from "./analyzer.js";
import type { FunctionDeclaration } from "./ast.js";
import {
  compileCpp,
  type CompilerToolchain,
  formatDiagnostic,
  RealFS,
  runPipelineWithFs,
  writeProject,
} from "./cli-core.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { findDoofManifestPath } from "./package-manifest.js";
import { loadPackageGraph } from "./package-manifest.js";
import { collectSemanticDiagnostics } from "./pipeline-diagnostics.js";
import type { FileSystem } from "./resolver.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import type { Diagnostic, FunctionSymbol, ModuleSymbolTable } from "./types.js";

const TEST_FILE_SUFFIX = ".test.do";
const TEST_PREFIX = "test";
const HARNESS_FILENAME = "__doof_tests__.do";

export interface DiscoveredTest {
  id: string;
  name: string;
  modulePath: string;
  moduleDisplayPath: string;
}

export interface TestModuleGroup {
  modulePath: string;
  moduleDisplayPath: string;
  tests: DiscoveredTest[];
}

export interface TestReporter {
  log(message: string): void;
  error(message: string): void;
}

export interface RunTestCommandOptions {
  targetPath: string;
  compiler: CompilerToolchain;
  nativeBuild: NativeBuildOptions;
  filter: string | null;
  listOnly: boolean;
  verbose: boolean;
  reporter: TestReporter;
}

export interface RunTestCommandResult {
  discovered: number;
  executed: number;
  passed: number;
  failed: number;
}

class OverlayFS extends RealFS {
  constructor(private readonly overlay: Map<string, string>) {
    super();
  }

  readFile(absolutePath: string): string | null {
    return this.overlay.get(absolutePath) ?? super.readFile(absolutePath);
  }

  fileExists(absolutePath: string): boolean {
    return this.overlay.has(absolutePath) || super.fileExists(absolutePath);
  }
}

export function findTestFiles(targetPath: string): string[] {
  const absoluteTargetPath = path.resolve(targetPath);
  if (!fs.existsSync(absoluteTargetPath)) {
    throw new Error(`File not found: ${absoluteTargetPath}`);
  }

  const stat = fs.statSync(absoluteTargetPath);
  if (stat.isDirectory()) {
    const results: string[] = [];
    collectTestFiles(absoluteTargetPath, results);
    results.sort();
    return results;
  }

  if (!stat.isFile()) {
    throw new Error(`Unsupported test target: ${absoluteTargetPath}`);
  }

  if (!absoluteTargetPath.endsWith(".do")) {
    throw new Error(`Test target must be a .do file or a directory: ${absoluteTargetPath}`);
  }

  return [absoluteTargetPath];
}

export function discoverTests(
  rootDir: string,
  testFiles: readonly string[],
  fileSystem: FileSystem = new RealFS(),
): DiscoveredTest[] {
  const discovered: DiscoveredTest[] = [];
  const pipelineFileSystem = withBundledStdlib(fileSystem);

  for (const testFile of testFiles) {
    const packageGraph = loadPackageGraph(fileSystem, testFile, {
      implicitStdDependencies: fileSystem instanceof RealFS,
    });
    const analyzer = new ModuleAnalyzer(
      pipelineFileSystem,
      createBundledModuleResolver(fileSystem, {
        packages: packageGraph.packages.map((pkg) => ({
          rootDir: pkg.rootDir,
          dependencies: pkg.dependencyRoots,
        })),
      }),
    );
    const analysisResult = analyzer.analyzeModule(testFile);
    const diagnostics = collectSemanticDiagnostics(analysisResult);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      throw new Error(renderDiscoveryFailure(testFile, errors));
    }

    const table = analysisResult.modules.get(testFile);
    if (!table) {
      throw new Error(`Test discovery failed for ${testFile}: module table not found`);
    }

    discovered.push(...collectTestsFromTable(rootDir, table));
  }

  discovered.sort((left, right) => left.id.localeCompare(right.id));
  return discovered;
}

export function filterTests(tests: readonly DiscoveredTest[], filter: string | null): DiscoveredTest[] {
  if (!filter) return [...tests];

  const needle = filter.toLowerCase();
  return tests.filter((test) => test.id.toLowerCase().includes(needle));
}

export function generateTestHarnessSource(
  harnessPath: string,
  tests: readonly DiscoveredTest[],
): string {
  const imports = tests.map((test, index) => {
    const specifier = toImportSpecifier(harnessPath, test.modulePath);
    return `import { ${test.name} as __doof_test_${index} } from "${specifier}"`;
  });

  const branches: string[] = [];
  tests.forEach((test, index) => {
    const keyword = index === 0 ? "if" : "} else if";
    const id = escapeDoofString(test.id);
    branches.push(`    ${keyword} testId == "${id}" {`);
    branches.push(`        __doof_test_${index}()`);
    branches.push(`        println("PASS ${id}")`);
    branches.push("        return 0");
  });

  return [
    ...imports,
    "",
    "function main(args: string[]): int {",
    "    if args.length < 2 {",
    "        println(\"missing test id\")",
    "        return 2",
    "    }",
    "",
    "    testId := args[1]",
    ...branches,
    "    } else {",
    "        println(\"unknown test id: ${testId}\")",
    "        return 2",
    "    }",
    "}",
  ].join("\n");
}

export function groupTestsByModule(tests: readonly DiscoveredTest[]): TestModuleGroup[] {
  const groups = new Map<string, TestModuleGroup>();

  for (const test of tests) {
    const existing = groups.get(test.modulePath);
    if (existing) {
      existing.tests.push(test);
      continue;
    }

    groups.set(test.modulePath, {
      modulePath: test.modulePath,
      moduleDisplayPath: test.moduleDisplayPath,
      tests: [test],
    });
  }

  return [...groups.values()].sort((left, right) => left.moduleDisplayPath.localeCompare(right.moduleDisplayPath));
}

export function runTestCommand(options: RunTestCommandOptions): RunTestCommandResult {
  const absoluteTargetPath = path.resolve(options.targetPath);
  const rootDir = determineRootDir(absoluteTargetPath);
  const testFiles = findTestFiles(absoluteTargetPath);
  const discovered = discoverTests(rootDir, testFiles);
  const selected = filterTests(discovered, options.filter);

  if (selected.length === 0) {
    const suffix = options.filter ? ` matching \"${options.filter}\"` : "";
    throw new Error(`No tests found under ${absoluteTargetPath}${suffix}`);
  }

  if (options.listOnly) {
    for (const test of selected) {
      options.reporter.log(test.id);
    }

    return {
      discovered: selected.length,
      executed: 0,
      passed: 0,
      failed: 0,
    };
  }

  const groups = groupTestsByModule(selected);
  let passed = 0;
  let failed = 0;

  for (const group of groups) {
    const harnessPath = buildHarnessPath(rootDir, group.moduleDisplayPath);
    const harnessSource = generateTestHarnessSource(harnessPath, group.tests);
    const overlay = new Map<string, string>([[harnessPath, harnessSource]]);
    const fileSystem = new OverlayFS(overlay);
    const executionRoot = determineExecutionRoot(group.modulePath, fileSystem);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-test-"));

    try {
      const { project, nativeBuild, outputBinaryName, provenance, buildManifest } = runPipelineWithFs(
        fileSystem,
        harnessPath,
        options.verbose,
        options.nativeBuild,
        options.reporter.log,
        (diagnostic) => options.reporter.error(formatDiagnostic(diagnostic)),
      );

      writeProject(project, outDir, options.verbose, options.reporter.log, provenance, buildManifest);
      const binary = compileCpp(
        outDir,
        project,
        options.compiler,
        nativeBuild,
        options.verbose,
        options.reporter.log,
        outputBinaryName,
      );

      for (const test of group.tests) {
        if (options.verbose) options.reporter.log(`Running ${test.id}`);

        try {
          execFileSync(binary, [test.id], {
            stdio: "pipe",
            timeout: 30000,
            cwd: executionRoot,
            env: options.compiler.env ?? process.env,
          });
          passed++;
          options.reporter.log(`PASS ${test.id}`);
        } catch (e: any) {
          failed++;
          options.reporter.error(`FAIL ${test.id}`);
          const stdout = e.stdout?.toString()?.trimEnd() ?? "";
          const stderr = e.stderr?.toString()?.trimEnd() ?? "";
          if (stdout) options.reporter.error(`stdout:\n${indentBlock(stdout)}`);
          if (stderr) options.reporter.error(`stderr:\n${indentBlock(stderr)}`);
        }
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  options.reporter.log(`Tests finished: ${passed} passed, ${failed} failed`);
  return {
    discovered: selected.length,
    executed: selected.length,
    passed,
    failed,
  };
}

function collectTestFiles(dirPath: string, results: string[]): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(entryPath, results);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX)) {
      results.push(entryPath);
    }
  }
}

function collectTestsFromTable(rootDir: string, table: ModuleSymbolTable): DiscoveredTest[] {
  const tests: DiscoveredTest[] = [];

  for (const [name, symbol] of table.exports) {
    if (symbol.symbolKind !== "function") continue;
    if (symbol.module !== table.path) continue;
    if (!name.startsWith(TEST_PREFIX)) continue;

    const failure = validateTestFunction(symbol, table.path);
    if (failure) {
      throw new Error(failure);
    }

    const moduleDisplayPath = normalizePath(path.relative(rootDir, table.path) || path.basename(table.path));
    tests.push({
      id: `${moduleDisplayPath}::${name}`,
      name,
      modulePath: table.path,
      moduleDisplayPath,
    });
  }

  return tests;
}

function validateTestFunction(symbol: FunctionSymbol, modulePath: string): string | null {
  const declaration = symbol.declaration;
  const location = `${modulePath}:${declaration.span.start.line + 1}:${declaration.span.start.column + 1}`;
  if (declaration.params.length > 0) {
    return `${location}: error: test \"${symbol.name}\" must not declare parameters`;
  }
  if (declaration.typeParams.length > 0) {
    return `${location}: error: test \"${symbol.name}\" must not declare type parameters`;
  }

  const resolvedType = declaration.resolvedType;
  if (!resolvedType || resolvedType.kind !== "function") {
    return `${location}: error: test \"${symbol.name}\" could not be resolved as a function`;
  }
  if (resolvedType.returnType.kind !== "void") {
    return `${location}: error: test \"${symbol.name}\" must return void`;
  }

  return null;
}

function renderDiscoveryFailure(testFile: string, diagnostics: readonly Diagnostic[]): string {
  const detail = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n");
  return `Test discovery failed for ${testFile}:\n${detail}`;
}

function determineRootDir(targetPath: string): string {
  const stat = fs.statSync(targetPath);
  return stat.isDirectory() ? targetPath : path.dirname(targetPath);
}

function determineExecutionRoot(modulePath: string, fileSystem: FileSystem): string {
  const manifestPath = findDoofManifestPath(fileSystem, modulePath);
  return manifestPath ? path.dirname(manifestPath) : path.dirname(modulePath);
}

function buildHarnessPath(rootDir: string, moduleDisplayPath: string): string {
  const safeModulePath = moduleDisplayPath.replace(/[^A-Za-z0-9._-]+/g, "_");
  return path.join(rootDir, `.doof-tests`, `${HARNESS_FILENAME.replace(/\.do$/, "")}_${safeModulePath}.do`);
}

function toImportSpecifier(fromPath: string, toPath: string): string {
  const relativePath = normalizePath(path.relative(path.dirname(fromPath), toPath));
  const prefixedPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  return prefixedPath.replace(/\.do$/, "");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeDoofString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function indentBlock(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}