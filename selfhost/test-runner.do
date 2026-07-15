// Static test discovery and harness generation for the self-hosted CLI.
//
// Filesystem traversal, native compilation, and process isolation remain in
// driver.do. Keeping this module pure makes the test convention independently
// testable and leaves room for mock-graph and coverage metadata later.

import { Block, ExportList, FunctionDeclaration, NamedType, Program } from "./ast"
import type { Statement } from "./ast"

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
