import { joinFsPath, resolveFsPath } from "./path-utils.js";
import { STDLIB_PACKAGE_VERSIONS } from "./stdlib-packages.js";

export type StdPackageVersions = typeof STDLIB_PACKAGE_VERSIONS;
export type StdPackageName = keyof StdPackageVersions;

export const DOOF_STDLIB_ROOT_ENV = "DOOF_STDLIB_ROOT";

export const DEFAULT_STD_VERSIONS: StdPackageVersions = STDLIB_PACKAGE_VERSIONS;

export function isStdPackageName(value: string): value is StdPackageName {
  return Object.hasOwn(DEFAULT_STD_VERSIONS, value);
}

export function getImplicitStdDependencyConfig(packageName: string): { url: string; version: string } | null {
  if (!isStdPackageName(packageName)) {
    return null;
  }

  const version = DEFAULT_STD_VERSIONS[packageName];

  return {
    url: `https://github.com/doof-lang/${packageName}.git`,
    version,
  };
}

export function getStdlibRootOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  const configuredRoot = env[DOOF_STDLIB_ROOT_ENV]?.trim();
  if (!configuredRoot) {
    return null;
  }

  return resolveFsPath(configuredRoot);
}

export function resolveStdlibOverridePath(specifier: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const shortName = getStdPackageShortName(specifier);
  if (!shortName) {
    return null;
  }

  const segments = shortName.split("/");
  const [packageName, ...subpath] = segments;
  if (!packageName || !isStdPackageName(packageName)) {
    return null;
  }

  const rootOverride = getStdlibRootOverride(env);
  return rootOverride
    ? joinFsPath(rootOverride, packageName, ...subpath)
    : null;
}

export function getImplicitStdDependencyNames(): string[] {
  return Object.keys(DEFAULT_STD_VERSIONS).map((packageName) => `std/${packageName}`);
}

export function getStdPackageShortName(dependencyName: string): string | null {
  if (!dependencyName.startsWith("std/")) {
    return null;
  }

  const shortName = dependencyName.slice("std/".length);
  return shortName.length === 0 ? null : shortName;
}

export function isImplicitStdSelfReference(manifestName: string | undefined, dependencyName: string): boolean {
  if (!manifestName) {
    return false;
  }

  const shortName = getStdPackageShortName(dependencyName);
  return manifestName === dependencyName || (shortName !== null && manifestName === shortName);
}