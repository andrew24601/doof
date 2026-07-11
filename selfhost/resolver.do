// Small, deterministic module-path resolver for the self-hosted compiler.
// The caller supplies source files, which keeps this layer easy to test and
// lets a future driver replace the in-memory source list with filesystem I/O.

import { SourceFile } from "./semantic"

export class ModuleResolver {
  sources: SourceFile[]

  function find(path: string): SourceFile | null {
    for source of sources { if source.path == path { return source } }
    return null
  }

  function resolve(importer: string, specifier: string): string {
    if !specifier.startsWith(".") { return withExtension(specifier) }

    let directory = parentDirectory(importer)
    let remaining = specifier
    while remaining.startsWith("../") {
      directory = parentDirectory(directory)
      remaining = remaining.substring(3, remaining.length)
    }
    while remaining.startsWith("./") {
      remaining = remaining.substring(2, remaining.length)
    }
    if directory == "/" { return withExtension("/" + remaining) }
    return withExtension(directory + "/" + remaining)
  }
}

function withExtension(path: string): string {
  if path.endsWith(".do") { return path }
  return path + ".do"
}

function parentDirectory(path: string): string {
  let end = path.length - 1
  while end >= 0 && path[end] == '/' { end = end - 1 }
  while end >= 0 && path[end] != '/' { end = end - 1 }
  if end <= 0 { return "/" }
  return path.substring(0, end)
}
