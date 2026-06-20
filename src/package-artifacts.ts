import * as fs from "node:fs";
import * as path from "node:path";
import type { CompilerToolchainKind } from "./cli-core.js";
import type { NativeBuildOptions } from "./emitter-module.js";

export function withReleaseBuildDefaults(
  nativeBuild: NativeBuildOptions,
  toolchainKind: CompilerToolchainKind,
): NativeBuildOptions {
  return {
    ...nativeBuild,
    defines: uniqueStrings(["NDEBUG", ...nativeBuild.defines]),
    compilerFlags: toolchainKind === "msvc"
      ? uniqueStrings(["/O2", ...nativeBuild.compilerFlags])
      : uniqueStrings(["-O2", ...nativeBuild.compilerFlags]),
  };
}

export function copyPackagedExecutable(executablePath: string, distDir: string): string {
  fs.mkdirSync(distDir, { recursive: true });
  const destination = path.join(distDir, path.basename(executablePath));
  fs.rmSync(destination, { force: true });
  fs.copyFileSync(executablePath, destination);
  fs.chmodSync(destination, fs.statSync(executablePath).mode);
  return destination;
}

export function packageArchiveName(executableName: string, version: string, platform: "macos" | "ios"): string {
  const safeVersion = version.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${executableName}-${safeVersion}-${platform}.${platform === "ios" ? "ipa" : "zip"}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
