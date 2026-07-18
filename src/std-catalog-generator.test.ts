import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createPackage(stdlibRoot: string, directoryName: string, manifestName = `std/${directoryName}`): string {
  const packageRoot = path.join(stdlibRoot, directoryName);
  fs.mkdirSync(packageRoot, { recursive: true });
  git(packageRoot, "init");
  fs.writeFileSync(path.join(packageRoot, "doof.json"), JSON.stringify({ name: manifestName, version: "1.0.0" }));
  git(packageRoot, "add", "doof.json");
  git(packageRoot, "-c", "user.name=Doof Test", "-c", "user.email=doof@example.test", "commit", "-m", "fixture");
  git(packageRoot, "remote", "add", "origin", `https://EXAMPLE.com/${directoryName}.git`);
  return packageRoot;
}

describe("std catalog generator", () => {
  it("discovers std packages and writes deterministic exact coordinates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-std-catalog-"));
    temporaryRoots.push(root);
    const stdlibRoot = path.join(root, "stdlib");
    fs.mkdirSync(stdlibRoot);
    const beta = createPackage(stdlibRoot, "beta");
    const alpha = createPackage(stdlibRoot, "alpha");
    createPackage(stdlibRoot, "sample", "sample");
    const output = path.join(root, "catalog.json");
    const env = { ...process.env, DOOF_STDLIB_ROOT: stdlibRoot, DOOF_STD_CATALOG_OUTPUT: output };

    execFileSync(process.execPath, ["scripts/generate-std-catalog.mjs"], { cwd: process.cwd(), env });
    const first = fs.readFileSync(output, "utf8");
    execFileSync(process.execPath, ["scripts/generate-std-catalog.mjs"], { cwd: process.cwd(), env });
    expect(fs.readFileSync(output, "utf8")).toBe(first);

    const catalog = JSON.parse(first);
    expect(catalog.packages.map((entry: any) => entry.name)).toEqual(["std/alpha", "std/beta"]);
    expect(catalog.packages[0]).toMatchObject({
      url: "https://example.com/alpha",
      commit: git(alpha, "rev-parse", "HEAD").toLowerCase(),
    });
    expect(catalog.packages[1].commit).toBe(git(beta, "rev-parse", "HEAD").toLowerCase());
    expect(catalog.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects dirty and misnamed standard-package repositories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-std-catalog-invalid-"));
    temporaryRoots.push(root);
    const stdlibRoot = path.join(root, "stdlib");
    fs.mkdirSync(stdlibRoot);
    const dirty = createPackage(stdlibRoot, "dirty");
    fs.writeFileSync(path.join(dirty, "untracked.txt"), "dirty");
    const output = path.join(root, "catalog.json");
    const result = spawnSync(process.execPath, ["scripts/generate-std-catalog.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DOOF_STDLIB_ROOT: stdlibRoot, DOOF_STD_CATALOG_OUTPUT: output },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checkout is dirty");

    fs.rmSync(dirty, { recursive: true, force: true });
    createPackage(stdlibRoot, "wrong", "std/other");
    const mismatched = spawnSync(process.execPath, ["scripts/generate-std-catalog.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DOOF_STDLIB_ROOT: stdlibRoot, DOOF_STD_CATALOG_OUTPUT: output },
      encoding: "utf8",
    });
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("expected \"std/wrong\"");
  });
});
