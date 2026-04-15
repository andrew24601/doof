export const DEFAULT_STD_VERSIONS: Record<string, string> = {
  fs: "0.1",
  path: "0.1",
  assert: "0.1",
};

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