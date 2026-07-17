// Native compiler argument planning for materialized self-hosted projects.
//
// Project emission keeps native paths output-relative. This module owns the
// single transition to concrete disk paths and compiler command arguments,
// leaving process execution at the driver boundary.

import { ModuleEmission } from "./emitter-module"
import { NativeBuildPlan } from "./package-manifest"

/** One independently executable object compilation task. */
export class NativeCompileTask {
  readonly compiler: string
  readonly sourcePath: string
  readonly outputPath: string
  readonly arguments: string[] = []
}

/** One immutable serial work queue assigned to a native compiler actor. */
export type NativeCompileTaskBatch = readonly NativeCompileTask[]

/** A complete native compiler invocation for one emitted executable. */
export class NativeCompilePlan {
  compiler: string
  precompiledHeaderArguments: string[] = []
  compileTasks: NativeCompileTask[] = []
  linkArguments: string[] = []
  outputPath: string
}

/** Distributes object tasks across a bounded set of serial worker batches. */
export function batchNativeCompileTasks(
  tasks: NativeCompileTask[],
  maximumWorkers: int = 8,
): readonly NativeCompileTaskBatch[] {
  if tasks.length == 0 || maximumWorkers <= 0 { return [] }
  workerCount := if tasks.length < maximumWorkers then tasks.length else maximumWorkers
  let batches: NativeCompileTask[][] = []
  while batches.length < workerCount { batches.push([]) }
  for index of 0..<tasks.length { batches[index % workerCount].push(tasks[index]) }
  let readonlyBatches: NativeCompileTaskBatch[] = []
  for batch of batches { readonlyBatches.push(batch.buildReadonly()) }
  return readonlyBatches.buildReadonly()
}

/**
 * Plans independent GCC-compatible object compilations followed by one link.
 *
 * Source and output paths stay explicit on each task so a future incremental
 * executor can fingerprint and skip tasks without changing this build model.
 */
export function planNativeCompile(
  compiler: string,
  outputDirectory: string,
  outputPath: string,
  modules: ModuleEmission[],
  native: NativeBuildPlan,
  release: bool = false,
  platform: string = "",
  wasmExportNames: string[] = [],
  wasm: bool = false,
): NativeCompilePlan {
  let compileArguments: string[] = ["-std=c++17"]
  // Release defaults precede manifest flags so packages can intentionally
  // override optimization while still receiving the NDEBUG contract.
  if release {
    compileArguments.push("-O2")
    compileArguments.push("-DNDEBUG")
  }
  if wasm {
    compileArguments.push("-Oz")
    compileArguments.push("-flto")
  }
  for define of native.defines { compileArguments.push("-D" + define) }
  compileArguments.push("-I")
  compileArguments.push(outputDirectory)
  for includePath of native.includePaths {
    compileArguments.push("-I")
    compileArguments.push(resolveBuildPath(outputDirectory, includePath))
  }
  for flag of native.compilerFlags { compileArguments.push(flag) }
  let precompiledHeaderArguments: string[] = []
  let clangPchPath = ""
  // The runtime dominates repeated parsing in larger generated projects. Build
  // it once, but avoid paying the PCH startup cost for a single module.
  if modules.length > 1 && !wasm {
    runtimeHeader := resolveBuildPath(outputDirectory, "doof_runtime.hpp")
    clangPch := usesClangPrecompiledHeader(compiler, platform)
    pchPath := runtimeHeader + if clangPch then ".pch" else ".gch"
    for argument of compileArguments { precompiledHeaderArguments.push(argument) }
    precompiledHeaderArguments.push("-x")
    precompiledHeaderArguments.push("c++-header")
    precompiledHeaderArguments.push(runtimeHeader)
    precompiledHeaderArguments.push("-o")
    precompiledHeaderArguments.push(pchPath)
    if clangPch { clangPchPath = pchPath }
  }

  let compileTasks: NativeCompileTask[] = []
  let objectPaths: string[] = []
  for index of 0..<modules.length {
    sourcePath := resolveBuildPath(outputDirectory, modules[index].sourceName)
    objectPath := resolveBuildPath(outputDirectory, ".doof-objects/generated-" + string(index) + ".o")
    arguments := copyArguments(compileArguments)
    // A C++ PCH is valid for generated C++ translation units. Native sources
    // may be C or Objective-C++, whose compiler language mode is incompatible.
    if clangPchPath != "" {
      arguments.push("-include-pch")
      arguments.push(clangPchPath)
    }
    appendObjectArguments(arguments, sourcePath, objectPath)
    compileTasks.push(NativeCompileTask {
      compiler,
      sourcePath,
      outputPath: objectPath,
      arguments: arguments.buildReadonly(),
    })
    objectPaths.push(objectPath)
  }
  for index of 0..<native.sourceFiles.length {
    sourcePath := resolveBuildPath(outputDirectory, native.sourceFiles[index])
    objectPath := resolveBuildPath(outputDirectory, ".doof-objects/native-" + string(index) + ".o")
    cSource := isCSource(sourcePath)
    arguments := copyNativeCompileArguments(compileArguments, cSource)
    appendObjectArguments(arguments, sourcePath, objectPath)
    taskCompiler := if cSource then deriveCCompiler(compiler) else compiler
    compileTasks.push(NativeCompileTask {
      compiler: taskCompiler,
      sourcePath,
      outputPath: objectPath,
      arguments: arguments.buildReadonly(),
    })
    objectPaths.push(objectPath)
  }

  let linkArguments: string[] = []
  for objectPath of objectPaths { linkArguments.push(objectPath) }
  for libraryPath of native.libraryPaths {
    linkArguments.push("-L" + resolveBuildPath(outputDirectory, libraryPath))
  }
  for library of native.linkLibraries { linkArguments.push("-l" + library) }
  for framework of native.frameworks {
    linkArguments.push("-framework")
    linkArguments.push(framework)
  }
  if !wasm { for flag of native.linkerFlags { linkArguments.push(flag) } }
  if wasm {
    linkArguments.push("-Oz")
    linkArguments.push("-flto")
    linkArguments.push("--strip-debug")
    linkArguments.push("-sASSERTIONS=0")
    linkArguments.push("-sMALLOC=emmalloc")
    linkArguments.push("-sSTANDALONE_WASM=1")
    linkArguments.push("--no-entry")
    linkArguments.push("-sFILESYSTEM=0")
    linkArguments.push("-sEXPORTED_FUNCTIONS=" + wasmExportList(wasmExportNames))
    for flag of native.linkerFlags { linkArguments.push(flag) }
  }
  linkArguments.push("-o")
  linkArguments.push(outputPath)
  return NativeCompilePlan { compiler, precompiledHeaderArguments, compileTasks, linkArguments, outputPath }
}

