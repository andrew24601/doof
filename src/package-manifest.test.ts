import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOutputBinaryName, RealFS, runPipelineWithFs, writeProject } from "./cli-core.js";
import {
  createBuildProvenance,
  createPackageOutputPaths,
  findDoofManifestPath,
  loadPackageGraph,
  mergePackageNativeBuild,
  resolvePackageBuildContext,
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

  it("finds doof.json when starting from a package directory", () => {
    const fs = new VirtualFS({
      "/workspace/app/doof.json": JSON.stringify({ name: "app" }),
      "/workspace/app/main.do": "function main(): void {}",
    });

    expect(findDoofManifestPath(fs, "/workspace/app")).toBe("/workspace/app/doof.json");
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

describe("manifest build defaults", () => {
  it("defaults package entry and build output under the package root", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({ name: "app" }),
      "/app/main.do": "function main(): void {}",
    });

    expect(resolvePackageBuildContext(fs, "/app")).toMatchObject({
      rootDir: "/app",
      manifestPath: "/app/doof.json",
      entryPath: "/app/main.do",
      buildDir: "/app/build",
    });
  });

  it("resolves build.entry and build.buildDir relative to the package root", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          entry: "src/demo.do",
          buildDir: "dist/native",
        },
      }),
      "/app/src/demo.do": "function main(): void {}",
    });

    expect(resolvePackageBuildContext(fs, "/app")).toMatchObject({
      entryPath: "/app/src/demo.do",
      buildDir: "/app/dist/native",
    });
  });

  it("rejects build.entry paths that escape the package root", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          entry: "../main.do",
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => resolvePackageBuildContext(fs, "/app"))
      .toThrow("build.entry must stay within the package root");
  });

  it("rejects build.buildDir paths that escape the package root", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          buildDir: "../build",
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => resolvePackageBuildContext(fs, "/app"))
      .toThrow("build.buildDir must stay within the package root");
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

  it("accepts dependency names that include slashes", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          "std/fs": { path: "../deps/std-fs" },
        },
      }),
      "/app/main.do": 'import { writeText } from "std/fs"\nfunction main(): void => writeText("out.txt", "ok")',
      "/deps/std-fs/doof.json": JSON.stringify({ name: "std/fs" }),
      "/deps/std-fs/index.do": "export function writeText(path: string, value: string): void {}",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.dependencyRoots.get("std/fs")).toBe("/deps/std-fs");
  });

  it("injects implicit std dependencies when a package does not declare them", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {},
      }),
      "/app/main.do": 'import { writeText } from "std/fs"\nfunction main(): void => writeText("out.txt", "ok")',
      "/cache/std-fs/doof.json": JSON.stringify({ name: "std/fs" }),
      "/cache/std-fs/index.do": "export function writeText(path: string, value: string): void {}",
      "/cache/std-path/doof.json": JSON.stringify({ name: "std/path" }),
      "/cache/std-path/index.do": "export function join(parts: string[]): string => \"\"",
      "/cache/std-assert/doof.json": JSON.stringify({ name: "std/assert" }),
      "/cache/std-assert/index.do": "export class Assert {}",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      implicitStdDependencies: true,
      resolveRemoteDependency(dependency, context) {
        if (context.dependencyName === "std/fs") {
          return {
            rootDir: "/cache/std-fs",
            package: {
              kind: "git",
              url: dependency.url,
              version: dependency.version,
              commit: "fs-commit",
              pathSegments: ["doof-lang", "fs"],
            },
          };
        }
        if (context.dependencyName === "std/path") {
          return {
            rootDir: "/cache/std-path",
            package: {
              kind: "git",
              url: dependency.url,
              version: dependency.version,
              commit: "path-commit",
              pathSegments: ["doof-lang", "path"],
            },
          };
        }
        if (context.dependencyName === "std/assert") {
          return {
            rootDir: "/cache/std-assert",
            package: {
              kind: "git",
              url: dependency.url,
              version: dependency.version,
              commit: "assert-commit",
              pathSegments: ["doof-lang", "assert"],
            },
          };
        }

        throw new Error(`unexpected dependency ${context.dependencyName}`);
      },
    });

    expect(graph.rootPackage.dependencyRoots.get("std/fs")).toBe("/cache/std-fs");
  });

  it("rejects dependency names with empty or traversal path segments", () => {
    const emptySegmentFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          "std//fs": { path: "../deps/std-fs" },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(emptySegmentFs, "/app/main.do"))
      .toThrow('invalid dependency name "std//fs"');

    const traversalFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          "foo/../bar": { path: "../deps/bar" },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(traversalFs, "/app/main.do"))
      .toThrow('invalid dependency name "foo/../bar"');
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
          package: {
            kind: "git",
            url: dependency.url,
            version: dependency.version,
            commit: "abc123",
            pathSegments: ["example", "foo"],
          },
        };
      },
    });

    expect(graph.rootPackage.dependencyRoots.get("foo")).toBe("/cache/foo");
    expect(createBuildProvenance(graph)).toEqual({
      dependencies: [{
        kind: "git",
        url: "https://github.com/example/foo",
        version: "1.2.3",
        commit: "abc123",
        referencedFrom: ["."],
      }],
    });
    expect(createPackageOutputPaths(graph, "/app/main.do").byRootDir.get("/cache/foo")).toBe(".packages/example/foo");
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
      expect(path.basename(helloRoot ?? "")).toBe(resolvedCommit);
      expect(fs.existsSync(path.join(helloRoot!, "doof.json"))).toBe(true);
      const versionsPath = path.join(path.dirname(helloRoot!), "versions.json");
      expect(fs.existsSync(versionsPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(versionsPath, "utf8"))).toMatchObject({
        schemaVersion: 1,
        kind: "git",
        url: repoDir,
        versions: {
          "0.1": {
            commit: resolvedCommit,
            resolvedRef: "v0.1",
          },
        },
      });
      expect(createBuildProvenance(graph)).toEqual({
        dependencies: [{
          kind: "git",
          url: repoDir,
          version: "0.1",
          commit: resolvedCommit,
          referencedFrom: ["."],
        }],
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses versions.json to materialize a cached version without resolving tags again", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-remote-package-cache-"));

    try {
      const repoDir = path.join(tempDir, "hello-doof-repo");
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(repoDir, "doof.json"), JSON.stringify({ name: "hello-doof", dependencies: {} }, null, 2));
      fs.writeFileSync(path.join(repoDir, "hello.do"), "export const value = 1\n");
      execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "Doof Tests"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "doof-tests@example.com"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["tag", "v0.1"], { cwd: repoDir, stdio: "pipe" });

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        dependencies: { "hello-doof": { url: repoDir, version: "0.1" } },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), 'import { value } from "hello-doof/hello"\nfunction main(): int => value\n');

      const cacheRoot = path.join(tempDir, "cache");
      const firstGraph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"), { cacheRoot });
      const firstRoot = firstGraph.rootPackage.dependencyRoots.get("hello-doof");
      expect(firstRoot).toBeTruthy();

      execFileSync("git", ["tag", "-d", "v0.1"], { cwd: repoDir, stdio: "pipe" });
      fs.rmSync(firstRoot!, { recursive: true, force: true });

      const secondGraph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"), { cacheRoot });
      const secondRoot = secondGraph.rootPackage.dependencyRoots.get("hello-doof");
      expect(secondRoot).toBeTruthy();
      expect(path.basename(secondRoot ?? "")).toBe(path.basename(firstRoot ?? ""));
      expect(fs.existsSync(path.join(secondRoot!, "doof.json"))).toBe(true);
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
          package: {
            kind: "git",
            url: "https://github.com/example/foo",
            version: "1.2.3",
            commit: "abc123",
            pathSegments: ["example", "foo"],
          },
        };
      },
    });

    expect(observedCacheRoot).toBe(path.join(os.homedir(), ".doof", "packages"));
  });

  it("selects a single remote package version per owner/repo before finalizing the graph", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { url: "https://github.com/example/foo", version: "1.0.0" },
          bar: { path: "../deps/bar" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/deps/bar/doof.json": JSON.stringify({
        name: "bar",
        dependencies: {
          foo: { url: "https://github.com/example/foo", version: "2.0.0" },
        },
      }),
      "/deps/bar/index.do": "export const value = 1",
      "/cache/foo-v1/doof.json": JSON.stringify({ name: "foo" }),
      "/cache/foo-v1/index.do": "export const value = 1",
      "/cache/foo-v2/doof.json": JSON.stringify({ name: "foo" }),
      "/cache/foo-v2/index.do": "export const value = 2",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      resolveRemoteDependency(dependency) {
        return dependency.version === "1.0.0"
          ? {
            rootDir: "/cache/foo-v1",
            package: {
              kind: "git",
              url: dependency.url,
              version: dependency.version,
              commit: "1111111",
              pathSegments: ["example", "foo"],
            },
          }
          : {
            rootDir: "/cache/foo-v2",
            package: {
              kind: "git",
              url: dependency.url,
              version: dependency.version,
              commit: "2222222",
              pathSegments: ["example", "foo"],
            },
          };
      },
    });

    expect(graph.rootPackage.dependencyRoots.get("foo")).toBe("/cache/foo-v2");
    const barPackage = graph.packages.find((pkg) => pkg.rootDir === "/deps/bar");
    expect(barPackage?.dependencyRoots.get("foo")).toBe("/cache/foo-v2");
    expect(graph.packages.map((pkg) => pkg.rootDir)).not.toContain("/cache/foo-v1");
    expect(createBuildProvenance(graph)).toEqual({
      dependencies: [{
        kind: "git",
        url: "https://github.com/example/foo",
        version: "2.0.0",
        commit: "2222222",
        referencedFrom: ["."],
      }],
    });
  });

  it("records transitive remote provenance using the referencer package URL", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {
          foo: { url: "https://github.com/example/foo", version: "1.0.0" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/cache/foo/doof.json": JSON.stringify({
        name: "foo",
        dependencies: {
          bar: { url: "https://github.com/example/bar", version: "1.5.0" },
        },
      }),
      "/cache/foo/index.do": 'export { value } from "bar"',
      "/cache/bar/doof.json": JSON.stringify({ name: "bar" }),
      "/cache/bar/index.do": "export const value = 1",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      resolveRemoteDependency(dependency) {
        if (dependency.url.endsWith("/foo")) {
          return {
            rootDir: "/cache/foo",
            package: {
              kind: "git",
              url: dependency.url,
              version: "1.0.0",
              commit: "foo-commit",
              pathSegments: ["example", "foo"],
            },
          };
        }

        return {
          rootDir: "/cache/bar",
          package: {
            kind: "git",
            url: dependency.url,
            version: "1.5.0",
            commit: "bar-commit",
            pathSegments: ["example", "bar"],
          },
        };
      },
    });

    expect(createBuildProvenance(graph)).toEqual({
      dependencies: [
        {
          kind: "git",
          url: "https://github.com/example/bar",
          version: "1.5.0",
          commit: "bar-commit",
          referencedFrom: ["https://github.com/example/foo"],
        },
        {
          kind: "git",
          url: "https://github.com/example/foo",
          version: "1.0.0",
          commit: "foo-commit",
          referencedFrom: ["."],
        },
      ],
    });
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
      extraCopyPaths: [],
      linkLibraries: ["curl", "sqlite3", "appkit"],
      frameworks: ["Foundation"],
      pkgConfigPackages: [],
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
            extraCopyPaths: ["../shared/include"],
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do")).toThrow("build.native.extraCopyPaths must stay within the package root");
  });

  it("applies platform-scoped native build metadata for the current host", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          native: {
            includePaths: ["./shared"],
            macos: {
              sourceFiles: ["./native.mm"],
              pkgConfigPackages: ["sdl3"],
              frameworks: ["Cocoa"],
            },
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/shared/dummy.hpp": "",
      "/app/native.mm": "",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.nativeBuild.includePaths).toEqual(["/app/shared"]);
    if (process.platform === "darwin") {
      expect(graph.rootPackage.nativeBuild.sourceFiles).toEqual(["/app/native.mm"]);
      expect(graph.rootPackage.nativeBuild.pkgConfigPackages).toEqual(["sdl3"]);
      expect(graph.rootPackage.nativeBuild.frameworks).toEqual(["Cocoa"]);
    } else {
      expect(graph.rootPackage.nativeBuild.sourceFiles).toEqual([]);
      expect(graph.rootPackage.nativeBuild.pkgConfigPackages).toEqual([]);
      expect(graph.rootPackage.nativeBuild.frameworks).toEqual([]);
    }
  });

  it("normalizes macos-app target metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofSolitaire",
          macosApp: {
            bundleId: "dev.doof.solitaire",
            displayName: "Doof Solitaire",
            version: "1.0",
            icon: "./app-icon.svg",
            resources: [
              { from: "images/*", to: "images" },
            ],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "dev.doof.solitaire",
        displayName: "Doof Solitaire",
        version: "1.0",
        iconPath: "/app/app-icon.svg",
        resources: [{ fromPattern: "/app/images/*", destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("treats bare build paths as package-root relative", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofDemo",
          native: {
            includePaths: ["native/include"],
            sourceFiles: ["native/bridge.cpp"],
            libraryPaths: ["native/lib"],
            extraCopyPaths: ["native/assets"],
          },
          macosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Demo",
            version: "1.0",
            icon: "app-icon.svg",
            resources: [{ from: "images/*", to: "images" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.nativeBuild.includePaths).toEqual(["/app/native/include"]);
    expect(graph.rootPackage.nativeBuild.sourceFiles).toEqual(["/app/native/bridge.cpp"]);
    expect(graph.rootPackage.nativeBuild.libraryPaths).toEqual(["/app/native/lib"]);
    expect(graph.rootPackage.nativeBuild.extraCopyPaths).toEqual(["/app/native/assets"]);
    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "dev.doof.demo",
        displayName: "Demo",
        version: "1.0",
        iconPath: "/app/app-icon.svg",
        resources: [{ fromPattern: "/app/images/*", destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("requires an executable name for macos-app targets", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          macosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Demo",
            version: "1.0",
            icon: "./app-icon.svg",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow('build.targetExecutableName is required when build.target is "macos-app"');
  });

  it("rejects macos-app resource destinations that escape the bundle", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofDemo",
          macosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Demo",
            version: "1.0",
            icon: "./app-icon.svg",
            resources: [{ from: "images/*", to: "../oops" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
      "/app/images/card.png": "png",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.macosApp.resources[0].to bundle resource destinations must stay within Contents/Resources");
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

  it("propagates package native inputs into runtime build metadata", () => {
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

    expect(result.nativeBuild.includePaths).toEqual(["/deps/foo/include"]);
    expect(result.nativeBuild.sourceFiles).toEqual(["/deps/foo/bridge.cpp"]);
    expect(result.nativeBuild.libraryPaths).toEqual(["/deps/foo/lib"]);
    expect(result.nativeBuild.linkLibraries).toEqual(["curl", "sqlite3"]);
    expect(result.nativeBuild.frameworks).toEqual(["Foundation"]);
    expect(result.nativeBuild.defines).toEqual(["FOO=1"]);
    expect(result.nativeBuild.compilerFlags).toEqual(["-O2"]);
    expect(result.nativeBuild.linkerFlags).toEqual(["-pthread"]);
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

  it("writes doof-build.json for external build tools using copied package-native paths", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-build-manifest-real-"));
    const appDir = path.join(workspaceDir, "app");
    const depDir = path.join(workspaceDir, "deps", "foo");
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(path.join(depDir, "include"), { recursive: true });
    fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
      name: "app",
      dependencies: {
        foo: { path: "../deps/foo" },
      },
    }, null, 2));
    fs.writeFileSync(path.join(appDir, "main.do"), 'import { value } from "foo"\nfunction main(): int => value\n');
    fs.writeFileSync(path.join(depDir, "doof.json"), JSON.stringify({
      name: "foo",
      build: {
        native: {
          includePaths: ["./include"],
          sourceFiles: ["./bridge.cpp"],
        },
      },
    }, null, 2));
    fs.writeFileSync(path.join(depDir, "index.do"), "export const value = 1\n");
    fs.writeFileSync(path.join(depDir, "include", "foo.hpp"), "#pragma once\n", "utf8");
    fs.writeFileSync(path.join(depDir, "bridge.cpp"), "int doof_bridge() { return 0; }\n", "utf8");

    const result = runPipelineWithFs(
      new RealFS(),
      path.join(appDir, "main.do"),
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
      expect(buildManifest.includePaths).toEqual([outDir, path.join(outDir, "deps", "foo", "include")]);
      expect(buildManifest.generatedSources).toContain("main.cpp");
      expect(buildManifest.generatedHeaders).toContain("main.hpp");
      expect(buildManifest.nativeSourceFiles).toEqual([path.join(outDir, "deps", "foo", "bridge.cpp")]);
      expect(fs.readFileSync(path.join(outDir, "deps", "foo", "include", "foo.hpp"), "utf8")).toBe("#pragma once\n");
      expect(fs.readFileSync(path.join(outDir, "deps", "foo", "bridge.cpp"), "utf8")).toBe(
        "int doof_bridge() { return 0; }\n",
      );
      expect(fs.existsSync(path.join(outDir, "CMakeLists.txt"))).toBe(false);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("copies package-owned native headers into the emitted package tree", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-package-copy-"));
    const appDir = path.join(workspaceDir, "app");
    const depDir = path.join(workspaceDir, "deps", "fs");
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
      name: "app",
      dependencies: {
        fs: { path: "../deps/fs" },
      },
    }, null, 2));
    fs.writeFileSync(path.join(appDir, "main.do"), 'import { readText } from "fs"\nfunction main(): int => 0\n');
    fs.writeFileSync(path.join(depDir, "doof.json"), JSON.stringify({
      name: "fs",
      build: {
        native: {
          includePaths: ["."],
        },
      },
    }, null, 2));
    fs.writeFileSync(path.join(depDir, "index.do"), 'export { readText } from "./runtime"\n');
    fs.writeFileSync(path.join(depDir, "runtime.do"), [
      'import { IoError } from "./types"',
      'export import function readText(path: string): Result<string, IoError> from "native_fs.hpp" as doof_fs::readText',
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(depDir, "types.do"), "export enum IoError { Other }\n");
    fs.writeFileSync(path.join(depDir, "native_fs.hpp"), '#pragma once\n#include "types.hpp"\n', "utf8");

    const result = runPipelineWithFs(
      new RealFS(),
      path.join(appDir, "main.do"),
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    const runtimeModule = result.project.modules.find((mod) => mod.modulePath === path.join(depDir, "runtime.do"));
    expect(runtimeModule?.hppCode).toContain('#include "native_fs.hpp"');
    expect(result.project.supportFiles).toEqual([]);
    expect(result.project.outputNativeCopies).toContainEqual({
      sourcePath: depDir,
      relativePath: path.join("deps", "fs").replace(/\\/g, "/"),
      kind: "directory",
    });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-package-copy-out-"));
    try {
      writeProject(result.project, outDir, false, () => {}, result.provenance, result.buildManifest);
      expect(fs.readFileSync(path.join(outDir, "deps", "fs", "native_fs.hpp"), "utf8")).toBe(
        '#pragma once\n#include "types.hpp"\n',
      );
      expect(fs.readFileSync(path.join(outDir, "deps", "fs", "runtime.do"), "utf8")).toContain('from "native_fs.hpp"');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("emits bundle-aware metadata and support files for macos-app targets", () => {
    const virtualFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofSolitaire",
          native: {
            frameworks: ["Cocoa", "Foundation"],
          },
          macosApp: {
            bundleId: "dev.doof.solitaire",
            displayName: "Doof Solitaire",
            version: "1.0",
            icon: "./app-icon.svg",
            resources: [{ from: "images/*", to: "images" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
      "/app/images/card.png": "png",
    });

    const result = runPipelineWithFs(
      virtualFs,
      "/app/main.do",
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    expect(result.buildTarget?.kind).toBe("macos-app");
    expect(result.project.supportFiles.map((file) => file.relativePath)).toEqual([
      "Info.plist",
      "generate-macos-icon.sh",
    ]);
    expect(result.project.supportFiles[0]?.content).toContain("dev.doof.solitaire");
    expect(result.buildManifest.buildTarget?.kind).toBe("macos-app");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-macos-app-"));
    try {
      writeProject(result.project, outDir, false, () => {}, result.provenance, result.buildManifest);

      const buildManifest = JSON.parse(fs.readFileSync(path.join(outDir, "doof-build.json"), "utf8")) as {
        schemaVersion: number;
        buildTarget: { kind: string; config: { iconPath: string } } | null;
      };
      expect(buildManifest.schemaVersion).toBe(2);
      expect(buildManifest.buildTarget?.kind).toBe("macos-app");
      expect(buildManifest.buildTarget?.config.iconPath).toBe("/app/app-icon.svg");
      expect(fs.readFileSync(path.join(outDir, "Info.plist"), "utf8")).toContain("dev.doof.solitaire");
      expect(fs.statSync(path.join(outDir, "generate-macos-icon.sh")).mode & 0o111).not.toBe(0);
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
    pkgConfigPackages: [],
    sourceFiles: [],
    objectFiles: [],
    compilerFlags: [],
    linkerFlags: [],
    defines: [],
  };
}