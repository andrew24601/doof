// Runnable self-hosted compiler driver.
//
// The driver keeps filesystem access at the native-runtime boundary.  The
// compiler itself still receives ordinary SourceFile values, so this surface
// exercises the same resolver, analyzer, checker, and emitter used by the
// in-memory tests. The resolver asks this driver for source text only after an
// import is encountered. --module remains an explicit mapping for external
// modules, while local and std/* paths are resolved from their roots.

import { compileWithLoader } from "./compiler"
import { ModuleEmission } from "./emitter-module"
import { CliRequest, ModuleSource, cliUsage, parseCli } from "./cli"
import { environmentValue, joinPath, readProjectSpec } from "./project"
import { SourceLoader } from "./resolver"
import { Diagnostic, SourceFile } from "./semantic"
import { exists, readText, writeText } from "std/fs"

import function runtimeHeaderSourcePath(): string from "doof_runtime.hpp" as doof::runtime_header_source_path

function driverWithExtension(path: string): string {
  if path.endsWith(".do") { return path }
  return path + ".do"
}

function driverLogicalPath(path: string): string {
  withExtension := driverWithExtension(path)
  if withExtension.startsWith("/") {
    return driverSelfhostSuffix(withExtension)
  }
  return "/" + withExtension
}

function driverExternalLogicalPath(specifier: string): string {
  withExtension := driverWithExtension(specifier)
  if withExtension.startsWith("/") { return withExtension }
  return "/" + withExtension
}

function driverSelfhostSuffix(path: string): string {
  marker := "/selfhost/"
  let index = 0
  while index + marker.length <= path.length {
    if path.substring(index, index + marker.length) == marker {
      return path.substring(index, path.length)
    }
    index = index + 1
  }
  return path
}

function driverOutputPath(directory: string, name: string): string {
  if directory.endsWith("/") { return directory + name }
  return directory + "/" + name
}

function materializeStdlibSupport(outputDirectory: string, stdlibRoot: string, modules: ModuleEmission[]): void {
  if stdlibRoot == "" { return }
  let copiedJson = false
  let copiedFs = false
  let copiedPath = false
  let copiedBlob = false
  for module of modules {
    if module.modulePath.startsWith("/std/json/") && !copiedJson {
      nativePath := joinPath(joinPath(absolutePath(stdlibRoot), "json"), "native_json.hpp")
      try! writeText(driverOutputPath(outputDirectory, "native_json.hpp"), try! readText(nativePath))
      copiedJson = true
    }
    if module.modulePath == "/std/fs/index.do" && !copiedFs {
      fsRoot := joinPath(absolutePath(stdlibRoot), "fs")
      try! writeText(driverOutputPath(outputDirectory, "native_fs.hpp"), try! readText(joinPath(fsRoot, "native_fs.hpp")))
      try! writeText(driverOutputPath(outputDirectory, "types.hpp"),
        "#pragma once\n#include \"std_blob_types.hpp\"\n#include \"std_fs_types.hpp\"\n#include \"std_time_index.hpp\"\nusing EntryKind = ::app_std_fs_types_::EntryKind;\nusing IoError = ::app_std_fs_types_::IoError;\nusing Endian = ::app_std_blob_types_::Endian;\nusing TextEncoding = ::app_std_blob_types_::TextEncoding;\nusing EncodingError = ::app_std_blob_types_::EncodingError;\nusing Instant = ::app_std_time_index_::Instant;\nnamespace doof_fs { using EntryKind = ::app_std_fs_types_::EntryKind; using IoError = ::app_std_fs_types_::IoError; using Instant = ::app_std_time_index_::Instant; using ::app_std_fs_types_::IoError_name; }\n")
      copiedFs = true
    }
    if module.modulePath == "/std/path/index.do" && !copiedPath {
      pathRoot := joinPath(absolutePath(stdlibRoot), "path")
      try! writeText(driverOutputPath(outputDirectory, "native_path.hpp"), try! readText(joinPath(pathRoot, "native_path.hpp")))
      copiedPath = true
    }
    if module.modulePath == "/std/blob/index.do" && !copiedBlob {
      blobRoot := joinPath(absolutePath(stdlibRoot), "blob")
      try! writeText(driverOutputPath(outputDirectory, "native_blob.hpp"), try! readText(joinPath(blobRoot, "native_blob.hpp")))
      copiedBlob = true
    }
  }
}

class DriverSourceMapping {
  logicalPath: string
  diskPath: string
}

class DriverSourceRoot {
  logicalPrefix: string
  diskRoot: string
}

class DriverSourceState {
  localMappings: DriverSourceMapping[]
  localRoots: DriverSourceRoot[]
  moduleSources: ModuleSource[]
  stdlibRoot: string
}

let configuredDriverSourceState: DriverSourceState = DriverSourceState {
  localMappings: [],
  localRoots: [],
  moduleSources: [],
  stdlibRoot: "",
}

function driverSourceMapping(logicalPath: string, diskPath: string): DriverSourceMapping {
  return DriverSourceMapping { logicalPath, diskPath: absolutePath(diskPath) }
}

