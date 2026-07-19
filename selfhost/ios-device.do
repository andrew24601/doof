// iOS physical-device discovery, signing selection, and native command boundary.
//
// Pure parsers and selectors stay exported for deterministic parity tests. The
// filesystem/process helpers below adapt those decisions to Apple's command-line
// tools without coupling them to the compiler driver.

import { decodeBase64, sha1Hex } from "std/crypto"
import { exists, isDirectory, mkdir, readBlob, readDir, readText, remove, writeBlob, writeText } from "std/fs"
import { parseJsonValue } from "std/json"
import { ExecOptions, platform, run } from "std/os"
import { absolute, dirname, homeDirectory, join } from "std/path"
import { Instant } from "std/time"
import { iosCodesignArguments } from "./ios-app"
import { BlobReader } from "std/blob"

readonly MAX_IOS_DEVICE_COMMAND_OUTPUT_BYTES = 262144L

export class IOSDevice {
  identifier: string
  name: string
}

export class IOSCodesignIdentity {
  fingerprint: string
  name: string
}

export class IOSProvisioningProfile {
  profilePath: string
  applicationIdentifier: string
  certFingerprints: string[] = []
  expirationEpochMs: long
  provisionedDeviceCount: int = 0
  provisionsAllDevices: bool = false
  getTaskAllow: bool = false
}

export class IOSDeviceSigningOptions {
  signIdentity: string
  provisioningProfilePath: string
}

class IOSDeviceCommandResult {
  exitCode: int
  output: string = ""
  error: string = ""
}

function jsonObjectField(object: JsonObject, name: string): JsonValue | null {
  if !object.has(name) { return null }
  value := object.get(name) else { return null }
  return value
}

function jsonObjectValue(value: JsonValue | null): JsonObject | null {
  if value == null { return null }
  case value! {
    object: JsonObject -> return object
    _ -> return null
  }
}

function jsonArrayValue(value: JsonValue | null): JsonValue[] {
  if value == null { return [] }
  case value! {
    array: JsonValue[] -> return array
    _ -> return []
  }
}

function jsonStringValue(value: JsonValue | null): string {
  if value == null { return "" }
  case value! {
    text: string -> return text
    _ -> return ""
  }
}

/** Parses the connected physical iOS devices reported by devicectl. */
export function parseConnectedIOSDevices(rawJson: string): Result<IOSDevice[], string> {
  parsed := parseJsonValue(rawJson) else error { return Failure(error) }
  root := jsonObjectValue(parsed)
  if root == null { return Failure("Invalid devicectl device JSON: expected an object") }
  result := jsonObjectValue(jsonObjectField(root!, "result"))
  if result == null { return Success([]) }
  values := jsonArrayValue(jsonObjectField(result!, "devices"))
  let devices: IOSDevice[] = []
  for value of values {
    device := jsonObjectValue(value)
    if device == null { continue }
    identifier := jsonStringValue(jsonObjectField(device!, "identifier"))
    deviceProperties := jsonObjectValue(jsonObjectField(device!, "deviceProperties"))
    hardwareProperties := jsonObjectValue(jsonObjectField(device!, "hardwareProperties"))
    connectionProperties := jsonObjectValue(jsonObjectField(device!, "connectionProperties"))
    name := if deviceProperties == null then "" else jsonStringValue(jsonObjectField(deviceProperties!, "name"))
    platformName := if hardwareProperties == null then "" else jsonStringValue(jsonObjectField(hardwareProperties!, "platform"))
    reality := if hardwareProperties == null then "" else jsonStringValue(jsonObjectField(hardwareProperties!, "reality"))
    tunnelState := if connectionProperties == null then "" else jsonStringValue(jsonObjectField(connectionProperties!, "tunnelState"))
    if identifier == "" || platformName != "iOS" || tunnelState != "connected" { continue }
    if reality != "" && reality != "physical" { continue }
    devices.push(IOSDevice { identifier, name: if name == "" then identifier else name })
  }
  return Success(devices)
}

