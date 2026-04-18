import { mkdtemp, mkdir, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import {
  ensureDirectorySymlink,
  getDirectorySymlinkType,
  getLocalGlobalPaths,
  parseCommand,
  removeManagedSkillLink,
  runNpmCommand,
} from "../scripts/local-global-dev.mjs";

describe("local-global-dev script helpers", () => {
  it("defaults to the install command", () => {
    expect(parseCommand(["node", "script.mjs"])).toBe("install");
  });

  it("accepts the uninstall command", () => {
    expect(parseCommand(["node", "script.mjs", "uninstall"])).toBe("uninstall");
  });

  it("rejects unsupported commands", () => {
    expect(() => parseCommand(["node", "script.mjs", "status"])).toThrow(
      'Unsupported command "status". Use install or uninstall.',
    );
  });

  it("builds the expected local-global paths", () => {
    expect(
      getLocalGlobalPaths({
        repoRoot: "/repo/doof",
        homeDir: "/Users/tester",
      }),
    ).toEqual({
      repoRoot: "/repo/doof",
      skillName: "doof-language",
      skillSourcePath: "/repo/doof/.github/skills/doof-language",
      skillLinkPath: "/Users/tester/.copilot/skills/doof-language",
    });
  });

  it("uses a junction symlink on Windows and a directory symlink elsewhere", () => {
    expect(getDirectorySymlinkType("win32")).toBe("junction");
    expect(getDirectorySymlinkType("darwin")).toBe("dir");
  });

  it("creates a symlink for the personal skill", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const targetPath = nodePath.join(tempRoot, "repo", ".github", "skills", "doof-language");
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(targetPath, { recursive: true });
      await writeFile(nodePath.join(targetPath, "SKILL.md"), "# test\n");

      const result = await ensureDirectorySymlink(targetPath, linkPath);
      const resolvedLinkTarget = nodePath.resolve(nodePath.dirname(linkPath), await readlink(linkPath));

      expect(result).toBe("linked");
      expect(resolvedLinkTarget).toBe(targetPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("leaves an existing matching symlink in place", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const targetPath = nodePath.join(tempRoot, "repo", ".github", "skills", "doof-language");
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(targetPath, { recursive: true });
      await writeFile(nodePath.join(targetPath, "SKILL.md"), "# test\n");

      await ensureDirectorySymlink(targetPath, linkPath);
      await expect(ensureDirectorySymlink(targetPath, linkPath)).resolves.toBe("unchanged");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("replaces a stale symlink", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const currentTargetPath = nodePath.join(tempRoot, "repo-a", ".github", "skills", "doof-language");
    const nextTargetPath = nodePath.join(tempRoot, "repo-b", ".github", "skills", "doof-language");
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(currentTargetPath, { recursive: true });
      await mkdir(nextTargetPath, { recursive: true });
      await writeFile(nodePath.join(currentTargetPath, "SKILL.md"), "# current\n");
      await writeFile(nodePath.join(nextTargetPath, "SKILL.md"), "# next\n");

      await ensureDirectorySymlink(currentTargetPath, linkPath);
      await expect(ensureDirectorySymlink(nextTargetPath, linkPath)).resolves.toBe("linked");

      const resolvedLinkTarget = nodePath.resolve(nodePath.dirname(linkPath), await readlink(linkPath));
      expect(resolvedLinkTarget).toBe(nextTargetPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to replace a non-symlink path", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const targetPath = nodePath.join(tempRoot, "repo", ".github", "skills", "doof-language");
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(targetPath, { recursive: true });
      await mkdir(linkPath, { recursive: true });

      await expect(ensureDirectorySymlink(targetPath, linkPath)).rejects.toThrow(
        `Refusing to replace non-symlink path: ${linkPath}`,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes a managed skill link", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const targetPath = nodePath.join(tempRoot, "repo", ".github", "skills", "doof-language");
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(targetPath, { recursive: true });
      await writeFile(nodePath.join(targetPath, "SKILL.md"), "# test\n");
      await ensureDirectorySymlink(targetPath, linkPath);

      await expect(removeManagedSkillLink(linkPath)).resolves.toBe("removed");
      await expect(removeManagedSkillLink(linkPath)).resolves.toBe("missing");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses to remove a non-symlink skill path", async () => {
    const tempRoot = await mkdtemp(nodePath.join(os.tmpdir(), "doof-local-global-"));
    const linkPath = nodePath.join(tempRoot, "home", ".copilot", "skills", "doof-language");

    try {
      await mkdir(linkPath, { recursive: true });

      await expect(removeManagedSkillLink(linkPath)).rejects.toThrow(
        `Refusing to remove non-symlink path: ${linkPath}`,
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs npm commands with the platform-specific executable", () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    runNpmCommand(["run", "build"], {
      cwd: "/repo/doof",
      platform: "darwin",
      spawnSyncImpl(command, args, options) {
        calls.push({
          command,
          args,
          cwd: options.cwd,
        });
        return { status: 0 } as ReturnType<typeof import("node:child_process").spawnSync>;
      },
    });

    expect(calls).toEqual([
      {
        command: "npm",
        args: ["run", "build"],
        cwd: "/repo/doof",
      },
    ]);
  });

  it("throws when an npm command fails", () => {
    expect(() =>
      runNpmCommand(["link"], {
        cwd: "/repo/doof",
        platform: "darwin",
        spawnSyncImpl() {
          return { status: 1 } as ReturnType<typeof import("node:child_process").spawnSync>;
        },
      }),
    ).toThrow("Command failed (1): npm link");
  });
});