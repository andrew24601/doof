// Focused doof.json parsing for self-hosted package and native-build planning.
//
// Paths are normalized against the owning package root as manifests are read.
// The resulting model is independent of output materialization and native
// compiler invocation, which remain later project-planning stages.

import { parseJsonValue } from "std/json"
import { join } from "std/path"
import { MacOSAppConfig, MacOSAppResource, MacOSEmbeddedLibrary, MacOSPackageConfig } from "./macos-app"
import { IOSAppConfig, IOSAppResource, IOSEmbeddedLibrary, IOSPackageConfig } from "./ios-app"

function manifestJoinPath(directory: string, name: string): string => join([directory, name])
function manifestJsonField(object: JsonObject, name: string): JsonValue => try! object.get(name)
function manifestJsonHas(object: JsonObject, name: string): bool => object.has(name)

/** Normalized native inputs contributed by one or more reached packages. */
export class NativeBuildPlan {
  includePaths: string[] = []
  sourceFiles: string[] = []
  libraryPaths: string[] = []
  extraCopyPaths: string[] = []
  linkLibraries: string[] = []
  frameworks: string[] = []
  pkgConfigPackages: string[] = []
  defines: string[] = []
  compilerFlags: string[] = []
  linkerFlags: string[] = []
}

/** One root-package resource copied beside a command-line executable. */
export class PackageResource {
  sourcePath: string
  destination: string
}

/** Package identity and native inputs parsed from a single doof.json. */
export class PackageManifest {
  name: string
  version: string = "1.0"
  manifestPath: string
  rootDirectory: string
  resources: PackageResource[] = []
  nativeBuild: NativeBuildPlan
  target: string = ""
  macosApp: MacOSAppConfig | null = null
  iosApp: IOSAppConfig | null = null
  packageConfig: MacOSPackageConfig | null = null
  iosPackageConfig: IOSPackageConfig | null = null
}

/** Parses package identity and host-platform native inputs from doof.json. */
export function parsePackageManifest(
  source: string,
  manifestPath: string,
  rootDirectory: string,
  platform: string,
): Result<PackageManifest, string> {
  try parsed := parseJsonValue(source)
  try root := manifestObject(parsed, manifestPath, "root")

  let name = ""
  if manifestJsonHas(root, "name") {
    try parsedName := manifestString(manifestJsonField(root, "name"), manifestPath, "name")
    name = parsedName
  }

  let version = "1.0"
  if manifestJsonHas(root, "version") {
    try parsedVersion := manifestString(manifestJsonField(root, "version"), manifestPath, "version")
    version = parsedVersion
  }

  try resources := parseManifestResources(root, manifestPath, rootDirectory)
  try target := parseManifestTarget(root, manifestPath)
  try nativeBuild := parseManifestNativeBuild(root, manifestPath, rootDirectory, platform)
  try macosApp := parseMacOSApp(root, manifestPath, rootDirectory, name, version, target)
  try iosApp := parseIOSApp(root, manifestPath, rootDirectory, name, version, target)
  try packageConfig := parseMacOSPackage(root, manifestPath, rootDirectory)
  try iosPackageConfig := parseIOSPackage(root, manifestPath, rootDirectory)
  return Success(PackageManifest {
    name, version, manifestPath, rootDirectory, resources, nativeBuild, target, macosApp, iosApp,
    packageConfig, iosPackageConfig,
  })
}

/** Merges normalized package plans while preserving first-seen ordering. */
export function mergeNativeBuildPlans(plans: NativeBuildPlan[]): NativeBuildPlan {
  merged := NativeBuildPlan {}
  for plan of plans { appendNativeBuild(merged, plan) }
  return merged
}

