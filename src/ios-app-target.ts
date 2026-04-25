import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { ResolvedDoofIOSAppConfig } from "./build-targets.js";
import {
  getIOSAppAssetCatalogPath,
  getIOSAppInfoPlistPath,
  renderIOSAppInfoPlist,
} from "./ios-app-support.js";
import { toPortablePath } from "./path-utils.js";

export interface IOSAppBundleResult {
  appPath: string;
  binaryPath: string;
}

export interface AssembleIOSAppBundleOptions {
  outputDir: string;
  executablePath: string;
  executableName: string;
  config: ResolvedDoofIOSAppConfig;
  log?: (message: string) => void;
  platform?: NodeJS.Platform;
}

export function assembleIOSAppBundle(options: AssembleIOSAppBundleOptions): IOSAppBundleResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("doof build for build.target=ios-app is only supported on macOS");
  }

  const { outputDir, executablePath, executableName, config, log } = options;
  const appPath = nodePath.join(outputDir, `${executableName}.app`);
  const bundleBinaryPath = nodePath.join(appPath, executableName);
  const infoPlistPath = nodePath.join(outputDir, getIOSAppInfoPlistPath());
  const assetCatalogPath = nodePath.join(outputDir, getIOSAppAssetCatalogPath());

  nodeFs.rmSync(appPath, { recursive: true, force: true });
  nodeFs.mkdirSync(appPath, { recursive: true });

  nodeFs.copyFileSync(executablePath, bundleBinaryPath);
  nodeFs.chmodSync(bundleBinaryPath, nodeFs.statSync(executablePath).mode);

  if (nodeFs.existsSync(infoPlistPath)) {
    nodeFs.copyFileSync(infoPlistPath, nodePath.join(appPath, "Info.plist"));
  } else {
    nodeFs.writeFileSync(nodePath.join(appPath, "Info.plist"), renderIOSAppInfoPlist(config, executableName), "utf8");
  }

  if (nodeFs.existsSync(assetCatalogPath)) {
    copyPath(assetCatalogPath, nodePath.join(appPath, getIOSAppAssetCatalogPath()));
  }

  const seenDestinations = new Set<string>();
  for (const resource of config.resources) {
    const matchedFiles = expandResourcePattern(resource.fromPattern);
    if (matchedFiles.length === 0) {
      throw new Error(`No files matched resource pattern: ${resource.fromPattern}`);
    }

    const destinationDir = resource.destination.length > 0
      ? nodePath.join(appPath, resource.destination)
      : appPath;
    nodeFs.mkdirSync(destinationDir, { recursive: true });

    for (const matchedFile of matchedFiles) {
      const destinationPath = nodePath.join(destinationDir, nodePath.basename(matchedFile));
      if (seenDestinations.has(destinationPath)) {
        throw new Error(`Duplicate iOS app resource destination: ${destinationPath}`);
      }
      seenDestinations.add(destinationPath);
      nodeFs.copyFileSync(matchedFile, destinationPath);
    }
  }

  log?.(`App bundle: ${appPath}`);
  return { appPath, binaryPath: bundleBinaryPath };
}

function copyPath(sourcePath: string, destinationPath: string): void {
  const stats = nodeFs.statSync(sourcePath);
  if (stats.isDirectory()) {
    nodeFs.mkdirSync(destinationPath, { recursive: true });
    const entries = nodeFs.readdirSync(sourcePath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      copyPath(nodePath.join(sourcePath, entry.name), nodePath.join(destinationPath, entry.name));
    }
    return;
  }

  nodeFs.mkdirSync(nodePath.dirname(destinationPath), { recursive: true });
  nodeFs.copyFileSync(sourcePath, destinationPath);
}

function expandResourcePattern(pattern: string): string[] {
  if (!hasWildcard(pattern)) {
    if (!nodeFs.existsSync(pattern) || !nodeFs.statSync(pattern).isFile()) {
      return [];
    }
    return [pattern];
  }

  const baseDir = getGlobBaseDir(pattern);
  if (!nodeFs.existsSync(baseDir)) {
    return [];
  }

  const relativePattern = toPortablePath(nodePath.relative(baseDir, pattern));
  const matcher = globToRegExp(relativePattern);
  const matches: string[] = [];
  walkFiles(baseDir, (filePath) => {
    const relativePath = toPortablePath(nodePath.relative(baseDir, filePath));
    if (matcher.test(relativePath)) {
      matches.push(filePath);
    }
  });

  return matches.sort((left, right) => left.localeCompare(right));
}

function walkFiles(dirPath: string, visit: (filePath: string) => void): void {
  const entries = nodeFs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = nodePath.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit);
      continue;
    }
    if (entry.isFile()) {
      visit(entryPath);
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index];
    const next = pattern[index + 1];
    if (current === "*" && next === "*") {
      source += ".*";
      index++;
      continue;
    }
    if (current === "*") {
      source += "[^/]*";
      continue;
    }
    if ("\\.^$+?()[]{}|".includes(current)) {
      source += `\\${current}`;
      continue;
    }
    source += current;
  }
  source += "$";
  return new RegExp(source);
}

function getGlobBaseDir(pattern: string): string {
  const portablePattern = toPortablePath(pattern);
  const wildcardIndex = portablePattern.search(/\*/);
  if (wildcardIndex === -1) {
    return nodePath.dirname(pattern);
  }

  const prefix = portablePattern.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf("/");
  if (slashIndex <= 0) {
    return portablePattern.startsWith("/") ? "/" : nodePath.resolve(".");
  }

  return prefix.slice(0, slashIndex);
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}