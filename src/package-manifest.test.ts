import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOutputBinaryName, RealFS, runPipelineWithFs, writeProject } from "./cli-core.js";
import {
  createBuildProvenance,
  findDoofManifestPath,
  loadPackageGraph,
  mergePackageNativeBuild,
} from "./package-manifest.js";
import { VirtualFS } from "./test-helpers.js";

describe("doof manifest discovery", () => {
  it("finds the nearest doof.json above the entry file", () => {
    const fs = new VirtualFS({
      "/workspace/doof.json": JSON.stringify({ name: "workspace" }),
      "/workspace/src/app/main.do": "function main(): void {}",
    });

    expect(findDoofManifestPath(fs, "/workspace/src/app/main.do")).toBe("/workspace/doof.json");
  });

  it("rejects missing doof.json when running the CLI pipeline", () => {
    const fs = new VirtualFS({
      "/workspace/main.do": "function main(): void {}",
    });

    expect(() => runPipelineWithFs(
      fs,
      "/workspace/main.do",
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    )).toThrow("No doof.json found");
  });
});

describe("local package graphs", () => {
  it("loads local path dependencies recursively", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { path: "../deps/foo" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): void => println(value)',
      "/deps/foo/doof.json": JSON.stringify({
        name: "foo",
        dependencies: {
          bar: { path: "../bar" },
        },
      }),
      "/deps/foo/index.do": 'export { value } from "bar"',
      "/deps/bar/doof.json": JSON.stringify({ name: "bar" }),
      "/deps/bar/index.do": "export const value = 1",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.packages.map((pkg) => pkg.rootDir)).toEqual([
      "/app",
      "/deps/bar",
      "/deps/foo",
    ]);
    expect(graph.rootPackage.dependencyRoots.get("foo")).toBe("/deps/foo");
    const fooPackage = graph.packages.find((pkg) => pkg.rootDir === "/deps/foo");
    expect(fooPackage?.dependencyRoots.get("bar")).toBe("/deps/bar");
  });

  it("loads remote dependencies through a resolver hook and records provenance", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { url: "https://github.com/example/foo", version: "1.2.3" },
        },
      }),
      "/app/main.do": "function main(): void {}",
      "/cache/foo/doof.json": JSON.stringify({ name: "foo" }),
      "/cache/foo/index.do": "export const value = 1",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      resolveRemoteDependency(dependency, context) {
        expect(context.dependencyName).toBe("foo");
        expect(context.cacheRoot).toBe(path.join(os.homedir(), ".doof", "packages"));
        return {
          rootDir: "/cache/foo",
          provenance: {
            source: { kind: "git", url: dependency.url },
            version: dependency.version,
            resolvedCommit: "abc123",
            cacheKey: "git:https://github.com/example/foo#1.2.3",
          },
        };
      },
    });

    expect(graph.rootPackage.dependencyRoots.get("foo")).toBe("/cache/foo");
    expect(createBuildProvenance(graph)).toEqual({
      dependencies: [{
        source: { kind: "git", url: "https://github.com/example/foo" },
        version: "1.2.3",
        resolvedCommit: "abc123",
        cacheKey: "git:https://github.com/example/foo#1.2.3",
      }],
    });
  });

  it("materializes version-prefixed git tags for remote dependencies", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-remote-package-"));

    try {
      const repoDir = path.join(tempDir, "hello-doof-repo");
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(repoDir, "doof.json"), JSON.stringify({
        name: "hello-doof",
        version: "0.1.0",
        dependencies: {},
      }, null, 2));
      fs.writeFileSync(
        path.join(repoDir, "hello.do"),
        'export function say(): void {\n    println("Hello, Doof!")\n}\n',
      );
      execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "Doof Tests"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "doof-tests@example.com"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["tag", "v0.1"], { cwd: repoDir, stdio: "pipe" });
      const resolvedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: "pipe" })
        .toString()
        .trim();

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        dependencies: {
          "hello-doof": {
            url: repoDir,
            version: "0.1",
          },
        },
      }, null, 2));
      fs.writeFileSync(
        path.join(appDir, "main.do"),
        'import { say } from "hello-doof/hello"\n\nfunction main(): void {\n    say()\n}\n',
      );

      const cacheRoot = path.join(tempDir, "cache");
      const graph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"), { cacheRoot });
      const helloRoot = graph.rootPackage.dependencyRoots.get("hello-doof");

      expect(helloRoot).toBeTruthy();
      expect(helloRoot?.startsWith(cacheRoot)).toBe(true);
      expect(fs.existsSync(path.join(helloRoot!, "doof.json"))).toBe(true);
      expect(createBuildProvenance(graph)).toEqual({
        dependencies: [{
          source: { kind: "git", url: repoDir },
          version: "0.1",
          resolvedCommit,
          cacheKey: `git:${repoDir}#0.1`,
        }],
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the home-directory cache root by default", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { url: "https://github.com/example/foo", version: "1.2.3" },
        },
      }),
      "/app/main.do": "function main(): void {}",
      "/cache/foo/doof.json": JSON.stringify({ name: "foo" }),
    });

    let observedCacheRoot = "";
    loadPackageGraph(fs, "/app/main.do", {
      resolveRemoteDependency(_dependency, context) {
        observedCacheRoot = context.cacheRoot;
        return {
          rootDir: "/cache/foo",
          provenance: {
            source: { kind: "git", url: "https://github.com/example/foo" },
            version: "1.2.3",
            resolvedCommit: "abc123",
            cacheKey: "git:https://github.com/example/foo#1.2.3",
          },
        };
      },
    });

    expect(observedCacheRoot).toBe(path.join(os.homedir(), ".doof", "packages"));
  });

  it("normalizes and merges native build metadata transitively", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          native: {
            includePaths: ["./native/include"],
            linkLibraries: ["sqlite3", "appkit"],
            defines: ["APP=1"],
          },
        },
        dependencies: {
          foo: { path: "../deps/foo" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/deps/foo/doof.json": JSON.stringify({
        name: "foo",
        build: {
          native: {
            includePaths: ["./include"],
            sourceFiles: ["./bridge.cpp"],
            linkLibraries: ["sqlite3", "curl"],
            frameworks: ["Foundation"],
            compilerFlags: ["-O2"],
          },
        },
        dependencies: {
          bar: { path: "../bar" },
        },
      }),
      "/deps/foo/index.do": 'export { value } from "bar"',
      "/deps/bar/doof.json": JSON.stringify({
        name: "bar",
        build: {
          native: {
            includePaths: ["./headers"],
            sourceFiles: ["./bar.cpp"],
            libraryPaths: ["./lib"],
            linkLibraries: ["curl"],
            linkerFlags: ["-pthread"],
          },
        },
      }),
      "/deps/bar/index.do": "export const value = 1",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(mergePackageNativeBuild(graph)).toEqual({
      includePaths: ["/deps/bar/headers", "/deps/foo/include", "/app/native/include"],
      sourceFiles: ["/deps/bar/bar.cpp", "/deps/foo/bridge.cpp"],
      libraryPaths: ["/deps/bar/lib"],
      linkLibraries: ["curl", "sqlite3", "appkit"],
      frameworks: ["Foundation"],
      defines: ["APP=1"],
      compilerFlags: ["-O2"],
      linkerFlags: ["-pthread"],
    });
  });

  it("rejects native paths that escape the package root", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          native: {
            includePaths: ["../shared/include"],
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do")).toThrow("build.native.includePaths must stay within the package root");
  });
});

