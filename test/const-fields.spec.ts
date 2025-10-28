import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

function generateCodeFromString(source: string): { header: string; source: string; errors: string[] } {
  const transpiler = new Transpiler();
  const result = transpiler.transpile(source, 'test.do');

  return {
    header: result.header || '',
    source: result.source || '',
    errors: result.errors.map(err => typeof err === 'string' ? err : err.message)
  };
}

describe('Const Fields', () => {
  describe('Syntax and Parsing', () => {


    it('should parse const fields in classes', () => {
      const input = `
        class User {
          const id: int = 42;
          private const role: string = "admin";
          name: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const int id');
      expect(result.header).toContain('const std::string role');
    });

    it('should parse static const fields', () => {
      const input = `
        class Config {
          static const VERSION: string = "1.0.0";
          static const MAX_USERS: int = 100;
          name: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('static const std::string VERSION;');
      expect(result.header).toContain('static constexpr int MAX_USERS = 100;');
    });
  });

  describe('Validation', () => {
    it('should reject const fields without defaults', () => {
      const input = `
        class User {
          const id: int;
          name: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain("Const field 'id' must have a default value");
    });

    it('should reject static const fields without defaults', () => {
      const input = `
        class Config {
          static const VERSION: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain("Static const fields must have a default value");
    });

  });

  describe('Code Generation', () => {

    it('should generate correct class with const fields', () => {
      const input = `
        class User {
          const id: int = 1;
          private const role: string = "user";
          name: string;
        }
        
        function test() {
          let u = User.fromJSON("{}");
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Header should have const fields
      expect(result.header).toContain('const int id');
      expect(result.header).toContain('const std::string role');

      // Constructor should use initializer list
      expect(result.source).toContain(': id(1), role("user")');

      // JSON deserialization should use aggregate constructor
      expect(result.source).toContain('auto result = std::make_shared<User>(id, role, name)');
    });

    it('should generate static const field definitions correctly', () => {
      const input = `
        class Config {
          static const VERSION: string = "2.0.0";
          static const MAX_COUNT: int = 42;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Header: constexpr for ints, declaration only for strings
      expect(result.header).toContain('static constexpr int MAX_COUNT = 42');
      expect(result.header).toContain('static const std::string VERSION;');

      // Source: definition for string constants
      expect(result.source).toContain('const std::string Config::VERSION = "2.0.0"');
    });
  });

});
