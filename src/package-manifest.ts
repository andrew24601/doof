import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type { NativeBuildOptions } from "./emitter-module.js";
import type { FileSystem } from "./resolver.js";
import {
  IOS_MANAGED_INFO_PLIST_KEYS,
  MACOS_MANAGED_INFO_PLIST_KEYS,
  validateCustomInfoPlistKeys,
  type AppInfoPlist,
  type AppInfoPlistValue,
} from "./app-info-plist.js";
import {
  DEFAULT_MACOS_APP_CATEGORY,
  DEFAULT_MACOS_MINIMUM_SYSTEM_VERSION,
  DEFAULT_IOS_MINIMUM_DEPLOYMENT_TARGET,
  type IOSAppDestination,
  isDoofBuildTarget,
  normalizeMacOSAppResourceDestination,
  normalizeIOSAppResourceDestination,
  type DoofBuildTarget,
  type DoofIOSAppConfig,
  type DoofMacOSAppConfig,
  type DoofMacOSAppResourceConfig,
  type DoofEmbeddedLibraryConfig,
  type ResolvedDoofEmbeddedLibrary,
  type ResolvedDoofBuildTarget,
  type ResolvedDoofIOSAppConfig,
  type ResolvedDoofMacOSAppConfig,
} from "./build-targets.js";
import type { ResolvedDoofResource } from "./resource-patterns.js";
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
  buildIOSDeviceTargetTriple,
  buildIOSSimulatorTargetTriple,
} from "./ios-app-target-node.js";
import {
  getImplicitStdDependencyConfig,
  getImplicitStdDependencyNames,
  getStdPackageShortName,
  isImplicitStdSelfReference,
  resolveStdlibOverridePath,
} from "./std-packages.js";
import { getImplicitStdDependencyLocalRoot } from "./std-packages-node.js";

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
  iosSimulator?: DoofNativeBuildFragment;
  iosDevice?: DoofNativeBuildFragment;
  wasm?: DoofNativeBuildFragment;
  linux?: DoofNativeBuildFragment;
  windows?: DoofNativeBuildFragment;
}

export interface DoofBuildConfig {
  entry?: string;
  buildDir?: string;
  target?: DoofBuildTarget;
  targetExecutableName?: string;
  resources?: DoofMacOSAppResourceConfig[];
  macosApp?: DoofMacOSAppConfig;
  iosApp?: DoofIOSAppConfig;
  package?: DoofPackageConfig;
  native?: DoofNativeBuildConfig;
}

export type MacOSPackageSigning = "developer-id" | "ad-hoc";

export interface DoofMacOSPackageConfig {
  signing?: MacOSPackageSigning;
  identity?: string;
  sandbox?: boolean;
  entitlements?: string;
}

export interface DoofIOSPackageConfig {
  identity?: string;
  provisioningProfile?: string;
}

export interface DoofPackageConfig {
  distDir?: string;
  macos?: DoofMacOSPackageConfig;
  ios?: DoofIOSPackageConfig;
}

export interface ResolvedDoofPackageConfig {
  distDir: string;
  macos: DoofMacOSPackageConfig & { entitlements?: string };
  ios: DoofIOSPackageConfig & { provisioningProfile?: string };
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

export function resolvePackageReleaseConfig(context: ResolvedPackageBuildContext): ResolvedDoofPackageConfig {
  const config = context.manifest.build?.package;
  return {
    distDir: normalizePackagePath(config?.distDir ?? "dist", context.rootDir, context.manifestPath, "build.package.distDir"),
    macos: {
      ...config?.macos,
      entitlements: config?.macos?.entitlements === undefined
        ? undefined
        : normalizePackagePath(
          config.macos.entitlements,
          context.rootDir,
          context.manifestPath,
          "build.package.macos.entitlements",
        ),
    },
    ios: {
      ...config?.ios,
      provisioningProfile: config?.ios?.provisioningProfile === undefined
        ? undefined
        : normalizePackagePath(
          config.ios.provisioningProfile,
          context.rootDir,
          context.manifestPath,
          "build.package.ios.provisioningProfile",
        ),
    },
  };
}

export interface DoofLocalDependencyConfig {
  path: string;
}

export interface DoofRemoteDependencyConfig {
  url: string;
  version: string;
}

export type DoofDependencyConfig = DoofLocalDependencyConfig | DoofRemoteDependencyConfig;

export interface DoofArchiveExternalDependencyConfig {
  kind: "archive";
  url: string;
  sha256: string;
  destination: string;
  stripComponents: number;
  copyFiles: DoofExternalDependencyCopyFileConfig[];
  commands: DoofExternalDependencyCommandConfig[];
}

export interface DoofExternalDependencyCopyFileConfig {
  from: string;
  to: string;
}

export interface DoofExternalDependencyCommandConfig {
  program: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
}

export interface DoofGitExternalDependencyConfig {
  kind: "git";
  url: string;
  ref: string;
  commit: string;
  destination: string;
  commands: DoofExternalDependencyCommandConfig[];
}

export type DoofExternalDependencyConfig =
  | DoofArchiveExternalDependencyConfig
  | DoofGitExternalDependencyConfig;

export interface DoofManifest {
  name?: string;
  version?: string;
  license?: string;
  build?: DoofBuildConfig;
  dependencies: Record<string, DoofDependencyConfig>;
  externalDependencies: Record<string, DoofExternalDependencyConfig>;
}

export interface LoadedPackage {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
  dependencyRoots: ReadonlyMap<string, string>;
  remotePackage: ResolvedRemotePackage | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
  resources: ResolvedDoofResource[];
  externalDependencySentinelPaths: readonly string[];
  externalDependencyNativeTargetContext: ExternalDependencyNativeTargetContext;
}

export interface PackageGraph {
  rootPackage: LoadedPackage;
  packages: LoadedPackage[];
}

export interface BuildProvenance {
  dependencies: BuildProvenanceEntry[];
  externalDependencies: ExternalDependencyProvenanceEntry[];
}

export interface BuildProvenanceEntry {
  kind: string;
  url: string;
  version: string;
  commit: string | null;
  referencedFrom: string[];
}

export interface ExternalDependencyProvenanceEntry {
  name: string;
  kind: "archive" | "git";
  url: string;
  destination: string;
  sha256?: string;
  ref?: string;
  commit?: string;
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
  /**
   * Raw package names keyed by package root. Generated C++ namespaces use the
   * package's own doof.json name for both root and dependency packages so a
   * package keeps the same namespace whether compiled directly or as a
   * dependency.
   */
  namespaceNameByRootDir?: ReadonlyMap<string, string>;
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
  buildTargetOverride?: DoofBuildTarget;
  iosDestinationOverride?: IOSAppDestination;
  acquireExternalDependency?: (
    dependencyName: string,
    dependency: DoofExternalDependencyConfig,
    context: ExternalDependencyContext,
  ) => void;
  resolveRemoteDependency?: (
    dependency: DoofRemoteDependencyConfig,
    context: RemoteDependencyContext,
  ) => ResolvedRemoteDependency;
}

export interface ExternalDependencyContext {
  packageRootDir: string;
  manifestPath: string;
  nativeTarget: string;
  sdkPath: string;
  targetTriple: string;
  configureHost: string;
}

interface MutableLoadedPackage {
  rootDir: string;
  manifestPath: string;
  manifest: DoofManifest;
  dependencyRoots: Map<string, string>;
  remotePackage: ResolvedRemotePackage | null;
  nativeBuild: ResolvedPackageNativeBuild;
  buildTarget: ResolvedDoofBuildTarget | null;
  resources: ResolvedDoofResource[];
  externalDependencySentinelPaths: string[];
  externalDependencyNativeTargetContext: ExternalDependencyNativeTargetContext;
}

interface CompactAppConfig {
  target?: DoofBuildTarget;
  executable?: string;
  id?: string;
  title?: string;
  icon?: string;
  resources?: DoofMacOSAppResourceConfig[];
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
  resources: ResolvedDoofResource[];
  externalDependencySentinelPaths: string[];
  externalDependencyNativeTargetContext: ExternalDependencyNativeTargetContext;
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
  effectiveBuildTarget: DoofBuildTarget | undefined;
  effectiveIOSDestination: IOSAppDestination;
  rootManifestPath: string;
  resolveRemoteDependency: (
    dependency: DoofRemoteDependencyConfig,
    context: RemoteDependencyContext,
  ) => ResolvedRemoteDependency;
  acquireExternalDependency: (
    dependencyName: string,
    dependency: DoofExternalDependencyConfig,
    context: ExternalDependencyContext,
  ) => void;
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
const EXTERNAL_METADATA_FILENAME = ".doof-external.json";

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

