import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler';
import { errorMessages } from './helpers/error-helpers.js';

describe('Null Safety Operators', () => {
  describe('Null Coalescing Operator (??)', () => {
    it('should handle basic null coalescing', () => {
      const input = `
        let a: int | null = 5;
        let b = a ?? 10;
      `;
      
      const result = transpile(input);
      const cpp = result.source || '';
      expect(cpp).toContain('has_value');
    });

    it('should handle chained null coalescing', () => {
      const input = `
        let a: int | null = null;
        let b: int | null = null;
        let c = a ?? b ?? 10;
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      // Should be right-associative: a ?? (b ?? c)
      expect(cpp).toContain('has_value');
    });

    it('should handle null coalescing with objects', () => {
      const input = `
        class User {
            name: string;
        }
        
        let user: User | null = null;
        let defaultUser = User("fred");
        let result = user ?? defaultUser;
      `;
      
      const result = transpile(input);
      const cpp = result.source || '';
      expect(cpp).toContain('user ? user : defaultUser');
    });
  });

  describe('Optional Chaining Operator (?.)', () => {
    it('should handle property access with optional chaining', () => {
      const input = `
        class User {
            name: string;
        }
        
        function test(user: User | null): string | null {
            return user?.name;
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('?');
      expect(cpp).toContain('nullopt');
    });

    it('should handle method calls with optional chaining', () => {
      const input = `
        class User {
            getName(): string { return this.name; }
            name: string = "";
        }
        
        function test(user: User | null): string | null {
            return user?.getName();
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      // Should generate ternary operator for optional chaining
      expect(cpp).toContain('? user->getName() : nullptr');
    });

    it('should return nullptr for pointer-returning optional chain methods', () => {
      const input = `
        class Node {
            next(): Node | null { return this; }
        }

        function advance(node: Node | null): Node | null {
            return node?.next();
        }
      `;

      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('? node->next() : nullptr');
      expect(cpp).not.toContain('std::make_optional');
    });

    it('should wrap value types from optional chain methods in std::optional', () => {
      const input = `
        class User {
            getGreeting(): string { return "hi"; }
        }

        function greet(user: User | null): string | null {
            return user?.getGreeting();
        }
      `;

      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
    expect(cpp).toContain('std::optional<std::string> greet(std::shared_ptr<User> user) {');
    expect(cpp).toContain('return (user ? user->getGreeting() : nullptr);');
    });

    it('should handle chained optional chaining', () => {
      const input = `
        class Address {
            city: string = "";
        }
        
        class User {
            address: Address | null;
        }
        
        function test(user: User | null): string | null {
            return user?.address?.city;
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      // Should generate lambda with nullopt returns for chained optional chaining
      expect(cpp).toContain('return std::nullopt');
    });
  });

  describe('Non-Null Assertion Operator (!)', () => {
    it('should handle non-null assertion on nullable primitives', () => {
      const input = `
        function test(a: int | null): int {
            return a!;
        }
      `;
      
      const result = transpile(input);
      const cpp = result.source || '';
      expect(cpp).toContain('value()');
    });

    it('should handle non-null assertion on nullable objects', () => {
      const input = `
        class User {
            name: string = "";
        }
        
        function test(user: User | null): User {
            return user!;
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('assert');
    });

    it('should handle non-null assertion after null coalescing', () => {
      const input = `
        function test(a: int | null, b: int | null): int {
            return (a ?? b)!;
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('value()');
    });
  });

  describe('Combined Usage', () => {
    it('should handle complex combinations of null safety operators', () => {
      const input = `
        class Profile {
            bio: string = "";
        }
        
        class User {
            profile: Profile | null;
            name: string = "";
        }
        
        function getUserBio(user: User | null): string {
            return user?.profile?.bio ?? "No bio available";
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      // Should generate value_or for nullish coalescing
      expect(cpp).toContain('value_or');
    });

    it('should use value_or when fallback string is inferred from type', () => {
      const input = `
        class Profile {
            bio: string = "";
        }

        class User {
            profile: Profile | null;
        }

        function render(user: User | null, fallback: string): string {
            return user?.profile?.bio ?? fallback;
        }
      `;

      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('value_or');
      expect(cpp).toContain('temp_');
    });

    it('should handle null safety with method calls', () => {
      const input = `
        class Calculator {
            compute(x: int): int { return x * 2; }
        }
        
        function test(calc: Calculator | null, input: int | null): int {
            return calc?.compute(input ?? 0) ?? -1;
        }
      `;
      
      const result = transpile(input);
      expect(result.errors).toStrictEqual([]);
      const cpp = result.source || '';
      expect(cpp).toContain('has_value');
    });
  });

  describe('Type System Integration', () => {
    it('should correctly infer types for null coalescing', () => {
      const input = `
        function test(): string {
            let name: string | null = "test";
            let defaultName: string = "default";
            return name ?? defaultName; // Result should be string, not string?
        }
      `;
      
      const result = transpile(input);
      const cpp = result.source || '';
      expect(cpp).toContain('has_value');
    });

    it('should handle nullable type annotations', () => {
      const input = `
        function test(x: int | null): void {
            let y: string | null = "hello";
            println(x ?? 0);
            println(y ?? "world");
        }
      `;
      
      const result = transpile(input);
      const cpp = result.source || '';
      expect(cpp).toContain('std::optional');
    });
  });

  describe('Error Cases', () => {
    it('should report error when using ?? on non-nullable type', () => {
      const input = `
        function test(): int {
            let x: int = 5;
            return x ?? 10; // Error: x is not nullable
        }
      `;
      
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('should be nullable');
    });

    it('should report error when using ?. on non-nullable type', () => {
      const input = `
        class User {
            name: string = "";
        }
        
        function test(): string | null {
            let user: User = User{};
            return user?.name; // Error: user is not nullable
        }
      `;
      
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('should be nullable');
    });

    it('should report error when using ! on non-nullable type', () => {
      const input = `
        function test(): int {
            let x: int = 5;
            return x!; // Error: x is not nullable
        }
      `;
      
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('can only be applied to nullable types');
    });
  });
});
