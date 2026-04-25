import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import plist from "plist";
import type { IOSAppDestination } from "./build-targets.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { getIOSAppMainSourcePath } from "./ios-app-support.js";

export interface IOSSimulatorBuildSettings {
  sdkPath: string;
  targetTriple: string;
}

export interface IOSDeviceBuildSettings {
  sdkPath: string;
  targetTriple: string;
}

export interface IOSDeviceSigningOptions {
  signIdentity: string;
  provisioningProfilePath: string;
}

export interface IOSDeviceSigningOverrides {
  signIdentity: string | null;
  provisioningProfilePath: string | null;
}

export interface IOSDeviceSigningResolveOptions {
  profileDirectories?: readonly string[];
}

interface ParsedProvisioningProfile {
  profilePath: string;
  applicationIdentifier: string;
  certFingerprints: string[];
  expirationEpochMs: number;
}

interface IOSToolHost {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  execFile(command: string, args: string[]): string;
}

const DEFAULT_TOOL_HOST: IOSToolHost = {
  platform: process.platform,
  arch: process.arch,
  execFile(command, args) {
    return String(execFileSync(command, args, { encoding: "utf8", stdio: "pipe" })).trim();
  },
};

const DEFAULT_PROFILE_DIRECTORIES = [
  "~/Library/Developer/Xcode/UserData/Provisioning Profiles",
  "~/Library/MobileDevice/Provisioning Profiles",
] as const;

export function buildIOSSimulatorTargetTriple(
  minimumDeploymentTarget: string,
  arch: NodeJS.Architecture = process.arch,
): string {
  switch (arch) {
    case "arm64":
      return `arm64-apple-ios${minimumDeploymentTarget}-simulator`;
    case "x64":
      return `x86_64-apple-ios${minimumDeploymentTarget}-simulator`;
    default:
      throw new Error(`Unsupported macOS host architecture for iOS simulator builds: ${arch}`);
  }
}

