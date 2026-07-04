import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reckon } from "@andrew24601/reckon";
import type { ProjectEmitResult } from "./emitter-module.js";
import {
  formatRunTimeoutMessage,
  getCliVersion,
  parseArgs,
  resolveCliPackageInputs,
  resolvePackageSigningOverrides,
  resolveCliPipelineInputs,
  resolveRunTimeoutMs,
} from "./cli.js";
import {
  createNativeBuildGraphPlan,
  createProjectMaterializePlan,
} from "./cli-core.js";
import { VirtualFS } from "./test-helpers.js";

const tmpDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI argument parsing", () => {
  it("parses repeated native build options", () => {
    const args = parseArgs([
      "node",
      "doof",
      "build",
      "--std",
      "gnu++20",
      "--include-path",
      "./vendor/include",
      "--include-path",
      "./vendor/generated",
      "--lib-path",
      "./vendor/lib",
      "--link-lib",
      "curl",
      "--link-lib",
      "-lssl",
      "--framework",
      "Foundation",
      "--source",
      "./native/bridge.cpp",
      "--object",
      "./native/bridge.o",
      "--define",
      "DEBUG",
      "--define",
      "-DAPI_LEVEL=2",
      "--cxxflag",
      "-O2",
      "--ldflag",
      "-pthread",
      "samples/hello.do",
    ]);

    expect(args.command).toBe("build");
    expect(args.entry).toBe("samples/hello.do");
    expect(args.cppStd).toBe("gnu++20");
    expect(args.nativeBuild.cppStd).toBe("gnu++20");
    expect(args.nativeBuild.includePaths).toEqual(["./vendor/include", "./vendor/generated"]);
    expect(args.nativeBuild.libraryPaths).toEqual(["./vendor/lib"]);
    expect(args.nativeBuild.linkLibraries).toEqual(["curl", "ssl"]);
    expect(args.nativeBuild.frameworks).toEqual(["Foundation"]);
    expect(args.nativeBuild.sourceFiles).toEqual(["./native/bridge.cpp"]);
    expect(args.nativeBuild.objectFiles).toEqual(["./native/bridge.o"]);
    expect(args.nativeBuild.defines).toEqual(["DEBUG", "API_LEVEL=2"]);
    expect(args.nativeBuild.compilerFlags).toEqual(["-O2"]);
    expect(args.nativeBuild.linkerFlags).toEqual(["-pthread"]);
  });

  it("defaults to run and keeps native settings empty", () => {
    const args = parseArgs(["node", "doof", "samples/hello.do"]);

    expect(args.command).toBe("run");
    expect(args.entry).toBe("samples/hello.do");
    expect(args.nativeBuild.includePaths).toEqual([]);
    expect(args.nativeBuild.linkLibraries).toEqual([]);
    expect(args.programArgs).toEqual([]);
  });

  it("parses program args after -- for run", () => {
    const args = parseArgs([
      "node",
      "doof",
      "run",
      "game/samples/jigsaw-server",
      "--",
      "--listen",
      "127.0.0.1:8080",
      "--state",
      "state.json",
      "--no-persist",
      "--reset",
    ]);

    expect(args.command).toBe("run");
    expect(args.entry).toBe("game/samples/jigsaw-server");
    expect(args.programArgs).toEqual([
      "--listen",
      "127.0.0.1:8080",
      "--state",
      "state.json",
      "--no-persist",
      "--reset",
    ]);
  });

  it("keeps program args separate from doof options", () => {
    const args = parseArgs([
      "node",
      "doof",
      "run",
      "--outdir",
      "build/server",
      "game/samples/jigsaw-server",
      "--",
      "--outdir",
      "program-output",
    ]);

    expect(args.outDir).toBe("build/server");
    expect(args.entry).toBe("game/samples/jigsaw-server");
    expect(args.programArgs).toEqual(["--outdir", "program-output"]);
  });

  it("parses test command flags", () => {
    const args = parseArgs([
      "node",
      "doof",
      "test",
      "--filter",
      "math",
      "--list",
      "samples",
    ]);

    expect(args.command).toBe("test");
    expect(args.entry).toBe("samples");
    expect(args.testFilter).toBe("math");
    expect(args.listTests).toBe(true);
  });

  it("parses --coverage flag for test command", () => {
    const args = parseArgs(["node", "doof", "test", "--coverage", "samples"]);

    expect(args.command).toBe("test");
    expect(args.coverage).toBe(true);
    expect(args.coverageOutput).toBe("");
  });

  it("parses --coverage-output path for test command", () => {
    const args = parseArgs([
      "node", "doof", "test",
      "--coverage",
      "--coverage-output", "/tmp/my-coverage.json",
      "samples",
    ]);

    expect(args.coverage).toBe(true);
    expect(args.coverageOutput).toBe("/tmp/my-coverage.json");
  });

  it("defaults coverage to false when flag is absent", () => {
    const args = parseArgs(["node", "doof", "test", "samples"]);

    expect(args.coverage).toBe(false);
    expect(args.coverageOutput).toBe("");
  });

  it("parses --metrics-class-lifecycle for pipeline commands", () => {
    const args = parseArgs(["node", "doof", "build", "--metrics-class-lifecycle", "samples"]);

    expect(args.command).toBe("build");
    expect(args.metricsClassLifecycle).toBe(true);
  });

  it("parses --observe for run", () => {
    const args = parseArgs(["node", "doof", "run", "--observe", "samples"]);

    expect(args.command).toBe("run");
    expect(args.observe).toBe(true);
  });

  it("rejects --observe for non-run commands", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    }) as never);

    expect(() => parseArgs(["node", "doof", "build", "--observe", "samples"])).toThrow("exit 1");
  });

  it("parses a build target override", () => {
    const args = parseArgs([
      "node",
      "doof",
      "build",
      "--target",
      "ios-app",
      "samples/solitaire",
    ]);

    expect(args.command).toBe("build");
    expect(args.targetOverride).toBe("ios-app");
    expect(args.entry).toBe("samples/solitaire");
  });

  it("parses ios device deployment flags", () => {
    const args = parseArgs([
      "node",
      "doof",
      "run",
      "--target",
      "ios-app",
      "--ios-destination",
      "device",
      "--ios-device",
      "00008110-001234560E91801E",
      "--ios-sign-identity",
      "Apple Development: Jane Doe (TEAMID)",
      "--ios-provisioning-profile",
      "./profiles/dev.mobileprovision",
      "samples/solitaire",
    ]);

    expect(args.iosDestination).toBe("device");
    expect(args.iosDevice).toBe("00008110-001234560E91801E");
    expect(args.iosSignIdentity).toBe("Apple Development: Jane Doe (TEAMID)");
    expect(args.iosProvisioningProfile).toBe("./profiles/dev.mobileprovision");
  });

  it("parses release packaging options", () => {
    const args = parseArgs([
      "node", "doof", "package",
      "--distdir", "artifacts",
      "--macos-signing", "ad-hoc",
      "--macos-sign-identity", "Developer ID Application: Example",
      "--macos-sandbox",
      "--macos-entitlements", "release.entitlements",
      "samples/solitaire",
    ]);

    expect(args.command).toBe("package");
    expect(args.distDir).toBe("artifacts");
    expect(args.macosSigning).toBe("ad-hoc");
    expect(args.macosSignIdentity).toBe("Developer ID Application: Example");
    expect(args.macosSandbox).toBe(true);
    expect(args.macosEntitlements).toBe("release.entitlements");
  });

  it("resolves signing settings in CLI, environment, manifest order", () => {
    const args = parseArgs([
      "node", "doof", "package",
      "--macos-sign-identity", "CLI Mac",
      "--ios-provisioning-profile", "cli.mobileprovision",
      "demo",
    ]);
    const resolved = resolvePackageSigningOverrides(args, {
      distDir: "/workspace/dist",
      macos: { signing: "ad-hoc", identity: "Manifest Mac", sandbox: true, entitlements: "/workspace/app.entitlements" },
      ios: { identity: "Manifest iOS", provisioningProfile: "/workspace/manifest.mobileprovision" },
    }, {
      DOOF_MACOS_SIGN_IDENTITY: "Environment Mac",
      DOOF_IOS_SIGN_IDENTITY: "Environment iOS",
      DOOF_IOS_PROVISIONING_PROFILE: "environment.mobileprovision",
    }, "/workspace");

    expect(resolved).toEqual({
      macos: {
        signing: "ad-hoc",
        identity: "CLI Mac",
        sandbox: true,
        entitlementsPath: "/workspace/app.entitlements",
      },
      ios: {
        identity: "Environment iOS",
        provisioningProfilePath: "/workspace/cli.mobileprovision",
      },
    });
  });
});

