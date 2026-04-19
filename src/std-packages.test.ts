import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOOF_STDLIB_ROOT_ENV,
  DEFAULT_STD_VERSIONS,
  getImplicitStdDependencyConfig,
  getImplicitStdDependencyLocalRoot,
  getImplicitStdDependencyNames,
  getStdPackageShortName,
  getStdlibRootOverride,
  isImplicitStdSelfReference,
  resolveStdlibOverridePath,
} from "./std-packages.js";

const STDLIB_PACKAGES_MANIFEST_PATH = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "..",
  "stdlib-packages.json",
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("std package metadata", () => {
  it("loads default std versions from the shared manifest", () => {
    const manifest = JSON.parse(nodeFs.readFileSync(STDLIB_PACKAGES_MANIFEST_PATH, "utf8")) as Record<string, string>;

    expect(DEFAULT_STD_VERSIONS).toEqual(manifest);
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
    expect(getImplicitStdDependencyLocalRoot("fs")).toBe("/workspace/doof-stdlib/fs");
    expect(resolveStdlibOverridePath("std/missing")).toBeNull();
  });

  it("lists implicit std dependency names", () => {
    expect(getImplicitStdDependencyNames()).toEqual([
      "std/assert",
      "std/blob",
      "std/fs",
      "std/http",
      "std/path",
      "std/regex",
      "std/stream",
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