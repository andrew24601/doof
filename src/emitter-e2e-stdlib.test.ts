import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe as vitestDescribe, expect, it } from "vitest";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";
import { DOOF_STDLIB_ROOT_ENV } from "./std-packages.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
const previousStdlibRoot = process.env[DOOF_STDLIB_ROOT_ENV];

beforeAll(() => {
  process.env[DOOF_STDLIB_ROOT_ENV] = path.join(process.cwd(), "stdlib");
  ctx.setup();
});

afterAll(() => {
  if (previousStdlibRoot === undefined) {
    delete process.env[DOOF_STDLIB_ROOT_ENV];
  } else {
    process.env[DOOF_STDLIB_ROOT_ENV] = previousStdlibRoot;
  }
  ctx.cleanup();
});

function writeManifestProject(appName: string, mainSource: string): string {
  const appDir = path.join(ctx.tmpDir, appName);
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
    name: appName,
    version: "0.1.0",
    dependencies: {},
  }, null, 2));
  fs.writeFileSync(path.join(appDir, "main.do"), `${mainSource}\n`, "utf8");
  return path.join(appDir, "main.do");
}

describe("e2e — std/log", () => {
  it("drops entries before setLogger is called", () => {
    const entryPath = writeManifestProject("std-log-noop", [
      `import { info, warn } from "std/log"`,
      ``,
      `function main(): void {`,
      `  info("Server started", { "port": 8080 })`,
      `  warn("Disk usage high", { "percent": 91 })`,
      `}`,
    ].join("\n"));
    const result = ctx.compileAndRunManifestProject(entryPath);

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  it("writes RollingFileLogger output to disk", () => {
    const entryPath = writeManifestProject("std-log-file", [
      `import { readText } from "std/fs"`,
      `import { LogLevel, RollingFileLogger, info, setLogger } from "std/log"`,
      ``,
      `function main(): void {`,
      `  setLogger(RollingFileLogger("app.log", LogLevel.Debug))`,
      `  info("Saved", { "id": 7 })`,
      `  print(try! readText("app.log"))`,
      `}`,
    ].join("\n"));
    const result = ctx.compileAndRunManifestProject(entryPath);

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[INFO \] Saved id=7 source=.*:6/);
    expect(result.stderr.trim()).toBe("");
  });
});