  const normalizedManifestPath = resolveFsPath(manifestPath);
  const rootManifest = readManifestOrThrow(fileSystem, normalizedManifestPath);
  const loadingStack: string[] = [];
  const loadContext: PackageLoadContext = {
    cacheRoot: options.cacheRoot ?? getDefaultPackageCacheRoot(),
    implicitStdDependencies: options.implicitStdDependencies ?? false,
    effectiveBuildTarget: options.buildTargetOverride ?? rootManifest.build?.target,
    effectiveIOSDestination: options.iosDestinationOverride ?? "simulator",
    rootManifestPath: normalizedManifestPath,
    resolveRemoteDependency: options.resolveRemoteDependency ?? defaultResolveRemoteDependency,
    acquireExternalDependency: options.acquireExternalDependency ?? defaultAcquireExternalDependency,
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

export function narrowPackageGraphForBuild(
  graph: PackageGraph,
  usedModulePaths: Iterable<string>,
): PackageGraph {
  const packagesByRoot = new Map(graph.packages.map((pkg) => [pkg.rootDir, pkg]));
  const selectedRoots = new Set<string>([graph.rootPackage.rootDir]);

  const findOwningPackageRoot = (modulePath: string): string | null => {
    const normalizedPath = resolveFsPath(modulePath);
    let winner: string | null = null;
    for (const pkg of graph.packages) {
      if (!(normalizedPath === pkg.rootDir || normalizedPath.startsWith(`${pkg.rootDir}/`))) {
        continue;
      }
      if (winner === null || pkg.rootDir.length > winner.length) {
        winner = pkg.rootDir;
      }
    }
    return winner;
  };

  for (const modulePath of usedModulePaths) {
    const ownerRoot = findOwningPackageRoot(modulePath);
    if (ownerRoot) {
      selectedRoots.add(ownerRoot);
    }
  }

  const queue = [...selectedRoots];
  while (queue.length > 0) {
    const rootDir = queue.shift()!;
    const pkg = packagesByRoot.get(rootDir);
    if (!pkg) {
      continue;
    }

    for (const [dependencyName, dependencyRoot] of pkg.dependencyRoots) {
      if (pkg.manifest.dependencies[dependencyName] === undefined) {
        continue;
      }
      if (selectedRoots.has(dependencyRoot)) {
        continue;
      }
      selectedRoots.add(dependencyRoot);
      queue.push(dependencyRoot);
    }
  }

  const packages = graph.packages
    .filter((pkg) => selectedRoots.has(pkg.rootDir))
    .map((pkg) => ({
      ...pkg,
      dependencyRoots: new Map(
        [...pkg.dependencyRoots].filter(([, dependencyRoot]) => selectedRoots.has(dependencyRoot)),
      ),
      externalDependencySentinelPaths: [...pkg.externalDependencySentinelPaths],
      externalDependencyNativeTargetContext: pkg.externalDependencyNativeTargetContext,
    }));
  const rootPackage = packages.find((pkg) => pkg.rootDir === graph.rootPackage.rootDir);
  if (!rootPackage) {
    throw new Error(`Narrowed package graph dropped root package ${graph.rootPackage.rootDir}`);
  }

  return {
    rootPackage,
    packages,
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
  const externalProvenanceByKey = new Map<string, ExternalDependencyProvenanceEntry>();
  const visitedEdges = new Set<string>();

  for (const pkg of graph.packages) {
    for (const [dependencyName, dependency] of Object.entries(pkg.manifest.externalDependencies)) {
      const key = [
        dependencyName,
        dependency.kind,
        dependency.url,
        dependency.destination,
        dependency.kind === "archive" ? dependency.sha256 : dependency.commit,
      ].join("\u0000");
      const existing = externalProvenanceByKey.get(key) ?? {
        name: dependencyName,
        kind: dependency.kind,
        url: dependency.url,
        destination: dependency.destination,
        referencedFrom: [],
        ...(dependency.kind === "archive"
          ? { sha256: dependency.sha256 }
          : { ref: dependency.ref, commit: dependency.commit }),
      };
      const referencer = pkg.remotePackage?.url ?? ".";
      if (!existing.referencedFrom.includes(referencer)) {
        existing.referencedFrom.push(referencer);
        existing.referencedFrom.sort();
      }
      externalProvenanceByKey.set(key, existing);
    }
  }

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
  const externalDependencies = [...externalProvenanceByKey.values()].sort((left, right) => {
    const leftKey = `${left.name}\u0000${left.url}`;
    const rightKey = `${right.name}\u0000${right.url}`;
    return leftKey.localeCompare(rightKey);
  });
  return { dependencies, externalDependencies };
}

export function createPackageOutputPaths(graph: PackageGraph, entryPath: string): PackageOutputPaths {
  const baseDir = dirnameFsPath(resolveFsPath(entryPath));
  const byRootDir = new Map<string, string>();
  const namespaceNameByRootDir = new Map<string, string>();

  for (const pkg of graph.packages) {
    if (!pkg.manifest.name) {
      const packageKind = pkg.rootDir === graph.rootPackage.rootDir ? "Root package" : "Dependency package";
      throw new Error(`${packageKind} at ${pkg.rootDir} must declare a name in doof.json`);
    }
    namespaceNameByRootDir.set(pkg.rootDir, pkg.manifest.name);

    if (pkg.remotePackage) {
      byRootDir.set(pkg.rootDir, [".packages", ...pkg.remotePackage.pathSegments].join("/"));
      continue;
    }

    byRootDir.set(pkg.rootDir, anchorOutputRelativePath(toPortablePath(relativeFsPath(baseDir, pkg.rootDir))));
  }

  return { byRootDir, namespaceNameByRootDir };
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

export function materializePackageGraphExternalDependencies(graph: PackageGraph): void {
  for (const pkg of graph.packages) {
    for (const [dependencyName, dependency] of Object.entries(pkg.manifest.externalDependencies)) {
      defaultAcquireExternalDependency(dependencyName, dependency, {
        packageRootDir: pkg.rootDir,
        manifestPath: pkg.manifestPath,
        ...pkg.externalDependencyNativeTargetContext,
      });
    }
  }
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
  const externalDependencyNativeTargetContext = createExternalDependencyNativeTargetContext(
    manifest.build,
    context.effectiveBuildTarget,
    context.effectiveIOSDestination,
  );
  const externalDependencySentinelPaths = acquireExternalDependencies(
    manifest,
    rootDir,
    normalizedManifestPath,
    context,
    externalDependencyNativeTargetContext,
  );
  const buildTargetOverride = normalizedManifestPath === context.rootManifestPath
    ? context.effectiveBuildTarget
    : undefined;
  const discovered: DiscoveredPackage = {
    rootDir,
    manifestPath: normalizedManifestPath,
    manifest,
    dependencies: [],
    remotePackage: null,
    nativeBuild: normalizeNativeBuildConfig(
      manifest.build?.native,
      rootDir,
      normalizedManifestPath,
      context.effectiveBuildTarget,
      context.effectiveIOSDestination,
    ),
    buildTarget: normalizeBuildTargetConfig(manifest.build, rootDir, normalizedManifestPath, buildTargetOverride),
    resources: normalizePackageResources(manifest.build?.resources, rootDir, normalizedManifestPath),
    externalDependencySentinelPaths,
    externalDependencyNativeTargetContext,
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

        const localStdDependencyRoot = getImplicitStdDependencyRootForFileSystem(fileSystem, shortName);
        if (localStdDependencyRoot) {
          const dependencyManifestPath = joinFsPath(localStdDependencyRoot, MANIFEST_FILENAME);
          if (fileSystem.readFile(dependencyManifestPath) !== null) {
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

function getImplicitStdDependencyRootForFileSystem(
  fileSystem: FileSystem,
  packageName: string,
): string | null {
  const localStdDependencyRoot = getImplicitStdDependencyLocalRoot(packageName);
  if (localStdDependencyRoot) {
    return localStdDependencyRoot;
  }

  const overrideRoot = resolveStdlibOverridePath(`std/${packageName}`);
  if (!overrideRoot) {
    return null;
  }

  const manifestPath = joinFsPath(overrideRoot, MANIFEST_FILENAME);
  return fileSystem.readFile(manifestPath) !== null ? overrideRoot : null;
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
    resources: [...discovered.resources],
    externalDependencySentinelPaths: [...discovered.externalDependencySentinelPaths],
    externalDependencyNativeTargetContext: discovered.externalDependencyNativeTargetContext,
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
  const build = parseBuildConfig(parsed.build, parsed, manifestPath, name, version);
  const dependencies = parseDependencies(parsed.dependencies, manifestPath);
  const externalDependencies = parseExternalDependencies(parsed.externalDependencies, manifestPath);

  return { name, version, license, build, dependencies, externalDependencies };
}

function parseBuildConfig(
  value: unknown,
  rootValue: Record<string, unknown>,
  manifestPath: string,
  packageName: string | undefined,
  packageVersion: string | undefined,
): DoofBuildConfig | undefined {
  const rootCompact = parseCompactAppConfig(rootValue, manifestPath, "");
  const hasRootCompact = hasCompactAppConfig(rootCompact);

  if (value === undefined && !hasRootCompact) {
    return undefined;
  }

  if (value !== undefined && !isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build must be an object`);
  }
  const buildValue = value === undefined ? {} : value;

  const entry = readOptionalString(buildValue.entry, manifestPath, "build.entry");
  const buildDir = readOptionalString(buildValue.buildDir, manifestPath, "build.buildDir");
  const buildCompact = parseCompactAppConfig(buildValue, manifestPath, "build");
  const targetValue = rootCompact.target ?? buildCompact.target;

  const legacyTargetExecutableName = readOptionalString(
    buildValue.targetExecutableName,
    manifestPath,
    "build.targetExecutableName",
  );
  if (legacyTargetExecutableName !== undefined && !isValidExecutableName(legacyTargetExecutableName)) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: build.targetExecutableName must be a file name without path separators`,
    );
  }

  const targetExecutableName = resolveTargetExecutableName(
    rootCompact.executable ?? buildCompact.executable ?? legacyTargetExecutableName,
    targetValue,
    packageName,
    manifestPath,
  );
  if (targetExecutableName !== undefined && !isValidExecutableName(targetExecutableName)) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: executable must be a file name without path separators`,
    );
  }

  const parsedMacOSApp = parseMacOSAppConfig(buildValue.macosApp, manifestPath);
  const parsedIOSApp = parseIOSAppConfig(buildValue.iosApp, manifestPath);
  const shouldCreateAppDefaults = targetValue !== undefined
    || parsedMacOSApp !== undefined
    || parsedIOSApp !== undefined
    || hasCompactAppMetadata(rootCompact)
    || hasCompactAppMetadata(buildCompact);
  const macosApp = shouldCreateAppDefaults
    ? resolveMacOSAppConfig(parsedMacOSApp, rootCompact, buildCompact, packageName, packageVersion, manifestPath)
    : undefined;
  const iosApp = shouldCreateAppDefaults
    ? resolveIOSAppConfig(parsedIOSApp, rootCompact, buildCompact, packageName, packageVersion, manifestPath)
    : undefined;

  if (targetValue && !targetExecutableName) {
    throw new Error(`Invalid doof.json at ${manifestPath}: executable requires either executable or package name`);
  }

  const native = parseNativeBuildConfig(buildValue.native, manifestPath);
  const packageConfig = parsePackageConfig(buildValue.package, manifestPath);

  const resources = rootCompact.resources ?? buildCompact.resources;

  return { entry, buildDir, target: targetValue, targetExecutableName, resources, macosApp, iosApp, package: packageConfig, native };
}

function parsePackageConfig(value: unknown, manifestPath: string): DoofPackageConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.package must be an object`);
  }

  const macos = parseMacOSPackageConfig(value.macos, manifestPath);
  const ios = parseIOSPackageConfig(value.ios, manifestPath);
  return {
    distDir: readOptionalString(value.distDir, manifestPath, "build.package.distDir"),
    macos,
    ios,
  };
}

function parseMacOSPackageConfig(value: unknown, manifestPath: string): DoofMacOSPackageConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.package.macos must be an object`);
  }
  const signing = readOptionalString(value.signing, manifestPath, "build.package.macos.signing");
  if (signing !== undefined && signing !== "developer-id" && signing !== "ad-hoc") {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: build.package.macos.signing must be one of "developer-id", "ad-hoc"`,
    );
  }
  const sandbox = value.sandbox;
  if (sandbox !== undefined && typeof sandbox !== "boolean") {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.package.macos.sandbox must be a boolean`);
  }
  return {
    signing,
    identity: readOptionalString(value.identity, manifestPath, "build.package.macos.identity"),
    sandbox,
    entitlements: readOptionalString(value.entitlements, manifestPath, "build.package.macos.entitlements"),
  };
}

function parseIOSPackageConfig(value: unknown, manifestPath: string): DoofIOSPackageConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.package.ios must be an object`);
  }
  return {
    identity: readOptionalString(value.identity, manifestPath, "build.package.ios.identity"),
    provisioningProfile: readOptionalString(
      value.provisioningProfile,
      manifestPath,
      "build.package.ios.provisioningProfile",
    ),
  };
}

function parseCompactAppConfig(
  value: Record<string, unknown>,
  manifestPath: string,
  prefix: string,
): CompactAppConfig {
  const field = (name: string) => prefix.length > 0 ? `${prefix}.${name}` : name;
  const targetValue = readOptionalString(value.target, manifestPath, field("target"));
  if (targetValue !== undefined && !isDoofBuildTarget(targetValue)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${field("target")} must be one of \"macos-app\", \"ios-app\"`);
  }

  return {
    target: targetValue,
    executable: readOptionalString(value.executable, manifestPath, field("executable")),
    id: readOptionalString(value.id, manifestPath, field("id")),
    title: readOptionalString(value.title, manifestPath, field("title")),
    icon: readOptionalString(value.icon, manifestPath, field("icon")),
    resources: readOptionalAppResources(value.resources, manifestPath, field("resources")),
  };
}

function hasCompactAppConfig(config: CompactAppConfig): boolean {
  return config.target !== undefined
    || config.executable !== undefined
    || config.id !== undefined
    || config.title !== undefined
    || config.icon !== undefined
    || config.resources !== undefined;
}

function hasCompactAppMetadata(config: CompactAppConfig): boolean {
  return config.id !== undefined
    || config.title !== undefined
    || config.icon !== undefined;
}

function resolveTargetExecutableName(
  explicitExecutable: string | undefined,
  target: DoofBuildTarget | undefined,
  packageName: string | undefined,
  manifestPath: string,
): string | undefined {
  const executable = explicitExecutable ?? (target !== undefined ? packageName : undefined);
  if (executable === undefined) {
    return undefined;
  }
  if (!isValidExecutableName(executable)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: executable must be a file name without path separators`);
  }
  return executable;
}

function resolveMacOSAppConfig(
  app: DoofMacOSAppConfig | undefined,
  rootCompact: CompactAppConfig,
  buildCompact: CompactAppConfig,
  packageName: string | undefined,
  packageVersion: string | undefined,
  manifestPath: string,
): DoofMacOSAppConfig {
  return {
    bundleId: rootCompact.id ?? app?.bundleId ?? buildCompact.id ?? defaultBundleId(packageName, manifestPath),
    displayName: rootCompact.title ?? app?.displayName ?? buildCompact.title ?? defaultAppTitle(packageName, manifestPath),
    version: app?.version ?? packageVersion ?? "1.0",
    icon: rootCompact.icon ?? app?.icon ?? buildCompact.icon,
    infoPlist: app?.infoPlist,
    resources: rootCompact.resources ?? app?.resources ?? buildCompact.resources,
    embeddedLibraries: app?.embeddedLibraries,
    category: app?.category,
    minimumSystemVersion: app?.minimumSystemVersion,
  };
}

function resolveIOSAppConfig(
  app: DoofIOSAppConfig | undefined,
  rootCompact: CompactAppConfig,
  buildCompact: CompactAppConfig,
  packageName: string | undefined,
  packageVersion: string | undefined,
  manifestPath: string,
): DoofIOSAppConfig {
  return {
    bundleId: rootCompact.id ?? app?.bundleId ?? buildCompact.id ?? defaultBundleId(packageName, manifestPath),
    displayName: rootCompact.title ?? app?.displayName ?? buildCompact.title ?? defaultAppTitle(packageName, manifestPath),
    version: app?.version ?? packageVersion ?? "1.0",
    icon: rootCompact.icon ?? app?.icon ?? buildCompact.icon,
    infoPlist: app?.infoPlist,
    resources: rootCompact.resources ?? app?.resources ?? buildCompact.resources,
    embeddedLibraries: app?.embeddedLibraries,
    minimumDeploymentTarget: app?.minimumDeploymentTarget,
  };
}

function defaultAppTitle(packageName: string | undefined, manifestPath: string): string {
  if (packageName === undefined) {
    throw new Error(`Invalid doof.json at ${manifestPath}: app title requires either title or package name`);
  }
  return packageName;
}

function defaultBundleId(packageName: string | undefined, manifestPath: string): string {
  if (packageName === undefined) {
    throw new Error(`Invalid doof.json at ${manifestPath}: bundle id requires either id or package name`);
  }

  const sanitized = packageName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `dev.doof.${sanitized.length > 0 ? sanitized : "app"}`;
}

function parseMacOSAppConfig(value: unknown, manifestPath: string): DoofMacOSAppConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.macosApp must be an object`);
  }

