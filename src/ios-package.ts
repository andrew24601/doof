import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import plist from "plist";

export interface IOSAdHocSigningOverrides {
  identity?: string;
  provisioningProfilePath?: string;
}

export interface IOSPackageHost {
  platform: NodeJS.Platform;
  homeDir: string;
  now(): number;
  execFile(command: string, args: string[]): string;
}

interface AdHocProfile {
  path: string;
  entitlements: Record<string, unknown>;
  certificateFingerprints: string[];
}

const DEFAULT_HOST: IOSPackageHost = {
  platform: process.platform,
  homeDir: os.homedir(),
  now: Date.now,
  execFile(command, args) {
    return String(execFileSync(command, args, { encoding: "utf8", stdio: "pipe" })).trim();
  },
};

export function resolveIOSAdHocSigning(
  bundleId: string,
  overrides: IOSAdHocSigningOverrides,
  host: IOSPackageHost = DEFAULT_HOST,
): { identity: string; provisioningProfilePath: string; entitlements: Record<string, unknown> } {
  if (host.platform !== "darwin") throw new Error("iOS Ad Hoc packaging is only supported on macOS");
  const profile = overrides.provisioningProfilePath
    ? readAdHocProfile(path.resolve(overrides.provisioningProfilePath), bundleId, host)
    : autoResolveAdHocProfile(bundleId, host);
  const identities = parseCodeSigningIdentities(host.execFile("security", ["find-identity", "-v", "-p", "codesigning"]));
  const matchingIdentities = identities.filter((identity) =>
    profile.certificateFingerprints.includes(identity.fingerprint)
      && /^(Apple Distribution|iPhone Distribution):/.test(identity.name));
  const identity = overrides.identity
    ? matchingIdentities.find((candidate) => candidate.name === overrides.identity)
    : matchingIdentities.length === 1 ? matchingIdentities[0] : undefined;
  if (!identity) {
    if (overrides.identity) {
      throw new Error(`iOS signing identity ${JSON.stringify(overrides.identity)} is not a distribution identity included in the Ad Hoc profile`);
    }
    throw new Error(matchingIdentities.length === 0
      ? "No installed Apple Distribution identity matches the selected Ad Hoc provisioning profile"
      : `Multiple Apple Distribution identities match the selected Ad Hoc profile (${matchingIdentities.map((item) => item.name).join(", ")}). Pass --ios-sign-identity.`);
  }
  return { identity: identity.name, provisioningProfilePath: profile.path, entitlements: profile.entitlements };
}

export function signAndArchiveIOSApp(
  appPath: string,
  archivePath: string,
  bundleId: string,
  overrides: IOSAdHocSigningOverrides,
  host: IOSPackageHost = DEFAULT_HOST,
): void {
  const signing = resolveIOSAdHocSigning(bundleId, overrides, host);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-package-"));
  try {
    const entitlementsPath = path.join(tempDir, "entitlements.plist");
    fs.writeFileSync(entitlementsPath, plist.build(signing.entitlements), "utf8");
    fs.copyFileSync(signing.provisioningProfilePath, path.join(appPath, "embedded.mobileprovision"));
    for (const nestedPath of collectNestedCodePaths(appPath)) {
      host.execFile("codesign", ["--force", "--sign", signing.identity, "--timestamp=none", nestedPath]);
    }
    host.execFile("codesign", [
      "--force", "--sign", signing.identity,
      "--entitlements", entitlementsPath,
      "--generate-entitlement-der", "--timestamp=none", appPath,
    ]);
    host.execFile("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

    const payloadDir = path.join(tempDir, "Payload");
    fs.mkdirSync(payloadDir, { recursive: true });
    host.execFile("ditto", [appPath, path.join(payloadDir, path.basename(appPath))]);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.rmSync(archivePath, { force: true });
    host.execFile("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", payloadDir, archivePath]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectNestedCodePaths(appPath: string): string[] {
  const roots = [path.join(appPath, "Frameworks"), path.join(appPath, "PlugIns")];
  const matches: string[] = [];
  const walk = (currentPath: string) => {
    if (!fs.existsSync(currentPath)) return;
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      if ([".dylib", ".so"].includes(path.extname(currentPath))) matches.push(currentPath);
      return;
    }
    if ([".framework", ".appex"].includes(path.extname(currentPath))) {
      matches.push(currentPath);
      return;
    }
    for (const entry of fs.readdirSync(currentPath)) walk(path.join(currentPath, entry));
  };
  for (const root of roots) walk(root);
  return matches.sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
}

function autoResolveAdHocProfile(bundleId: string, host: IOSPackageHost): AdHocProfile {
  const directories = [
    path.join(host.homeDir, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
    path.join(host.homeDir, "Library", "MobileDevice", "Provisioning Profiles"),
  ];
  const profiles: AdHocProfile[] = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".mobileprovision")) continue;
      try {
        profiles.push(readAdHocProfile(path.join(directory, name), bundleId, host));
      } catch {
        // Profiles for other apps or distribution methods are expected here.
      }
    }
  }
  if (profiles.length === 0) {
    throw new Error(`Could not find an unexpired Ad Hoc provisioning profile for bundle id ${JSON.stringify(bundleId)}. Pass --ios-provisioning-profile.`);
  }
  if (profiles.length > 1) {
    throw new Error(`Multiple Ad Hoc provisioning profiles match bundle id ${JSON.stringify(bundleId)} (${profiles.map((profile) => profile.path).join(", ")}). Pass --ios-provisioning-profile.`);
  }
  return profiles[0];
}

