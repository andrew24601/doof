import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { transpileProjectWithDependencies } from '../src/transpiler.js';

async function makeDir(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

describe('transpileProjectWithDependencies', () => {
  let tempDir: string;
  let sourceRoot: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doof-transpile-deps-'));
    sourceRoot = path.join(tempDir, 'src');
    await makeDir(sourceRoot);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits C++ for entry file and dependencies', async () => {
    const mathPath = path.join(sourceRoot, 'math.do');
    const mainPath = path.join(sourceRoot, 'main.do');

    await makeDir(path.dirname(mathPath));

    await fs.writeFile(mathPath, `
export function add(a: int, b: int): int {
  return a + b;
}
`.trimStart());

    await fs.writeFile(mainPath, `
import { add } from "./math";

function main(): void {
  println(add(4, 5));
}
`.trimStart());

    const result = await transpileProjectWithDependencies(mainPath, {
      target: 'cpp',
      outputHeader: true,
      outputSource: true,
      sourceRoots: [sourceRoot]
    });

    expect(result.errors).toHaveLength(0);
    expect(result.files.size).toBe(2);
    expect(result.entryFile).toBe(mainPath);

    const mathOutput = result.files.get(mathPath);
    const mainOutput = result.files.get(mainPath);

    expect(mathOutput?.header ?? '').toContain('namespace math');
  expect(mainOutput?.header ?? '').toContain('#include "math.h"');
  });

  it('surfaces dependency resolution errors', async () => {
    const lonelyPath = path.join(sourceRoot, 'lonely.do');

    await fs.writeFile(lonelyPath, `
import { missing } from "./does-not-exist";

function main(): void {
  missing();
}
`.trimStart());

    const result = await transpileProjectWithDependencies(lonelyPath, {
      target: 'cpp',
      outputHeader: true,
      outputSource: true,
      sourceRoots: [sourceRoot]
    });

    expect(result.files.size).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    const messages = result.errors.map(err => err.message);
    expect(messages.some(msg => msg.includes('Unable to resolve import'))).toBe(true);
  });
});