describe("manifest-derived pipeline metadata", () => {
  it("uses build.targetExecutableName for native output naming", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: { targetExecutableName: "demo-app" },
      }),
      "/app/main.do": "function main(): int => 0",
    });

    const result = runPipelineWithFs(
      fs,
      "/app/main.do",
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    expect(result.outputBinaryName).toBe(normalizeOutputBinaryName("demo-app"));
    expect(createBuildProvenance(loadPackageGraph(fs, "/app/main.do"))).toEqual({ dependencies: [] });
    expect(result.provenance).toEqual({ dependencies: [] });
  });

  it("propagates package native inputs into generated cmake and the build manifest", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          targetExecutableName: "demo-app",
          native: {
            linkLibraries: ["sqlite3"],
          },
        },
        dependencies: {
          foo: { path: "../deps/foo" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/deps/foo/doof.json": JSON.stringify({
        name: "foo",
        build: {
          native: {
            includePaths: ["./include"],
            sourceFiles: ["./bridge.cpp"],
            libraryPaths: ["./lib"],
            linkLibraries: ["curl"],
            frameworks: ["Foundation"],
            defines: ["FOO=1"],
            compilerFlags: ["-O2"],
            linkerFlags: ["-pthread"],
          },
        },
      }),
      "/deps/foo/index.do": "export const value = 1",
    });

    const result = runPipelineWithFs(
      fs,
      "/app/main.do",
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    expect(result.project.cmake).toContain("/deps/foo/include");
    expect(result.project.cmake).toContain("/deps/foo/bridge.cpp");
    expect(result.project.cmake).toContain("/deps/foo/lib");
    expect(result.project.cmake).toContain("curl");
    expect(result.project.cmake).toContain("Foundation");
    expect(result.project.cmake).toContain("FOO=1");
    expect(result.project.cmake).toContain("-O2");
    expect(result.project.cmake).toContain("-pthread");
    expect(result.buildManifest.outputBinaryName).toBe(normalizeOutputBinaryName("demo-app"));
    expect(result.buildManifest.nativeIncludePaths).toEqual(["/deps/foo/include"]);
    expect(result.buildManifest.nativeSourceFiles).toEqual(["/deps/foo/bridge.cpp"]);
    expect(result.buildManifest.libraryPaths).toEqual(["/deps/foo/lib"]);
    expect(result.buildManifest.linkLibraries).toEqual(["curl", "sqlite3"]);
    expect(result.buildManifest.frameworks).toEqual(["Foundation"]);
    expect(result.buildManifest.defines).toEqual(["FOO=1"]);
    expect(result.buildManifest.compilerFlags).toEqual(["-O2"]);
    expect(result.buildManifest.linkerFlags).toEqual(["-pthread"]);
    expect(result.buildManifest.packageRoots).toEqual(["/app", "/deps/foo"]);
  });

  it("writes doof-build.json for external build tools", () => {
    const virtualFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { path: "../deps/foo" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/deps/foo/doof.json": JSON.stringify({
        name: "foo",
        build: {
          native: {
            includePaths: ["./include"],
            sourceFiles: ["./bridge.cpp"],
          },
        },
      }),
      "/deps/foo/index.do": "export const value = 1",
    });

    const result = runPipelineWithFs(
      virtualFs,
      "/app/main.do",
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-build-manifest-"));
    try {
      writeProject(result.project, outDir, false, () => {}, result.provenance, result.buildManifest);

      const buildManifest = JSON.parse(
        fs.readFileSync(path.join(outDir, "doof-build.json"), "utf8"),
      ) as {
        outputDir: string;
        includePaths: string[];
        generatedSources: string[];
        generatedHeaders: string[];
        nativeSourceFiles: string[];
      };

      expect(buildManifest.outputDir).toBe(outDir);
      expect(buildManifest.includePaths).toEqual([outDir, "/deps/foo/include"]);
      expect(buildManifest.generatedSources).toContain("main.cpp");
      expect(buildManifest.generatedHeaders).toContain("main.hpp");
      expect(buildManifest.nativeSourceFiles).toEqual(["/deps/foo/bridge.cpp"]);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

function emptyNativeBuildOptions() {
  return {
    cppStd: "c++17",
    includePaths: [],
    libraryPaths: [],
    linkLibraries: [],
    frameworks: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
  };
}