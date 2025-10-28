// Test file for multi-file transpiler functionality

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Transpiler } from '../src/transpiler.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { firstErrorMessage } from './helpers/error-helpers.js';

describe('Multi-file Transpiler', () => {
  let tempDir: string;
  let transpiler: Transpiler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doof-test-'));
    transpiler = new Transpiler({ sourceRoots: ['src'] });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });

  it('should transpile a simple multi-file project', async () => {
    // Create test files
    const file1Path = path.join(tempDir, 'src', 'math.do');
    const file2Path = path.join(tempDir, 'src', 'main.do');
    
    await fs.mkdir(path.dirname(file1Path), { recursive: true });
    await fs.mkdir(path.dirname(file2Path), { recursive: true });

    // math.do - exports a function
    await fs.writeFile(file1Path, `
export function add(a: int, b: int): int {
  return a + b;
}
`);

    // main.do - imports and uses the function
    await fs.writeFile(file2Path, `
import { add } from "./math";

function main(): void {
  println(add(2, 3));
}
`);

    const result = await transpiler.transpileProject([file1Path, file2Path]);

    expect(result.errors).toHaveLength(0);
    expect(result.files.size).toBe(2);
    expect(result.files.has(file1Path)).toBe(true);
    expect(result.files.has(file2Path)).toBe(true);
  });

  it('should handle namespace mapping with source roots', async () => {
    const filePath = path.join(tempDir, 'src', 'utils', 'helper.do');
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, `
export function helper(): void {
  // Helper function
}
`);

    const result = await transpiler.transpileProject([filePath]);

    expect(result.errors).toHaveLength(0);
    const exportsMap = (result.globalContext as any)?.exports;
    expect(exportsMap?.has('utils::helper::helper')).toBe(true);
  });

  it('should detect parse errors across multiple files', async () => {
    const file1Path = path.join(tempDir, 'src', 'good.do');
    const file2Path = path.join(tempDir, 'src', 'bad.do');
    
    await fs.mkdir(path.dirname(file1Path), { recursive: true });

    await fs.writeFile(file1Path, `
export function good(): void {
  // This is valid
}
`);

    await fs.writeFile(file2Path, `
export function bad(: {
  // This has syntax errors
}
`);

    const result = await transpiler.transpileProject([file1Path, file2Path]);

    expect(result.errors.length).toBeGreaterThan(0);
    const firstError = firstErrorMessage(result.errors);
    expect(firstError).toBeDefined();
    expect(firstError).toContain('bad.do');
  });

  it('produces relative namespaces and qualified imports', async () => {
    const helperPath = path.join(tempDir, 'src', 'helper.do');
    const mainPath = path.join(tempDir, 'src', 'main.do');

    await fs.mkdir(path.dirname(helperPath), { recursive: true });

    await fs.writeFile(helperPath, `
export class Foo {
  x: int;
  y: int;
}
`);

    await fs.writeFile(mainPath, `
import { Foo } from "./helper";

function main(): void {
  const foo: Foo = { x: 1, y: 2 };
  println(foo);
}
`);

    const result = await transpiler.transpileProject([helperPath, mainPath]);
    expect(result.errors).toHaveLength(0);

    const mainOutput = result.files.get(mainPath);
    expect(mainOutput?.source).toContain('namespace main {');
    expect(mainOutput?.source).toContain('std::shared_ptr<helper::Foo>');
    expect(mainOutput?.header).toContain('#include "helper.h"');

    const helperOutput = result.files.get(helperPath);
    expect(helperOutput?.source).toContain('namespace helper {');
  });

  it('transpiles multi-file projects to JavaScript with shared types', async () => {
    const fooPath = path.join(tempDir, 'src', 'Foo.do');
    const appPath = path.join(tempDir, 'src', 'app.do');

    await fs.mkdir(path.dirname(fooPath), { recursive: true });

    await fs.writeFile(fooPath, `
export class Foo {
  x: int;
  y: int;
}
`);

    await fs.writeFile(appPath, `
import { Foo } from "./Foo";

function main(): void {
  const foo: Foo = { x: 1, y: 2 };
  println(foo);
}
`);

    const jsTranspiler = new Transpiler({
      target: 'js',
      outputHeader: false,
      outputSource: true,
      sourceRoots: ['src']
    });

    const result = await jsTranspiler.transpileProject([fooPath, appPath]);

    expect(result.errors).toHaveLength(0);
    expect(result.files.size).toBe(2);

    const mainOutput = result.files.get(appPath)?.source ?? '';
    expect(mainOutput).toContain("import { Foo } from './Foo.js';");
    expect(mainOutput).not.toContain('import * as');
    expect(mainOutput).toContain('console.log');

    const fooOutput = result.files.get(fooPath)?.source ?? '';
    expect(fooOutput).not.toContain('import { Foo }');
    expect(fooOutput).not.toContain('import * as');
  });

  it('generates relative JS import paths for nested modules', async () => {
    const pointPath = path.join(tempDir, 'src', 'shared', 'Point.do');
    const featurePath = path.join(tempDir, 'src', 'features', 'main.do');

    await fs.mkdir(path.dirname(pointPath), { recursive: true });
    await fs.mkdir(path.dirname(featurePath), { recursive: true });

    await fs.writeFile(pointPath, `
export class Point {
  x: int;
  y: int;
}
`);

    await fs.writeFile(featurePath, `
import { Point } from "../shared/Point";

function main(): void {
  const origin: Point = { x: 0, y: 0 };
  println(origin);
}
`);

    const jsTranspiler = new Transpiler({
      target: 'js',
      outputHeader: false,
      outputSource: true,
      sourceRoots: ['src']
    });

    const result = await jsTranspiler.transpileProject([pointPath, featurePath]);

    expect(result.errors).toHaveLength(0);

    const featureOutput = result.files.get(featurePath)?.source ?? '';
    expect(featureOutput).toContain("import { Point } from '../shared/Point.js';");
    expect(featureOutput).not.toContain('import * as');

    const pointOutput = result.files.get(pointPath)?.source ?? '';
    expect(pointOutput).not.toContain('import { Point }');
    expect(pointOutput).not.toContain('import * as');
  });
});
