import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { joinFsPath, resolveFsPath } from "./path-utils.js";
import { DEFAULT_STD_VERSIONS, getStdPackageShortName, getStdlibRootOverride, isStdPackageName } from "./std-packages.js";

function getCandidateCheckedInStdlibRoots(): string[] {
  return [
    nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..", "stdlib"),
    nodePath.resolve(process.cwd(), "stdlib"),
  ];
}

function getCheckedInStdlibRoot(): string {
  const existingRoot = getCandidateCheckedInStdlibRoots().find((rootPath) => nodeFs.existsSync(rootPath));
  return existingRoot ?? getCandidateCheckedInStdlibRoots()[0];
}

export function resolveNodeStdlibPath(specifier: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const shortName = getStdPackageShortName(specifier);
  if (!shortName) {
    return null;
  }

  const [packageName, ...subpath] = shortName.split("/");
  if (!packageName || !isStdPackageName(packageName)) {
    return null;
  }

  const rootOverride = getStdlibRootOverride(env);
  if (rootOverride) {
    return joinFsPath(rootOverride, packageName, ...subpath);
  }

  const checkedInPackageRoot = nodePath.join(getCheckedInStdlibRoot(), packageName);
  if (!nodeFs.existsSync(checkedInPackageRoot)) {
    return null;
  }

  return joinFsPath(resolveFsPath(checkedInPackageRoot), ...subpath);
}

export function getImplicitStdDependencyLocalRoot(
  packageName: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isStdPackageName(packageName)) {
    return null;
  }

  const resolvedRoot = resolveNodeStdlibPath(`std/${packageName}`, env);
  if (!resolvedRoot) {
    return null;
  }

  const manifestPath = joinFsPath(resolvedRoot, "doof.json");
  return nodeFs.existsSync(manifestPath) ? resolvedRoot : null;
}