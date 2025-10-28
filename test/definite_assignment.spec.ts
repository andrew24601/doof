import { describe, it, expect } from 'vitest';
import { transpileCode } from './util';

describe('Definite Assignment Analysis', () => {
  describe('Simple usage before assignment', () => {
    it('should error when using unassigned non-nullable variable', () => {
      const code = `
function test() {
  let x: string;
  let y: string = x; // Error: x used before assignment
}
`;
      const result = transpileCode(code);
      expect(result.errors.some(e => e.message.includes("Variable 'x' is used before being definitely assigned"))).toBe(true);
    });

    it('should not error when variable is assigned before use', () => {
      const code = `
function test() {
  let x: string;
  x = "hello";
  let y: string = x; // OK: x assigned before use
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });

    it('should not error for nullable variables', () => {
      const code = `
function test() {
  let x: string | null;
  let y: string | null = x; // OK: nullable variables can be used uninitialized
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });

    it('should not error when variable has initializer', () => {
      const code = `
function test() {
  let x: string = "hello";
  let y: string = x; // OK: x has initializer
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });
  });

  describe('Assignment operators', () => {
    it('should track assignments with = operator', () => {
      const code = `
function test() {
  let x: int;
  x = 42;
  let y: int = x; // OK
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });

    it('should error when using += before initial assignment', () => {
      const code = `
function test() {
  let x: int;
  x += 42; // Error: x not assigned yet (used in right side of +=)
}
`;
      const result = transpileCode(code);
      expect(result.errors.some(e => e.message.includes("Variable 'x' is used before being definitely assigned"))).toBe(true);
    });
  });

  describe('Control flow - If statements', () => {
    it('should error when variable is not assigned in all branches', () => {
      const code = `
function test() {
  let condition: bool = true;
  let x: string;
  if (condition) {
    x = "hello";
  }
  // else branch doesn't assign x
  let y: string = x; // Error: not definitely assigned
}
`;
      const result = transpileCode(code);
      expect(result.errors).not.toStrictEqual([]);
      expect(result.errors.some(e => e.message.includes("Variable 'x' is used before being definitely assigned"))).toBe(true);
    });

    it('should not error when variable is assigned in all branches', () => {
      const code = `
function test() {
  let condition: bool = true;
  let x: string;
  if (condition) {
    x = "hello";
  } else {
    x = "world";
  }
  let y: string = x; // OK: assigned in both branches
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });
  });

  describe('Parameter vs local variables', () => {
    it('should not error for parameters', () => {
      const code = `
function test(param: string) {
  let y: string = param; // OK: parameters are always assigned
}
`;
      const result = transpileCode(code);
      expect(result.errors.filter(e => e.message.includes("definitely assigned"))).toEqual([]);
    });

    it('should distinguish parameters from locals', () => {
      const code = `
function test(param: string) {
  let local: string;
  let y1: string = param; // OK: parameter
  let y2: string = local; // Error: local not assigned
}
`;
      const result = transpileCode(code);
      expect(result.errors.some(e => e.message.includes("Variable 'local' is used before being definitely assigned"))).toBe(true);
      expect(result.errors.filter(e => e.message.includes("Variable 'param' is used before being definitely assigned"))).toEqual([]);
    });
  });
});
