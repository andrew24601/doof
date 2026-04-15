import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  toPortablePath,
} from "./path-utils.js";
import {
  getImplicitStdDependencyConfig,
  getImplicitStdDependencyNames,
  getStdPackageShortName,
  isImplicitStdSelfReference,
} from "./std-packages.js";

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
  remotePackage: ResolvedRemotePackage | null;
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
  kind: string;
  url: string;
  version: string;
  commit: string | null;
  referencedFrom: string[];
}

export interface ResolvedRemotePackage {
  kind: "git";
  url: string;
  version: string;
  commit: string;
  pathSegments: string[];
}

export interface PackageOutputPaths {
  byRootDir: ReadonlyMap<string, string>;
}

export interface RemoteDependencyContext {
  dependencyName: string;
  packageRootDir: string;
  manifestPath: string;
  cacheRoot: string;
}

export interface ResolvedRemoteDependency {
  rootDir: string;
  package: ResolvedRemotePackage;
}

export interface LoadPackageGraphOptions {
  cacheRoot?: string;
  implicitStdDependencies?: boolean;
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
  remotePackage: ResolvedRemotePackage | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
}

type DiscoveredDependency =
  | {
    kind: "local";
    dependencyName: string;
    rootDir: string;
  }
  | {
    kind: "remote";
    dependencyName: string;
    packageKey: string;
    requestedVersion: string;
    requestedRootDir: string;
  };

interface DiscoveredPackage {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
  dependencies: DiscoveredDependency[];
  remotePackage: ResolvedRemotePackage | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
}

interface RemotePackageSelection {
  packageKey: string;
  version: string;
  rootDir: string;
  remotePackage: ResolvedRemotePackage;
}

interface PackageLoadContext {
  cacheRoot: string;
  implicitStdDependencies: boolean;
  resolveRemoteDependency: (
    dependency: DoofRemoteDependencyConfig,
    context: RemoteDependencyContext,
  ) => ResolvedRemoteDependency;
  discoveredPackages: Map<string, DiscoveredPackage>;
  remotePackagesByKey: Map<string, RemotePackageSelection[]>;
}

interface MaterializedRemoteMetadata {
  kind: string;
  url: string;
  version: string;
  commit: string;
  pathSegments: string[];
  resolvedRef: string | null;
}

interface CachedRemoteVersionsFile {
  schemaVersion: 1;
  kind: "git";
  url: string;
  versions: Record<string, CachedRemoteVersionEntry>;
}

interface CachedRemoteVersionEntry {
  commit: string;
  resolvedRef: string | null;
}

interface RemotePackageCoordinate {
  key: string;
  pathSegments: string[];
}

const MANIFEST_FILENAME = "doof.json";
const REMOTE_METADATA_FILENAME = ".doof-remote.json";
const REMOTE_VERSIONS_FILENAME = "versions.json";

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

  const loadingStack: string[] = [];
  const loadContext: PackageLoadContext = {
    cacheRoot: options.cacheRoot ?? getDefaultPackageCacheRoot(),
    implicitStdDependencies: options.implicitStdDependencies ?? false,
    resolveRemoteDependency: options.resolveRemoteDependency ?? defaultResolveRemoteDependency,
    discoveredPackages: new Map<string, DiscoveredPackage>(),
    remotePackagesByKey: new Map<string, RemotePackageSelection[]>(),
  };
  discoverPackageFromManifest(fileSystem, manifestPath, loadingStack, loadContext);
  const selectedRemoteRoots = selectRemotePackageRoots(loadContext.remotePackagesByKey);
  const finalizedPackages = new Map<string, MutableLoadedPackage>();
  const rootPackage = finalizeLoadedPackage(
    dirnameFsPath(resolveFsPath(manifestPath)),
    loadContext.discoveredPackages,
    selectedRemoteRoots,
    finalizedPackages,
  );
  return {
    rootPackage,
    packages: [...finalizedPackages.values()].sort((left, right) => left.rootDir.localeCompare(right.rootDir)),
  };
}

