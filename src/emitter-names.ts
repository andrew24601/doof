/**
 * Canonical C++ naming helpers for generated Doof modules.
 *
 * Project-local modules lower to logical namespaces derived from their path
 * within the owning package (`game/state.do` → `game::state`). Dependency
 * modules live under `lib::<package-name>::...`, where `<package-name>` comes
 * from the dependency package's `doof.json`. Namespace planning validates the
 * lossy identifier sanitisation up front so emitted names can stay readable
 * without trailing disambiguation hashes.
 */

import type { PackageOutputPaths } from "./package-manifest.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { dirnameFsPath, relativeFsPath, resolveFsPath, toPortablePath } from "./path-utils.js";
import { BUNDLED_STDLIB_ROOT } from "./stdlib-constants.js";
import type { ModuleSymbol, ModuleSymbolTable } from "./types.js";

const LIB_NAMESPACE_ROOT = "lib";
const RESERVED_NAMESPACE_COMPONENTS = new Set(["main", "std", "doof"]);

export function sanitizeCppNamespaceComponent(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  const nonEmpty = sanitized || "module";
  const startsSafe = /^[0-9]/.test(nonEmpty) ? `_${nonEmpty}` : nonEmpty;
  const cppSafe = emitIdentifierSafe(startsSafe);
  // Generated C++ relies on global `::main`, `::std`, and `::doof`. Nesting a
  // generated namespace component with one of those spellings would either
  // collide with `main` or shadow unqualified uses such as `std::vector`.
  return RESERVED_NAMESPACE_COMPONENTS.has(cppSafe) ? `${cppSafe}_` : cppSafe;
}

function namespaceFromPath(modulePath: string): string {
  return modulePath
    .replace(/\.[^/.]+$/, "")
    .split(/[\\/]+/)
    .filter((part) => part.length > 0)
    .map(sanitizeCppNamespaceComponent)
    .join("::");
}

function packageNameToNamespaceSegments(packageName: string): string[] {
  return packageName
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(sanitizeCppNamespaceComponent);
}

function findOwningPackageRoot(
  modulePath: string,
  packageOutputPaths: PackageOutputPaths | undefined,
): string | null {
  if (!packageOutputPaths?.namespaceNameByRootDir) return null;

  const normalizedModulePath = resolveFsPath(modulePath);
  let winner: string | null = null;
  for (const rootDir of packageOutputPaths.namespaceNameByRootDir.keys()) {
    const normalizedRootDir = resolveFsPath(rootDir);
    if (normalizedModulePath !== normalizedRootDir && !normalizedModulePath.startsWith(`${normalizedRootDir}/`)) {
      continue;
    }
    if (winner === null || normalizedRootDir.length > winner.length) {
      winner = normalizedRootDir;
    }
  }
  return winner;
}

function moduleRelativeSegments(modulePath: string, rootDir: string): string[] {
  const relativePath = toPortablePath(relativeFsPath(rootDir, modulePath)).replace(/\.[^/.]+$/, "");
  return relativePath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
}

function logicalNamespaceSegments(
  modulePath: string,
  fallbackRootDir: string,
  packageOutputPaths: PackageOutputPaths | undefined,
): { packageRoot: string; rawSegments: string[]; namespaceSegments: string[]; dependencyPackageName: string | null } {
  const bundledStdPrefix = `${BUNDLED_STDLIB_ROOT}/std/`;
  if (modulePath.startsWith(bundledStdPrefix)) {
    const relativeStdPath = modulePath.slice(bundledStdPrefix.length);
    const [packageSegment, ...moduleSegments] = relativeStdPath.replace(/\.[^/.]+$/, "").split("/");
    const dependencyPackageName = `std/${packageSegment}`;
    return {
      packageRoot: `${bundledStdPrefix}${packageSegment}`,
      rawSegments: moduleSegments,
      namespaceSegments: [
        LIB_NAMESPACE_ROOT,
        ...packageNameToNamespaceSegments(dependencyPackageName),
        ...moduleSegments.map(sanitizeCppNamespaceComponent),
      ],
      dependencyPackageName,
    };
  }

  const packageRoot = findOwningPackageRoot(modulePath, packageOutputPaths) ?? fallbackRootDir;
  const rawSegments = moduleRelativeSegments(modulePath, packageRoot);
  const dependencyPackageName = packageOutputPaths?.namespaceNameByRootDir?.get(packageRoot) ?? null;
  const namespaceSegments = dependencyPackageName === null
    ? rawSegments.map(sanitizeCppNamespaceComponent)
    : [
      LIB_NAMESPACE_ROOT,
      ...packageNameToNamespaceSegments(dependencyPackageName),
      ...rawSegments.map(sanitizeCppNamespaceComponent),
    ];

  return { packageRoot, rawSegments, namespaceSegments, dependencyPackageName };
}

