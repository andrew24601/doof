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

describe('Const Field Type Inference', () => {
  describe('Basic Inference', () => {
    it('should infer int type from number literal', () => {
      const input = `
        class Point {
          const x = 42;
          y: int;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const int x = 42');
    });

    it('should infer string type from string literal', () => {
      const input = `
        class User {
          const role = "admin";
          name: string;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const std::string role = "admin"');
    });

    it('should infer bool type from boolean literal', () => {
      const input = `
        class Config {
          const debug = true;
          port: int;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const bool debug = true');
    });

    it('should infer enum type from enum member access', () => {
      const input = `
        enum Status { Active, Inactive }
        
        class User {
          const status = Status.Active;
          name: string;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const Status status = Status::Active');
    });
  });

  describe('Error Cases', () => {
    it('should reject non-literal initializers', () => {
      const input = `
        class Point {
          const x = 1 + 2;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('strict literal'))).toBe(true);
    });

    it('should reject object literal initializers', () => {
      const input = `
        class Point {
          const data = { x: 1, y: 2 };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('strict literal'))).toBe(true);
    });

    it('should reject array literal initializers', () => {
      const input = `
        class Point {
          const coords = [1, 2];
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('strict literal'))).toBe(true);
    });

    it('should reject null literal initializers', () => {
      const input = `
        class Point {
          const value = null;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('strict literal'))).toBe(true);
    });
  });

  describe('Mixed explicit and inferred types', () => {
    it('should handle both explicit and inferred types in same class', () => {
      const input = `
        class Mixed {
          const inferred = "hello";
          const explicit: string = "world";
          value: int;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const std::string inferred = "hello"');
      expect(result.header).toContain('const std::string explicit = "world"');
    });
  });
});
