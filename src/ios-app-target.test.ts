import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleIOSAppBundle } from "./ios-app-target.js";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ios-app target helper", () => {
  it("assembles an iOS app bundle with resources and support directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-app-bundle-"));
    tmpDirs.push(dir);

    const outputDir = path.join(dir, "build");
    fs.mkdirSync(outputDir, { recursive: true });

    const executablePath = path.join(outputDir, "DoofDemo");
    fs.writeFileSync(executablePath, "binary", "utf8");
    fs.chmodSync(executablePath, 0o755);

    const infoPlistPath = path.join(outputDir, "Info.plist");
    fs.writeFileSync(infoPlistPath, "<plist>demo</plist>", "utf8");

    const assetCatalogDir = path.join(outputDir, "Assets.xcassets", "AppIcon.appiconset");
    fs.mkdirSync(assetCatalogDir, { recursive: true });
    fs.writeFileSync(path.join(assetCatalogDir, "Contents.json"), "{}", "utf8");

    const imagesDir = path.join(dir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, "card.png"), "png", "utf8");

    const bundle = assembleIOSAppBundle({
      outputDir,
      executablePath,
      executableName: "DoofDemo",
      platform: "darwin",
      config: {
        bundleId: "dev.doof.demo",
        displayName: "Doof Demo",
        version: "1.0",
        iconPath: path.join(dir, "app-icon.svg"),
        resources: [{ fromPattern: path.join(imagesDir, "*"), destination: "samples/solitaire/images" }],
        minimumDeploymentTarget: "16.0",
      },
    });

    expect(bundle.appPath).toBe(path.join(outputDir, "DoofDemo.app"));
    expect(fs.readFileSync(bundle.binaryPath, "utf8")).toBe("binary");
    expect(fs.readFileSync(path.join(bundle.appPath, "Info.plist"), "utf8")).toBe("<plist>demo</plist>");
    expect(
      fs.readFileSync(path.join(bundle.appPath, "samples", "solitaire", "images", "card.png"), "utf8"),
    ).toBe("png");
    expect(
      fs.readFileSync(path.join(bundle.appPath, "Assets.xcassets", "AppIcon.appiconset", "Contents.json"), "utf8"),
    ).toBe("{}");
  });
});