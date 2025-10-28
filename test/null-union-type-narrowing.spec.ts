import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';
import { errorMessages, errorsInclude } from './helpers/error-helpers.js';

function transpile(code: string) {
  const transpiler = new Transpiler();
  return transpiler.transpile(code, 'test.do');
}

describe('Null Union Type Narrowing', () => {
  describe('Basic Null Union Type Mappings', () => {
    it('collapses User | null to shared_ptr', () => {
      const code = `class User { name: string = ''; } let x: User | null;`;
      const result = transpile(code);
      expect(result.source).toContain('std::shared_ptr<User> x;');
    });

    it('collapses int | null to optional', () => {
      const code = `let y: int | null;`;
      const result = transpile(code);
      expect(result.source).toContain('std::optional<int> y;');
    });

    it('User | Error | null is a variant', () => {
      const code = `class User { name: string = ''; } class Error { message: string = ''; } let z: User | Error | null;`;
      const result = transpile(code);
      expect(result.source).toContain('std::optional<std::variant<std::shared_ptr<User>, std::shared_ptr<Error>>> z;');
    });

    it('string | int | null is a variant', () => {
      const code = `let w: string | int | null;`;
      const result = transpile(code);
      expect(result.source).toContain('std::optional<std::variant<std::string, int>> w;');
    });

    it('null is nullptr_t', () => {
      const code = `let a: null;`;
      const result = transpile(code);
      expect(result.source).toContain('std::nullptr_t a;');
    });

    it('User | null | null deduplicates null', () => {
      const code = `class User { name: string = ''; } let b: User | null | null;`;
      const result = transpile(code);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain("Duplicate type 'null' in union");
    });

    it('User | null | int is a variant', () => {
      const code = `class User { name: string = ''; } let c: User | null | int;`;
      const result = transpile(code);
      expect(result.source).toContain('std::optional<std::variant<std::shared_ptr<User>, int>> c;');
    });
  });

  describe('Type Narrowing with Simple Nullable Types', () => {
    it('narrow User | null to User using type guard', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null): void {
          if (z is User) {
            // Should be able to access User methods without std::get
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('if');
      // The narrowed access should be direct since User | null -> shared_ptr<User>
    });

    it('narrow User | null to null using type guard', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null): void {
          if (z is null) {
            // z is null here
          } else {
            // z is User here
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('if');
    });

    it('narrow User | null using != null comparison', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null): void {
          if (z != null) {
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('narrow User | null using == null comparison', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null): void {
          if (z == null) {
            // z is null here
          } else {
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('narrow int | null to int using type guard', () => {
      const code = `
        function test(z: int | null): void {
          if (z is int) {
            // z is int here, should be able to do math
            let result = z + 5;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('if');
    });

    it('narrow int | null to null using type guard', () => {
      const code = `
        function test(z: int | null): void {
          if (z is null) {
            // z is null here
          } else {
            // z is int here
            let result = z * 2;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('if');
    });

    it('narrow nullable field access through parent null comparison', () => {
      const code = `
        class Bar { subfield: int = 1; }
        class Foo { field: Bar | null = null; }
        function use(foo: Foo): int {
          if (foo.field != null) {
            return foo.field.subfield;
          }
          return 0;
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('narrow nullable field access in else branch of equality comparison', () => {
      const code = `
        class Bar { subfield: int = 1; }
        class Foo { field: Bar | null = null; }
        function use(foo: Foo): int {
          if (foo.field == null) {
            return 0;
          } else {
            return foo.field.subfield;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('Type Narrowing with Complex Variants', () => {
    it('narrow User | Error | null to User (variant stays variant)', () => {
      const code = `
        class User { name: string = ''; }
        class Error { message: string = ''; }
        function test(z: User | Error | null): void {
          if (z is User) {
            // z is narrowed to User, but should still use std::get since original was variant
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('if');
      // Should use std::get for variant access after narrowing
      expect(result.source).toContain('std::get<');
    });

    it('narrow User | Error | null to Error (variant stays variant)', () => {
      const code = `
        class User { name: string = ''; }
        class Error { message: string = ''; }
        function test(z: User | Error | null): void {
          if (z is Error) {
            // z is narrowed to Error, but should still use std::get since original was variant
            let msg = z.message;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('if');
      // Should use std::get for variant access after narrowing
      expect(result.source).toContain('std::get<');
    });

    it('narrow User | Error | null to null (variant stays variant)', () => {
      const code = `
        class User { name: string = ''; }
        class Error { message: string = ''; }
        function test(z: User | Error | null): void {
          if (z is null) {
            // z is null here
          } else {
            // z is User | Error here, still a variant
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('if');
    });

    it('narrow string | int | null to int (variant stays variant)', () => {
      const code = `
        function test(z: string | int | null): void {
          if (z is int) {
            // z is narrowed to int, but should still use std::get since original was variant
            let result = z + 5;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('if');
      // Should use std::get for variant access after narrowing
      expect(result.source).toContain('std::get<');
    });

    it('narrow string | int | null to string (variant stays variant)', () => {
      const code = `
        function test(z: string | int | null): void {
          if (z is string) {
            // z is narrowed to string, but should still use std::get since original was variant
            let len = z.length;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('if');
      // Should use std::get for variant access after narrowing
      expect(result.source).toContain('std::get<');
    });

    it('narrow string | int | null in else branch (should be int | null variant)', () => {
      const code = `
        function test(z: string | int | null): void {
          if (z is string) {
            let len = z.length;
          } else {
            // z is int | null here, but still in variant form
            if (z is int) {
              let result = z + 1;
            }
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('if');
    });
  });

  describe('Assignment and Flow Control', () => {
    it('assignment after narrowing maintains type safety', () => {
      const code = `
        class User { name: string = ''; }
        class Error { message: string = ''; }
        function test(): void {
          let original: User | Error | null;
          let narrowed: User | Error | null;
          
          if (original is User) {
            // This assignment should be valid
            narrowed = original;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBe(0);
    });

    it('nested type narrowing preserves variant nature', () => {
      const code = `
        class User { name: string = ''; }
        class Admin { role: string = ''; }
        class Error { message: string = ''; }
        function test(z: User | Admin | Error | null): void {
          if (z is User) {
            let name = z.name;
          } else if (z is Admin) {
            let role = z.role;
          } else if (z is Error) {
            let msg = z.message;
          } else {
            // z is null here
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      // Each narrowed access should use std::get since original was a variant
      expect(result.source).toContain('std::get<');
    });

    it('type narrowing in different scopes', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null): void {
          if (z is User) {
            let name = z.name;
            
            // In nested scope, z should still be narrowed to User
            {
              let anotherName = z.name;
            }
          }
          // Outside the if block, z is back to User | null
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('handles union with multiple null occurrences', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: User | null | null): void {
          if (z is User) {
            let name = z.name;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBeGreaterThan(0);
  const messages = errorMessages(result.errors);
  expect(messages[0]).toContain("Duplicate type 'null' in union");
    });

    it('handles complex union ordering', () => {
      const code = `
        class User { name: string = ''; }
        function test(z: null | User | int): void {
          if (z is User) {
            let name = z.name;
          } else if (z is int) {
            let result = z + 1;
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors).toStrictEqual([]);
      // Should be a variant regardless of null position
      expect(result.source).toContain('std::variant<');
    });

    it('validates impossible narrowing', () => {
      const code = `
        class User { name: string = ''; }
        class Error { message: string = ''; }
        function test(z: User | null): void {
          if (z is Error) {
            // This should be an error - Error is not in the union
          }
        }
      `;
      const result = transpile(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(errorsInclude(result.errors, 'will never be true')).toBe(true);
    });
  });
});