function copyArguments(source: string[]): string[] {
  let result: string[] = []
  for argument of source { result.push(argument) }
  return result
}

function copyNativeCompileArguments(source: string[], cSource: bool): string[] {
  let result: string[] = []
  for argument of source {
    if !cSource || argument != "-std=c++17" { result.push(argument) }
  }
  return result
}

function isCSource(path: string): bool {
  return path.toLowerCase().endsWith(".c")
}

/** Selects the C driver adjacent to the configured GCC-compatible C++ driver. */
function deriveCCompiler(compiler: string): string {
  if compiler == "em++" || compiler.endsWith("/em++") {
    return compiler.substring(0, compiler.length - 4) + "emcc"
  }
  if compiler == "g++" || compiler.endsWith("/g++") {
    return compiler.substring(0, compiler.length - 3) + "gcc"
  }
  if compiler == "c++" || compiler.endsWith("/c++") {
    return compiler.substring(0, compiler.length - 3) + "cc"
  }
  if compiler.endsWith("++") {
    return compiler.substring(0, compiler.length - 2)
  }
  return compiler
}

function wasmExportList(names: string[]): string {
  let result = "[\"_malloc\",\"_free\",\"_doof_free\""
  for name of names { result = result + ",\"_" + name + "\"" }
  return result + "]"
}

function appendObjectArguments(arguments: string[], sourcePath: string, outputPath: string): void {
  arguments.push("-c")
  arguments.push(sourcePath)
  arguments.push("-o")
  arguments.push(outputPath)
}

function usesClangPrecompiledHeader(compiler: string, platform: string): bool {
  name := compiler.toLowerCase()
  if name.contains("clang") { return true }
  if name.contains("g++") || name.contains("gcc") { return false }
  // The default c++ driver is Clang on Apple hosts and conventionally GCC on
  // other supported hosts. Explicit compiler names take precedence above.
  return platform == "macos"
}

function resolveBuildPath(outputDirectory: string, path: string): string {
  if path.startsWith("/") { return path }
  if outputDirectory.endsWith("/") { return outputDirectory + path }
  return outputDirectory + "/" + path
}
