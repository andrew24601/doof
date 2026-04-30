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
import type { CoverageModuleMetadata } from "./emitter-module.js";
import { findDoofManifestPath } from "./package-manifest.js";
import { loadPackageGraph } from "./package-manifest.js";
import { collectSemanticDiagnostics } from "./pipeline-diagnostics.js";
import type { FileSystem } from "./resolver.js";
import { createNodeBundledModuleResolver, withNodeBundledStdlib } from "./stdlib-node.js";
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
  /** When true, compile with DOOF_COVERAGE and produce a coverage report. */
  coverage?: boolean;
  /** Output path for the JSON coverage report. Defaults to build/coverage/doof-test-coverage.json under the test root. */
  coverageOutput?: string;
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
  const pipelineFileSystem = withNodeBundledStdlib(fileSystem);

  for (const testFile of testFiles) {
    const packageGraph = loadPackageGraph(fileSystem, testFile, {
      implicitStdDependencies: fileSystem instanceof RealFS,
    });
    const analyzer = new ModuleAnalyzer(
      pipelineFileSystem,
      createNodeBundledModuleResolver(fileSystem, {
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

  // Coverage accumulators keyed by module *path* to avoid integer-ID collisions across groups.
  const coverageHitsByPath = new Map<string, Set<number>>();
  // Deduplicated metadata: first group to include a module wins.
  const coverageModulesByPath = new Map<string, CoverageModuleMetadata>();

  // When coverage is enabled, inject -DDOOF_COVERAGE into the compile defines.
  const nativeBuildForRun = options.coverage
    ? { ...options.nativeBuild, defines: [...options.nativeBuild.defines, "DOOF_COVERAGE"] }
    : options.nativeBuild;

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
        nativeBuildForRun,
        options.reporter.log,
        (diagnostic) => options.reporter.error(formatDiagnostic(diagnostic)),
        { coverage: options.coverage },
      );

      // Merge coverage module metadata from successive compilation groups.
      // Build per-group id→path map immediately, and register metadata (first group wins).
      const groupIdToPath = new Map<number, string>();
      if (options.coverage && project.coverageModules) {
        for (const m of project.coverageModules) {
          groupIdToPath.set(m.moduleId, m.modulePath);
          if (!coverageModulesByPath.has(m.modulePath)) {
            coverageModulesByPath.set(m.modulePath, m);
          }
        }
      }

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
          const stdoutBuf = execFileSync(binary, [test.id], {
            stdio: "pipe",
            timeout: 30000,
            cwd: executionRoot,
            env: options.compiler.env ?? process.env,
          });
          if (options.coverage) {
            mergeCoverageByPath(stdoutBuf.toString(), groupIdToPath, coverageHitsByPath);
          }
          passed++;
          options.reporter.log(`PASS ${test.id}`);
        } catch (e: any) {
          failed++;
          options.reporter.error(`FAIL ${test.id}`);
          const rawStdout = e.stdout?.toString() ?? "";
          const stderr = e.stderr?.toString()?.trimEnd() ?? "";
          if (options.coverage && rawStdout) {
            mergeCoverageByPath(rawStdout, groupIdToPath, coverageHitsByPath);
          }
          const stdout = options.coverage ? stripCoverageLines(rawStdout) : rawStdout.trimEnd();
          if (stdout) options.reporter.error(`stdout:\n${indentBlock(stdout)}`);
          if (stderr) options.reporter.error(`stderr:\n${indentBlock(stderr)}`);
        }
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  options.reporter.log(`Tests finished: ${passed} passed, ${failed} failed`);

  if (options.coverage && coverageModulesByPath.size > 0) {
    const coverageModules = [...coverageModulesByPath.values()];
    const defaultOutput = path.join(rootDir, "build", "coverage", "doof-test-coverage.json");
    const outputPath = options.coverageOutput || defaultOutput;
    const report = buildCoverageReport(coverageModules, coverageHitsByPath, rootDir);
    printCoverageReport(report, options.reporter);
    writeCoverageReport(report, outputPath, options.reporter);
    writeCoverageHtmlReport(report, deriveCoverageHtmlPath(outputPath), rootDir, options.reporter);
  }

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

// ============================================================================
// Coverage helpers
// ============================================================================

export interface CoverageFileReport {
  path: string;
  covered: number;
  total: number;
  percent: number;
  hitLines: number[];
  missedLines: number[];
}

export interface CoverageReport {
  timestamp: string;
  totals: { covered: number; total: number; percent: number };
  files: CoverageFileReport[];
}

/**
 * Parse `__COV__ <moduleId> <line>` lines from test stdout and accumulate them
 * into the given hits map (moduleId → set of 1-based line numbers).
 */
export function parseCoverageOutput(stdout: string, hits: Map<number, Set<number>>): void {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("__COV__ ")) continue;
    const parts = trimmed.split(" ");
    if (parts.length !== 3) continue;
    const moduleId = parseInt(parts[1], 10);
    const lineNum = parseInt(parts[2], 10);
    if (!Number.isFinite(moduleId) || !Number.isFinite(lineNum)) continue;
    let set = hits.get(moduleId);
    if (!set) {
      set = new Set();
      hits.set(moduleId, set);
    }
    set.add(lineNum);
  }
}