  return {
    bundleId: readOptionalString(value.bundleId, manifestPath, "build.macosApp.bundleId"),
    displayName: readOptionalString(value.displayName, manifestPath, "build.macosApp.displayName"),
    version: readOptionalString(value.version, manifestPath, "build.macosApp.version"),
    icon: readOptionalString(value.icon, manifestPath, "build.macosApp.icon"),
    infoPlist: readOptionalInfoPlist(value.infoPlist, manifestPath, "build.macosApp.infoPlist"),
    resources: readOptionalAppResources(value.resources, manifestPath, "build.macosApp.resources"),
    embeddedLibraries: readOptionalEmbeddedLibraries(
      value.embeddedLibraries,
      manifestPath,
      "build.macosApp.embeddedLibraries",
    ),
    category: readOptionalString(value.category, manifestPath, "build.macosApp.category"),
    minimumSystemVersion: readOptionalString(
      value.minimumSystemVersion,
      manifestPath,
      "build.macosApp.minimumSystemVersion",
    ),
  };
}

function parseIOSAppConfig(value: unknown, manifestPath: string): DoofIOSAppConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: build.iosApp must be an object`);
  }

  return {
    bundleId: readOptionalString(value.bundleId, manifestPath, "build.iosApp.bundleId"),
    displayName: readOptionalString(value.displayName, manifestPath, "build.iosApp.displayName"),
    version: readOptionalString(value.version, manifestPath, "build.iosApp.version"),
    icon: readOptionalString(value.icon, manifestPath, "build.iosApp.icon"),
    infoPlist: readOptionalInfoPlist(value.infoPlist, manifestPath, "build.iosApp.infoPlist"),
    resources: readOptionalAppResources(value.resources, manifestPath, "build.iosApp.resources"),
    embeddedLibraries: readOptionalEmbeddedLibraries(
      value.embeddedLibraries,
      manifestPath,
      "build.iosApp.embeddedLibraries",
    ),
    minimumDeploymentTarget: readOptionalString(
      value.minimumDeploymentTarget,
      manifestPath,
      "build.iosApp.minimumDeploymentTarget",
    ),
  };
}

function readOptionalAppResources(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): DoofMacOSAppResourceConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry === "string") {
      if (entry.length === 0) {
        throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must not be empty`);
      }
      return { from: entry.replace(/\/+$/g, ""), to: entry };
    }

    if (!isRecord(entry)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must be a string or object`);
    }

    return {
      from: readRequiredString(entry.from, manifestPath, `${fieldPath}[${index}].from`),
      to: readRequiredString(entry.to, manifestPath, `${fieldPath}[${index}].to`),
    };
  });
}

function readOptionalEmbeddedLibraries(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): DoofEmbeddedLibraryConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must be an object`);
    }
    const library = readOptionalString(entry.library, manifestPath, `${fieldPath}[${index}].library`);
    const path = readOptionalString(entry.path, manifestPath, `${fieldPath}[${index}].path`);
    if ((library === undefined) === (path === undefined)) {
      throw new Error(
        `Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must declare exactly one of library or path`,
      );
    }
    return library === undefined ? { path: path! } : { library };
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
    iosSimulator: parseOptionalNativeBuildFragment(value.iosSimulator, manifestPath, "build.native.iosSimulator"),
    iosDevice: parseOptionalNativeBuildFragment(value.iosDevice, manifestPath, "build.native.iosDevice"),
    wasm: parseOptionalNativeBuildFragment(value.wasm, manifestPath, "build.native.wasm"),
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

