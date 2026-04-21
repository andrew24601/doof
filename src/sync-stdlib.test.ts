import * as nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { DOOF_STDLIB_ROOT_ENV } from "./std-packages.js";
import { getStdlibRootOverride, resolveStdlibSyncSource } from "./sync-stdlib.js";

describe("sync stdlib source selection", () => {
  it("uses remote archives when DOOF_STDLIB_ROOT is unset", () => {
    expect(resolveStdlibSyncSource({})).toEqual({ kind: "remote" });
  });

  it("ignores blank DOOF_STDLIB_ROOT values", () => {
    expect(getStdlibRootOverride({ [DOOF_STDLIB_ROOT_ENV]: "   " })).toBeNull();
    expect(resolveStdlibSyncSource({ [DOOF_STDLIB_ROOT_ENV]: "   " })).toEqual({ kind: "remote" });
  });

  it("uses the configured local stdlib checkout as the mirror source", () => {
    const source = resolveStdlibSyncSource({ [DOOF_STDLIB_ROOT_ENV]: "../doof-stdlib" }, "/workspace/doof/stdlib");

    expect(source).toEqual({
      kind: "local-override",
      root: nodePath.resolve("../doof-stdlib"),
    });
  });

  it("rejects syncing from the mirror directory itself", () => {
    expect(() => resolveStdlibSyncSource(
      { [DOOF_STDLIB_ROOT_ENV]: "/workspace/doof/stdlib" },
      "/workspace/doof/stdlib",
    )).toThrow("cannot point at the stdlib mirror directory");
  });
});