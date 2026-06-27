import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { execFileSync } from "node:child_process";
import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";
import {
  createMacOSAppSupportFiles,
  getMacOSAppInfoPlistPath,
  renderMacOSAppInfoPlist,
  type ProjectSupportFile,
} from "./macos-app-support.js";
import { embedAppleLibraries, type AppleEmbeddedLibraryHost } from "./apple-embedded-libraries.js";
import { expandResourceFiles } from "./resource-patterns.js";

export { createMacOSAppSupportFiles, getMacOSAppInfoPlistPath, type ProjectSupportFile };

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
  libraryPaths?: readonly string[];
  embeddedLibraryHost?: AppleEmbeddedLibraryHost;
}

export function assembleMacOSAppBundle(options: AssembleMacOSAppBundleOptions): MacOSAppBundleResult {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("doof build for build.target=macos-app is only supported on macOS");
  }

  const { outputDir, executablePath, executableName, config, log } = options;
  const appPath = nodePath.join(outputDir, `${executableName}.app`);
  const contentsDir = nodePath.join(appPath, "Contents");
  const macosDir = nodePath.join(contentsDir, "MacOS");
  const resourcesDir = nodePath.join(contentsDir, "Resources");
  const bundleBinaryPath = nodePath.join(macosDir, executableName);
  const infoPlistPath = nodePath.join(outputDir, getMacOSAppInfoPlistPath());
  const pkgInfoPath = nodePath.join(outputDir, "PkgInfo");
  const iconOutputPath = config.iconPath === undefined
    ? undefined
    : nodePath.join(resourcesDir, `${executableName}.icns`);

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
  if (nodeFs.existsSync(pkgInfoPath)) {
    nodeFs.copyFileSync(pkgInfoPath, nodePath.join(contentsDir, "PkgInfo"));
  } else {
    nodeFs.writeFileSync(nodePath.join(contentsDir, "PkgInfo"), "APPL????", "utf8");
  }

  if (config.iconPath !== undefined && iconOutputPath !== undefined) {
    try {
      (options.generateIcon ?? generateMacOSAppIconFromPng)(config.iconPath, iconOutputPath);
    } catch (error: any) {
      throw new Error(formatProcessFailure("Failed to generate macOS app icon", error));
    }
  }

  const seenDestinations = new Set<string>();
  for (const resource of config.resources) {
    const matchedFiles = expandResourceFiles(resource.fromPattern);
    if (matchedFiles.length === 0) {
      throw new Error(`No files matched resource pattern: ${resource.fromPattern}`);
    }

    const destinationDir = resource.destination.length > 0
      ? nodePath.join(resourcesDir, resource.destination)
      : resourcesDir;

    for (const matchedFile of matchedFiles) {
      const destinationPath = nodePath.join(destinationDir, matchedFile.relativePath);
      if (seenDestinations.has(destinationPath)) {
        throw new Error(`Duplicate macOS app resource destination: ${destinationPath}`);
      }
      seenDestinations.add(destinationPath);
      nodeFs.mkdirSync(nodePath.dirname(destinationPath), { recursive: true });
      nodeFs.copyFileSync(matchedFile.sourcePath, destinationPath);
    }
  }

  embedAppleLibraries({
    executablePath: bundleBinaryPath,
    frameworksDir: nodePath.join(contentsDir, "Frameworks"),
    executableFrameworkRPath: "@executable_path/../Frameworks",
    embeddedLibraries: config.embeddedLibraries ?? [],
    libraryPaths: options.libraryPaths ?? [],
    platform: "macos",
    host: options.embeddedLibraryHost,
  });

  log?.(`App bundle: ${appPath}`);
  return { appPath, binaryPath: bundleBinaryPath };
}

export function generateMacOSAppIconFromPng(iconPath: string, outputPath: string): void {
  const workDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doof-macos-icon-"));
  try {
    const iconsetDir = nodePath.join(workDir, "app.iconset");
    nodeFs.mkdirSync(iconsetDir, { recursive: true });
    const renderIcon = (size: number, name: string) => {
      execFileSync("sips", ["-z", String(size), String(size), iconPath, "--out", nodePath.join(iconsetDir, name)], {
        stdio: "pipe",
        timeout: 30000,
      });
    };
    renderIcon(16, "icon_16x16.png");
    renderIcon(32, "icon_16x16@2x.png");
    renderIcon(32, "icon_32x32.png");
    renderIcon(64, "icon_32x32@2x.png");
    renderIcon(128, "icon_128x128.png");
    renderIcon(256, "icon_128x128@2x.png");
    renderIcon(256, "icon_256x256.png");
    renderIcon(512, "icon_256x256@2x.png");
    renderIcon(512, "icon_512x512.png");
    renderIcon(1024, "icon_512x512@2x.png");
    nodeFs.mkdirSync(nodePath.dirname(outputPath), { recursive: true });
    try {
      execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", outputPath], {
        stdio: "pipe",
        timeout: 30000,
      });
    } catch {
      // Some macOS hosts reject otherwise-valid iconsets. Keep the bundle runnable
      // by falling back to the configured PNG asset at the requested icon path.
      nodeFs.copyFileSync(iconPath, outputPath);
    }
  } finally {
    nodeFs.rmSync(workDir, { recursive: true, force: true });
  }
}

function formatProcessFailure(prefix: string, error: any): string {
  const stdout = error?.stdout?.toString()?.trim();
  const stderr = error?.stderr?.toString()?.trim();
  const details = [stdout, stderr].filter((value): value is string => Boolean(value && value.length > 0));
  return details.length > 0
    ? `${prefix}:\n${details.join("\n")}`
    : `${prefix}:\n${error?.message ?? String(error)}`;
}
