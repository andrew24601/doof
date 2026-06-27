import * as fs from "node:fs";
import * as path from "node:path";
import type { CompilerToolchainKind } from "./cli-core.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { expandResourceFiles, type ResolvedDoofResource } from "./resource-patterns.js";

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

export function copyPackagedExecutable(
  executablePath: string,
  distDir: string,
  resources: readonly ResolvedDoofResource[] = [],
): string {
  fs.mkdirSync(distDir, { recursive: true });
  const destination = path.join(distDir, path.basename(executablePath));
  fs.rmSync(destination, { force: true });
  fs.copyFileSync(executablePath, destination);
  fs.chmodSync(destination, fs.statSync(executablePath).mode);
  copyExecutableResources(resources, distDir, [destination]);
  return destination;
}

export function copyExecutableResources(
  resources: readonly ResolvedDoofResource[],
  resourceRootDir: string,
  reservedPaths: readonly string[] = [],
): void {
  const seenDestinations = new Set(reservedPaths.map((reservedPath) => path.resolve(reservedPath)));
  for (const resource of resources) {
    const matchedFiles = expandResourceFiles(resource.fromPattern);
    if (matchedFiles.length === 0) {
      throw new Error(`No files matched resource pattern: ${resource.fromPattern}`);
    }

    const destinationDir = resource.destination.length > 0
      ? path.join(resourceRootDir, resource.destination)
      : resourceRootDir;

    for (const matchedFile of matchedFiles) {
      const destinationPath = path.join(destinationDir, matchedFile.relativePath);
      const resolvedDestinationPath = path.resolve(destinationPath);
      if (seenDestinations.has(resolvedDestinationPath)) {
        throw new Error(`Duplicate executable resource destination: ${destinationPath}`);
      }
      seenDestinations.add(resolvedDestinationPath);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(matchedFile.sourcePath, destinationPath);
    }
  }
}

export function packageArchiveName(executableName: string, version: string, platform: "macos" | "ios"): string {
  const safeVersion = version.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${executableName}-${safeVersion}-${platform}.${platform === "ios" ? "ipa" : "zip"}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
