// Native compiler argument planning for materialized self-hosted projects.
//
// Project emission keeps native paths output-relative. This module owns the
// single transition to concrete disk paths and compiler command arguments,
// leaving process execution at the driver boundary.

import { ModuleEmission } from "./emitter-module"
import { NativeBuildPlan } from "./package-manifest"

/** A complete native compiler invocation for one emitted executable. */
export class NativeCompilePlan {
  compiler: string
  precompiledHeaderArguments: string[] = []
  arguments: string[] = []
  outputPath: string
}

/** Plans a GCC-compatible C++ compile and link invocation. */
export function planNativeCompile(
  compiler: string,
  outputDirectory: string,
  outputPath: string,
  modules: ModuleEmission[],
  native: NativeBuildPlan,
  release: bool = false,
  platform: string = "",
): NativeCompilePlan {
  let arguments: string[] = ["-std=c++17"]
  // Release defaults precede manifest flags so packages can intentionally
  // override optimization while still receiving the NDEBUG contract.
  if release {
    arguments.push("-O2")
    arguments.push("-DNDEBUG")
  }
  for define of native.defines { arguments.push("-D" + define) }
  arguments.push("-I")
  arguments.push(outputDirectory)
  for includePath of native.includePaths {
    arguments.push("-I")
    arguments.push(resolveBuildPath(outputDirectory, includePath))
  }
  for flag of native.compilerFlags { arguments.push(flag) }
  let precompiledHeaderArguments: string[] = []
  // The runtime dominates repeated parsing in larger generated projects. Build
  // it once, but avoid paying the PCH startup cost for a single module.
  if modules.length > 1 {
    runtimeHeader := resolveBuildPath(outputDirectory, "doof_runtime.hpp")
    clangPch := usesClangPrecompiledHeader(compiler, platform)
    pchPath := runtimeHeader + if clangPch then ".pch" else ".gch"
    for argument of arguments { precompiledHeaderArguments.push(argument) }
    precompiledHeaderArguments.push("-x")
    precompiledHeaderArguments.push("c++-header")
    precompiledHeaderArguments.push(runtimeHeader)
    precompiledHeaderArguments.push("-o")
    precompiledHeaderArguments.push(pchPath)
    // GCC discovers an adjacent .gch when the header is the first include.
    // Clang's explicit flag is more reliable for arbitrary output paths.
    if clangPch {
      arguments.push("-include-pch")
      arguments.push(pchPath)
    }
  }
  for module of modules {
    arguments.push(resolveBuildPath(outputDirectory, module.sourceName))
  }
  for sourcePath of native.sourceFiles {
    arguments.push(resolveBuildPath(outputDirectory, sourcePath))
  }
  for libraryPath of native.libraryPaths {
    arguments.push("-L" + resolveBuildPath(outputDirectory, libraryPath))
  }
  for library of native.linkLibraries { arguments.push("-l" + library) }
  for framework of native.frameworks {
    arguments.push("-framework")
    arguments.push(framework)
  }
  for flag of native.linkerFlags { arguments.push(flag) }
  arguments.push("-o")
  arguments.push(outputPath)
  return NativeCompilePlan { compiler, precompiledHeaderArguments, arguments, outputPath }
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
