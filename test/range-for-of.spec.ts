import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';

describe('Range-based for-of loops', () => {
  it('should parse exclusive range for-of syntax', () => {
    const code = `
      function main(): int {
        for (const i of 0..<5) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = 0; i < 5; i++)');
  });

  it('should parse inclusive range for-of syntax', () => {
    const code = `
      function main(): int {
        for (const i of 1..5) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = 1; i <= 5; i++)');
  });

  it('should handle negative ranges', () => {
    const code = `
      function main(): int {
        for (const i of -5..5) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = -5; i <= 5; i++)');
  });

  it('should handle variable ranges', () => {
    const code = `
      function main(): int {
        let start = 1;
        let end = 10;
        for (const i of start..<end) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = start; i < end; i++)');
  });

  it('should validate that range bounds are integers', () => {
    const code = `
      function main(): int {
        let str = "hello";
        for (const i of str..5) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors.length).toBeGreaterThan(0);
    // Just check that there are errors - the specific error message may vary
  });

  it('should infer loop variable type as int', () => {
    const code = `
      function main(): int {
        for (const i of 0..10) {
          let doubled: int = i * 2;  // Should not cause type error
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
  });

  it('should handle ranges in nested loops', () => {
    const code = `
      function main(): int {
        for (const i of 0..<3) {
          for (const j of 0..<3) {
            println(i + j);
          }
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = 0; i < 3; i++)');
    expect(result.source).toContain('for (int j = 0; j < 3; j++)');
  });

  it('should work alongside regular collection for-of loops', () => {
    const code = `
      function main(): int {
        let arr: int[] = [1, 2, 3];
        for (const item of arr) {
          println(item);
        }
        for (const i of 0..<3) {
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (const auto& item : *arr)');
    expect(result.source).toContain('for (int i = 0; i < 3; i++)');
  });

  it('should handle let instead of const in range for-of', () => {
    const code = `
      function main(): int {
        for (let i of 0..5) {
          i = i + 1;  // Should work with let
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = 0; i <= 5; i++)');
  });

  it('should generate proper code for single-value ranges', () => {
    const code = `
      function main(): int {
        for (const i of 5..5) {  // Inclusive range with same start/end
          println(i);
        }
        return 0;
      }
    `;
    
    const result = transpile(code);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('for (int i = 5; i <= 5; i++)');
  });
});
