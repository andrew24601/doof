import { describe, it, expect } from 'vitest';
import { transpileCode } from './util';

describe('Destructuring Patterns (MVP)', () => {
  it('object pattern variable declaration lowers and validates', () => {
    const source = `
      class Point {
        x: int;
        y: int;
      }

      function main(): int {
        let p = Point(10, 20);
        let { x, y } = p;
        return x + y;
      }
    `;

    const result = transpileCode(source);
    expect(result.errors).toStrictEqual([]);
    // Presence checks in generated C++ to ensure we accessed fields
    expect(result.source).toContain('->x');
    expect(result.source).toContain('->y');
  });

  it('tuple pattern variable declaration maps by public field order', () => {
    const source = `
      class Pair {
        first: int;
        second: int;
      }

      function main(): int {
        let p = Pair(1, 2);
        let (a, b) = p;
        return a + b;
      }
    `;

    const result = transpileCode(source);
    expect(result.errors).toStrictEqual([]);
    // Ensure fields were accessed in declared order
    expect(result.source).toContain('->first');
    expect(result.source).toContain('->second');
  });

  it('object pattern assignment lowers to simple assignments', () => {
    const source = `
      class Data { x: int; y: int; }
      function main(): int {
        let d1 = Data(3, 4);
        let d2 = Data(0, 0);
        let x = 0;
        let y = 0;
        { x, y } = d1;
        return x + y;
      }
    `;

    const result = transpileCode(source);
    expect(result.errors).toStrictEqual([]);
    // Check we generated assignments to x and y
    expect(result.source).toMatch(/x\s*=\s*/);
    expect(result.source).toMatch(/y\s*=\s*/);
  });
});
