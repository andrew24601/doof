import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  embedAppleLibraries,
  type AppleEmbeddedLibraryHost,
} from "./apple-embedded-libraries.js";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("Apple embedded libraries", () => {
  it.skipIf(process.platform !== "darwin")("rewrites a real linked Mach-O dependency into an app bundle", () => {
    const root = makeTempDir();
    const source = path.join(root, "foreign.c");
    const main = path.join(root, "main.c");
    const library = path.join(root, "libforeign.dylib");
    const executable = path.join(root, "Demo");
    fs.writeFileSync(source, "int foreign_value(void) { return 42; }\n");
    fs.writeFileSync(main, "int foreign_value(void); int main(void) { return foreign_value() == 42 ? 0 : 1; }\n");
    execFileSync("clang", ["-dynamiclib", source, "-install_name", library, "-o", library]);
    execFileSync("clang", [main, `-L${root}`, "-lforeign", `-Wl,-rpath,${root}`, "-o", executable]);
    const frameworksDir = path.join(root, "Demo.app", "Contents", "Frameworks");

    embedAppleLibraries({
      executablePath: executable,
      frameworksDir,
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ library: "foreign" }],
      libraryPaths: [root],
      platform: "macos",
    });

    expect(execFileSync("otool", ["-L", executable], { encoding: "utf8" }))
      .toContain("@rpath/libforeign.dylib");
    expect(execFileSync("otool", ["-l", executable], { encoding: "utf8" })).not.toContain(`path ${root} `);
    expect(fs.existsSync(path.join(frameworksDir, "libforeign.dylib"))).toBe(true);
  });

  it("resolves a linked dylib, embeds its install-name basename, and rewrites the executable", () => {
    const root = makeTempDir();
    const executable = writeFile(root, "Demo");
    const libraryDir = path.join(root, "lib");
    const sourceLibrary = writeFile(libraryDir, "libSDL3.dylib");
    const frameworksDir = path.join(root, "Demo.app", "Contents", "Frameworks");
    const installId = "/opt/homebrew/opt/sdl3/lib/libSDL3.0.dylib";
    const fake = fakeMachOHost("1", new Map([
      ["Demo", [installId, "/usr/lib/libSystem.B.dylib"]],
      ["libSDL3.0.dylib", ["/usr/lib/libSystem.B.dylib"]],
    ]), new Map([[sourceLibrary, installId]]));

    embedAppleLibraries({
      executablePath: executable,
      frameworksDir,
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ library: "SDL3" }],
      libraryPaths: [libraryDir],
      platform: "macos",
      host: fake.host,
    });

    expect(fs.existsSync(path.join(frameworksDir, "libSDL3.0.dylib"))).toBe(true);
    expect(fake.dependencies.get("Demo")).toContain("@rpath/libSDL3.0.dylib");
    expect(fake.calls).toContainEqual([
      "install_name_tool", "-id", "@rpath/libSDL3.0.dylib", path.join(frameworksDir, "libSDL3.0.dylib"),
    ]);
    expect(fake.calls).toContainEqual([
      "install_name_tool", "-add_rpath", "@executable_path/../Frameworks", executable,
    ]);
  });

  it("preserves framework structure for an iOS simulator bundle", () => {
    const root = makeTempDir();
    const executable = writeFile(root, "Demo");
    const framework = path.join(root, "vendor", "Foo.framework");
    const frameworkBinary = writeFile(framework, "Foo");
    const frameworksDir = path.join(root, "Demo.app", "Frameworks");
    const installId = "/vendor/Foo.framework/Foo";
    const fake = fakeMachOHost("7", new Map([
      ["Demo", [installId, "/usr/lib/libSystem.B.dylib"]],
      ["Foo", ["/usr/lib/libSystem.B.dylib"]],
    ]), new Map([[frameworkBinary, installId]]));

    embedAppleLibraries({
      executablePath: executable,
      frameworksDir,
      executableFrameworkRPath: "@executable_path/Frameworks",
      embeddedLibraries: [{ path: framework }],
      libraryPaths: [],
      platform: "ios-simulator",
      host: fake.host,
    });

    expect(fs.existsSync(path.join(frameworksDir, "Foo.framework", "Foo"))).toBe(true);
    expect(fake.dependencies.get("Demo")).toContain("@rpath/Foo.framework/Foo");
  });

  it("rejects undeclared non-system transitive dependencies", () => {
    const root = makeTempDir();
    const executable = writeFile(root, "Demo");
    const libraryDir = path.join(root, "lib");
    const sourceLibrary = writeFile(libraryDir, "libA.dylib");
    const installId = "/vendor/libA.dylib";
    const fake = fakeMachOHost("1", new Map([
      ["Demo", [installId]],
      ["libA.dylib", ["/vendor/libB.dylib"]],
    ]), new Map([[sourceLibrary, installId]]));

    expect(() => embedAppleLibraries({
      executablePath: executable,
      frameworksDir: path.join(root, "Frameworks"),
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ library: "A" }],
      libraryPaths: [libraryDir],
      platform: "macos",
      host: fake.host,
    })).toThrow("libB.dylib, which is not listed in embeddedLibraries");
  });

  it("rejects static archives, duplicate destinations, and incompatible targets", () => {
    const root = makeTempDir();
    const executable = writeFile(root, "Demo");
    const staticLibrary = writeFile(root, "libBad.a");
    const fake = fakeMachOHost("1", new Map([["Demo", []]]), new Map());
    expect(() => embedAppleLibraries({
      executablePath: executable,
      frameworksDir: path.join(root, "Frameworks"),
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ path: staticLibrary }],
      libraryPaths: [],
      platform: "macos",
      host: fake.host,
    })).toThrow("static archive");

    const library = writeFile(root, "libSame.dylib");
    const incompatible = fakeMachOHost("2", new Map([
      ["Demo", [library]], ["libSame.dylib", []],
    ]), new Map([[library, library]]));
    expect(() => embedAppleLibraries({
      executablePath: executable,
      frameworksDir: path.join(root, "Frameworks2"),
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ path: library }, { path: library }],
      libraryPaths: [],
      platform: "macos",
      host: incompatible.host,
    })).toThrow(/targets 2|Duplicate embedded library destination/);

    const duplicate = fakeMachOHost("1", new Map([
      ["Demo", [library]], ["libSame.dylib", []],
    ]), new Map([[library, library]]));
    expect(() => embedAppleLibraries({
      executablePath: executable,
      frameworksDir: path.join(root, "Frameworks3"),
      executableFrameworkRPath: "@executable_path/../Frameworks",
      embeddedLibraries: [{ path: library }, { path: library }],
      libraryPaths: [],
      platform: "macos",
      host: duplicate.host,
    })).toThrow("Duplicate embedded library destination");
  });
});

function makeTempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doof-apple-embed-test-"));
  tempDirs.push(root);
  return root;
}

function writeFile(directory: string, name: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, "mach-o");
  return filePath;
}

function fakeMachOHost(
  platform: string,
  dependencies: Map<string, string[]>,
  installIds: Map<string, string>,
): { host: AppleEmbeddedLibraryHost; calls: string[][]; dependencies: Map<string, string[]> } {
  const calls: string[][] = [];
  const rpaths = new Map<string, string[]>();
  const host: AppleEmbeddedLibraryHost = {
    execFile(command, args) {
      calls.push([command, ...args]);
      const codePath = args.at(-1) ?? "";
      const key = path.basename(codePath);
      if (command === "lipo") return "arm64";
      if (command === "otool" && args[0] === "-D") {
        return `${codePath}:\n${installIds.get(codePath) ?? installIds.get(key) ?? codePath}`;
      }
      if (command === "otool" && args[0] === "-L") {
        return [`${codePath}:`, ...(dependencies.get(key) ?? []).map((item) =>
          `\t${item} (compatibility version 1.0.0, current version 1.0.0)`)].join("\n");
      }
      if (command === "otool" && args[0] === "-l") {
        return [
          "Load command 0", "      cmd LC_BUILD_VERSION", ` platform ${platform}`,
          ...(rpaths.get(key) ?? []).flatMap((item) => ["      cmd LC_RPATH", `     path ${item} (offset 12)`]),
        ].join("\n");
      }
      if (command === "install_name_tool" && args[0] === "-change") {
        const values = dependencies.get(key) ?? [];
        dependencies.set(key, values.map((item) => item === args[1] ? args[2] : item));
        return "";
      }
      if (command === "install_name_tool" && args[0] === "-add_rpath") {
        rpaths.set(key, [...(rpaths.get(key) ?? []), args[1]]);
        return "";
      }
      if (command === "install_name_tool" && args[0] === "-delete_rpath") {
        rpaths.set(key, (rpaths.get(key) ?? []).filter((item) => item !== args[1]));
        return "";
      }
      if (command === "install_name_tool" && args[0] === "-id") return "";
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };
  return { host, calls, dependencies };
}
import { execFileSync } from "node:child_process";
