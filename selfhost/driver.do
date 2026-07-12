// Runnable self-hosted compiler driver.
//
// The driver keeps filesystem access at the native-runtime boundary.  The
// compiler itself still receives ordinary SourceFile values, so this surface
// exercises the same resolver, analyzer, checker, and emitter used by the
// in-memory tests. Source files after the output prefix complete the graph.

import { compile } from "./compiler"
import { Diagnostic, SourceFile } from "./semantic"

function driverWithExtension(path: string): string {
  if path.endsWith(".do") { return path }
  return path + ".do"
}

function driverParentDirectory(path: string): string {
  let end = path.length - 1
  while end >= 0 && path[end] == '/' { end = end - 1 }
  while end >= 0 && path[end] != '/' { end = end - 1 }
  if end <= 0 { return "/" }
  return path.substring(0, end)
}

function driverBasename(path: string): string {
  let end = path.length - 1
  while end >= 0 && path[end] != '/' { end = end - 1 }
  return path.substring(end + 1, path.length)
}

function hasPath(paths: string[], path: string): bool {
  for existing of paths { if existing == path { return true } }
  return false
}

function loadSources(entry: string, extraPaths: string[]): SourceFile[] {
  let paths: string[] = [entry]
  for extra of extraPaths {
    path := absolutePath(extra)
    if !hasPath(paths, path) { paths.push(path) }
  }
  let sources: SourceFile[] = []
  let index = 0
  while index < paths.length {
    path := paths[index]
    index = index + 1
    source := readFile(path)
    sources.push(SourceFile { path, source })
  }
  return sources
}

function runtimeHeader(): string {
  return "#pragma once\n" +
    "#include <filesystem>\n" +
    "#include <fstream>\n" +
    "#include <iostream>\n" +
    "#include <sstream>\n" +
    "#include <stdexcept>\n" +
    "#include <string>\n" +
    "#include <utility>\n" +
    "#include <vector>\n" +
    "namespace doof {\n" +
    "[[noreturn]] inline void panic(const std::string& message);\n" +
    "template <typename T> std::string to_string(const T& value) { return std::to_string(value); }\n" +
    "inline std::string to_string(const std::string& value) { return value; }\n" +
    "inline std::string to_string(const char& value) { return std::string(1, value); }\n" +
    "inline std::string to_string(const char32_t& value) { return std::string(1, static_cast<char>(value)); }\n" +
    "inline void println(const std::string& value) { std::cout << value << std::endl; }\n" +
    "inline std::string read_file(const std::string& path) { std::ifstream input(path); if (!input) throw std::runtime_error(\"cannot read file: \" + path); std::ostringstream contents; contents << input.rdbuf(); return contents.str(); }\n" +
    "inline void write_file(const std::string& path, const std::string& contents) { std::ofstream output(path); if (!output) throw std::runtime_error(\"cannot write file: \" + path); output << contents; }\n" +
    "inline std::string absolute_path(const std::string& path) { return std::filesystem::absolute(path).lexically_normal().string(); }\n" +
    "[[noreturn]] inline void panic(const std::string& message) { throw std::runtime_error(message); }\n" +
    "}\n"
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for diagnostic of diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
}

function main(args: string[]): int {
  if args.length < 2 {
    println("usage: doof-selfhost <entry.do> <output-prefix> [source.do ...]")
    return 2
  }

  entry := driverWithExtension(absolutePath(args[0]))
  prefix := absolutePath(args[1])
  let extraPaths: string[] = []
  for i of 2..<args.length { extraPaths.push(args[i]) }
  result := compile(loadSources(entry, extraPaths), entry)
  if result.diagnostics.length > 0 {
    printDiagnostics(result.diagnostics)
    return 1
  }
  if result.emission == null { panic("self-hosted compiler produced no emission") }

  emission := result.emission!
  headerName := driverBasename(prefix) + ".hpp"
  source := emission.source.replaceAll("#include \"selfhost.hpp\"", "#include \"" + headerName + "\"")
  writeFile(prefix + ".hpp", emission.header)
  writeFile(prefix + ".cpp", source)
  writeFile(driverParentDirectory(prefix) + "/doof_runtime.hpp", runtimeHeader())
  return 0
}
