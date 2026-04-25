import type { ResolvedDoofIOSAppConfig } from "./build-targets.js";
import type { ProjectSupportFile } from "./macos-app-support.js";

const IOS_APP_ICONSET_CONTENTS_PATH = "Assets.xcassets/AppIcon.appiconset/Contents.json";
const IOS_APP_INFO_PLIST_PATH = "Info.plist";
const IOS_APP_MAIN_SOURCE_PATH = "ios-main.mm";

export function getIOSAppInfoPlistPath(): string {
  return IOS_APP_INFO_PLIST_PATH;
}

export function getIOSAppMainSourcePath(): string {
  return IOS_APP_MAIN_SOURCE_PATH;
}

export function getIOSAppAssetCatalogPath(): string {
  return "Assets.xcassets";
}

export function createIOSAppSupportFiles(
  config: ResolvedDoofIOSAppConfig,
  executableName: string,
): ProjectSupportFile[] {
  return [
    {
      relativePath: IOS_APP_ICONSET_CONTENTS_PATH,
      content: `${renderIOSAppIconSetContents()}
`,
    },
    {
      relativePath: IOS_APP_INFO_PLIST_PATH,
      content: renderIOSAppInfoPlist(config, executableName),
    },
    {
      relativePath: IOS_APP_MAIN_SOURCE_PATH,
      content: renderIOSAppMainSource(executableName),
    },
  ];
}

export function renderIOSAppInfoPlist(config: ResolvedDoofIOSAppConfig, executableName: string): string {
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
    '  <key>LSRequiresIPhoneOS</key>',
    '  <true/>',
    '  <key>MinimumOSVersion</key>',
    `  <string>${escapeXml(config.minimumDeploymentTarget)}</string>`,
    '  <key>UIDeviceFamily</key>',
    '  <array>',
    '    <integer>1</integer>',
    '    <integer>2</integer>',
    '  </array>',
    '  <key>UILaunchStoryboardName</key>',
    '  <string></string>',
    '  <key>UIApplicationSceneManifest</key>',
    '  <dict>',
    '    <key>UIApplicationSupportsMultipleScenes</key>',
    '    <false/>',
    '  </dict>',
    '</dict>',
    '</plist>',
  ].join("\n");
}

export function renderIOSAppMainSource(executableName: string): string {
  const appDelegateClassName = `${toObjCIdentifier(executableName)}AppDelegate`;
  return [
    '#import <UIKit/UIKit.h>',
    '#include <thread>',
    '',
    'extern "C" int doof_entry_main(int argc, char** argv);',
    '',
    `@interface ${appDelegateClassName} : UIResponder <UIApplicationDelegate>`,
    '@property(nonatomic, strong) UIWindow* window;',
    '@end',
    '',
    `@implementation ${appDelegateClassName}`,
    '- (BOOL)application:(UIApplication*)application didFinishLaunchingWithOptions:(NSDictionary*)launchOptions {',
    '  (void)application;',
    '  (void)launchOptions;',
    '  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];',
    '  UIViewController* rootViewController = [[UIViewController alloc] init];',
    '  rootViewController.view.backgroundColor = UIColor.systemBackgroundColor;',
    '  self.window.rootViewController = rootViewController;',
    '  [self.window makeKeyAndVisible];',
    '  std::thread([] {',
    '    (void)doof_entry_main(0, nullptr);',
    '  }).detach();',
    '  return YES;',
    '}',
    '@end',
    '',
    'int main(int argc, char* argv[]) {',
    '  @autoreleasepool {',
    `    return UIApplicationMain(argc, argv, nil, @"${escapeObjCString(appDelegateClassName)}");`,
    '  }',
    '}',
  ].join("\n");
}

export function renderIOSAppIconSetContents(): string {
  return JSON.stringify({
    images: [
      { idiom: "iphone", scale: "2x", size: "20x20", filename: "iphone_notification_20@2x.png" },
      { idiom: "iphone", scale: "3x", size: "20x20", filename: "iphone_notification_20@3x.png" },
      { idiom: "iphone", scale: "2x", size: "29x29", filename: "iphone_settings_29@2x.png" },
      { idiom: "iphone", scale: "3x", size: "29x29", filename: "iphone_settings_29@3x.png" },
      { idiom: "iphone", scale: "2x", size: "40x40", filename: "iphone_spotlight_40@2x.png" },
      { idiom: "iphone", scale: "3x", size: "40x40", filename: "iphone_spotlight_40@3x.png" },
      { idiom: "iphone", scale: "2x", size: "60x60", filename: "iphone_app_60@2x.png" },
      { idiom: "iphone", scale: "3x", size: "60x60", filename: "iphone_app_60@3x.png" },
      { idiom: "ipad", scale: "1x", size: "20x20", filename: "ipad_notification_20.png" },
      { idiom: "ipad", scale: "2x", size: "20x20", filename: "ipad_notification_20@2x.png" },
      { idiom: "ipad", scale: "1x", size: "29x29", filename: "ipad_settings_29.png" },
      { idiom: "ipad", scale: "2x", size: "29x29", filename: "ipad_settings_29@2x.png" },
      { idiom: "ipad", scale: "1x", size: "40x40", filename: "ipad_spotlight_40.png" },
      { idiom: "ipad", scale: "2x", size: "40x40", filename: "ipad_spotlight_40@2x.png" },
      { idiom: "ipad", scale: "1x", size: "76x76", filename: "ipad_app_76.png" },
      { idiom: "ipad", scale: "2x", size: "76x76", filename: "ipad_app_76@2x.png" },
      { idiom: "ipad", scale: "2x", size: "83.5x83.5", filename: "ipad_pro_83_5@2x.png" },
      { idiom: "ios-marketing", scale: "1x", size: "1024x1024", filename: "app_store_1024.png" },
    ],
    info: {
      author: "doof",
      version: 1,
    },
  }, null, 2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeObjCString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, '\\\"');
}

function toObjCIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
  if (sanitized.length === 0) {
    return "DoofApp";
  }
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `Doof_${sanitized}`;
}