import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { Program, ValidationError } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: ValidationError[] } {
  const lexer = new Lexer(code);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  if (!program.filename) {
    (program as any).filename = 'test.do';
  }
  const context = validator.validate(program);
  return { program, errors: context.errors };
}

describe('Readonly edge cases', () => {
  describe('readonly variable from mutable function return', () => {
    it('should mark array as readonly when assigned to readonly variable', () => {
      const code = `
        function getMutableArray(): int[] {
          return [1, 2, 3];
        }

        function main(): int {
          readonly v = getMutableArray();
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
    });

    it('should error when modifying element of readonly array from function return', () => {
      const code = `
        function getMutableArray(): int[] {
          return [1, 2, 3];
        }

        function main(): int {
          readonly v = getMutableArray();
          v[0] = 99;  // ERROR: cannot modify readonly array
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should error when assigning readonly array to mutable variable', () => {
      const code = `
        function main(): int {
          readonly v: int[] = [1, 2, 3];
          let w: int[] = v;  // ERROR: cannot assign readonly to mutable
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should error when pushing to readonly array', () => {
      const code = `
        function main(): int {
          readonly arr: int[] = [1, 2, 3];
          arr.push(4);  // ERROR: cannot modify readonly array
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('readonly Map modification', () => {
    it('should error when modifying element of readonly map', () => {
      const code = `
        function main(): int {
          readonly m: Map<string, int> = { "a": 1 };
          m["b"] = 2;  // ERROR: cannot modify readonly map
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });
  });

  describe('readonly return type', () => {
    it('should support readonly int[] as return type', () => {
      const code = `
        function getReadonlyArray(): readonly int[] {
          return [1, 2, 3];
        }

        function main(): int {
          let v = getReadonlyArray();
          v[0] = 99;  // Should ERROR: v infers readonly type from return
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should allow returning mutable array from readonly return type', () => {
      // Inside the function, we create a mutable array but it becomes readonly on return
      const code = `
        function getReadonlyArray(): readonly int[] {
          return [1, 2, 3];  // OK: array literal can be returned as readonly
        }

        function main(): int {
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
    });

    it('should propagate readonly to inferred variable type', () => {
      const code = `
        function getReadonlyArray(): readonly int[] {
          return [1, 2, 3];
        }

        function main(): int {
          let v = getReadonlyArray();  // v should be inferred as readonly int[]
          let w: int[] = v;  // ERROR: cannot assign readonly to mutable
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });
  });

  describe('readonly type display in error messages', () => {
    it('should show readonly in type mismatch errors', () => {
      const code = `
        function main(): int {
          readonly v: int[] = [1, 2, 3];
          let w: int[] = v;
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      // Error message should mention readonly to be clear about the issue
      const errorMsg = errors[0].message;
      expect(errorMsg).toContain('readonly');
    });
  });

  describe('passing readonly to mutable parameter', () => {
    it('should error when passing readonly array to function expecting mutable', () => {
      const code = `
        function takeMutableArray(arr: int[]): void {
          arr.push(5);
        }

        function main(): int {
          readonly arr: int[] = [1, 2, 3];
          takeMutableArray(arr);  // Should error
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });
  });

  describe('compound assignment on readonly', () => {
    it('should error on compound assignment to readonly array element', () => {
      const code = `
        function main(): int {
          readonly arr: int[] = [1, 2, 3];
          arr[0] += 10;  // Should error
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });
  });

  describe('deep readonly enforcement', () => {
    it('should allow readonly int[][] with deep immutability', () => {
      // Readonly arrays with nested arrays are valid - inner arrays become readonly too
      const code = `
        function main(): int {
          readonly nested: int[][] = [[1, 2], [3, 4]];
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should error when modifying outer array of readonly int[][]', () => {
      const code = `
        function main(): int {
          readonly nested: int[][] = [[1, 2], [3, 4]];
          nested[0] = [5, 6];
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should error when modifying inner array element of readonly int[][]', () => {
      const code = `
        function main(): int {
          readonly nested: int[][] = [[1, 2], [3, 4]];
          nested[0][0] = 99;
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should error when calling push on inner array of readonly int[][]', () => {
      const code = `
        function main(): int {
          readonly nested: int[][] = [[1, 2], [3, 4]];
          nested[0].push(5);
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Cannot call mutating method');
    });
  });

  describe('deep readonly for Maps', () => {
    it('should allow readonly Map<string, int[][]> with deep immutability', () => {
      const code = `
        function main(): int {
          readonly m: Map<string, int[][]> = {
            "identity": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
          };
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should error when calling set on readonly Map', () => {
      const code = `
        function main(): int {
          readonly m: Map<string, int[][]> = { "a": [[1]] };
          m.set("b", [[2]]);
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Cannot call mutating method');
    });

    it('should error when modifying array value from readonly Map', () => {
      const code = `
        function main(): int {
          readonly m: Map<string, int[][]> = { "a": [[1, 2, 3]] };
          let arr = m.get("a");
          arr[0] = [9, 9, 9];
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should error when modifying inner array element from readonly Map', () => {
      const code = `
        function main(): int {
          readonly m: Map<string, int[][]> = { "a": [[1, 2, 3]] };
          let arr = m.get("a");
          arr[0][0] = 99;
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });

    it('should propagate readonly through function returning readonly Map', () => {
      const code = `
        function getMatrix(): readonly Map<string, int[][]> {
          let m: Map<string, int[][]> = { "a": [[1]] };
          return m;
        }
        function main(): int {
          readonly m = getMatrix();
          m.set("b", [[2]]);
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Cannot call mutating method');
    });

    it('should error when modifying nested array from function returning readonly Map', () => {
      const code = `
        function getMatrix(): readonly Map<string, int[][]> {
          let m: Map<string, int[][]> = { "a": [[1, 2]] };
          return m;
        }
        function main(): int {
          readonly m = getMatrix();
          let arr = m.get("a");
          arr[0][0] = 99;
          return 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('readonly');
    });
  });

  describe('collection literals as readonly parameters', () => {
    it('should allow Map literal as readonly Map parameter', () => {
      const code = `
        function useMap(m: readonly Map<string, int>): int {
          return m.get("a");
        }
        function main(): int {
          return useMap({ "a": 1, "b": 2 });
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should allow Map literal as mutable parameter (shared_ptr semantics)', () => {
      const code = `
        function useMap(m: Map<string, int>): int {
          return m.get("a");
        }
        function main(): int {
          return useMap({ "a": 1 });
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should allow array literal as readonly array parameter', () => {
      const code = `
        function useArray(arr: readonly int[]): int {
          return arr[0];
        }
        function main(): int {
          return useArray([1, 2, 3]);
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should allow array literal as mutable parameter (shared_ptr semantics)', () => {
      const code = `
        function useArray(arr: int[]): int {
          return arr[0];
        }
        function main(): int {
          return useArray([1, 2, 3]);
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });

    it('should allow Set literal as readonly Set parameter', () => {
      const code = `
        function useSet(s: readonly Set<int>): bool {
          return s.has(1);
        }
        function main(): int {
          let result = useSet([1, 2, 3]);
          return result ? 1 : 0;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBe(0);
    });
  });
});