/**
 * Materialize a remote dependency directly by URL/version into the package cache.
 * This is a small helper used by the stdlib layer to fetch implicit std/* packages
 * on-demand. Returns the resolved root dir and package metadata.
 */
export function materializeRemoteDependencyByUrl(
  url: string,
  version: string,
  cacheRoot?: string,
): ResolvedRemoteDependency {
  const dependency: DoofRemoteDependencyConfig = { url, version };
  const ctx: RemoteDependencyContext = {
    dependencyName: "<implicit>",
    packageRootDir: "/",
    manifestPath: "",
    cacheRoot: cacheRoot ?? getDefaultPackageCacheRoot(),
  };
  return defaultResolveRemoteDependency(dependency, ctx);
}

export function createBuildProvenance(graph: PackageGraph): BuildProvenance {
  const packagesByRoot = new Map(graph.packages.map((pkg) => [pkg.rootDir, pkg]));
  const provenanceByKey = new Map<string, BuildProvenanceEntry>();
  const visitedEdges = new Set<string>();

  function visitPackage(pkg: LoadedPackage) {
    for (const dependencyRoot of pkg.dependencyRoots.values()) {
      const dependency = packagesByRoot.get(dependencyRoot);
      if (!dependency) {
        continue;
      }

      const edgeKey = `${pkg.rootDir}\u0000${dependencyRoot}`;
      if (visitedEdges.has(edgeKey)) {
        continue;
      }
      visitedEdges.add(edgeKey);

      if (dependency.remotePackage) {
        const referencer = pkg.remotePackage?.url ?? ".";
        const key = [
          dependency.remotePackage.kind,
          dependency.remotePackage.url,
          dependency.remotePackage.version,
          dependency.remotePackage.commit,
        ].join("\u0000");
        const existing = provenanceByKey.get(key) ?? {
          kind: dependency.remotePackage.kind,
          url: dependency.remotePackage.url,
          version: dependency.remotePackage.version,
          commit: dependency.remotePackage.commit,
          referencedFrom: [],
        };
        if (!existing.referencedFrom.includes(referencer)) {
          existing.referencedFrom.push(referencer);
          existing.referencedFrom.sort();
        }
        provenanceByKey.set(key, existing);
      }

      visitPackage(dependency);
    }
  }

  visitPackage(graph.rootPackage);

  const dependencies = [...provenanceByKey.values()].sort((left, right) => {
    const leftKey = `${left.url}\u0000${left.version}`;
    const rightKey = `${right.url}\u0000${right.version}`;
    return leftKey.localeCompare(rightKey);
  });
  return { dependencies };
}

