import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOutputBinaryName, RealFS, runPipelineWithFs, writeProject } from "./cli-core.js";
import {
  createBuildProvenance,
  createPackageOutputPaths,
  findDoofManifestPath,
  loadPackageGraph,
  mergePackageNativeBuild,
  narrowPackageGraphForBuild,
  resolvePackageBuildContext,
  resolvePackageReleaseConfig,
} from "./package-manifest.js";
import { DEFAULT_STD_VERSIONS, DOOF_STDLIB_ROOT_ENV } from "./std-packages.js";
import { VirtualFS } from "./test-helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  it("normalizes app-owned embedded libraries for each Apple target", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          macosApp: {
            embeddedLibraries: [{ library: "SDL3" }, { path: "vendor/Foo.framework" }],
          },
          iosApp: {
            embeddedLibraries: [{ path: "vendor/Bar.framework" }],
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(loadPackageGraph(fs, "/app/main.do").rootPackage.buildTarget?.config.embeddedLibraries).toEqual([
      { library: "SDL3" },
      { path: "/app/vendor/Foo.framework" },
    ]);
    expect(loadPackageGraph(fs, "/app/main.do", { buildTargetOverride: "ios-app" })
      .rootPackage.buildTarget?.config.embeddedLibraries).toEqual([
      { path: "/app/vendor/Bar.framework" },
    ]);
  });

  it("rejects malformed or escaping embedded library declarations", () => {
    const manifest = (embeddedLibraries: unknown) => new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: { target: "macos-app", macosApp: { embeddedLibraries } },
      }),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(manifest([{}]), "/app/main.do")).toThrow("exactly one of library or path");
    expect(() => loadPackageGraph(
      manifest([{ library: "SDL3", path: "vendor/libSDL3.dylib" }]),
      "/app/main.do",
    )).toThrow("exactly one of library or path");
    expect(() => loadPackageGraph(manifest([{ path: "../libBad.dylib" }]), "/app/main.do"))
      .toThrow("must stay within the package root");
  });

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

  it("parses and resolves release package settings", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          package: {
            distDir: "artifacts",
            macos: { signing: "ad-hoc", sandbox: true, entitlements: "release.entitlements" },
            ios: { identity: "Apple Distribution: Example", provisioningProfile: "profiles/app.mobileprovision" },
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });
    const context = resolvePackageBuildContext(fs, "/app");

    expect(resolvePackageReleaseConfig(context)).toEqual({
      distDir: "/app/artifacts",
      macos: { signing: "ad-hoc", sandbox: true, entitlements: "/app/release.entitlements" },
      ios: { identity: "Apple Distribution: Example", provisioningProfile: "/app/profiles/app.mobileprovision" },
    });
  });

  it("rejects invalid package signing settings", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({ name: "app", build: { package: { macos: { signing: "mystery" } } } }),
      "/app/main.do": "function main(): void {}",
    });
    expect(() => resolvePackageBuildContext(fs, "/app")).toThrow("build.package.macos.signing");
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

  it("parses external dependencies, acquires them before native build normalization, and records provenance", () => {
    const calls: string[] = [];
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        externalDependencies: {
          curl: {
            kind: "archive",
            url: "https://example.com/curl.tar.gz",
            sha256: "a".repeat(64),
            destination: "vendor/curl",
          },
          quickjs: {
            kind: "git",
            url: "https://github.com/quickjs-ng/quickjs.git",
            ref: "v0.14.0",
            commit: "b".repeat(40),
            destination: "vendor/quickjs",
          },
        },
        build: {
          native: {
            includePaths: ["vendor/curl/include", "vendor/quickjs"],
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      acquireExternalDependency(dependencyName, dependency, context) {
        calls.push(`${dependencyName}:${dependency.kind}:${context.packageRootDir}`);
      },
    });

    expect(calls).toEqual(["curl:archive:/app", "quickjs:git:/app"]);
    expect(graph.rootPackage.manifest.externalDependencies.curl).toMatchObject({
      kind: "archive",
      stripComponents: 1,
    });
    expect(graph.rootPackage.nativeBuild.includePaths).toEqual([
      "/app/vendor/curl/include",
      "/app/vendor/quickjs",
    ]);
    expect(createBuildProvenance(graph)).toEqual({
      dependencies: [],
      externalDependencies: [
        {
          name: "curl",
          kind: "archive",
          url: "https://example.com/curl.tar.gz",
          destination: "vendor/curl",
          sha256: "a".repeat(64),
          referencedFrom: ["."],
        },
        {
          name: "quickjs",
          kind: "git",
          url: "https://github.com/quickjs-ng/quickjs.git",
          destination: "vendor/quickjs",
          ref: "v0.14.0",
          commit: "b".repeat(40),
          referencedFrom: ["."],
        },
      ],
    });
  });

  it("rejects invalid external dependency declarations", () => {
    const baseManifest = {
      name: "app",
      externalDependencies: {
        bad: {
          kind: "archive",
          url: "https://example.com/archive.txt",
          sha256: "a".repeat(64),
          destination: "vendor/bad",
        },
      },
    };
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify(baseManifest),
      "/app/main.do": "function main(): void {}",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("externalDependencies.bad.url must end with");

    const missingShaFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        externalDependencies: {
          bad: { kind: "archive", url: "https://example.com/archive.tar.gz", destination: "vendor/bad" },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });
    expect(() => loadPackageGraph(missingShaFs, "/app/main.do"))
      .toThrow("externalDependencies.bad.sha256 is required");

    const invalidCommandsFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        externalDependencies: {
          bad: {
            kind: "archive",
            url: "https://example.com/archive.tar.gz",
            sha256: "a".repeat(64),
            destination: "vendor/bad",
            commands: [{ args: ["missing-program"] }],
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });
    expect(() => loadPackageGraph(invalidCommandsFs, "/app/main.do"))
      .toThrow("externalDependencies.bad.commands[0].program is required");

    const escapingDestinationFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        externalDependencies: {
          bad: {
            kind: "git",
            url: "https://example.com/repo.git",
            ref: "v1",
            commit: "b".repeat(40),
            destination: "../bad",
          },
        },
      }),
      "/app/main.do": "function main(): void {}",
    });
    expect(() => loadPackageGraph(escapingDestinationFs, "/app/main.do"))
      .toThrow("externalDependencies.bad.destination must stay within the package root");
  });

  it("acquires archive external dependencies and reuses matching markers", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-archive-"));

    try {
      const sourceRoot = path.join(tempDir, "source", "archive-root");
      fs.mkdirSync(path.join(sourceRoot, "include"), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "include", "hello.h"), "#pragma once\n", "utf8");
      fs.writeFileSync(path.join(sourceRoot, "LICENSE"), "license\n", "utf8");
      const archivePath = path.join(tempDir, "hello.tar.gz");
      execFileSync("tar", ["-czf", archivePath, "-C", path.join(tempDir, "source"), "archive-root"], { stdio: "pipe" });
      const sha256 = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          hello: {
            kind: "archive",
            url: `file://${archivePath}`,
            sha256,
            destination: "vendor/hello",
          },
        },
        build: {
          native: {
            includePaths: ["vendor/hello/include"],
            extraCopyPaths: ["vendor/hello/LICENSE"],
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      const graph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"));
      const vendorDir = path.join(appDir, "vendor", "hello");

      expect(graph.rootPackage.nativeBuild.includePaths).toEqual([path.join(vendorDir, "include")]);
      expect(fs.existsSync(path.join(vendorDir, "include", "hello.h"))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(vendorDir, ".doof-external.json"), "utf8"))).toMatchObject({
        schemaVersion: 1,
        name: "hello",
        kind: "archive",
        url: `file://${archivePath}`,
        sha256,
        destination: "vendor/hello",
        stripComponents: 1,
      });

      fs.unlinkSync(archivePath);
      expect(() => loadPackageGraph(new RealFS(), path.join(appDir, "main.do"))).not.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs archive external dependency commands and writes a target marker", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-commands-"));

    try {
      const sourceRoot = path.join(tempDir, "source", "archive-root");
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(
        path.join(sourceRoot, "build.js"),
        [
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const [, , packageRoot, destination, jobs] = process.argv;",
          "fs.mkdirSync(path.join(destination, '.doof-build', 'include'), { recursive: true });",
          "fs.mkdirSync(path.join(destination, '.doof-build', 'lib'), { recursive: true });",
          "fs.writeFileSync(path.join(destination, '.doof-build', 'include', 'hello.h'), `${packageRoot}\\n${jobs}\\n${process.env.DOOF_TEST_VALUE}\\n`);",
          "fs.writeFileSync(path.join(destination, '.doof-build', 'lib', 'libhello.a'), 'archive\\n');",
        ].join("\n"),
        "utf8",
      );
      const archivePath = path.join(tempDir, "hello.tar.gz");
      execFileSync("tar", ["-czf", archivePath, "-C", path.join(tempDir, "source"), "archive-root"], { stdio: "pipe" });
      const sha256 = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          hello: {
            kind: "archive",
            url: `file://${archivePath}`,
            sha256,
            destination: "vendor/hello",
            commands: [{
              program: process.execPath,
              args: ["build.js", "${packageRoot}", "${destination}", "${jobs}"],
              env: { DOOF_TEST_VALUE: "from-env" },
            }],
          },
        },
        build: {
          native: {
            includePaths: ["vendor/hello/.doof-build/include"],
            libraryPaths: ["vendor/hello/.doof-build/lib"],
            linkLibraries: ["hello"],
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      const graph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"));
      const vendorDir = path.join(appDir, "vendor", "hello");
      const nativeTarget = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
      const sourceMarker = JSON.parse(fs.readFileSync(path.join(vendorDir, ".doof-external.json"), "utf8"));
      const nativeMarker = JSON.parse(
        fs.readFileSync(path.join(vendorDir, `.doof-external-native-${nativeTarget}.json`), "utf8"),
      );

      expect(graph.rootPackage.nativeBuild.includePaths).toEqual([path.join(vendorDir, ".doof-build", "include")]);
      expect(graph.rootPackage.nativeBuild.libraryPaths).toEqual([path.join(vendorDir, ".doof-build", "lib")]);
      expect(fs.readFileSync(path.join(vendorDir, ".doof-build", "include", "hello.h"), "utf8"))
        .toContain("from-env");
      expect(fs.existsSync(path.join(vendorDir, ".doof-build", "lib", "libhello.a"))).toBe(true);
      expect(sourceMarker.commands).toBeUndefined();
      expect(nativeMarker).toMatchObject({
        schemaVersion: 1,
        nativeTarget,
        commands: [{
          program: process.execPath,
          args: ["build.js", "${packageRoot}", "${destination}", "${jobs}"],
          env: { DOOF_TEST_VALUE: "from-env" },
        }],
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs active native external dependency commands and writes a target marker", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-native-commands-"));

    try {
      const sourceRoot = path.join(tempDir, "source", "archive-root");
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(
        path.join(sourceRoot, "build.js"),
        [
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const [, , destination, nativeTarget, targetTriple, sdkPath] = process.argv;",
          "const outDir = path.join(destination, '.doof-build', nativeTarget);",
          "fs.mkdirSync(path.join(outDir, 'include'), { recursive: true });",
          "fs.mkdirSync(path.join(outDir, 'lib'), { recursive: true });",
          "fs.writeFileSync(path.join(outDir, 'include', 'hello.h'), `${nativeTarget}\\n${targetTriple}\\n${sdkPath}\\n`);",
          "fs.writeFileSync(path.join(outDir, 'lib', 'libhello.a'), 'archive\\n');",
        ].join("\n"),
        "utf8",
      );
      const archivePath = path.join(tempDir, "hello.tar.gz");
      execFileSync("tar", ["-czf", archivePath, "-C", path.join(tempDir, "source"), "archive-root"], { stdio: "pipe" });
      const sha256 = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          hello: {
            kind: "archive",
            url: `file://${archivePath}`,
            sha256,
            destination: "vendor/hello",
            commands: [{
              program: process.execPath,
              args: ["build.js", "${destination}", "${nativeTarget}", "${targetTriple}", "${sdkPath}"],
            }],
          },
        },
        build: {
          native: {
            includePaths: ["vendor/hello/.doof-build/${nativeTarget}/include"],
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      const graph = loadPackageGraph(new RealFS(), path.join(appDir, "main.do"));
      const vendorDir = path.join(appDir, "vendor", "hello");
      const nativeTarget = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
      const nativeMarkerPath = path.join(vendorDir, `.doof-external-native-${nativeTarget}.json`);

      expect(fs.existsSync(nativeMarkerPath)).toBe(true);
      expect(graph.rootPackage.externalDependencySentinelPaths).toContain(nativeMarkerPath);
      expect(fs.readFileSync(path.join(vendorDir, ".doof-build", nativeTarget, "include", "hello.h"), "utf8"))
        .toContain(nativeTarget);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("selects native external dependency command markers for the active Apple target", () => {
    if (process.platform !== "darwin") {
      return;
    }

    const manifest = {
      name: "app",
      build: {
        targetExecutableName: "DoofDemo",
        iosApp: {
          bundleId: "dev.doof.demo",
          displayName: "Doof Demo",
          version: "1.0",
          icon: "app-icon.png",
          minimumDeploymentTarget: "16.0",
        },
      },
      externalDependencies: {
        hello: {
          kind: "archive",
          url: "https://example.com/hello.tar.gz",
          sha256: "a".repeat(64),
          destination: "vendor/hello",
          commands: [{ program: "true" }],
        },
      },
    };
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify(manifest),
      "/app/main.do": "function main(): void {}",
      "/app/app-icon.png": "png",
    });

    const nativeTargets: string[] = [];
    const macGraph = loadPackageGraph(fs, "/app/main.do", {
      acquireExternalDependency(_name, _dependency, context) {
        nativeTargets.push(context.nativeTarget);
      },
    });
    const simGraph = loadPackageGraph(fs, "/app/main.do", {
      buildTargetOverride: "ios-app",
      acquireExternalDependency(_name, _dependency, context) {
        nativeTargets.push(context.nativeTarget);
      },
    });
    const deviceGraph = loadPackageGraph(fs, "/app/main.do", {
      buildTargetOverride: "ios-app",
      iosDestinationOverride: "device",
      acquireExternalDependency(_name, _dependency, context) {
        nativeTargets.push(context.nativeTarget);
      },
    });

    expect(nativeTargets).toEqual(["macos", "ios-simulator", "ios-device"]);
    expect(macGraph.rootPackage.externalDependencySentinelPaths).toContain(
      "/app/vendor/hello/.doof-external-native-macos.json",
    );
    expect(simGraph.rootPackage.externalDependencySentinelPaths).toContain(
      "/app/vendor/hello/.doof-external-native-ios-simulator.json",
    );
    expect(deviceGraph.rootPackage.externalDependencySentinelPaths).toContain(
      "/app/vendor/hello/.doof-external-native-ios-device.json",
    );
  });

  it("does not write the external dependency native marker when commands fail", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-command-fail-"));

    try {
      const sourceRoot = path.join(tempDir, "source", "archive-root");
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "fail.js"), "process.exit(7);\n", "utf8");
      const archivePath = path.join(tempDir, "hello.tar.gz");
      execFileSync("tar", ["-czf", archivePath, "-C", path.join(tempDir, "source"), "archive-root"], { stdio: "pipe" });
      const sha256 = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          hello: {
            kind: "archive",
            url: `file://${archivePath}`,
            sha256,
            destination: "vendor/hello",
            commands: [{ program: process.execPath, args: ["fail.js"] }],
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      expect(() => loadPackageGraph(new RealFS(), path.join(appDir, "main.do")))
        .toThrow("command 1");
      const nativeTarget = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
      expect(fs.existsSync(path.join(appDir, "vendor", "hello", ".doof-external.json"))).toBe(true);
      expect(fs.existsSync(path.join(appDir, "vendor", "hello", `.doof-external-native-${nativeTarget}.json`)))
        .toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails archive acquisition when the checksum does not match", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-bad-archive-"));

    try {
      const sourceRoot = path.join(tempDir, "source", "archive-root");
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "hello.txt"), "hello\n", "utf8");
      const archivePath = path.join(tempDir, "hello.tar.gz");
      execFileSync("tar", ["-czf", archivePath, "-C", path.join(tempDir, "source"), "archive-root"], { stdio: "pipe" });

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          hello: {
            kind: "archive",
            url: `file://${archivePath}`,
            sha256: "0".repeat(64),
            destination: "vendor/hello",
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      expect(() => loadPackageGraph(new RealFS(), path.join(appDir, "main.do")))
        .toThrow("checksum mismatch");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails git external acquisition when the resolved commit does not match", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-external-git-"));

    try {
      const repoDir = path.join(tempDir, "repo");
      fs.mkdirSync(repoDir, { recursive: true });
      fs.writeFileSync(path.join(repoDir, "README.md"), "# dependency\n", "utf8");
      execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "Doof Tests"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "doof-tests@example.com"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["tag", "v1"], { cwd: repoDir, stdio: "pipe" });

      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
        name: "app",
        externalDependencies: {
          repo: {
            kind: "git",
            url: repoDir,
            ref: "v1",
            commit: "0".repeat(40),
            destination: "vendor/repo",
          },
        },
      }, null, 2));
      fs.writeFileSync(path.join(appDir, "main.do"), "function main(): void {}\n");

      expect(() => loadPackageGraph(new RealFS(), path.join(appDir, "main.do")))
        .toThrow("commit mismatch");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("injects implicit std dependencies when a package does not declare them", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "");

    const stdFiles = Object.fromEntries(
      Object.keys(DEFAULT_STD_VERSIONS).flatMap((shortName) => [
        [`/cache/std-${shortName}/doof.json`, JSON.stringify({ name: `std/${shortName}` })],
        [`/cache/std-${shortName}/index.do`, `export function noop(): void {}`],
      ]),
    );

    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {},
      }),
      "/app/main.do": 'import { writeText } from "std/fs"\nfunction main(): void => writeText("out.txt", "ok")',
      ...stdFiles,
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      implicitStdDependencies: true,
      resolveRemoteDependency(dependency, context) {
        const shortName = context.dependencyName.slice("std/".length);
        return {
          rootDir: `/cache/std-${shortName}`,
          package: {
            kind: "git",
            url: dependency.url,
            version: dependency.version,
            commit: `${shortName}-commit`,
            pathSegments: ["doof-lang", shortName],
          },
        };
      },
    });

    expect(graph.rootPackage.dependencyRoots.get("std/fs")).toBe("/cache/std-fs");
  });

  it("loads implicit std dependencies from DOOF_STDLIB_ROOT before remote resolution", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "/stdlib");

    const stdFiles = Object.fromEntries(
      Object.keys(DEFAULT_STD_VERSIONS).flatMap((shortName) => [
        [`/stdlib/${shortName}/doof.json`, JSON.stringify({ name: `std/${shortName}`, dependencies: {} })],
        [`/stdlib/${shortName}/index.do`, `export function noop(): void {}`],
      ]),
    );

    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {},
      }),
      "/app/main.do": 'import { writeText } from "std/fs"\nfunction main(): void => writeText("out.txt", "ok")',
      ...stdFiles,
    });

    let remoteResolutionCalls = 0;
    const graph = loadPackageGraph(fs, "/app/main.do", {
      implicitStdDependencies: true,
      resolveRemoteDependency() {
        remoteResolutionCalls += 1;
        throw new Error("unexpected remote std resolution");
      },
    });

    const expectedRootDirs = ["/app", ...Object.keys(DEFAULT_STD_VERSIONS).sort().map((name) => `/stdlib/${name}`)];
    expect(remoteResolutionCalls).toBe(0);
    expect(graph.rootPackage.dependencyRoots.get("std/fs")).toBe("/stdlib/fs");
    expect(graph.packages.map((pkg) => pkg.rootDir)).toEqual(expectedRootDirs);
  });

  it("narrows implicit std package graphs to analyzed modules for build metadata", () => {
    vi.stubEnv(DOOF_STDLIB_ROOT_ENV, "");

    const explicitPackages = new Set(["assert", "blob", "fs", "path", "regex", "stream"]);
    const extraStdFiles = Object.fromEntries(
      Object.keys(DEFAULT_STD_VERSIONS)
        .filter((name) => !explicitPackages.has(name))
        .flatMap((name) => [
          [`/cache/std-${name}/doof.json`, JSON.stringify({ name: `std/${name}` })],
          [`/cache/std-${name}/index.do`, `export function noop(): void {}`],
        ]),
    );

    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        dependencies: {},
      }),
      "/app/main.do": 'import { writeText } from "std/fs"\nfunction main(): void => writeText("out.txt", "ok")',
      "/cache/std-fs/doof.json": JSON.stringify({
        name: "std/fs",
        dependencies: {
          "std/path": { path: "../std-path" },
        },
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-fs/index.do": "export function writeText(path: string, value: string): void {}",
      "/cache/std-fs/include/fs.hpp": "#pragma once\n",
      "/cache/std-path/doof.json": JSON.stringify({
        name: "std/path",
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-path/index.do": "export function join(parts: string[]): string => \"\"",
      "/cache/std-path/include/path.hpp": "#pragma once\n",
      "/cache/std-assert/doof.json": JSON.stringify({
        name: "std/assert",
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-assert/index.do": "export class Assert {}",
      "/cache/std-assert/include/assert.hpp": "#pragma once\n",
      "/cache/std-blob/doof.json": JSON.stringify({
        name: "std/blob",
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-blob/index.do": "export class Blob {}",
      "/cache/std-blob/include/blob.hpp": "#pragma once\n",
      "/cache/std-regex/doof.json": JSON.stringify({
        name: "std/regex",
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-regex/index.do": "export class Regex {}",
      "/cache/std-regex/include/regex.hpp": "#pragma once\n",
      "/cache/std-stream/doof.json": JSON.stringify({
        name: "std/stream",
        build: {
          native: {
            includePaths: ["./include"],
          },
        },
      }),
      "/cache/std-stream/index.do": "export interface Stream<T> {}",
      "/cache/std-stream/include/stream.hpp": "#pragma once\n",
      ...extraStdFiles,
    });

    const graph = loadPackageGraph(fs, "/app/main.do", {
      implicitStdDependencies: true,
      resolveRemoteDependency(dependency, context) {
        const shortName = context.dependencyName.slice("std/".length);
        return {
          rootDir: `/cache/std-${shortName}`,
          package: {
            kind: "git",
            url: dependency.url,
            version: dependency.version,
            commit: `${shortName}-commit`,
            pathSegments: ["doof-lang", shortName],
          },
        };
      },
    });

    const allExpectedRootDirs = ["/app", ...Object.keys(DEFAULT_STD_VERSIONS).sort().map((name) => `/cache/std-${name}`)];
    expect(graph.packages.map((pkg) => pkg.rootDir)).toEqual(allExpectedRootDirs);

    const buildGraph = narrowPackageGraphForBuild(graph, [
      "/app/main.do",
      "/cache/std-fs/index.do",
    ]);

    expect(buildGraph.packages.map((pkg) => pkg.rootDir)).toEqual([
      "/app",
      "/cache/std-fs",
      "/cache/std-path",
    ]);
    expect(mergePackageNativeBuild(buildGraph).includePaths).toEqual([
      "/cache/std-path/include",
      "/cache/std-fs/include",
    ]);
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
      externalDependencies: [],
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
        externalDependencies: [],
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
      externalDependencies: [],
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
      externalDependencies: [],
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

  it("applies ios simulator native fragments when building an ios-app target", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
          },
        },
        dependencies: {
          boardgame: { path: "../deps/boardgame" },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/deps/boardgame/doof.json": JSON.stringify({
        name: "boardgame",
        build: {
          native: {
            macos: {
              frameworks: ["Cocoa"],
            },
            iosSimulator: {
              sourceFiles: ["native_host.mm"],
              frameworks: ["UIKit", "Metal"],
            },
          },
        },
      }),
      "/deps/boardgame/index.do": "export const ok = 1",
      "/deps/boardgame/native_host.mm": "",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");
    const boardgame = graph.packages.find((pkg) => pkg.rootDir === "/deps/boardgame");

    expect(boardgame?.nativeBuild.sourceFiles).toEqual(["/deps/boardgame/native_host.mm"]);
    expect(boardgame?.nativeBuild.frameworks).toEqual(["UIKit", "Metal"]);
  });

  it("applies ios device native fragments when building an ios-app device target", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
          },
        },
        dependencies: {
          boardgame: { path: "../deps/boardgame" },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/deps/boardgame/doof.json": JSON.stringify({
        name: "boardgame",
        build: {
          native: {
            iosSimulator: {
              sourceFiles: ["sim_host.mm"],
              frameworks: ["UIKit"],
            },
            iosDevice: {
              sourceFiles: ["device_host.mm"],
              frameworks: ["UIKit", "Metal"],
            },
          },
        },
      }),
      "/deps/boardgame/index.do": "export const ok = 1",
      "/deps/boardgame/sim_host.mm": "",
      "/deps/boardgame/device_host.mm": "",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", { iosDestinationOverride: "device" });
    const boardgame = graph.packages.find((pkg) => pkg.rootDir === "/deps/boardgame");

    expect(boardgame?.nativeBuild.sourceFiles).toEqual(["/deps/boardgame/device_host.mm"]);
    expect(boardgame?.nativeBuild.frameworks).toEqual(["UIKit", "Metal"]);
  });

  it("allows inactive target metadata and lets loadPackageGraph override the selected build target", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofDemo",
          macosApp: {
            bundleId: "dev.doof.demo.macos",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
          },
          iosApp: {
            bundleId: "dev.doof.demo.ios",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do", { buildTargetOverride: "ios-app" });

    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "ios-app",
      config: {
        bundleId: "dev.doof.demo.ios",
        displayName: "Doof Demo",
        version: "1.0",
        iconPath: "/app/app-icon.png",
        resources: [],
        minimumDeploymentTarget: "16.0",
      },
    });
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
            icon: "./app-icon.png",
            resources: [
              { from: "images/*", to: "images" },
            ],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "dev.doof.solitaire",
        displayName: "Doof Solitaire",
        version: "1.0",
        iconPath: "/app/app-icon.png",
        resources: [{ fromPattern: "/app/images/*", destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("normalizes root compact macos-app metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "std-game-ui-sample",
        version: "0.1.0",
        target: "macos-app",
        executable: "UI",
        id: "extremebasic.ui",
        title: "Doof UI",
        icon: "app-icon.png",
        resources: ["fonts"],
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/app/fonts/app.ttf": "font",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("UI");
    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "extremebasic.ui",
        displayName: "Doof UI",
        version: "0.1.0",
        iconPath: "/app/app-icon.png",
        resources: [{ fromPattern: "/app/fonts", destination: "fonts" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("normalizes build-nested compact app metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "demo-app",
        build: {
          target: "macos-app",
          executable: "Demo",
          id: "dev.example.demo",
          title: "Demo App",
          icon: "app-icon.png",
          resources: ["assets"],
          macosApp: {
            category: "public.app-category.games",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/app/assets/sprite.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("Demo");
    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "dev.example.demo",
        displayName: "Demo App",
        version: "1.0",
        iconPath: "/app/app-icon.png",
        resources: [{ fromPattern: "/app/assets", destination: "assets" }],
        category: "public.app-category.games",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("lets root compact fields override nested app fields", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "demo-app",
        target: "macos-app",
        executable: "RootDemo",
        id: "dev.example.root",
        title: "Root Demo",
        resources: ["root-assets"],
        build: {
          executable: "BuildDemo",
          id: "dev.example.build",
          title: "Build Demo",
          resources: ["build-assets"],
          macosApp: {
            bundleId: "dev.example.macos",
            displayName: "macOS Demo",
            resources: [{ from: "macos-assets/*", to: "macos-assets" }],
            category: "public.app-category.games",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/root-assets/file.txt": "root",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("RootDemo");
    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "macos-app",
      config: {
        bundleId: "dev.example.root",
        displayName: "Root Demo",
        version: "1.0",
        resources: [{ fromPattern: "/app/root-assets", destination: "root-assets" }],
        category: "public.app-category.games",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("normalizes macos-app custom Info.plist metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "macos-app",
          targetExecutableName: "DoofDemo",
          macosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            infoPlist: {
              NSLocalNetworkUsageDescription: "Find nearby players.",
              NSBonjourServices: ["_doof-jigsaw._tcp"],
              DemoNested: { Enabled: true, Weight: 2 },
            },
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget?.kind).toBe("macos-app");
    expect(graph.rootPackage.buildTarget?.config.infoPlist).toEqual({
      NSLocalNetworkUsageDescription: "Find nearby players.",
      NSBonjourServices: ["_doof-jigsaw._tcp"],
      DemoNested: { Enabled: true, Weight: 2 },
    });
  });

  it("normalizes ios-app target metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            resources: [
              { from: "images/*", to: "images" },
            ],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "ios-app",
      config: {
        bundleId: "dev.doof.demo",
        displayName: "Doof Demo",
        version: "1.0",
        iconPath: "/app/app-icon.png",
        resources: [{ fromPattern: "/app/images/*", destination: "images" }],
        minimumDeploymentTarget: "16.0",
      },
    });
  });

  it("normalizes compact ios-app defaults without an icon", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "mobile-demo",
        target: "ios-app",
      }),
      "/app/main.do": "function main(): int => 0",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("mobile-demo");
    expect(graph.rootPackage.buildTarget).toEqual({
      kind: "ios-app",
      config: {
        bundleId: "dev.doof.mobile-demo",
        displayName: "mobile-demo",
        version: "1.0",
        resources: [],
        minimumDeploymentTarget: "16.0",
      },
    });
  });

  it("normalizes ios-app custom Info.plist metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            infoPlist: {
              NSLocalNetworkUsageDescription: "Find nearby players.",
              NSBonjourServices: ["_doof-jigsaw._tcp"],
            },
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget?.kind).toBe("ios-app");
    expect(graph.rootPackage.buildTarget?.config.infoPlist).toEqual({
      NSLocalNetworkUsageDescription: "Find nearby players.",
      NSBonjourServices: ["_doof-jigsaw._tcp"],
    });
  });

  it("rejects unsupported custom Info.plist values", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            infoPlist: {
              NSBonjourServices: ["_doof-jigsaw._tcp", null],
            },
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.iosApp.infoPlist.NSBonjourServices[1] must be a string, number, boolean, array, or object");
  });

  it("rejects custom Info.plist entries that override Doof-managed keys", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            infoPlist: {
              CFBundleIdentifier: "dev.example.override",
            },
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.iosApp.infoPlist.CFBundleIdentifier conflicts with a Doof-managed Info.plist key");
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
            icon: "app-icon.png",
            resources: [{ from: "images/*", to: "images" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
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
        iconPath: "/app/app-icon.png",
        resources: [{ fromPattern: "/app/images/*", destination: "images" }],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "11.0",
      },
    });
  });

  it("defaults the executable name for macos-app targets", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "demo-app",
        build: {
          target: "macos-app",
          macosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Demo",
            version: "1.0",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("demo-app");
  });

  it("defaults the executable name for ios-app targets", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "demo-app",
        build: {
          target: "ios-app",
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Demo",
            version: "1.0",
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("demo-app");
  });

  it("rejects non-PNG macos-app icons", () => {
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
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.svg": "<svg />",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.macosApp.icon must point to a PNG file");
  });

  it("rejects non-PNG ios-app icons", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          iosApp: {
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
      .toThrow("build.iosApp.icon must point to a PNG file");
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
            icon: "./app-icon.png",
            resources: [{ from: "images/*", to: "../oops" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
      "/app/images/card.png": "png",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.macosApp.resources[0].to bundle resource destinations must stay within Contents/Resources");
  });

  it("rejects compact resource destinations that escape the bundle", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        target: "macos-app",
        resources: ["../oops"],
      }),
      "/app/main.do": "function main(): int => 0",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("build.macosApp.resources[0].from must stay within the package root");
  });

  it("allows compact executable without app metadata", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        executable: "compact-demo",
      }),
      "/app/main.do": "function main(): int => 0",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.manifest.build?.targetExecutableName).toBe("compact-demo");
    expect(graph.rootPackage.buildTarget).toBeNull();
  });

  it("resolves compact resources for command-line executable builds", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        resources: ["images"],
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget).toBeNull();
    expect(graph.rootPackage.resources).toEqual([{ fromPattern: "/app/images", destination: "images" }]);
  });

  it("allows command-line executable resources without app metadata defaults", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        resources: ["images"],
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/images/card.png": "png",
    });

    const graph = loadPackageGraph(fs, "/app/main.do");

    expect(graph.rootPackage.buildTarget).toBeNull();
    expect(graph.rootPackage.manifest.build?.macosApp).toBeUndefined();
    expect(graph.rootPackage.manifest.build?.iosApp).toBeUndefined();
    expect(graph.rootPackage.resources).toEqual([{ fromPattern: "/app/images", destination: "images" }]);
  });

  it("rejects command-line resource destinations that escape the executable resource directory", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        resources: [{ from: "images/*", to: "../oops" }],
      }),
      "/app/main.do": "function main(): int => 0",
    });

    expect(() => loadPackageGraph(fs, "/app/main.do"))
      .toThrow("resources[0].to resource destinations must stay within the executable resource directory");
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
    expect(createBuildProvenance(loadPackageGraph(fs, "/app/main.do"))).toEqual({
      dependencies: [],
      externalDependencies: [],
    });
    expect(result.provenance).toEqual({ dependencies: [], externalDependencies: [] });
  });

  it("uses compact executable for native output naming", () => {
    const fs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        executable: "compact-demo",
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

    expect(result.outputBinaryName).toBe(normalizeOutputBinaryName("compact-demo"));
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
        resources: ["assets"],
        dependencies: {
          foo: { path: "../deps/foo" },
        },
      }),
      "/app/main.do": 'import { value } from "foo"\nfunction main(): int => value',
      "/app/assets/config.json": "{}",
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
    expect(result.buildManifest.resources).toEqual([{ fromPattern: "/app/assets", destination: "assets" }]);
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
      expect(buildManifest.includePaths).toEqual([
        outDir,
        path.join(outDir, "deps", "foo", "include"),
        path.join(outDir, "deps", "foo"),
      ]);
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
    expect(result.project.outputNativeIncludePaths).toContain(path.join("deps", "fs").replace(/\\/g, "/"));
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

  it("copies root-package local native headers referenced by extern imports", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-root-native-copy-"));
    const appDir = path.join(workspaceDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
      name: "app",
      build: {
        native: {
          extraCopyPaths: ["./native_greeting.hpp"],
        },
      },
      dependencies: {},
    }, null, 2));
    fs.writeFileSync(path.join(appDir, "main.do"), [
      'export import function nativeGreeting(): string from "./native_greeting.hpp" as native::greeting',
      "function main(): int => 0",
    ].join("\n") + "\n", "utf8");
    fs.writeFileSync(path.join(appDir, "native_greeting.hpp"), [
      "#pragma once",
      "#include <string>",
      "namespace native { inline std::string greeting() { return \"hi\"; } }",
      "",
    ].join("\n"), "utf8");

    const result = runPipelineWithFs(
      new RealFS(),
      path.join(appDir, "main.do"),
      false,
      emptyNativeBuildOptions(),
      () => {},
      () => {},
    );

    expect(result.project.outputNativeCopies).toContainEqual({
      sourcePath: path.join(appDir, "native_greeting.hpp"),
      relativePath: "native_greeting.hpp",
      kind: "auto",
    });
    expect(result.project.outputNativeIncludePaths).toContain("");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-root-native-copy-out-"));
    try {
      writeProject(result.project, outDir, false, () => {}, result.provenance, result.buildManifest);
      expect(fs.readFileSync(path.join(outDir, "native_greeting.hpp"), "utf8")).toContain("greeting");
      expect(fs.readFileSync(path.join(outDir, "main.hpp"), "utf8")).toContain('#include "./native_greeting.hpp"');
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
            icon: "./app-icon.png",
            infoPlist: {
              NSLocalNetworkUsageDescription: "Doof Jigsaw uses the local network to find nearby puzzle players.",
              NSBonjourServices: ["_doof-jigsaw._tcp"],
            },
            resources: [{ from: "images/*", to: "images" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
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
      "PkgInfo",
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
      expect(buildManifest.buildTarget?.config.iconPath).toBe("/app/app-icon.png");
      const infoPlist = fs.readFileSync(path.join(outDir, "Info.plist"), "utf8");
      expect(infoPlist).toContain("dev.doof.solitaire");
      expect(infoPlist).toContain("NSLocalNetworkUsageDescription");
      expect(infoPlist).toContain("_doof-jigsaw._tcp");
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("emits bundle-aware metadata and support files for ios-app targets", () => {
    const virtualFs = new VirtualFS({
      "/app/doof.json": JSON.stringify({
        name: "app",
        build: {
          target: "ios-app",
          targetExecutableName: "DoofDemo",
          native: {
            frameworks: ["UIKit", "Foundation"],
          },
          iosApp: {
            bundleId: "dev.doof.demo",
            displayName: "Doof Demo",
            version: "1.0",
            icon: "app-icon.png",
            infoPlist: {
              NSLocalNetworkUsageDescription: "Doof Jigsaw uses the local network to find nearby puzzle players.",
              NSBonjourServices: ["_doof-jigsaw._tcp"],
            },
            resources: [{ from: "images/*", to: "images" }],
          },
        },
      }),
      "/app/main.do": "function main(): int => 0",
      "/app/app-icon.png": "png",
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

    expect(result.buildTarget?.kind).toBe("ios-app");
    expect(result.project.supportFiles.map((file) => file.relativePath)).toEqual([
      "Assets.xcassets/AppIcon.appiconset/Contents.json",
      "Info.plist",
      "ios-main.mm",
    ]);
    expect(result.project.supportFiles[1]?.content).toContain("dev.doof.demo");
    expect(result.buildManifest.buildTarget?.kind).toBe("ios-app");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-ios-app-"));
    try {
      writeProject(result.project, outDir, false, () => {}, result.provenance, result.buildManifest);

      const buildManifest = JSON.parse(fs.readFileSync(path.join(outDir, "doof-build.json"), "utf8")) as {
        schemaVersion: number;
        buildTarget: { kind: string; config: { iconPath: string } } | null;
      };
      expect(buildManifest.schemaVersion).toBe(2);
      expect(buildManifest.buildTarget?.kind).toBe("ios-app");
      expect(buildManifest.buildTarget?.config.iconPath).toBe("/app/app-icon.png");
      const infoPlist = fs.readFileSync(path.join(outDir, "Info.plist"), "utf8");
      expect(infoPlist).toContain("dev.doof.demo");
      expect(infoPlist).toContain("NSLocalNetworkUsageDescription");
      expect(infoPlist).toContain("_doof-jigsaw._tcp");
      expect(fs.readFileSync(path.join(outDir, "ios-main.mm"), "utf8")).toContain("UIApplicationMain");
      expect(
        fs.readFileSync(path.join(outDir, "Assets.xcassets", "AppIcon.appiconset", "Contents.json"), "utf8"),
      ).toContain("app_store_1024");
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
