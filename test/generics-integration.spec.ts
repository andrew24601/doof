import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Transpiler } from '../src/transpiler.js';

describe('Generics integration', () => {
  let tempDir: string;
  let transpiler: Transpiler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doof-generics-'));
    transpiler = new Transpiler({ sourceRoots: ['src'] });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('specializes generic functions across modules and rewrites call sites', async () => {
    const srcDir = path.join(tempDir, 'src');
    const libPath = path.join(srcDir, 'lib.do');
    const mainPath = path.join(srcDir, 'main.do');

    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(libPath, `
export function identity<T>(value: T): T {
  return value;
}
`);

    await fs.writeFile(mainPath, `
import { identity } from "./lib";

function run(): int {
  let number = identity<int>(7);
  return number;
}
`);

    const result = await transpiler.transpileProject([libPath, mainPath]);

    expect(result.errors).toHaveLength(0);

    const libOutput = result.files.get(libPath);
    expect(libOutput).toBeDefined();
    expect(libOutput?.header ?? '').toContain('identity__primitive_int');
    expect(libOutput?.source ?? '').toContain('identity__primitive_int');

    const mainOutput = result.files.get(mainPath);
    expect(mainOutput).toBeDefined();
    const mainSource = mainOutput?.source ?? '';
    expect(mainSource).toContain('identity__primitive_int(7)');
    expect(mainSource).not.toContain('identity<int>');
  });
});
