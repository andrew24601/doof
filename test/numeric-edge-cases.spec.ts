import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

describe('Numeric Edge Cases', () => {
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
  describe('Division by Zero Handling', () => {
    it('should handle division by zero in floating-point context', () => {
      const source = `
        let result: double = 1.0 / 0.0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double result = (1.0 / 0.0);');
    });

    it('should handle division by zero in integer context', () => {
      const source = `
        let result: int = 1 / 0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int result = (1 / 0);');
    });
  });

  describe('Large Number Literals', () => {
    it('should handle very large double literals', () => {
      const source = `
        let big: double = 9007199254740991.0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double big = 9007199254740991.0;');
    });

    it('should handle very small decimal literals', () => {
      const source = `
        let small: double = 0.000000000001;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double small = 0.000000000001;');
    });

    it.skip('should handle scientific notation', () => {
      // TODO: Scientific notation requires lexer enhancements
      // Current lexer stops at 'e' thinking it's an identifier
      const source = `
        let scientific: double = 1.23e-10;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double scientific = 1.23e-10;');
    });
  });

  describe('Negative Number Operations', () => {
    it('should handle negative zero in floating-point operations', () => {
      const source = `
        let negZero: double = -0.0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double negZero = -0.0;');
    });

    it('should handle negative numbers in integer division', () => {
      const source = `
        let negDiv: int = -7 / 3;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int negDiv = (-7 / 3);');
    });

    it('should handle mixed negative and positive in division', () => {
      const source = `
        let mixedDiv: double = -5 / 2;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double mixedDiv = static_cast<double>((-5 / 2));');
    });
  });

  describe('Type Boundary Cases', () => {
    it('should handle maximum integer values', () => {
      const source = `
        let maxInt: int = 2147483647;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int maxInt = 2147483647;');
    });

    it('should handle minimum integer values', () => {
      const source = `
        let minInt: int = -2147483648;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int minInt = -2147483648;');
    });

    it('should handle float precision edge cases', () => {
      const source = `
        let precise: float = 1.23456789012345;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('float precise = 1.23456789012345;');
    });
  });

  describe('Complex Nested Expressions', () => {
    it('should handle deeply nested arithmetic with mixed types', () => {
      const source = `
        let complex: double = ((5 / 2) + (3.5 * 2)) - (7 / 3);
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double complex = ((static_cast<double>(static_cast<double>((5 / 2))) + (3.5 * 2.0)) - static_cast<double>(static_cast<double>((7 / 3))));');
    });

    it('should handle chained division operations', () => {
      const source = `
        let chained: double = 100 / 5 / 4;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double chained = static_cast<double>(((100 / 5) / 4));');
    });

    it('should handle mixed arithmetic and comparison', () => {
      const source = `
        let comparison: bool = (5 / 2) > (3 / 2);
      `;
      const result = generateCode(source);
      expect(result.source).toContain('bool comparison = ((5 / 2) > (3 / 2));');
    });
  });

  describe('Function Call Edge Cases', () => {
    it('should handle Math functions with edge case arguments', () => {
      const source = `
        function testMathEdges(): double {
          return Math.sqrt(-1);
        }
      `;
      const result = generateCode(source);
      expect(result.source).toContain('return std::sqrt(-1);');
    });

    it('should handle nested Math function calls', () => {
      const source = `
        function testNested(): double {
          return Math.sin(Math.cos(Math.PI));
        }
      `;
      const result = generateCode(source);
      expect(result.source).toContain('return std::sin(std::cos(M_PI));');
    });

    it('should handle Math functions in complex expressions', () => {
      const source = `
        let mathComplex: double = Math.sqrt(16) + (5 / 2);
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double mathComplex = (std::sqrt(16) + static_cast<double>(static_cast<double>((5 / 2))));');
    });
  });

  describe('Error Boundary Conditions', () => {
    it('should handle extremely complex type promotion chains', () => {
      const source = `
        let superComplex: int = ((7.5 / 2) + (5 / 3)) * ((9 / 4) - (2.5 * 1.5));
      `;
      const result = generateCode(source);
      // Ensure no infinite recursion or stack overflow in type promotion
      expect(result.source).toContain('int superComplex = static_cast<int>');
    });

    it('should handle zero as divisor in various contexts', () => {
      const source = `
        let divZero1: double = 5.0 / 0.0;
        let divZero2: int = 5 / 0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double divZero1 = (5.0 / 0.0);');
      expect(result.source).toContain('int divZero2 = (5 / 0);');
    });
  });
});
