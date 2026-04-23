import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOOF_STDLIB_ROOT_ENV,
  DEFAULT_STD_VERSIONS,
  getImplicitStdDependencyConfig,
  getImplicitStdDependencyNames,
  getStdPackageShortName,
  getStdlibRootOverride,
  isImplicitStdSelfReference,
  resolveStdlibOverridePath,
} from "./std-packages.js";
import { getImplicitStdDependencyLocalRoot } from "./std-packages-node.js";
import { STDLIB_PACKAGE_VERSIONS } from "./stdlib-packages.js";

const tmpDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      nodeFs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("std package metadata", () => {
  it("loads default std versions from the shared TypeScript manifest", () => {
    expect(DEFAULT_STD_VERSIONS).toEqual(STDLIB_PACKAGE_VERSIONS);
  });

  it("returns implicit dependency config for known std packages", () => {
    expect(getImplicitStdDependencyConfig("fs")).toEqual({
      url: "https://github.com/doof-lang/fs.git",
      version: DEFAULT_STD_VERSIONS.fs,
    });
    expect(getImplicitStdDependencyConfig("missing")).toBeNull();
  });

  it("resolves a rooted stdlib override when configured", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "/workspace/doof-stdlib");

    expect(getStdlibRootOverride()).toBe("/workspace/doof-stdlib");
    expect(resolveStdlibOverridePath("std/fs")).toBe("/workspace/doof-stdlib/fs");
    expect(resolveStdlibOverridePath("std/fs/runtime")).toBe("/workspace/doof-stdlib/fs/runtime");
    expect(resolveStdlibOverridePath("std/missing")).toBeNull();
  });

  it("finds an implicit local std dependency root when the override contains a package manifest", () => {
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doof-std-packages-"));
    tmpDirs.push(dir);

    const packageRoot = nodePath.join(dir, "fs");
    nodeFs.mkdirSync(packageRoot, { recursive: true });
    nodeFs.writeFileSync(nodePath.join(packageRoot, "doof.json"), JSON.stringify({ name: "std/fs" }), "utf8");

    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, dir);

    expect(getImplicitStdDependencyLocalRoot("fs")).toBe(packageRoot);
  });

  it("lists implicit std dependency names", () => {
    expect(getImplicitStdDependencyNames()).toEqual([
      "std/assert",
      "std/blob",
      "std/crypto",
      "std/fs",
      "std/http",
      "std/json",
      "std/path",
      "std/regex",
      "std/stream",
      "std/time",
    ]);
  });

  it("extracts std package short names", () => {
    expect(getStdPackageShortName("std/fs")).toBe("fs");
    expect(getStdPackageShortName("std/fs/path")).toBe("fs/path");
    expect(getStdPackageShortName("std/")).toBeNull();
    expect(getStdPackageShortName("./fs")).toBeNull();
  });

  it("recognizes implicit std self references", () => {
    expect(isImplicitStdSelfReference("std/fs", "std/fs")).toBe(true);
    expect(isImplicitStdSelfReference("fs", "std/fs")).toBe(true);
    expect(isImplicitStdSelfReference("std/path", "std/fs")).toBe(false);
    expect(isImplicitStdSelfReference(undefined, "std/fs")).toBe(false);
  });
});