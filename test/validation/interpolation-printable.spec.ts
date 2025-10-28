import { describe, it, expect } from 'vitest';
import { Validator } from '../../src/validation/validator.js';
import { Parser } from '../../src/parser/parser.js';
import { Lexer } from '../../src/parser/lexer.js';

describe('Template interpolation validation', () => {
  function validateCode(source: string) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    validator.validate(ast);
    return validator;
  }

  it('should mark class types for JSON printing when used in interpolations', () => {
    const input = `
      class User {
        name: string;
        age: int;
      }
      
      function test(): string {
        let user = User("fred", 12);
        let message = \`User info: \${user}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toStrictEqual([]);
    
    // Should mark User class for JSON printing
    expect(validator.context.codeGenHints.jsonPrintTypes.has('User')).toBe(true);
  });

  it('should mark class types for JSON printing when used in interpolations', () => {
    const input = `
      class Point {
        x: int;
        y: int;
      }
      
      function test(): string {
        let point = Point{x: 10, y: 20};
        let message = \`Point coordinates: \${point}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toHaveLength(0);
    
    // Should mark Point struct for JSON printing
    expect(validator.context.codeGenHints.jsonPrintTypes.has('Point')).toBe(true);
  });

  it('should error on non-printable types in interpolations', () => {
    const input = `
      function fn(): void {}
      function main() {
        let message = \`Function: \${fn}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have validation error for non-printable type
    expect(validator.context.errors.length).toBeGreaterThan(0);
    expect(validator.context.errors.some(e => e.message.includes('not printable'))).toBe(true);
  });

  it('should allow primitive types in interpolations', () => {
    const input = `
      function test(): string {
        let name = "Alice";
        let age = 30;
        let active = true;
        let score = 95.5;
        let message = \`Name: \${name}, Age: \${age}, Active: \${active}, Score: \${score}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toHaveLength(0);
  });

  it('should handle nested class/struct types in interpolations', () => {
    const input = `
      class Address {
        street: string;
        city: string;
      }
      
      class Person {
        name: string;
        address: Address;
      }
      
      function test(): string {
        let person = Person("fred", Address("10 place", "Sydney"));
        let message = \`Person: \${person}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toStrictEqual([]);
    
    // Should mark both types for JSON printing
    expect(validator.context.codeGenHints.jsonPrintTypes.has('Person')).toBe(true);
    expect(validator.context.codeGenHints.jsonPrintTypes.has('Address')).toBe(true);
  });

  it('should not affect tagged template validation', () => {
    const input = `
      function html(strings: string[], values: string[]): string {
        return "";
      }
      
      function test(): string {
        let name = "World";
        let result = html\`<div>\${name}</div>\`;
        return result;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toStrictEqual([]);
    
    // Tagged templates should not trigger JSON marking for string literals
    // (This test mainly ensures tagged template validation still works)
  });

  it('should handle enum types in interpolations', () => {
    const input = `
      enum Status { ACTIVE, INACTIVE }
      function test(): string {
        let status = Status.ACTIVE;
        let message = \`Current status: \${status}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors
    expect(validator.context.errors).toHaveLength(0);
  });

  it('should handle array types in interpolations', () => {
    const input = `
      function test(): string {
        let numbers = [1, 2, 3];
        let message = \`Numbers: \${numbers}\`;
        return message;
      }
    `;

    const validator = validateCode(input);
    
    // Should have no validation errors (arrays are printable)
    expect(validator.context.errors).toHaveLength(0);
  });
});