function driverSourceDiskPath(
  logicalPath: string,
  localMappings: DriverSourceMapping[],
  localRoots: DriverSourceRoot[],
  moduleSources: ModuleSource[],
  stdlibRoot: string,
): string {
  for mapping of localMappings {
    if mapping.logicalPath == logicalPath { return mapping.diskPath }
  }
  for mapping of moduleSources {
    if driverExternalLogicalPath(mapping.specifier) == logicalPath {
      return absolutePath(driverWithExtension(mapping.sourcePath))
    }
  }
  for root of localRoots {
    if logicalPath == root.logicalPrefix { return root.diskRoot }
    prefix := root.logicalPrefix + "/"
    if logicalPath.startsWith(prefix) {
      return joinPath(root.diskRoot, logicalPath.substring(prefix.length, logicalPath.length))
    }
  }
  if logicalPath.startsWith("/std/") && stdlibRoot != "" {
    return joinPath(absolutePath(stdlibRoot), logicalPath.substring(5, logicalPath.length))
  }
  return logicalPath
}

function loadDriverSource(
  logicalPath: string,
  localMappings: DriverSourceMapping[],
  localRoots: DriverSourceRoot[],
  moduleSources: ModuleSource[],
  stdlibRoot: string,
): SourceFile | null {
  diskPath := driverSourceDiskPath(logicalPath, localMappings, localRoots, moduleSources, stdlibRoot)
  if !exists(diskPath) { return null }
  source := readText(diskPath) else {
    return null
  }
  return SourceFile { path: logicalPath, source }
}

function configuredDriverSource(logicalPath: string): SourceFile | null => loadDriverSource(
  logicalPath,
  configuredDriverSourceState.localMappings,
  configuredDriverSourceState.localRoots,
  configuredDriverSourceState.moduleSources,
  configuredDriverSourceState.stdlibRoot,
)

function driverSelfhostDiskRoot(path: string): string {
  marker := "/selfhost/"
  let index = 0
  while index + marker.length <= path.length {
    if path.substring(index, index + marker.length) == marker {
      return path.substring(0, index + marker.length - 1)
    }
    index = index + 1
  }
  return ""
}

function sourceLoaderForRequest(entryPath: string, extraPaths: string[], moduleSources: ModuleSource[], stdlibRoot: string): SourceLoader {
  let localMappings: DriverSourceMapping[] = [driverSourceMapping(driverLogicalPath(entryPath), entryPath)]
  let localRoots: DriverSourceRoot[] = []
  selfhostRoot := driverSelfhostDiskRoot(entryPath)
  if selfhostRoot != "" {
    localRoots.push(DriverSourceRoot { logicalPrefix: "/selfhost", diskRoot: selfhostRoot })
  }
  for path of extraPaths {
    absolute := absolutePath(driverWithExtension(path))
    localMappings.push(driverSourceMapping(driverLogicalPath(absolute), absolute))
  }
  configuredDriverSourceState = DriverSourceState { localMappings, localRoots, moduleSources, stdlibRoot }
  return configuredDriverSource
}

function materializeRuntimeHeader(outputDirectory: string): void {
  // The canonical header is both the compiler's runtime dependency and the
  // source asset copied into generated projects. The override supports moving
  // a compiler binary independently from the header it was built against.
  let sourcePath = environmentValue("DOOF_RUNTIME_HEADER")
  if sourcePath == "" { sourcePath = runtimeHeaderSourcePath() }
  try! writeText(driverOutputPath(outputDirectory, "doof_runtime.hpp"), try! readText(sourcePath))
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for diagnostic of diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
}

function emitRequest(request: CliRequest): int {
  project := readProjectSpec(request.entry)
  entryPath := joinPath(project.rootDirectory, project.entry)
  entry := driverLogicalPath(entryPath)
  stdlibRoot := environmentValue("DOOF_STDLIB_ROOT")
  loader := sourceLoaderForRequest(entryPath, request.sourcePaths, request.moduleSources, stdlibRoot)
  result := compileWithLoader([], entry, loader)
  if result.diagnostics.length > 0 {
    printDiagnostics(result.diagnostics)
    return 1
  }
  if request.command == "check" { return 0 }
  if result.emission == null { panic("self-hosted compiler produced no emission") }

  outputDirectory := if request.outputDirectory == ""
    then joinPath(project.rootDirectory, project.buildDirectory)
    else absolutePath(request.outputDirectory)
  emission := result.emission!
  for module of emission.modules {
    try! writeText(driverOutputPath(outputDirectory, module.headerName), module.header)
    try! writeText(driverOutputPath(outputDirectory, module.sourceName), module.source)
  }
  materializeStdlibSupport(outputDirectory, environmentValue("DOOF_STDLIB_ROOT"), emission.modules)
  materializeRuntimeHeader(outputDirectory)
  return 0
}

function main(args: string[]): int {
  parsed := parseCli(args)
  if parsed.help {
    println(cliUsage())
    return 0
  }
  if parsed.error != "" {
    println("error: " + parsed.error)
    println(cliUsage())
    return 2
  }
  return emitRequest(parsed.request!)
}
