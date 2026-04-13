import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type { NativeBuildOptions } from "./emitter-module.js";
import type { FileSystem } from "./resolver.js";
import {
  DEFAULT_MACOS_APP_CATEGORY,
  DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION,
  isDoofBuildTarget,
  normalizeMacOSAppResourceDestination,
  type DoofBuildTarget,
  type DoofMacOSAppConfig,
  type DoofMacOSAppResourceConfig,
  type ResolvedDoofBuildTarget,
  type ResolvedDoofMacOSAppConfig,
} from "./build-targets.js";
import {
  dirnameFsPath,
  isAbsoluteFsPath,
  joinFsPath,
  relativeFsPath,
  resolveFsPath,
  resolveFsPathFrom,
} from "./path-utils.js";

export interface ResolvedPackageNativeBuild extends Pick<
  NativeBuildOptions,
  | "includePaths"
  | "sourceFiles"
  | "libraryPaths"
  | "linkLibraries"
  | "frameworks"
  | "pkgConfigPackages"
  | "defines"
  | "compilerFlags"
  | "linkerFlags"
> {
  extraCopyPaths: string[];
}

export interface DoofNativeBuildFragment extends Partial<ResolvedPackageNativeBuild> {}

export interface DoofNativeBuildConfig extends DoofNativeBuildFragment {
  macos?: DoofNativeBuildFragment;
  linux?: DoofNativeBuildFragment;
  windows?: DoofNativeBuildFragment;
}

export interface DoofBuildConfig {
  entry?: string;
  buildDir?: string;
  target?: DoofBuildTarget;
  targetExecutableName?: string;
  macosApp?: DoofMacOSAppConfig;
  native?: DoofNativeBuildConfig;
}

export interface ResolvedPackageBuildConfig {
  entryPath: string;
  buildDir: string;
}

export interface ResolvedPackageBuildContext extends ResolvedPackageBuildConfig {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
}

export interface DoofLocalDependencyConfig {
  path: string;
}

export interface DoofRemoteDependencyConfig {
  url: string;
  version: string;
}

export type DoofDependencyConfig = DoofLocalDependencyConfig | DoofRemoteDependencyConfig;

export interface DoofManifest {
  name?: string;
  version?: string;
  license?: string;
  build?: DoofBuildConfig;
  dependencies: Record<string, DoofDependencyConfig>;
}

export interface LoadedPackage {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
  dependencyRoots: ReadonlyMap<string, string>;
  remoteDependencyProvenance: BuildProvenanceEntry | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
}

export interface PackageGraph {
  rootPackage: LoadedPackage;
  packages: LoadedPackage[];
}

export interface BuildProvenance {
  dependencies: BuildProvenanceEntry[];
}

export interface BuildProvenanceEntry {
  source: {
    kind: string;
    url: string;
  };
  version: string;
  resolvedCommit: string | null;
  cacheKey: string | null;
}

export interface RemoteDependencyContext {
  dependencyName: string;
  packageRootDir: string;
  manifestPath: string;
  cacheRoot: string;
}

export interface ResolvedRemoteDependency {
  rootDir: string;
  provenance: BuildProvenanceEntry;
}

export interface LoadPackageGraphOptions {
  cacheRoot?: string;
  resolveRemoteDependency?: (
    dependency: DoofRemoteDependencyConfig,
    context: RemoteDependencyContext,
  ) => ResolvedRemoteDependency;
}

interface MutableLoadedPackage {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
  dependencyRoots: Map<string, string>;
  remoteDependencyProvenance: BuildProvenanceEntry | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
}

interface PackageLoadContext {
  cacheRoot: string;
  resolveRemoteDependency: (
    dependency: DoofRemoteDependencyConfig,
    context: RemoteDependencyContext,
  ) => ResolvedRemoteDependency;
  remoteDependencyMetadata: Map<string, BuildProvenanceEntry>;
}

