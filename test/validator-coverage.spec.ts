import { describe, it, expect } from 'vitest';
import { Validator } from '../src/validation/validator.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Program } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: any[]; context: any } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, errors: context.errors, context };
}

describe('Validator - Additional Coverage', () => {
  describe('basic validation cases', () => {
    it('should handle empty programs', () => {
      const { errors } = parseAndValidate('');
      expect(errors).toEqual([]);
    });

    it('should validate basic variable declarations', () => {
      const code = 'let x: int = 5;';
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate private field access from outside class', () => {
      const code = `
        class TestClass {
          private secret: int;
        }
        let obj = TestClass{ secret: 42 };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes('Cannot access private field'))).toBe(true);
    });

    it('should allow private field access from inside class', () => {
      const code = `
        class TestClass {
          private secret: int;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('Cannot access private field'))).toHaveLength(0);
    });

    it('should validate static method calls', () => {
      const code = `
        class Calculator {
          static add(a: int, b: int): int {
            return a + b;
          }
        }
        let result = Calculator.add(1, 2);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should handle complex enum shorthand validation', () => {
      const code = `
        enum Color { RED, GREEN, BLUE }
        enum Size { SMALL, MEDIUM, LARGE }
        let colorMap: Map<Color, string> = { .RED: "red", .GREEN: "green" };
        let sizeSet: Set<Size> = { .SMALL, .LARGE };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('should validate mixed enum syntax in expressions', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE, PENDING }
        let mixed: Map<Status, string> = { 
          .ACTIVE: "running", 
          Status.INACTIVE: "stopped",
          .PENDING: "waiting" 
        };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('should handle void type validation', () => {
      const code = `
        function test(): void {
          return;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('should validate function parameter types', () => {
      const code = `
        function test(param: invalid_type): void {
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes('Unknown type'))).toBe(true);
    });

    it('should handle invalid map key types in literals', () => {
      const code = `
        let invalidMap: Map<float, string> = { 1.5: "invalid" };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes('Invalid map key type'))).toBe(true);
    });

    it('should handle invalid set element types in literals', () => {
      const code = `
        let invalidSet: Set<float> = [1.5, 2.5];
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes('Invalid set element type'))).toBe(true);
    });

    it('should validate basic type checking', () => {
      const code = `
        let stringVar: string = "hello";
        let intVar: int = 42;
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('Type mismatch'))).toHaveLength(0);
    });

    it('should validate simple class declarations', () => {
      const code = `
        class TestClass {
          field: int;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate simple enum declarations', () => {
      const code = `
        enum TestEnum { VALUE1, VALUE2 }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate simple function declarations', () => {
      const code = `
        function testFunction(): void {
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate basic member access', () => {
      const code = `
        class TestClass {
          value: int;
        }
        let obj = TestClass{ value: 42 };
        let result = obj.value;
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

  });
});
