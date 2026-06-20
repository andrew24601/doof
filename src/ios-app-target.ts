import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import plist from "plist";
import type { IOSAppDestination, ResolvedDoofIOSAppConfig } from "./build-targets.js";
import {
  getIOSAppAssetCatalogPath,
  getIOSAppInfoPlistPath,
  renderIOSAppInfoPlist,
} from "./ios-app-support.js";
import { toPortablePath } from "./path-utils.js";
import { embedAppleLibraries, type AppleEmbeddedLibraryHost } from "./apple-embedded-libraries.js";

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
  destination?: IOSAppDestination;
  compileAssetCatalog?: (options: IOSAppAssetCatalogCompileOptions) => void;
  libraryPaths?: readonly string[];
  embeddedLibraryHost?: AppleEmbeddedLibraryHost;
}

export interface IOSAppAssetCatalogCompileOptions {
  iconPath: string;
  assetCatalogPath: string;
  appPath: string;
  infoPlistPath: string;
  platform: "iphonesimulator" | "iphoneos";
  minimumDeploymentTarget: string;
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

  if (config.iconPath !== undefined && nodeFs.existsSync(assetCatalogPath)) {
    try {
      (options.compileAssetCatalog ?? compileIOSAppAssetCatalog)({
        iconPath: config.iconPath,
        assetCatalogPath,
        appPath,
        infoPlistPath: nodePath.join(appPath, "Info.plist"),
        platform: options.destination === "device" ? "iphoneos" : "iphonesimulator",
        minimumDeploymentTarget: config.minimumDeploymentTarget,
      });
    } catch (error: any) {
      throw new Error(formatProcessFailure("Failed to compile iOS app icon", error));
    }
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

  embedAppleLibraries({
    executablePath: bundleBinaryPath,
    frameworksDir: nodePath.join(appPath, "Frameworks"),
    executableFrameworkRPath: "@executable_path/Frameworks",
    embeddedLibraries: config.embeddedLibraries ?? [],
    libraryPaths: options.libraryPaths ?? [],
    platform: options.destination === "device" ? "ios" : "ios-simulator",
    host: options.embeddedLibraryHost,
  });

  log?.(`App bundle: ${appPath}`);
  return { appPath, binaryPath: bundleBinaryPath };
}

export function compileIOSAppAssetCatalog(options: IOSAppAssetCatalogCompileOptions): void {
  populateIOSAppIconSetFromPng(options.iconPath, options.assetCatalogPath);
  const workDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doof-ios-icon-"));
  const partialInfoPlistPath = nodePath.join(workDir, "asset-catalog-info.plist");
  try {
    execFileSync("xcrun", [
      "actool",
      options.assetCatalogPath,
      "--compile", options.appPath,
      "--platform", options.platform,
      "--minimum-deployment-target", options.minimumDeploymentTarget,
      "--app-icon", "AppIcon",
      "--target-device", "iphone",
      "--target-device", "ipad",
      "--output-partial-info-plist", partialInfoPlistPath,
    ], {
      stdio: "pipe",
      timeout: 30000,
    });

    const baseInfo = plist.parse(nodeFs.readFileSync(options.infoPlistPath, "utf8")) as Record<string, unknown>;
    const iconInfo = plist.parse(nodeFs.readFileSync(partialInfoPlistPath, "utf8")) as Record<string, unknown>;
    nodeFs.writeFileSync(options.infoPlistPath, plist.build({ ...baseInfo, ...iconInfo }), "utf8");
  } finally {
    nodeFs.rmSync(workDir, { recursive: true, force: true });
  }
}

function populateIOSAppIconSetFromPng(iconPath: string, assetCatalogPath: string): void {
  const iconsetDir = nodePath.join(assetCatalogPath, "AppIcon.appiconset");
  const contentsPath = nodePath.join(iconsetDir, "Contents.json");
  if (!nodeFs.existsSync(contentsPath)) {
    return;
  }

  const parsed = JSON.parse(nodeFs.readFileSync(contentsPath, "utf8")) as {
    images?: Array<{ filename?: string; scale?: string; size?: string }>;
  };
  for (const image of parsed.images ?? []) {
    if (!image.filename || !image.size || !image.scale) {
      continue;
    }
    const pointSize = Number.parseFloat(image.size.split("x")[0] ?? "");
    const scale = Number.parseFloat(image.scale.replace(/x$/, ""));
    const pixelSize = pointSize * scale;
    if (!Number.isInteger(pixelSize) || pixelSize <= 0) {
      throw new Error(`Invalid iOS app icon slot size: ${image.size} @ ${image.scale}`);
    }
    execFileSync("sips", [
      "-z", String(pixelSize), String(pixelSize),
      iconPath,
      "--out", nodePath.join(iconsetDir, image.filename),
    ], {
      stdio: "pipe",
      timeout: 30000,
    });
  }
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

function formatProcessFailure(prefix: string, error: any): string {
  const stdout = error?.stdout?.toString()?.trim();
  const stderr = error?.stderr?.toString()?.trim();
  const details = [stdout, stderr].filter((value): value is string => Boolean(value && value.length > 0));
  return details.length > 0
    ? `${prefix}:\n${details.join("\n")}`
    : `${prefix}:\n${error?.message ?? String(error)}`;
}