function parseManifestNativeBuild(
  root: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  platform: string,
): Result<NativeBuildPlan, string> {
  result := NativeBuildPlan {}
  if !manifestJsonHas(root, "build") { return Success(result) }
  try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
  if !manifestJsonHas(build, "native") { return Success(result) }
  try native := manifestObject(manifestJsonField(build, "native"), manifestPath, "build.native")

  try appendNativeFragment(result, native, manifestPath, rootDirectory, "build.native")
  platformKey := if platform == "ios-simulator" then "iosSimulator" else if platform == "ios-device" then "iosDevice" else platform
  if platformKey != "" && manifestJsonHas(native, platformKey) {
    try platformValue := manifestObject(
      manifestJsonField(native, platformKey),
      manifestPath,
      "build.native." + platformKey,
    )
    try appendNativeFragment(result, platformValue, manifestPath, rootDirectory, "build.native." + platformKey)
  }
  return Success(result)
}

function parseManifestResources(
  root: JsonObject,
  manifestPath: string,
  rootDirectory: string,
): Result<PackageResource[], string> {
  if manifestJsonHas(root, "resources") {
    return parseResourceArray(manifestJsonField(root, "resources"), manifestPath, rootDirectory, "resources")
  }
  if manifestJsonHas(root, "build") {
    try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
    if manifestJsonHas(build, "resources") {
      return parseResourceArray(
        manifestJsonField(build, "resources"),
        manifestPath,
        rootDirectory,
        "build.resources",
      )
    }
  }
  return Success([])
}

function parseManifestTarget(root: JsonObject, manifestPath: string): Result<string, string> {
  if manifestJsonHas(root, "target") {
    return manifestString(manifestJsonField(root, "target"), manifestPath, "target")
  }
  if manifestJsonHas(root, "build") {
    try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
    if manifestJsonHas(build, "target") {
      return manifestString(manifestJsonField(build, "target"), manifestPath, "build.target")
    }
  }
  return Success("")
}

