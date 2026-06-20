import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedDoofEmbeddedLibrary } from "./build-targets.js";

export type AppleBundlePlatform = "macos" | "ios" | "ios-simulator";

export interface AppleEmbeddedLibraryHost {
  execFile(command: string, args: string[]): string;
}

export interface EmbedAppleLibrariesOptions {
  executablePath: string;
  frameworksDir: string;
  executableFrameworkRPath: string;
  embeddedLibraries: readonly ResolvedDoofEmbeddedLibrary[];
  libraryPaths: readonly string[];
  platform: AppleBundlePlatform;
  host?: AppleEmbeddedLibraryHost;
}

interface EmbeddedCode {
  sourcePath: string;
  bundledRoot: string;
  bundledPath: string;
  bundleReference: string;
  installNames: Set<string>;
  destinationKey: string;
}

const DEFAULT_HOST: AppleEmbeddedLibraryHost = {
  execFile(command, args) {
    return String(execFileSync(command, args, { encoding: "utf8", stdio: "pipe" })).trim();
  },
};

export function embedAppleLibraries(options: EmbedAppleLibrariesOptions): void {
  if (options.embeddedLibraries.length === 0) return;
  const host = options.host ?? DEFAULT_HOST;
  const executableInfo = inspectMachO(options.executablePath, host);
  validatePlatform(executableInfo.platform, options.platform, options.executablePath);
  fs.mkdirSync(options.frameworksDir, { recursive: true });

  const embedded = options.embeddedLibraries.map((entry) =>
    resolveEmbeddedCode(entry, options.libraryPaths, options.frameworksDir, host));
  const destinations = new Set<string>();
  for (const code of embedded) {
    if (destinations.has(code.destinationKey)) {
      throw new Error(`Duplicate embedded library destination: ${code.destinationKey}`);
    }
    destinations.add(code.destinationKey);
    copyEmbeddedCode(code);
    const bundledInfo = inspectMachO(code.bundledPath, host);
    validateArchitectures(executableInfo.architectures, bundledInfo.architectures, code.sourcePath);
    validatePlatform(bundledInfo.platform, options.platform, code.sourcePath);
  }

  const codePaths = [options.executablePath, ...embedded.map((code) => code.bundledPath)];
  for (const codePath of codePaths) {
    rewriteDependencies(codePath, embedded, host);
  }
  for (const code of embedded) {
    host.execFile("install_name_tool", ["-id", code.bundleReference, code.bundledPath]);
  }
  for (const codePath of codePaths) {
    removeExternalLibraryRPaths(codePath, options.libraryPaths, host);
  }
  ensureRPath(options.executablePath, options.executableFrameworkRPath, host);
  for (const code of embedded) {
    ensureRPath(code.bundledPath, "@loader_path", host);
  }
  for (const codePath of codePaths) {
    verifyDependencies(codePath, embedded, host);
  }
}