export function createPackageOutputPaths(graph: PackageGraph, entryPath: string): PackageOutputPaths {
  const baseDir = dirnameFsPath(resolveFsPath(entryPath));
  const byRootDir = new Map<string, string>();

  for (const pkg of graph.packages) {
    if (pkg.remotePackage) {
      byRootDir.set(pkg.rootDir, [".packages", ...pkg.remotePackage.pathSegments].join("/"));
      continue;
    }

    byRootDir.set(pkg.rootDir, anchorOutputRelativePath(toPortablePath(relativeFsPath(baseDir, pkg.rootDir))));
  }

  return { byRootDir };
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

function discoverPackageFromManifest(
  fileSystem: FileSystem,
  manifestPath: string,
  loadingStack: string[],
  context: PackageLoadContext,
): DiscoveredPackage {
  const normalizedManifestPath = resolveFsPath(manifestPath);
  const rootDir = dirnameFsPath(normalizedManifestPath);
  const cached = context.discoveredPackages.get(rootDir);
  if (cached) {
    return cached;
  }

  if (loadingStack.includes(rootDir)) {
    const cycle = [...loadingStack, rootDir].join(" -> ");
    throw new Error(`Package dependency cycle detected: ${cycle}`);
  }

  const manifest = readManifestOrThrow(fileSystem, normalizedManifestPath);
  const discovered: DiscoveredPackage = {
    rootDir,
    manifestPath: normalizedManifestPath,
    manifest,
    dependencies: [],
    remotePackage: null,
    nativeBuild: normalizeNativeBuildConfig(manifest.build?.native, rootDir, normalizedManifestPath),
    buildTarget: normalizeBuildTargetConfig(manifest.build, rootDir, normalizedManifestPath),
  };
  context.discoveredPackages.set(rootDir, discovered);

  loadingStack.push(rootDir);

  try {
    for (const [dependencyName, dependency] of Object.entries(manifest.dependencies)) {
      if ("path" in dependency) {
        const dependencyRoot = resolveFsPathFrom(rootDir, dependency.path);
        const dependencyManifestPath = joinFsPath(dependencyRoot, MANIFEST_FILENAME);
        const loadedDependency = discoverPackageFromManifest(
          fileSystem,
          dependencyManifestPath,
          loadingStack,
          context,
        );
        discovered.dependencies.push({
          kind: "local",
          dependencyName,
          rootDir: loadedDependency.rootDir,
        });
        continue;
      }

      const resolvedRemoteDependency = context.resolveRemoteDependency(dependency, {
        dependencyName,
        packageRootDir: rootDir,
        manifestPath: normalizedManifestPath,
        cacheRoot: context.cacheRoot,
      });
      const dependencyRoot = resolveFsPath(resolvedRemoteDependency.rootDir);
      const remotePackage = normalizeResolvedRemotePackage(dependency, resolvedRemoteDependency);
      const packageKey = remotePackage.pathSegments.join("/");
      const selections = context.remotePackagesByKey.get(packageKey) ?? [];
      if (!selections.some((entry) => entry.rootDir === dependencyRoot)) {
        selections.push({
          packageKey,
          version: remotePackage.version,
          rootDir: dependencyRoot,
          remotePackage,
        });
        context.remotePackagesByKey.set(packageKey, selections);
      }
      const remoteDiscovered = context.discoveredPackages.get(dependencyRoot);
      if (remoteDiscovered) {
        remoteDiscovered.remotePackage = remotePackage;
      }
      const dependencyManifestPath = joinFsPath(dependencyRoot, MANIFEST_FILENAME);
      const loadedDependency = discoverPackageFromManifest(
        fileSystem,
        dependencyManifestPath,
        loadingStack,
        context,
      );
      loadedDependency.remotePackage = remotePackage;
      discovered.dependencies.push({
        kind: "remote",
        dependencyName,
        packageKey,
        requestedVersion: remotePackage.version,
        requestedRootDir: dependencyRoot,
      });
    }

    if (context.implicitStdDependencies) {
      for (const dependencyName of getImplicitStdDependencyNames()) {
        if (manifest.dependencies[dependencyName] !== undefined) {
          continue;
        }
        if (isImplicitStdSelfReference(manifest.name, dependencyName)) {
          continue;
        }

        const shortName = getStdPackageShortName(dependencyName);
        if (!shortName) {
          continue;
        }

        const dependency = getImplicitStdDependencyConfig(shortName);
        if (!dependency) {
          continue;
        }

        const resolvedRemoteDependency = context.resolveRemoteDependency(dependency, {
          dependencyName,
          packageRootDir: rootDir,
          manifestPath: normalizedManifestPath,
          cacheRoot: context.cacheRoot,
        });
        const dependencyRoot = resolveFsPath(resolvedRemoteDependency.rootDir);
        const remotePackage = normalizeResolvedRemotePackage(dependency, resolvedRemoteDependency);
        const packageKey = remotePackage.pathSegments.join("/");
        const selections = context.remotePackagesByKey.get(packageKey) ?? [];
        if (!selections.some((entry) => entry.rootDir === dependencyRoot)) {
          selections.push({
            packageKey,
            version: remotePackage.version,
            rootDir: dependencyRoot,
            remotePackage,
          });
          context.remotePackagesByKey.set(packageKey, selections);
        }
        const remoteDiscovered = context.discoveredPackages.get(dependencyRoot);
        if (remoteDiscovered) {
          remoteDiscovered.remotePackage = remotePackage;
        }
        const dependencyManifestPath = joinFsPath(dependencyRoot, MANIFEST_FILENAME);
        const loadedDependency = discoverPackageFromManifest(
          fileSystem,
          dependencyManifestPath,
          loadingStack,
          context,
        );
        loadedDependency.remotePackage = remotePackage;
        discovered.dependencies.push({
          kind: "remote",
          dependencyName,
          packageKey,
          requestedVersion: remotePackage.version,
          requestedRootDir: dependencyRoot,
        });
      }
    }
  } finally {
    loadingStack.pop();
  }

  return discovered;
}

function selectRemotePackageRoots(
  remotePackagesByKey: ReadonlyMap<string, readonly RemotePackageSelection[]>,
): ReadonlyMap<string, string> {
  const selected = new Map<string, string>();

  for (const [packageKey, candidates] of remotePackagesByKey) {
    const winner = [...candidates].sort((left, right) => compareRequestedVersions(right.version, left.version))[0];
    if (winner) {
      selected.set(packageKey, winner.rootDir);
    }
  }

  return selected;
}

function finalizeLoadedPackage(
  rootDir: string,
  discoveredPackages: ReadonlyMap<string, DiscoveredPackage>,
  selectedRemoteRoots: ReadonlyMap<string, string>,
  finalizedPackages: Map<string, MutableLoadedPackage>,
): LoadedPackage {
  const cached = finalizedPackages.get(rootDir);
  if (cached) {
    return cached;
  }

  const discovered = discoveredPackages.get(rootDir);
  if (!discovered) {
    throw new Error(`Package graph is missing discovered package ${rootDir}`);
  }

  const finalized: MutableLoadedPackage = {
    rootDir: discovered.rootDir,
    manifestPath: discovered.manifestPath,
    manifest: discovered.manifest,
    dependencyRoots: new Map<string, string>(),
    remotePackage: discovered.remotePackage,
    nativeBuild: discovered.nativeBuild,
    buildTarget: discovered.buildTarget,
  };
  finalizedPackages.set(rootDir, finalized);

  for (const dependency of discovered.dependencies) {
    const dependencyRoot = dependency.kind === "local"
      ? dependency.rootDir
      : selectedRemoteRoots.get(dependency.packageKey) ?? dependency.requestedRootDir;
    const finalizedDependency = finalizeLoadedPackage(
      dependencyRoot,
      discoveredPackages,
      selectedRemoteRoots,
      finalizedPackages,
    );
    finalized.dependencyRoots.set(dependency.dependencyName, finalizedDependency.rootDir);
  }

  return finalized;
}

function normalizeResolvedRemotePackage(
  dependency: DoofRemoteDependencyConfig,
  resolvedRemoteDependency: ResolvedRemoteDependency,
): ResolvedRemotePackage {
  if (resolvedRemoteDependency.package) {
    return {
      ...resolvedRemoteDependency.package,
      pathSegments: [...resolvedRemoteDependency.package.pathSegments],
    };
  }

  const legacy = resolvedRemoteDependency as ResolvedRemoteDependency & {
    provenance?: {
      source?: { url?: string };
      version?: string;
      resolvedCommit?: string | null;
    };
  };
  const coordinate = resolveRemotePackageCoordinate(dependency.url);
  return {
    kind: "git",
    url: legacy.provenance?.source?.url ?? dependency.url,
    version: legacy.provenance?.version ?? dependency.version,
    commit: legacy.provenance?.resolvedCommit ?? sanitizeCachePathSegment(nodePath.basename(resolvedRemoteDependency.rootDir)),
    pathSegments: coordinate.pathSegments,
  };
}

function anchorOutputRelativePath(relativePath: string): string {
  const parts = relativePath.split("/");
  while (parts.length > 0 && parts[0] === "..") {
    parts.shift();
  }
  return parts.join("/");
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
  if (value.length === 0 || value.includes("\\")) {
    return false;
  }

  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
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
  const coordinate = resolveRemotePackageCoordinate(dependency.url);
  const packageDir = nodePath.join(context.cacheRoot, ...coordinate.pathSegments);
  const cachedVersions = readRemoteVersionsFile(packageDir);
  const cachedVersion = cachedVersions?.versions[dependency.version] ?? null;
  const rootDir = computeRemoteCacheDir(context.cacheRoot, dependency.url, cachedVersion?.commit ?? dependency.version);
  const manifestPath = nodePath.join(rootDir, MANIFEST_FILENAME);

  if (cachedVersion) {
    const cachedRootDir = computeRemoteCacheDir(context.cacheRoot, dependency.url, cachedVersion.commit);
    const cachedManifestPath = nodePath.join(cachedRootDir, MANIFEST_FILENAME);
    if (nodeFs.existsSync(cachedManifestPath)) {
      return {
        rootDir: cachedRootDir,
        package: readRemoteDependencyMetadata(cachedRootDir) ?? {
          kind: "git",
          url: dependency.url,
          version: dependency.version,
          commit: cachedVersion.commit,
          pathSegments: coordinate.pathSegments,
        },
      };
    }
  }

  if (nodeFs.existsSync(manifestPath)) {
    return {
      rootDir,
      package: readRemoteDependencyMetadata(rootDir) ?? {
        kind: "git",
        url: dependency.url,
        version: dependency.version,
        commit: nodePath.basename(rootDir),
        pathSegments: coordinate.pathSegments,
      },
    };
  }

  if (nodeFs.existsSync(rootDir)) {
    nodeFs.rmSync(rootDir, { recursive: true, force: true });
  }

  const materializedPackage = materializeRemoteDependency(dependency, context.cacheRoot, coordinate, cachedVersions ?? undefined);
  return { rootDir: computeRemoteCacheDir(context.cacheRoot, dependency.url, materializedPackage.commit), package: materializedPackage };
}

function materializeRemoteDependency(
  dependency: DoofRemoteDependencyConfig,
  cacheRoot: string,
  coordinate: RemotePackageCoordinate,
  cachedVersions?: CachedRemoteVersionsFile,
): ResolvedRemotePackage {
  const packageDir = nodePath.join(cacheRoot, ...coordinate.pathSegments);
  const cachedVersion = cachedVersions?.versions[dependency.version] ?? null;
  if (cachedVersion) {
    return materializeRemoteDependencyFromCommit(dependency, packageDir, coordinate, cachedVersion.commit, cachedVersion.resolvedRef);
  }

  const candidateRefs = buildRemoteRefCandidates(dependency.version);
  let lastError: unknown = null;

  nodeFs.mkdirSync(packageDir, { recursive: true });

  for (const ref of candidateRefs) {
    try {
      const materialized = cloneRemoteDependencyToCommitDir(dependency, packageDir, coordinate, ["clone", "--depth", "1", "--branch", ref, dependency.url], ref);
      writeRemoteVersionsFile(packageDir, dependency.url, {
        ...(cachedVersions?.versions ?? {}),
        [dependency.version]: {
          commit: materialized.commit,
          resolvedRef: ref,
        },
      });
      return materialized;
    } catch (error: any) {
      lastError = error;
    }
  }

  throw new Error(
    `Failed to materialize remote dependency ${dependency.url}@${dependency.version}: `
      + `unable to clone any of ${candidateRefs.map((ref) => JSON.stringify(ref)).join(", ")}`
      + `${formatGitCloneError(lastError)}`,
  );
}

function materializeRemoteDependencyFromCommit(
  dependency: DoofRemoteDependencyConfig,
  packageDir: string,
  coordinate: RemotePackageCoordinate,
  commit: string,
  resolvedRef: string | null,
): ResolvedRemotePackage {
  if (resolvedRef) {
    try {
      return cloneRemoteDependencyToCommitDir(
        dependency,
        packageDir,
        coordinate,
        ["clone", "--depth", "1", "--branch", resolvedRef, dependency.url],
        resolvedRef,
      );
    } catch {
      // Keep the cached commit authoritative even if the original tag/ref disappeared.
    }
  }

  const rootDir = nodePath.join(packageDir, commit);
  const parentDir = nodePath.dirname(rootDir);
  const tempDir = `${rootDir}.tmp-${process.pid}-${Date.now()}`;

  nodeFs.mkdirSync(parentDir, { recursive: true });

  try {
    execFileSync("git", ["init", tempDir], { stdio: "pipe" });
    execFileSync("git", ["-C", tempDir, "remote", "add", "origin", dependency.url], { stdio: "pipe" });
    execFileSync("git", ["-C", tempDir, "fetch", "--depth", "1", "origin", commit], { stdio: "pipe" });
    execFileSync("git", ["-C", tempDir, "checkout", "FETCH_HEAD"], { stdio: "pipe" });
    writeRemoteDependencyMetadata(tempDir, {
      kind: "git",
      url: dependency.url,
      version: dependency.version,
      commit,
      pathSegments: coordinate.pathSegments,
      resolvedRef: null,
    });
    nodeFs.rmSync(nodePath.join(tempDir, ".git"), { recursive: true, force: true });
    nodeFs.renameSync(tempDir, rootDir);
    return {
      kind: "git",
      url: dependency.url,
      version: dependency.version,
      commit,
      pathSegments: coordinate.pathSegments,
    };
  } catch (error: any) {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(
      `Failed to materialize remote dependency ${dependency.url}@${dependency.version} at ${commit}`
        + `${formatGitCloneError(error)}`,
    );
  }
}

function cloneRemoteDependencyToCommitDir(
  dependency: DoofRemoteDependencyConfig,
  packageDir: string,
  coordinate: RemotePackageCoordinate,
  cloneArgsPrefix: string[],
  resolvedRef: string | null,
): ResolvedRemotePackage {
  const tempDir = `${packageDir}.tmp-${process.pid}-${Date.now()}`;
  execFileSync("git", [...cloneArgsPrefix, tempDir], { stdio: "pipe" });
  const commit = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], {
    stdio: "pipe",
  }).toString().trim();
  const rootDir = nodePath.join(packageDir, commit);

  if (nodeFs.existsSync(rootDir)) {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
    return readRemoteDependencyMetadata(rootDir) ?? {
      kind: "git",
      url: dependency.url,
      version: dependency.version,
      commit,
      pathSegments: coordinate.pathSegments,
    };
  }

  writeRemoteDependencyMetadata(tempDir, {
    kind: "git",
    url: dependency.url,
    version: dependency.version,
    commit,
    pathSegments: coordinate.pathSegments,
    resolvedRef,
  });
  nodeFs.rmSync(nodePath.join(tempDir, ".git"), { recursive: true, force: true });
  nodeFs.renameSync(tempDir, rootDir);
  return {
    kind: "git",
    url: dependency.url,
    version: dependency.version,
    commit,
    pathSegments: coordinate.pathSegments,
  };
}

