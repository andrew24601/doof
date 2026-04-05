import * as nodePath from "node:path";

type PathApi = typeof nodePath.posix | typeof nodePath.win32;

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;

export function usesWindowsPath(pathValue: string): boolean {
  return WINDOWS_DRIVE_PATH_RE.test(pathValue) || pathValue.startsWith("\\\\");
}

export function getPathApi(pathValue: string): PathApi {
  return usesWindowsPath(pathValue) ? nodePath.win32 : nodePath.posix;
}

export function resolveFsPath(pathValue: string): string {
  return getPathApi(pathValue).resolve(pathValue);
}

export function resolveFsPathFrom(fromPath: string, ...segments: string[]): string {
  return getPathApi(fromPath).resolve(fromPath, ...segments);
}

export function dirnameFsPath(pathValue: string): string {
  return getPathApi(pathValue).dirname(pathValue);
}

export function joinFsPath(basePath: string, ...segments: string[]): string {
  return getPathApi(basePath).join(basePath, ...segments);
}

export function relativeFsPath(fromPath: string, toPath: string): string {
  const pathApi = usesWindowsPath(fromPath) || usesWindowsPath(toPath)
    ? nodePath.win32
    : nodePath.posix;
  return pathApi.relative(fromPath, toPath);
}

export function isAbsoluteFsPath(pathValue: string): boolean {
  return getPathApi(pathValue).isAbsolute(pathValue);
}

export function fsPathSep(pathValue: string): string {
  return getPathApi(pathValue).sep;
}

export function isWithinFsRoot(filePath: string, rootDir: string): boolean {
  const pathApi = usesWindowsPath(filePath) || usesWindowsPath(rootDir)
    ? nodePath.win32
    : nodePath.posix;
  const normalizedFilePath = pathApi.resolve(filePath);
  const normalizedRootDir = pathApi.resolve(rootDir);
  return normalizedFilePath === normalizedRootDir
    || normalizedFilePath.startsWith(normalizedRootDir + pathApi.sep);
}

export function toPortablePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

export function toVirtualPath(pathValue: string): string {
  const portablePath = toPortablePath(pathValue);
  const withoutDrive = portablePath.replace(/^[A-Za-z]:/, "");
  const absolutePath = withoutDrive.startsWith("/") ? withoutDrive : `/${withoutDrive}`;
  return nodePath.posix.normalize(absolutePath);
}