// Static test discovery and harness generation for the self-hosted CLI.
//
// Filesystem traversal, native compilation, and process isolation remain in
// driver.do. Keeping this module pure makes the test convention independently
// testable and lets coverage parsing/report rendering remain deterministic.
// Mock roots are found by the analyzer when each generated harness imports its
// test module.

import { Block, ExportList, FunctionDeclaration, NamedType, Program } from "./ast"
import type { Statement } from "./ast"
export { CoverageModuleMetadata } from "./emitter-module"
import { CoverageModuleMetadata } from "./emitter-module"

export class CoverageFileReport {
  path: string
  covered: int
  total: int
  percentTenths: int
  hitLines: int[] = []
  missedLines: int[] = []
}

export class CoverageReport {
  totalCovered: int = 0
  totalLines: int = 0
  totalPercentTenths: int = 1000
  files: CoverageFileReport[] = []
}

export class DiscoveredTest {
  id: string
  name: string
  modulePath: string
  moduleDisplayPath: string
}

export class TestDiscovery {
  tests: DiscoveredTest[] = []
  errors: string[] = []
}

/** Discovers locally defined exported test functions in source order. */
export function discoverModuleTests(
  program: Program,
  modulePath: string,
  rootDirectory: string,
): TestDiscovery {
  result := TestDiscovery {}
  for statement of program.statements {
    case statement {
      fn: FunctionDeclaration -> {
        if fn.exported && fn.name.startsWith("test") {
          addDiscoveredTest(result, fn, fn.name, modulePath, rootDirectory)
        }
      }
      list: ExportList -> {
        if list.source != null { continue }
        for specifier of list.specifiers {
          exportedName := if specifier.alias == null then specifier.name else specifier.alias!
          if !exportedName.startsWith("test") { continue }
          declaration := findFunction(program.statements, specifier.name)
          if declaration != null {
            addDiscoveredTest(result, declaration!, exportedName, modulePath, rootDirectory)
          }
        }
      }
      _ -> { }
    }
  }
  return result
}

/** Applies the TypeScript runner's case-insensitive substring filter to ids. */
export function filterDiscoveredTests(tests: DiscoveredTest[], filter: string): DiscoveredTest[] {
  if filter == "" { return copyTests(tests) }
  needle := filter.toLowerCase()
  let selected: DiscoveredTest[] = []
  for test of tests {
    if test.id.toLowerCase().contains(needle) { selected.push(test) }
  }
  return selected
}

/** Generates the one-file harness that dispatches one test id per process. */
export function generateTestHarness(harnessPath: string, tests: DiscoveredTest[]): string {
  let source = ""
  for test of tests {
    source = source + "import { " + test.name + " } from \"" + relativeImportSpecifier(harnessPath, test.modulePath) + "\"\n"
  }
  source = source + "\nfunction main(args: string[]): int {\n"
  source = source + "    if args.length < 1 {\n"
  source = source + "        println(\"missing test id\")\n"
  source = source + "        return 2\n"
  source = source + "    }\n\n"
  source = source + "    testId := args[0]\n"
  for index of 0..<tests.length {
    keyword := if index == 0 then "if" else "} else if"
    id := escapeDoofString(tests[index].id)
    source = source + "    " + keyword + " testId == \"" + id + "\" {\n"
    source = source + "        " + tests[index].name + "()\n"
    source = source + "        return 0\n"
  }
  source = source + "    } else {\n"
  source = source + "        println(\"unknown test id: $" + "{testId}\")\n"
  source = source + "        return 2\n"
  source = source + "    }\n"
  source = source + "}\n"
  return source
}

/** Returns a stable slash-separated path beneath the requested test root. */
export function testDisplayPath(rootDirectory: string, modulePath: string): string {
  root := trimTrailingSlashes(rootDirectory.replaceAll("\\", "/"))
  module := modulePath.replaceAll("\\", "/")
  prefix := root + "/"
  if module.startsWith(prefix) { return module.substring(prefix.length, module.length) }
  return module
}

/** Renders a source-oriented parse diagnostic without requiring compiler IO. */
export function formatParseFailure(
  modulePath: string,
  source: string,
  line: int,
  column: int,
  message: string,
): string {
  header := modulePath + ":" + string(line) + ":" + string(column) + ": error: " + message
  lines := source.split("\n")
  if line < 1 || line > lines.length { return header }
  caretColumn := if column < 1 then 1 else column
  return header + "\n" + lines[line - 1] + "\n" + " ".repeat(caretColumn - 1) + "^"
}

/** Merges runtime coverage markers into hit arrays aligned with module metadata. */
export function mergeCoverageOutput(
  output: string,
  modules: CoverageModuleMetadata[],
  hitsByModule: int[][],
): void {
  for line of output.split("\n") {
    trimmed := line.trim()
    if !trimmed.startsWith("__COV__ ") { continue }
    parts := trimmed.split(" ")
    if parts.length != 3 { continue }
    moduleId := parseCoverageInteger(parts[1])
    sourceLine := parseCoverageInteger(parts[2])
    if moduleId < 0 || sourceLine < 1 { continue }
    for index of 0..<modules.length {
      if modules[index].moduleId == moduleId {
        while hitsByModule.length <= index { hitsByModule.push([]) }
        appendUniqueLine(hitsByModule[index], sourceLine)
      }
    }
  }
}

