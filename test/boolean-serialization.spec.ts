import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';

describe('Boolean Field Serialization', () => {
  function transpileCode(code: string) {
    const result = transpile(code);
    return {
      errors: result.errors,
      header: result.header,
      source: result.source
    };
  }

  describe('Class Boolean Fields', () => {
    it('should generate true/false for boolean fields in classes', () => {
      const code = `
        class Config {
          enabled: bool = true;
          active: bool = false;
        }

        function test(c: Config) {
          println(c);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('(enabled ? "true" : "false")');
      expect(result.source).toContain('(active ? "true" : "false")');
      expect(result.source).not.toContain('<< enabled');
      expect(result.source).not.toContain('<< active');
    });

    it('should generate true/false for boolean arrays in classes', () => {
      const code = `
        class Config {
          flags: bool[] = [true, false];
        }

        function test(c: Config) {
          println(c);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('(element ? "true" : "false")');
    });
  });


});
