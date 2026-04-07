import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  formatShellCommand,
  runPlaygroundSource,
  type PlaygroundRunnerHost,
} from "./playground-runner.js";

describe("playground runner", () => {
  it("returns compile failures before attempting a native build", () => {
    const result = runPlaygroundSource(`
      function main(): int {
        return "oops"
      }
    `);

    expect(result.status).toBe("compile-failed");
    expect(result.buildCommand).toBe("");
    expect(result.message).toContain("Semantic analysis failed");
  });

  it("builds and runs valid playground sources", () => {
    const writes = new Map<string, string>();
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnSyncOptions }> = [];
    const host = createHost({
      writeFile(filePath, contents) {
        writes.set(filePath, contents);
      },
      spawnFile(command, args, options) {
        calls.push({ command, args, options });
        if (command === "clang++") {
          return createSpawnResult({
            stdout: Buffer.from("build ok\n"),
            stderr: Buffer.from("warning: test warning\n"),
            status: 0,
          });
        }

        return createSpawnResult({
          stdout: Buffer.from("Hello from Doof\n"),
          stderr: Buffer.from(""),
          status: 0,
        });
      },
    });

    const result = runPlaygroundSource("function main(): int => 0", { host });

    expect(result.status).toBe("succeeded");
    expect(result.buildCommand).toContain("clang++");
    expect(result.buildStdout).toBe("build ok\n");
    expect(result.buildStderr).toBe("warning: test warning\n");
    expect(result.runStdout).toBe("Hello from Doof\n");
    expect(result.exitCode).toBe(0);
    expect(writes.get("/tmp/doof-playground-test/main.cpp")).toContain("main() {");
    expect(writes.get("/tmp/doof-playground-test/doof_runtime.hpp")).toContain("#pragma once");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toBe("/tmp/doof-playground-test/a.out");
  });

  it("returns compiler failures with captured stderr", () => {
    const host = createHost({
      spawnFile(command) {
        if (command === "clang++") {
          return createSpawnResult({
            stdout: Buffer.from(""),
            stderr: Buffer.from("main.cpp:1: error: nope\n"),
            status: 1,
          });
        }

        throw new Error("run step should not happen");
      },
    });

    const result = runPlaygroundSource("function main(): int => 0", { host });

    expect(result.status).toBe("build-failed");
    expect(result.message).toContain("main.cpp:1: error: nope");
    expect(result.runCommand).toBe("");
  });

  it("returns runtime failures with exit code and captured output", () => {
    const host = createHost({
      spawnFile(command) {
        if (command === "clang++") {
          return createSpawnResult({
            stdout: Buffer.from(""),
            stderr: Buffer.from(""),
            status: 0,
          });
        }

        return createSpawnResult({
          stdout: Buffer.from("before crash\n"),
          stderr: Buffer.from("boom\n"),
          status: 3,
        });
      },
    });

    const result = runPlaygroundSource("function main(): int => 0", { host });

    expect(result.status).toBe("run-failed");
    expect(result.exitCode).toBe(3);
    expect(result.runStdout).toBe("before crash\n");
    expect(result.runStderr).toBe("boom\n");
    expect(result.message).toContain("before crash");
  });
});

describe("shell formatting", () => {
  it("quotes arguments containing spaces", () => {
    expect(formatShellCommand(["clang++", "/tmp/My App/main.cpp"])).toBe(
      'clang++ "/tmp/My App/main.cpp"',
    );
  });
});

function createHost(overrides: Partial<PlaygroundRunnerHost>): PlaygroundRunnerHost {
  let nowValue = 100;

  return {
    now() {
      nowValue += 25;
      return nowValue;
    },
    createTempDir() {
      return "/tmp/doof-playground-test";
    },
    removeDir() {
      // noop for tests
    },
    writeFile() {
      // noop by default
    },
    spawnFile() {
      return createSpawnResult({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") });
    },
    resolveCompilerToolchain() {
      return { kind: "gcc-like", command: "clang++" };
    },
    ...overrides,
  };
}

function createSpawnResult(
  partial: Partial<SpawnSyncReturns<Buffer>>,
): SpawnSyncReturns<Buffer> {
  return {
    pid: 1,
    output: [Buffer.from(""), partial.stdout ?? Buffer.from(""), partial.stderr ?? Buffer.from("")],
    stdout: partial.stdout ?? Buffer.from(""),
    stderr: partial.stderr ?? Buffer.from(""),
    status: partial.status ?? 0,
    signal: partial.signal ?? null,
    error: partial.error,
  } as SpawnSyncReturns<Buffer>;
}