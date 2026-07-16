// Deterministic macOS application metadata and command planning.
//
// Filesystem mutation and process execution stay in driver.do. Keeping plist,
// archive-name, and codesign argument generation here makes the package path
// directly testable without requiring a signing identity or Apple tools.

/** One resource mapping rooted below Contents/Resources. */
export class MacOSAppResource {
  sourcePath: string
  destination: string
}

/** One explicitly allowlisted dynamic library or framework. */
export class MacOSEmbeddedLibrary {
  library: string = ""
  path: string = ""
}

/** Resolved build.target=macos-app metadata. */
export class MacOSAppConfig {
  executableName: string
  bundleId: string
  displayName: string
  version: string
  iconPath: string = ""
  infoPlist: JsonObject | null = null
  resources: MacOSAppResource[] = []
  embeddedLibraries: MacOSEmbeddedLibrary[] = []
  category: string = "public.app-category.developer-tools"
  minimumSystemVersion: string = "11.0"
}

/** Resolved build.package.macos release settings. */
export class MacOSPackageConfig {
  distDirectory: string = ""
  signing: string = "developer-id"
  identity: string = ""
  sandbox: bool = false
  entitlementsPath: string = ""
}

export function macOSPackageArchiveName(executableName: string, version: string): string {
  let safeVersion = ""
  readonly allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"
  for index of 0..<version.length {
    character := version.substring(index, index + 1)
    safeVersion = safeVersion + if allowed.contains(character) then character else "-"
  }
  return executableName + "-" + safeVersion + "-macos.zip"
}

/** Renders the generated bundle plist with app-owned custom keys appended. */
export function renderMacOSInfoPlist(config: MacOSAppConfig): string {
  let body = ""
  body = body + plistString("CFBundleDevelopmentRegion", "en")
  body = body + plistString("CFBundleDisplayName", config.displayName)
  body = body + plistString("CFBundleExecutable", config.executableName)
  if config.iconPath != "" { body = body + plistString("CFBundleIconFile", config.executableName + ".icns") }
  body = body + plistString("CFBundleIdentifier", config.bundleId)
  body = body + plistString("CFBundleInfoDictionaryVersion", "6.0")
  body = body + plistString("CFBundleName", config.displayName)
  body = body + plistString("CFBundlePackageType", "APPL")
  body = body + plistString("CFBundleShortVersionString", config.version)
  body = body + plistString("CFBundleVersion", config.version)
  body = body + plistString("LSApplicationCategoryType", config.category)
  body = body + plistString("LSMinimumSystemVersion", config.minimumSystemVersion)
  body = body + "\t<key>NSHighResolutionCapable</key>\n\t<true/>\n"
  body = body + plistString("NSPrincipalClass", "NSApplication")
  if config.infoPlist != null {
    for key, value of config.infoPlist! {
      body = body + "\t<key>" + escapePlistText(key) + "</key>\n" + renderPlistValue(value, 1)
    }
  }
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n" +
    "<plist version=\"1.0\">\n<dict>\n" + body + "</dict>\n</plist>\n"
}

/** Produces the common release codesign arguments in TypeScript-reference order. */
export function macOSCodesignArguments(
  targetPath: string,
  identity: string,
  signing: string,
  entitlementsPath: string = "",
): string[] {
  let arguments = ["--force", "--sign", identity]
  // Hardened runtime library validation rejects independently ad-hoc-signed
  // nested code. Developer ID releases retain the runtime option; local
  // ad-hoc bundles omit it so explicitly embedded libraries remain runnable.
  if signing != "ad-hoc" {
    arguments.push("--options")
    arguments.push("runtime")
  }
  arguments.push(if signing == "ad-hoc" then "--timestamp=none" else "--timestamp")
  if entitlementsPath != "" {
    arguments.push("--entitlements")
    arguments.push(entitlementsPath)
  }
  arguments.push(targetPath)
  return arguments
}

function plistString(key: string, value: string): string {
  return "\t<key>" + escapePlistText(key) + "</key>\n\t<string>" + escapePlistText(value) + "</string>\n"
}

function plistIndent(depth: int): string {
  let result = ""
  for ignored of 0..<depth { result = result + "\t" }
  return result
}

function renderPlistValue(value: JsonValue, depth: int): string {
  indent := plistIndent(depth)
  case value {
    _: null -> return indent + "<string></string>\n"
    boolean: bool -> return indent + if boolean then "<true/>\n" else "<false/>\n"
    number: int -> return indent + "<integer>" + string(number) + "</integer>\n"
    number: long -> return indent + "<integer>" + string(number) + "</integer>\n"
    number: float -> return indent + "<real>" + string(number) + "</real>\n"
    number: double -> return indent + "<real>" + string(number) + "</real>\n"
    text: string -> return indent + "<string>" + escapePlistText(text) + "</string>\n"
    array: JsonValue[] -> {
      let result = indent + "<array>\n"
      for item of array { result = result + renderPlistValue(item, depth + 1) }
      return result + indent + "</array>\n"
    }
    object: JsonObject -> {
      let result = indent + "<dict>\n"
      for key, item of object {
        result = result + plistIndent(depth + 1) + "<key>" + escapePlistText(key) + "</key>\n"
        result = result + renderPlistValue(item, depth + 1)
      }
      return result + indent + "</dict>\n"
    }
  }
  panic("unhandled plist value")
}

function escapePlistText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&apos;")
}
