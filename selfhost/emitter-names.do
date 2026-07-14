// Stable generated names for the self-hosted module graph.
//
// These names are derived from logical source paths, never from traversal
// order, so later split-module emission can preserve an ABI across builds.

/** Maps a logical source prefix to the owning package's public C++ namespace. */
export class ModuleNamespaceMapping {
  logicalPrefix: string
  packageName: string
}

let configuredModuleNamespaceMappings: ModuleNamespaceMapping[] = []

/** Replaces the package ownership used by the next module-graph emission. */
export function configureModuleNamespaces(mappings: ModuleNamespaceMapping[]): void {
  configuredModuleNamespaceMappings = mappings
}

export function moduleStem(path: string): string {
  normalized := path.replaceAll("\\", "/")
  // Keep this path-only until the self-host runtime grows string split and
  // indexing helpers. A bounded substring removes the logical root without
  // depending on string length inference in the self-host checker.
  withoutRoot := if normalized.startsWith("/") then normalized.substring(1, 1000000) else normalized
  result := withoutRoot.replaceAll("/", "_").replaceAll(".do", "")
    .replaceAll("-", "_").replaceAll(".", "_")
  return if result == "" then "module" else result
}

export function moduleNamespace(path: string): string {
  mapping := namespaceMappingForPath(path)
  if mapping != null {
    let relativePath = path.substring(mapping!.logicalPrefix.length, path.length)
    while relativePath.startsWith("/") {
      relativePath = relativePath.substring(1, relativePath.length)
    }
    if relativePath.endsWith(".do") {
      relativePath = relativePath.substring(0, relativePath.length - 3)
    }
    let namespace = namespacePath(mapping!.packageName)
    if relativePath != "" { namespace = namespace + "::" + namespacePath(relativePath) }
    return namespace
  }
  return "app_" + moduleStem(path) + "_"
}

function namespaceMappingForPath(path: string): ModuleNamespaceMapping | null {
  let selected: ModuleNamespaceMapping | null = null
  for mapping of configuredModuleNamespaceMappings {
    if path == mapping.logicalPrefix || path.startsWith(mapping.logicalPrefix + "/") {
      if selected == null || mapping.logicalPrefix.length > selected!.logicalPrefix.length {
        selected = mapping
      }
    }
  }
  return selected
}

function namespacePath(path: string): string {
  components := path.replaceAll("\\", "/").split("/")
  let result = ""
  for component of components {
    if component == "" { continue }
    sanitized := namespaceComponent(component)
    if result == "" { result = sanitized }
    else { result = result + "::" + sanitized }
  }
  return if result == "" then "module" else result
}

function namespaceComponent(value: string): string {
  result := value.replaceAll("-", "_").replaceAll(".", "_")
  if result == "std" || result == "doof" || result == "main" { return result + "_" }
  return result
}

export function moduleHeaderName(path: string): string {
  return moduleStem(path) + ".hpp"
}

export function moduleSourceName(path: string): string {
  return moduleStem(path) + ".cpp"
}
