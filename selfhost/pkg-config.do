// pkg-config output interpretation for self-hosted native builds.
//
// Process execution remains in the driver. This module converts the bounded
// command result into normalized NativeBuildPlan inputs and stable diagnostics,
// which keeps both successful flag handling and failures directly testable.

import { NativeBuildPlan } from "./package-manifest"

/** Captured result of one `pkg-config --cflags/--libs` invocation. */
export class PkgConfigCommandResult {
  exitCode: int
  output: string = ""
  error: string = ""
}

/**
 * Applies one pkg-config result to a native plan.
 *
 * Recognized path, library, framework, and define flags join their structured
 * plan fields. Other flags remain compiler/linker arguments for fidelity with
 * package-specific metadata.
 */
export function applyPkgConfigResult(
  native: NativeBuildPlan,
  packageName: string,
  mode: string,
  result: PkgConfigCommandResult,
): Result<void, string> {
  if result.exitCode == -1 {
    detail := if result.error == "" then "the executable could not be started" else result.error
    return Failure(
      "Failed to run pkg-config while resolving package \"" + packageName + "\": " + detail +
      ". Install pkg-config, or remove the package from build.native.pkgConfigPackages.",
    )
  }
  if result.exitCode != 0 {
    detail := result.output.trim()
    suffix := if detail == "" then "" else ": " + detail
    return Failure(
      "pkg-config could not resolve package \"" + packageName + "\" (exit code " +
      string(result.exitCode) + ")" + suffix +
      ". Install the package metadata, or remove it from build.native.pkgConfigPackages.",
    )
  }

  applyPkgConfigTokens(native, pkgConfigTokens(result.output), mode)
  return Success()
}

function pkgConfigTokens(output: string): string[] {
  normalized := output.replaceAll("\n", " ").replaceAll("\r", " ").replaceAll("\t", " ")
  let tokens: string[] = []
  for token of normalized.split(" ") {
    if token != "" { tokens.push(token) }
  }
  return tokens
}

function applyPkgConfigTokens(native: NativeBuildPlan, tokens: string[], mode: string): void {
  let index = 0
  while index < tokens.length {
    token := tokens[index]
    if token == "-framework" {
      if index + 1 < tokens.length {
        appendUnique(native.frameworks, tokens[index + 1])
        index += 2
      } else {
        index += 1
      }
      continue
    }

    if token == "-I" || token == "-L" || token == "-D" {
      if index + 1 < tokens.length {
        value := tokens[index + 1]
        if token == "-I" { appendUnique(native.includePaths, value) }
        if token == "-L" { appendUnique(native.libraryPaths, value) }
        if token == "-D" { appendUnique(native.defines, value) }
        index += 2
      } else {
        index += 1
      }
      continue
    }

    if token.startsWith("-I") { appendUnique(native.includePaths, token.substring(2, token.length)) }
    else if token.startsWith("-L") { appendUnique(native.libraryPaths, token.substring(2, token.length)) }
    else if token.startsWith("-l") { appendUnique(native.linkLibraries, token.substring(2, token.length)) }
    else if token.startsWith("-D") { appendUnique(native.defines, token.substring(2, token.length)) }
    else if mode == "cflags" { appendUnique(native.compilerFlags, token) }
    else { appendUnique(native.linkerFlags, token) }
    index += 1
  }
}

function appendUnique(target: string[], value: string): void {
  for existing of target { if existing == value { return } }
  target.push(value)
}