interface MaterializedRemoteMetadata {
  source: {
    kind: string;
    url: string;
  };
  version: string;
  resolvedCommit: string | null;
  cacheKey: string | null;
  resolvedRef: string | null;
}

const MANIFEST_FILENAME = "doof.json";
const REMOTE_METADATA_FILENAME = ".doof-remote.json";

export function findDoofManifestPath(fileSystem: FileSystem, entryPath: string): string | null {
  const normalizedPath = resolveFsPath(entryPath);
  let currentDir = fileSystem.readFile(normalizedPath) !== null
    ? dirnameFsPath(normalizedPath)
    : normalizedPath;

  while (true) {
    const manifestPath = joinFsPath(currentDir, MANIFEST_FILENAME);
    if (fileSystem.readFile(manifestPath) !== null) {
      return manifestPath;
    }

    const parentDir = dirnameFsPath(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function resolvePackageBuildContext(fileSystem: FileSystem, startPath: string): ResolvedPackageBuildContext {
  const manifestPath = findDoofManifestPath(fileSystem, startPath);
  if (!manifestPath) {
    throw new Error(`No doof.json found for ${resolveFsPath(startPath)}`);
  }

  const normalizedManifestPath = resolveFsPath(manifestPath);
  const manifest = readManifestOrThrow(fileSystem, normalizedManifestPath);
  const rootDir = dirnameFsPath(normalizedManifestPath);
  return {
    rootDir,
    manifestPath: normalizedManifestPath,
    manifest,
    ...normalizePackageBuildConfig(manifest.build, rootDir, normalizedManifestPath),
  };
}

export function loadPackageGraph(
  fileSystem: FileSystem,
  entryPath: string,
  options: LoadPackageGraphOptions = {},
): PackageGraph {
  const manifestPath = findDoofManifestPath(fileSystem, entryPath);
  if (!manifestPath) {
    throw new Error(`No doof.json found for ${resolveFsPath(entryPath)}`);
  }

  const cache = new Map<string, MutableLoadedPackage>();
  const loadingStack: string[] = [];
  const loadContext: PackageLoadContext = {
    cacheRoot: options.cacheRoot ?? getDefaultPackageCacheRoot(),
    resolveRemoteDependency: options.resolveRemoteDependency ?? defaultResolveRemoteDependency,
    remoteDependencyMetadata: new Map<string, BuildProvenanceEntry>(),
  };
  const rootPackage = loadPackageFromManifest(fileSystem, manifestPath, cache, loadingStack, loadContext);
  return {
    rootPackage,
    packages: [...cache.values()].sort((left, right) => left.rootDir.localeCompare(right.rootDir)),
  };
}

export function createBuildProvenance(graph: PackageGraph): BuildProvenance {
  const seen = new Set<string>();
  const dependencies: BuildProvenanceEntry[] = [];

  for (const pkg of graph.packages) {
    if (!pkg.remoteDependencyProvenance) {
      continue;
    }

    const entry = pkg.remoteDependencyProvenance;
    const key = [
      entry.source.kind,
      entry.source.url,
      entry.version,
      entry.resolvedCommit ?? "",
      entry.cacheKey ?? "",
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dependencies.push(entry);
  }

  dependencies.sort((left, right) => {
    const leftKey = `${left.source.url}\u0000${left.version}`;
    const rightKey = `${right.source.url}\u0000${right.version}`;
    return leftKey.localeCompare(rightKey);
  });

  return { dependencies };
}

export function mergePackageNativeBuild(graph: PackageGraph): ResolvedPackageNativeBuild {
  const merged = createEmptyResolvedPackageNativeBuild();
  const visited = new Set<string>();
  const packagesByRoot = new Map(graph.packages.map((pkg) => [pkg.rootDir, pkg]));

  function visit(rootDir: string) {
    if (visited.has(rootDir)) {
      return;
    }
    visited.add(rootDir);

    const pkg = packagesByRoot.get(rootDir);
    if (!pkg) {
      throw new Error(`Package graph is missing loaded package ${rootDir}`);
    }

    for (const dependencyRoot of pkg.dependencyRoots.values()) {
      visit(dependencyRoot);
    }

    appendUnique(merged.includePaths, pkg.nativeBuild.includePaths);
    appendUnique(merged.sourceFiles, pkg.nativeBuild.sourceFiles);
    appendUnique(merged.libraryPaths, pkg.nativeBuild.libraryPaths);
    appendUnique(merged.extraCopyPaths, pkg.nativeBuild.extraCopyPaths);
    appendUnique(merged.linkLibraries, pkg.nativeBuild.linkLibraries);
    appendUnique(merged.frameworks, pkg.nativeBuild.frameworks);
    appendUnique(merged.pkgConfigPackages, pkg.nativeBuild.pkgConfigPackages);
    appendUnique(merged.defines, pkg.nativeBuild.defines);
    appendUnique(merged.compilerFlags, pkg.nativeBuild.compilerFlags);
    appendUnique(merged.linkerFlags, pkg.nativeBuild.linkerFlags);
  }

  visit(graph.rootPackage.rootDir);
  return merged;
}

function loadPackageFromManifest(
  fileSystem: FileSystem,
  manifestPath: string,
  cache: Map<string, MutableLoadedPackage>,
  loadingStack: string[],
  context: PackageLoadContext,
): LoadedPackage {
  const normalizedManifestPath = resolveFsPath(manifestPath);
  const rootDir = dirnameFsPath(normalizedManifestPath);
  const cached = cache.get(rootDir);
  if (cached) {
    return cached;
  }

  if (loadingStack.includes(rootDir)) {
    const cycle = [...loadingStack, rootDir].join(" -> ");
    throw new Error(`Package dependency cycle detected: ${cycle}`);
  }

  const manifest = readManifestOrThrow(fileSystem, normalizedManifestPath);
  const loaded: MutableLoadedPackage = {
    rootDir,
    manifestPath: normalizedManifestPath,
    manifest,
    dependencyRoots: new Map<string, string>(),
    remoteDependencyProvenance: context.remoteDependencyMetadata.get(rootDir) ?? null,
    nativeBuild: normalizeNativeBuildConfig(manifest.build?.native, rootDir, normalizedManifestPath),
    buildTarget: normalizeBuildTargetConfig(manifest.build, rootDir, normalizedManifestPath),
  };

  loadingStack.push(rootDir);

  try {
    for (const [dependencyName, dependency] of Object.entries(manifest.dependencies)) {
      if ("path" in dependency) {
        const dependencyRoot = resolveFsPathFrom(rootDir, dependency.path);
        const dependencyManifestPath = joinFsPath(dependencyRoot, MANIFEST_FILENAME);
        const loadedDependency = loadPackageFromManifest(
          fileSystem,
          dependencyManifestPath,
          cache,
          loadingStack,
          context,
        );
        loaded.dependencyRoots.set(dependencyName, loadedDependency.rootDir);
        continue;
      }

      const resolvedRemoteDependency = context.resolveRemoteDependency(dependency, {
        dependencyName,
        packageRootDir: rootDir,
        manifestPath: normalizedManifestPath,
        cacheRoot: context.cacheRoot,
      });
      const dependencyRoot = resolveFsPath(resolvedRemoteDependency.rootDir);
      context.remoteDependencyMetadata.set(dependencyRoot, resolvedRemoteDependency.provenance);
      const dependencyManifestPath = joinFsPath(dependencyRoot, MANIFEST_FILENAME);
      const loadedDependency = loadPackageFromManifest(
        fileSystem,
        dependencyManifestPath,
        cache,
        loadingStack,
        context,
      );
      loaded.dependencyRoots.set(dependencyName, loadedDependency.rootDir);
    }
  } finally {
    loadingStack.pop();
  }

  cache.set(rootDir, loaded);
  return loaded;
}

function parseDoofManifest(rawManifest: string, manifestPath: string): DoofManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch (error: any) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${error.message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: root must be an object`);
  }

  const name = readOptionalString(parsed.name, manifestPath, "name");
  const version = readOptionalString(parsed.version, manifestPath, "version");
  const license = readOptionalString(parsed.license, manifestPath, "license");
  const build = parseBuildConfig(parsed.build, manifestPath);
  const dependencies = parseDependencies(parsed.dependencies, manifestPath);

  return { name, version, license, build, dependencies };
}

function parseBuildConfig(value: unknown, manifestPath: string): DoofBuildConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build must be an object`);
  }

  const entry = readOptionalString(value.entry, manifestPath, "build.entry");
  const buildDir = readOptionalString(value.buildDir, manifestPath, "build.buildDir");
  const targetValue = readOptionalString(value.target, manifestPath, "build.target");
  if (targetValue !== undefined && !isDoofBuildTarget(targetValue)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.target must be one of \"macos-app\"`);
  }

  const targetExecutableName = readOptionalString(value.targetExecutableName, manifestPath, "build.targetExecutableName");
  if (targetExecutableName !== undefined && !isValidExecutableName(targetExecutableName)) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: build.targetExecutableName must be a file name without path separators`,
    );
  }

  const macosApp = parseMacOSAppConfig(value.macosApp, manifestPath);
  if (targetValue === "macos-app") {
    if (!macosApp) {
      throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp is required when build.target is \"macos-app\"`);
    }
    if (!targetExecutableName) {
      throw new Error(`Invalid doof.json at ${manifestPath}: build.targetExecutableName is required when build.target is \"macos-app\"`);
    }
  }
  if (macosApp && targetValue !== "macos-app") {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp requires build.target to be \"macos-app\"`);
  }

  const native = parseNativeBuildConfig(value.native, manifestPath);

  return { entry, buildDir, target: targetValue, targetExecutableName, macosApp, native };
}