function parseExternalDependencies(
  value: unknown,
  manifestPath: string,
): Record<string, DoofExternalDependencyConfig> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: externalDependencies must be an object`);
  }

  const dependencies: Record<string, DoofExternalDependencyConfig> = {};
  for (const [dependencyName, dependencyValue] of Object.entries(value)) {
    if (!isValidDependencyName(dependencyName)) {
      throw new Error(
        `Invalid doof.json at ${manifestPath}: invalid external dependency name ${JSON.stringify(dependencyName)}`,
      );
    }
    dependencies[dependencyName] = parseExternalDependencyConfig(dependencyValue, manifestPath, dependencyName);
  }

  return dependencies;
}

function parseExternalDependencyConfig(
  value: unknown,
  manifestPath: string,
  dependencyName: string,
): DoofExternalDependencyConfig {
  const fieldPath = `externalDependencies.${dependencyName}`;
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an object`);
  }

  const kind = readRequiredString(value.kind, manifestPath, `${fieldPath}.kind`);
  const url = readRequiredString(value.url, manifestPath, `${fieldPath}.url`);
  const destination = readRequiredString(value.destination, manifestPath, `${fieldPath}.destination`);

  if (kind === "archive") {
    const sha256 = readRequiredString(value.sha256, manifestPath, `${fieldPath}.sha256`);
    if (!isSupportedExternalArchiveUrl(url)) {
      throw new Error(
        `Invalid doof.json at ${manifestPath}: ${fieldPath}.url must end with .zip, .tar.gz, .tgz, .tar.bz2, .tbz2, or .tar.xz`,
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}.sha256 must be a 64-character hex string`);
    }
    return {
      kind,
      url,
      sha256: sha256.toLowerCase(),
      destination,
      stripComponents: readOptionalNonNegativeInteger(value.stripComponents, manifestPath, `${fieldPath}.stripComponents`) ?? 1,
      copyFiles: readOptionalExternalDependencyCopyFiles(value.copyFiles, manifestPath, `${fieldPath}.copyFiles`),
      commands: readOptionalExternalDependencyCommands(value.commands, manifestPath, `${fieldPath}.commands`),
    };
  }

  if (kind === "git") {
    const ref = readRequiredString(value.ref, manifestPath, `${fieldPath}.ref`);
    const commit = readRequiredString(value.commit, manifestPath, `${fieldPath}.commit`);
    if (!/^[0-9a-fA-F]{40}$/.test(commit)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}.commit must be a 40-character hex string`);
    }
    return {
      kind,
      url,
      ref,
      commit: commit.toLowerCase(),
      destination,
      commands: readOptionalExternalDependencyCommands(value.commands, manifestPath, `${fieldPath}.commands`),
    };
  }

  throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}.kind must be either "archive" or "git"`);
}

function isSupportedExternalArchiveUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith(".zip")
    || lowerUrl.endsWith(".tar.gz")
    || lowerUrl.endsWith(".tgz")
    || lowerUrl.endsWith(".tar.bz2")
    || lowerUrl.endsWith(".tbz2")
    || lowerUrl.endsWith(".tar.xz");
}

function readOptionalNonNegativeInteger(value: unknown, manifestPath: string, fieldPath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be a non-negative integer`);
  }
  return value;
}

