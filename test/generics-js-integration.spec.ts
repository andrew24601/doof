import { describe, it, expect } from 'vitest';
import path from 'path';
import { Transpiler } from '../src/transpiler.js';

function normalize(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

describe('JS backend generics integration', () => {
  it('emits separate classes and functions per specialization', async () => {
    const transpiler = new Transpiler({ target: 'js', outputHeader: false, outputSource: true });
    const filePath = path.resolve(__dirname, '../integration/test-data/generics.do');
    const result = await transpiler.transpileProject([filePath]);

    expect(result.errors).toHaveLength(0);

    const out = result.files.get(filePath);
    expect(out).toBeDefined();
    const js = out?.source ?? '';
    const flat = normalize(js);

    // Functions are specialized
    expect(flat).toContain('function identity__primitive_int(');
    expect(flat).toContain('function identity__primitive_string(');

    // Classes are specialized per instantiation
    expect(flat).toContain('class Box__primitive_int');
    expect(flat).toContain('class Box__primitive_string');

    // Call sites rewritten, no generic syntax remains
    expect(flat).toContain('let number = identity__primitive_int(7)');
    expect(flat).toContain('let label = identity__primitive_string("generic")');
    expect(flat).not.toMatch(/identity<[^>]+>/);
    expect(flat).not.toMatch(/Box<[^>]+>/);
  });
});