function parseMacOSAppConfig(value: unknown, manifestPath: string): DoofMacOSAppConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp must be an object`);
  }

  return {
    bundleId: readRequiredString(value.bundleId, manifestPath, "build.macosApp.bundleId"),
    displayName: readRequiredString(value.displayName, manifestPath, "build.macosApp.displayName"),
    version: readRequiredString(value.version, manifestPath, "build.macosApp.version"),
    icon: readRequiredString(value.icon, manifestPath, "build.macosApp.icon"),
    resources: readOptionalMacOSAppResources(value.resources, manifestPath),
    category: readOptionalString(value.category, manifestPath, "build.macosApp.category"),
    minimumSystemVersion: readOptionalString(
      value.minimumSystemVersion,
      manifestPath,
      "build.macosApp.minimumSystemVersion",
    ),
  };
}

function readOptionalMacOSAppResources(value: unknown, manifestPath: string): DoofMacOSAppResourceConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp.resources must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp.resources[${index}] must be an object`);
    }

    return {
      from: readRequiredString(entry.from, manifestPath, `build.macosApp.resources[${index}].from`),
      to: readRequiredString(entry.to, manifestPath, `build.macosApp.resources[${index}].to`),
    };
  });
}

function parseNativeBuildConfig(value: unknown, manifestPath: string): DoofNativeBuildConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.native must be an object`);
  }

  return {
    ...parseNativeBuildFragment(value, manifestPath, "build.native"),
    macos: parseOptionalNativeBuildFragment(value.macos, manifestPath, "build.native.macos"),
    linux: parseOptionalNativeBuildFragment(value.linux, manifestPath, "build.native.linux"),
    windows: parseOptionalNativeBuildFragment(value.windows, manifestPath, "build.native.windows"),
  };
}

function parseOptionalNativeBuildFragment(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): DoofNativeBuildFragment | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an object`);
  }

  return parseNativeBuildFragment(value, manifestPath, fieldPath);
}

