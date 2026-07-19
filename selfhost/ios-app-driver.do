// Native iOS bundle, SDK, signing, and IPA boundary for the self-hosted driver.

import {
  IOSAppConfig, IOSPackageConfig, iosCodesignArguments, iosExactApplicationIdentifier, iosTargetTriple,
  renderIOSIconSetContents, renderIOSInfoPlist, renderIOSMainSource,
} from "./ios-app"
import {
  parseCodesignIdentities, parseProvisioningProfile, resolveIOSAdHocSigningIdentity,
  validateIOSAdHocSigning,
} from "./ios-device"
import { NativeBuildPlan } from "./package-manifest"
import { BlobReader } from "std/blob"
import { exists, isDirectory, mkdir, readBlob, readDir, remove, writeBlob, writeText } from "std/fs"
import { ExecOptions, platform, run } from "std/os"
import { basename, dirname, join } from "std/path"
import { Instant } from "std/time"

readonly MAX_IOS_COMMAND_OUTPUT_BYTES = 262144L

class IOSCommandResult {
  exitCode: int
  output: readonly byte[] = []
  error: string = ""
}

function outputPath(directory: string, name: string): string => join([directory, name])
function parentPath(path: string): string => dirname(path)
function fileName(path: string): string => basename(path)

function hostPlatform(): string {
  value := platform()
  return if value == "darwin" then "macos" else value
}

function runIOSCommand(command: string, arguments: string[]): IOSCommandResult {
  executed := run(command, arguments, ExecOptions {
    withStdin: false,
    mergeStderrIntoStdout: true,
    maxOutputBytes: MAX_IOS_COMMAND_OUTPUT_BYTES,
  }) else error { return IOSCommandResult { exitCode: -1, error } }
  return IOSCommandResult { exitCode: executed.exitCode, output: executed.stdout }
}

function commandText(command: string, arguments: string[], description: string): Result<string, string> {
  result := runIOSCommand(command, arguments)
  output := if result.error != "" then result.error else BlobReader(result.output).readString(long(result.output.length)).trim()
  if result.exitCode != 0 {
    return Failure(description + " failed" + if output == "" then "" else ":\n" + output)
  }
  return Success(output)
}

function runRequiredCommand(command: string, arguments: string[], description: string): Result<void, string> {
  try ignored := commandText(command, arguments, description)
  return Success()
}

function ensureDirectory(path: string): void {
  if path == "" || exists(path) { return }
  parent := parentPath(path)
  if parent != path { ensureDirectory(parent) }
  try! mkdir(path)
}

function copyPath(sourcePath: string, destinationPath: string): void {
  if isDirectory(sourcePath) {
    ensureDirectory(destinationPath)
    for entry of try! readDir(sourcePath) {
      copyPath(outputPath(sourcePath, entry.name), outputPath(destinationPath, entry.name))
    }
    return
  }
  ensureDirectory(parentPath(destinationPath))
  try! writeBlob(destinationPath, try! readBlob(sourcePath))
}

function removeTree(path: string): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { removeTree(outputPath(path, entry.name)) }
  }
  try! remove(path)
}

function appendUnique(values: string[], value: string): void {
  if !values.contains(value) { values.push(value) }
}

/** Adds the UIKit shell and Apple SDK arguments to the native build plan. */
export function configureIOSNativeBuild(
  outputDirectory: string,
  config: IOSAppConfig,
  destination: string,
  native: NativeBuildPlan,
): Result<void, string> {
  if hostPlatform() != "macos" { return Failure("iOS app builds are only supported on macOS") }
  sdk := if destination == "device" then "iphoneos" else "iphonesimulator"
  try sdkPath := commandText("xcrun", ["--sdk", sdk, "--show-sdk-path"], "resolving the iOS SDK")
  try architecture := commandText("uname", ["-m"], "resolving the host architecture")
  try target := iosTargetTriple(config.minimumDeploymentTarget, destination, architecture)
  try! writeText(outputPath(outputDirectory, "Info.plist"), renderIOSInfoPlist(config))
  try! writeText(outputPath(outputDirectory, "ios-main.mm"), renderIOSMainSource(config.executableName))
  appendUnique(native.sourceFiles, "ios-main.mm")
  appendUnique(native.frameworks, "UIKit")
  appendUnique(native.frameworks, "Foundation")
  for values of [native.compilerFlags, native.linkerFlags] {
    appendUnique(values, "-isysroot")
    appendUnique(values, sdkPath)
    appendUnique(values, "-target")
    appendUnique(values, target)
  }
  return Success()
}

