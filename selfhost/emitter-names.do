// Stable generated names for the self-hosted module graph.
//
// These names are derived from logical source paths, never from traversal
// order, so later split-module emission can preserve an ABI across builds.

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
  return "app_" + moduleStem(path) + "_"
}

export function moduleHeaderName(path: string): string {
  return moduleStem(path) + ".hpp"
}

export function moduleSourceName(path: string): string {
  return moduleStem(path) + ".cpp"
}