function parseNativeBuildFragment(
  value: Record<string, unknown>,
  manifestPath: string,
  fieldPath: string,
): DoofNativeBuildFragment {
  return {
    includePaths: readOptionalStringArray(value.includePaths, manifestPath, `${fieldPath}.includePaths`),
    sourceFiles: readOptionalStringArray(value.sourceFiles, manifestPath, `${fieldPath}.sourceFiles`),
    libraryPaths: readOptionalStringArray(value.libraryPaths, manifestPath, `${fieldPath}.libraryPaths`),
    extraCopyPaths: readOptionalStringArray(value.extraCopyPaths, manifestPath, `${fieldPath}.extraCopyPaths`),
    linkLibraries: readOptionalStringArray(value.linkLibraries, manifestPath, `${fieldPath}.linkLibraries`),
    frameworks: readOptionalStringArray(value.frameworks, manifestPath, `${fieldPath}.frameworks`),
    pkgConfigPackages: readOptionalStringArray(value.pkgConfigPackages, manifestPath, `${fieldPath}.pkgConfigPackages`),
    defines: readOptionalStringArray(value.defines, manifestPath, `${fieldPath}.defines`),
    compilerFlags: readOptionalStringArray(value.compilerFlags, manifestPath, `${fieldPath}.compilerFlags`),
    linkerFlags: readOptionalStringArray(value.linkerFlags, manifestPath, `${fieldPath}.linkerFlags`),
  };
}

