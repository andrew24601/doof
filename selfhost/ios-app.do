// Deterministic iOS application metadata and command planning.
//
// The native driver owns Apple tool invocation and filesystem mutation. This
// module keeps plist, UIKit shell, target-triple, archive-name, and signing
// arguments directly testable on every host.

export class IOSAppResource {
  sourcePath: string
  destination: string
}

export class IOSEmbeddedLibrary {
  library: string = ""
  path: string = ""
}

/** Resolved build.target=ios-app metadata. */
export class IOSAppConfig {
  executableName: string
  bundleId: string
  displayName: string
  version: string
  iconPath: string = ""
  infoPlist: JsonObject | null = null
  resources: IOSAppResource[] = []
  embeddedLibraries: IOSEmbeddedLibrary[] = []
  minimumDeploymentTarget: string = "16.0"
}

/** Resolved build.package.ios release settings. */
export class IOSPackageConfig {
  identity: string = ""
  provisioningProfilePath: string = ""
}

export function iosPackageArchiveName(executableName: string, version: string): string {
  let safeVersion = ""
  readonly allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"
  for index of 0..<version.length {
    character := version.substring(index, index + 1)
    safeVersion = safeVersion + if allowed.contains(character) then character else "-"
  }
  return executableName + "-" + safeVersion + "-ios.ipa"
}

/** Resolves a profile App ID allowlist entry to the exact entitlement claimed by an app signature. */
export function iosExactApplicationIdentifier(
  profileApplicationIdentifier: string,
  bundleId: string,
): Result<string, string> {
  separator := profileApplicationIdentifier.indexOf(".")
  if separator < 0 {
    return Failure("Provisioning profile application-identifier is malformed")
  }
  prefix := profileApplicationIdentifier.substring(0, separator)
  provisionedBundleId := profileApplicationIdentifier.substring(separator + 1, profileApplicationIdentifier.length)
  matches := provisionedBundleId == bundleId || provisionedBundleId == "*" ||
    (provisionedBundleId.endsWith(".*") && bundleId.startsWith(provisionedBundleId.substring(0, provisionedBundleId.length - 1)))
  if !matches {
    return Failure(
      "Provisioning profile application-identifier \"" + profileApplicationIdentifier +
      "\" does not match bundle id \"" + bundleId + "\"",
    )
  }
  return Success(prefix + "." + bundleId)
}

export function iosTargetTriple(minimumDeploymentTarget: string, destination: string, architecture: string): Result<string, string> {
  if destination == "device" { return Success("arm64-apple-ios" + minimumDeploymentTarget) }
  if destination != "simulator" { return Failure("Unknown iOS destination: " + destination) }
  if architecture == "arm64" { return Success("arm64-apple-ios" + minimumDeploymentTarget + "-simulator") }
  if architecture == "x86_64" || architecture == "x64" {
    return Success("x86_64-apple-ios" + minimumDeploymentTarget + "-simulator")
  }
  return Failure("Unsupported macOS host architecture for iOS simulator builds: " + architecture)
}

export function iosCodesignArguments(targetPath: string, identity: string, entitlementsPath: string = ""): string[] {
  let arguments = ["--force", "--sign", identity]
  if entitlementsPath != "" {
    arguments.push("--entitlements")
    arguments.push(entitlementsPath)
    arguments.push("--generate-entitlement-der")
  }
  arguments.push("--timestamp=none")
  arguments.push(targetPath)
  return arguments
}

/** Renders the generated iOS application plist with custom keys appended. */
export function renderIOSInfoPlist(config: IOSAppConfig): string {
  let body = ""
  body += plistString("CFBundleDevelopmentRegion", "en")
  body += plistString("CFBundleDisplayName", config.displayName)
  body += plistString("CFBundleExecutable", config.executableName)
  body += plistString("CFBundleIdentifier", config.bundleId)
  body += plistString("CFBundleInfoDictionaryVersion", "6.0")
  body += plistString("CFBundleName", config.displayName)
  body += plistString("CFBundlePackageType", "APPL")
  body += plistString("CFBundleShortVersionString", config.version)
  body += plistString("CFBundleVersion", config.version)
  body += "\t<key>LSRequiresIPhoneOS</key>\n\t<true/>\n"
  body += plistString("MinimumOSVersion", config.minimumDeploymentTarget)
  body += "\t<key>UIDeviceFamily</key>\n\t<array>\n\t\t<integer>1</integer>\n\t\t<integer>2</integer>\n\t</array>\n"
  body += plistString("UILaunchStoryboardName", "")
  body += "\t<key>UIApplicationSceneManifest</key>\n\t<dict>\n\t\t<key>UIApplicationSupportsMultipleScenes</key>\n\t\t<false/>\n\t</dict>\n"
  if config.infoPlist != null {
    for key, value of config.infoPlist! {
      body += "\t<key>" + escapePlistText(key) + "</key>\n" + renderPlistValue(value, 1)
    }
  }
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n" +
    "<plist version=\"1.0\">\n<dict>\n" + body + "</dict>\n</plist>\n"
}

