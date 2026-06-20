import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveIOSAdHocSigning, signAndArchiveIOSApp, type IOSPackageHost } from "./ios-package.js";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("iOS Ad Hoc package signing", () => {
  it("accepts an unexpired device profile with distribution signing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-package-test-"));
    tempDirs.push(root);
    const profilePath = path.join(root, "adhoc.mobileprovision");
    fs.writeFileSync(profilePath, "profile");
    const certificate = Buffer.from([1, 2, 3, 4]);
    const fingerprint = createHash("sha1").update(certificate).digest("hex").toUpperCase();
    const host = fakeHost(root, (command, args) => {
      if (command === "security" && args[0] === "cms") return profileXml(certificate, false, true);
      if (command === "security" && args[0] === "find-identity") {
        return `  1) ${fingerprint} "Apple Distribution: Example (TEAMID)"`;
      }
      return "";
    });

    expect(resolveIOSAdHocSigning("dev.doof.demo", { provisioningProfilePath: profilePath }, host)).toMatchObject({
      identity: "Apple Distribution: Example (TEAMID)",
      provisioningProfilePath: profilePath,
    });
  });

  it("rejects a development provisioning profile", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-package-test-"));
    tempDirs.push(root);
    const profilePath = path.join(root, "development.mobileprovision");
    fs.writeFileSync(profilePath, "profile");
    const certificate = Buffer.from([1, 2, 3, 4]);
    const host = fakeHost(root, () => profileXml(certificate, true, true));

    expect(() => resolveIOSAdHocSigning("dev.doof.demo", { provisioningProfilePath: profilePath }, host))
      .toThrow("Development provisioning profiles");
  });

  it("rejects an App Store profile without provisioned devices", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-package-test-"));
    tempDirs.push(root);
    const profilePath = path.join(root, "store.mobileprovision");
    fs.writeFileSync(profilePath, "profile");
    const certificate = Buffer.from([1, 2, 3, 4]);
    const host = fakeHost(root, () => profileXml(certificate, false, false));

    expect(() => resolveIOSAdHocSigning("dev.doof.demo", { provisioningProfilePath: profilePath }, host))
      .toThrow("no provisioned devices");
  });

  it("signs, verifies, and archives an IPA with a Payload root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-package-test-"));
    tempDirs.push(root);
    const appPath = path.join(root, "Demo.app");
    const profilePath = path.join(root, "adhoc.mobileprovision");
    fs.mkdirSync(appPath);
    fs.writeFileSync(profilePath, "profile");
    const certificate = Buffer.from([1, 2, 3, 4]);
    const fingerprint = createHash("sha1").update(certificate).digest("hex").toUpperCase();
    const calls: Array<{ command: string; args: string[] }> = [];
    const host = fakeHost(root, (command, args) => {
      calls.push({ command, args });
      if (command === "security" && args[0] === "cms") return profileXml(certificate, false, true);
      if (command === "security" && args[0] === "find-identity") {
        return `  1) ${fingerprint} "Apple Distribution: Example (TEAMID)"`;
      }
      return "";
    });
    const archivePath = path.join(root, "dist", "Demo-1.0-ios.ipa");

    signAndArchiveIOSApp(appPath, archivePath, "dev.doof.demo", { provisioningProfilePath: profilePath }, host);

    expect(calls.some((call) => call.command === "codesign" && call.args[0] === "--verify")).toBe(true);
    const archiveCall = calls.find((call) => call.command === "ditto" && call.args.includes("-c"));
    expect(archiveCall?.args).toEqual([
      "-c", "-k", "--sequesterRsrc", "--keepParent", expect.stringMatching(/Payload$/), archivePath,
    ]);
  });
});

function fakeHost(homeDir: string, execFile: (command: string, args: string[]) => string): IOSPackageHost {
  return { platform: "darwin", homeDir, now: () => Date.parse("2030-01-01T00:00:00Z"), execFile };
}

function profileXml(certificate: Buffer, getTaskAllow: boolean, provisionedDevices: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Entitlements</key><dict>
<key>application-identifier</key><string>TEAMID.dev.doof.demo</string>
<key>get-task-allow</key><${getTaskAllow ? "true" : "false"}/>
</dict>
<key>ExpirationDate</key><date>2040-01-01T00:00:00Z</date>
${provisionedDevices ? "<key>ProvisionedDevices</key><array><string>device-1</string></array>" : ""}
<key>DeveloperCertificates</key><array><data>${certificate.toString("base64")}</data></array>
</dict></plist>`;
}