function parseDependencies(value: unknown, manifestPath: string): Record<string, DoofDependencyConfig> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: dependencies must be an object`);
  }

  const dependencies: Record<string, DoofDependencyConfig> = {};
  for (const [dependencyName, dependencyValue] of Object.entries(value)) {
    if (!isValidDependencyName(dependencyName)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: invalid dependency name ${JSON.stringify(dependencyName)}`);
    }
    dependencies[dependencyName] = parseDependencyConfig(dependencyValue, manifestPath, dependencyName);
  }

  return dependencies;
}

function parseDependencyConfig(
  value: unknown,
  manifestPath: string,
  dependencyName: string,
): DoofDependencyConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: dependency ${dependencyName} must be an object`);
  }

  if (typeof value.path === "string") {
    if (value.path.length === 0) {
      throw new Error(`Invalid doof.json at ${manifestPath}: dependency ${dependencyName} path must not be empty`);
    }
    return { path: value.path };
  }

  if (typeof value.url === "string" && typeof value.version === "string") {
    if (value.url.length === 0 || value.version.length === 0) {
      throw new Error(`Invalid doof.json at ${manifestPath}: dependency ${dependencyName} url/version must not be empty`);
    }
    return { url: value.url, version: value.version };
  }

  throw new Error(
    `Invalid doof.json at ${manifestPath}: dependency ${dependencyName} must declare either path or url/version`,
  );
}

function readOptionalString(value: unknown, manifestPath: string, fieldPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must not be empty`);
  }
  return value;
}

