import * as nodePath from "node:path";
import { ModuleResolver, type FileSystem, type ResolverOptions } from "./resolver.js";

export const BUNDLED_STDLIB_ROOT = nodePath.resolve(nodePath.sep, "__doof_stdlib__");

const BUNDLED_MODULES = new Map<string, string>([
  [
    nodePath.join(BUNDLED_STDLIB_ROOT, "std", "assert.do"),
    [
      "export class Assert {",
      "    static equal(actual: any, expected: any, message: string | null = null): void {",
      "        if actual == expected {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected values to be equal\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected values to be equal\")",
      "        }",
      "    }",
      "",
      "    static notEqual(actual: any, expected: any, message: string | null = null): void {",
      "        if !(actual == expected) {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected values to differ\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected values to differ\")",
      "        }",
      "    }",
      "",
      "    static isTrue(value: bool, message: string | null = null): void {",
      "        if value {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected value to be true\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected value to be true\")",
      "        }",
      "    }",
      "",
      "    static isFalse(value: bool, message: string | null = null): void {",
      "        if !value {",
      "            return",
      "        }",
      "        if message == null {",
      "            assert(false, \"expected value to be false\")",
      "        } else {",
      "            assert(false, (message ?? \"\") + \": expected value to be false\")",
      "        }",
      "    }",
      "",
      "    static fail(message: string | null = null): void {",
      "        if message == null {",
      "            assert(false, \"test failed\")",
      "        } else {",
      "            assert(false, message ?? \"test failed\")",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n"),
  ],
]);

class BundledStdlibFS implements FileSystem {
  constructor(private readonly fallback: FileSystem) {}

  readFile(absolutePath: string): string | null {
    return BUNDLED_MODULES.get(absolutePath) ?? this.fallback.readFile(absolutePath);
  }

  fileExists(absolutePath: string): boolean {
    return BUNDLED_MODULES.has(absolutePath) || this.fallback.fileExists(absolutePath);
  }
}

export function withBundledStdlib(fileSystem: FileSystem): FileSystem {
  return new BundledStdlibFS(fileSystem);
}

export function createBundledModuleResolver(
  fileSystem: FileSystem,
  options: ResolverOptions = {},
): ModuleResolver {
  return new ModuleResolver(withBundledStdlib(fileSystem), {
    ...options,
    stdlibRoot: options.stdlibRoot ?? BUNDLED_STDLIB_ROOT,
  });
}