function computeRemoteCacheDir(cacheRoot: string, url: string, commit: string): string {
  const coordinate = resolveRemotePackageCoordinate(url);
  return nodePath.join(cacheRoot, ...coordinate.pathSegments, sanitizeCachePathSegment(commit));
}

function resolveRemotePackageCoordinate(url: string): RemotePackageCoordinate {
  const parsed = tryParseRemoteUrl(url);
  if (parsed && parsed.pathSegments.length >= 2) {
    const pathSegments = parsed.pathSegments.slice(-2).map((segment) => sanitizeCachePathSegment(segment));
    return {
      key: pathSegments.join("/"),
      pathSegments,
    };
  }

  const fallbackBase = sanitizeCachePathSegment(nodePath.basename(url) || "pkg");
  const fallbackHash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  const pathSegments = ["remote", `${fallbackBase}-${fallbackHash}`];
  return {
    key: pathSegments.join("/"),
    pathSegments,
  };
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

function readRemoteDependencyMetadata(rootDir: string): ResolvedRemotePackage | null {
  const metadataPath = nodePath.join(rootDir, REMOTE_METADATA_FILENAME);
  if (!nodeFs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(metadataPath, "utf8")) as Partial<MaterializedRemoteMetadata>;
    if (
      !parsed
      || typeof parsed.kind !== "string"
      || typeof parsed.url !== "string"
      || typeof parsed.version !== "string"
      || typeof parsed.commit !== "string"
      || !Array.isArray(parsed.pathSegments)
      || !parsed.pathSegments.every((segment) => typeof segment === "string")
    ) {
      return null;
    }

    return {
      kind: parsed.kind === "git" ? "git" : "git",
      url: parsed.url,
      version: parsed.version,
      commit: parsed.commit,
      pathSegments: [...parsed.pathSegments] as string[],
    };
  } catch {
    return null;
  }
}