function readRequiredString(value: unknown, manifestPath: string, fieldPath: string): string {
  const resolved = readOptionalString(value, manifestPath, fieldPath);
  if (resolved === undefined) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} is required`);
  }
  return resolved;
}

function readOptionalStringArray(value: unknown, manifestPath: string, fieldPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an array of strings`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function isValidExecutableName(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function isValidDependencyName(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.startsWith("std");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEmptyResolvedPackageNativeBuild(): ResolvedPackageNativeBuild {
  return {
    includePaths: [],
    sourceFiles: [],
    libraryPaths: [],
    extraCopyPaths: [],
    linkLibraries: [],
    frameworks: [],
    pkgConfigPackages: [],
    defines: [],
    compilerFlags: [],
    linkerFlags: [],
  };
}

function readManifestOrThrow(fileSystem: FileSystem, manifestPath: string): DoofManifest {
  const rawManifest = fileSystem.readFile(manifestPath);
  if (rawManifest === null) {
    throw new Error(`Missing doof.json at ${manifestPath}`);
  }

  return parseDoofManifest(rawManifest, manifestPath);
}

function normalizePackageBuildConfig(
  build: DoofBuildConfig | undefined,
  rootDir: string,
  manifestPath: string,
): ResolvedPackageBuildConfig {
  return {
    entryPath: normalizePackagePath(build?.entry ?? "main.do", rootDir, manifestPath, "build.entry"),
    buildDir: normalizePackagePath(build?.buildDir ?? "build", rootDir, manifestPath, "build.buildDir"),
  };
}

function normalizeNativeBuildConfig(
  nativeBuild: DoofNativeBuildConfig | undefined,
  rootDir: string,
  manifestPath: string,
): ResolvedPackageNativeBuild {
  if (!nativeBuild) {
    return createEmptyResolvedPackageNativeBuild();
  }

  const platformBuild = process.platform === "darwin"
    ? nativeBuild.macos
    : process.platform === "win32"
      ? nativeBuild.windows
      : process.platform === "linux"
        ? nativeBuild.linux
        : undefined;
  const mergedBuild = mergeNativeBuildFragments(nativeBuild, platformBuild);

  return {
    includePaths: normalizePackagePaths(mergedBuild.includePaths, rootDir, manifestPath, "build.native.includePaths"),
    sourceFiles: normalizePackagePaths(mergedBuild.sourceFiles, rootDir, manifestPath, "build.native.sourceFiles"),
    libraryPaths: normalizePackagePaths(mergedBuild.libraryPaths, rootDir, manifestPath, "build.native.libraryPaths"),
    extraCopyPaths: normalizePackagePaths(
      mergedBuild.extraCopyPaths,
      rootDir,
      manifestPath,
      "build.native.extraCopyPaths",
    ),
    linkLibraries: [...(mergedBuild.linkLibraries ?? [])],
    frameworks: [...(mergedBuild.frameworks ?? [])],
    pkgConfigPackages: [...(mergedBuild.pkgConfigPackages ?? [])],
    defines: [...(mergedBuild.defines ?? [])],
    compilerFlags: [...(mergedBuild.compilerFlags ?? [])],
    linkerFlags: [...(mergedBuild.linkerFlags ?? [])],
  };
}

function mergeNativeBuildFragments(
  base: DoofNativeBuildFragment,
  platform: DoofNativeBuildFragment | undefined,
): DoofNativeBuildFragment {
  return {
    includePaths: [...(base.includePaths ?? []), ...(platform?.includePaths ?? [])],
    sourceFiles: [...(base.sourceFiles ?? []), ...(platform?.sourceFiles ?? [])],
    libraryPaths: [...(base.libraryPaths ?? []), ...(platform?.libraryPaths ?? [])],
    extraCopyPaths: [...(base.extraCopyPaths ?? []), ...(platform?.extraCopyPaths ?? [])],
    linkLibraries: [...(base.linkLibraries ?? []), ...(platform?.linkLibraries ?? [])],
    frameworks: [...(base.frameworks ?? []), ...(platform?.frameworks ?? [])],
    pkgConfigPackages: [...(base.pkgConfigPackages ?? []), ...(platform?.pkgConfigPackages ?? [])],
    defines: [...(base.defines ?? []), ...(platform?.defines ?? [])],
    compilerFlags: [...(base.compilerFlags ?? []), ...(platform?.compilerFlags ?? [])],
    linkerFlags: [...(base.linkerFlags ?? []), ...(platform?.linkerFlags ?? [])],
  };
}

function normalizeBuildTargetConfig(
  build: DoofBuildConfig | undefined,
  rootDir: string,
  manifestPath: string,
): ResolvedDoofBuildTarget | null {
  if (!build?.target) {
    return null;
  }

  switch (build.target) {
    case "macos-app":
      return {
        kind: "macos-app",
        config: normalizeMacOSAppBuildConfig(build.macosApp!, rootDir, manifestPath),
      };
  }
}

function normalizeMacOSAppBuildConfig(
  macosApp: DoofMacOSAppConfig,
  rootDir: string,
  manifestPath: string,
): ResolvedDoofMacOSAppConfig {
  return {
    bundleId: macosApp.bundleId,
    displayName: macosApp.displayName,
    version: macosApp.version,
    iconPath: normalizePackagePath(macosApp.icon, rootDir, manifestPath, "build.macosApp.icon"),
    resources: (macosApp.resources ?? []).map((resource, index) => ({
      fromPattern: normalizePackagePath(
        resource.from,
        rootDir,
        manifestPath,
        `build.macosApp.resources[${index}].from`,
      ),
      destination: normalizeMacOSAppResourceDestinationOrThrow(resource.to, manifestPath, index),
    })),
    category: macosApp.category ?? DEFAULT_MACOS_APP_CATEGORY,
    minimumSystemVersion: macosApp.minimumSystemVersion ?? DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION,
  };
}

function normalizeMacOSAppResourceDestinationOrThrow(value: string, manifestPath: string, index: number): string {
  try {
    return normalizeMacOSAppResourceDestination(value);
  } catch (error: any) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: build.macosApp.resources[${index}].to ${error?.message ?? String(error)}`,
    );
  }
}

function normalizePackagePaths(
  values: string[] | undefined,
  rootDir: string,
  manifestPath: string,
  fieldPath: string,
): string[] {
  return (values ?? []).map((value) => normalizePackagePath(value, rootDir, manifestPath, fieldPath));
}

function normalizePackagePath(value: string, rootDir: string, manifestPath: string, fieldPath: string): string {
  const resolvedPath = isAbsoluteFsPath(value)
    ? resolveFsPath(value)
    : resolveFsPathFrom(rootDir, value);
  if (!isWithinRoot(resolvedPath, rootDir)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must stay within the package root`);
  }
  return resolvedPath;
}

