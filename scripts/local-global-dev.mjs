#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, lstat, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DOOF_SKILL_NAME = "doof-language";

export function getRepoRoot(scriptUrl = import.meta.url) {
  const scriptPath = fileURLToPath(scriptUrl);
  return nodePath.resolve(nodePath.dirname(scriptPath), "..");
}

export function getLocalGlobalPaths({
  repoRoot = getRepoRoot(),
  homeDir = os.homedir(),
  skillName = DOOF_SKILL_NAME,
} = {}) {
  return {
    repoRoot,
    skillName,
    skillSourcePath: nodePath.join(repoRoot, ".github", "skills", skillName),
    skillLinkPath: nodePath.join(homeDir, ".copilot", "skills", skillName),
  };
}

export function parseCommand(argv) {
  const command = argv[2] ?? "install";
  if (command === "install" || command === "uninstall") {
    return command;
  }

  throw new Error(`Unsupported command \"${command}\". Use install or uninstall.`);
}

async function assertDirectoryExists(targetPath, label) {
  const existingEntry = await safeLstat(targetPath);
  if (!existingEntry || !existingEntry.isDirectory()) {
    throw new Error(`${label} does not exist: ${targetPath}`);
  }
}

async function safeLstat(targetPath) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function resolveSymlinkTarget(linkPath) {
  const currentTarget = await readlink(linkPath);
  return nodePath.resolve(nodePath.dirname(linkPath), currentTarget);
}

export function getDirectorySymlinkType(platform = process.platform) {
  return platform === "win32" ? "junction" : "dir";
}

export async function ensureDirectorySymlink(targetPath, linkPath, platform = process.platform) {
  await mkdir(nodePath.dirname(linkPath), { recursive: true });

  const existingEntry = await safeLstat(linkPath);
  if (existingEntry) {
    if (!existingEntry.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink path: ${linkPath}`);
    }

    const existingTargetPath = await resolveSymlinkTarget(linkPath);
    if (nodePath.resolve(existingTargetPath) === nodePath.resolve(targetPath)) {
      return "unchanged";
    }

    await rm(linkPath, { recursive: true, force: true });
  }

  const relativeTargetPath = nodePath.relative(nodePath.dirname(linkPath), targetPath) || ".";
  await symlink(relativeTargetPath, linkPath, getDirectorySymlinkType(platform));
  return "linked";
}

export async function removeManagedSkillLink(linkPath) {
  const existingEntry = await safeLstat(linkPath);
  if (!existingEntry) {
    return "missing";
  }

  if (!existingEntry.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink path: ${linkPath}`);
  }

  await rm(linkPath, { recursive: true, force: true });
  return "removed";
}

export function runNpmCommand(args, { cwd, platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  const npmExecutable = platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSyncImpl(npmExecutable, args, {
    cwd,
    stdio: "inherit",
  });

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${npmExecutable} ${args.join(" ")}`);
  }

  if (result.error) {
    throw result.error;
  }
}

export async function installLocalGlobalDoof(paths = getLocalGlobalPaths()) {
  await assertDirectoryExists(paths.skillSourcePath, "Doof skill source");
  await ensureDirectorySymlink(paths.skillSourcePath, paths.skillLinkPath);
  runNpmCommand(["run", "build"], { cwd: paths.repoRoot });
  runNpmCommand(["link"], { cwd: paths.repoRoot });
}

export async function uninstallLocalGlobalDoof(paths = getLocalGlobalPaths()) {
  await removeManagedSkillLink(paths.skillLinkPath);
  runNpmCommand(["unlink", "--global", "doof"], { cwd: paths.repoRoot });
}

async function main() {
  const command = parseCommand(process.argv);
  const paths = getLocalGlobalPaths();

  if (command === "install") {
    await installLocalGlobalDoof(paths);
    console.log(`Linked skill to ${paths.skillLinkPath}`);
    console.log("Built and linked the doof npm package globally.");
    console.log('Use "npm link doof" inside another repo if you want it as a linked dependency there.');
    return;
  }

  await uninstallLocalGlobalDoof(paths);
  console.log(`Removed skill link at ${paths.skillLinkPath}`);
  console.log("Removed the global npm link for doof.");
}

const isMainModule = process.argv[1]
  ? nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}