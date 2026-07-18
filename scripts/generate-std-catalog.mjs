import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const stdlibRoot = path.resolve(process.env.DOOF_STDLIB_ROOT || path.join(repositoryRoot, "..", "doof-stdlib"));
const outputPath = path.resolve(process.env.DOOF_STD_CATALOG_OUTPUT || path.join(repositoryRoot, "selfhost", "std-catalog.json"));
const allowDirty = process.argv.includes("--allow-dirty");
const compilerVersion = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version;

function git(packageRoot, args) {
  return execFileSync("git", ["-C", packageRoot, ...args], { encoding: "utf8" }).trim();
}

function canonicalUrl(value) {
  let result = value.trim();
  while (result.endsWith("/")) result = result.slice(0, -1);
  if (result.endsWith(".git")) result = result.slice(0, -4);
  const match = result.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]+)(.*)$/i);
  if (match) result = `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3]}`;
  return result;
}

const packages = [];
for (const entry of fs.readdirSync(stdlibRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packageRoot = path.join(stdlibRoot, entry.name);
  const manifestPath = path.join(packageRoot, "doof.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("std/")) continue;
  if (manifest.name !== `std/${entry.name}`) {
    throw new Error(`${manifestPath} declares ${JSON.stringify(manifest.name)}; expected ${JSON.stringify(`std/${entry.name}`)}`);
  }
  if (!fs.existsSync(path.join(packageRoot, ".git"))) {
    throw new Error(`Standard package is not a Git checkout: ${packageRoot}`);
  }
  const dirty = git(packageRoot, ["status", "--porcelain"]);
  if (dirty && !allowDirty) {
    throw new Error(`Standard package checkout is dirty: ${packageRoot}`);
  }
  const url = canonicalUrl(git(packageRoot, ["remote", "get-url", "origin"]));
  const commit = git(packageRoot, ["rev-parse", "HEAD"]).toLowerCase();
  const ref = git(packageRoot, ["describe", "--tags", "--always"]);
  packages.push({ name: manifest.name, url, ref, version: manifest.version ?? "", commit });
}

packages.sort((left, right) => left.name.localeCompare(right.name));
const unsigned = { schemaVersion: 1, compilerVersion, packages };
const canonical = `${JSON.stringify(unsigned)}\n`;
const digest = createHash("sha256").update(canonical).digest("hex");
const catalog = { schemaVersion: 1, compilerVersion, digest, packages };
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${packages.length} standard packages to ${outputPath} (${digest})`);
