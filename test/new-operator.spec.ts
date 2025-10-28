import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { Transpiler } from '../src/transpiler.js';

function parseAndValidate(source: string) {
  const lexer = new Lexer(source, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(ast);
  return { ast, errors: context.errors };
}

function transpile(source: string) {
  const transpiler = new Transpiler();
  return transpiler.transpile(source, 'test.do');
}

/**
 * Tests for the new operator, which should function identically to object literal construction
 * without the new keyword. The new operator is syntactic sugar and should not change the 
 * generated code.
 */
describe('New Operator', () => {
  describe('Parser', () => {
    it('should parse new operator with positional arguments', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        function test(): void {
          let p = new Point(1, 2);
        }
      `;

      const { errors } = parseAndValidate(input);
      expect(errors).toEqual([]);
    });

    it('should parse new operator with object literal arguments', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        function test(): void {
          let p = new Point{ x: 1, y: 2 };
        }
      `;

      const { errors } = parseAndValidate(input);
      expect(errors).toEqual([]);
    });


  });

  describe('Code Generation', () => {
    it('should generate identical code for new and non-new constructor calls', () => {
      const inputWithNew = `
        class Point {
          x: int;
          y: int;
        }
        
        function testWithNew(): void {
          let p = new Point(1, 2);
        }
      `;

      const inputWithoutNew = `
        class Point {
          x: int;
          y: int;
        }
        
        function testWithoutNew(): void {
          let p = Point(1, 2);
        }
      `;

      const resultWithNew = transpile(inputWithNew);
      const resultWithoutNew = transpile(inputWithoutNew);

      expect(resultWithNew.errors).toEqual([]);
      expect(resultWithoutNew.errors).toEqual([]);
      // Both should generate the same make_shared calls
      expect(resultWithNew.source).toContain('std::make_shared<Point>(1, 2)');
      expect(resultWithoutNew.source).toContain('std::make_shared<Point>(1, 2)');
    });

    it('should generate identical code for new and non-new object literal construction', () => {
      const inputWithNew = `
        class Point {
          x: int;
          y: int;
        }
        
        function testWithNew(): void {
          let p = new Point{ x: 1, y: 2 };
        }
      `;

      const inputWithoutNew = `
        class Point {
          x: int;
          y: int;
        }
        
        function testWithoutNew(): void {
          let p = Point{ x: 1, y: 2 };
        }
      `;

      const resultWithNew = transpile(inputWithNew);
      const resultWithoutNew = transpile(inputWithoutNew);

      expect(resultWithNew.errors).toEqual([]);
      expect(resultWithoutNew.errors).toEqual([]);
      // Both should generate the same make_shared calls
      expect(resultWithNew.source).toContain('std::make_shared<Point>(1, 2)');
      expect(resultWithoutNew.source).toContain('std::make_shared<Point>(1, 2)');
    });

    it('should generate make_shared for new constructor calls', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        function test(): void {
          let p1 = new Point(1, 2);
          let p2 = Point(3, 4);
        }
      `;

      const { source, errors } = transpile(input);
      expect(errors).toEqual([]);
      expect(source).toContain('std::make_shared<Point>(1, 2)');
      expect(source).toContain('std::make_shared<Point>(3, 4)');
    });
  });

  describe('Validation', () => {
    it('should validate new constructor calls the same as regular constructor calls', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        function test(): void {
          let p1 = new Point("invalid", "args");
          let p2 = Point("invalid", "args");
        }
      `;
      
      const { errors } = parseAndValidate(input);
      
      // Should have 4 validation errors for the invalid type arguments (2 args × 2 calls)
      expect(errors).toHaveLength(4);
      expect(errors[0].message).toContain('string');
      expect(errors[0].message).toContain('int');
    });

    it('should handle new with undefined class', () => {
      const input = `
        function test(): void {
          let p = new UndefinedClass();
        }
      `;
      
      const { errors } = parseAndValidate(input);
      expect(errors.some(e => e.message.includes('UndefinedClass'))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle new with complex expressions inside constructor', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        function calculate(a: int, b: int): int {
          return a + b;
        }
        
        function test(): void {
          let p = new Point(calculate(1, 2), calculate(3, 4));
        }
      `;

      const { errors } = parseAndValidate(input);
      expect(errors).toEqual([]);
    });

    it('should handle new with nested object construction', () => {
      const input = `
        class Inner {
          value: int;
        }
        
        class Outer {
          inner: Inner;
        }
        
        function test(): void {
          let o = new Outer{ inner: new Inner{ value: 42 } };
        }
      `;

      const { errors } = parseAndValidate(input);
      expect(errors).toEqual([]);
    });

    it('should work with multiple classes', () => {
      const input = `
        class Point {
          x: int;
          y: int;
        }
        
        class Color {
          r: int;
          g: int;
          b: int;
        }
        
        function test(): void {
          let p = new Point{ x: 1, y: 2 };
          let c = new Color{ r: 255, g: 0, b: 0 };
        }
      `;

      const { errors } = parseAndValidate(input);
      expect(errors).toEqual([]);
    });
  });
});
