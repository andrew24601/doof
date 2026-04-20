#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

export const DOOF_STDLIB_ROOT_ENV = "DOOF_STDLIB_ROOT";

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = nodePath.join(repoRoot, "stdlib-packages.json");
const stdlibRoot = nodePath.join(repoRoot, "stdlib");

if (isMainModule(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

export async function main(env = process.env) {
  const manifest = loadStdPackageManifest();
  const syncSource = resolveStdlibSyncSource(env, stdlibRoot);

  if (syncSource.kind === "remote") {
    ensureTarAvailable();
  } else {
    console.log(`Using ${DOOF_STDLIB_ROOT_ENV}=${syncSource.root} as stdlib sync source`);
  }

  nodeFs.rmSync(stdlibRoot, { recursive: true, force: true });
  nodeFs.mkdirSync(stdlibRoot, { recursive: true });

  const resolvedPackages = {};

  for (const packageName of Object.keys(manifest).sort()) {
    const version = manifest[packageName];
    const resolved = syncSource.kind === "remote"
      ? await materializeRemoteStdPackage(packageName, version)
      : materializeLocalStdPackage(syncSource.root, packageName, version);
    resolvedPackages[packageName] = resolved;
    if (resolved.sourceKind === "remote") {
      console.log(`Synced std/${packageName}@${version} from ${resolved.resolvedRef}`);
    } else {
      console.log(`Synced std/${packageName}@${version} from local override ${resolved.localPath}`);
    }
  }

  nodeFs.writeFileSync(
    nodePath.join(stdlibRoot, "manifest.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      packages: resolvedPackages,
    }, null, 2)}\n`,
  );

  console.log(`Wrote stdlib mirror to ${stdlibRoot}`);
}

function isMainModule(moduleUrl, entryPath) {
  if (!entryPath) {
    return false;
  }

  return nodePath.resolve(entryPath) === fileURLToPath(moduleUrl);
}

export function getStdlibRootOverride(env = process.env) {
  const configuredRoot = env[DOOF_STDLIB_ROOT_ENV]?.trim();
  if (!configuredRoot) {
    return null;
  }

  return nodePath.resolve(configuredRoot);
}

export function resolveStdlibSyncSource(env = process.env, targetRoot = stdlibRoot) {
  const overrideRoot = getStdlibRootOverride(env);
  if (!overrideRoot) {
    return { kind: "remote" };
  }

  const resolvedTargetRoot = nodePath.resolve(targetRoot);
  if (overrideRoot === resolvedTargetRoot) {
    throw new Error(
      `${DOOF_STDLIB_ROOT_ENV} cannot point at the stdlib mirror directory (${resolvedTargetRoot}) while running sync:stdlib`,
    );
  }

  return {
    kind: "local-override",
    root: overrideRoot,
  };
}

function loadStdPackageManifest() {
  const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, "utf8"));
  if (!isStdPackageManifest(manifest)) {
    throw new Error(`Invalid stdlib package manifest at ${manifestPath}`);
  }
  return manifest;
}

function isStdPackageManifest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(([packageName, version]) => (
    packageName.length > 0 && typeof version === "string" && version.length > 0
  ));
}

function ensureTarAvailable() {
  try {
    execFileSync("tar", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("sync-stdlib requires the `tar` command to be available on PATH");
  }
}

function materializeLocalStdPackage(sourceRoot, packageName, version) {
  const sourceDir = nodePath.join(sourceRoot, packageName);
  if (!nodeFs.existsSync(sourceDir) || !nodeFs.statSync(sourceDir).isDirectory()) {
    throw new Error(
      `Failed to sync std/${packageName}@${version}: local override package directory not found at ${sourceDir}`,
    );
  }

  const targetDir = nodePath.join(stdlibRoot, packageName);
  nodeFs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter(entryPath) {
      return nodePath.basename(entryPath) !== ".git";
    },
  });

  return {
    version,
    sourceKind: "local-override",
    localPath: sourceDir,
  };
}

async function materializeRemoteStdPackage(packageName, version) {
  const archiveTempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), `doof-stdlib-${packageName}-`));
  const extractDir = nodeFs.mkdtempSync(nodePath.join(stdlibRoot, `${packageName}.tmp-`));
  const targetDir = nodePath.join(stdlibRoot, packageName);
  const failures = [];

  try {
    for (const ref of buildRemoteRefCandidates(version)) {
      const archiveUrl = buildArchiveUrl(packageName, ref);
      const archivePath = nodePath.join(archiveTempDir, `${packageName}.tar.gz`);

      try {
        const response = await fetch(archiveUrl, {
          headers: {
            "user-agent": "doof-stdlib-sync",
          },
        });

        if (!response.ok) {
          failures.push(`${ref}: HTTP ${response.status}`);
          continue;
        }

        nodeFs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
        execFileSync("tar", ["-xzf", archivePath, "-C", extractDir, "--strip-components=1"], { stdio: "pipe" });
        nodeFs.renameSync(extractDir, targetDir);
        return {
          version,
          sourceKind: "remote",
          resolvedRef: ref,
          archiveUrl,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${ref}: ${message}`);
        nodeFs.rmSync(extractDir, { recursive: true, force: true });
        nodeFs.mkdirSync(extractDir, { recursive: true });
      }
    }
  } finally {
    nodeFs.rmSync(archiveTempDir, { recursive: true, force: true });
  }

  nodeFs.rmSync(extractDir, { recursive: true, force: true });

  throw new Error(
    `Failed to sync std/${packageName}@${version}: ${failures.join("; ")}`,
  );
}

function buildArchiveUrl(packageName, ref) {
  return `https://github.com/doof-lang/${packageName}/archive/refs/tags/${encodeURIComponent(ref)}.tar.gz`;
}

function buildRemoteRefCandidates(version) {
  const candidates = [version];
  if (version.startsWith("v")) {
    candidates.push(version.slice(1));
  } else {
    candidates.push(`v${version}`);
  }

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
}