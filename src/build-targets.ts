import * as nodePath from "node:path";
import type { AppInfoPlist } from "./app-info-plist.js";

export type DoofBuildTarget = "macos-app" | "ios-app" | "wasm";
export type IOSAppDestination = "simulator" | "device";

export interface DoofMacOSAppResourceConfig {
  from: string;
  to: string;
}

export type DoofEmbeddedLibraryConfig =
  | { library: string; path?: never }
  | { library?: never; path: string };

export type ResolvedDoofEmbeddedLibrary =
  | { library: string; path?: never }
  | { library?: never; path: string };

export interface DoofMacOSAppConfig {
  bundleId?: string;
  displayName?: string;
  version?: string;
  icon?: string;
  infoPlist?: AppInfoPlist;
  resources?: DoofMacOSAppResourceConfig[];
  embeddedLibraries?: DoofEmbeddedLibraryConfig[];
  category?: string;
  minimumSystemVersion?: string;
}

export interface DoofIOSAppResourceConfig {
  from: string;
  to: string;
}

export interface DoofIOSAppConfig {
  bundleId?: string;
  displayName?: string;
  version?: string;
  icon?: string;
  infoPlist?: AppInfoPlist;
  resources?: DoofIOSAppResourceConfig[];
  embeddedLibraries?: DoofEmbeddedLibraryConfig[];
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
  iconPath?: string;
  infoPlist?: AppInfoPlist;
  resources: ResolvedDoofMacOSAppResource[];
  embeddedLibraries?: ResolvedDoofEmbeddedLibrary[];
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
  iconPath?: string;
  infoPlist?: AppInfoPlist;
  resources: ResolvedDoofIOSAppResource[];
  embeddedLibraries?: ResolvedDoofEmbeddedLibrary[];
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

export interface ResolvedDoofWasmTarget {
  kind: "wasm";
}

export type ResolvedDoofBuildTarget = ResolvedDoofMacOSAppTarget | ResolvedDoofIOSAppTarget | ResolvedDoofWasmTarget;

export const DEFAULT_MACOS_APP_CATEGORY = "public.app-category.developer-tools";
export const DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION = "11.0";
export const DEFAULT_IOS_MINIMUM_DEPLOYMENT_TARGET = "16.0";

export function isDoofBuildTarget(value: string): value is DoofBuildTarget {
  return value === "macos-app" || value === "ios-app" || value === "wasm";
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
