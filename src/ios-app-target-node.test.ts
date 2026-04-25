import { describe, expect, it } from "vitest";
import {
  buildIOSDeviceNativeBuild,
  buildIOSDeviceTargetTriple,
  buildIOSSimulatorNativeBuild,
  buildIOSSimulatorTargetTriple,
  installAndLaunchIOSDeviceApp,
  installAndLaunchIOSSimulatorApp,
  resolveIOSDeviceIdentifier,
  resolveIOSDeviceBuildSettings,
  resolveIOSDeviceSigningOptionsForBundle,
  resolveIOSSimulatorBuildSettings,
  signIOSDeviceApp,
} from "./ios-app-target-node.js";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("ios-app simulator node helper", () => {
  it("builds the correct simulator target triple for Apple Silicon", () => {
    expect(buildIOSSimulatorTargetTriple("16.0", "arm64")).toBe("arm64-apple-ios16.0-simulator");
  });

  it("resolves simulator sdk settings from xcrun", () => {
    const settings = resolveIOSSimulatorBuildSettings({ minimumDeploymentTarget: "16.0" }, {
      platform: "darwin",
      arch: "arm64",
      execFile(command, args) {
        expect(command).toBe("xcrun");
        expect(args).toEqual(["--sdk", "iphonesimulator", "--show-sdk-path"]);
        return "/Applications/Xcode.app/SimulatorSDK";
      },
    });

    expect(settings.sdkPath).toBe("/Applications/Xcode.app/SimulatorSDK");
    expect(settings.targetTriple).toBe("arm64-apple-ios16.0-simulator");
  });

  it("augments native build inputs for the iOS simulator shell", () => {
    const nativeBuild = buildIOSSimulatorNativeBuild({
      cppStd: "c++17",
      includePaths: [],
      libraryPaths: [],
      linkLibraries: [],
      frameworks: ["Metal"],
      pkgConfigPackages: [],
      sourceFiles: ["/tmp/native.mm"],
      objectFiles: [],
      compilerFlags: [],
      linkerFlags: [],
      defines: [],
    }, "/tmp/out", {
      sdkPath: "/Applications/Xcode.app/SimulatorSDK",
      targetTriple: "arm64-apple-ios16.0-simulator",
    });

    expect(nativeBuild.sourceFiles).toContain("/tmp/out/ios-main.mm");
    expect(nativeBuild.frameworks).toEqual(["Metal", "UIKit", "Foundation"]);
    expect(nativeBuild.compilerFlags).toContain("-isysroot");
    expect(nativeBuild.compilerFlags).toContain("/Applications/Xcode.app/SimulatorSDK");
    expect(nativeBuild.compilerFlags).toContain("-target");
    expect(nativeBuild.compilerFlags).toContain("arm64-apple-ios16.0-simulator");
    expect(nativeBuild.linkerFlags).toContain("-isysroot");
  });

  it("installs and launches on the booted simulator", () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    installAndLaunchIOSSimulatorApp("/tmp/DoofDemo.app", "dev.doof.demo", true, {
      execFile(command, args) {
        calls.push({ command, args });
        return "";
      },
    });

    expect(calls).toEqual([
      { command: "xcrun", args: ["simctl", "install", "booted", "/tmp/DoofDemo.app"] },
      { command: "xcrun", args: ["simctl", "launch", "booted", "dev.doof.demo"] },
    ]);
  });
});