describe("CLI package resolution", () => {
  it("defaults to the current package when build runs without a path", () => {
    const fs = new VirtualFS({
      "/workspace/doof.json": JSON.stringify({ name: "workspace" }),
      "/workspace/main.do": "function main(): void {}",
    });
    const args = parseArgs(["node", "doof", "build"]);

    expect(resolveCliPipelineInputs(fs, "/workspace", args)).toEqual({
      entry: "/workspace/main.do",
      outDir: "/workspace/build/debug",
    });
  });

  it("resolves package directories through doof.json build settings", () => {
    const fs = new VirtualFS({
      "/workspace/demo/doof.json": JSON.stringify({
        name: "demo",
        build: {
          entry: "src/app.do",
          buildDir: "out/native",
        },
      }),
      "/workspace/demo/src/app.do": "function main(): void {}",
    });
    const args = parseArgs(["node", "doof", "build", "demo"]);

    expect(resolveCliPipelineInputs(fs, "/workspace", args)).toEqual({
      entry: "/workspace/demo/src/app.do",
      outDir: "/workspace/demo/out/native/debug",
    });
  });

  it("uses manifest buildDir defaults for explicit entry files", () => {
    const fs = new VirtualFS({
      "/workspace/doof.json": JSON.stringify({
        name: "workspace",
        build: {
          buildDir: "dist/generated",
        },
      }),
      "/workspace/src/app.do": "function main(): void {}",
    });
    const args = parseArgs(["node", "doof", "build", "src/app.do"]);

    expect(resolveCliPipelineInputs(fs, "/workspace", args)).toEqual({
      entry: "/workspace/src/app.do",
      outDir: "/workspace/dist/generated/debug",
    });
  });

  it("keeps an explicit outdir instead of manifest buildDir", () => {
    const fs = new VirtualFS({
      "/workspace/demo/doof.json": JSON.stringify({
        name: "demo",
        build: {
          buildDir: "out/native",
        },
      }),
      "/workspace/demo/main.do": "function main(): void {}",
    });
    const args = parseArgs(["node", "doof", "build", "-o", "custom-out", "demo"]);

    expect(resolveCliPipelineInputs(fs, "/workspace", args)).toEqual({
      entry: "/workspace/demo/main.do",
      outDir: "/workspace/custom-out/debug",
    });
  });

  it("resolves package release state and dist directories", () => {
    const fs = new VirtualFS({
      "/workspace/demo/doof.json": JSON.stringify({
        name: "demo",
        version: "2.3.4",
        build: { buildDir: "state", package: { distDir: "artifacts" } },
      }),
      "/workspace/demo/main.do": "function main(): void {}",
    });
    const args = parseArgs(["node", "doof", "package", "demo"]);

    expect(resolveCliPackageInputs(fs, "/workspace", args)).toMatchObject({
      entry: "/workspace/demo/main.do",
      outDir: "/workspace/demo/state/release",
      distDir: "/workspace/demo/artifacts",
      version: "2.3.4",
    });
  });
});

