// Immutable compiler-owned standard-package catalog parsing.

import { parseJsonValue } from "std/json"

export class StdCatalogPackage {
  name: string
  url: string
  ref: string
  version: string
  commit: string
}

export class StdCatalog {
  schemaVersion: int
  compilerVersion: string
  digest: string
  packages: StdCatalogPackage[]
}

export function canonicalDependencyUrl(value: string): string {
  let result = value.trim()
  while result.endsWith("/") { result = result.substring(0, result.length - 1) }
  if result.endsWith(".git") { result = result.substring(0, result.length - 4) }
  marker := result.indexOf("://")
  if marker < 0 { return result }
  scheme := result.substring(0, marker).toLowerCase()
  remainder := result.substring(marker + 3, result.length)
  slash := remainder.indexOf("/")
  if slash < 0 { return scheme + "://" + remainder.toLowerCase() }
  host := remainder.substring(0, slash).toLowerCase()
  return scheme + "://" + host + remainder.substring(slash, remainder.length)
}

export function parseStdCatalog(source: string): Result<StdCatalog, string> {
  try parsed := parseJsonValue(source)
  root := parsed as JsonObject else { return Failure("Invalid std catalog: root must be an object") }
  try schemaVersion := catalogInt(root, "schemaVersion")
  if schemaVersion != 1 { return Failure("Unsupported std catalog schema " + string(schemaVersion)) }
  try compilerVersion := catalogString(root, "compilerVersion")
  try digest := catalogString(root, "digest")
  if digest.length != 64 { return Failure("Invalid std catalog digest") }
  rawPackages := try! root.get("packages")
  packages := rawPackages as JsonValue[] else { return Failure("Invalid std catalog: packages must be an array") }
  let result: StdCatalogPackage[] = []
  let previous = ""
  for index of 0..<packages.length {
    object := packages[index] as JsonObject else { return Failure("Invalid std catalog package at index " + string(index)) }
    try name := catalogString(object, "name")
    try url := catalogString(object, "url")
    try ref := catalogString(object, "ref")
    try version := catalogString(object, "version")
    try commit := catalogString(object, "commit")
    if !name.startsWith("std/") || name.substring(4, name.length).contains("/") {
      return Failure("Invalid std catalog package name " + name)
    }
    if commit.length != 40 { return Failure("Invalid std catalog commit for " + name) }
    if previous != "" && name <= previous { return Failure("Std catalog packages must be sorted and unique") }
    previous = name
    result.push(StdCatalogPackage { name, url: canonicalDependencyUrl(url), ref, version, commit: commit.toLowerCase() })
  }
  return Success(StdCatalog { schemaVersion, compilerVersion, digest: digest.toLowerCase(), packages: result })
}

export function stdCatalogPackage(catalog: StdCatalog, name: string): StdCatalogPackage | null {
  for package of catalog.packages { if package.name == name { return package } }
  return null
}

function catalogString(object: JsonObject, name: string): Result<string, string> {
  value := object.get(name) else { return Failure("Invalid std catalog: " + name + " is required") }
  text := value as string else { return Failure("Invalid std catalog: " + name + " must be a string") }
  if text == "" { return Failure("Invalid std catalog: " + name + " must not be empty") }
  return Success(text)
}

function catalogInt(object: JsonObject, name: string): Result<int, string> {
  value := object.get(name) else { return Failure("Invalid std catalog: " + name + " is required") }
  number := value as int else { return Failure("Invalid std catalog: " + name + " must be an integer") }
  return Success(number)
}