/** Renders the UIKit-owned main that invokes the emitted Doof C entrypoint. */
export function renderIOSMainSource(executableName: string): string {
  delegateName := objectiveCIdentifier(executableName) + "AppDelegate"
  return "#import <UIKit/UIKit.h>\n#include <thread>\n\n" +
    "extern \"C\" int doof_entry_main(int argc, char** argv);\n\n" +
    "@interface " + delegateName + " : UIResponder <UIApplicationDelegate>\n" +
    "@property(nonatomic, strong) UIWindow* window;\n@end\n\n" +
    "@implementation " + delegateName + "\n" +
    "- (BOOL)application:(UIApplication*)application didFinishLaunchingWithOptions:(NSDictionary*)launchOptions {\n" +
    "  (void)application;\n  (void)launchOptions;\n" +
    "  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];\n" +
    "  UIViewController* rootViewController = [[UIViewController alloc] init];\n" +
    "  rootViewController.view.backgroundColor = UIColor.systemBackgroundColor;\n" +
    "  self.window.rootViewController = rootViewController;\n  [self.window makeKeyAndVisible];\n" +
    "  std::thread([] { (void)doof_entry_main(0, nullptr); }).detach();\n" +
    "  return YES;\n}\n@end\n\n" +
    "int main(int argc, char* argv[]) {\n  @autoreleasepool {\n" +
    "    return UIApplicationMain(argc, argv, nil, @\"" + escapeObjectiveCString(delegateName) + "\");\n" +
    "  }\n}\n"
}

export function renderIOSIconSetContents(): string {
  return `{
  "images": [
    { "idiom": "iphone", "scale": "2x", "size": "20x20", "filename": "iphone_notification_20@2x.png" },
    { "idiom": "iphone", "scale": "3x", "size": "20x20", "filename": "iphone_notification_20@3x.png" },
    { "idiom": "iphone", "scale": "2x", "size": "29x29", "filename": "iphone_settings_29@2x.png" },
    { "idiom": "iphone", "scale": "3x", "size": "29x29", "filename": "iphone_settings_29@3x.png" },
    { "idiom": "iphone", "scale": "2x", "size": "40x40", "filename": "iphone_spotlight_40@2x.png" },
    { "idiom": "iphone", "scale": "3x", "size": "40x40", "filename": "iphone_spotlight_40@3x.png" },
    { "idiom": "iphone", "scale": "2x", "size": "60x60", "filename": "iphone_app_60@2x.png" },
    { "idiom": "iphone", "scale": "3x", "size": "60x60", "filename": "iphone_app_60@3x.png" },
    { "idiom": "ipad", "scale": "1x", "size": "20x20", "filename": "ipad_notification_20.png" },
    { "idiom": "ipad", "scale": "2x", "size": "20x20", "filename": "ipad_notification_20@2x.png" },
    { "idiom": "ipad", "scale": "1x", "size": "29x29", "filename": "ipad_settings_29.png" },
    { "idiom": "ipad", "scale": "2x", "size": "29x29", "filename": "ipad_settings_29@2x.png" },
    { "idiom": "ipad", "scale": "1x", "size": "40x40", "filename": "ipad_spotlight_40.png" },
    { "idiom": "ipad", "scale": "2x", "size": "40x40", "filename": "ipad_spotlight_40@2x.png" },
    { "idiom": "ipad", "scale": "1x", "size": "76x76", "filename": "ipad_app_76.png" },
    { "idiom": "ipad", "scale": "2x", "size": "76x76", "filename": "ipad_app_76@2x.png" },
    { "idiom": "ipad", "scale": "2x", "size": "83.5x83.5", "filename": "ipad_pro_83_5@2x.png" },
    { "idiom": "ios-marketing", "scale": "1x", "size": "1024x1024", "filename": "app_store_1024.png" }
  ],
  "info": { "author": "doof", "version": 1 }
}`
}

function objectiveCIdentifier(value: string): string {
  readonly first = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_"
  readonly rest = first + "0123456789"
  let result = ""
  for index of 0..<value.length {
    character := value.substring(index, index + 1)
    result += if rest.contains(character) then character else "_"
  }
  if result == "" { return "DoofApp" }
  return if first.contains(result.substring(0, 1)) then result else "Doof_" + result
}

function escapeObjectiveCString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}

function plistString(key: string, value: string): string {
  return "\t<key>" + escapePlistText(key) + "</key>\n\t<string>" + escapePlistText(value) + "</string>\n"
}

function plistIndent(depth: int): string {
  let result = ""
  for ignored of 0..<depth { result += "\t" }
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
      for item of array { result += renderPlistValue(item, depth + 1) }
      return result + indent + "</array>\n"
    }
    object: JsonObject -> {
      let result = indent + "<dict>\n"
      for key, item of object {
        result += plistIndent(depth + 1) + "<key>" + escapePlistText(key) + "</key>\n"
        result += renderPlistValue(item, depth + 1)
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
