import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleMacOSAppBundle, createMacOSAppSupportFiles } from "./macos-app-target.js";

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("macos-app target helper", () => {
  it("creates support files for emitted macOS app projects", () => {
    const supportFiles = createMacOSAppSupportFiles({
      bundleId: "dev.doof.demo",
      displayName: "Doof Demo",
      version: "1.0",
      iconPath: "/app/app-icon.svg",
      resources: [],
      category: "public.app-category.developer-tools",
      minimumSystemVersion: "11.0",
    }, "DoofDemo");

    expect(supportFiles.map((file) => file.relativePath)).toEqual([
      "Info.plist",
      "generate-macos-icon.sh",
    ]);
    expect(supportFiles[0].content).toContain("dev.doof.demo");
    expect(supportFiles[1].executable).toBe(true);
  });

  it("assembles a macOS app bundle with resources", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-app-bundle-"));
    tmpDirs.push(dir);

    const outputDir = path.join(dir, "build");
    fs.mkdirSync(outputDir, { recursive: true });

    const executablePath = path.join(outputDir, "DoofDemo");
    fs.writeFileSync(executablePath, "binary", "utf8");
    fs.chmodSync(executablePath, 0o755);

    const iconPath = path.join(dir, "app-icon.svg");
    fs.writeFileSync(iconPath, "<svg />", "utf8");

    const imagesDir = path.join(dir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, "card.png"), "png", "utf8");

    const supportFiles = createMacOSAppSupportFiles({
      bundleId: "dev.doof.demo",
      displayName: "Doof Demo",
      version: "1.0",
      iconPath,
      resources: [{ fromPattern: path.join(imagesDir, "*"), destination: "images" }],
      category: "public.app-category.developer-tools",
      minimumSystemVersion: "11.0",
    }, "DoofDemo");

    for (const file of supportFiles) {
      const filePath = path.join(outputDir, file.relativePath);
      fs.writeFileSync(filePath, file.content, "utf8");
      if (file.executable) {
        fs.chmodSync(filePath, 0o755);
      }
    }

    const bundle = assembleMacOSAppBundle({
      outputDir,
      executablePath,
      executableName: "DoofDemo",
      platform: "darwin",
      config: {
        bundleId: "dev.doof.demo",
        displayName: "Doof Demo",
        version: "1.0",
        iconPath,
        resources: [{ fromPattern: path.join(imagesDir, "*"), destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
      generateIcon(_sourcePath, outputPath) {
        fs.writeFileSync(outputPath, "icns", "utf8");
      },
    });

    expect(bundle.appPath).toBe(path.join(outputDir, "DoofDemo.app"));
    expect(fs.readFileSync(bundle.binaryPath, "utf8")).toBe("binary");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Info.plist"), "utf8"))
      .toContain("dev.doof.demo");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "DoofDemo.icns"), "utf8"))
      .toBe("icns");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "images", "card.png"), "utf8"))
      .toBe("png");
  });
});