/** Applies the TypeScript CLI's explicit/single-device selection policy. */
export function selectIOSDeviceIdentifier(overrideIdentifier: string, devices: IOSDevice[]): Result<string, string> {
  if overrideIdentifier != "" { return Success(overrideIdentifier) }
  if devices.length == 0 {
    return Failure("Could not auto-detect a connected iOS device. Connect a device or pass --ios-device.")
  }
  if devices.length > 1 {
    let choices = ""
    for index of 0..<devices.length {
      if index > 0 { choices += ", " }
      choices += devices[index].name + " (" + devices[index].identifier + ")"
    }
    return Failure("Multiple connected iOS devices found (" + choices + "). Pass --ios-device to select one.")
  }
  return Success(devices[0].identifier)
}

function isHexFingerprint(value: string): bool {
  if value.length != 40 { return false }
  readonly hex = "0123456789ABCDEF"
  for index of 0..<value.length {
    if !hex.contains(value.substring(index, index + 1).toUpperCase()) { return false }
  }
  return true
}

/** Parses `security find-identity` output. */
export function parseCodesignIdentities(output: string): IOSCodesignIdentity[] {
  let identities: IOSCodesignIdentity[] = []
  for line of output.split("\n") {
    closeParen := line.indexOf(")")
    if closeParen < 0 { continue }
    remainder := line.substring(closeParen + 1, line.length).trim()
    separator := remainder.indexOf(" ")
    if separator < 0 { continue }
    fingerprint := remainder.substring(0, separator).toUpperCase()
    quotedName := remainder.substring(separator + 1, remainder.length).trim()
    if !isHexFingerprint(fingerprint) || quotedName.length < 2 || !quotedName.startsWith("\"") || !quotedName.endsWith("\"") { continue }
    identities.push(IOSCodesignIdentity {
      fingerprint,
      name: quotedName.substring(1, quotedName.length - 1),
    })
  }
  return identities
}

function provisionedBundleId(applicationIdentifier: string): string {
  separator := applicationIdentifier.indexOf(".")
  if separator < 0 { return "" }
  return applicationIdentifier.substring(separator + 1, applicationIdentifier.length)
}

function profileMatchesBundleId(applicationIdentifier: string, bundleId: string): bool {
  provisioned := provisionedBundleId(applicationIdentifier)
  return provisioned == bundleId || provisioned == "*" ||
    (provisioned.endsWith(".*") && bundleId.startsWith(provisioned.substring(0, provisioned.length - 1)))
}

function provisioningSpecificity(applicationIdentifier: string, bundleId: string): int {
  provisioned := provisionedBundleId(applicationIdentifier)
  if provisioned == bundleId { return 2 }
  if provisioned == "*" || provisioned.endsWith(".*") { return 1 }
  return 0
}

function betterProvisioningProfile(
  candidate: IOSProvisioningProfile,
  current: IOSProvisioningProfile,
  bundleId: string,
  nowEpochMs: long,
): bool {
  candidateSpecificity := provisioningSpecificity(candidate.applicationIdentifier, bundleId)
  currentSpecificity := provisioningSpecificity(current.applicationIdentifier, bundleId)
  if candidateSpecificity != currentSpecificity { return candidateSpecificity > currentSpecificity }
  candidateActive := candidate.expirationEpochMs > nowEpochMs
  currentActive := current.expirationEpochMs > nowEpochMs
  if candidateActive != currentActive { return candidateActive }
  return candidate.expirationEpochMs > current.expirationEpochMs
}

/** Selects exact before wildcard, active before expired, then latest expiry. */
export function selectProvisioningProfile(
  bundleId: string,
  profiles: IOSProvisioningProfile[],
  nowEpochMs: long,
): Result<IOSProvisioningProfile, string> {
  let selected: IOSProvisioningProfile | null = null
  for profile of profiles {
    if !profileMatchesBundleId(profile.applicationIdentifier, bundleId) { continue }
    if selected == null || betterProvisioningProfile(profile, selected!, bundleId, nowEpochMs) { selected = profile }
  }
  if selected == null {
    return Failure("Could not auto-detect a provisioning profile for bundle id \"" + bundleId + "\". Pass --ios-provisioning-profile.")
  }
  return Success(selected!)
}

