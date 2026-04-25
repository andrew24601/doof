import * as nodePath from "node:path";

export type DoofBuildTarget = "macos-app" | "ios-app";
export type IOSAppDestination = "simulator" | "device";

export interface DoofMacOSAppResourceConfig {
  from: string;
  to: string;
}

export interface DoofMacOSAppConfig {
  bundleId: string;
  displayName: string;
  version: string;
  icon: string;
  resources?: DoofMacOSAppResourceConfig[];
  category?: string;
  minimumSystemVersion?: string;
}

export interface DoofIOSAppResourceConfig {
  from: string;
  to: string;
}

export interface DoofIOSAppConfig {
  bundleId: string;
  displayName: string;
  version: string;
  icon: string;
  resources?: DoofIOSAppResourceConfig[];
  minimumDeploymentTarget?: string;
}

export interface ResolvedDoofMacOSAppResource {
  fromPattern: string;
  destination: string;
}

export interface ResolvedDoofMacOSAppConfig {
  bundleId: string;
  displayName: string;
  version: string;
  iconPath: string;
  resources: ResolvedDoofMacOSAppResource[];
  category: string;
  minimumSystemVersion: string;
}

export interface ResolvedDoofIOSAppResource {
  fromPattern: string;
  destination: string;
}

export interface ResolvedDoofIOSAppConfig {
  bundleId: string;
  displayName: string;
  version: string;
  iconPath: string;
  resources: ResolvedDoofIOSAppResource[];
  minimumDeploymentTarget: string;
}

export interface ResolvedDoofMacOSAppTarget {
  kind: "macos-app";
  config: ResolvedDoofMacOSAppConfig;
}

export interface ResolvedDoofIOSAppTarget {
  kind: "ios-app";
  config: ResolvedDoofIOSAppConfig;
}

export type ResolvedDoofBuildTarget = ResolvedDoofMacOSAppTarget | ResolvedDoofIOSAppTarget;

export const DEFAULT_MACOS_APP_CATEGORY = "public.app-category.developer-tools";
export const DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION = "11.0";
export const DEFAULT_IOS_MINIMUM_DEPLOYMENT_TARGET = "16.0";

export function isDoofBuildTarget(value: string): value is DoofBuildTarget {
  return value === "macos-app" || value === "ios-app";
}

export function normalizeMacOSAppResourceDestination(destination: string): string {
  return normalizeBundleResourceDestination(destination, "Contents/Resources");
}

export function normalizeIOSAppResourceDestination(destination: string): string {
  return normalizeBundleResourceDestination(destination, "the app bundle");
}

function normalizeBundleResourceDestination(destination: string, bundleRoot: string): string {
  const portableDestination = destination.replace(/\\/g, "/");

  if (portableDestination.startsWith("/") || portableDestination.match(/^[A-Za-z]:\//)) {
    throw new Error("bundle resource destinations must be relative");
  }

  const normalized = nodePath.posix.normalize(portableDestination || ".");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`bundle resource destinations must stay within ${bundleRoot}`);
  }

  return normalized === "." ? "" : normalized;
}