describe("ios-app device node helper", () => {
  it("builds the correct device target triple", () => {
    expect(buildIOSDeviceTargetTriple("16.0")).toBe("arm64-apple-ios16.0");
  });

  it("resolves device sdk settings from xcrun", () => {
    const settings = resolveIOSDeviceBuildSettings({ minimumDeploymentTarget: "16.0" }, {
      platform: "darwin",
      execFile(command, args) {
        expect(command).toBe("xcrun");
        expect(args).toEqual(["--sdk", "iphoneos", "--show-sdk-path"]);
        return "/Applications/Xcode.app/iPhoneOS.sdk";
      },
    });

    expect(settings.sdkPath).toBe("/Applications/Xcode.app/iPhoneOS.sdk");
    expect(settings.targetTriple).toBe("arm64-apple-ios16.0");
  });

  it("augments native build inputs for the iOS device shell", () => {
    const nativeBuild = buildIOSDeviceNativeBuild({
      cppStd: "c++17",
      includePaths: [],
      libraryPaths: [],
      linkLibraries: [],
      frameworks: ["Metal"],
      pkgConfigPackages: [],
      sourceFiles: ["/tmp/native.mm"],
      objectFiles: [],
      compilerFlags: [],
      linkerFlags: [],
      defines: [],
    }, "/tmp/out", {
      sdkPath: "/Applications/Xcode.app/iPhoneOS.sdk",
      targetTriple: "arm64-apple-ios16.0",
    });

    expect(nativeBuild.sourceFiles).toContain("/tmp/out/ios-main.mm");
    expect(nativeBuild.frameworks).toEqual(["Metal", "UIKit", "Foundation"]);
    expect(nativeBuild.compilerFlags).toContain("arm64-apple-ios16.0");
  });

  it("signs an iOS device app with a provisioning profile", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-sign-test-"));
    const appPath = path.join(tempDir, "DoofDemo.app");
    const profilePath = path.join(tempDir, "dev.mobileprovision");
    fs.mkdirSync(appPath, { recursive: true });
    fs.writeFileSync(profilePath, "profile");

    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      signIOSDeviceApp(appPath, "dev.doof.demo", {
        signIdentity: "Apple Development: Jane Doe (TEAMID)",
        provisioningProfilePath: profilePath,
      }, {
        platform: "darwin",
        execFile(command, args) {
          calls.push({ command, args });
          if (command === "security") {
            return "<plist />";
          }
          if (command === "plutil" && args[1] === "Entitlements.application-identifier") {
            return "TEAMID.dev.doof.demo";
          }
          return "";
        },
      });

      expect(fs.existsSync(path.join(appPath, "embedded.mobileprovision"))).toBe(true);
      expect(calls).toEqual([
        { command: "security", args: ["cms", "-D", "-i", profilePath] },
        {
          command: "plutil",
          args: ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", expect.any(String) as unknown as string],
        },
        {
          command: "plutil",
          args: ["-extract", "Entitlements", "xml1", "-o", expect.any(String) as unknown as string, expect.any(String) as unknown as string],
        },
        {
          command: "codesign",
          args: [
            "--force",
            "--sign",
            "Apple Development: Jane Doe (TEAMID)",
            "--entitlements",
            expect.any(String) as unknown as string,
            "--generate-entitlement-der",
            "--timestamp=none",
            appPath,
          ],
        },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("installs and launches on a connected iOS device", () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    installAndLaunchIOSDeviceApp("/tmp/DoofDemo.app", "device-123", "dev.doof.demo", true, {
      execFile(command, args) {
        calls.push({ command, args });
        return "";
      },
    });

    expect(calls).toEqual([
      { command: "xcrun", args: ["devicectl", "device", "install", "app", "--device", "device-123", "/tmp/DoofDemo.app"] },
      { command: "xcrun", args: ["devicectl", "device", "process", "launch", "--device", "device-123", "--terminate-existing", "dev.doof.demo"] },
    ]);
  });

  it("auto-resolves signing profile and identity for a bundle id", () => {
    const profilesDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-profiles-"));
    fs.mkdirSync(profilesDir, { recursive: true });

    const wildcardProfile = path.join(profilesDir, `doof-wild-${Date.now()}.mobileprovision`);
    const exactProfile = path.join(profilesDir, `doof-exact-${Date.now()}.mobileprovision`);
    fs.writeFileSync(wildcardProfile, "wild");
    fs.writeFileSync(exactProfile, "exact");

    const certBytes = Buffer.from([1, 2, 3, 4, 5]);
    const certSha = "11966AB9C099F8FABEFAC54C08D5BE2BD8C903AF";
    const calls: Array<{ command: string; args: string[] }> = [];

    try {
      const resolved = resolveIOSDeviceSigningOptionsForBundle("dev.doof.demo", {
        signIdentity: null,
        provisioningProfilePath: null,
      }, {
        profileDirectories: [profilesDir],
      }, {
        platform: "darwin",
        execFile(command, args) {
          calls.push({ command, args });
          if (command === "security" && args[0] === "cms") {
            const profilePath = args[3] ?? "";
            if (profilePath === wildcardProfile) {
              return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Entitlements</key>\n  <dict>\n    <key>application-identifier</key>\n    <string>TEAMID.dev.doof.*</string>\n  </dict>\n  <key>DeveloperCertificates</key>\n  <array>\n    <data>${certBytes.toString("base64")}</data>\n  </array>\n  <key>ExpirationDate</key>\n  <date>2040-01-01T00:00:00Z</date>\n</dict>\n</plist>`;
            }
            return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Entitlements</key>\n  <dict>\n    <key>application-identifier</key>\n    <string>TEAMID.dev.doof.demo</string>\n  </dict>\n  <key>DeveloperCertificates</key>\n  <array>\n    <data>${certBytes.toString("base64")}</data>\n  </array>\n  <key>ExpirationDate</key>\n  <date>2045-01-01T00:00:00Z</date>\n</dict>\n</plist>`;
          }
          if (command === "security" && args[0] === "find-identity") {
            return `  1) ${certSha} "Apple Development: Jane Doe (TEAMID)"`;
          }
          return "";
        },
      });

      expect(resolved.provisioningProfilePath).toBe(exactProfile);
      expect(resolved.signIdentity).toBe("Apple Development: Jane Doe (TEAMID)");
      expect(calls.some((call) => call.command === "security" && call.args[0] === "find-identity")).toBe(true);
    } finally {
      fs.rmSync(wildcardProfile, { force: true });
      fs.rmSync(exactProfile, { force: true });
      fs.rmSync(profilesDir, { recursive: true, force: true });
    }
  });

  it("auto-resolves connected iOS device identifier", () => {
    const deviceIdentifier = resolveIOSDeviceIdentifier(null, {
      platform: "darwin",
      execFile(command, args) {
        expect(command).toBe("xcrun");
        expect(args.slice(0, 4)).toEqual(["devicectl", "list", "devices", "--json-output"]);
        const outputPath = args[4];
        fs.writeFileSync(outputPath, JSON.stringify({
          result: {
            devices: [
              {
                identifier: "watch-1",
                hardwareProperties: { platform: "watchOS", reality: "physical" },
                connectionProperties: { tunnelState: "connected" },
                deviceProperties: { name: "My Watch" },
              },
              {
                identifier: "iphone-1",
                hardwareProperties: { platform: "iOS", reality: "physical" },
                connectionProperties: { tunnelState: "connected" },
                deviceProperties: { name: "My iPhone" },
              },
            ],
          },
        }), "utf8");
        return "";
      },
    });

    expect(deviceIdentifier).toBe("iphone-1");
  });

  it("throws when multiple iOS devices are connected", () => {
    expect(() => resolveIOSDeviceIdentifier(null, {
      platform: "darwin",
      execFile(_command, args) {
        const outputPath = args[4];
        fs.writeFileSync(outputPath, JSON.stringify({
          result: {
            devices: [
              {
                identifier: "iphone-1",
                hardwareProperties: { platform: "iOS", reality: "physical" },
                connectionProperties: { tunnelState: "connected" },
                deviceProperties: { name: "Work iPhone" },
              },
              {
                identifier: "iphone-2",
                hardwareProperties: { platform: "iOS", reality: "physical" },
                connectionProperties: { tunnelState: "connected" },
                deviceProperties: { name: "Personal iPhone" },
              },
            ],
          },
        }), "utf8");
        return "";
      },
    })).toThrow("Multiple connected iOS devices found");
  });
});