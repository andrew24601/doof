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

describe('Union Common-Member Access', () => {
  describe('Property Access', () => {
    it('should allow access to common string property', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          age: int;
        }
        
        class Child {
          const kind = "Child";
          grade: int;
        }
        
        function test() {
          let person: Adult | Child = Adult { kind: "Adult", age: 25 }; // Initialize the variable
          let k = person.kind; // Should be string
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      // The generated code should compile successfully
    });

    it('should allow access to common int property', () => {
      const input = `
        class Square {
          const sides = 4;
          side: int;
        }
        
        class Rectangle {
          const sides = 4;
          width: int;
          height: int;
        }
        
        function test() {
          let shape: Square | Rectangle = Square { sides: 4, side: 4 }; // Initialize the variable
          let sides = shape.sides; // Should be int
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });

    it('should allow access to common enum property', () => {
      const input = `
        enum Status { Active, Inactive }
        
        class Manager {
          status: Status = Status.Active;
          name: string;
        }
        
        class Employee {
          status: Status = Status.Active;
          permissions: string;
        }
        
        function test() {
          let person: Manager | Employee = Manager { name: "John" }; // Initialize the variable
          let status = person.status; // Should be Status enum
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Method Access', () => {
    it('should allow access to common method with identical signature', () => {
      const input = `
        class Dog {
          const kind = "Dog";
          speak(): string { return "woof"; }
        }
        
        class Cat {
          const kind = "Cat";
          speak(): string { return "meow"; }
        }
        
        function test() {
          let animal: Dog | Cat;
          let sound = animal.speak(); // Should be string
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });

    it('should allow access to method with parameters', () => {
      const input = `
        class Calculator {
          const kind = "Basic";
          add(a: int, b: int): int { return a + b; }
        }
        
        class AdvancedCalculator {
          const kind = "Advanced";
          add(a: int, b: int): int { return a + b; }
        }
        
        function test() {
          let calc: Calculator | AdvancedCalculator = Calculator { kind: "Basic"}; // Initialize the variable
          let result = calc.add(1, 2); // Should be int
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Error Cases', () => {
    it('should reject access to property not present in all variants', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          age: int;
        }
        
        class Child {
          const kind = "Child";
          // No age property
        }
        
        function test() {
          let person: Adult | Child;
          let a = person.age; // Should error
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Not all variants'))).toBe(true);
    });

    it('should reject access to property with different types', () => {
      const input = `
        class TypeA {
          value: string;
        }
        
        class TypeB {
          value: int;
        }
        
        function test() {
          let obj: TypeA | TypeB;
          let v = obj.value; // Should error - different types
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('different types'))).toBe(true);
    });

    it('should reject access to method with different signatures', () => {
      const input = `
        class TypeA {
          process(x: int): string { return "a"; }
        }
        
        class TypeB {
          process(x: string): string { return "b"; }
        }
        
        function test() {
          let obj: TypeA | TypeB;
          let result = obj.process(1); // Should error - different signatures
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('different signatures'))).toBe(true);
    });

    it('should reject mixed property/method access', () => {
      const input = `
        class TypeA {
          value: string;
        }
        
        class TypeB {
          value(): string { return "b"; }
        }
        
        function test() {
          let obj: TypeA | TypeB;
          let v = obj.value; // Should error - inconsistent field/method
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('not consistently a field or method'))).toBe(true);
    });
  });

  describe('Integration with Type Guards', () => {
    it('should work alongside type guards', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          age: int;
        }
        
        class Child {
          const kind = "Child";
          grade: int;
        }
        
        function test() {
          let person: Adult | Child = Adult { kind: "Adult", age: 25 }; // Initialize the variable
          let k = person.kind; // Common access
          
          if (person is Adult) {
            let age = person.age; // Narrowed access
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toStrictEqual([]);
    });
  });
});
