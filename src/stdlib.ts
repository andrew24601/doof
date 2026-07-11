import type * as nodeFsModule from "node:fs";
import { ModuleResolver, type FileSystem, type ResolverOptions } from "./resolver.js";
import { joinFsPath, resolveFsPath, toVirtualPath } from "./path-utils.js";
import type { ProjectSupportFile } from "./macos-app-support.js";
import { DEFAULT_STD_VERSIONS, getStdPackageShortName, isStdPackageName, resolveStdlibOverridePath } from "./std-packages.js";
import { BUNDLED_STDLIB_ROOT } from "./stdlib-constants.js";
export { BUNDLED_STDLIB_ROOT };

export interface BundledStdlibMaterializedDependency {
  rootDir: string;
}

export type BundledStdlibRemoteMaterializer = (
  url: string,
  version: string,
  cacheRoot?: string,
) => BundledStdlibMaterializedDependency;

export type BundledStdlibFiles = ReadonlyMap<string, string>;

export interface BundledStdlibOptions {
  cacheRoot?: string;
  /** Source files keyed by package-relative paths such as "math/index.do". */
  files?: BundledStdlibFiles;
  materializeRemoteDependency?: BundledStdlibRemoteMaterializer;
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

function getNodeFs(): typeof nodeFsModule | null {
  if (!isNodeRuntime()) {
    return null;
  }

  const processWithBuiltins = process as typeof process & { getBuiltinModule?: (id: string) => unknown };
  return typeof processWithBuiltins.getBuiltinModule === "function"
    ? processWithBuiltins.getBuiltinModule("node:fs") as typeof nodeFsModule
    : null;
}

function fileUrlToFsPath(url: URL): string {
  const decodedPath = decodeURIComponent(url.pathname);
  if (typeof process !== "undefined" && process.platform === "win32") {
    return decodedPath.replace(/^\//, "").replace(/\//g, "\\");
  }
  return decodedPath;
}

function resolveCheckedInStdlibPath(relativePath: string): string | null {
  const nodeFs = getNodeFs();
  if (!nodeFs) {
    return null;
  }

  const stdlibRoot = fileUrlToFsPath(new URL(/* @vite-ignore */ "../../doof-stdlib/", import.meta.url));
  const absolutePath = joinFsPath(resolveFsPath(stdlibRoot), ...relativePath.split("/"));
  return nodeFs.existsSync(absolutePath) ? absolutePath : null;
}

const BUNDLED_STD_JSON_MODULE_PATH = `${BUNDLED_STDLIB_ROOT}/std/json/index.do`;
const BUNDLED_STD_JSON_NATIVE_HEADER_PATH = "__doof_stdlib__/std/json/native_json.hpp";

function readStdlibAsset(relativePath: string): string | null {
  const nodeFs = getNodeFs();
  if (!nodeFs) return null;

  const overridePath = resolveStdlibOverridePath(`std/${relativePath}`);
  const checkedInPath = resolveCheckedInStdlibPath(relativePath);
  for (const candidate of [overridePath, checkedInPath]) {
    if (candidate && nodeFs.existsSync(candidate)) {
      return nodeFs.readFileSync(candidate, "utf8");
    }
  }
  return null;
}

function isBundledStdJsonModulePath(modulePath: string): boolean {
  return modulePath === BUNDLED_STD_JSON_MODULE_PATH
    || modulePath.endsWith("/doof-stdlib/json/index.do")
    || modulePath.endsWith("/std/json/index.do");
}

function isBundledStdJsonVirtualPath(path: string): boolean {
  return path === `${BUNDLED_STDLIB_ROOT}/std/json`
    || path.startsWith(`${BUNDLED_STDLIB_ROOT}/std/json/`);
}

class StdlibFS implements FileSystem {
  constructor(
    private readonly fallback: FileSystem,
    private readonly options: BundledStdlibOptions = {},
  ) {}

  private readProvidedFile(virtualPath: string): string | null {
    if (!virtualPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) return null;

    const relativePath = virtualPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
    return this.options.files?.get(relativePath) ?? null;
  }

  private hasProvidedFile(virtualPath: string): boolean {
    if (!virtualPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) return false;

    const relativePath = virtualPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
    return this.options.files?.has(relativePath) ?? false;
  }

  private tryMapVirtualStdPath(virtualPath: string): { realPath: string } | null {
    // virtualPath is normalized via toVirtualPath by callers
    if (!virtualPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) return null;
    const rel = virtualPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
    const parts = rel.split("/");
    const pkgName = getStdPackageShortName(`std/${parts[0]}`);
    const rest = parts.slice(1).join("/");
    if (!pkgName || !isStdPackageName(pkgName)) return null;
    if (rest.length === 0 && parts[0] !== "json") return null;
    const packageRelativePath = rest.length === 0 ? "index.do" : rest;
    const packageRelative = joinFsPath(parts[0], packageRelativePath);

    const overridePath = resolveStdlibOverridePath(`std/${packageRelative}`);
    if (overridePath) {
      return { realPath: overridePath };
    }

    const checkedInPath = resolveCheckedInStdlibPath(packageRelative);
    if (checkedInPath) {
      return { realPath: checkedInPath };
    }

    const version = DEFAULT_STD_VERSIONS[pkgName];
    if (!version) return null;

    // Let ModuleResolver probe package roots as directories so it resolves to
    // /std/<pkg>/index.do instead of treating /std/<pkg> as a file.
    // Materialize remote repo: https://github.com/doof-lang/<pkgName>
    const url = `https://github.com/doof-lang/${pkgName}.git`;
    if (!this.options.materializeRemoteDependency) {
      return null;
    }

    try {
      const resolved = this.options.materializeRemoteDependency(url, version, this.options.cacheRoot);
      const rootDir = resolved.rootDir;
      const target = joinFsPath(rootDir, packageRelativePath);
      return { realPath: target };
    } catch {
      return null;
    }
  }

  readFile(absolutePath: string): string | null {
    const normalizedPath = toVirtualPath(absolutePath);
    const providedFile = this.readProvidedFile(normalizedPath);
    if (providedFile !== null) return providedFile;

    const mapped = this.tryMapVirtualStdPath(normalizedPath);
    if (mapped) {
      const content = this.fallback.readFile(mapped.realPath);
      if (content !== null) return content;
      const nodeFs = getNodeFs();
      if (isBundledStdJsonVirtualPath(normalizedPath) && nodeFs?.existsSync(mapped.realPath)) {
        return nodeFs.readFileSync(mapped.realPath, "utf8");
      }
    }

    return this.fallback.readFile(absolutePath);
  }

  fileExists(absolutePath: string): boolean {
    const normalizedPath = toVirtualPath(absolutePath);
    if (normalizedPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) {
      const rel = normalizedPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
      if (!rel.includes("/")) return false;
    }

    if (this.hasProvidedFile(normalizedPath)) return true;

    const mapped = this.tryMapVirtualStdPath(normalizedPath);
    if (mapped) {
      if (this.fallback.fileExists(mapped.realPath)) return true;
      const nodeFs = getNodeFs();
      if (isBundledStdJsonVirtualPath(normalizedPath) && nodeFs?.existsSync(mapped.realPath)) return true;
    }
    return this.fallback.fileExists(absolutePath);
  }
}

export function getBundledStdlibSupportFiles(modulePaths: Iterable<string>): ProjectSupportFile[] {
  if (![...modulePaths].some(isBundledStdJsonModulePath)) {
    return [];
  }

  const content = readStdlibAsset("json/native_json.hpp");
  if (content === null) {
    throw new Error("Unable to load std/json/native_json.hpp from the configured stdlib checkout");
  }
  return [{
    relativePath: BUNDLED_STD_JSON_NATIVE_HEADER_PATH,
    content,
  }];
}

export function withBundledStdlib(
  fileSystem: FileSystem,
  options: BundledStdlibOptions | string | undefined = undefined,
): FileSystem {
  return new StdlibFS(fileSystem, typeof options === "string" ? { cacheRoot: options } : options);
}

export function createBundledModuleResolver(
  fileSystem: FileSystem,
  options: ResolverOptions & BundledStdlibOptions = {},
): ModuleResolver {
  const { cacheRoot, files, materializeRemoteDependency, ...resolverOptions } = options;
  return new ModuleResolver(withBundledStdlib(fileSystem, { cacheRoot, files, materializeRemoteDependency }), {
    ...resolverOptions,
    stdlibRoot: resolverOptions.stdlibRoot ?? BUNDLED_STDLIB_ROOT,
  });
}