export function resolveIOSSimulatorBuildSettings(
  config: { minimumDeploymentTarget: string },
  host: IOSToolHost = DEFAULT_TOOL_HOST,
): IOSSimulatorBuildSettings {
  if ((host.platform ?? process.platform) !== "darwin") {
    throw new Error("iOS simulator builds are only supported on macOS");
  }

  return {
    sdkPath: host.execFile("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).trim(),
    targetTriple: buildIOSSimulatorTargetTriple(config.minimumDeploymentTarget, host.arch ?? process.arch),
  };
}

export function buildIOSDeviceTargetTriple(minimumDeploymentTarget: string): string {
  return `arm64-apple-ios${minimumDeploymentTarget}`;
}

export function resolveIOSDeviceBuildSettings(
  config: { minimumDeploymentTarget: string },
  host: IOSToolHost = DEFAULT_TOOL_HOST,
): IOSDeviceBuildSettings {
  if ((host.platform ?? process.platform) !== "darwin") {
    throw new Error("iOS device builds are only supported on macOS");
  }

  return {
    sdkPath: host.execFile("xcrun", ["--sdk", "iphoneos", "--show-sdk-path"]).trim(),
    targetTriple: buildIOSDeviceTargetTriple(config.minimumDeploymentTarget),
  };
}

export function buildIOSSimulatorNativeBuild(
  nativeBuild: NativeBuildOptions,
  outputDir: string,
  settings: IOSSimulatorBuildSettings,
): NativeBuildOptions {
  return buildIOSNativeBuild(nativeBuild, outputDir, settings);
}

export function buildIOSDeviceNativeBuild(
  nativeBuild: NativeBuildOptions,
  outputDir: string,
  settings: IOSDeviceBuildSettings,
): NativeBuildOptions {
  return buildIOSNativeBuild(nativeBuild, outputDir, settings);
}

export function resolveIOSBuildDestination(destination: IOSAppDestination): IOSAppDestination {
  return destination;
}

function buildIOSNativeBuild(
  nativeBuild: NativeBuildOptions,
  outputDir: string,
  settings: { sdkPath: string; targetTriple: string },
): NativeBuildOptions {
  return {
    ...nativeBuild,
    frameworks: uniqueStrings([...nativeBuild.frameworks, "UIKit", "Foundation"]),
    sourceFiles: uniqueStrings([...nativeBuild.sourceFiles, nodePath.join(outputDir, getIOSAppMainSourcePath())]),
    compilerFlags: uniqueStrings([
      ...nativeBuild.compilerFlags,
      "-isysroot",
      settings.sdkPath,
      "-target",
      settings.targetTriple,
    ]),
    linkerFlags: uniqueStrings([
      ...nativeBuild.linkerFlags,
      "-isysroot",
      settings.sdkPath,
      "-target",
      settings.targetTriple,
    ]),
  };
}

export function installAndLaunchIOSSimulatorApp(
  appPath: string,
  bundleId: string,
  launch: boolean,
  host: Pick<IOSToolHost, "execFile"> = DEFAULT_TOOL_HOST,
): void {
  host.execFile("xcrun", ["simctl", "install", "booted", appPath]);
  if (launch) {
    host.execFile("xcrun", ["simctl", "launch", "booted", bundleId]);
  }
}

export function signIOSDeviceApp(
  appPath: string,
  bundleId: string,
  options: IOSDeviceSigningOptions,
  host: Pick<IOSToolHost, "execFile" | "platform"> = DEFAULT_TOOL_HOST,
): void {
  if ((host.platform ?? process.platform) !== "darwin") {
    throw new Error("iOS device signing is only supported on macOS");
  }
  if (!nodeFs.existsSync(options.provisioningProfilePath)) {
    throw new Error(`Provisioning profile not found: ${options.provisioningProfilePath}`);
  }

  const tempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doof-ios-sign-"));
  try {
    const decodedProfilePath = nodePath.join(tempDir, "profile.plist");
    const entitlementsPath = nodePath.join(tempDir, "entitlements.plist");
    const decodedProfile = host.execFile("security", ["cms", "-D", "-i", options.provisioningProfilePath]);
    nodeFs.writeFileSync(decodedProfilePath, decodedProfile, "utf8");

    const applicationIdentifier = host.execFile(
      "plutil",
      ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", decodedProfilePath],
    ).trim();
    if (!matchesProvisionedBundleIdentifier(applicationIdentifier, bundleId)) {
      throw new Error(
        `Provisioning profile application-identifier ${JSON.stringify(applicationIdentifier)} does not match bundle id ${JSON.stringify(bundleId)}`,
      );
    }

    host.execFile("plutil", ["-extract", "Entitlements", "xml1", "-o", entitlementsPath, decodedProfilePath]);
    nodeFs.copyFileSync(options.provisioningProfilePath, nodePath.join(appPath, "embedded.mobileprovision"));
    host.execFile("codesign", [
      "--force",
      "--sign",
      options.signIdentity,
      "--entitlements",
      entitlementsPath,
      "--generate-entitlement-der",
      "--timestamp=none",
      appPath,
    ]);
  } finally {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function resolveIOSDeviceSigningOptionsForBundle(
  bundleId: string,
  overrides: IOSDeviceSigningOverrides,
  options: IOSDeviceSigningResolveOptions = {},
  host: Pick<IOSToolHost, "execFile" | "platform"> = DEFAULT_TOOL_HOST,
): IOSDeviceSigningOptions {
  if ((host.platform ?? process.platform) !== "darwin") {
    throw new Error("iOS device signing is only supported on macOS");
  }

  const profilePath = overrides.provisioningProfilePath
    ? resolveUserPath(overrides.provisioningProfilePath)
    : autoResolveProvisioningProfilePath(bundleId, options.profileDirectories, host);

  const signIdentity = overrides.signIdentity
    ? overrides.signIdentity
    : autoResolveSigningIdentity(profilePath, host);

  return {
    signIdentity,
    provisioningProfilePath: profilePath,
  };
}

export function resolveIOSDeviceIdentifier(
  overrideDeviceIdentifier: string | null,
  host: Pick<IOSToolHost, "execFile" | "platform"> = DEFAULT_TOOL_HOST,
): string {
  if (overrideDeviceIdentifier) {
    return overrideDeviceIdentifier;
  }
  if ((host.platform ?? process.platform) !== "darwin") {
    throw new Error("iOS device discovery is only supported on macOS");
  }

  const tempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doof-ios-devicectl-"));
  try {
    const devicesJsonPath = nodePath.join(tempDir, "devices.json");
    host.execFile("xcrun", ["devicectl", "list", "devices", "--json-output", devicesJsonPath]);
    const rawJson = nodeFs.readFileSync(devicesJsonPath, "utf8");
    const matches = collectConnectedIOSDevices(rawJson);
    if (matches.length === 0) {
      throw new Error(
        "Could not auto-detect a connected iOS device. Connect a device or pass --ios-device.",
      );
    }
    if (matches.length > 1) {
      const choices = matches.map((device) => `${device.name} (${device.identifier})`).join(", ");
      throw new Error(
        `Multiple connected iOS devices found (${choices}). Pass --ios-device to select one.`,
      );
    }
    return matches[0].identifier;
  } finally {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function installAndLaunchIOSDeviceApp(
  appPath: string,
  deviceIdentifier: string,
  bundleId: string,
  launch: boolean,
  host: Pick<IOSToolHost, "execFile"> = DEFAULT_TOOL_HOST,
): void {
  host.execFile("xcrun", ["devicectl", "device", "install", "app", "--device", deviceIdentifier, appPath]);
  if (launch) {
    host.execFile("xcrun", [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      deviceIdentifier,
      "--terminate-existing",
      bundleId,
    ]);
  }
}

function matchesProvisionedBundleIdentifier(applicationIdentifier: string, bundleId: string): boolean {
  const separatorIndex = applicationIdentifier.indexOf(".");
  if (separatorIndex === -1) {
    return false;
  }

  const provisionedBundleId = applicationIdentifier.slice(separatorIndex + 1);
  if (provisionedBundleId === "*") {
    return true;
  }
  if (provisionedBundleId.endsWith(".*")) {
    return bundleId.startsWith(provisionedBundleId.slice(0, -1));
  }
  return provisionedBundleId === bundleId;
}

function autoResolveProvisioningProfilePath(
  bundleId: string,
  profileDirectories: readonly string[] | undefined,
  host: Pick<IOSToolHost, "execFile">,
): string {
  const candidates = findProvisioningProfileCandidates(bundleId, profileDirectories, host);
  if (candidates.length === 0) {
    throw new Error(
      `Could not auto-detect a provisioning profile for bundle id ${JSON.stringify(bundleId)}. Pass --ios-provisioning-profile.`,
    );
  }

  return candidates[0].profilePath;
}

function autoResolveSigningIdentity(
  profilePath: string,
  host: Pick<IOSToolHost, "execFile">,
): string {
  const profile = parseProvisioningProfile(profilePath, host);
  if (profile.certFingerprints.length === 0) {
    throw new Error(
      `Provisioning profile ${JSON.stringify(profilePath)} does not include DeveloperCertificates. Pass --ios-sign-identity.`,
    );
  }

  const identitiesOutput = host.execFile("security", ["find-identity", "-v", "-p", "codesigning"]);
  const identities = parseCodesignIdentities(identitiesOutput);
  const match = identities.find((identity) => profile.certFingerprints.includes(identity.fingerprint));
  if (!match) {
    throw new Error(
      `Could not auto-detect a signing identity for profile ${JSON.stringify(profilePath)}. Pass --ios-sign-identity.`,
    );
  }

  return match.name;
}

function findProvisioningProfileCandidates(
  bundleId: string,
  profileDirectories: readonly string[] | undefined,
  host: Pick<IOSToolHost, "execFile">,
): ParsedProvisioningProfile[] {
  const profilePaths = collectProvisioningProfilePaths(profileDirectories);
  const matches: ParsedProvisioningProfile[] = [];

  for (const profilePath of profilePaths) {
    let profile: ParsedProvisioningProfile;
    try {
      profile = parseProvisioningProfile(profilePath, host);
    } catch {
      continue;
    }
    if (!matchesProvisionedBundleIdentifier(profile.applicationIdentifier, bundleId)) {
      continue;
    }
    matches.push(profile);
  }

  return matches.sort(compareProvisioningProfiles(bundleId));
}

function compareProvisioningProfiles(bundleId: string): (left: ParsedProvisioningProfile, right: ParsedProvisioningProfile) => number {
  return (left, right) => {
    const leftSpecificity = provisioningSpecificity(left.applicationIdentifier, bundleId);
    const rightSpecificity = provisioningSpecificity(right.applicationIdentifier, bundleId);
    if (leftSpecificity !== rightSpecificity) {
      return rightSpecificity - leftSpecificity;
    }

    const leftActive = left.expirationEpochMs > Date.now() ? 1 : 0;
    const rightActive = right.expirationEpochMs > Date.now() ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    return right.expirationEpochMs - left.expirationEpochMs;
  };
}

function provisioningSpecificity(applicationIdentifier: string, bundleId: string): number {
  const separatorIndex = applicationIdentifier.indexOf(".");
  if (separatorIndex === -1) {
    return 0;
  }
  const provisionedBundleId = applicationIdentifier.slice(separatorIndex + 1);
  if (provisionedBundleId === bundleId) {
    return 2;
  }
  if (provisionedBundleId.endsWith(".*")) {
    return 1;
  }
  if (provisionedBundleId === "*") {
    return 1;
  }
  return 0;
}

function collectProvisioningProfilePaths(profileDirectories: readonly string[] | undefined): string[] {
  const directories = profileDirectories ?? DEFAULT_PROFILE_DIRECTORIES;
  const paths: string[] = [];
  for (const directory of directories) {
    const expanded = resolveUserPath(directory);
    if (!nodeFs.existsSync(expanded)) {
      continue;
    }
    for (const fileName of nodeFs.readdirSync(expanded)) {
      if (!fileName.endsWith(".mobileprovision")) {
        continue;
      }
      paths.push(nodePath.join(expanded, fileName));
    }
  }
  return uniqueStrings(paths);
}

function parseProvisioningProfile(
  profilePath: string,
  host: Pick<IOSToolHost, "execFile">,
): ParsedProvisioningProfile {
  const decodedProfile = host.execFile("security", ["cms", "-D", "-i", profilePath]);
  const parsed = plist.parse(decodedProfile) as Record<string, unknown>;
  const entitlements = asObject(parsed.Entitlements);
  const applicationIdentifier = asString(entitlements["application-identifier"]);
  if (!applicationIdentifier) {
    throw new Error(`Provisioning profile missing Entitlements.application-identifier: ${profilePath}`);
  }

  const expirationEpochMs = parseExpirationDate(parsed.ExpirationDate);
  const certFingerprints = extractCertFingerprints(parsed.DeveloperCertificates);

  return {
    profilePath,
    applicationIdentifier,
    certFingerprints,
    expirationEpochMs,
  };
}

function parseExpirationDate(raw: unknown): number {
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === "string") {
    const epoch = Date.parse(raw);
    return Number.isFinite(epoch) ? epoch : 0;
  }
  return 0;
}

function extractCertFingerprints(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const fingerprints: string[] = [];
  for (const candidate of raw) {
    const bytes = toByteBuffer(candidate);
    if (bytes.length === 0) {
      continue;
    }
    fingerprints.push(createHash("sha1").update(bytes).digest("hex").toUpperCase());
  }
  return uniqueStrings(fingerprints);
}

function toByteBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      return Buffer.from(value, "base64");
    } catch {
      return Buffer.alloc(0);
    }
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
}

function parseCodesignIdentities(output: string): Array<{ fingerprint: string; name: string }> {
  const identities: Array<{ fingerprint: string; name: string }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/u);
    if (!match) {
      continue;
    }
    identities.push({
      fingerprint: match[1],
      name: match[2],
    });
  }
  return identities;
}

