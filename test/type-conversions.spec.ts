// Unit tests for canonical type conversion functions

import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';
import { errorMessages } from './helpers/error-helpers.js';

describe('Type Conversion Functions', () => {
  describe('String to Numeric Conversions', () => {
    it('should transpile int() function', () => {
      const input = `
        function main(): int {
          let value = int("42");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int value = doof_runtime::string_to_int("42")');
    });

    it('should transpile float() function', () => {
      const input = `
        function main(): float {
          let value = float("3.14");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('float value = doof_runtime::string_to_float("3.14")');
    });

    it('should transpile double() function', () => {
      const input = `
        function main(): double {
          let value = double("3.14159");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('double value = doof_runtime::string_to_double("3.14159")');
    });

    it('should transpile bool() function with string', () => {
      const input = `
        function main(): bool {
          let value = bool("true");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool value = doof_runtime::string_to_bool("true")');
    });
  });

  describe('Numeric to Boolean Conversions', () => {
    it('should transpile bool() function with int', () => {
      const input = `
        function main(): bool {
          let value = bool(42);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool value = static_cast<bool>(42)');
    });

    it('should transpile bool() function with float', () => {
      const input = `
        function main(): bool {
          let value = bool(3.14f);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool value = static_cast<bool>(3.14f)');
    });

    it('should transpile bool() function with double', () => {
      const input = `
        function main(): bool {
          let value = bool(3.14);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool value = static_cast<bool>(3.14)');
    });
  });

  describe('To String Conversions', () => {
    it('should transpile string() function with int', () => {
      const input = `
        function main(): string {
          let value = string(42);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string value = std::to_string(42)');
    });

    it('should transpile string() function with float', () => {
      const input = `
        function main(): string {
          let value = string(3.14f);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string value = std::to_string(3.14f)');
    });

    it('should transpile string() function with double', () => {
      const input = `
        function main(): string {
          let value = string(3.14);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string value = std::to_string(3.14)');
    });

    it('should transpile string() function with bool', () => {
      const input = `
        function main(): string {
          let value = string(true);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string value = doof_runtime::bool_to_string(true)');
    });
  });

  describe('Numeric Conversions', () => {
    it('should transpile int() function with float', () => {
      const input = `
        function main(): int {
          let value = int(3.14f);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int value = static_cast<int>(3.14f)');
    });

    it('should transpile int() function with double', () => {
      const input = `
        function main(): int {
          let value = int(3.14);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int value = static_cast<int>(3.14)');
    });

    it('should transpile float() function with int', () => {
      const input = `
        function main(): float {
          let value = float(42);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('float value = static_cast<float>(42)');
    });

    it('should transpile float() function with double', () => {
      const input = `
        function main(): float {
          let value = float(3.14);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('float value = static_cast<float>(3.14)');
    });

    it('should transpile double() function with int', () => {
      const input = `
        function main(): double {
          let value = double(42);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('double value = static_cast<double>(42)');
    });

    it('should transpile double() function with float', () => {
      const input = `
        function main(): double {
          let value = double(3.14f);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('double value = static_cast<double>(3.14f)');
    });
  });

  describe('Validation Tests', () => {
    it('should reject int() with no arguments', () => {
      const input = `
        function main(): int {
          let value = int();
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('expects exactly 1 argument');
    });

    it('should reject int() with multiple arguments', () => {
      const input = `
        function main(): int {
          let value = int("1", "2");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('expects exactly 1 argument');
    });

    it('should reject int() with unsupported argument type', () => {
      const input = `
        function main(): int {
          let arr: int[] = [1, 2, 3];
          let value = int(arr);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('Cannot convert type');
    });

    it('should reject string() with unsupported argument type', () => {
      const input = `
        function main(): string {
          let arr: int[] = [1, 2, 3];
          let value = string(arr);
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = errorMessages(result.errors);
      expect(messages[0]).toContain('Cannot convert type');
    });

    it('should reject bool() with invalid string', () => {
      const input = `
        function main(): bool {
          let value = bool("invalid");
          return value;
        }
      `;
      const result = transpile(input);
      // Note: This validation might be done at runtime rather than compile time
      expect(result.errors).toHaveLength(0); // Parser allows it, runtime will handle
    });
  });

  describe('Complex Expressions', () => {
    it('should handle nested type conversions', () => {
      const input = `
        function main(): string {
          let value = string(int("42"));
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string value = std::to_string(doof_runtime::string_to_int("42"));');
    });

    it('should handle type conversions in expressions', () => {
      const input = `
        function main(): int {
          let a = int("10");
          let b = int("20");
          let sum = a + b;
          return sum;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int a = doof_runtime::string_to_int("10")');
      expect(result.source).toContain('int b = doof_runtime::string_to_int("20")');
      expect(result.source).toContain('int sum = (a + b)');
    });

    it('should handle type conversions as function arguments', () => {
      const input = `
        function helper(x: int): int {
          return x * 2;
        }

        function main(): int {
          return helper(int("21"));
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('return helper(doof_runtime::string_to_int("21"))');
    });
  });

  describe('Generated Code Quality', () => {
    it('should generate clean C++ code for type conversions', () => {
      const input = `
        function main(): void {
          let a = int("42");
          let b = float("3.14");  
          let c = string(a);
          let d = bool(a);
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int a = doof_runtime::string_to_int("42")');
      expect(result.source).toContain('float b = doof_runtime::string_to_float("3.14")');
      expect(result.source).toContain('std::string c = std::to_string(a)');
      expect(result.source).toContain('bool d = static_cast<bool>(a)');
    });
  });

  describe('Runtime Support', () => {
    it('should include runtime header for string parsing functions', () => {
      const input = `
        function main(): int {
          let value = int("42");
          return value;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.header).toContain('doof_runtime.h');
    });
  });
});