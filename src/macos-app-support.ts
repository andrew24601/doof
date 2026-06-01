import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";

export interface ProjectSupportFile {
  relativePath: string;
  content: string;
  executable?: boolean;
}

const MACOS_APP_INFO_PLIST_PATH = "Info.plist";
const MACOS_APP_PKG_INFO_PATH = "PkgInfo";

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
      relativePath: MACOS_APP_PKG_INFO_PATH,
      content: "APPL????",
    },
  ];
}

export function getMacOSAppInfoPlistPath(): string {
  return MACOS_APP_INFO_PLIST_PATH;
}

export function renderMacOSAppInfoPlist(config: ResolvedDoofMacOSAppConfig, executableName: string): string {
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