function parseMacOSApp(
  root: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  packageName: string,
  packageVersion: string,
  target: string,
): Result<MacOSAppConfig | null, string> {
  if target != "macos-app" { return Success(null) }
  let build: JsonObject = {}
  if manifestJsonHas(root, "build") {
    try parsedBuild := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
    build = parsedBuild
  }
  let nested: JsonObject = {}
  if manifestJsonHas(build, "macosApp") {
    try parsedNested := manifestObject(manifestJsonField(build, "macosApp"), manifestPath, "build.macosApp")
    nested = parsedNested
  }

  try executableName := firstManifestString(
    root, "executable", build, "executable", build, "targetExecutableName", packageName,
    manifestPath, "executable",
  )
  if executableName == "" || executableName.contains("/") || executableName.contains("\\") {
    return Failure("Invalid doof.json at " + manifestPath + ": executable must be a file name without path separators")
  }
  defaultBundleId := "dev.doof." + sanitizeBundleName(if packageName == "" then executableName else packageName)
  try bundleId := firstManifestString(root, "id", nested, "bundleId", build, "id", defaultBundleId, manifestPath, "build.macosApp.bundleId")
  try displayName := firstManifestString(root, "title", nested, "displayName", build, "title", if packageName == "" then executableName else packageName, manifestPath, "build.macosApp.displayName")
  try version := optionalManifestString(nested, "version", packageVersion, manifestPath, "build.macosApp.version")
  try category := optionalManifestString(nested, "category", "public.app-category.developer-tools", manifestPath, "build.macosApp.category")
  try minimumSystemVersion := optionalManifestString(nested, "minimumSystemVersion", "11.0", manifestPath, "build.macosApp.minimumSystemVersion")

  let icon = ""
  if manifestJsonHas(root, "icon") {
    try parsed := manifestString(manifestJsonField(root, "icon"), manifestPath, "icon")
    icon = parsed
  } else if manifestJsonHas(nested, "icon") {
    try parsed := manifestString(manifestJsonField(nested, "icon"), manifestPath, "build.macosApp.icon")
    icon = parsed
  } else if manifestJsonHas(build, "icon") {
    try parsed := manifestString(manifestJsonField(build, "icon"), manifestPath, "build.icon")
    icon = parsed
  }
  let iconPath = ""
  if icon != "" {
    if !icon.toLowerCase().endsWith(".png") {
      return Failure("Invalid doof.json at " + manifestPath + ": build.macosApp.icon must point to a PNG file")
    }
    iconPath = manifestJoinPath(rootDirectory, icon)
    if !manifestPathWithinRoot(iconPath, rootDirectory) {
      return Failure("Invalid doof.json at " + manifestPath + ": build.macosApp.icon must stay within the package root")
    }
  }

  let infoPlist: JsonObject | null = null
  if manifestJsonHas(nested, "infoPlist") {
    try parsedInfo := manifestObject(manifestJsonField(nested, "infoPlist"), manifestPath, "build.macosApp.infoPlist")
    for key, ignored of parsedInfo {
      if isManagedMacOSPlistKey(key) {
        return Failure("Invalid doof.json at " + manifestPath + ": build.macosApp.infoPlist." + key + " conflicts with a Doof-managed Info.plist key")
      }
    }
    infoPlist = parsedInfo
  }

  let resourceValue: JsonValue | null = null
  let resourceField = "build.macosApp.resources"
  if manifestJsonHas(root, "resources") {
    resourceValue = manifestJsonField(root, "resources")
    resourceField = "resources"
  } else if manifestJsonHas(nested, "resources") {
    resourceValue = manifestJsonField(nested, "resources")
  } else if manifestJsonHas(build, "resources") {
    resourceValue = manifestJsonField(build, "resources")
    resourceField = "build.resources"
  }
  let resources: MacOSAppResource[] = []
  if resourceValue != null {
    try parsedResources := parseResourceArray(resourceValue!, manifestPath, rootDirectory, resourceField)
    for resource of parsedResources {
      resources.push(MacOSAppResource { sourcePath: resource.sourcePath, destination: resource.destination })
    }
  }

  let embeddedLibraries: MacOSEmbeddedLibrary[] = []
  if manifestJsonHas(nested, "embeddedLibraries") {
    try entries := manifestArray(manifestJsonField(nested, "embeddedLibraries"), manifestPath, "build.macosApp.embeddedLibraries")
    for index of 0..<entries.length {
      try entry := manifestObject(entries[index], manifestPath, "build.macosApp.embeddedLibraries[" + string(index) + "]")
      hasLibrary := manifestJsonHas(entry, "library")
      hasPath := manifestJsonHas(entry, "path")
      if hasLibrary == hasPath {
        return Failure("Invalid doof.json at " + manifestPath + ": build.macosApp.embeddedLibraries[" + string(index) + "] requires exactly one of library or path")
      }
      if hasLibrary {
        try library := manifestString(manifestJsonField(entry, "library"), manifestPath, "build.macosApp.embeddedLibraries[" + string(index) + "].library")
        if library == "" || library.contains("/") || library.contains("\\") {
          return Failure("Invalid doof.json at " + manifestPath + ": embedded linked library names must not contain path separators")
        }
        embeddedLibraries.push(MacOSEmbeddedLibrary { library })
      } else {
        try path := manifestString(manifestJsonField(entry, "path"), manifestPath, "build.macosApp.embeddedLibraries[" + string(index) + "].path")
        resolvedPath := manifestJoinPath(rootDirectory, path)
        if !manifestPathWithinRoot(resolvedPath, rootDirectory) {
          return Failure("Invalid doof.json at " + manifestPath + ": build.macosApp.embeddedLibraries[" + string(index) + "].path must stay within the package root")
        }
        if !resolvedPath.endsWith(".dylib") && !resolvedPath.endsWith(".so") && !resolvedPath.endsWith(".framework") {
          return Failure("Invalid doof.json at " + manifestPath + ": embedded library paths must be .dylib, .so, or .framework")
        }
        embeddedLibraries.push(MacOSEmbeddedLibrary { path: resolvedPath })
      }
    }
  }

  return Success(MacOSAppConfig {
    executableName, bundleId, displayName, version, iconPath, infoPlist, resources, embeddedLibraries,
    category, minimumSystemVersion,
  })
}

