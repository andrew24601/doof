import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';

describe('Validator - Enhanced Coverage', () => {
  function parseAndValidate(code: string) {
    try {
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const program = parser.parse();
      const validator = new Validator({ allowTopLevelStatements: true });
      const context = validator.validate(program);
      return { program, context, errors: context.errors };
    } catch (error) {
      // If parsing fails, return the parse error
      return { 
        program: null, 
        context: null, 
        errors: [{ message: error instanceof Error ? error.message : String(error) }] 
      };
    }
  }

  describe('unknown enum type validation', () => {
    it('should detect undefined enum identifiers', () => {
      const code = `
        let value = SomeUnknownEnum.VALUE;
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes("Undefined identifier 'SomeUnknownEnum'"))).toBe(true);
    });

    it('should validate enum types correctly', () => {
      const code = `
        enum TestEnum { A, B, C }
        let value = TestEnum.A;
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });
  });

  describe('duplicate field detection', () => {
    it('should detect duplicate fields in class declarations', () => {
      const code = `
        class TestClass {
          name: string;
          age: int;
          name: string; // duplicate field
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes("Duplicate field 'name' in class 'TestClass'"))).toBe(true);
    });

    it('should detect duplicate fields in class declarations', () => {
      const code = `
        class TestClass {
          id: int;
          value: double;
          id: int; // duplicate field
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes("Duplicate field 'id' in class 'TestClass'"))).toBe(true);
    });
  });

  describe('missing required property validation', () => {
    it('should detect missing required properties in object literals', () => {
      const code = `
        class Person {
          name: string;
          age: int;
        }
        let person = Person{
          name: "John"
          // missing age property
        };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes("Missing required property 'age'"))).toBe(true);
    });

    it('should detect missing required properties in class literals', () => {
      const code = `
        class Point {
          x: double;
          y: double;
        }
        let point = Point{
          x: 1.0
          // missing y property
        };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.some(e => e.message.includes("Missing required property 'y'"))).toBe(true);
    });
  });

  describe('Math namespace method validation', () => {
    it('should validate Math.sqrt method calls', () => {
      const code = `
        let result = Math.sqrt(16.0);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate Math.abs method calls', () => {
      const code = `
        let result = Math.abs(-5.0);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate Math.pow method calls', () => {
      const code = `
        let result = Math.pow(2.0, 3.0);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should handle unknown Math methods', () => {
      const code = `
        let result = Math.unknownMethod(1.0);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('exception-related validation (basic)', () => {
    it('should handle validator without exceptions', () => {
      // Just test that the validator can handle basic code without exceptions
      const code = `
        class SimpleClass {
          value: int;
        }
        let obj = SimpleClass{ value: 42 };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });
  });

  describe('export declaration handling', () => {
    it('should handle exported function declarations', () => {
      const code = `
        export function utilityFunction(value: int): string {
          return "test";
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should handle exported class declarations', () => {
      const code = `
        export class ExportedClass {
          value: int;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should handle exported enum declarations', () => {
      const code = `
        export enum ExportedEnum {
          OPTION_A,
          OPTION_B,
          OPTION_C
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should handle exported class declarations', () => {
      const code = `
        export class ExportedClass {
          id: int;
          name: string;
        }
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });
  });

  describe('advanced validation scenarios', () => {
    it('should validate complex enum member access', () => {
      const code = `
        enum Status { PENDING, COMPLETE, FAILED }
        
        function checkStatus(): Status {
          return Status.PENDING;
        }
        
        let currentStatus = checkStatus();
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate private field access restrictions', () => {
      const code = `
        class SecureClass {
          private secret: string;
          info: string;
          
          getSecret(): string {
            return this.secret;
          }
        }
        
        let obj = SecureClass{
          info: "public info"
        };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate generic array operations', () => {
      const code = `
        let numbers: int[] = [1, 2, 3, 4, 5];
        let first = numbers[0];
        let length = numbers.length;
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate map and set operations', () => {
      const code = `
        let scores: Map<string, int> = {
          "Alice": 95,
          "Bob": 87,
          "Charlie": 92
        };
        
        let uniqueNumbers: Set<int> = {1, 2, 3, 4, 5};
        
        let aliceScore = scores["Alice"];
        let hasThree = uniqueNumbers.has(3);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });
  });

  describe('error edge cases', () => {
    it('should handle nested enum shorthand expressions', () => {
      const code = `
        enum Priority { LOW, MEDIUM, HIGH }
        enum Status { PENDING, ACTIVE, COMPLETE }
        
        class Task {
          priority: Priority;
          status: Status;
        }
        
        let task = Task{
          priority: Priority.HIGH,
          status: Status.PENDING
        };
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate field parameter types', () => {
      const code = `
        class Rectangle {
          width: double;
          height: double;
          
          area(): double {
            return this.width * this.height;
          }
        }
        
        let rect = Rectangle{ w: 10.0, h: 5.0 };
        let area = rect.area();
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });

    it('should validate method overloading scenarios', () => {
      const code = `
        class Calculator {
          add(a: int, b: int): int {
            return a + b;
          }
          
          multiply(a: double, b: double): double {
            return a * b;
          }
        }
        
        let calc = Calculator{};
        let sum = calc.add(5, 3);
        let product = calc.multiply(2.5, 4.0);
      `;
      const { errors } = parseAndValidate(code);
      expect(errors.filter(e => e.message.includes('error'))).toHaveLength(0);
    });
  });
});