function readOptionalExternalDependencyCopyFiles(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): DoofExternalDependencyCopyFileConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must be an object`);
    }
    return {
      from: readRequiredString(entry.from, manifestPath, `${fieldPath}[${index}].from`),
      to: readRequiredString(entry.to, manifestPath, `${fieldPath}[${index}].to`),
    };
  });
}

function readOptionalExternalDependencyCommands(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): DoofExternalDependencyCommandConfig[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}[${index}] must be an object`);
    }
    return {
      program: readRequiredString(entry.program, manifestPath, `${fieldPath}[${index}].program`),
      args: readOptionalStringArray(entry.args, manifestPath, `${fieldPath}[${index}].args`) ?? [],
      env: readOptionalStringMap(entry.env, manifestPath, `${fieldPath}[${index}].env`) ?? {},
      workingDirectory: readOptionalString(entry.workingDirectory, manifestPath, `${fieldPath}[${index}].workingDirectory`),
    };
  });
}

function readOptionalStringMap(
  value: unknown,
  manifestPath: string,
  fieldPath: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} keys must not be empty`);
    }
    if (typeof entry !== "string") {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath}.${key} must be a string`);
    }
    result[key] = entry;
  }
  return result;
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

function readOptionalInfoPlist(value: unknown, manifestPath: string, fieldPath: string): AppInfoPlist | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} must be an object`);
  }

  const infoPlist: AppInfoPlist = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0) {
      throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} keys must not be empty`);
    }
    infoPlist[key] = readInfoPlistValue(entry, manifestPath, `${fieldPath}.${key}`);
  }
  return infoPlist;
}

function readInfoPlistValue(value: unknown, manifestPath: string, fieldPath: string): AppInfoPlistValue {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => readInfoPlistValue(entry, manifestPath, `${fieldPath}[${index}]`));
  }

  if (isRecord(value)) {
    const result: Record<string, AppInfoPlistValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key.length === 0) {
        throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} keys must not be empty`);
      }
      result[key] = readInfoPlistValue(entry, manifestPath, `${fieldPath}.${key}`);
    }
    return result;
  }

  throw new Error(
    `Invalid doof.json at ${manifestPath}: ${fieldPath} must be a string, number, boolean, array, or object`,
  );
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
  effectiveBuildTarget: DoofBuildTarget | undefined,
  effectiveIOSDestination: IOSAppDestination,
): ResolvedPackageNativeBuild {
  if (!nativeBuild) {
    return createEmptyResolvedPackageNativeBuild();
  }

  const platformBuild = effectiveBuildTarget === "wasm"
    ? nativeBuild.wasm
    : effectiveBuildTarget === "ios-app" && process.platform === "darwin"
    ? effectiveIOSDestination === "device"
      ? nativeBuild.iosDevice
      : nativeBuild.iosSimulator
    : process.platform === "darwin"
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
  buildTargetOverride?: DoofBuildTarget,
): ResolvedDoofBuildTarget | null {
  const effectiveTarget = buildTargetOverride ?? build?.target;
  if (!effectiveTarget || !build) {
    return null;
  }

  switch (effectiveTarget) {
    case "macos-app":
      return {
        kind: "macos-app",
        config: normalizeMacOSAppBuildConfig(build.macosApp!, rootDir, manifestPath),
      };
    case "ios-app":
      return {
        kind: "ios-app",
        config: normalizeIOSAppBuildConfig(build.iosApp!, rootDir, manifestPath),
      };
    case "wasm":
      return { kind: "wasm" };
  }
}

function normalizeMacOSAppBuildConfig(
  macosApp: DoofMacOSAppConfig,
  rootDir: string,
  manifestPath: string,
): ResolvedDoofMacOSAppConfig {
  const iconPath = macosApp.icon === undefined
    ? undefined
    : normalizePackagePath(macosApp.icon, rootDir, manifestPath, "build.macosApp.icon");
  if (iconPath !== undefined) {
    validatePngAppIconPath(iconPath, manifestPath, "build.macosApp.icon");
  }
  validateCustomInfoPlistKeys(
    macosApp.infoPlist,
    MACOS_MANAGED_INFO_PLIST_KEYS,
    manifestPath,
    "build.macosApp.infoPlist",
  );
  const embeddedLibraries = normalizeEmbeddedLibraries(
    macosApp.embeddedLibraries,
    rootDir,
    manifestPath,
    "build.macosApp.embeddedLibraries",
  );
  return {
    bundleId: readResolvedAppString(macosApp.bundleId, manifestPath, "build.macosApp.bundleId"),
    displayName: readResolvedAppString(macosApp.displayName, manifestPath, "build.macosApp.displayName"),
    version: readResolvedAppString(macosApp.version, manifestPath, "build.macosApp.version"),
    ...(iconPath === undefined ? {} : { iconPath }),
    ...(macosApp.infoPlist === undefined ? {} : { infoPlist: macosApp.infoPlist }),
    resources: (macosApp.resources ?? []).map((resource, index) => ({
      fromPattern: normalizePackagePath(
        resource.from,
        rootDir,
        manifestPath,
        `build.macosApp.resources[${index}].from`,
      ),
      destination: normalizeMacOSAppResourceDestinationOrThrow(resource.to, manifestPath, index),
    })),
    ...(embeddedLibraries.length === 0 ? {} : { embeddedLibraries }),
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

function normalizeIOSAppBuildConfig(
  iosApp: DoofIOSAppConfig,
  rootDir: string,
  manifestPath: string,
): ResolvedDoofIOSAppConfig {
  const iconPath = iosApp.icon === undefined
    ? undefined
    : normalizePackagePath(iosApp.icon, rootDir, manifestPath, "build.iosApp.icon");
  if (iconPath !== undefined) {
    validatePngAppIconPath(iconPath, manifestPath, "build.iosApp.icon");
  }
  validateCustomInfoPlistKeys(
    iosApp.infoPlist,
    IOS_MANAGED_INFO_PLIST_KEYS,
    manifestPath,
    "build.iosApp.infoPlist",
  );
  const embeddedLibraries = normalizeEmbeddedLibraries(
    iosApp.embeddedLibraries,
    rootDir,
    manifestPath,
    "build.iosApp.embeddedLibraries",
  );
  return {
    bundleId: readResolvedAppString(iosApp.bundleId, manifestPath, "build.iosApp.bundleId"),
    displayName: readResolvedAppString(iosApp.displayName, manifestPath, "build.iosApp.displayName"),
    version: readResolvedAppString(iosApp.version, manifestPath, "build.iosApp.version"),
    ...(iconPath === undefined ? {} : { iconPath }),
    ...(iosApp.infoPlist === undefined ? {} : { infoPlist: iosApp.infoPlist }),
    resources: (iosApp.resources ?? []).map((resource, index) => ({
      fromPattern: normalizePackagePath(
        resource.from,
        rootDir,
        manifestPath,
        `build.iosApp.resources[${index}].from`,
      ),
      destination: normalizeIOSAppResourceDestinationOrThrow(resource.to, manifestPath, index),
    })),
    ...(embeddedLibraries.length === 0 ? {} : { embeddedLibraries }),
    minimumDeploymentTarget: iosApp.minimumDeploymentTarget ?? DEFAULT_IOS_MINIMUM_DEPLOYMENT_TARGET,
  };
}

function normalizePackageResources(
  resources: DoofMacOSAppResourceConfig[] | undefined,
  rootDir: string,
  manifestPath: string,
): ResolvedDoofResource[] {
  return (resources ?? []).map((resource, index) => ({
    fromPattern: normalizePackagePath(resource.from, rootDir, manifestPath, `resources[${index}].from`),
    destination: normalizePackageResourceDestinationOrThrow(resource.to, manifestPath, index),
  }));
}

function normalizePackageResourceDestinationOrThrow(value: string, manifestPath: string, index: number): string {
  try {
    return normalizePackageResourceDestination(value);
  } catch (error: any) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: resources[${index}].to ${error?.message ?? String(error)}`,
    );
  }
}

