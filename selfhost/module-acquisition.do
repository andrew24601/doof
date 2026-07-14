// Logical-module acquisition roots for the self-hosted compiler driver.
//
// Resolution decides which logical path an import denotes. Acquisition maps
// that path to a disk folder supplied by the environment today and by a future
// package cache or Git provider. Longest-prefix matching lets an individual
// package override a broader root without changing resolver behavior.

/** Maps a logical module namespace to a provider-owned disk folder. */
export class ModuleAcquisition {
  logicalPrefix: string
  diskRoot: string
}

/** Returns the package-specific acquisition that owns a logical module path. */
export function acquiredPackageForModule(logicalPath: string, acquisitions: ModuleAcquisition[]): ModuleAcquisition | null {
  selected := selectedAcquisition(logicalPath, acquisitions)
  if selected == null { return null }

  let suffix = logicalPath.substring(selected!.logicalPrefix.length, logicalPath.length)
  while suffix.startsWith("/") { suffix = suffix.substring(1, suffix.length) }
  if suffix == "" { return selected }

  let separator = -1
  let index = 0
  while index < suffix.length {
    if suffix[index] == '/' {
      separator = index
      break
    }
    index = index + 1
  }
  if separator < 0 { return selected }
  packageName := suffix.substring(0, separator)
  if packageName == "" { return selected }
  return ModuleAcquisition {
    logicalPrefix: acquisitionJoinPath(selected!.logicalPrefix, packageName),
    diskRoot: acquisitionJoinPath(selected!.diskRoot, packageName),
  }
}

/** Resolves a logical source path through the most-specific acquired prefix. */
export function acquiredModuleDiskPath(logicalPath: string, acquisitions: ModuleAcquisition[]): string | null {
  selected := selectedAcquisition(logicalPath, acquisitions)
  if selected == null { return null }

  let suffix = logicalPath.substring(selected!.logicalPrefix.length, logicalPath.length)
  if suffix.startsWith("/") { suffix = suffix.substring(1, suffix.length) }
  return acquisitionJoinPath(selected!.diskRoot, suffix)
}

/** Returns the package manifest beside an acquired package root. */
export function acquiredManifestPath(acquisition: ModuleAcquisition): string {
  return acquisitionJoinPath(acquisition.diskRoot, "doof.json")
}

function acquisitionMatches(prefix: string, logicalPath: string): bool {
  return logicalPath == prefix || logicalPath.startsWith(prefix + "/")
}

function selectedAcquisition(logicalPath: string, acquisitions: ModuleAcquisition[]): ModuleAcquisition | null {
  let selected: ModuleAcquisition | null = null
  for acquisition of acquisitions {
    if acquisitionMatches(acquisition.logicalPrefix, logicalPath) {
      if selected == null || acquisition.logicalPrefix.length > selected!.logicalPrefix.length {
        selected = acquisition
      }
    }
  }
  return selected
}

function acquisitionJoinPath(directory: string, suffix: string): string {
  if suffix == "" { return directory }
  if directory.endsWith("/") { return directory + suffix }
  return directory + "/" + suffix
}
