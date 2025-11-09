import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler';

function transpileWith(source: string, filename = 'sample.do', emitLineDirectives = true) {
  const t = new Transpiler({ target: 'cpp', outputHeader: true, outputSource: true, emitLineDirectives });
  const res = t.transpile(source, filename);
  if (res.errors.length > 0) {
    const details = res.errors.map(e => `${e.filename}:${e.line}:${e.column} ${e.message}`).join('\n');
    throw new Error(`Transpilation failed:\n${details}`);
  }
  return res;
}

describe('#line directive emission', () => {
  it('emits #line directives when enabled', () => {
    const input = `
      function add(a: int, b: int): int {
        let x = a + b;
        return x;
      }
    `;
    const result = transpileWith(input, 'test.do', true);
    expect(result.source).toContain('#line');
    expect(result.source).toContain('"test.do"');
  });

  it('does not emit #line directives when disabled', () => {
    const input = `
      function add(a: int, b: int): int {
        let x = a + b;
        return x;
      }
    `;
    const result = transpileWith(input, 'test.do', false);
    expect(result.source).not.toContain('\n#line ');
  });
});
