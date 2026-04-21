import type { FileSystem, ResolverOptions } from "./resolver.js";
import { materializeRemoteDependencyByUrl } from "./package-manifest.js";
import {
  createBundledModuleResolver,
  withBundledStdlib,
  type BundledStdlibOptions,
} from "./stdlib.js";

function createNodeBundledStdlibOptions(cacheRoot?: string): BundledStdlibOptions {
  return {
    cacheRoot,
    materializeRemoteDependency: materializeRemoteDependencyByUrl,
  };
}

export function withNodeBundledStdlib(fileSystem: FileSystem, cacheRoot?: string): FileSystem {
  return withBundledStdlib(fileSystem, createNodeBundledStdlibOptions(cacheRoot));
}

export function createNodeBundledModuleResolver(
  fileSystem: FileSystem,
  options: ResolverOptions & { cacheRoot?: string } = {},
) {
  return createBundledModuleResolver(fileSystem, {
    ...options,
    materializeRemoteDependency: materializeRemoteDependencyByUrl,
  });
}