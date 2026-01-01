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

describe('Const and Readonly Fields - Core Functionality', () => {
  describe('Basic Const Field Support', () => {
    it('should parse and generate const fields in classes', () => {
      const input = `
        class User {
          const id: int = 42;
          const name: string = "John";
          private const secret: string = "hidden";
          age: int;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Header should have const declarations
      expect(result.header).toContain('const int id = 42');
      expect(result.header).toContain('const std::string name = "John"');
      expect(result.header).toContain('const std::string secret = "hidden"');
      expect(result.header).toContain('int age');
    });



    it('should generate static const fields correctly', () => {
      const input = `
        class Config {
          static const VERSION: string = "1.0.0";
          static const MAX_COUNT: int = 100;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Header: constexpr for int, declaration for string
      expect(result.header).toContain('static const std::string VERSION;');
      expect(result.header).toContain('static constexpr int MAX_COUNT = 100');

      // Source: definition for string constants
      expect(result.source).toContain('const std::string Config::VERSION = "1.0.0"');
    });
  });

  describe('Validation Rules', () => {
    it('should require defaults for const fields', () => {
      const input = `
        class InvalidClass {
          const field: int;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain("must have a default value");
    });

    it('should require defaults for static const fields', () => {
      const input = `
        class TestClass {
          static const VERSION: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain("Static const fields must have a default value");
    });
  });

  describe('Readonly Field Support', () => {
    it('should parse readonly fields in classes', () => {
      const input = `
        class Document {
          readonly created: string = "2024-01-01";
          private readonly id: int = 1;
          title: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Readonly fields should be treated as const in C++
      // Note: readonly without defaults might not get default values in header
      expect(result.header).toContain('const std::string created');
      expect(result.header).toContain('const int id = 1');
      expect(result.header).toContain('std::string title');
    });

    it('should reject const readonly combination', () => {
      const input = `
        class InvalidClass {
          const readonly field: int = 1;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain("cannot be both 'const' and 'readonly'");
    });
  });

  describe('Type Inference', () => {
    it('should infer types for const fields', () => {
      const input = `
        class InferredTypes {
          const intField = 42;
          const stringField = "hello";
          const boolField = true;
          const doubleField = 3.14;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      expect(result.header).toContain('const int intField = 42');
      expect(result.header).toContain('const std::string stringField = "hello"');
      expect(result.header).toContain('const bool boolField = true');
      expect(result.header).toContain('const double doubleField = 3.14');
    });
  });

  describe('JSON Serialization', () => {
    it('should include const fields in JSON output', () => {
      const input = `
        class User {
          const version: string = "1.0";
          const active: bool = true;
          name: string;
        }

        function test(u: User) {
          println(u);
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // JSON serialization should include const fields (look for proper format)
      expect(result.source).toContain('\\"version\\"');
      expect(result.source).toContain('\\"active\\"');
      expect(result.source).toContain('\\"name\\"');
      expect(result.source).toContain('json_encode(version)');
    });

    it('should handle const fields in JSON deserialization', () => {
      const input = `
        class Config {
          const format: string = "json";
          data: string;
        }

        function test(u: Config) {
          println(u);
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);

      // Should have default value fallback
      expect(result.source).toContain('format("json")');
    });
  });

  describe('Edge Cases', () => {
    it('should handle enum const fields', () => {
      const input = `
        enum Status {
          ACTIVE,
          INACTIVE
        }
        
        class User {
          const status: Status = Status.ACTIVE;
          name: string;
        }
      `;

      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const Status status = Status::ACTIVE');
    });

  });
});
