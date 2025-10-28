import { describe, test, expect } from 'vitest';
import { transpile } from '../src/transpiler.js';

describe('Simple Null Safety Test', () => {
  test('basic null coalescing should work', () => {
    const input = `
      let a: int | null = 5;
      let b = a ?? 10;
    `;
    
    const result = transpile(input);
  // debug logs removed
    
    expect(result.source).toContain('has_value');
  });
});
