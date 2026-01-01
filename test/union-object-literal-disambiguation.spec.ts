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

describe('Union Object Literal Disambiguation', () => {
  describe('Successful Disambiguation', () => {
    it('should disambiguate based on const field values', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          readonly name: string;
          age: int;
          income: double;
        }

        class Child {
          const kind = "Child";
          name: string;
          age: int;
          lollipop: string;
        }

        function main(): int {
          let person: Adult | Child = {
            kind: "Adult", name: "Alice", age: 30, income: 50000.0
          };
          return 0;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.source).toContain('Adult');
    });

    it('should disambiguate classes in union', () => {
      const input = `
        class Point2D {
          dimensions: int = 2;
          x: double;
          y: double;
        }

        class Point3D {
          dimensions: int = 3;
          x: double;
          y: double;
          z: double;
        }

        function test() {
          let point: Point2D | Point3D = Point3D { dimensions: 3, x: 1.0, y: 2.0, z: 3.0 };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.source).toContain('Point3D');
    });

    it('should disambiguate class based on fields', () => {
      const input = `
        class Employee {
          name: string;
          id: int;
        }

        class Customer {
          name: string;
          customerId: string;
        }

        function test() {
          let person: Employee | Customer = {
            name: "John", customerId: "CUST123"
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.source).toContain('Customer');
    });
  });

  describe('Error Cases', () => {
    it('should error when const field values are ambiguous', () => {
      const input = `
        class TypeA {
          const kind = "same";
          value: int;
        }

        class TypeB {
          const kind = "same";
          value: string;
        }

        function test() {
          let obj: TypeA | TypeB = {
            kind: "same", value: 42
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('ambiguous'))).toBe(true);
    });

    it('should error when no union member matches const field', () => {
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
          let person: Adult | Child = {
            kind: "Robot", data: "invalid"
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('does not match any union member'))).toBe(true);
    });

    it('should error when required fields are missing', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          age: int;
          name: string;
        }

        class Child {
          const kind = "Child";
          grade: int;
          name: string;
        }

        function test() {
          let person: Adult | Child = {
            kind: "Adult"
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some(e =>
          e.includes('fields do not match') ||
          e.includes('does not match any union member')
        )
      ).toBe(true);
    });

    it('should error when multiple types match after const filtering', () => {
      const input = `
        class Square {
          const shape = "polygon";
          side: int;
        }

        class Triangle {
          const shape = "polygon";
          base: int;
          height: int;
        }

        function test() {
          let shape: Square | Triangle = {
            shape: "polygon", side: 5, base: 3, height: 4
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('ambiguous'))).toBe(true);
    });
  });

  describe('Complex Cases', () => {
    it('should handle union with mix of regular and const-field classes', () => {
      const input = `
        class WithFields {
          name: string;
        }

        class WithoutConstructor {
          const kind = "simple";
          value: int;
        }

        function test() {
          let obj1: WithFields | WithoutConstructor = {
            name: "test"
          };
          
          let obj2: WithFields | WithoutConstructor = {
            kind: "simple", value: 42
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });

    it('should handle numeric and boolean const discriminators', () => {
      const input = `
        class TypeOne {
          const id = 1;
          data: string;
        }

        class TypeTwo {
          const id = 2;
          data: string;
        }

        class EnabledType {
          const enabled = true;
          config: string;
        }

        class DisabledType {
          const enabled = false;
          reason: string;
        }

        function test() {
          let obj1: TypeOne | TypeTwo = {
            id: 2, data: "hello"
          };
          
          let obj2: EnabledType | DisabledType = {
            enabled: false, reason: "maintenance"
          };
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle unions with non-class/struct types gracefully', () => {
      const input = `
        class MyClass {
          value: int;
        }

        function test() {
          // This should not trigger disambiguation since int is not a class/struct
          let x: int | MyClass;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
    });

    it('should handle empty object literals', () => {
      const input = `
        class EmptyClass {
          const kind = "empty";
        }

        class AnotherEmpty {
          const kind = "other";
        }

        function test() {
          let obj: EmptyClass | AnotherEmpty = {};
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('ambiguous'))).toBe(true);
    });
  });
});