function readAdHocProfile(profilePath: string, bundleId: string, host: IOSPackageHost): AdHocProfile {
  if (!fs.existsSync(profilePath)) throw new Error(`Provisioning profile not found: ${profilePath}`);
  const decoded = host.execFile("security", ["cms", "-D", "-i", profilePath]);
  const parsed = plist.parse(decoded) as Record<string, unknown>;
  const entitlements = asRecord(parsed.Entitlements);
  const applicationIdentifier = typeof entitlements["application-identifier"] === "string"
    ? entitlements["application-identifier"] as string : "";
  if (!matchesBundleId(applicationIdentifier, bundleId)) {
    throw new Error(`Provisioning profile application-identifier does not match bundle id ${JSON.stringify(bundleId)}`);
  }
  const expiration = parsed.ExpirationDate instanceof Date
    ? parsed.ExpirationDate.getTime()
    : Date.parse(String(parsed.ExpirationDate ?? ""));
  if (!Number.isFinite(expiration) || expiration <= host.now()) throw new Error("Provisioning profile is expired");
  if (!Array.isArray(parsed.ProvisionedDevices) || parsed.ProvisionedDevices.length === 0) {
    throw new Error("Provisioning profile is not an Ad Hoc profile because it has no provisioned devices");
  }
  if (parsed.ProvisionsAllDevices === true) throw new Error("Enterprise provisioning profiles cannot be used for Ad Hoc packaging");
  if (entitlements["get-task-allow"] === true) throw new Error("Development provisioning profiles cannot be used for Ad Hoc packaging");
  const certificates = Array.isArray(parsed.DeveloperCertificates) ? parsed.DeveloperCertificates : [];
  const certificateFingerprints = certificates.map((certificate) =>
    createHash("sha1").update(toBuffer(certificate)).digest("hex").toUpperCase());
  if (certificateFingerprints.length === 0) throw new Error("Provisioning profile contains no distribution certificates");
  return { path: profilePath, entitlements, certificateFingerprints };
}

function matchesBundleId(applicationIdentifier: string, bundleId: string): boolean {
  const provisioned = applicationIdentifier.slice(applicationIdentifier.indexOf(".") + 1);
  return provisioned === bundleId || provisioned === "*" || (provisioned.endsWith(".*") && bundleId.startsWith(provisioned.slice(0, -1)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  return Buffer.alloc(0);
}

function parseCodeSigningIdentities(output: string): Array<{ fingerprint: string; name: string }> {
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/u);
    return match ? [{ fingerprint: match[1], name: match[2] }] : [];
  });
}