function validateDependencyNamespaceRoots(packageOutputPaths: PackageOutputPaths | undefined): void {
  if (!packageOutputPaths?.namespaceNameByRootDir) return;

  const seen = new Map<string, { rawName: string; rootDir: string }>();
  for (const [rootDir, rawName] of packageOutputPaths.namespaceNameByRootDir) {
    if (rawName === null) continue;
    const namespaceRoot = [LIB_NAMESPACE_ROOT, ...packageNameToNamespaceSegments(rawName)].join("::");
    const previous = seen.get(namespaceRoot);
    if (previous && previous.rawName !== rawName) {
      throw new Error(
        `Dependency package names ${JSON.stringify(previous.rawName)} (${previous.rootDir}) and ${JSON.stringify(rawName)} (${rootDir}) both lower to C++ namespace "${namespaceRoot}"`,
      );
    }
    seen.set(namespaceRoot, { rawName, rootDir });
  }
}

function validateNamespaceComponentCollisions(
  modulePath: string,
  packageRoot: string,
  rawSegments: string[],
  dependencyPackageName: string | null,
  seenChildrenByScope: Map<string, Map<string, string>>,
): void {
  const rootPrefix = dependencyPackageName === null
    ? ""
    : [LIB_NAMESPACE_ROOT, ...packageNameToNamespaceSegments(dependencyPackageName)].join("::");
  const sanitizedParents: string[] = rootPrefix ? rootPrefix.split("::") : [];

  for (const rawSegment of rawSegments) {
    const scopeKey = `${packageRoot}\u0000${sanitizedParents.join("::")}`;
    const children = seenChildrenByScope.get(scopeKey) ?? new Map<string, string>();
    const sanitizedSegment = sanitizeCppNamespaceComponent(rawSegment);
    const previousRawSegment = children.get(sanitizedSegment);
    if (previousRawSegment && previousRawSegment !== rawSegment) {
      const packageLabel = dependencyPackageName === null
        ? "project package"
        : `dependency package ${JSON.stringify(dependencyPackageName)}`;
      throw new Error(
        `Namespace component collision in ${packageLabel}: ${JSON.stringify(previousRawSegment)} and ${JSON.stringify(rawSegment)} both lower to "${sanitizedSegment}" near ${modulePath}`,
      );
    }
    children.set(sanitizedSegment, rawSegment);
    seenChildrenByScope.set(scopeKey, children);
    sanitizedParents.push(sanitizedSegment);
  }
}

export function assignModuleNamespaces(
  entryPath: string,
  modules: Map<string, ModuleSymbolTable>,
  packageOutputPaths?: PackageOutputPaths,
): void {
  validateDependencyNamespaceRoots(packageOutputPaths);

  const fallbackRootDir = dirnameFsPath(resolveFsPath(entryPath));
  const seenChildrenByScope = new Map<string, Map<string, string>>();
  const emittedNamespaces = new Map<string, string>();

  for (const modulePath of modules.keys()) {
    const { packageRoot, rawSegments, namespaceSegments, dependencyPackageName } =
      logicalNamespaceSegments(modulePath, fallbackRootDir, packageOutputPaths);

    if (dependencyPackageName === null && namespaceSegments[0] === LIB_NAMESPACE_ROOT) {
      throw new Error(
        `Project-local module ${modulePath} lowers to reserved root namespace "${LIB_NAMESPACE_ROOT}"`,
      );
    }

    validateNamespaceComponentCollisions(
      modulePath,
      packageRoot,
      rawSegments,
      dependencyPackageName,
      seenChildrenByScope,
    );

    const namespace = namespaceSegments.join("::");
    const previousModule = emittedNamespaces.get(namespace);
    if (previousModule && previousModule !== modulePath) {
      throw new Error(
        `Modules ${previousModule} and ${modulePath} both lower to C++ namespace "${namespace}"`,
      );
    }
    emittedNamespaces.set(namespace, modulePath);
  }

  for (const [modulePath, table] of modules) {
    const { namespaceSegments } = logicalNamespaceSegments(modulePath, fallbackRootDir, packageOutputPaths);
    table.emittedCppNamespace = namespaceSegments.join("::");
    for (const symbol of table.symbols.values()) {
      if (symbol.module === table.path) {
        symbol.emittedCppNamespace = table.emittedCppNamespace;
      }
    }
  }
}

export function emitModuleNamespace(modulePath: string, modules?: Map<string, ModuleSymbolTable>): string {
  return modules?.get(modulePath)?.emittedCppNamespace ?? namespaceFromPath(modulePath);
}

export function emitQualifiedModuleName(
  modulePath: string,
  localName: string,
  modules?: Map<string, ModuleSymbolTable>,
): string {
  return `::${emitModuleNamespace(modulePath, modules)}::${emitIdentifierSafe(localName)}`;
}

export function emitQualifiedSymbolName(symbol: ModuleSymbol, localName = symbol.name): string {
  const namespace = symbol.emittedCppNamespace ?? emitModuleNamespace(symbol.module);
  return `::${namespace}::${emitIdentifierSafe(localName)}`;
}

export function emitSymbolReferenceName(symbol: ModuleSymbol): string {
  if ((symbol.symbolKind === "class" || symbol.symbolKind === "function") && symbol.extern_) {
    return symbol.extern_.cppName ?? emitIdentifierSafe(symbol.name);
  }
  return emitQualifiedSymbolName(symbol);
}

export function emitQualifiedHelperName(
  modulePath: string,
  localName: string,
  modules?: Map<string, ModuleSymbolTable>,
): string {
  return emitQualifiedModuleName(modulePath, localName, modules);
}