function normalizePackageResourceDestination(destination: string): string {
  const portableDestination = destination.replace(/\\/g, "/");
  if (portableDestination.startsWith("/") || portableDestination.match(/^[A-Za-z]:\//)) {
    throw new Error("resource destinations must be relative");
  }

  const normalized = nodePath.posix.normalize(portableDestination || ".");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("resource destinations must stay within the executable resource directory");
  }

  return normalized === "." ? "" : normalized;
}

function readResolvedAppString(value: string | undefined, manifestPath: string, fieldPath: string): string {
  if (value === undefined) {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldPath} requires either compact app metadata or package defaults`);
  }
  return value;
}

function validatePngAppIconPath(iconPath: string, manifestPath: string, fieldName: string): void {
  if (nodePath.extname(iconPath).toLowerCase() !== ".png") {
    throw new Error(`Invalid doof.json at ${manifestPath}: ${fieldName} must point to a PNG file`);
  }
}

function normalizeIOSAppResourceDestinationOrThrow(value: string, manifestPath: string, index: number): string {
  try {
    return normalizeIOSAppResourceDestination(value);
  } catch (error: any) {
    throw new Error(
      `Invalid doof.json at ${manifestPath}: build.iosApp.resources[${index}].to ${error?.message ?? String(error)}`,
    );
  }
}

function normalizeEmbeddedLibraries(
  entries: DoofEmbeddedLibraryConfig[] | undefined,
  rootDir: string,
  manifestPath: string,
  fieldPath: string,
): ResolvedDoofEmbeddedLibrary[] {
  return (entries ?? []).map((entry, index) => "library" in entry && entry.library !== undefined
    ? { library: entry.library }
    : {
      path: normalizePackagePath(entry.path!, rootDir, manifestPath, `${fieldPath}[${index}].path`),
    });
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

function acquireExternalDependencies(
  manifest: DoofManifest,
  rootDir: string,
  manifestPath: string,
  context: PackageLoadContext,
  nativeTargetContext: ExternalDependencyNativeTargetContext,
): string[] {
  const sentinelPaths: string[] = [];
  for (const [dependencyName, dependency] of Object.entries(manifest.externalDependencies)) {
    const destination = normalizePackagePath(
      dependency.destination,
      rootDir,
      manifestPath,
      `externalDependencies.${dependencyName}.destination`,
    );
    context.acquireExternalDependency(dependencyName, dependency, {
      packageRootDir: rootDir,
      manifestPath,
      ...nativeTargetContext,
    });
    if (!isWithinRoot(destination, rootDir)) {
      throw new Error(
        `Invalid doof.json at ${manifestPath}: externalDependencies.${dependencyName}.destination must stay within the package root`,
      );
    }
    sentinelPaths.push(nodePath.join(destination, EXTERNAL_METADATA_FILENAME));
    if (dependency.commands.length > 0) {
      sentinelPaths.push(getExternalDependencyNativeMarkerPath(destination, nativeTargetContext.nativeTarget));
    }
  }
  return uniqueStrings(sentinelPaths);
}

interface ExternalDependencyNativeTargetContext {
  nativeTarget: string;
  sdkPath: string;
  targetTriple: string;
  configureHost: string;
}

function createExternalDependencyNativeTargetContext(
  build: DoofBuildConfig | undefined,
  effectiveBuildTarget: DoofBuildTarget | undefined,
  effectiveIOSDestination: IOSAppDestination,
): ExternalDependencyNativeTargetContext {
  if (effectiveBuildTarget === "wasm") {
    return {
      nativeTarget: "wasm",
      sdkPath: "",
      targetTriple: "wasm32-unknown-emscripten",
      configureHost: "wasm32-unknown-emscripten",
    };
  }

  if (effectiveBuildTarget === "ios-app" && process.platform === "darwin") {
    const minimumDeploymentTarget = build?.iosApp?.minimumDeploymentTarget ?? DEFAULT_IOS_MINIMUM_DEPLOYMENT_TARGET;
    if (effectiveIOSDestination === "device") {
      return {
        nativeTarget: "ios-device",
        sdkPath: resolveAppleSdkPath("iphoneos"),
        targetTriple: buildIOSDeviceTargetTriple(minimumDeploymentTarget),
        configureHost: "aarch64-apple-darwin",
      };
    }
    const simulatorConfigureHost = process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
    return {
      nativeTarget: "ios-simulator",
      sdkPath: resolveAppleSdkPath("iphonesimulator"),
      targetTriple: buildIOSSimulatorTargetTriple(minimumDeploymentTarget),
      configureHost: simulatorConfigureHost,
    };
  }

  if (process.platform === "darwin") {
    return { nativeTarget: "macos", sdkPath: "", targetTriple: "", configureHost: "" };
  }
  if (process.platform === "win32") {
    return { nativeTarget: "windows", sdkPath: "", targetTriple: "", configureHost: "" };
  }
  if (process.platform === "linux") {
    return { nativeTarget: "linux", sdkPath: "", targetTriple: "", configureHost: "" };
  }
  return { nativeTarget: process.platform, sdkPath: "", targetTriple: "", configureHost: "" };
}

function resolveAppleSdkPath(sdkName: string): string {
  return execFileSync("xcrun", ["--sdk", sdkName, "--show-sdk-path"], { encoding: "utf8", stdio: "pipe" }).trim();
}

function getExternalDependencyNativeMarkerPath(destination: string, nativeTarget: string): string {
  return nodePath.join(destination, `.doof-external-native-${nativeTarget}.json`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function defaultAcquireExternalDependency(
  dependencyName: string,
  dependency: DoofExternalDependencyConfig,
  context: ExternalDependencyContext,
): void {
  if (!nodeFs.existsSync(context.manifestPath)) {
    return;
  }

  const destination = normalizePackagePath(
    dependency.destination,
    context.packageRootDir,
    context.manifestPath,
    `externalDependencies.${dependencyName}.destination`,
  );
  const expectedMarker = createExternalDependencyMarker(dependencyName, dependency);
  const existingMarker = readExternalDependencyMarker(destination);

  if (!existingMarker || !externalDependencyMarkerMatches(existingMarker, expectedMarker)) {
    if (nodeFs.existsSync(destination)) {
      if (!existingMarker && !isEmptyDirectory(destination)) {
        throw new Error(
          `External dependency ${dependencyName} destination already exists without ${EXTERNAL_METADATA_FILENAME}: ${destination}`,
        );
      }
      nodeFs.rmSync(destination, { recursive: true, force: true });
    }

    if (dependency.kind === "archive") {
      materializeArchiveExternalDependency(dependencyName, dependency, destination, expectedMarker);
    } else {
      materializeGitExternalDependency(dependencyName, dependency, destination, expectedMarker);
    }
  }

  if (dependency.commands.length > 0) {
    runExternalDependencyNativeCommands(dependencyName, dependency.commands, context, destination);
  }
}

interface ExternalDependencyMarker {
  schemaVersion: 1;
  name: string;
  kind: "archive" | "git";
  url: string;
  destination: string;
  acquiredAt: string;
  platform?: NodeJS.Platform;
  sha256?: string;
  stripComponents?: number;
  copyFiles?: DoofExternalDependencyCopyFileConfig[];
  ref?: string;
  commit?: string;
}

function createExternalDependencyMarker(
  dependencyName: string,
  dependency: DoofExternalDependencyConfig,
): ExternalDependencyMarker {
  return {
    schemaVersion: 1,
    name: dependencyName,
    kind: dependency.kind,
    url: dependency.url,
    destination: dependency.destination,
    acquiredAt: new Date().toISOString(),
    platform: process.platform,
    ...(dependency.kind === "archive"
      ? { sha256: dependency.sha256, stripComponents: dependency.stripComponents, copyFiles: dependency.copyFiles }
      : { ref: dependency.ref, commit: dependency.commit }),
  };
}

function readExternalDependencyMarker(destination: string): ExternalDependencyMarker | null {
  const markerPath = nodePath.join(destination, EXTERNAL_METADATA_FILENAME);
  if (!nodeFs.existsSync(markerPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(markerPath, "utf8")) as Partial<ExternalDependencyMarker>;
    if (parsed.schemaVersion !== 1 || parsed.kind !== "archive" && parsed.kind !== "git") {
      return null;
    }
    return parsed as ExternalDependencyMarker;
  } catch {
    return null;
  }
}

function externalDependencyMarkerMatches(
  actual: ExternalDependencyMarker,
  expected: ExternalDependencyMarker,
): boolean {
  return actual.schemaVersion === 1
    && actual.name === expected.name
    && actual.kind === expected.kind
    && actual.url === expected.url
    && actual.destination === expected.destination
    && actual.platform === expected.platform
    && actual.sha256 === expected.sha256
    && actual.stripComponents === expected.stripComponents
    && JSON.stringify(actual.copyFiles ?? []) === JSON.stringify(expected.copyFiles ?? [])
    && actual.ref === expected.ref
    && actual.commit === expected.commit;
}

function writeExternalDependencyMarker(destination: string, marker: ExternalDependencyMarker): void {
  nodeFs.writeFileSync(
    nodePath.join(destination, EXTERNAL_METADATA_FILENAME),
    JSON.stringify({ ...marker, acquiredAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

function isEmptyDirectory(path: string): boolean {
  try {
    return nodeFs.statSync(path).isDirectory() && nodeFs.readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

function materializeArchiveExternalDependency(
  dependencyName: string,
  dependency: DoofArchiveExternalDependencyConfig,
  destination: string,
  marker: ExternalDependencyMarker,
): void {
  const parentDir = nodePath.dirname(destination);
  nodeFs.mkdirSync(parentDir, { recursive: true });
  const tempRoot = nodeFs.mkdtempSync(nodePath.join(parentDir, `.doof-${dependencyName}-`));
  const archivePath = nodePath.join(tempRoot, "source");
  const extractDir = nodePath.join(tempRoot, "extract");
  const stagedDestination = nodePath.join(tempRoot, "payload");

  try {
    nodeFs.mkdirSync(extractDir, { recursive: true });
    execFileSync("curl", ["-L", "-f", "-o", archivePath, dependency.url], { stdio: "pipe" });
    const actualSha256 = createHash("sha256").update(nodeFs.readFileSync(archivePath)).digest("hex");
    if (actualSha256 !== dependency.sha256) {
      throw new Error(
        `External dependency ${dependencyName} checksum mismatch: expected ${dependency.sha256}, got ${actualSha256}`,
      );
    }

    extractExternalArchive(archivePath, dependency.url, extractDir);
    const sourceRoot = resolveStrippedArchiveRoot(extractDir, dependency.stripComponents, dependencyName);
    nodeFs.mkdirSync(stagedDestination, { recursive: true });
    copyDirectoryContents(sourceRoot, stagedDestination);
    applyExternalDependencyCopyFiles(stagedDestination, dependency.copyFiles, dependencyName);
    nodeFs.renameSync(stagedDestination, destination);
    writeExternalDependencyMarker(destination, marker);
  } catch (error: any) {
    nodeFs.rmSync(destination, { recursive: true, force: true });
    throw new Error(`Failed to acquire external dependency ${dependencyName}: ${error?.message ?? String(error)}`);
  } finally {
    nodeFs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function extractExternalArchive(archivePath: string, url: string, extractDir: string): void {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".zip")) {
    execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "pipe" });
    return;
  }

  execFileSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "pipe" });
}

function resolveStrippedArchiveRoot(extractDir: string, stripComponents: number, dependencyName: string): string {
  let current = extractDir;
  for (let index = 0; index < stripComponents; index++) {
    const entries = nodeFs.readdirSync(current).filter((entry) => entry !== "__MACOSX");
    if (entries.length !== 1) {
      throw new Error(
        `External dependency ${dependencyName} archive cannot strip ${stripComponents} component(s) from multiple roots`,
      );
    }
    current = nodePath.join(current, entries[0]);
  }
  return current;
}

function copyDirectoryContents(sourceDir: string, destinationDir: string): void {
  for (const entry of nodeFs.readdirSync(sourceDir)) {
    nodeFs.cpSync(nodePath.join(sourceDir, entry), nodePath.join(destinationDir, entry), { recursive: true });
  }
}

function applyExternalDependencyCopyFiles(
  destination: string,
  copyFiles: readonly DoofExternalDependencyCopyFileConfig[],
  dependencyName: string,
): void {
  for (const copyFile of copyFiles) {
    const fromPath = nodePath.resolve(destination, copyFile.from);
    const toPath = nodePath.resolve(destination, copyFile.to);
    if (!isWithinRoot(fromPath, destination) || !isWithinRoot(toPath, destination)) {
      throw new Error(`External dependency ${dependencyName} copyFiles entries must stay within the destination`);
    }
    nodeFs.mkdirSync(nodePath.dirname(toPath), { recursive: true });
    nodeFs.copyFileSync(fromPath, toPath);
  }
}

function materializeGitExternalDependency(
  dependencyName: string,
  dependency: DoofGitExternalDependencyConfig,
  destination: string,
  marker: ExternalDependencyMarker,
): void {
  const parentDir = nodePath.dirname(destination);
  nodeFs.mkdirSync(parentDir, { recursive: true });
  const tempDir = nodeFs.mkdtempSync(nodePath.join(parentDir, `.doof-${dependencyName}-`));

  try {
    execFileSync("git", ["clone", "--depth", "1", "--branch", dependency.ref, dependency.url, tempDir], { stdio: "pipe" });
    const actualCommit = execFileSync("git", ["-C", tempDir, "rev-parse", "HEAD"], { stdio: "pipe" }).toString().trim();
    if (actualCommit.toLowerCase() !== dependency.commit) {
      throw new Error(
        `External dependency ${dependencyName} commit mismatch: expected ${dependency.commit}, got ${actualCommit}`,
      );
    }
    nodeFs.rmSync(nodePath.join(tempDir, ".git"), { recursive: true, force: true });
    nodeFs.renameSync(tempDir, destination);
    writeExternalDependencyMarker(destination, marker);
  } catch (error: any) {
    nodeFs.rmSync(destination, { recursive: true, force: true });
    throw new Error(`Failed to acquire external dependency ${dependencyName}: ${error?.message ?? String(error)}`);
  } finally {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  }
}

interface ExternalDependencyNativeMarker {
  schemaVersion: 1;
  nativeTarget: string;
  builtAt: string;
  sdkPath: string;
  targetTriple: string;
  configureHost: string;
  commands: DoofExternalDependencyCommandConfig[];
}

function runExternalDependencyNativeCommands(
  dependencyName: string,
  commands: readonly DoofExternalDependencyCommandConfig[],
  context: ExternalDependencyContext,
  destination: string,
): void {
  const markerPath = getExternalDependencyNativeMarkerPath(destination, context.nativeTarget);
  const expectedMarker: ExternalDependencyNativeMarker = {
    schemaVersion: 1,
    nativeTarget: context.nativeTarget,
    builtAt: new Date().toISOString(),
    sdkPath: context.sdkPath,
    targetTriple: context.targetTriple,
    configureHost: context.configureHost,
    commands: [...commands],
  };
  const existingMarker = readExternalDependencyNativeMarker(markerPath);
  if (existingMarker && externalDependencyNativeMarkerMatches(existingMarker, expectedMarker)) {
    return;
  }

  try {
    runExternalDependencyCommands(dependencyName, commands, context, destination);
    writeExternalDependencyNativeMarker(markerPath, expectedMarker);
  } catch (error: any) {
    nodeFs.rmSync(markerPath, { force: true });
    throw new Error(
      `Failed to build external dependency ${dependencyName} for ${context.nativeTarget}: ${error?.message ?? String(error)}`,
    );
  }
}

function readExternalDependencyNativeMarker(markerPath: string): ExternalDependencyNativeMarker | null {
  if (!nodeFs.existsSync(markerPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(markerPath, "utf8")) as Partial<ExternalDependencyNativeMarker>;
    if (parsed.schemaVersion !== 1 || typeof parsed.nativeTarget !== "string") {
      return null;
    }
    return parsed as ExternalDependencyNativeMarker;
  } catch {
    return null;
  }
}

function externalDependencyNativeMarkerMatches(
  actual: ExternalDependencyNativeMarker,
  expected: ExternalDependencyNativeMarker,
): boolean {
  return actual.schemaVersion === 1
    && actual.nativeTarget === expected.nativeTarget
    && actual.sdkPath === expected.sdkPath
    && actual.targetTriple === expected.targetTriple
    && actual.configureHost === expected.configureHost
    && JSON.stringify(actual.commands) === JSON.stringify(expected.commands);
}

function writeExternalDependencyNativeMarker(markerPath: string, marker: ExternalDependencyNativeMarker): void {
  nodeFs.writeFileSync(
    markerPath,
    JSON.stringify({ ...marker, builtAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

function runExternalDependencyCommands(
  dependencyName: string,
  commands: readonly DoofExternalDependencyCommandConfig[],
  context: ExternalDependencyContext,
  destination: string,
): void {
  const substitutions = createExternalCommandSubstitutions(context, destination);
  for (const [index, command] of commands.entries()) {
    const workingDirectory = command.workingDirectory
      ? resolveExternalCommandWorkingDirectory(command.workingDirectory, context, destination, dependencyName)
      : destination;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(command.env)) {
      env[key] = applyExternalCommandSubstitutions(value, substitutions);
    }

    try {
      execFileSync(
        applyExternalCommandSubstitutions(command.program, substitutions),
        command.args.map((arg) => applyExternalCommandSubstitutions(arg, substitutions)),
        { cwd: workingDirectory, env, stdio: "pipe" },
      );
    } catch (error: any) {
      throw new Error(
        `command ${index + 1} (${command.program}) failed: ${formatProcessFailure(command.program, error)}`,
      );
    }
  }
}

function resolveExternalCommandWorkingDirectory(
  workingDirectory: string,
  context: ExternalDependencyContext,
  destination: string,
  dependencyName: string,
): string {
  const substitutions = createExternalCommandSubstitutions(context, destination);
  const resolved = nodePath.resolve(destination, applyExternalCommandSubstitutions(workingDirectory, substitutions));
  if (!isWithinRoot(resolved, destination)) {
    throw new Error(`External dependency ${dependencyName} command workingDirectory must stay within the destination`);
  }
  return resolved;
}

function createExternalCommandSubstitutions(
  context: ExternalDependencyContext,
  destination: string,
): Record<string, string> {
  return {
    packageRoot: context.packageRootDir,
    destination,
    jobs: String(Math.max(1, nodeOs.cpus().length)),
    nativeTarget: context.nativeTarget,
    sdkPath: context.sdkPath,
    targetTriple: context.targetTriple,
    configureHost: context.configureHost,
  };
}

function applyExternalCommandSubstitutions(value: string, substitutions: Record<string, string>): string {
  return value.replace(
    /\$\{(packageRoot|destination|jobs|nativeTarget|sdkPath|targetTriple|configureHost)\}/g,
    (_match, name: string) => substitutions[name] ?? "",
  );
}

function formatProcessFailure(prefix: string, error: any): string {
  const stdout = error?.stdout?.toString()?.trim();
  const stderr = error?.stderr?.toString()?.trim();
  const details = [stdout, stderr].filter((value): value is string => Boolean(value && value.length > 0));
  return details.length > 0
    ? `${prefix}:\n${details.join("\n")}`
    : `${prefix}:\n${error?.message ?? String(error)}`;
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