function globBaseDirectory(pattern: string): string {
  let wildcard = pattern.length
  for index of 0..<pattern.length {
    if pattern.substring(index, index + 1) == "*" { wildcard = index; break }
  }
  if wildcard == pattern.length { return parentPath(pattern) }
  let slash = wildcard
  while slash > 0 && pattern.substring(slash - 1, slash) != "/" { slash -= 1 }
  return if slash <= 1 then "/" else pattern.substring(0, slash - 1)
}

function globMatches(pattern: string, value: string, patternIndex: int = 0, valueIndex: int = 0): bool {
  if patternIndex == pattern.length { return valueIndex == value.length }
  current := pattern.substring(patternIndex, patternIndex + 1)
  if current != "*" {
    return valueIndex < value.length && current == value.substring(valueIndex, valueIndex + 1) &&
      globMatches(pattern, value, patternIndex + 1, valueIndex + 1)
  }
  doubleStar := patternIndex + 1 < pattern.length && pattern.substring(patternIndex + 1, patternIndex + 2) == "*"
  nextPattern := patternIndex + if doubleStar then 2 else 1
  if globMatches(pattern, value, nextPattern, valueIndex) { return true }
  if valueIndex >= value.length { return false }
  if !doubleStar && value.substring(valueIndex, valueIndex + 1) == "/" { return false }
  return globMatches(pattern, value, patternIndex, valueIndex + 1)
}

function collectResourceFiles(path: string, baseDirectory: string, pattern: string, results: string[]): void {
  if isDirectory(path) {
    for entry of try! readDir(path) { collectResourceFiles(outputPath(path, entry.name), baseDirectory, pattern, results) }
    return
  }
  prefix := if baseDirectory.endsWith("/") then baseDirectory else baseDirectory + "/"
  relative := if path.startsWith(prefix) then path.substring(prefix.length, path.length) else fileName(path)
  relativePattern := if pattern.startsWith(prefix) then pattern.substring(prefix.length, pattern.length) else fileName(pattern)
  if globMatches(relativePattern, relative) { results.push(path) }
}

function copyIOSResources(config: IOSAppConfig, appPath: string): Result<void, string> {
  let destinations: string[] = []
  for resource of config.resources {
    let files: string[] = []
    let baseDirectory = globBaseDirectory(resource.sourcePath)
    if resource.sourcePath.contains("*") {
      if exists(baseDirectory) { collectResourceFiles(baseDirectory, baseDirectory, resource.sourcePath, files) }
    } else if isDirectory(resource.sourcePath) {
      collectResourceFiles(resource.sourcePath, resource.sourcePath, resource.sourcePath + "/**", files)
      baseDirectory = resource.sourcePath
    } else if exists(resource.sourcePath) {
      files.push(resource.sourcePath)
      baseDirectory = parentPath(resource.sourcePath)
    }
    if files.length == 0 { return Failure("No files matched resource pattern: " + resource.sourcePath) }
    prefix := if baseDirectory.endsWith("/") then baseDirectory else baseDirectory + "/"
    for sourcePath of files {
      relative := if sourcePath.startsWith(prefix) then sourcePath.substring(prefix.length, sourcePath.length) else fileName(sourcePath)
      destinationRoot := if resource.destination == "" then appPath else outputPath(appPath, resource.destination)
      destination := outputPath(destinationRoot, relative)
      if destinations.contains(destination) { return Failure("Duplicate iOS app resource destination: " + destination) }
      destinations.push(destination)
      copyPath(sourcePath, destination)
    }
  }
  return Success()
}

