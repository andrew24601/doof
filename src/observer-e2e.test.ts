import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildCompilePlan, resolveCompilerToolchain, writeProject, type CompilerToolchain } from "./cli-core.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { emitProjectHelper } from "./emitter-test-helpers.js";

const tmpDirs: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  while (processes.length > 0) {
    const child = processes.pop();
    if (child && !child.killed) {
      child.kill();
    }
  }
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function nativeBuildOptions(): NativeBuildOptions {
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

function tryResolveToolchain(): CompilerToolchain | null {
  try {
    return resolveCompilerToolchain(null);
  } catch {
    return null;
  }
}

async function canBindLoopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForObserverUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for observer URL. Output:\n${output}`));
    }, 5000);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/DOOF_OBSERVE_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Observed program exited before URL. code=${code} signal=${signal}\n${output}`));
    });
  });
}

describe("observer runtime e2e", () => {
  it("compiles observer runtime support", () => {
    const toolchain = tryResolveToolchain();
    if (!toolchain) {
      console.warn("No C++ compiler found — skipping observer compile test");
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-observer-compile-"));
    tmpDirs.push(tmpDir);
    const project = emitProjectHelper({
      "/main.do": "function main(): void {}",
    }, "/main.do", { observe: true });
    writeProject(project, tmpDir, false, () => {});

    const nativeBuild = nativeBuildOptions();
    const compilePlan = buildCompilePlan(tmpDir, project, nativeBuild, { toolchain, mode: "syntax-only" });
    for (const command of compilePlan.commands) {
      execFileSync(command.command, command.args, {
        stdio: "pipe",
        cwd: tmpDir,
        timeout: 15000,
        env: toolchain.env ?? process.env,
      });
    }
  });

  it("serves metrics and dashboard assets from an observed program", async () => {
    const toolchain = tryResolveToolchain();
    if (!toolchain) {
      console.warn("No C++ compiler found — skipping observer e2e test");
      return;
    }
    if (!await canBindLoopback()) {
      console.warn("Loopback listening is unavailable — skipping observer e2e test");
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doof-observer-e2e-"));
    tmpDirs.push(tmpDir);
    const project = emitProjectHelper({
      "/main.do": `
        function main(): void {
          metricsIncrement("requests_total", 2L)
          while true {}
        }
      `,
    }, "/main.do", { observe: true });
    writeProject(project, tmpDir, false, () => {});

    const nativeBuild = nativeBuildOptions();
    const compilePlan = buildCompilePlan(tmpDir, project, nativeBuild, { toolchain });
    for (const command of compilePlan.commands) {
      execFileSync(command.command, command.args, {
        stdio: "pipe",
        cwd: tmpDir,
        timeout: 15000,
        env: toolchain.env ?? process.env,
      });
    }

    const child = spawn(compilePlan.outBinary, [], {
      stdio: ["ignore", "pipe", "pipe"],
      env: toolchain.env ?? process.env,
    });
    processes.push(child);
    const url = await waitForObserverUrl(child);

    const metricsResponse = await fetch(new URL("/api/metrics", url));
    const prometheusResponse = await fetch(new URL("/api/metrics/prometheus", url));
    const dashboardResponse = await fetch(url);

    expect(metricsResponse.ok).toBe(true);
    expect(prometheusResponse.ok).toBe(true);
    expect(dashboardResponse.ok).toBe(true);
    expect(await metricsResponse.json()).toEqual([{ name: "requests_total", value: 2 }]);
    expect(await prometheusResponse.text()).toContain("requests_total 2");
    expect(await dashboardResponse.text()).toContain("Doof Observer");
  });
});
