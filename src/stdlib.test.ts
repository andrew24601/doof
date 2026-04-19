import { afterEach, describe, expect, it, vi } from "vitest";
import { createBundledModuleResolver, withBundledStdlib, BUNDLED_STDLIB_ROOT } from "./stdlib.js";
import { DOOF_STDLIB_ROOT_ENV } from "./std-packages.js";
import { VirtualFS } from "./test-helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bundled stdlib overrides", () => {
  it("resolves std imports from DOOF_STDLIB_ROOT", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "/workspace/doof-stdlib");

    const resolver = createBundledModuleResolver(new VirtualFS({
      "/app/main.do": "",
      "/workspace/doof-stdlib/fs/index.do": "",
      "/workspace/doof-stdlib/fs/runtime.do": "",
    }));

    expect(resolver.resolve("std/fs", "/app/main.do")).toBe("/workspace/doof-stdlib/fs/index.do");
    expect(resolver.resolve("std/fs/runtime", "/app/main.do")).toBe("/workspace/doof-stdlib/fs/runtime.do");
  });

  it("maps virtual stdlib paths through DOOF_STDLIB_ROOT", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "/workspace/doof-stdlib");

    const fs = withBundledStdlib(new VirtualFS({
      "/workspace/doof-stdlib/fs/index.do": "export const value = 1",
    }));

    expect(fs.readFile(`${BUNDLED_STDLIB_ROOT}/std/fs/index.do`)).toBe("export const value = 1");
    expect(fs.fileExists(`${BUNDLED_STDLIB_ROOT}/std/fs/index.do`)).toBe(true);
  });
});