function compileIOSIcon(config: IOSAppConfig, appPath: string, destination: string, buildDirectory: string): Result<void, string> {
  if config.iconPath == "" { return Success() }
  catalogPath := outputPath(buildDirectory, "Assets.xcassets")
  iconSetPath := outputPath(catalogPath, "AppIcon.appiconset")
  removeTree(catalogPath)
  ensureDirectory(iconSetPath)
  try! writeText(outputPath(iconSetPath, "Contents.json"), renderIOSIconSetContents() + "\n")
  readonly names = [
    "iphone_notification_20@2x.png", "iphone_notification_20@3x.png", "iphone_settings_29@2x.png",
    "iphone_settings_29@3x.png", "iphone_spotlight_40@2x.png", "iphone_spotlight_40@3x.png",
    "iphone_app_60@2x.png", "iphone_app_60@3x.png", "ipad_notification_20.png",
    "ipad_notification_20@2x.png", "ipad_settings_29.png", "ipad_settings_29@2x.png",
    "ipad_spotlight_40.png", "ipad_spotlight_40@2x.png", "ipad_app_76.png",
    "ipad_app_76@2x.png", "ipad_pro_83_5@2x.png", "app_store_1024.png",
  ]
  readonly sizes = [40, 60, 58, 87, 80, 120, 120, 180, 20, 40, 29, 58, 40, 80, 76, 152, 167, 1024]
  for index of 0..<names.length {
    size := string(sizes[index])
    try runRequiredCommand(
      "sips", ["-z", size, size, config.iconPath, "--out", outputPath(iconSetPath, names[index])],
      "resizing the iOS app icon",
    )
  }
  partialPlistPath := outputPath(buildDirectory, ".doof-ios-icon-info.plist")
  platformName := if destination == "device" then "iphoneos" else "iphonesimulator"
  try runRequiredCommand("xcrun", [
    "actool", catalogPath, "--compile", appPath, "--platform", platformName,
    "--minimum-deployment-target", config.minimumDeploymentTarget, "--app-icon", "AppIcon",
    "--target-device", "iphone", "--target-device", "ipad",
    "--output-partial-info-plist", partialPlistPath,
  ], "compiling the iOS app icon catalog")
  try runRequiredCommand(
    "/usr/libexec/PlistBuddy", ["-c", "Merge " + partialPlistPath, outputPath(appPath, "Info.plist")],
    "merging iOS app icon metadata",
  )
  if exists(partialPlistPath) { try! remove(partialPlistPath) }
  return Success()
}

/** Assembles a flat iOS .app bundle after the device/simulator link succeeds. */
export function assembleIOSApp(
  buildDirectory: string,
  executablePath: string,
  config: IOSAppConfig,
  destination: string = "simulator",
): Result<string, string> {
  if hostPlatform() != "macos" { return Failure("iOS app builds are only supported on macOS") }
  if config.embeddedLibraries.length > 0 {
    return Failure("Self-hosted iOS embedded library bundling is not yet supported")
  }
  appPath := outputPath(buildDirectory, config.executableName + ".app")
  removeTree(appPath)
  ensureDirectory(appPath)
  bundleExecutable := outputPath(appPath, config.executableName)
  copyPath(executablePath, bundleExecutable)
  try runRequiredCommand("chmod", ["+x", bundleExecutable], "marking the iOS executable")
  infoPlistPath := outputPath(buildDirectory, "Info.plist")
  if exists(infoPlistPath) {
    copyPath(infoPlistPath, outputPath(appPath, "Info.plist"))
  } else {
    try! writeText(outputPath(appPath, "Info.plist"), renderIOSInfoPlist(config))
  }
  try copyIOSResources(config, appPath)
  try compileIOSIcon(config, appPath, destination, buildDirectory)
  return Success(appPath)
}

function collectNestedCode(path: string, results: string[]): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { collectNestedCode(outputPath(path, entry.name), results) }
    if path.endsWith(".framework") || path.endsWith(".appex") { results.push(path) }
    return
  }
  if path.endsWith(".dylib") || path.endsWith(".so") { results.push(path) }
}