/** Matches a profile certificate fingerprint to an installed code-sign identity. */
export function selectSigningIdentity(
  profile: IOSProvisioningProfile,
  identities: IOSCodesignIdentity[],
): Result<string, string> {
  if profile.certFingerprints.length == 0 {
    return Failure("Provisioning profile \"" + profile.profilePath + "\" does not include DeveloperCertificates. Pass --ios-sign-identity.")
  }
  for identity of identities {
    for fingerprint of profile.certFingerprints {
      if identity.fingerprint == fingerprint { return Success(identity.name) }
    }
  }
  return Failure("Could not auto-detect a signing identity for profile \"" + profile.profilePath + "\". Pass --ios-sign-identity.")
}

/** Resolves the sole installed distribution identity whose certificate is authorized by an Ad Hoc profile. */
export function resolveIOSAdHocSigningIdentity(
  profile: IOSProvisioningProfile,
  identities: IOSCodesignIdentity[],
  configuredIdentity: string,
): Result<string, string> {
  if configuredIdentity != "" { return Success(configuredIdentity) }
  let matching: IOSCodesignIdentity[] = []
  for identity of identities {
    distribution := identity.name.startsWith("Apple Distribution:") || identity.name.startsWith("iPhone Distribution:")
    if distribution && profile.certFingerprints.contains(identity.fingerprint) { matching.push(identity) }
  }
  if matching.length == 0 {
    return Failure(
      "No installed Apple Distribution identity is included in provisioning profile \"" +
      profile.profilePath + "\"",
    )
  }
  if matching.length > 1 {
    let names = ""
    for index of 0..<matching.length {
      if index > 0 { names += ", " }
      names += matching[index].name
    }
    return Failure(
      "Multiple Apple Distribution identities are included in provisioning profile \"" +
      profile.profilePath + "\" (" + names + "). Pass --ios-sign-identity.",
    )
  }
  return Success(matching[0].name)
}

/** Rejects package signing inputs that cannot form an installable Ad Hoc app. */
export function validateIOSAdHocSigning(
  profile: IOSProvisioningProfile,
  identities: IOSCodesignIdentity[],
  identityName: string,
  bundleId: string,
  nowEpochMs: long,
): Result<void, string> {
  if !profileMatchesBundleId(profile.applicationIdentifier, bundleId) {
    return Failure(
      "Provisioning profile application-identifier \"" + profile.applicationIdentifier +
      "\" does not match bundle id \"" + bundleId + "\"",
    )
  }
  if profile.expirationEpochMs <= nowEpochMs {
    return Failure("Provisioning profile is expired: " + profile.profilePath)
  }
  if profile.provisionsAllDevices {
    return Failure("Enterprise provisioning profiles cannot be used for Ad Hoc packaging")
  }
  if profile.getTaskAllow {
    return Failure("Development provisioning profiles cannot be used for Ad Hoc packaging")
  }
  if profile.provisionedDeviceCount == 0 {
    return Failure("Ad Hoc provisioning profile contains no registered devices: " + profile.profilePath)
  }
  if !identityName.startsWith("Apple Distribution:") && !identityName.startsWith("iPhone Distribution:") {
    return Failure("iOS Ad Hoc packaging requires an Apple Distribution signing identity, got \"" + identityName + "\"")
  }
  let selected: IOSCodesignIdentity | null = null
  for identity of identities {
    if identity.name == identityName { selected = identity; break }
  }
  if selected == null {
    return Failure("Configured iOS signing identity is not currently valid: \"" + identityName + "\"")
  }
  if !profile.certFingerprints.contains(selected!.fingerprint) {
    return Failure(
      "Configured iOS signing identity \"" + identityName +
      "\" is not included in provisioning profile \"" + profile.profilePath + "\"",
    )
  }
  return Success()
}

function hostPlatform(): string {
  value := platform()
  return if value == "darwin" then "macos" else value
}

function devicePath(directory: string, name: string): string => join([directory, name])

function ensureDirectory(path: string): void {
  if path == "" || exists(path) { return }
  parent := dirname(path)
  if parent != path { ensureDirectory(parent) }
  try! mkdir(path)
}

