import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Transpiler } from '../src/transpiler';
import { writeVmGlueFiles } from '../src/vm-glue-writer';

async function createTempDir(prefix: string): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return base;
}

describe('writeVmGlueFiles', () => {
  it('generates glue artifacts for extern classes', async () => {
    const workspace = await createTempDir('doof-glue-extern-');
    const inputFile = path.join(workspace, 'extern_sample.do');
    const outputDir = path.join(workspace, 'glue-out');

    await fs.writeFile(
      inputFile,
      [
        'extern class Console {',
        '  static println(message: string): void;',
        '}',
        '',
        'class Program {',
        '  static main(): void {',
        '    Console.println("hi");',
        '  }',
        '}'
      ].join('\n')
    );

    const transpiler = new Transpiler({ target: 'cpp' });
    const result = await transpiler.transpileProject([inputFile]);

    expect(result.errors, 'expected transpilation errors array').toHaveLength(0);
    expect(result.globalContext, 'expected global context').toBeDefined();

    const glueResult = await writeVmGlueFiles(result.globalContext, { outputDir });

    expect(glueResult.externClassCount).toBe(1);
    expect(glueResult.generatedFiles).toHaveLength(4);

    const generatedNames = await fs.readdir(outputDir);
    expect(generatedNames.some(name => name.includes('Console'))).toBe(true);
    expect(generatedNames.some(name => name.includes('register_all'))).toBe(true);
  });

  it('returns zero when no extern classes are present', async () => {
    const workspace = await createTempDir('doof-glue-none-');
    const inputFile = path.join(workspace, 'simple.do');
    const outputDir = path.join(workspace, 'glue-out');

    await fs.writeFile(
      inputFile,
      [
        'class Greeter {',
        '  static greet(): void {',
        '    let name = "world";',
        '  }',
        '}'
      ].join('\n')
    );

    const transpiler = new Transpiler({ target: 'cpp' });
    const result = await transpiler.transpileProject([inputFile]);

    expect(result.errors).toHaveLength(0);
    expect(result.globalContext).toBeDefined();

    const glueResult = await writeVmGlueFiles(result.globalContext, { outputDir });

    expect(glueResult.externClassCount).toBe(0);
    expect(glueResult.generatedFiles).toHaveLength(0);

    await expect(fs.stat(outputDir)).rejects.toThrow();
  });
});
