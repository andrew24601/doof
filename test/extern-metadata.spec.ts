import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

function transpileSnippet(source: string) {
  const transpiler = new Transpiler({ target: 'cpp', validate: true });
  return transpiler.transpile(source, 'test.do');
}

describe('Extern metadata collection', () => {
  it('collects metadata for extern class declarations', () => {
    const source = `
      extern class Foo {
        field: int;
        static create(value: int): Foo;
        function clear(): void;
      }
    `;

    const result = transpileSnippet(source);
    expect(result.errors).toHaveLength(0);
    expect(result.externMetadata).toBeDefined();

    const fooMeta = result.externMetadata!.find(meta => meta.name === 'Foo');
    expect(fooMeta).toBeDefined();
    expect(fooMeta!.header).toBe('Foo.h');
    expect(fooMeta!.fields).toEqual([
      { name: 'field', type: 'int', isStatic: false }
    ]);
    expect(fooMeta!.methods).toEqual([
      {
        name: 'create',
        isStatic: true,
        returnType: 'Foo',
        parameters: [{ name: 'value', type: 'int' }]
      },
      {
        name: 'clear',
        isStatic: false,
        returnType: 'void',
        parameters: []
      }
    ]);
  });

  it('includes built-in extern metadata such as StringBuilder', () => {
    const result = transpileSnippet('function noop(): void {}');
    expect(result.errors).toHaveLength(0);
    expect(result.externMetadata).toBeDefined();

    const stringBuilderMeta = result.externMetadata!.find(meta => meta.name === 'StringBuilder');
    expect(stringBuilderMeta).toBeDefined();
    expect(stringBuilderMeta!.header).toBe('doof_runtime.h');
    const createMethod = stringBuilderMeta!.methods.find(m => m.name === 'create');
    expect(createMethod).toBeDefined();
    expect(createMethod!.isStatic).toBe(true);
    expect(createMethod!.returnType).toBe('StringBuilder');
  });
});
