/**
 * ESM-style module path resolution for Doof.
 *
 * Resolves import specifiers to absolute file paths following the rules
 * from the module spec:
 *
 *   - Relative paths: "./foo", "../bar", "./sub/baz"
 *   - Bare/package specifiers: "http", "json" (resolved via a configurable
 *     package root or lookup table)
 *   - Extension inference: "./foo" tries "./foo.do" then "./foo/index.do"
 *
 * The resolver is parameterised over a `FileSystem` interface so it can be
 * used with both a real FS and a virtual/in-memory FS for testing.
 */

import {
  dirnameFsPath,
  fsPathSep,
  isWithinFsRoot,
  joinFsPath,
  resolveFsPath,
  resolveFsPathFrom,
} from "./path-utils.js";

// ============================================================================
// File system abstraction
// ============================================================================

/**
 * Minimal file system interface needed for module resolution.
 */
export interface FileSystem {
  /** Return the file contents as a string, or null if the file doesn't exist. */
  readFile(absolutePath: string): string | null;
  /** Return true if the path exists as a file. */
  fileExists(absolutePath: string): boolean;
}

// ============================================================================
// Module Resolver
// ============================================================================

export interface ResolverOptions {
  /** Root directory for bare/package specifiers (e.g. node_modules equivalent). */
  packageRoot?: string;
  /** Package-aware import resolution keyed by owning package root. */
  packages?: readonly PackageResolutionInfo[];
  /** Root directory for compiler-provided stdlib modules such as "std/assert". */
  stdlibRoot?: string;
  /** The file extension for Doof source files. Defaults to ".do". */
  extension?: string;
}

export interface PackageResolutionInfo {
  rootDir: string;
  dependencies: ReadonlyMap<string, string>;
}

export class ModuleResolver {
  private fs: FileSystem;
  private extension: string;
  private packageRoot: string | undefined;
  private packages: PackageResolutionInfo[];
  private stdlibRoot: string | undefined;

  constructor(fs: FileSystem, options: ResolverOptions = {}) {
    this.fs = fs;
    this.extension = options.extension ?? ".do";
    this.packageRoot = options.packageRoot;
    this.packages = [...(options.packages ?? [])]
      .map((pkg) => ({
        rootDir: resolveFsPath(pkg.rootDir),
        dependencies: pkg.dependencies,
      }))
      .sort((left, right) => right.rootDir.length - left.rootDir.length);
    this.stdlibRoot = options.stdlibRoot;
  }

  /**
   * Resolve an import specifier relative to the importing module.
   *
   * @param specifier  The specifier string from the import declaration
   *                   (e.g. "./helper", "../config", "http").
   * @param fromModule Absolute path of the importing module.
   * @returns          The resolved absolute path, or null if resolution fails.
   */
  resolve(specifier: string, fromModule: string): string | null {
    if (this.isRelative(specifier)) {
      return this.resolveRelative(specifier, fromModule);
    }
    if (this.isStdlib(specifier)) {
      return this.resolveStdlib(specifier);
    }
    return this.resolvePackage(specifier, fromModule);
  }

  // --------------------------------------------------------------------------
  // Relative resolution
  // --------------------------------------------------------------------------

  private isRelative(specifier: string): boolean {
    return specifier.startsWith("./") || specifier.startsWith("../");
  }

  private isStdlib(specifier: string): boolean {
    return specifier.startsWith("std/");
  }

  private resolveRelative(specifier: string, fromModule: string): string | null {
    const dir = dirnameFsPath(fromModule);
    const base = resolveFsPathFrom(dir, specifier);
    return this.tryResolveFile(base);
  }

  // --------------------------------------------------------------------------
  // Package/bare specifier resolution
  // --------------------------------------------------------------------------

  private resolvePackage(specifier: string, fromModule: string): string | null {
    const contextualResolution = this.resolveContextualPackage(specifier, fromModule);
    if (contextualResolution) {
      return contextualResolution;
    }

    return this.resolveLegacyPackage(specifier);
  }

  private resolveLegacyPackage(specifier: string): string | null {
    if (!this.packageRoot) return null;
    const base = joinFsPath(this.packageRoot, specifier);
    return this.tryResolveFile(base);
  }

  private resolveContextualPackage(specifier: string, fromModule: string): string | null {
    if (this.packages.length === 0) {
      return null;
    }

    const owner = this.findOwningPackage(fromModule);
    if (!owner) {
      return null;
    }

    const [packageName, ...rest] = specifier.split("/");
    const dependencyRoot = owner.dependencies.get(packageName);
    if (!dependencyRoot) {
      return null;
    }

    const base = rest.length === 0
      ? dependencyRoot
      : joinFsPath(dependencyRoot, ...rest);
    return this.tryResolveFile(base);
  }

  private findOwningPackage(fromModule: string): PackageResolutionInfo | null {
    const normalizedModulePath = resolveFsPath(fromModule);
    for (const candidate of this.packages) {
      if (isWithinRoot(normalizedModulePath, candidate.rootDir)) {
        return candidate;
      }
    }

    return null;
  }

  private resolveStdlib(specifier: string): string | null {
    if (!this.stdlibRoot) return null;
    const base = joinFsPath(this.stdlibRoot, specifier);
    return this.tryResolveFile(base);
  }

  // --------------------------------------------------------------------------
  // File probing
  // --------------------------------------------------------------------------

  /**
   * Given a base path (without guaranteed extension), probe for:
   *   1. exact path (if it already has the extension)
   *   2. path + extension
   *   3. path/index + extension  (barrel file)
   */
  private tryResolveFile(base: string): string | null {
    // 1. Exact match (e.g. "./foo.do" specified explicitly)
    if (this.fs.fileExists(base)) {
      return resolveFsPath(base);
    }

    // 2. Append extension
    const withExt = base + this.extension;
    if (this.fs.fileExists(withExt)) {
      return resolveFsPath(withExt);
    }

    // 3. Barrel file: base/index.do
    const indexFile = joinFsPath(base, "index" + this.extension);
    if (this.fs.fileExists(indexFile)) {
      return resolveFsPath(indexFile);
    }

    return null;
  }
}

function isWithinRoot(filePath: string, rootDir: string): boolean {
  return filePath === rootDir || isWithinFsRoot(filePath, rootDir) || filePath.startsWith(rootDir + fsPathSep(rootDir));
}
