import { afterEach, describe, expect, it, vi } from "vitest";

const { mainMock } = vi.hoisted(() => ({
  mainMock: vi.fn(),
}));

vi.mock("./cli.js", () => ({
  main: mainMock,
}));

afterEach(() => {
  mainMock.mockClear();
  vi.resetModules();
});

describe("CLI bin entry", () => {
  it("invokes the CLI main function when loaded by a package-manager shim", async () => {
    await import("./bin.js");

    expect(mainMock).toHaveBeenCalledTimes(1);
    expect(mainMock).toHaveBeenCalledWith();
  });
});