function writeRemoteDependencyMetadata(rootDir: string, metadata: MaterializedRemoteMetadata): void {
  nodeFs.writeFileSync(
    nodePath.join(rootDir, REMOTE_METADATA_FILENAME),
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8",
  );
}

function readRemoteVersionsFile(packageDir: string): CachedRemoteVersionsFile | null {
  const versionsPath = nodePath.join(packageDir, REMOTE_VERSIONS_FILENAME);
  if (!nodeFs.existsSync(versionsPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(versionsPath, "utf8")) as Partial<CachedRemoteVersionsFile>;
    if (
      !parsed
      || parsed.schemaVersion !== 1
      || parsed.kind !== "git"
      || typeof parsed.url !== "string"
      || !parsed.versions
      || typeof parsed.versions !== "object"
    ) {
      return null;
    }

    const versions: Record<string, CachedRemoteVersionEntry> = {};
    for (const [version, entry] of Object.entries(parsed.versions)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const candidate = entry as Partial<CachedRemoteVersionEntry>;
      if (typeof candidate.commit !== "string") {
        continue;
      }
      versions[version] = {
        commit: candidate.commit,
        resolvedRef: typeof candidate.resolvedRef === "string" ? candidate.resolvedRef : null,
      };
    }

    return {
      schemaVersion: 1,
      kind: "git",
      url: parsed.url,
      versions,
    };
  } catch {
    return null;
  }
}

function writeRemoteVersionsFile(
  packageDir: string,
  url: string,
  versions: Record<string, CachedRemoteVersionEntry>,
): void {
  nodeFs.mkdirSync(packageDir, { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(packageDir, REMOTE_VERSIONS_FILENAME),
    JSON.stringify({
      schemaVersion: 1,
      kind: "git",
      url,
      versions,
    }, null, 2) + "\n",
    "utf8",
  );
}

function compareRequestedVersions(left: string, right: string): number {
  const leftParts = parseComparableVersion(left);
  const rightParts = parseComparableVersion(right);
  if (leftParts && rightParts) {
    const maxLength = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < maxLength; index += 1) {
      const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (delta !== 0) {
        return delta;
      }
    }
  }

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function parseComparableVersion(version: string): number[] | null {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) {
    return null;
  }
  return normalized.split(".").map((part) => Number.parseInt(part, 10));
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