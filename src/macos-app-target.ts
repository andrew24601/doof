import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";
import { toPortablePath } from "./path-utils.js";

export interface ProjectSupportFile {
  relativePath: string;
  content: string;
  executable?: boolean;
}

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

const MACOS_APP_INFO_PLIST_PATH = "Info.plist";
const MACOS_ICON_SCRIPT_PATH = "generate-macos-icon.sh";

export function createMacOSAppSupportFiles(
  config: ResolvedDoofMacOSAppConfig,
  executableName: string,
): ProjectSupportFile[] {
  return [
    {
      relativePath: MACOS_APP_INFO_PLIST_PATH,
      content: renderMacOSAppInfoPlist(config, executableName),
    },
    {
      relativePath: MACOS_ICON_SCRIPT_PATH,
      content: `${renderMacOSIconScript()}\n`,
      executable: true,
    },
  ];
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
  const infoPlistPath = nodePath.join(outputDir, MACOS_APP_INFO_PLIST_PATH);
  const iconScriptPath = nodePath.join(outputDir, MACOS_ICON_SCRIPT_PATH);
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

export function getMacOSAppInfoPlistPath(): string {
  return MACOS_APP_INFO_PLIST_PATH;
}

export function getMacOSIconScriptPath(): string {
  return MACOS_ICON_SCRIPT_PATH;
}

function renderMacOSAppInfoPlist(config: ResolvedDoofMacOSAppConfig, executableName: string): string {
  const iconFileName = `${executableName}.icns`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleDevelopmentRegion</key>',
    '  <string>en</string>',
    '  <key>CFBundleDisplayName</key>',
    `  <string>${escapeXml(config.displayName)}</string>`,
    '  <key>CFBundleExecutable</key>',
    `  <string>${escapeXml(executableName)}</string>`,
    '  <key>CFBundleIconFile</key>',
    `  <string>${escapeXml(iconFileName)}</string>`,
    '  <key>CFBundleIdentifier</key>',
    `  <string>${escapeXml(config.bundleId)}</string>`,
    '  <key>CFBundleInfoDictionaryVersion</key>',
    '  <string>6.0</string>',
    '  <key>CFBundleName</key>',
    `  <string>${escapeXml(config.displayName)}</string>`,
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleShortVersionString</key>',
    `  <string>${escapeXml(config.version)}</string>`,
    '  <key>CFBundleVersion</key>',
    `  <string>${escapeXml(config.version)}</string>`,
    '  <key>LSApplicationCategoryType</key>',
    `  <string>${escapeXml(config.category)}</string>`,
    '  <key>LSMinimumSystemVersion</key>',
    `  <string>${escapeXml(config.minimumSystemVersion)}</string>`,
    '  <key>NSHighResolutionCapable</key>',
    '  <true/>',
    '  <key>NSPrincipalClass</key>',
    '  <string>NSApplication</string>',
    '</dict>',
    '</plist>',
  ].join("\n");
}

function renderMacOSIconScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "if [ \"$#\" -ne 2 ]; then",
    "  echo \"Usage: $0 <input-svg> <output-icns>\" >&2",
    "  exit 1",
    "fi",
    "",
    "INPUT_SVG=\"$1\"",
    "OUTPUT_ICNS=\"$2\"",
    "",
    "for tool in qlmanage sips iconutil; do",
    "  if ! command -v \"$tool\" >/dev/null 2>&1; then",
    "    echo \"Missing required macOS tool: $tool\" >&2",
    "    exit 1",
    "  fi",
    "done",
    "",
    "WORK_DIR=\"$(mktemp -d \"${TMPDIR:-/tmp}/doof-macos-icon.XXXXXX\")\"",
    "ICONSET_DIR=\"$WORK_DIR/app.iconset\"",
    "PREVIEW_DIR=\"$WORK_DIR/preview\"",
    "",
    "cleanup() {",
    "  rm -rf \"$WORK_DIR\"",
    "}",
    "trap cleanup EXIT",
    "",
    "mkdir -p \"$ICONSET_DIR\" \"$PREVIEW_DIR\"",
    "",
    "qlmanage -t -s 1024 -o \"$PREVIEW_DIR\" \"$INPUT_SVG\" >/dev/null",
    "",
    "MASTER_PNG=\"$(find \"$PREVIEW_DIR\" -name '*.png' -print -quit)\"",
    "if [ -z \"$MASTER_PNG\" ]; then",
    "  echo \"Failed to rasterize $INPUT_SVG\" >&2",
    "  exit 1",
    "fi",
    "",
    "render_icon() {",
    "  local size=\"$1\"",
    "  local name=\"$2\"",
    "  sips -z \"$size\" \"$size\" \"$MASTER_PNG\" --out \"$ICONSET_DIR/$name\" >/dev/null",
    "}",
    "",
    "render_icon 16 icon_16x16.png",
    "render_icon 32 icon_16x16@2x.png",
    "render_icon 32 icon_32x32.png",
    "render_icon 64 icon_32x32@2x.png",
    "render_icon 128 icon_128x128.png",
    "render_icon 256 icon_128x128@2x.png",
    "render_icon 256 icon_256x256.png",
    "render_icon 512 icon_256x256@2x.png",
    "render_icon 512 icon_512x512.png",
    "render_icon 1024 icon_512x512@2x.png",
    "",
    "mkdir -p \"$(dirname \"$OUTPUT_ICNS\")\"",
    "iconutil -c icns \"$ICONSET_DIR\" -o \"$OUTPUT_ICNS\"",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
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
