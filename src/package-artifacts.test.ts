import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPackagedExecutable, packageArchiveName, withReleaseBuildDefaults } from "./package-artifacts.js";

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
  });

  it("names platform archives with executable and version", () => {
    expect(packageArchiveName("DoofDemo", "1.2.3", "macos")).toBe("DoofDemo-1.2.3-macos.zip");
    expect(packageArchiveName("DoofDemo", "1.2.3", "ios")).toBe("DoofDemo-1.2.3-ios.ipa");
  });

  it("copies only the packaged executable into dist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-package-artifact-"));
    tempDirs.push(root);
    const binary = path.join(root, "build", "demo");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "new", "utf8");
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "keep.txt"), "keep", "utf8");

    const result = copyPackagedExecutable(binary, path.join(root, "dist"));
    expect(fs.readFileSync(result, "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(root, "dist", "keep.txt"), "utf8")).toBe("keep");
  });
});
