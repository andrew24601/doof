import * as nodePath from "node:path";
import { ModuleResolver, type FileSystem, type ResolverOptions } from "./resolver.js";
import { toVirtualPath } from "./path-utils.js";
import { materializeRemoteDependencyByUrl } from "./package-manifest.js";
import { DEFAULT_STD_VERSIONS, getStdPackageShortName } from "./std-packages.js";
import { BUNDLED_STDLIB_ROOT } from "./stdlib-constants.js";
export { BUNDLED_STDLIB_ROOT };

const BUNDLED_MODULES = new Map<string, string>();

class StdlibFS implements FileSystem {
  constructor(private readonly fallback: FileSystem, private readonly cacheRoot?: string) {}

  private tryMapVirtualStdPath(virtualPath: string): { realPath: string } | null {
    // virtualPath is normalized via toVirtualPath by callers
    if (!virtualPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) return null;
    const rel = virtualPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
    const parts = rel.split("/");
    const pkgName = getStdPackageShortName(`std/${parts[0]}`);
    const rest = parts.slice(1).join("/");
    if (!pkgName) return null;
    const version = DEFAULT_STD_VERSIONS[pkgName];
    if (!version) return null;

    // Let ModuleResolver probe package roots as directories so it resolves to
    // /std/<pkg>/index.do instead of treating /std/<pkg> as a file.
    if (rest.length === 0) return null;

    // Materialize remote repo: https://github.com/doof-lang/<pkgName>
    const url = `https://github.com/doof-lang/${pkgName}.git`;
    try {
      const resolved = materializeRemoteDependencyByUrl(url, version, this.cacheRoot);
      const rootDir = resolved.rootDir;
      const target = nodePath.join(rootDir, rest);
      return { realPath: target };
    } catch {
      return null;
    }
  }

  readFile(absolutePath: string): string | null {
    const normalizedPath = toVirtualPath(absolutePath);
    // In-memory bundled modules still take precedence
    const inMem = BUNDLED_MODULES.get(normalizedPath);
    if (inMem !== undefined) return inMem;

    const mapped = this.tryMapVirtualStdPath(normalizedPath);
    if (mapped) {
      const content = this.fallback.readFile(mapped.realPath);
      if (content !== null) return content;
    }

    return this.fallback.readFile(absolutePath);
  }

  fileExists(absolutePath: string): boolean {
    const normalizedPath = toVirtualPath(absolutePath);
    if (BUNDLED_MODULES.has(normalizedPath)) return true;
    const mapped = this.tryMapVirtualStdPath(normalizedPath);
    if (mapped && this.fallback.fileExists(mapped.realPath)) return true;
    return this.fallback.fileExists(absolutePath);
  }
}

export function withBundledStdlib(fileSystem: FileSystem, cacheRoot?: string): FileSystem {
  return new StdlibFS(fileSystem, cacheRoot);
}

export function createBundledModuleResolver(
  fileSystem: FileSystem,
  options: ResolverOptions & { cacheRoot?: string } = {},
): ModuleResolver {
  return new ModuleResolver(withBundledStdlib(fileSystem, options.cacheRoot), {
    ...options,
    stdlibRoot: options.stdlibRoot ?? BUNDLED_STDLIB_ROOT,
  });
}