function collectConnectedIOSDevices(rawJson: string): Array<{ identifier: string; name: string }> {
  const parsed = JSON.parse(rawJson) as {
    result?: {
      devices?: unknown[];
    };
  };

  const devices = Array.isArray(parsed.result?.devices) ? parsed.result.devices : [];
  const matches: Array<{ identifier: string; name: string }> = [];

  for (const entry of devices) {
    const device = asObject(entry);
    const identifier = asString(device.identifier);
    const deviceProperties = asObject(device.deviceProperties);
    const hardwareProperties = asObject(device.hardwareProperties);
    const connectionProperties = asObject(device.connectionProperties);

    const name = asString(deviceProperties.name) || identifier;
    const platform = asString(hardwareProperties.platform);
    const tunnelState = asString(connectionProperties.tunnelState);
    const reality = asString(hardwareProperties.reality);
    if (!identifier) {
      continue;
    }
    if (platform !== "iOS") {
      continue;
    }
    if (tunnelState !== "connected") {
      continue;
    }
    if (reality && reality !== "physical") {
      continue;
    }

    matches.push({ identifier, name });
  }

  return matches;
}

function resolveUserPath(rawPath: string): string {
  if (rawPath === "~") {
    return nodeOs.homedir();
  }
  if (rawPath.startsWith("~/")) {
    return nodePath.join(nodeOs.homedir(), rawPath.slice(2));
  }
  return nodePath.resolve(rawPath);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}