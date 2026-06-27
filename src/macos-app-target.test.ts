import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import plist from "plist";
import {
  assembleMacOSAppBundle,
  createMacOSAppSupportFiles,
} from "./macos-app-target.js";
import { renderMacOSAppInfoPlist } from "./macos-app-support.js";

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
      iconPath: "/app/app-icon.png",
      resources: [],
      category: "public.app-category.developer-tools",
      minimumSystemVersion: "11.0",
    }, "DoofDemo");

    expect(supportFiles.map((file) => file.relativePath)).toEqual([
      "Info.plist",
      "PkgInfo",
    ]);
    expect(supportFiles[0].content).toContain("dev.doof.demo");
  });

  it("renders custom local-network Info.plist metadata", () => {
    const xml = renderMacOSAppInfoPlist({
      bundleId: "dev.doof.demo",
      displayName: "Doof & Demo",
      version: "1.0",
      iconPath: "/app/app-icon.png",
      resources: [],
      category: "public.app-category.developer-tools",
      minimumSystemVersion: "11.0",
      infoPlist: {
        NSLocalNetworkUsageDescription: "Doof Jigsaw uses the local network to find nearby players.",
        NSBonjourServices: ["_doof-jigsaw._tcp"],
      },
    }, "DoofDemo");
    const parsed = plist.parse(xml) as Record<string, unknown>;

    expect(parsed.CFBundleDisplayName).toBe("Doof & Demo");
    expect(parsed.NSLocalNetworkUsageDescription)
      .toBe("Doof Jigsaw uses the local network to find nearby players.");
    expect(parsed.NSBonjourServices).toEqual(["_doof-jigsaw._tcp"]);
  });

  it("omits icon metadata when no macOS app icon is configured", () => {
    const xml = renderMacOSAppInfoPlist({
      bundleId: "dev.doof.demo",
      displayName: "Doof Demo",
      version: "1.0",
      resources: [],
      category: "public.app-category.developer-tools",
      minimumSystemVersion: "11.0",
    }, "DoofDemo");
    const parsed = plist.parse(xml) as Record<string, unknown>;

    expect(parsed.CFBundleIconFile).toBeUndefined();
  });

  it("assembles a macOS app bundle with resources", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-app-bundle-"));
    tmpDirs.push(dir);

    const outputDir = path.join(dir, "build");
    fs.mkdirSync(outputDir, { recursive: true });

    const executablePath = path.join(outputDir, "DoofDemo");
    fs.writeFileSync(executablePath, "binary", "utf8");
    fs.chmodSync(executablePath, 0o755);
    const staleBundleFile = path.join(outputDir, "DoofDemo.app", "stale-ios-file");
    fs.mkdirSync(path.dirname(staleBundleFile), { recursive: true });
    fs.writeFileSync(staleBundleFile, "stale", "utf8");

    const iconPath = path.join(dir, "app-icon.png");
    fs.writeFileSync(iconPath, "png", "utf8");

    const imagesDir = path.join(dir, "images");
    fs.mkdirSync(path.join(imagesDir, "cards"), { recursive: true });
    fs.writeFileSync(path.join(imagesDir, "card.png"), "png", "utf8");
    fs.writeFileSync(path.join(imagesDir, "cards", "ace.png"), "ace", "utf8");

    const supportFiles = createMacOSAppSupportFiles({
      bundleId: "dev.doof.demo",
      displayName: "Doof Demo",
      version: "1.0",
      iconPath,
      resources: [{ fromPattern: imagesDir, destination: "images" }],
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
        resources: [{ fromPattern: imagesDir, destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
      generateIcon(_sourcePath, outputPath) {
        fs.writeFileSync(outputPath, "icns", "utf8");
      },
    });

    expect(bundle.appPath).toBe(path.join(outputDir, "DoofDemo.app"));
    expect(fs.readFileSync(bundle.binaryPath, "utf8")).toBe("binary");
    expect(fs.existsSync(staleBundleFile)).toBe(false);
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Info.plist"), "utf8"))
      .toContain("dev.doof.demo");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "DoofDemo.icns"), "utf8"))
      .toBe("icns");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "images", "card.png"), "utf8"))
      .toBe("png");
    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "images", "cards", "ace.png"), "utf8"))
      .toBe("ace");
  });

  it("uses the configured PNG icon generator through the default bundle path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-app-icon-"));
    tmpDirs.push(dir);

    const outputDir = path.join(dir, "build");
    fs.mkdirSync(outputDir, { recursive: true });

    const executablePath = path.join(outputDir, "DoofDemo");
    fs.writeFileSync(executablePath, "binary", "utf8");
    fs.chmodSync(executablePath, 0o755);

    const iconPath = path.join(dir, "app-icon.png");
    fs.writeFileSync(iconPath, "png", "utf8");

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
        resources: [],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
      generateIcon(inputPath, outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `generated:${fs.readFileSync(inputPath, "utf8")}`, "utf8");
      },
    });

    expect(fs.readFileSync(path.join(bundle.appPath, "Contents", "Resources", "DoofDemo.icns"), "utf8"))
      .toBe("generated:png");
  });

  it("ad-hoc signs embedded Mach-O libraries before signing the app bundle", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-app-sign-"));
    tmpDirs.push(dir);

    const outputDir = path.join(dir, "build");
    fs.mkdirSync(outputDir, { recursive: true });

    const executablePath = path.join(outputDir, "DoofDemo");
    writeMachOFixture(executablePath);
    fs.chmodSync(executablePath, 0o755);

    const libraryDir = path.join(dir, "lib");
    const sourceLibrary = path.join(libraryDir, "libDemo.dylib");
    writeMachOFixture(sourceLibrary);

    const calls: string[][] = [];
    const bundledLibraryPath = path.join(outputDir, "DoofDemo.app", "Contents", "Frameworks", "libDemo.dylib");
    const dependencyByPath = new Map<string, string[]>([
      [executablePath, [sourceLibrary]],
      [path.join(outputDir, "DoofDemo.app", "Contents", "MacOS", "DoofDemo"), [sourceLibrary]],
      [bundledLibraryPath, []],
    ]);
    const fakeMachOHost = {
      execFile(command: string, args: string[]) {
        calls.push([command, ...args]);
        const targetPath = args[args.length - 1];
        if (command === "lipo") return "arm64";
        if (command === "otool" && args[0] === "-D") return `${targetPath}:\n${sourceLibrary}\n`;
        if (command === "otool" && args[0] === "-L") {
          const deps = dependencyByPath.get(targetPath) ?? [];
          return `${targetPath}:\n${deps.map((dep) => `\t${dep} (compatibility version 0.0.0, current version 0.0.0)`).join("\n")}\n`;
        }
        if (command === "otool" && args[0] === "-l") return "    platform 1\n";
        if (command === "install_name_tool" && args[0] === "-change") {
          dependencyByPath.set(targetPath, (dependencyByPath.get(targetPath) ?? []).map((dep) =>
            dep === args[1] ? args[2] : dep));
        }
        return "";
      },
    };
    const signingCalls: string[][] = [];

    const bundle = assembleMacOSAppBundle({
      outputDir,
      executablePath,
      executableName: "DoofDemo",
      platform: "darwin",
      config: {
        bundleId: "dev.doof.demo",
        displayName: "Doof Demo",
        version: "1.0",
        resources: [],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
        embeddedLibraries: [{ path: sourceLibrary }],
      },
      embeddedLibraryHost: fakeMachOHost,
      codeSigningHost: {
        execFile(command, args) {
          signingCalls.push([command, ...args]);
          return "";
        },
      },
    });

    expect(signingCalls).toEqual([
      ["codesign", "--force", "--sign", "-", "--timestamp=none", path.join(bundle.appPath, "Contents", "Frameworks", "libDemo.dylib")],
      ["codesign", "--force", "--sign", "-", "--timestamp=none", bundle.appPath],
    ]);
  });
});

function writeMachOFixture(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
}
