import plist from "plist";

export type AppInfoPlistValue =
  | string
  | number
  | boolean
  | AppInfoPlistValue[]
  | { [key: string]: AppInfoPlistValue };

export type AppInfoPlist = Record<string, AppInfoPlistValue>;

export const MACOS_MANAGED_INFO_PLIST_KEYS = new Set([
  "CFBundleDevelopmentRegion",
  "CFBundleDisplayName",
  "CFBundleExecutable",
  "CFBundleIconFile",
  "CFBundleIdentifier",
  "CFBundleInfoDictionaryVersion",
  "CFBundleName",
  "CFBundlePackageType",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "LSApplicationCategoryType",
  "LSMinimumSystemVersion",
  "NSHighResolutionCapable",
  "NSPrincipalClass",
]);

export const IOS_MANAGED_INFO_PLIST_KEYS = new Set([
  "CFBundleDevelopmentRegion",
  "CFBundleDisplayName",
  "CFBundleExecutable",
  "CFBundleIdentifier",
  "CFBundleInfoDictionaryVersion",
  "CFBundleName",
  "CFBundlePackageType",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "LSRequiresIPhoneOS",
  "MinimumOSVersion",
  "UIDeviceFamily",
  "UILaunchStoryboardName",
  "UIApplicationSceneManifest",
]);

export function validateCustomInfoPlistKeys(
  infoPlist: AppInfoPlist | undefined,
  managedKeys: ReadonlySet<string>,
  manifestPath: string,
  fieldPath: string,
): void {
  if (!infoPlist) {
    return;
  }

  for (const key of Object.keys(infoPlist)) {
    if (managedKeys.has(key)) {
      throw new Error(
        `Invalid doof.json at ${manifestPath}: ${fieldPath}.${key} conflicts with a Doof-managed Info.plist key`,
      );
    }
  }
}

export function renderInfoPlist(base: AppInfoPlist, custom: AppInfoPlist | undefined): string {
  return plist.build({
    ...base,
    ...(custom ?? {}),
  });
}