function parseIOSApp(
  root: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  packageName: string,
  packageVersion: string,
  target: string,
): Result<IOSAppConfig | null, string> {
  if target != "ios-app" { return Success(null) }
  let build: JsonObject = {}
  if manifestJsonHas(root, "build") {
    try parsedBuild := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
    build = parsedBuild
  }
  let nested: JsonObject = {}
  if manifestJsonHas(build, "iosApp") {
    try parsedNested := manifestObject(manifestJsonField(build, "iosApp"), manifestPath, "build.iosApp")
    nested = parsedNested
  }

  try executableName := firstManifestString(
    root, "executable", build, "executable", build, "targetExecutableName", packageName,
    manifestPath, "executable",
  )
  if executableName == "" || executableName.contains("/") || executableName.contains("\\") {
    return Failure("Invalid doof.json at " + manifestPath + ": executable must be a file name without path separators")
  }
  defaultBundleId := "dev.doof." + sanitizeBundleName(if packageName == "" then executableName else packageName)
  try bundleId := firstManifestString(root, "id", nested, "bundleId", build, "id", defaultBundleId, manifestPath, "build.iosApp.bundleId")
  try displayName := firstManifestString(root, "title", nested, "displayName", build, "title", if packageName == "" then executableName else packageName, manifestPath, "build.iosApp.displayName")
  try version := optionalManifestString(nested, "version", packageVersion, manifestPath, "build.iosApp.version")
  try minimumDeploymentTarget := optionalManifestString(nested, "minimumDeploymentTarget", "16.0", manifestPath, "build.iosApp.minimumDeploymentTarget")

  let icon = ""
  if manifestJsonHas(root, "icon") {
    try parsed := manifestString(manifestJsonField(root, "icon"), manifestPath, "icon")
    icon = parsed
  } else if manifestJsonHas(nested, "icon") {
    try parsed := manifestString(manifestJsonField(nested, "icon"), manifestPath, "build.iosApp.icon")
    icon = parsed
  } else if manifestJsonHas(build, "icon") {
    try parsed := manifestString(manifestJsonField(build, "icon"), manifestPath, "build.icon")
    icon = parsed
  }
  let iconPath = ""
  if icon != "" {
    if !icon.toLowerCase().endsWith(".png") {
      return Failure("Invalid doof.json at " + manifestPath + ": build.iosApp.icon must point to a PNG file")
    }
    iconPath = manifestJoinPath(rootDirectory, icon)
    if !manifestPathWithinRoot(iconPath, rootDirectory) {
      return Failure("Invalid doof.json at " + manifestPath + ": build.iosApp.icon must stay within the package root")
    }
  }

  let infoPlist: JsonObject | null = null
  if manifestJsonHas(nested, "infoPlist") {
    try parsedInfo := manifestObject(manifestJsonField(nested, "infoPlist"), manifestPath, "build.iosApp.infoPlist")
    for key, ignored of parsedInfo {
      if isManagedIOSPlistKey(key) {
        return Failure("Invalid doof.json at " + manifestPath + ": build.iosApp.infoPlist." + key + " conflicts with a Doof-managed Info.plist key")
      }
    }
    infoPlist = parsedInfo
  }

  let resourceValue: JsonValue | null = null
  let resourceField = "build.iosApp.resources"
  if manifestJsonHas(root, "resources") {
    resourceValue = manifestJsonField(root, "resources")
    resourceField = "resources"
  } else if manifestJsonHas(nested, "resources") {
    resourceValue = manifestJsonField(nested, "resources")
  } else if manifestJsonHas(build, "resources") {
    resourceValue = manifestJsonField(build, "resources")
    resourceField = "build.resources"
  }
  let resources: IOSAppResource[] = []
  if resourceValue != null {
    try parsedResources := parseResourceArray(resourceValue!, manifestPath, rootDirectory, resourceField)
    for resource of parsedResources {
      resources.push(IOSAppResource { sourcePath: resource.sourcePath, destination: resource.destination })
    }
  }

  let embeddedLibraries: IOSEmbeddedLibrary[] = []
  if manifestJsonHas(nested, "embeddedLibraries") {
    try entries := manifestArray(manifestJsonField(nested, "embeddedLibraries"), manifestPath, "build.iosApp.embeddedLibraries")
    for index of 0..<entries.length {
      field := "build.iosApp.embeddedLibraries[" + string(index) + "]"
      try entry := manifestObject(entries[index], manifestPath, field)
      hasLibrary := manifestJsonHas(entry, "library")
      hasPath := manifestJsonHas(entry, "path")
      if hasLibrary == hasPath { return Failure("Invalid doof.json at " + manifestPath + ": " + field + " requires exactly one of library or path") }
      if hasLibrary {
        try library := manifestString(manifestJsonField(entry, "library"), manifestPath, field + ".library")
        if library == "" || library.contains("/") || library.contains("\\") {
          return Failure("Invalid doof.json at " + manifestPath + ": embedded linked library names must not contain path separators")
        }
        embeddedLibraries.push(IOSEmbeddedLibrary { library })
      } else {
        try path := manifestString(manifestJsonField(entry, "path"), manifestPath, field + ".path")
        resolvedPath := manifestJoinPath(rootDirectory, path)
        if !manifestPathWithinRoot(resolvedPath, rootDirectory) {
          return Failure("Invalid doof.json at " + manifestPath + ": " + field + ".path must stay within the package root")
        }
        if !resolvedPath.endsWith(".dylib") && !resolvedPath.endsWith(".so") && !resolvedPath.endsWith(".framework") {
          return Failure("Invalid doof.json at " + manifestPath + ": embedded library paths must be .dylib, .so, or .framework")
        }
        embeddedLibraries.push(IOSEmbeddedLibrary { path: resolvedPath })
      }
    }
  }

  return Success(IOSAppConfig {
    executableName, bundleId, displayName, version, iconPath, infoPlist, resources,
    embeddedLibraries, minimumDeploymentTarget,
  })
}

