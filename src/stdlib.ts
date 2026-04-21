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

export interface BundledStdlibOptions {
  cacheRoot?: string;
  materializeRemoteDependency?: BundledStdlibRemoteMaterializer;
}

function resolveBundledStdlibAsset(...segments: string[]): string {
  const nodeFs = getNodeFs();
  if (!nodeFs) {
    throw new Error("Bundled stdlib assets are not available in this runtime");
  }

  return nodeFs.readFileSync(new URL(`../stdlib/${segments.join("/")}`, import.meta.url), "utf8");
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

  const stdlibRoot = fileUrlToFsPath(new URL(/* @vite-ignore */ "../stdlib/", import.meta.url));
  const absolutePath = joinFsPath(resolveFsPath(stdlibRoot), ...relativePath.split("/"));
  return nodeFs.existsSync(absolutePath) ? absolutePath : null;
}

const BUNDLED_STD_JSON_MODULE_PATH = `${BUNDLED_STDLIB_ROOT}/std/json/index.do`;
const BUNDLED_STD_JSON_NATIVE_HEADER_PATH = "__doof_stdlib__/std/json/native_json.hpp";
let bundledStdJsonNativeHeader: string | null = null;

function getBundledStdJsonNativeHeader(): string {
  if (bundledStdJsonNativeHeader === null) {
    bundledStdJsonNativeHeader = resolveBundledStdlibAsset("json", "native_json.hpp");
  }
  return bundledStdJsonNativeHeader;
}

const BUNDLED_MODULES = new Map<string, string>([
  [
    BUNDLED_STD_JSON_MODULE_PATH,
    [
      'export import function parseJsonValue(text: string): Result<JsonValue, string>',
      '  from "./native_json.hpp" as doof_json::parse',
      "",
      'export import function formatJsonValue(value: JsonValue): string',
      '  from "doof_runtime.hpp" as doof::to_string',
    ].join("\n"),
  ],
]);

class StdlibFS implements FileSystem {
  constructor(
    private readonly fallback: FileSystem,
    private readonly options: BundledStdlibOptions = {},
  ) {}

  private tryMapVirtualStdPath(virtualPath: string): { realPath: string } | null {
    // virtualPath is normalized via toVirtualPath by callers
    if (!virtualPath.startsWith(`${BUNDLED_STDLIB_ROOT}/std/`)) return null;
    const rel = virtualPath.slice((`${BUNDLED_STDLIB_ROOT}/std/`).length);
    const overridePath = resolveStdlibOverridePath(`std/${rel}`);
    if (overridePath) {
      return { realPath: overridePath };
    }

    const checkedInPath = resolveCheckedInStdlibPath(rel);
    if (checkedInPath) {
      return { realPath: checkedInPath };
    }

    const parts = rel.split("/");
    const pkgName = getStdPackageShortName(`std/${parts[0]}`);
    const rest = parts.slice(1).join("/");
    if (!pkgName || !isStdPackageName(pkgName)) return null;
    const version = DEFAULT_STD_VERSIONS[pkgName];
    if (!version) return null;

    // Let ModuleResolver probe package roots as directories so it resolves to
    // /std/<pkg>/index.do instead of treating /std/<pkg> as a file.
    if (rest.length === 0) return null;

    // Materialize remote repo: https://github.com/doof-lang/<pkgName>
    const url = `https://github.com/doof-lang/${pkgName}.git`;
    if (!this.options.materializeRemoteDependency) {
      return null;
    }

    try {
      const resolved = this.options.materializeRemoteDependency(url, version, this.options.cacheRoot);
      const rootDir = resolved.rootDir;
      const target = joinFsPath(rootDir, rest);
      return { realPath: target };
    } catch {
      return null;
    }
  }

  readFile(absolutePath: string): string | null {
    const normalizedPath = toVirtualPath(absolutePath);
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

export function withBundledStdlib(
  fileSystem: FileSystem,
  options: BundledStdlibOptions | string | undefined = undefined,
): FileSystem {
  return new StdlibFS(fileSystem, typeof options === "string" ? { cacheRoot: options } : options);
}

export function getBundledStdlibSupportFiles(modulePaths: Iterable<string>): ProjectSupportFile[] {
  for (const modulePath of modulePaths) {
    if (modulePath === BUNDLED_STD_JSON_MODULE_PATH) {
      return [{
        relativePath: BUNDLED_STD_JSON_NATIVE_HEADER_PATH,
        content: getBundledStdJsonNativeHeader(),
      }];
    }
  }
  return [];
}

export function createBundledModuleResolver(
  fileSystem: FileSystem,
  options: ResolverOptions & BundledStdlibOptions = {},
): ModuleResolver {
  const { cacheRoot, materializeRemoteDependency, ...resolverOptions } = options;
  return new ModuleResolver(withBundledStdlib(fileSystem, { cacheRoot, materializeRemoteDependency }), {
    ...resolverOptions,
    stdlibRoot: resolverOptions.stdlibRoot ?? BUNDLED_STDLIB_ROOT,
  });
}