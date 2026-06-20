import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import plist from "plist";
import type { MacOSPackageSigning } from "./package-manifest.js";

export interface MacOSPackageSigningOptions {
  signing: MacOSPackageSigning;
  identity?: string;
  sandbox: boolean;
  entitlementsPath?: string;
}

export interface MacOSPackageHost {
  platform: NodeJS.Platform;
  execFile(command: string, args: string[]): string;
}

const DEFAULT_HOST: MacOSPackageHost = {
  platform: process.platform,
  execFile(command, args) {
    return String(execFileSync(command, args, { encoding: "utf8", stdio: "pipe" })).trim();
  },
};

export function resolveMacOSSigningIdentity(
  options: MacOSPackageSigningOptions,
  host: MacOSPackageHost = DEFAULT_HOST,
): string {
  if (options.signing === "ad-hoc") return "-";
  if (options.identity) return options.identity;

  const identities = parseCodeSigningIdentities(host.execFile("security", ["find-identity", "-v", "-p", "codesigning"]))
    .filter((identity) => identity.name.startsWith("Developer ID Application:"));
  if (identities.length === 0) {
    throw new Error("No Developer ID Application signing identity found. Install one, pass --macos-sign-identity, or use --macos-signing ad-hoc.");
  }
  if (identities.length > 1) {
    throw new Error(`Multiple Developer ID Application identities found (${identities.map((item) => item.name).join(", ")}). Pass --macos-sign-identity.`);
  }
  return identities[0].name;
}

export function signMacOSApp(
  appPath: string,
  options: MacOSPackageSigningOptions,
  host: MacOSPackageHost = DEFAULT_HOST,
): void {
  if (host.platform !== "darwin") throw new Error("macOS app signing is only supported on macOS");
  const identity = resolveMacOSSigningIdentity(options, host);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-sign-"));
  try {
    const entitlementsPath = createEffectiveEntitlements(options, tempDir);
    for (const nestedPath of collectNestedCodePaths(appPath)) {
      host.execFile("codesign", buildCodesignArgs(nestedPath, identity, options.signing, undefined));
    }
    host.execFile("codesign", buildCodesignArgs(appPath, identity, options.signing, entitlementsPath));
    host.execFile("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function archiveMacOSApp(
  appPath: string,
  archivePath: string,
  host: MacOSPackageHost = DEFAULT_HOST,
): void {
  if (host.platform !== "darwin") throw new Error("macOS app archiving is only supported on macOS");
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.rmSync(archivePath, { force: true });
  host.execFile("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath]);
}

function createEffectiveEntitlements(options: MacOSPackageSigningOptions, tempDir: string): string | undefined {
  if (!options.entitlementsPath && !options.sandbox) return undefined;
  let entitlements: Record<string, unknown> = {};
  if (options.entitlementsPath) {
    if (!fs.existsSync(options.entitlementsPath)) {
      throw new Error(`macOS entitlements file not found: ${options.entitlementsPath}`);
    }
    entitlements = plist.parse(fs.readFileSync(options.entitlementsPath, "utf8")) as Record<string, unknown>;
  }
  if (options.sandbox) {
    if (entitlements["com.apple.security.app-sandbox"] === false) {
      throw new Error("macOS sandbox is enabled but the supplied entitlements explicitly disable it");
    }
    entitlements["com.apple.security.app-sandbox"] = true;
  }
  const outputPath = path.join(tempDir, "entitlements.plist");
  fs.writeFileSync(outputPath, plist.build(entitlements), "utf8");
  return outputPath;
}

function buildCodesignArgs(
  targetPath: string,
  identity: string,
  signing: MacOSPackageSigning,
  entitlementsPath: string | undefined,
): string[] {
  return [
    "--force",
    "--sign", identity,
    "--options", "runtime",
    signing === "ad-hoc" ? "--timestamp=none" : "--timestamp",
    ...(entitlementsPath ? ["--entitlements", entitlementsPath] : []),
    targetPath,
  ];
}

function collectNestedCodePaths(appPath: string): string[] {
  const roots = [
    path.join(appPath, "Contents", "Frameworks"),
    path.join(appPath, "Contents", "PlugIns"),
    path.join(appPath, "Contents", "XPCServices"),
  ];
  const matches: string[] = [];
  const walk = (currentPath: string) => {
    if (!fs.existsSync(currentPath)) return;
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      if ([".dylib", ".so"].includes(path.extname(currentPath))) matches.push(currentPath);
      return;
    }
    if (currentPath !== appPath && [".framework", ".appex", ".xpc"].includes(path.extname(currentPath))) {
      matches.push(currentPath);
      return;
    }
    for (const entry of fs.readdirSync(currentPath)) walk(path.join(currentPath, entry));
  };
  for (const root of roots) walk(root);
  return matches.sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
}

function parseCodeSigningIdentities(output: string): Array<{ fingerprint: string; name: string }> {
  const identities: Array<{ fingerprint: string; name: string }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/u);
    if (match) identities.push({ fingerprint: match[1], name: match[2] });
  }
  return identities;
}