function parseMacOSPackage(root: JsonObject, manifestPath: string, rootDirectory: string): Result<MacOSPackageConfig, string> {
  let distDirectory = manifestJoinPath(rootDirectory, "dist")
  let signing = "developer-id"
  let identity = ""
  let sandbox = false
  let entitlementsPath = ""
  if !manifestJsonHas(root, "build") {
    return Success(MacOSPackageConfig { distDirectory, signing, identity, sandbox, entitlementsPath })
  }
  try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
  if !manifestJsonHas(build, "package") {
    return Success(MacOSPackageConfig { distDirectory, signing, identity, sandbox, entitlementsPath })
  }
  try package := manifestObject(manifestJsonField(build, "package"), manifestPath, "build.package")
  if manifestJsonHas(package, "distDir") {
    try value := manifestString(manifestJsonField(package, "distDir"), manifestPath, "build.package.distDir")
    distDirectory = manifestJoinPath(rootDirectory, value)
    if !manifestPathWithinRoot(distDirectory, rootDirectory) {
      return Failure("Invalid doof.json at " + manifestPath + ": build.package.distDir must stay within the package root")
    }
  }
  if manifestJsonHas(package, "macos") {
    try macos := manifestObject(manifestJsonField(package, "macos"), manifestPath, "build.package.macos")
    if manifestJsonHas(macos, "signing") {
      try value := manifestString(manifestJsonField(macos, "signing"), manifestPath, "build.package.macos.signing")
      if value != "developer-id" && value != "ad-hoc" {
        return Failure("Invalid doof.json at " + manifestPath + ": build.package.macos.signing must be one of \"developer-id\", \"ad-hoc\"")
      }
      signing = value
    }
    if manifestJsonHas(macos, "identity") {
      try value := manifestString(manifestJsonField(macos, "identity"), manifestPath, "build.package.macos.identity")
      identity = value
    }
    if manifestJsonHas(macos, "sandbox") {
      case manifestJsonField(macos, "sandbox") {
        value: bool -> { sandbox = value },
        _ -> { return Failure("Invalid doof.json at " + manifestPath + ": build.package.macos.sandbox must be a boolean") }
      }
    }
    if manifestJsonHas(macos, "entitlements") {
      try value := manifestString(manifestJsonField(macos, "entitlements"), manifestPath, "build.package.macos.entitlements")
      entitlementsPath = manifestJoinPath(rootDirectory, value)
      if !manifestPathWithinRoot(entitlementsPath, rootDirectory) {
        return Failure("Invalid doof.json at " + manifestPath + ": build.package.macos.entitlements must stay within the package root")
      }
    }
  }
  return Success(MacOSPackageConfig { distDirectory, signing, identity, sandbox, entitlementsPath })
}

