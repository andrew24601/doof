import * as nodePath from "node:path";

export type DoofBuildTarget = "macos-app";

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

export interface ResolvedDoofMacOSAppTarget {
  kind: "macos-app";
  config: ResolvedDoofMacOSAppConfig;
}

export type ResolvedDoofBuildTarget = ResolvedDoofMacOSAppTarget;

export const DEFAULT_MACOS_APP_CATEGORY = "public.app-category.developer-tools";
export const DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION = "11.0";

export function isDoofBuildTarget(value: string): value is DoofBuildTarget {
  return value === "macos-app";
}

export function normalizeMacOSAppResourceDestination(destination: string): string {
  const portableDestination = destination.replace(/\\/g, "/");

  if (portableDestination.startsWith("/") || portableDestination.match(/^[A-Za-z]:\//)) {
    throw new Error("bundle resource destinations must be relative");
  }

  const normalized = nodePath.posix.normalize(portableDestination || ".");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("bundle resource destinations must stay within Contents/Resources");
  }

  return normalized === "." ? "" : normalized;
}
