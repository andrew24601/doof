import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

export type StdPackageVersions = Record<string, string>;

const STDLIB_PACKAGES_MANIFEST_PATH = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "..",
  "stdlib-packages.json",
);

export const DEFAULT_STD_VERSIONS: StdPackageVersions = loadDefaultStdVersions();

function loadDefaultStdVersions(): StdPackageVersions {
  const manifest = JSON.parse(nodeFs.readFileSync(STDLIB_PACKAGES_MANIFEST_PATH, "utf8")) as unknown;
  if (!isStdPackageVersions(manifest)) {
    throw new Error(`Invalid stdlib package manifest at ${STDLIB_PACKAGES_MANIFEST_PATH}`);
  }

  return Object.freeze({ ...manifest });
}

function isStdPackageVersions(value: unknown): value is StdPackageVersions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(([packageName, version]) => (
    packageName.length > 0 && typeof version === "string" && version.length > 0
  ));
}

export function getImplicitStdDependencyConfig(packageName: string): { url: string; version: string } | null {
  const version = DEFAULT_STD_VERSIONS[packageName];
  if (!version) {
    return null;
  }

  return {
    url: `https://github.com/doof-lang/${packageName}.git`,
    version,
  };
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