describe("CLI run settings", () => {
  it("defaults doof run timeout to unlimited", () => {
    expect(resolveRunTimeoutMs({})).toBe(0);
  });

  it("accepts an explicit doof run timeout", () => {
    expect(resolveRunTimeoutMs({ DOOF_RUN_TIMEOUT_MS: "45000" })).toBe(45000);
  });

  it("ignores invalid doof run timeout values", () => {
    expect(resolveRunTimeoutMs({ DOOF_RUN_TIMEOUT_MS: "nope" })).toBe(0);
    expect(resolveRunTimeoutMs({ DOOF_RUN_TIMEOUT_MS: "-10" })).toBe(0);
  });

  it("formats a clear timeout message", () => {
    expect(formatRunTimeoutMessage(45000)).toBe(
      "Program exceeded DOOF_RUN_TIMEOUT_MS=45000 and was terminated",
    );
  });
});

describe("CLI compile args", () => {
  it("materializes generated files without touching unchanged content on later runs", async () => {
    const outDir = createTempDir();
    const project = createProjectEmitResult();
    project.modules[0].cppCode = "int main() { return 0; }\n";
    const plan = createProjectMaterializePlan(project, outDir);

    const first = await reckon(plan.tasks, {
      cwd: path.parse(outDir).root,
      stateDirectory: path.join(outDir, ".reckon"),
    });
    const outputPath = path.join(outDir, "main.cpp");
    const firstMtime = fs.statSync(outputPath).mtimeMs;

    const second = await reckon(createProjectMaterializePlan(project, outDir).tasks, {
      cwd: path.parse(outDir).root,
      stateDirectory: path.join(outDir, ".reckon"),
    });
    const secondMtime = fs.statSync(outputPath).mtimeMs;

    expect(first.executed).toContain(outputPath.includes("\\") ? `write ${outputPath}` : `write ${outputPath}`);
    expect(second.executed).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(secondMtime).toBe(firstMtime);
  });

  it("rewrites only generated files whose content changes", async () => {
    const outDir = createTempDir();
    const project = createProjectEmitResult();
    project.modules[0].cppCode = "one\n";
    await reckon(createProjectMaterializePlan(project, outDir).tasks, {
      cwd: path.parse(outDir).root,
      stateDirectory: path.join(outDir, ".reckon"),
    });

    const cppPath = path.join(outDir, "main.cpp");
    const hppPath = path.join(outDir, "main.hpp");
    const firstCppMtime = fs.statSync(cppPath).mtimeMs;
    const firstHppMtime = fs.statSync(hppPath).mtimeMs;

    project.modules[0].cppCode = "two\n";
    await new Promise((resolve) => setTimeout(resolve, 10));
    await reckon(createProjectMaterializePlan(project, outDir).tasks, {
      cwd: path.parse(outDir).root,
      stateDirectory: path.join(outDir, ".reckon"),
    });

    expect(fs.readFileSync(cppPath, "utf8")).toBe("two\n");
    expect(fs.statSync(cppPath).mtimeMs).toBeGreaterThan(firstCppMtime);
    expect(fs.statSync(hppPath).mtimeMs).toBe(firstHppMtime);
  });

  it("plans gcc-like object compile tasks and a final link task", () => {
    const project = createProjectEmitResult();
    const materializePlan = createProjectMaterializePlan(project, "/tmp/doof-build");
    const graph = createNativeBuildGraphPlan(
      "/tmp/doof-build",
      project,
      { kind: "gcc-like", command: "clang++" },
      {
        cppStd: "c++20",
        includePaths: ["/opt/vendor/include"],
        libraryPaths: ["/opt/vendor/lib"],
        linkLibraries: ["curl"],
        frameworks: ["Foundation"],
        pkgConfigPackages: [],
        sourceFiles: ["/tmp/native/bridge.cpp"],
        objectFiles: ["/tmp/native/bridge.o"],
        compilerFlags: ["-O2"],
        linkerFlags: ["-pthread"],
        defines: ["DEBUG"],
      },
      materializePlan,
      "demo",
      { platform: "linux" },
    );

    expect(graph.outBinary).toBe("/tmp/doof-build/demo");
    expect(graph.tasks.map((task) => task.label)).toEqual(expect.arrayContaining([
      "compile /tmp/doof-build/main.cpp",
      "compile /tmp/native/bridge.cpp",
      "executable /tmp/doof-build/demo",
    ]));
    expect(graph.target.taskDependencies.map((task) => task.outputs[0])).toEqual(expect.arrayContaining([
      "/tmp/doof-build/.doof-objects/main.cpp.o",
      "/tmp/doof-build/.doof-objects/external/__doof_native_1_bridge.cpp.o",
    ]));
    expect(graph.target.fingerprint).toEqual(expect.any(String));
  });

  it("makes object compilation wait for copied native package files", () => {
    const outDir = createTempDir();
    const nativeDir = createTempDir();
    const nativeHeader = path.join(nativeDir, "native.hpp");
    fs.writeFileSync(nativeHeader, "#pragma once\n", "utf8");

    const project = createProjectEmitResult();
    project.outputNativeCopies = [{
      sourcePath: nativeHeader,
      relativePath: "deps/native/native.hpp",
      kind: "file",
    }];
    project.outputNativeIncludePaths = ["deps/native"];
    const materializePlan = createProjectMaterializePlan(project, outDir);
    const graph = createNativeBuildGraphPlan(
      outDir,
      project,
      { kind: "gcc-like", command: "clang++" },
      {
        cppStd: "c++20",
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
      },
      materializePlan,
      "demo",
      { platform: "linux" },
    );

    const compileTask = graph.tasks.find((task) => task.label === `compile ${path.join(outDir, "main.cpp")}`);
    expect(compileTask?.taskDependencies.map((task) => task.label)).toContain(
      `copy ${nativeHeader} -> ${path.join(outDir, "deps/native/native.hpp")}`,
    );
  });

  it("makes native compilation and linking wait for external dependency sentinels", () => {
    const outDir = createTempDir();
    const sentinelPath = path.join(outDir, "vendor", "hello", ".doof-external.json");
    const project = createProjectEmitResult();
    project.externalDependencySentinelPaths = [sentinelPath];
    const materializePlan = createProjectMaterializePlan(project, outDir);
    const graph = createNativeBuildGraphPlan(
      outDir,
      project,
      { kind: "gcc-like", command: "clang++" },
      {
        cppStd: "c++20",
        includePaths: [],
        libraryPaths: [path.join(outDir, "vendor", "hello", ".doof-build", "lib")],
        linkLibraries: ["hello"],
        frameworks: [],
        pkgConfigPackages: [],
        sourceFiles: [],
        objectFiles: [],
        compilerFlags: [],
        linkerFlags: [],
        defines: [],
      },
      materializePlan,
      "demo",
      { platform: "linux" },
    );

    const sentinelTask = graph.tasks.find((task) => task.label === `external dependency ${sentinelPath}`);
    const compileTask = graph.tasks.find((task) => task.label === `compile ${path.join(outDir, "main.cpp")}`);
    expect(sentinelTask?.outputs).toEqual([sentinelPath]);
    expect(compileTask?.taskDependencies.map((task) => task.label)).toContain(`external dependency ${sentinelPath}`);
    expect(graph.target.taskDependencies.map((task) => task.label)).toContain(`external dependency ${sentinelPath}`);
  });

});

describe("CLI version", () => {
  it("reads the version from package metadata", () => {
    const dir = createTempDir();
    const packageJsonPath = path.join(dir, "package.json");
    fs.writeFileSync(packageJsonPath, JSON.stringify({ version: "9.8.7" }));

    expect(getCliVersion(packageJsonPath)).toBe("9.8.7");
  });

  it("falls back when package metadata is unavailable", () => {
    const dir = createTempDir();

    expect(getCliVersion(path.join(dir, "missing-package.json"))).toBe("0.0.0");
  });
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-cli-"));
  tmpDirs.push(dir);
  return dir;
}

function createProjectEmitResult(): ProjectEmitResult {
  return {
    modules: [
      {
        modulePath: "/main.do",
        hppPath: "main.hpp",
        cppPath: "main.cpp",
        hppCode: "",
        cppCode: "",
      },
    ],
    runtime: "",
    supportFiles: [],
    outputNativeCopies: [],
    outputNativeIncludePaths: [],
    outputNativeSourceFiles: [],
    outputNativeLibraryPaths: [],
    externalDependencySentinelPaths: [],
  };
}
