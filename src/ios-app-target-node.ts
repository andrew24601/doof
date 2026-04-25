import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}