function parseIOSPackage(root: JsonObject, manifestPath: string, rootDirectory: string): Result<IOSPackageConfig, string> {
  let identity = ""
  let provisioningProfilePath = ""
  if !manifestJsonHas(root, "build") { return Success(IOSPackageConfig {}) }
  try build := manifestObject(manifestJsonField(root, "build"), manifestPath, "build")
  if !manifestJsonHas(build, "package") { return Success(IOSPackageConfig {}) }
  try package := manifestObject(manifestJsonField(build, "package"), manifestPath, "build.package")
  if !manifestJsonHas(package, "ios") { return Success(IOSPackageConfig {}) }
  try ios := manifestObject(manifestJsonField(package, "ios"), manifestPath, "build.package.ios")
  if manifestJsonHas(ios, "identity") {
    try value := manifestString(manifestJsonField(ios, "identity"), manifestPath, "build.package.ios.identity")
    identity = value
  }
  if manifestJsonHas(ios, "provisioningProfile") {
    try value := manifestString(manifestJsonField(ios, "provisioningProfile"), manifestPath, "build.package.ios.provisioningProfile")
    provisioningProfilePath = manifestJoinPath(rootDirectory, value)
    if !manifestPathWithinRoot(provisioningProfilePath, rootDirectory) {
      return Failure("Invalid doof.json at " + manifestPath + ": build.package.ios.provisioningProfile must stay within the package root")
    }
  }
  return Success(IOSPackageConfig { identity, provisioningProfilePath })
}

function optionalManifestString(object: JsonObject, key: string, fallback: string, manifestPath: string, fieldPath: string): Result<string, string> {
  if !manifestJsonHas(object, key) { return Success(fallback) }
  return manifestString(manifestJsonField(object, key), manifestPath, fieldPath)
}

function firstManifestString(
  first: JsonObject, firstKey: string,
  second: JsonObject, secondKey: string,
  third: JsonObject, thirdKey: string,
  fallback: string,
  manifestPath: string,
  fieldPath: string,
): Result<string, string> {
  if manifestJsonHas(first, firstKey) { return manifestString(manifestJsonField(first, firstKey), manifestPath, firstKey) }
  if manifestJsonHas(second, secondKey) { return manifestString(manifestJsonField(second, secondKey), manifestPath, fieldPath) }
  if manifestJsonHas(third, thirdKey) { return manifestString(manifestJsonField(third, thirdKey), manifestPath, thirdKey) }
  return Success(fallback)
}