/** Validates the selected profile, signs the app, verifies it, and writes an IPA. */
export function signAndArchiveIOSApp(
  appPath: string,
  archivePath: string,
  bundleId: string,
  config: IOSPackageConfig,
  buildDirectory: string,
): Result<void, string> {
  if hostPlatform() != "macos" { return Failure("iOS Ad Hoc packaging is only supported on macOS") }
  if config.provisioningProfilePath == "" {
    return Failure("No iOS provisioning profile configured; pass --ios-provisioning-profile")
  }
  if !exists(config.provisioningProfilePath) { return Failure("Provisioning profile not found: " + config.provisioningProfilePath) }

  workDirectory := outputPath(buildDirectory, ".doof-ios-package")
  removeTree(workDirectory)
  ensureDirectory(workDirectory)
  decodedProfilePath := outputPath(workDirectory, "profile.plist")
  entitlementsPath := outputPath(workDirectory, "entitlements.plist")
  try profile := parseProvisioningProfile(config.provisioningProfilePath, workDirectory)
  try identitiesOutput := commandText(
    "security", ["find-identity", "-v", "-p", "codesigning"], "listing code-signing identities",
  )
  identities := parseCodesignIdentities(identitiesOutput)
  try identity := resolveIOSAdHocSigningIdentity(profile, identities, config.identity)
  try validateIOSAdHocSigning(profile, identities, identity, bundleId, Instant.now().toEpochMillis())
  try exactApplicationIdentifier := iosExactApplicationIdentifier(profile.applicationIdentifier, bundleId)
  try runRequiredCommand(
    "plutil", ["-extract", "Entitlements", "xml1", "-o", entitlementsPath, decodedProfilePath],
    "extracting iOS signing entitlements",
  )
  try runRequiredCommand(
    "/usr/libexec/PlistBuddy", ["-c", "Set :application-identifier " + exactApplicationIdentifier, entitlementsPath],
    "expanding the iOS application identifier entitlement",
  )
  keychainGroupCountResult := commandText(
    "plutil", ["-extract", "keychain-access-groups", "raw", "-o", "-", entitlementsPath],
    "reading keychain access groups",
  )
  let keychainGroupCount = 0
  case keychainGroupCountResult {
    success: Success -> {
      case int.parse(success.value) {
        parsedCount: Success -> { keychainGroupCount = parsedCount.value }
        _: Failure -> { }
      }
    }
    _: Failure -> { }
  }
  for index of 0..<keychainGroupCount {
    group := commandText(
      "plutil", ["-extract", "keychain-access-groups." + string(index), "raw", "-o", "-", entitlementsPath],
      "reading keychain access group",
    ) else { continue }
    if group.contains("*") {
      try runRequiredCommand(
        "/usr/libexec/PlistBuddy", ["-c", "Set :keychain-access-groups:" + string(index) + " " + exactApplicationIdentifier, entitlementsPath],
        "expanding a keychain access group entitlement",
      )
    }
  }
  copyPath(config.provisioningProfilePath, outputPath(appPath, "embedded.mobileprovision"))
  let nested: string[] = []
  collectNestedCode(outputPath(appPath, "Frameworks"), nested)
  collectNestedCode(outputPath(appPath, "PlugIns"), nested)
  for path of nested {
    try runRequiredCommand("codesign", iosCodesignArguments(path, identity), "signing nested iOS code")
  }
  try runRequiredCommand("codesign", iosCodesignArguments(appPath, identity, entitlementsPath), "signing the iOS app")
  try runRequiredCommand("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "verifying the iOS app signature")
  try signedEntitlements := commandText(
    "codesign", ["--display", "--entitlements", "-", "--xml", appPath], "inspecting signed iOS entitlements",
  )
  if signedEntitlements.contains("invalid entitlements blob") || !signedEntitlements.contains(exactApplicationIdentifier) {
    removeTree(workDirectory)
    return Failure("Signed iOS entitlements do not contain the exact application identifier \"" + exactApplicationIdentifier + "\"")
  }

  payloadDirectory := outputPath(workDirectory, "Payload")
  ensureDirectory(payloadDirectory)
  try runRequiredCommand("ditto", [appPath, outputPath(payloadDirectory, fileName(appPath))], "staging the iOS app payload")
  ensureDirectory(parentPath(archivePath))
  if exists(archivePath) { try! remove(archivePath) }
  try runRequiredCommand(
    "ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", payloadDirectory, archivePath],
    "archiving the iOS app",
  )
  removeTree(workDirectory)
  return Success()
}