/** Removes internal coverage markers before child output is shown to users. */
export function stripCoverageLines(output: string): string {
  let result = ""
  for line of output.split("\n") {
    if line.trim().startsWith("__COV__ ") { continue }
    if result != "" { result = result + "\n" }
    result = result + line
  }
  return result.trim()
}

/** Builds deterministic per-file and aggregate line coverage data. */
export function buildCoverageReport(
  modules: CoverageModuleMetadata[],
  hitsByModule: int[][],
  rootDirectory: string,
): CoverageReport {
  report := CoverageReport {}
  for index of 0..<modules.length {
    module := modules[index]
    if module.instrumentedLines.length == 0 { continue }
    let hits: int[] = []
    if index < hitsByModule.length { hits = hitsByModule[index] }
    file := CoverageFileReport {
      path: testDisplayPath(rootDirectory, module.modulePath),
      covered: 0,
      total: module.instrumentedLines.length,
      percentTenths: 0,
    }
    for line of module.instrumentedLines {
      if containsLine(hits, line) { file.hitLines.push(line); file.covered += 1 }
      else { file.missedLines.push(line) }
    }
    file.percentTenths = coveragePercentTenths(file.covered, file.total)
    report.files.push(file)
    report.totalCovered += file.covered
    report.totalLines += file.total
  }
  report.totalPercentTenths = coveragePercentTenths(report.totalCovered, report.totalLines)
  return report
}

/** Renders the portable JSON artifact shared with the TypeScript test runner. */
export function renderCoverageJson(report: CoverageReport): string {
  let output = "{\n  \"timestamp\": \"\",\n  \"totals\": { \"covered\": " + string(report.totalCovered)
  output = output + ", \"total\": " + string(report.totalLines) + ", \"percent\": " + coveragePercentText(report.totalPercentTenths) + " },\n"
  output = output + "  \"files\": ["
  for index of 0..<report.files.length {
    file := report.files[index]
    output = output + (if index == 0 then "\n" else ",\n")
    output = output + "    {\n      \"path\": \"" + escapeJson(file.path) + "\",\n"
    output = output + "      \"covered\": " + string(file.covered) + ",\n"
    output = output + "      \"total\": " + string(file.total) + ",\n"
    output = output + "      \"percent\": " + coveragePercentText(file.percentTenths) + ",\n"
    output = output + "      \"hitLines\": " + renderLineArray(file.hitLines) + ",\n"
    output = output + "      \"missedLines\": " + renderLineArray(file.missedLines) + "\n    }"
  }
  return output + (if report.files.length == 0 then "]\n}\n" else "\n  ]\n}\n")
}

/** Renders a compact HTML index with links to per-source annotated reports. */
export function renderCoverageHtml(report: CoverageReport, fileDirectoryName: string): string {
  let rows = ""
  for file of report.files {
    href := escapeHtml(fileDirectoryName + "/" + coverageFileRelativePath(file.path))
    rows = rows + "<tr><td><a href=\"" + href + "\">" + escapeHtml(file.path) + "</a></td>"
    rows = rows + "<td>" + string(file.covered) + "/" + string(file.total) + "</td>"
    rows = rows + "<td>" + coveragePercentText(file.percentTenths) + "%</td></tr>\n"
  }
  overall := coveragePercentText(report.totalPercentTenths)
  return "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
    "<title>Doof Coverage Report</title><style>body{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1f2933}" +
    "table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.65rem;border-bottom:1px solid #ddd}" +
    "a{color:#9a3412}.summary{font-size:1.3rem}</style></head><body><h1>Doof Coverage</h1>" +
    "<p class=\"summary\">Overall: " + string(report.totalCovered) + "/" + string(report.totalLines) + " lines (" + overall + "%)</p>" +
    "<table><thead><tr><th>File</th><th>Lines</th><th>Coverage</th></tr></thead><tbody>" + rows +
    "</tbody></table></body></html>\n"
}

/** Renders one source file with covered, missed, and neutral line styling. */
export function renderCoverageFileHtml(file: CoverageFileReport, source: string, indexHref: string): string {
  let lines = ""
  sourceLines := source.split("\n")
  for index of 0..<sourceLines.length {
    line := index + 1
    className := if containsLine(file.hitLines, line) then "covered" else if containsLine(file.missedLines, line) then "missed" else "neutral"
    lines = lines + "<div class=\"line " + className + "\"><span>" + string(line) + "</span><code>" + escapeHtml(sourceLines[index]) + "</code></div>\n"
  }
  return "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
    "<title>" + escapeHtml(file.path) + " — Doof Coverage</title><style>body{font:15px system-ui;margin:2rem;color:#1f2933}" +
    ".line{display:grid;grid-template-columns:4rem 1fr;font-family:monospace;white-space:pre}.line span{text-align:right;padding-right:1rem;color:#6b7280}" +
    ".covered{background:#dcfce7}.missed{background:#fee2e2}.neutral{background:#f8fafc}a{color:#9a3412}</style></head><body>" +
    "<a href=\"" + escapeHtml(indexHref) + "\">Back to coverage summary</a><h1>" + escapeHtml(file.path) + "</h1>" + lines +
    "</body></html>\n"
}

