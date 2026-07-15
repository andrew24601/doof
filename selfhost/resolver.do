// Small, deterministic module-path resolver for the self-hosted compiler.
// Sources already present in memory are preferred, then the resolver asks its
// loader for a logical path and caches the answer. This keeps filesystem I/O
// outside the compiler while allowing analysis to discover only transitive
// dependencies.

import { Diagnostic, SourceFile } from "./semantic"

// A successful null means absence; filesystem and acquisition failures remain
// structured diagnostics rather than being collapsed into a missing module.
export type SourceLoader = (path: string): Result<SourceFile | null, Diagnostic>

export function noSourceLoader(path: string): Result<SourceFile | null, Diagnostic> => Success(null)

export class ModuleResolver {
  sources: SourceFile[]
  loader: SourceLoader
  loadedPaths: string[] = []
  failedPaths: string[] = []
  diagnostics: Diagnostic[] = []

  function find(path: string): SourceFile | null {
    for source of sources { if source.path == path { return source } }
    for loaded of loadedPaths { if loaded == path { return null } }
    loadedPaths.push(path)
    loaded := loader(path) else diagnostic {
      failedPaths.push(path)
      diagnostics.push(diagnostic)
      return null
    }
    if loaded != null {
      sources.push(loaded!)
      return loaded!
    }
    return null
  }

  function failed(path: string): bool {
    for failed of failedPaths { if failed == path { return true } }
    return false
  }

  function resolve(importer: string, specifier: string): string {
    base := if specifier.startsWith(".")
      then relativeBase(importer, specifier)
      else "/" + specifier
    exact := withExtension(base)
    if base.endsWith(".do") { return exact }
    if find(exact) != null { return exact }
    barrel := base + "/index.do"
    if find(barrel) != null { return barrel }
    return exact
  }
}

function withExtension(path: string): string {
  if path.endsWith(".do") { return path }
  return path + ".do"
}

function relativeBase(importer: string, specifier: string): string {
  let directory = parentDirectory(importer)
  let remaining = specifier
  while remaining.startsWith("../") {
    directory = parentDirectory(directory)
    remaining = remaining.substring(3, remaining.length)
  }
  while remaining.startsWith("./") {
    remaining = remaining.substring(2, remaining.length)
  }
  if directory == "/" { return "/" + remaining }
  return directory + "/" + remaining
}

function parentDirectory(path: string): string {
  let end = path.length - 1
  while end >= 0 && path[end] == '/' { end = end - 1 }
  while end >= 0 && path[end] != '/' { end = end - 1 }
  if end <= 0 { return "/" }
  return path.substring(0, end)
}
