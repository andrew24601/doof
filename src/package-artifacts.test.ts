import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyExecutableResources,
  copyPackagedExecutable,
  packageArchiveName,
  withReleaseBuildDefaults,
} from "./package-artifacts.js";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("release package artifacts", () => {
  it("adds release defaults before user compiler settings", () => {
    const base = {
      cppStd: "c++17", includePaths: [], libraryPaths: [], linkLibraries: [], frameworks: [],
      pkgConfigPackages: [], sourceFiles: [], objectFiles: [], compilerFlags: ["-O0"], linkerFlags: [], defines: ["CUSTOM"],
    };
    expect(withReleaseBuildDefaults(base, "gcc-like").compilerFlags).toEqual(["-O2", "-O0"]);
    expect(withReleaseBuildDefaults(base, "gcc-like").defines).toEqual(["NDEBUG", "CUSTOM"]);
    expect(withReleaseBuildDefaults({ ...base, compilerFlags: [] }, "msvc").compilerFlags).toEqual(["/O2"]);
    expect(withReleaseBuildDefaults({ ...base, compilerFlags: [] }, "emscripten").compilerFlags).toEqual([]);
    expect(withReleaseBuildDefaults({ ...base, compilerFlags: [] }, "emscripten").defines).toEqual(["NDEBUG", "CUSTOM"]);
  });

  it("names platform archives with executable and version", () => {
    expect(packageArchiveName("DoofDemo", "1.2.3", "macos")).toBe("DoofDemo-1.2.3-macos.zip");
    expect(packageArchiveName("DoofDemo", "1.2.3", "ios")).toBe("DoofDemo-1.2.3-ios.ipa");
  });

  it("copies packaged executable resources into dist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-package-artifact-"));
    tempDirs.push(root);
    const binary = path.join(root, "build", "demo");
    const assetsDir = path.join(root, "assets");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(binary, "new", "utf8");
    fs.writeFileSync(path.join(assetsDir, "logo.txt"), "logo", "utf8");
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "keep.txt"), "keep", "utf8");

    const result = copyPackagedExecutable(binary, path.join(root, "dist"), [
      { fromPattern: path.join(assetsDir, "*"), destination: "assets" },
    ]);
    expect(fs.readFileSync(result, "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(root, "dist", "assets", "logo.txt"), "utf8")).toBe("logo");
    expect(fs.readFileSync(path.join(root, "dist", "keep.txt"), "utf8")).toBe("keep");
  });

  it("copies executable resources into the build output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-build-resource-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "images", "cards"), { recursive: true });
    fs.writeFileSync(path.join(root, "images", "card.txt"), "card", "utf8");
    fs.writeFileSync(path.join(root, "images", "cards", "ace.txt"), "ace", "utf8");

    copyExecutableResources([
      { fromPattern: path.join(root, "images"), destination: "images" },
    ], path.join(root, "build"));

    expect(fs.readFileSync(path.join(root, "build", "images", "card.txt"), "utf8")).toBe("card");
    expect(fs.readFileSync(path.join(root, "build", "images", "cards", "ace.txt"), "utf8")).toBe("ace");
  });

  it("preserves recursive glob resource paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-build-resource-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "images", "cards"), { recursive: true });
    fs.writeFileSync(path.join(root, "images", "cards", "ace.txt"), "ace", "utf8");

    copyExecutableResources([
      { fromPattern: path.join(root, "images", "**"), destination: "assets" },
    ], path.join(root, "build"));

    expect(fs.readFileSync(path.join(root, "build", "assets", "cards", "ace.txt"), "utf8")).toBe("ace");
  });

  it("rejects duplicate executable resource destinations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-build-resource-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "left"), { recursive: true });
    fs.mkdirSync(path.join(root, "right"), { recursive: true });
    fs.writeFileSync(path.join(root, "left", "same.txt"), "left", "utf8");
    fs.writeFileSync(path.join(root, "right", "same.txt"), "right", "utf8");

    expect(() => copyExecutableResources([
      { fromPattern: path.join(root, "left", "*"), destination: "assets" },
      { fromPattern: path.join(root, "right", "*"), destination: "assets" },
    ], path.join(root, "build"))).toThrow("Duplicate executable resource destination");
  });

  it("rejects executable resources that would overwrite the binary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-package-artifact-"));
    tempDirs.push(root);
    const binary = path.join(root, "build", "demo");
    const assetsDir = path.join(root, "assets");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(binary, "new", "utf8");
    fs.writeFileSync(path.join(assetsDir, "demo"), "asset", "utf8");

    expect(() => copyPackagedExecutable(binary, path.join(root, "dist"), [
      { fromPattern: path.join(assetsDir, "*"), destination: "" },
    ])).toThrow("Duplicate executable resource destination");
  });
});
