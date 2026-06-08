import type { ResolvedDoofMacOSAppConfig } from "./build-targets.js";
import { renderInfoPlist, type AppInfoPlist } from "./app-info-plist.js";

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
  const base: AppInfoPlist = {
    CFBundleDevelopmentRegion: "en",
    CFBundleDisplayName: config.displayName,
    CFBundleExecutable: executableName,
    CFBundleIconFile: iconFileName,
    CFBundleIdentifier: config.bundleId,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: config.displayName,
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: config.version,
    CFBundleVersion: config.version,
    LSApplicationCategoryType: config.category,
    LSMinimumSystemVersion: config.minimumSystemVersion,
    NSHighResolutionCapable: true,
    NSPrincipalClass: "NSApplication",
  };
  return renderInfoPlist(base, config.infoPlist);
}