function resolveEmbeddedCode(
  entry: ResolvedDoofEmbeddedLibrary,
  libraryPaths: readonly string[],
  frameworksDir: string,
  host: AppleEmbeddedLibraryHost,
): EmbeddedCode {
  const sourcePath = "library" in entry && entry.library !== undefined
    ? resolveLinkedLibrary(entry.library, libraryPaths)
    : entry.path!;
  if (!fs.existsSync(sourcePath)) throw new Error(`Embedded library not found: ${sourcePath}`);
  if (path.extname(sourcePath) === ".a") {
    throw new Error(`Embedded library must be dynamic, not a static archive: ${sourcePath}`);
  }

  if (path.extname(sourcePath) === ".framework") {
    if (!fs.statSync(sourcePath).isDirectory()) {
      throw new Error(`Embedded framework must be a directory: ${sourcePath}`);
    }
    const frameworkName = path.basename(sourcePath);
    const sourceBinary = findFrameworkBinary(sourcePath);
    const relativeBinary = path.relative(sourcePath, sourceBinary);
    const bundledRoot = path.join(frameworksDir, frameworkName);
    const installId = readInstallId(sourceBinary, host);
    const suffix = frameworkInstallNameSuffix(installId, frameworkName, relativeBinary);
    return {
      sourcePath,
      bundledRoot,
      bundledPath: path.join(bundledRoot, relativeBinary),
      bundleReference: `@rpath/${frameworkName}/${suffix}`,
      installNames: new Set([sourceBinary, installId]),
      destinationKey: frameworkName,
    };
  }

  if (!fs.statSync(sourcePath).isFile() || ![".dylib", ".so"].includes(path.extname(sourcePath))) {
    throw new Error(`Embedded library must be a .dylib, .so, or .framework: ${sourcePath}`);
  }
  const installId = readInstallId(sourcePath, host);
  const fileName = path.basename(installId || sourcePath);
  return {
    sourcePath,
    bundledRoot: path.join(frameworksDir, fileName),
    bundledPath: path.join(frameworksDir, fileName),
    bundleReference: `@rpath/${fileName}`,
    installNames: new Set([sourcePath, fs.realpathSync(sourcePath), installId]),
    destinationKey: fileName,
  };
}