/**
 * Remove `__COV__` lines from stdout before displaying it in test failure output.
 */
/**
 * Parse `__COV__` lines from stdout, translate integer moduleIds to paths via the
 * per-group id→path map, and accumulate into the cross-group path-keyed hits map.
 */
function mergeCoverageByPath(
  stdout: string,
  idToPath: Map<number, string>,
  hitsByPath: Map<string, Set<number>>,
): void {
  const groupHits = new Map<number, Set<number>>();
  parseCoverageOutput(stdout, groupHits);
  for (const [id, lines] of groupHits) {
    const modulePath = idToPath.get(id);
    if (modulePath === undefined) continue;
    let set = hitsByPath.get(modulePath);
    if (!set) { set = new Set(); hitsByPath.set(modulePath, set); }
    for (const line of lines) set.add(line);
  }
}

/**
 * Remove `__COV__` lines from stdout before displaying it in test failure output.
 */
export function stripCoverageLines(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !line.trimEnd().startsWith("__COV__ "))
    .join("\n")
    .trimEnd();
}

/**
 * Build a structured coverage report from aggregated hits and module metadata.
 */
export function buildCoverageReport(
  coverageModules: CoverageModuleMetadata[],
  hitsByPath: Map<string, Set<number>>,
  rootDir: string,
): CoverageReport {
  const files: CoverageFileReport[] = [];
  let totalCovered = 0;
  let totalTotal = 0;

  for (const { modulePath, instrumentedLines } of coverageModules) {
    if (instrumentedLines.length === 0) continue;
    const hitSet = hitsByPath.get(modulePath) ?? new Set<number>();
    const hitLines = instrumentedLines.filter((l) => hitSet.has(l));
    const missedLines = instrumentedLines.filter((l) => !hitSet.has(l));
    const covered = hitLines.length;
    const total = instrumentedLines.length;
    const percent = total > 0 ? Math.round((covered / total) * 1000) / 10 : 100;
    const displayPath = normalizePath(path.relative(rootDir, modulePath));

    files.push({ path: displayPath, covered, total, percent, hitLines, missedLines });
    totalCovered += covered;
    totalTotal += total;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const totalPercent = totalTotal > 0 ? Math.round((totalCovered / totalTotal) * 1000) / 10 : 100;

  return {
    timestamp: new Date().toISOString(),
    totals: { covered: totalCovered, total: totalTotal, percent: totalPercent },
    files,
  };
}

function printCoverageReport(report: CoverageReport, reporter: TestReporter): void {
  reporter.log("Coverage summary:");
  for (const file of report.files) {
    reporter.log(`  ${file.path}: ${file.covered}/${file.total} lines (${file.percent.toFixed(1)}%)`);
  }
  reporter.log(`Overall: ${report.totals.covered}/${report.totals.total} lines (${report.totals.percent.toFixed(1)}%)`);
}

export function deriveCoverageHtmlPath(outputPath: string): string {
  return outputPath.endsWith(".json")
    ? `${outputPath.slice(0, -5)}.html`
    : `${outputPath}.html`;
}

export function deriveCoverageFileHtmlDir(indexHtmlPath: string): string {
  return indexHtmlPath.endsWith(".html")
    ? `${indexHtmlPath.slice(0, -5)}_files`
    : `${indexHtmlPath}_files`;
}

export function deriveCoverageFileHtmlPath(indexHtmlPath: string, filePath: string): string {
  return path.join(deriveCoverageFileHtmlDir(indexHtmlPath), `${filePath}.html`);
}

export function renderCoverageHtml(
  report: CoverageReport,
  fileLinks: Map<string, string> = new Map(),
): string {
  const generatedAt = escapeHtml(report.timestamp);
  const overallPercent = report.totals.percent.toFixed(1);
  const rows = report.files.map((file) => {
    const percent = file.percent.toFixed(1);
    const href = fileLinks.get(file.path);
    const fileLabel = href
      ? `<a class="file-link" href="${escapeHtml(href)}">${escapeHtml(file.path)}</a>`
      : escapeHtml(file.path);
    return `
      <tr>
        <td class="path" data-label="File">${fileLabel}</td>
        <td class="num" data-label="Covered">${file.covered}</td>
        <td class="num" data-label="Total">${file.total}</td>
        <td class="num" data-label="Percent">${percent}%</td>
        <td data-label="Bar">
          <div class="bar"><span style="width: ${Math.max(0, Math.min(100, file.percent))}%;"></span></div>
        </td>
        <td class="view" data-label="Report">${href ? `<a class="view-link" href="${escapeHtml(href)}">Open file report</a>` : "-"}</td>
      </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Doof Coverage Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5efe6;
      --panel: #fffaf2;
      --panel-strong: #fff;
      --text: #1f2933;
      --muted: #52606d;
      --border: #d9cbb8;
      --accent: #b85c38;
      --accent-soft: #f3c4a2;
      --good: #2d6a4f;
      --bad: #a61e4d;
      --shadow: rgba(76, 58, 36, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      background:
        radial-gradient(circle at top right, rgba(184, 92, 56, 0.16), transparent 28%),
        linear-gradient(180deg, #f8f1e8 0%, var(--bg) 100%);
      color: var(--text);
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      background: linear-gradient(135deg, rgba(184, 92, 56, 0.12), rgba(255, 250, 242, 0.95));
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 16px 40px var(--shadow);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 5vw, 3.2rem);
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 1rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .stat {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 18px;
    }
    .stat-label {
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stat-value {
      margin-top: 8px;
      font-size: 2rem;
      font-weight: 700;
    }
    .table-wrap {
      margin-top: 24px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: 0 16px 40px var(--shadow);
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(217, 203, 184, 0.6);
      vertical-align: top;
      text-align: left;
      font-size: 0.95rem;
    }
    th {
      background: rgba(184, 92, 56, 0.08);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
    }
    tr:last-child td { border-bottom: none; }
    .path {
      min-width: 180px;
      font-weight: 700;
      word-break: break-word;
    }
    .file-link, .view-link {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(184, 92, 56, 0.25);
    }
    .file-link:hover, .view-link:hover {
      border-bottom-color: var(--accent);
    }
    .num {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      width: 180px;
      max-width: 100%;
      height: 10px;
      background: rgba(184, 92, 56, 0.12);
      border-radius: 999px;
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-soft));
      border-radius: 999px;
    }
    @media (max-width: 800px) {
      main { padding: 20px 12px 32px; }
      .hero, .table-wrap { border-radius: 16px; }
      th, td { padding: 12px; }
      table, thead, tbody, th, td, tr { display: block; }
      thead { display: none; }
      tr { padding: 12px; border-bottom: 1px solid rgba(217, 203, 184, 0.6); }
      td { border: 0; padding: 6px 0; }
      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 2px;
      }
      .bar { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Doof Coverage</h1>
      <p class="subtitle">Generated ${generatedAt}</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Overall Coverage</div>
          <div class="stat-value">${overallPercent}%</div>
        </div>
        <div class="stat">
          <div class="stat-label">Covered Lines</div>
          <div class="stat-value">${report.totals.covered}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Instrumented Lines</div>
          <div class="stat-value">${report.totals.total}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Files</div>
          <div class="stat-value">${report.files.length}</div>
        </div>
      </div>
    </section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Covered</th>
            <th>Total</th>
            <th>Percent</th>
            <th>Bar</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

export function renderCoverageFileHtml(
  file: CoverageFileReport,
  source: string,
  indexHref = "../doof-test-coverage.html",
): string {
  const coveredSet = new Set(file.hitLines);
  const missedSet = new Set(file.missedLines);
  const lines = source.split("\n");
  const lineItems = lines.map((line, index) => {
    const lineNumber = index + 1;
    const className = coveredSet.has(lineNumber)
      ? "covered"
      : missedSet.has(lineNumber)
        ? "missed"
        : "neutral";
    return `
      <div class="source-line ${className}">
        <span class="line-no">${lineNumber}</span>
        <code class="line-code">${escapeHtml(line || " ")}</code>
      </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(file.path)} Coverage</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe7;
      --panel: #fffaf3;
      --text: #1f2933;
      --muted: #52606d;
      --border: #dccfbc;
      --accent: #b85c38;
      --good-bg: #e7f5ec;
      --good-border: #8bc7a1;
      --bad-bg: #fdebed;
      --bad-border: #e6a3b7;
      --neutral-bg: #f7f2eb;
      --shadow: rgba(76, 58, 36, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      color: var(--text);
      background: linear-gradient(180deg, #fbf6ef, var(--bg));
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }
    .hero, .source {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 14px 36px var(--shadow);
    }
    .hero {
      padding: 24px;
      margin-bottom: 20px;
    }
    .back-link {
      color: var(--accent);
      text-decoration: none;
      font-size: 0.95rem;
    }
    h1 {
      margin: 12px 0 6px;
      font-size: clamp(1.8rem, 4vw, 3rem);
      line-height: 1.05;
      letter-spacing: -0.03em;
      word-break: break-word;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    .pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 12px;
      background: #fff;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .source {
      overflow: hidden;
    }
    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(184, 92, 56, 0.05);
      color: var(--muted);
      font-size: 0.88rem;
    }
    .legend span::before {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      margin-right: 8px;
      vertical-align: middle;
    }
    .legend .covered::before { background: #4f9d69; }
    .legend .missed::before { background: #d35d82; }
    .legend .neutral::before { background: #cdbca6; }
    .source-lines {
      font-family: "SFMono-Regular", "Cascadia Code", "Menlo", monospace;
      font-size: 0.92rem;
      overflow-x: auto;
    }
    .source-line {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 14px;
      padding: 0 18px;
      border-left: 4px solid transparent;
    }
    .source-line.covered {
      background: var(--good-bg);
      border-left-color: var(--good-border);
    }
    .source-line.missed {
      background: var(--bad-bg);
      border-left-color: var(--bad-border);
    }
    .source-line.neutral {
      background: var(--neutral-bg);
    }
    .line-no {
      display: block;
      padding: 8px 0;
      text-align: right;
      color: var(--muted);
      user-select: none;
      border-right: 1px solid rgba(82, 96, 109, 0.16);
      padding-right: 12px;
      font-variant-numeric: tabular-nums;
    }
    .line-code {
      display: block;
      padding: 8px 0;
      white-space: pre;
    }
    @media (max-width: 720px) {
      main { padding: 18px 10px 28px; }
      .hero, .source { border-radius: 14px; }
      .source-line {
        grid-template-columns: 56px 1fr;
        gap: 10px;
        padding: 0 10px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <a class="back-link" href="${escapeHtml(indexHref)}">Back to coverage summary</a>
      <h1>${escapeHtml(file.path)}</h1>
      <div class="summary">
        <span class="pill">Coverage ${file.percent.toFixed(1)}%</span>
        <span class="pill">Covered ${file.covered}</span>
        <span class="pill">Instrumented ${file.total}</span>
      </div>
    </section>
    <section class="source">
      <div class="legend">
        <span class="covered">Covered executable line</span>
        <span class="missed">Missed executable line</span>
        <span class="neutral">Non-instrumented line</span>
      </div>
      <div class="source-lines">${lineItems}</div>
    </section>
  </main>
</body>
</html>
`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeCoverageReport(report: CoverageReport, outputPath: string, reporter: TestReporter): void {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
    reporter.log(`Coverage report written to ${outputPath}`);
  } catch (e: any) {
    reporter.error(`Failed to write coverage report: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function writeCoverageHtmlReport(
  report: CoverageReport,
  outputPath: string,
  rootDir: string,
  reporter: TestReporter,
): void {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const fileLinks = new Map<string, string>();
    for (const file of report.files) {
      const fileOutputPath = deriveCoverageFileHtmlPath(outputPath, file.path);
      const sourcePath = path.join(rootDir, file.path);
      const source = fs.readFileSync(sourcePath, "utf-8");
      fs.mkdirSync(path.dirname(fileOutputPath), { recursive: true });
      const indexHref = normalizePath(path.relative(path.dirname(fileOutputPath), outputPath));
      fs.writeFileSync(fileOutputPath, renderCoverageFileHtml(file, source, indexHref));
      fileLinks.set(file.path, normalizePath(path.relative(path.dirname(outputPath), fileOutputPath)));
    }
    fs.writeFileSync(outputPath, renderCoverageHtml(report, fileLinks));
    reporter.log(`Coverage HTML report written to ${outputPath}`);
  } catch (e: any) {
    reporter.error(`Failed to write coverage HTML report: ${e instanceof Error ? e.message : String(e)}`);
  }
}