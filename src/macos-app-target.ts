import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";
import {
  createMacOSAppSupportFiles,
  getMacOSAppInfoPlistPath,
  getMacOSIconScriptPath,
  renderMacOSAppInfoPlist,
  renderMacOSIconScript,
  type ProjectSupportFile,
} from "./macos-app-support.js";
import { toPortablePath } from "./path-utils.js";

export { createMacOSAppSupportFiles, getMacOSAppInfoPlistPath, getMacOSIconScriptPath, type ProjectSupportFile };

export interface MacOSAppBundleResult {
  appPath: string;
  binaryPath: string;
}

export interface AssembleMacOSAppBundleOptions {
  outputDir: string;
  executablePath: string;
  executableName: string;
  config: ResolvedDoofMacOSAppConfig;
  log?: (message: string) => void;
  platform?: NodeJS.Platform;
  generateIcon?: (iconPath: string, outputPath: string) => void;
}

export function assembleMacOSAppBundle(options: AssembleMacOSAppBundleOptions): MacOSAppBundleResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("doof build for build.target=macos-app is only supported on macOS");
  }

  const { outputDir, executablePath, executableName, config, log, generateIcon } = options;
  const appPath = nodePath.join(outputDir, `${executableName}.app`);
  const contentsDir = nodePath.join(appPath, "Contents");
  const macosDir = nodePath.join(contentsDir, "MacOS");
  const resourcesDir = nodePath.join(contentsDir, "Resources");
  const bundleBinaryPath = nodePath.join(macosDir, executableName);
  const infoPlistPath = nodePath.join(outputDir, getMacOSAppInfoPlistPath());
  const iconScriptPath = nodePath.join(outputDir, getMacOSIconScriptPath());
  const iconOutputPath = nodePath.join(resourcesDir, `${executableName}.icns`);

  nodeFs.rmSync(appPath, { recursive: true, force: true });
  nodeFs.mkdirSync(macosDir, { recursive: true });
  nodeFs.mkdirSync(resourcesDir, { recursive: true });

  nodeFs.copyFileSync(executablePath, bundleBinaryPath);
  nodeFs.chmodSync(bundleBinaryPath, nodeFs.statSync(executablePath).mode);

  if (nodeFs.existsSync(infoPlistPath)) {
    nodeFs.copyFileSync(infoPlistPath, nodePath.join(contentsDir, "Info.plist"));
  } else {
    nodeFs.writeFileSync(nodePath.join(contentsDir, "Info.plist"), renderMacOSAppInfoPlist(config, executableName), "utf8");
  }

  if (!nodeFs.existsSync(iconScriptPath)) {
    nodeFs.writeFileSync(iconScriptPath, `${renderMacOSIconScript()}\n`, "utf8");
    nodeFs.chmodSync(iconScriptPath, 0o755);
  }

  if (generateIcon) {
    generateIcon(config.iconPath, iconOutputPath);
  } else {
    try {
      const { execFileSync } = requireChildProcess();
      execFileSync("/bin/bash", [iconScriptPath, config.iconPath, iconOutputPath], {
        stdio: "pipe",
        timeout: 30000,
      });
    } catch (error: any) {
      throw new Error(formatProcessFailure("Failed to generate macOS app icon", error));
    }
  }

  const seenDestinations = new Set<string>();
  for (const resource of config.resources) {
    const matchedFiles = expandResourcePattern(resource.fromPattern);
    if (matchedFiles.length === 0) {
      throw new Error(`No files matched resource pattern: ${resource.fromPattern}`);
    }

    const destinationDir = resource.destination.length > 0
      ? nodePath.join(resourcesDir, resource.destination)
      : resourcesDir;
    nodeFs.mkdirSync(destinationDir, { recursive: true });

    for (const matchedFile of matchedFiles) {
      const destinationPath = nodePath.join(destinationDir, nodePath.basename(matchedFile));
      if (seenDestinations.has(destinationPath)) {
        throw new Error(`Duplicate macOS app resource destination: ${destinationPath}`);
      }
      seenDestinations.add(destinationPath);
      nodeFs.copyFileSync(matchedFile, destinationPath);
    }
  }

  log?.(`App bundle: ${appPath}`);
  return { appPath, binaryPath: bundleBinaryPath };
}

function requireChildProcess(): typeof import("node:child_process") {
  return new Function("return require('node:child_process')")() as typeof import("node:child_process");
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