function removeTree(path: string): void {
  if !exists(path) { return }
  if isDirectory(path) {
    for entry of try! readDir(path) { removeTree(devicePath(path, entry.name)) }
  }
  try! remove(path)
}

function runDeviceCommand(command: string, arguments: string[]): IOSDeviceCommandResult {
  executed := run(command, arguments, ExecOptions {
    withStdin: false,
    mergeStderrIntoStdout: true,
    maxOutputBytes: MAX_IOS_DEVICE_COMMAND_OUTPUT_BYTES,
  }) else error { return IOSDeviceCommandResult { exitCode: -1, error } }
  output := BlobReader(executed.stdout).readString(long(executed.stdout.length)).trim()
  return IOSDeviceCommandResult { exitCode: executed.exitCode, output }
}

function deviceCommandText(command: string, arguments: string[], description: string): Result<string, string> {
  result := runDeviceCommand(command, arguments)
  output := if result.error != "" then result.error else result.output
  if result.exitCode != 0 {
    return Failure(description + " failed" + if output == "" then "" else ":\n" + output)
  }
  return Success(output)
}

function decodeProvisioningProfile(profilePath: string, decodedPath: string): Result<void, string> {
  securityResult := runDeviceCommand("security", ["cms", "-D", "-i", profilePath])
  if securityResult.exitCode == 0 {
    try! writeText(decodedPath, securityResult.output)
    return Success()
  }
  opensslResult := runDeviceCommand("openssl", [
    "smime", "-inform", "der", "-verify", "-noverify", "-in", profilePath, "-out", decodedPath,
  ])
  if opensslResult.exitCode != 0 {
    output := if securityResult.error != "" then securityResult.error else securityResult.output
    fallbackOutput := if opensslResult.error != "" then opensslResult.error else opensslResult.output
    return Failure(
      "decoding provisioning profile failed" +
      if fallbackOutput != "" then ":\n" + fallbackOutput else if output != "" then ":\n" + output else "",
    )
  }
  return Success()
}

function resolveUserPath(path: string): string {
  if path == "~" { return try! homeDirectory() }
  if path.startsWith("~/") { return devicePath(try! homeDirectory(), path.substring(2, path.length)) }
  return try! absolute(path)
}

function appendUnique(values: string[], value: string): void {
  if !values.contains(value) { values.push(value) }
}

function certificateFingerprint(certificateData: string): Result<string, string> {
  decoded := decodeBase64(certificateData) else error { return Failure(error) }
  fingerprint := sha1Hex(decoded).toUpperCase()
  if !isHexFingerprint(fingerprint) { return Failure("Could not parse provisioning profile certificate fingerprint") }
  return Success(fingerprint)
}