function appendUnique(target: string[], values: readonly string[]) {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function isWithinRoot(targetPath: string, rootDir: string): boolean {
  const relativePath = relativeFsPath(rootDir, targetPath);
  const portableRelativePath = relativePath.replace(/\\/g, "/");
  return relativePath === ""
    || (!portableRelativePath.startsWith("../") && portableRelativePath !== ".." && !isAbsoluteFsPath(relativePath));
}

function defaultResolveRemoteDependency(
  dependency: DoofRemoteDependencyConfig,
  context: RemoteDependencyContext,
): ResolvedRemoteDependency {
  const rootDir = computeRemoteCacheDir(context.cacheRoot, dependency.url, dependency.version);
  const manifestPath = nodePath.join(rootDir, MANIFEST_FILENAME);
  const cacheKey = createRemoteCacheKey(dependency.url, dependency.version);

  if (!nodeFs.existsSync(manifestPath)) {
    if (nodeFs.existsSync(rootDir)) {
      nodeFs.rmSync(rootDir, { recursive: true, force: true });
    }

    const provenance = materializeRemoteDependency(dependency, rootDir, cacheKey);
    return { rootDir, provenance };
  }

  return {
    rootDir,
    provenance: readRemoteDependencyProvenance(rootDir) ?? {
      source: { kind: "git", url: dependency.url },
      version: dependency.version,
      resolvedCommit: null,
      cacheKey,
    },
  };
}

function materializeRemoteDependency(
  dependency: DoofRemoteDependencyConfig,
  rootDir: string,
  cacheKey: string,
): BuildProvenanceEntry {
  const parentDir = nodePath.dirname(rootDir);
  const tempDir = `${rootDir}.tmp-${process.pid}-${Date.now()}`;
  const candidateRefs = buildRemoteRefCandidates(dependency.version);
  let lastError: unknown = null;

  nodeFs.mkdirSync(parentDir, { recursive: true });

  for (const ref of candidateRefs) {
    try {
      execFileSync("git", ["clone", "--depth", "1", "--branch", ref, dependency.url, tempDir], {
        stdio: "pipe",
      });

      const resolvedCommit = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], {
        stdio: "pipe",
      }).toString().trim();
      const provenance: BuildProvenanceEntry = {
        source: { kind: "git", url: dependency.url },
        version: dependency.version,
        resolvedCommit,
        cacheKey,
      };
      const metadata: MaterializedRemoteMetadata = {
        ...provenance,
        resolvedRef: ref,
      };

      nodeFs.writeFileSync(
        nodePath.join(tempDir, REMOTE_METADATA_FILENAME),
        JSON.stringify(metadata, null, 2) + "\n",
        "utf8",
      );
      nodeFs.rmSync(nodePath.join(tempDir, ".git"), { recursive: true, force: true });
      nodeFs.renameSync(tempDir, rootDir);
      return provenance;
    } catch (error: any) {
      lastError = error;
      nodeFs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  throw new Error(
    `Failed to materialize remote dependency ${dependency.url}@${dependency.version}: `
      + `unable to clone any of ${candidateRefs.map((ref) => JSON.stringify(ref)).join(", ")}`
      + `${formatGitCloneError(lastError)}`,
  );
}

function computeRemoteCacheDir(cacheRoot: string, url: string, version: string): string {
  const parsed = tryParseRemoteUrl(url);
  const versionSegment = sanitizeCachePathSegment(version);

  if (!parsed) {
    return nodePath.join(cacheRoot, "remote", sanitizeCachePathSegment(url), versionSegment);
  }

  return nodePath.join(
    cacheRoot,
    parsed.host,
    ...parsed.pathSegments.map((segment) => sanitizeCachePathSegment(segment)),
    versionSegment,
  );
}

function tryParseRemoteUrl(url: string): { host: string; pathSegments: string[] } | null {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment, index, segments) => (
        index === segments.length - 1 && segment.endsWith(".git")
          ? segment.slice(0, -4)
          : segment
      ))
      .filter((segment) => segment.length > 0);
    if (pathSegments.length === 0) {
      return null;
    }

    return {
      host: sanitizeCachePathSegment(parsed.host),
      pathSegments,
    };
  } catch {
    return null;
  }
}

function sanitizeCachePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    return "pkg";
  }
  return sanitized;
}

function buildRemoteRefCandidates(version: string): string[] {
  const candidates = [version];
  if (version.startsWith("v")) {
    candidates.push(version.slice(1));
  } else {
    candidates.push(`v${version}`);
  }

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
}

function createRemoteCacheKey(url: string, version: string): string {
  return `git:${url}#${version}`;
}

function readRemoteDependencyProvenance(rootDir: string): BuildProvenanceEntry | null {
  const metadataPath = nodePath.join(rootDir, REMOTE_METADATA_FILENAME);
  if (!nodeFs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(metadataPath, "utf8")) as Partial<MaterializedRemoteMetadata>;
    if (
      !parsed
      || !parsed.source
      || typeof parsed.source.kind !== "string"
      || typeof parsed.source.url !== "string"
      || typeof parsed.version !== "string"
    ) {
      return null;
    }

    return {
      source: {
        kind: parsed.source.kind,
        url: parsed.source.url,
      },
      version: parsed.version,
      resolvedCommit: typeof parsed.resolvedCommit === "string" ? parsed.resolvedCommit : null,
      cacheKey: typeof parsed.cacheKey === "string" ? parsed.cacheKey : null,
    };
  } catch {
    return null;
  }
}

function formatGitCloneError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const stderr = "stderr" in error && typeof error.stderr?.toString === "function"
    ? error.stderr.toString().trim()
    : "";
  const message = "message" in error && typeof error.message === "string"
    ? error.message
    : "";
  const detail = stderr || message;
  return detail.length === 0 ? "" : ` (${detail})`;
}

function getDefaultPackageCacheRoot(): string {
  return nodePath.join(nodeOs.homedir(), ".doof", "packages");
}