import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

describe('Primitive Type Support Enhancement', () => {
  function generateCode(source: string): { header: string; source: string } {
    const transpiler = new Transpiler();
    const result = transpiler.transpile(source, 'test.do');
    
    if (result.errors.length > 0) {
      throw new Error(`Transpilation errors: ${result.errors.join(', ')}`);
    }
    
    return {
      header: result.header || '',
      source: result.source || ''
    };
  }

  describe('Class Field Default Values', () => {
    it('should support primitive default values in classes', () => {
      const source = `
        class Settings {
          private rate: double = 1.5;
          private count: int = 10;
          private active: bool = true;
        }
      `;
      const result = generateCode(source);
      
      expect(result.header).toContain('class Settings');
      expect(result.header).toContain('double rate = 1.5');
      expect(result.header).toContain('int count = 10');
      expect(result.header).toContain('bool active = true');
    });
  });

  describe('Function Parameters and Returns', () => {
    it('should support all primitive types in function signatures', () => {
      const source = `
        function calculate(a: double, b: float, c: int): double {
          return a + b + c;
        }
      `;
      const result = generateCode(source);
      
      expect(result.header).toContain('double calculate(double a, float b, int c)');
      expect(result.source).toContain('double calculate(double a, float b, int c)');
    });
  });

  describe('Variable Declarations', () => {
    it('should support all primitive type variable declarations', () => {
      const source = `
        let intVar: int = 42;
        let floatVar: float = 3.14f;
        let doubleVar: double = 2.718;
        let charVar: char = 'X';
        let boolVar: bool = false;
        let stringVar: string = "hello";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('int intVar = 42');
      expect(result.source).toContain('float floatVar = 3.14f');
      expect(result.source).toContain('double doubleVar = 2.718');
      expect(result.source).toContain("char charVar = 'X'");
      expect(result.source).toContain('bool boolVar = false');
      expect(result.source).toContain('std::string stringVar = "hello"');
    });
  });
});