export function parseProvisioningProfile(profilePath: string, workDirectory: string): Result<IOSProvisioningProfile, string> {
  ensureDirectory(workDirectory)
  decodedPath := devicePath(workDirectory, "profile.plist")
  try decodeProvisioningProfile(profilePath, decodedPath)
  try applicationIdentifier := deviceCommandText(
    "plutil", ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", decodedPath],
    "reading provisioning profile application identifier",
  )
  if applicationIdentifier == "" {
    return Failure("Provisioning profile missing Entitlements.application-identifier: " + profilePath)
  }
  expirationResult := deviceCommandText(
    "plutil", ["-extract", "ExpirationDate", "raw", "-o", "-", decodedPath],
    "reading provisioning profile expiration date",
  )
  let expirationText = ""
  case expirationResult {
    success: Success -> { expirationText = success.value }
    _: Failure -> { }
  }
  let expirationEpochMs = 0L
  if expirationText != "" {
    case Instant.parse(expirationText) {
      success: Success -> { expirationEpochMs = success.value.toEpochMillis() }
      _: Failure -> { }
    }
  }
  let provisionedDeviceCount = 0
  case deviceCommandText(
    "plutil", ["-extract", "ProvisionedDevices", "raw", "-o", "-", decodedPath],
    "reading provisioning profile device count",
  ) {
    success: Success -> {
      case int.parse(success.value) {
        parsedCount: Success -> { provisionedDeviceCount = parsedCount.value }
        _: Failure -> { }
      }
    }
    _: Failure -> { }
  }
  let provisionsAllDevices = false
  case deviceCommandText(
    "plutil", ["-extract", "ProvisionsAllDevices", "raw", "-o", "-", decodedPath],
    "reading enterprise provisioning flag",
  ) {
    success: Success -> { provisionsAllDevices = success.value == "true" }
    _: Failure -> { }
  }
  let getTaskAllow = false
  case deviceCommandText(
    "plutil", ["-extract", "Entitlements.get-task-allow", "raw", "-o", "-", decodedPath],
    "reading development provisioning flag",
  ) {
    success: Success -> { getTaskAllow = success.value == "true" }
    _: Failure -> { }
  }
  let certFingerprints: string[] = []
  let certificateCount = 0
  case deviceCommandText(
    "plutil", ["-extract", "DeveloperCertificates", "raw", "-o", "-", decodedPath],
    "reading provisioning profile certificate count",
  ) {
    success: Success -> {
      case int.parse(success.value) {
        parsedCount: Success -> { certificateCount = parsedCount.value }
        _: Failure -> { }
      }
    }
    _: Failure -> { }
  }
  for index of 0..<certificateCount {
    encoded := deviceCommandText(
      "plutil", ["-extract", "DeveloperCertificates." + string(index), "raw", "-o", "-", decodedPath],
      "reading provisioning profile certificate",
    ) else { continue }
    if encoded == "" { continue }
    fingerprint := certificateFingerprint(encoded) else { continue }
    appendUnique(certFingerprints, fingerprint)
  }
  return Success(IOSProvisioningProfile {
    profilePath,
    applicationIdentifier,
    certFingerprints,
    expirationEpochMs,
    provisionedDeviceCount,
    provisionsAllDevices,
    getTaskAllow,
  })
}

function collectProvisioningProfilePaths(profileDirectories: string[]): string[] {
  directories := if profileDirectories.length > 0 then profileDirectories else [
    "~/Library/Developer/Xcode/UserData/Provisioning Profiles",
    "~/Library/MobileDevice/Provisioning Profiles",
  ]
  let paths: string[] = []
  for directory of directories {
    expanded := resolveUserPath(directory)
    if !isDirectory(expanded) { continue }
    for entry of try! readDir(expanded) {
      if entry.name.endsWith(".mobileprovision") { appendUnique(paths, devicePath(expanded, entry.name)) }
    }
  }
  return paths
}

function autoResolveProvisioningProfile(
  bundleId: string,
  workDirectory: string,
  profileDirectories: string[],
): Result<IOSProvisioningProfile, string> {
  let profiles: IOSProvisioningProfile[] = []
  for profilePath of collectProvisioningProfilePaths(profileDirectories) {
    profile := parseProvisioningProfile(profilePath, workDirectory) else { continue }
    profiles.push(profile)
  }
  return selectProvisioningProfile(bundleId, profiles, Instant.now().toEpochMillis())
}

/** Resolves CLI overrides or auto-detects the matching profile and identity. */
export function resolveIOSDeviceSigningOptions(
  bundleId: string,
  signIdentityOverride: string,
  provisioningProfileOverride: string,
  workDirectory: string,
  profileDirectories: string[] = [],
): Result<IOSDeviceSigningOptions, string> {
  if hostPlatform() != "macos" { return Failure("iOS device signing is only supported on macOS") }
  profilePath := if provisioningProfileOverride == "" then "" else resolveUserPath(provisioningProfileOverride)
  if profilePath != "" && signIdentityOverride != "" {
    return Success(IOSDeviceSigningOptions {
      signIdentity: signIdentityOverride,
      provisioningProfilePath: profilePath,
    })
  }
  profile := if profilePath == ""
    then autoResolveProvisioningProfile(bundleId, workDirectory, profileDirectories)
    else parseProvisioningProfile(profilePath, workDirectory)
  selectedProfile := profile else error { return Failure(error) }
  if signIdentityOverride != "" {
    return Success(IOSDeviceSigningOptions {
      signIdentity: signIdentityOverride,
      provisioningProfilePath: selectedProfile.profilePath,
    })
  }
  try identitiesOutput := deviceCommandText(
    "security", ["find-identity", "-v", "-p", "codesigning"], "listing code-signing identities",
  )
  try identity := selectSigningIdentity(selectedProfile, parseCodesignIdentities(identitiesOutput))
  return Success(IOSDeviceSigningOptions {
    signIdentity: identity,
    provisioningProfilePath: selectedProfile.profilePath,
  })
}