/** Produces a traversal-safe relative filename for a source coverage page. */
export function coverageFileRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll("../", "_external/") + ".html"
}

function parseCoverageInteger(value: string): int {
  if value == "" { return -1 }
  let result = 0
  for index of 0..<value.length {
    char := value[index]
    let digit = -1
    if char == '0' { digit = 0 }
    else if char == '1' { digit = 1 }
    else if char == '2' { digit = 2 }
    else if char == '3' { digit = 3 }
    else if char == '4' { digit = 4 }
    else if char == '5' { digit = 5 }
    else if char == '6' { digit = 6 }
    else if char == '7' { digit = 7 }
    else if char == '8' { digit = 8 }
    else if char == '9' { digit = 9 }
    if digit < 0 { return -1 }
    result = result * 10 + digit
  }
  return result
}

function appendUniqueLine(lines: int[], line: int): void {
  if !containsLine(lines, line) { lines.push(line) }
}

function containsLine(lines: int[], line: int): bool {
  for existing of lines { if existing == line { return true } }
  return false
}

function coveragePercentTenths(covered: int, total: int): int {
  if total == 0 { return 1000 }
  return (covered * 1000 + total \ 2) \ total
}

function coveragePercentText(tenths: int): string {
  return string(tenths \ 10) + "." + string(tenths % 10)
}

function renderLineArray(lines: int[]): string {
  let result = "["
  for index of 0..<lines.length {
    if index > 0 { result = result + ", " }
    result = result + string(lines[index])
  }
  return result + "]"
}

function escapeJson(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;")
}

function addDiscoveredTest(
  result: TestDiscovery,
  declaration: FunctionDeclaration,
  exportedName: string,
  modulePath: string,
  rootDirectory: string,
): void {
  location := modulePath + ":" + string(declaration.span.start.line) + ":" + string(declaration.span.start.column)
  if declaration.params.length > 0 {
    result.errors.push(location + ": error: test \"" + exportedName + "\" must not declare parameters")
    return
  }
  if declaration.typeParams.length > 0 {
    result.errors.push(location + ": error: test \"" + exportedName + "\" must not declare type parameters")
    return
  }
  if !returnsVoid(declaration) {
    result.errors.push(location + ": error: test \"" + exportedName + "\" must return void")
    return
  }
  displayPath := testDisplayPath(rootDirectory, modulePath)
  result.tests.push(DiscoveredTest {
    id: displayPath + "::" + exportedName,
    name: exportedName,
    modulePath,
    moduleDisplayPath: displayPath,
  })
}

function returnsVoid(declaration: FunctionDeclaration): bool {
  if declaration.returnType == null {
    case declaration.body {
      _: Block -> { return true }
      _ -> { return false }
    }
  }
  case declaration.returnType! {
    named: NamedType -> { return named.name == "void" }
    _ -> { return false }
  }
}

function findFunction(statements: Statement[], name: string): FunctionDeclaration | null {
  for statement of statements {
    case statement {
      fn: FunctionDeclaration -> { if fn.name == name { return fn } }
      _ -> { }
    }
  }
  return null
}

function copyTests(tests: DiscoveredTest[]): DiscoveredTest[] {
  let result: DiscoveredTest[] = []
  for test of tests { result.push(test) }
  return result
}

function relativeImportSpecifier(harnessPath: string, modulePath: string): string {
  sourceComponents := parentComponents(harnessPath.replaceAll("\\", "/"))
  to := withoutExtension(modulePath.replaceAll("\\", "/")).split("/")
  let common = 0
  while common < sourceComponents.length && common < to.length && sourceComponents[common] == to[common] {
    common = common + 1
  }
  let result = ""
  for ignored of common..<sourceComponents.length { result = result + "../" }
  for index of common..<to.length {
    if result != "" && !result.endsWith("/") { result = result + "/" }
    result = result + to[index]
  }
  if !result.startsWith(".") { return "./" + result }
  return result
}

function parentComponents(path: string): string[] {
  components := path.split("/")
  if components.length > 0 { let ignored = try! components.pop() }
  return components
}

function withoutExtension(path: string): string {
  if path.endsWith(".do") { return path.substring(0, path.length - 3) }
  return path
}

function trimTrailingSlashes(path: string): string {
  let end = path.length
  while end > 1 && path[end - 1] == '/' { end = end - 1 }
  return path.substring(0, end)
}

function escapeDoofString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}
