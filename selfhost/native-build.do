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
): NativeCompilePlan {
  let arguments: string[] = ["-std=c++17"]
  for define of native.defines { arguments.push("-D" + define) }
  arguments.push("-I")
  arguments.push(outputDirectory)
  for includePath of native.includePaths {
    arguments.push("-I")
    arguments.push(resolveBuildPath(outputDirectory, includePath))
  }
  for flag of native.compilerFlags { arguments.push(flag) }
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
  return NativeCompilePlan { compiler, arguments, outputPath }
}

function resolveBuildPath(outputDirectory: string, path: string): string {
  if path.startsWith("/") { return path }
  if outputDirectory.endsWith("/") { return outputDirectory + path }
  return outputDirectory + "/" + path
}