/** Resolves an explicit device or discovers the single connected physical iOS device. */
export function resolveIOSDeviceIdentifier(overrideIdentifier: string, workDirectory: string): Result<string, string> {
  if overrideIdentifier != "" { return Success(overrideIdentifier) }
  if hostPlatform() != "macos" { return Failure("iOS device discovery is only supported on macOS") }
  ensureDirectory(workDirectory)
  devicesPath := devicePath(workDirectory, "devices.json")
  if exists(devicesPath) { try! remove(devicesPath) }
  result := deviceCommandText(
    "xcrun", ["devicectl", "list", "devices", "--json-output", devicesPath],
    "listing connected iOS devices",
  ) else error { return Failure(error) }
  rawJson := readText(devicesPath) else { return Failure("Could not read devicectl device output") }
  devices := parseConnectedIOSDevices(rawJson) else error { return Failure(error) }
  if exists(devicesPath) { try! remove(devicesPath) }
  return selectIOSDeviceIdentifier("", devices)
}

function collectNestedIOSCode(path: string, results: string[]): void {
  if !exists(path) { return }
  if isDirectory(path) {
    if path.endsWith(".framework") || path.endsWith(".appex") { results.push(path); return }
    for entry of try! readDir(path) { collectNestedIOSCode(devicePath(path, entry.name), results) }
    return
  }
  if path.endsWith(".dylib") || path.endsWith(".so") { results.push(path) }
}

/** Validates the profile and signs an assembled app without producing an IPA. */
export function signIOSDeviceApp(
  appPath: string,
  bundleId: string,
  options: IOSDeviceSigningOptions,
  workDirectory: string,
): Result<void, string> {
  if hostPlatform() != "macos" { return Failure("iOS device signing is only supported on macOS") }
  if !exists(options.provisioningProfilePath) {
    return Failure("Provisioning profile not found: " + options.provisioningProfilePath)
  }
  removeTree(workDirectory)
  ensureDirectory(workDirectory)
  decodedPath := devicePath(workDirectory, "profile.plist")
  entitlementsPath := devicePath(workDirectory, "entitlements.plist")
  try decodeProvisioningProfile(options.provisioningProfilePath, decodedPath)
  try applicationIdentifier := deviceCommandText(
    "plutil", ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", decodedPath],
    "reading provisioning profile application identifier",
  )
  if !profileMatchesBundleId(applicationIdentifier, bundleId) {
    removeTree(workDirectory)
    return Failure(
      "Provisioning profile application-identifier \"" + applicationIdentifier +
      "\" does not match bundle id \"" + bundleId + "\"",
    )
  }
  try ignored := deviceCommandText(
    "plutil", ["-extract", "Entitlements", "xml1", "-o", entitlementsPath, decodedPath],
    "extracting iOS signing entitlements",
  )
  try! writeBlob(devicePath(appPath, "embedded.mobileprovision"), try! readBlob(options.provisioningProfilePath))
  let nested: string[] = []
  collectNestedIOSCode(devicePath(appPath, "Frameworks"), nested)
  collectNestedIOSCode(devicePath(appPath, "PlugIns"), nested)
  for path of nested {
    try nestedIgnored := deviceCommandText(
      "codesign", iosCodesignArguments(path, options.signIdentity), "signing nested iOS code",
    )
  }
  try appIgnored := deviceCommandText(
    "codesign", iosCodesignArguments(appPath, options.signIdentity, entitlementsPath), "signing the iOS app",
  )
  removeTree(workDirectory)
  return Success()
}
