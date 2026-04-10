import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectEmitResult } from "./emitter-module.js";
import { buildCompileArgs, getCliVersion, parseArgs, resolveCliPipelineInputs } from "./cli.js";
import { VirtualFS } from "./test-helpers.js";

const tmpDirs: string[] = [];

afterEach(() => {
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
      outDir: "/workspace/build",
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
      outDir: "/workspace/demo/out/native",
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
      outDir: "/workspace/dist/generated",
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
      outDir: "custom-out",
    });
  });
});

describe("CLI compile args", () => {
  it("builds compiler arguments from native build options", () => {
    const project = createProjectEmitResult();

    const { outBinary, args } = buildCompileArgs("/tmp/doof-build", project, {
      cppStd: "gnu++20",
      includePaths: ["/opt/vendor/include"],
      libraryPaths: ["/opt/vendor/lib"],
      linkLibraries: ["curl", "ssl"],
      frameworks: ["Foundation"],
      pkgConfigPackages: [],
      sourceFiles: ["/tmp/native/bridge.cpp"],
      objectFiles: ["/tmp/native/bridge.o"],
      compilerFlags: ["-O2"],
      linkerFlags: ["-pthread"],
      defines: ["DEBUG", "API_LEVEL=2"],
    }, {
      platform: "linux",
      toolchain: { kind: "gcc-like", command: "clang++" },
    });

    expect(outBinary).toBe("/tmp/doof-build/a.out");
    expect(args).toContain("-std=gnu++20");
    expect(args).toContain("-I/tmp/doof-build");
    expect(args).toContain("-I/opt/vendor/include");
    expect(args).toContain("-DDEBUG");
    expect(args).toContain("-DAPI_LEVEL=2");
    expect(args).toContain("-O2");
    expect(args).toContain("/tmp/doof-build/main.cpp");
    expect(args).toContain("/tmp/native/bridge.cpp");
    expect(args).toContain("/tmp/native/bridge.o");
    expect(args).toContain("-L/opt/vendor/lib");
    expect(args).toContain("-lcurl");
    expect(args).toContain("-lssl");
    expect(args).toContain("-framework");
    expect(args).toContain("Foundation");
    expect(args).toContain("-pthread");
  });

  it("uses the configured output binary name when provided", () => {
    const project = createProjectEmitResult();

    const { outBinary, args } = buildCompileArgs("/tmp/doof-build", project, {
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
    }, {
      outputBinaryName: "demo-app",
      platform: "linux",
      toolchain: { kind: "gcc-like", command: "clang++" },
    });

    expect(outBinary).toBe("/tmp/doof-build/demo-app");
    expect(args).toContain("/tmp/doof-build/demo-app");
  });

  it.runIf(process.platform === "win32")("builds MSVC compiler arguments on Windows", () => {
    const project = createProjectEmitResult();

    const { outBinary, args } = buildCompileArgs("C:\\tmp\\doof-build", project, {
      cppStd: "gnu++20",
      includePaths: ["C:\\vendor\\include"],
      libraryPaths: ["C:\\vendor\\lib"],
      linkLibraries: ["curl", "ssl.lib"],
      frameworks: [],
      pkgConfigPackages: [],
      sourceFiles: ["C:\\tmp\\native\\bridge.cpp"],
      objectFiles: ["C:\\tmp\\native\\bridge.obj"],
      compilerFlags: ["/O2"],
      linkerFlags: ["/DEBUG"],
      defines: ["DEBUG", "API_LEVEL=2"],
    }, {
      outputBinaryName: "demo-app",
      platform: "win32",
      toolchain: { kind: "msvc", command: "cl.exe" },
    });

    expect(outBinary).toBe("C:\\tmp\\doof-build\\demo-app.exe");
    expect(args).toContain("/std:c++20");
    expect(args).toContain("/IC:\\tmp\\doof-build");
    expect(args).toContain("/IC:\\vendor\\include");
    expect(args).toContain("/DDEBUG");
    expect(args).toContain("/DAPI_LEVEL=2");
    expect(args).toContain("/O2");
    expect(args).toContain("C:\\tmp\\doof-build\\main.cpp");
    expect(args).toContain("C:\\tmp\\native\\bridge.cpp");
    expect(args).toContain("C:\\tmp\\native\\bridge.obj");
    expect(args).toContain("/FeC:\\tmp\\doof-build\\demo-app.exe");
    expect(args).toContain("/link");
    expect(args).toContain("/LIBPATH:C:\\vendor\\lib");
    expect(args).toContain("curl.lib");
    expect(args).toContain("ssl.lib");
    expect(args).toContain("/DEBUG");
  });

  it("builds syntax-only compiler arguments without linker inputs", () => {
    const project = createProjectEmitResult();

    const { outBinary, args } = buildCompileArgs("/tmp/doof-build", project, {
      cppStd: "c++17",
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
    }, {
      mode: "syntax-only",
      platform: "linux",
      toolchain: { kind: "gcc-like", command: "clang++" },
    });

    expect(outBinary).toBe("/tmp/doof-build/a.out");
    expect(args).toContain("-fsyntax-only");
    expect(args).not.toContain("-o");
    expect(args).not.toContain("/tmp/doof-build/a.out");
    expect(args).not.toContain("-L/opt/vendor/lib");
    expect(args).not.toContain("-lcurl");
    expect(args).not.toContain("-framework");
    expect(args).not.toContain("Foundation");
    expect(args).not.toContain("/tmp/native/bridge.o");
    expect(args).not.toContain("-pthread");
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
  };
}