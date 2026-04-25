import { describe, expect, it } from "vitest";
import {
  createIOSAppSupportFiles,
  renderIOSAppIconSetContents,
  renderIOSAppInfoPlist,
  renderIOSAppMainSource,
} from "./ios-app-support.js";

describe("ios-app support files", () => {
  const config = {
    bundleId: "dev.doof.demo",
    displayName: "Doof Demo",
    version: "1.0",
    iconPath: "/app/app-icon.svg",
    resources: [],
    minimumDeploymentTarget: "16.0",
  };

  it("creates emitted support files for ios-app projects", () => {
    const supportFiles = createIOSAppSupportFiles(config, "DoofDemo");

    expect(supportFiles.map((file) => file.relativePath)).toEqual([
      "Assets.xcassets/AppIcon.appiconset/Contents.json",
      "Info.plist",
      "ios-main.mm",
    ]);
    expect(supportFiles[1]?.content).toContain("dev.doof.demo");
    expect(supportFiles[2]?.content).toContain("UIApplicationMain");
  });

  it("renders an iOS Info.plist with app metadata", () => {
    const plist = renderIOSAppInfoPlist(config, "DoofDemo");

    expect(plist).toContain("dev.doof.demo");
    expect(plist).toContain("Doof Demo");
    expect(plist).toContain("16.0");
    expect(plist).toContain("LSRequiresIPhoneOS");
  });

  it("renders an iOS entry shell that sanitizes the app delegate class name", () => {
    const source = renderIOSAppMainSource("7demo-app");

    expect(source).toContain("@interface Doof_7demo_appAppDelegate");
    expect(source).toContain('@"Doof_7demo_appAppDelegate"');
    expect(source).toContain("UIApplicationMain");
    expect(source).toContain("std::thread");
  });

  it("renders an asset-catalog contents file with the required marketing icon slot", () => {
    const contents = renderIOSAppIconSetContents();

    expect(contents).toContain("ios-marketing");
    expect(contents).toContain("app_store_1024.png");
  });
});