function sanitizeBundleName(value: string): string {
  readonly allowed = "abcdefghijklmnopqrstuvwxyz0123456789-"
  let result = ""
  lower := value.toLowerCase()
  for index of 0..<lower.length {
    text := lower.substring(index, index + 1)
    result = result + if allowed.contains(text) then text else "-"
  }
  while result.startsWith("-") { result = result.substring(1, result.length) }
  while result.endsWith("-") { result = result.substring(0, result.length - 1) }
  return if result == "" then "app" else result
}

function manifestPathWithinRoot(path: string, rootDirectory: string): bool {
  boundary := if rootDirectory.endsWith("/") then rootDirectory else rootDirectory + "/"
  return path == rootDirectory || path.startsWith(boundary)
}

function isManagedMacOSPlistKey(key: string): bool {
  readonly keys = [
    "CFBundleDevelopmentRegion", "CFBundleDisplayName", "CFBundleExecutable", "CFBundleIconFile",
    "CFBundleIdentifier", "CFBundleInfoDictionaryVersion", "CFBundleName", "CFBundlePackageType",
    "CFBundleShortVersionString", "CFBundleVersion", "LSApplicationCategoryType", "LSMinimumSystemVersion",
    "NSHighResolutionCapable", "NSPrincipalClass",
  ]
  return keys.contains(key)
}

function isManagedIOSPlistKey(key: string): bool {
  readonly keys = [
    "CFBundleDevelopmentRegion", "CFBundleDisplayName", "CFBundleExecutable", "CFBundleIdentifier",
    "CFBundleInfoDictionaryVersion", "CFBundleName", "CFBundlePackageType", "CFBundleShortVersionString",
    "CFBundleVersion", "LSRequiresIPhoneOS", "MinimumOSVersion", "UIDeviceFamily",
    "UILaunchStoryboardName", "UIApplicationSceneManifest",
  ]
  return keys.contains(key)
}

function parseResourceArray(
  value: JsonValue,
  manifestPath: string,
  rootDirectory: string,
  fieldPath: string,
): Result<PackageResource[], string> {
  try entries := manifestArray(value, manifestPath, fieldPath)
  let resources: PackageResource[] = []
  for index of 0..<entries.length {
    let source = ""
    let destination = ""
    case entries[index] {
      text: string -> {
        if text == "" {
          return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + "[" + string(index) + "] must not be empty")
        }
        source = text
        destination = text
      }
      object: JsonObject -> {
        if !manifestJsonHas(object, "from") || !manifestJsonHas(object, "to") {
          return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + "[" + string(index) + "] requires string fields from and to")
        }
        try parsedSource := manifestString(
          manifestJsonField(object, "from"),
          manifestPath,
          fieldPath + "[" + string(index) + "].from",
        )
        try parsedDestination := manifestString(
          manifestJsonField(object, "to"),
          manifestPath,
          fieldPath + "[" + string(index) + "].to",
        )
        source = parsedSource
        destination = parsedDestination
      }
      _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + "[" + string(index) + "] must be a string or object")
    }

    sourcePath := manifestJoinPath(rootDirectory, source)
    rootBoundary := if rootDirectory.endsWith("/") then rootDirectory else rootDirectory + "/"
    if sourcePath != rootDirectory && !sourcePath.startsWith(rootBoundary) {
      return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + "[" + string(index) + "].from must stay within the package root")
    }
    try normalizedDestination := normalizeResourceDestination(
      destination,
      manifestPath,
      fieldPath + "[" + string(index) + "].to",
    )
    resources.push(PackageResource { sourcePath, destination: normalizedDestination })
  }
  return Success(resources)
}

function normalizeResourceDestination(
  destination: string,
  manifestPath: string,
  fieldPath: string,
): Result<string, string> {
  portable := destination.replaceAll("\\", "/")
  if portable.startsWith("/") || (portable.length >= 3 && portable[1] == ':' && portable[2] == '/') {
    return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be relative")
  }

  let segments: string[] = []
  for segment of portable.split("/") {
    if segment == "" || segment == "." { continue }
    if segment == ".." {
      if segments.length == 0 {
        return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must stay within the executable resource directory")
      }
      ignored := try! segments.pop()
      continue
    }
    segments.push(segment)
  }
  let normalized = ""
  for segment of segments {
    if normalized != "" { normalized = normalized + "/" }
    normalized = normalized + segment
  }
  return Success(normalized)
}

