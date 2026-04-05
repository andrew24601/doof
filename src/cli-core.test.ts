import { describe, expect, it } from "vitest";
import {
  findNlohmannInclude,
  getDefaultOutputBinaryName,
  normalizeOutputBinaryName,
  resolveNlohmannInclude,
  resolveCompilerToolchain,
  tryFindCompilerToolchain,
} from "./cli-core.js";

describe("CLI compiler toolchains", () => {
  it("detects Visual Studio cl.exe on Windows via vswhere", () => {
    const toolchain = tryFindCompilerToolchain({
      platform: "win32",
      env: {
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      fileExists(filePath) {
        return filePath === "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe"
          || filePath === "C:\\VS\\VC\\Auxiliary\\Build\\vcvars64.bat"
          || filePath === "C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe";
      },
      execFile(command, args) {
        if (command === "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe") {
          expect(args).toEqual([
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
          ]);
          return Buffer.from("C:\\VS\r\n");
        }

        if (command === "cmd.exe") {
          expect(args).toEqual([
            "/d",
            "/c",
            "call",
            "C:\\VS\\VC\\Auxiliary\\Build\\vcvars64.bat",
            ">",
            "nul",
            "&&",
            "set",
          ]);
          return Buffer.from([
            "Path=C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64;C:\\Windows\\System32",
            "INCLUDE=C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\include",
            "LIB=C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\lib\\x64",
            "",
          ].join("\r\n"));
        }

        if (command === "C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe") {
          expect(args).toEqual(["/?"]);
          return Buffer.from("Microsoft (R) C/C++ Optimizing Compiler");
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    });

    expect(toolchain).toEqual({
      kind: "msvc",
      command: "C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe",
      env: expect.objectContaining({
        Path: expect.stringContaining("Hostx64\\x64"),
        INCLUDE: "C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\include",
      }),
    });
  });

  it("treats an explicit cl.exe override as an MSVC toolchain on Windows", () => {
    const toolchain = resolveCompilerToolchain("C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe", {
      platform: "win32",
      env: {
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      fileExists(filePath) {
        return filePath === "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe"
          || filePath === "C:\\VS\\VC\\Auxiliary\\Build\\vcvars64.bat"
          || filePath === "C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe";
      },
      execFile(command, args) {
        if (command === "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe") {
          return Buffer.from("C:\\VS\r\n");
        }

        if (command === "cmd.exe") {
          expect(args).toEqual([
            "/d",
            "/c",
            "call",
            "C:\\VS\\VC\\Auxiliary\\Build\\vcvars64.bat",
            ">",
            "nul",
            "&&",
            "set",
          ]);
          return Buffer.from([
            "PATH=C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64;C:\\Windows\\System32",
            "",
          ].join("\r\n"));
        }

        if (command.endsWith("cl.exe")) {
          expect(args).toEqual(["/?"]);
          return Buffer.from("Microsoft (R) C/C++ Optimizing Compiler");
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    });

    expect(toolchain.kind).toBe("msvc");
    expect(toolchain.command).toBe("C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe");
  });

  it("falls back to common Visual Studio install roots when vswhere fails", () => {
    const toolchain = tryFindCompilerToolchain({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      fileExists(filePath) {
        return filePath === "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
          || filePath === "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64\\cl.exe";
      },
      execFile(command, args) {
        if (command === "vswhere.exe" || command === "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe") {
          throw new Error("vswhere unavailable");
        }

        if (command === "cmd.exe") {
          expect(args).toEqual([
            "/d",
            "/c",
            "call",
            "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
            ">",
            "nul",
            "&&",
            "set",
          ]);
          return Buffer.from([
            "PATH=C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64;C:\\Windows\\System32",
            "",
          ].join("\r\n"));
        }

        if (command === "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64\\cl.exe") {
          expect(args).toEqual(["/?"]);
          return Buffer.from("Microsoft (R) C/C++ Optimizing Compiler");
        }

        throw new Error(`Unexpected command: ${command}`);
      },
    });

    expect(toolchain).toEqual({
      kind: "msvc",
      command: "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Tools\\MSVC\\14.50.35717\\bin\\Hostx64\\x64\\cl.exe",
      env: expect.objectContaining({
        PATH: expect.stringContaining("Hostx64\\x64"),
      }),
    });
  });
});

describe("CLI output binary naming", () => {
  it("uses platform-aware default binary names", () => {
    expect(getDefaultOutputBinaryName("linux")).toBe("a.out");
    expect(getDefaultOutputBinaryName("win32")).toBe("a.exe");
  });

  it("adds .exe on Windows when needed", () => {
    expect(normalizeOutputBinaryName("demo-app", "win32")).toBe("demo-app.exe");
    expect(normalizeOutputBinaryName("demo-app.exe", "win32")).toBe("demo-app.exe");
    expect(normalizeOutputBinaryName("demo-app", "linux")).toBe("demo-app");
  });
});

describe("CLI nlohmann/json include lookup", () => {
  it("prefers explicit include paths", () => {
    const includeDir = findNlohmannInclude(["C:\\vendor\\include"], {
      platform: "win32",
      env: {},
      fileExists(filePath) {
        return filePath === "C:\\vendor\\include\\nlohmann\\json.hpp";
      },
      execFile() {
        throw new Error("unexpected exec");
      },
    });

    expect(includeDir).toBe("C:\\vendor\\include");
  });

  it("checks vcpkg on Windows", () => {
    const includeDir = findNlohmannInclude([], {
      platform: "win32",
      env: {
        VCPKG_ROOT: "C:\\vcpkg",
      },
      fileExists(filePath) {
        return filePath === "C:\\vcpkg\\installed\\x64-windows\\include\\nlohmann\\json.hpp";
      },
      execFile() {
        throw new Error("unexpected exec");
      },
    });

    expect(includeDir).toBe("C:\\vcpkg\\installed\\x64-windows\\include");
  });

  it("falls back to provisioning when requested", () => {
    const includeDir = resolveNlohmannInclude([], {
      allowProvision: true,
      host: {
        platform: "win32",
        env: {},
        fileExists() {
          return false;
        },
        execFile() {
          throw new Error("unexpected exec");
        },
      },
      provisioner() {
        return "C:\\Users\\test\\.doof\\cache\\nlohmann-json\\v3.11.3\\include";
      },
    });

    expect(includeDir).toBe("C:\\Users\\test\\.doof\\cache\\nlohmann-json\\v3.11.3\\include");
  });
});