import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import plist from "plist";
import { afterEach, describe, expect, it } from "vitest";
import { archiveMacOSApp, resolveMacOSSigningIdentity, signMacOSApp, type MacOSPackageHost } from "./macos-package.js";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("macOS release signing", () => {
  it("auto-selects a unique Developer ID Application identity", () => {
    const host = fakeHost((command) => command === "security"
      ? `  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (TEAMID)"`
      : "");
    expect(resolveMacOSSigningIdentity({ signing: "developer-id", sandbox: false }, host))
      .toBe("Developer ID Application: Example (TEAMID)");
  });

  it("requires an explicit identity when Developer ID discovery is ambiguous", () => {
    const host = fakeHost(() => [
      `  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: One (TEAMID)"`,
      `  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Two (TEAMID)"`,
    ].join("\n"));
    expect(() => resolveMacOSSigningIdentity({ signing: "developer-id", sandbox: false }, host))
      .toThrow("Multiple Developer ID Application identities");
  });

  it("merges sandbox entitlement, signs, and verifies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-package-test-"));
    tempDirs.push(root);
    const appPath = path.join(root, "Demo.app");
    fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
    fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "Demo"), "binary");
    const nestedLibrary = path.join(appPath, "Contents", "Frameworks", "libFoo.dylib");
    fs.mkdirSync(path.dirname(nestedLibrary), { recursive: true });
    fs.writeFileSync(nestedLibrary, "library");
    const entitlementsPath = path.join(root, "custom.plist");
    fs.writeFileSync(entitlementsPath, plist.build({ "com.apple.security.network.client": true }));
    const calls: Array<{ command: string; args: string[] }> = [];
    let effectiveEntitlements: Record<string, unknown> | undefined;
    const host = fakeHost((command, args) => {
      calls.push({ command, args });
      const index = args.indexOf("--entitlements");
      if (command === "codesign" && index !== -1) {
        effectiveEntitlements = plist.parse(fs.readFileSync(args[index + 1], "utf8")) as Record<string, unknown>;
      }
      return "";
    });

    signMacOSApp(appPath, {
      signing: "ad-hoc", sandbox: true, entitlementsPath,
    }, host);

    expect(effectiveEntitlements).toMatchObject({
      "com.apple.security.app-sandbox": true,
      "com.apple.security.network.client": true,
    });
    expect(calls.at(-1)).toEqual({
      command: "codesign", args: ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    });
    expect(calls.findIndex((call) => call.args.at(-1) === nestedLibrary))
      .toBeLessThan(calls.findIndex((call) => call.args.at(-1) === appPath));
    expect(calls.some((call) => call.args.includes("--timestamp=none"))).toBe(true);
  });

  it("rejects custom entitlements that disable an enabled sandbox", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-package-test-"));
    tempDirs.push(root);
    const appPath = path.join(root, "Demo.app");
    fs.mkdirSync(appPath);
    const entitlementsPath = path.join(root, "custom.plist");
    fs.writeFileSync(entitlementsPath, plist.build({ "com.apple.security.app-sandbox": false }));
    expect(() => signMacOSApp(appPath, { signing: "ad-hoc", sandbox: true, entitlementsPath }, fakeHost(() => "")))
      .toThrow("explicitly disable");
  });

  it("archives the signed app with its bundle directory and preserves other dist files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-package-test-"));
    tempDirs.push(root);
    const appPath = path.join(root, "Demo.app");
    const archivePath = path.join(root, "dist", "Demo-1.0-macos.zip");
    fs.mkdirSync(appPath);
    const calls: Array<{ command: string; args: string[] }> = [];
    archiveMacOSApp(appPath, archivePath, fakeHost((command, args) => {
      calls.push({ command, args });
      return "";
    }));
    expect(calls).toEqual([{
      command: "ditto",
      args: ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath],
    }]);
  });
});

function fakeHost(execFile: (command: string, args: string[]) => string): MacOSPackageHost {
  return { platform: "darwin", execFile };
}
