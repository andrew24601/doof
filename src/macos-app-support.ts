import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";

export interface ProjectSupportFile {
  relativePath: string;
  content: string;
  executable?: boolean;
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

export function getMacOSAppInfoPlistPath(): string {
  return MACOS_APP_INFO_PLIST_PATH;
}

export function getMacOSIconScriptPath(): string {
  return MACOS_ICON_SCRIPT_PATH;
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

export function renderMacOSIconScript(): string {
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