function resolveLinkedLibrary(name: string, libraryPaths: readonly string[]): string {
  if (name.length === 0 || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid embedded linked library name: ${JSON.stringify(name)}`);
  }
  const candidates = [`lib${name}.dylib`, `${name}.dylib`, `lib${name}.so`, `${name}.so`];
  for (const libraryPath of libraryPaths) {
    for (const candidate of candidates) {
      const candidatePath = path.join(libraryPath, candidate);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) return candidatePath;
    }
  }
  throw new Error(
    `Could not resolve embedded linked library ${JSON.stringify(name)} in library paths: ${libraryPaths.join(", ") || "(none)"}`,
  );
}

function copyEmbeddedCode(code: EmbeddedCode): void {
  const sourceIsFramework = path.extname(code.sourcePath) === ".framework";
  fs.rmSync(code.bundledRoot, { recursive: true, force: true });
  if (sourceIsFramework) {
    fs.cpSync(code.sourcePath, code.bundledRoot, { recursive: true, dereference: false });
  } else {
    fs.copyFileSync(code.sourcePath, code.bundledRoot);
    fs.chmodSync(code.bundledRoot, fs.statSync(code.sourcePath).mode);
  }
}

function rewriteDependencies(codePath: string, embedded: readonly EmbeddedCode[], host: AppleEmbeddedLibraryHost): void {
  for (const dependency of readDependencies(codePath, host)) {
    if (isSystemDependency(dependency)) continue;
    const target = matchEmbeddedDependency(dependency, embedded);
    if (!target) {
      throw new Error(
        `Mach-O file ${codePath} references non-system dependency ${dependency}, which is not listed in embeddedLibraries`,
      );
    }
    if (dependency !== target.bundleReference) {
      host.execFile("install_name_tool", ["-change", dependency, target.bundleReference, codePath]);
    }
  }
}

function verifyDependencies(codePath: string, embedded: readonly EmbeddedCode[], host: AppleEmbeddedLibraryHost): void {
  for (const dependency of readDependencies(codePath, host)) {
    if (isSystemDependency(dependency)) continue;
    if (!embedded.some((code) => dependency === code.bundleReference)) {
      throw new Error(`Mach-O dependency remained external after embedding: ${codePath} -> ${dependency}`);
    }
  }
}

function matchEmbeddedDependency(dependency: string, embedded: readonly EmbeddedCode[]): EmbeddedCode | undefined {
  return embedded.find((code) =>
    dependency === code.bundleReference
    || code.installNames.has(dependency)
    || path.basename(dependency) === path.basename(code.bundleReference));
}

function ensureRPath(codePath: string, rpath: string, host: AppleEmbeddedLibraryHost): void {
  if (readRPaths(codePath, host).includes(rpath)) return;
  host.execFile("install_name_tool", ["-add_rpath", rpath, codePath]);
}

function removeExternalLibraryRPaths(
  codePath: string,
  libraryPaths: readonly string[],
  host: AppleEmbeddedLibraryHost,
): void {
  const normalizedLibraryPaths = new Set(libraryPaths.map((item) => path.resolve(item)));
  for (const rpath of readRPaths(codePath, host)) {
    if (path.isAbsolute(rpath) && normalizedLibraryPaths.has(path.resolve(rpath))) {
      host.execFile("install_name_tool", ["-delete_rpath", rpath, codePath]);
    }
  }
}

function readDependencies(codePath: string, host: AppleEmbeddedLibraryHost): string[] {
  return host.execFile("otool", ["-L", codePath]).split(/\r?\n/u).slice(1).flatMap((line) => {
    const match = line.trim().match(/^(\S+)\s+\(compatibility version/u);
    return match ? [match[1]] : [];
  });
}

function readInstallId(codePath: string, host: AppleEmbeddedLibraryHost): string {
  return host.execFile("otool", ["-D", codePath]).split(/\r?\n/u).slice(1).map((line) => line.trim()).find(Boolean) ?? "";
}

function readRPaths(codePath: string, host: AppleEmbeddedLibraryHost): string[] {
  const lines = host.execFile("otool", ["-l", codePath]).split(/\r?\n/u);
  const rpaths: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "cmd LC_RPATH") continue;
    for (let nested = index + 1; nested < Math.min(lines.length, index + 6); nested += 1) {
      const match = lines[nested].trim().match(/^path\s+(\S+)\s+\(offset/u);
      if (match) rpaths.push(match[1]);
    }
  }
  return rpaths;
}

function inspectMachO(codePath: string, host: AppleEmbeddedLibraryHost): { architectures: string[]; platform?: string } {
  const architectures = host.execFile("lipo", ["-archs", codePath]).trim().split(/\s+/u).filter(Boolean);
  const loadCommands = host.execFile("otool", ["-l", codePath]);
  const platform = loadCommands.match(/^\s*platform\s+([^\s]+)\s*$/mu)?.[1]
    ?? (loadCommands.includes("LC_VERSION_MIN_MACOSX") ? "macos" : undefined)
    ?? (loadCommands.includes("LC_VERSION_MIN_IPHONEOS") ? "ios" : undefined);
  return { architectures, platform };
}

function validateArchitectures(executable: readonly string[], library: readonly string[], sourcePath: string): void {
  const missing = executable.filter((architecture) => !library.includes(architecture));
  if (missing.length > 0) {
    throw new Error(`Embedded library ${sourcePath} is missing required architecture(s): ${missing.join(", ")}`);
  }
}

function validatePlatform(actual: string | undefined, expected: AppleBundlePlatform, sourcePath: string): void {
  if (actual === undefined) return;
  const accepted = expected === "macos" ? ["1", "macos", "MACOS"]
    : expected === "ios" ? ["2", "ios", "IOS"]
      : ["7", "iossimulator", "IOSSIMULATOR"];
  if (!accepted.includes(actual)) {
    throw new Error(`Mach-O file ${sourcePath} targets ${actual}, not ${expected}`);
  }
}

function findFrameworkBinary(frameworkPath: string): string {
  const name = path.basename(frameworkPath, ".framework");
  const candidates = [
    path.join(frameworkPath, name),
    path.join(frameworkPath, "Versions", "Current", name),
  ];
  const candidate = candidates.find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
  if (!candidate) throw new Error(`Could not find executable in embedded framework: ${frameworkPath}`);
  return candidate;
}

function frameworkInstallNameSuffix(installId: string, frameworkName: string, fallback: string): string {
  const marker = `${frameworkName}/`;
  const index = installId.indexOf(marker);
  return index === -1 ? fallback : installId.slice(index + marker.length);
}

function isSystemDependency(dependency: string): boolean {
  return dependency.startsWith("/System/Library/") || dependency.startsWith("/usr/lib/");
}