function appendNativeFragment(
  target: NativeBuildPlan,
  fragment: JsonObject,
  manifestPath: string,
  rootDirectory: string,
  fieldPath: string,
): Result<void, string> {
  try appendStringArrayField(target.includePaths, fragment, "includePaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.sourceFiles, fragment, "sourceFiles", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.libraryPaths, fragment, "libraryPaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.extraCopyPaths, fragment, "extraCopyPaths", manifestPath, fieldPath, rootDirectory)
  try appendStringArrayField(target.linkLibraries, fragment, "linkLibraries", manifestPath, fieldPath, "")
  try appendStringArrayField(target.frameworks, fragment, "frameworks", manifestPath, fieldPath, "")
  try appendStringArrayField(target.pkgConfigPackages, fragment, "pkgConfigPackages", manifestPath, fieldPath, "")
  try appendStringArrayField(target.defines, fragment, "defines", manifestPath, fieldPath, "")
  try appendStringArrayField(target.compilerFlags, fragment, "compilerFlags", manifestPath, fieldPath, "")
  try appendStringArrayField(target.linkerFlags, fragment, "linkerFlags", manifestPath, fieldPath, "")
  return Success()
}

function appendStringArrayField(
  target: string[],
  object: JsonObject,
  name: string,
  manifestPath: string,
  fieldPath: string,
  pathRoot: string,
): Result<void, string> {
  if !manifestJsonHas(object, name) { return Success() }
  try values := manifestArray(manifestJsonField(object, name), manifestPath, fieldPath + "." + name)
  for index of 0..<values.length {
    try value := manifestString(
      values[index],
      manifestPath,
      fieldPath + "." + name + "[" + string(index) + "]",
    )
    normalized := if pathRoot == "" then value else manifestJoinPath(pathRoot, value)
    appendUnique(target, normalized)
  }
  return Success()
}

function appendNativeBuild(target: NativeBuildPlan, source: NativeBuildPlan): void {
  appendUniqueValues(target.includePaths, source.includePaths)
  appendUniqueValues(target.sourceFiles, source.sourceFiles)
  appendUniqueValues(target.libraryPaths, source.libraryPaths)
  appendUniqueValues(target.extraCopyPaths, source.extraCopyPaths)
  appendUniqueValues(target.linkLibraries, source.linkLibraries)
  appendUniqueValues(target.frameworks, source.frameworks)
  appendUniqueValues(target.pkgConfigPackages, source.pkgConfigPackages)
  appendUniqueValues(target.defines, source.defines)
  appendUniqueValues(target.compilerFlags, source.compilerFlags)
  appendUniqueValues(target.linkerFlags, source.linkerFlags)
}

function appendUniqueValues(target: string[], values: string[]): void {
  for value of values { appendUnique(target, value) }
}

function appendUnique(target: string[], value: string): void {
  for existing of target { if existing == value { return } }
  target.push(value)
}

function manifestObject(value: JsonValue, manifestPath: string, fieldPath: string): Result<JsonObject, string> {
  case value {
    object: JsonObject -> return Success(object)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be an object")
  }
}

function manifestArray(value: JsonValue, manifestPath: string, fieldPath: string): Result<JsonValue[], string> {
  case value {
    array: JsonValue[] -> return Success(array)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be an array")
  }
}

function manifestString(value: JsonValue, manifestPath: string, fieldPath: string): Result<string, string> {
  case value {
    text: string -> return Success(text)
    _ -> return Failure("Invalid doof.json at " + manifestPath + ": " + fieldPath + " must be a string")
  }
}
