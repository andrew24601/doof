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

describe('Discriminated Union Type Narrowing', () => {
  describe('Basic Type Narrowing with Const Field Discriminants', () => {
    it('should narrow union type based on const field comparison in if statement', () => {
      const input = `
        class Adult {
          const kind = "Adult";
          name: string;
          income: double;
          
          getIncomeReport(): string {
            return "High earner";
          }
        }
        
        class Child {
          const kind = "Child";
          name: string;
          lollipop: string;
          
          getFavoriteCandy(): string {
            return "Gummy bears";
          }
        }
        
        function testNarrowing(person: Adult | Child): string {
          if (person.kind == "Adult") {
            return person.getIncomeReport(); // Should access Adult-specific method
          } else {
            return person.getFavoriteCandy(); // Should access Child-specific method
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Check that the generated C++ uses std::get<Type>(variant) for narrowed access  
      expect(result.source).toContain('std::get<std::shared_ptr<Adult>>(person)');
      expect(result.source).toContain('std::get<std::shared_ptr<Child>>(person)');
      
      // Check that the condition uses std::visit for the discriminant check
      expect(result.source).toContain('std::visit([](auto&& variant) { return variant->kind; }, person) == "Adult"');
    });

    it('should narrow union type with numeric const discriminants', () => {
      const input = `
        class TypeA {
          const id = 1;
          valueA: string;
          
          getValueA(): string {
            return this.valueA;
          }
        }
        
        class TypeB {
          const id = 2;
          valueB: int;
          
          getValueB(): string {
            return "some value";
          }
        }
        
        function testNumericDiscriminant(obj: TypeA | TypeB): string {
          if (obj.id == 1) {
            return obj.getValueA();
          } else {
            return obj.getValueB();
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<TypeA>>(obj)');
      expect(result.source).toContain('std::get<std::shared_ptr<TypeB>>(obj)');
      expect(result.source).toContain('std::visit([](auto&& variant) { return variant->id; }, obj) == 1');
    });

    it('should narrow union type with boolean const discriminants', () => {
      const input = `
        class Active {
          const isActive = true;
          activeData: string;
        }
        
        class Inactive {
          const isActive = false;
          inactiveReason: string;
        }
        
        function testBooleanDiscriminant(status: Active | Inactive): string {
          if (status.isActive == true) {
            return status.activeData;
          } else {
            return status.inactiveReason;
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<Active>>(status)->activeData');
      expect(result.source).toContain('std::get<std::shared_ptr<Inactive>>(status)->inactiveReason');
    });
  });

  describe('Complex Type Narrowing Scenarios', () => {
    it('should handle nested if-else with multiple discriminant checks', () => {
      const input = `
        class TypeA {
          const category = "A";
          dataA: string;
          
          getDataA(): string {
            return this.dataA;
          }
        }
        
        class TypeB {
          const category = "B";
          dataB: int;
          
          getDataB(): string {
            return "B data";
          }
        }
        
        function testNestedNarrowing(obj: TypeA | TypeB): string {
          if (obj.category == "A") {
            return obj.getDataA();
          } else {
            return obj.getDataB();
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<TypeA>>(obj)');
      expect(result.source).toContain('std::get<std::shared_ptr<TypeB>>(obj)');
    });

    it('should handle multiple variables with discriminated unions', () => {
      const input = `
        class Dog {
          const species = "Dog";
          bark(): string { return "woof"; }
        }
        
        class Cat {
          const species = "Cat";
          meow(): string { return "meow"; }
        }
        
        function testMultipleVariables(pet1: Dog | Cat, pet2: Dog | Cat): string {
          if (pet1.species == "Dog") {
            return pet1.bark();
          }
          if (pet2.species == "Cat") {
            return pet2.meow();
          }
          return "unknown";
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Should generate proper narrowing for both variables
      expect(result.source).toContain('std::get<std::shared_ptr<Dog>>(pet1)');
      expect(result.source).toContain('std::get<std::shared_ptr<Cat>>(pet2)');
    });

    it('should handle discriminated union within method calls', () => {
      const input = `
        class Square {
          const shape = "Square";
          side: double;
          
          getSide(): double { 
            return this.side; 
          }
        }
        
        class Circle {
          const shape = "Circle";
          radius: double;
          
          getRadius(): double { 
            return this.radius; 
          }
        }
        
        function calculateArea(shape: Square | Circle): double {
          if (shape.shape == "Square") {
            let side = shape.getSide();
            return side * side;
          } else {
            let radius = shape.getRadius();
            return 3.14159 * radius * radius;
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<Square>>(shape)');
      expect(result.source).toContain('std::get<std::shared_ptr<Circle>>(shape)');
    });
  });

  describe('Type Narrowing with Method Access', () => {
    it('should narrow union type for method calls in type-guarded branches', () => {
      const input = `
        class EmailValidator {
          const kind = "email";
          validateEmail(email: string): bool { return true; }
        }
        
        class PhoneValidator {
          const kind = "phone";
          validatePhone(phone: string): bool { return false; }
        }
        
        function validate(validator: EmailValidator | PhoneValidator, input: string): bool {
          if (validator.kind == "email") {
            return validator.validateEmail(input);
          } else {
            return validator.validatePhone(input);
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<EmailValidator>>(validator)');
      expect(result.source).toContain('std::get<std::shared_ptr<PhoneValidator>>(validator)');
    });
  });

  describe('Error Cases and Edge Cases', () => {
    it('should still allow common member access without type guards', () => {
      const input = `
        class TypeA {
          const kind = "A";
          commonProp: string;
          specificA: int;
        }
        
        class TypeB {
          const kind = "B";
          commonProp: string;
          specificB: double;
        }
        
        function testCommonAccess(obj: TypeA | TypeB): string {
          // This should work without type guards (common member access)
          return obj.commonProp;
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Should use std::visit for common member access, not std::get
      expect(result.source).toContain('std::visit([](auto&& variant) { return variant->commonProp; }, obj)');
    });

    it('should error when accessing non-common members without type guards', () => {
      const input = `
        class TypeA {
          const kind = "A";
          specificA: string;
        }
        
        class TypeB {
          const kind = "B";
          specificB: int;
        }
        
        function testInvalidAccess(obj: TypeA | TypeB): string {
          return obj.specificA; // Should error - not present in all variants
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Not all variants'))).toBe(true);
    });

    it('should handle discriminant comparison with wrong type gracefully', () => {
      const input = `
        class TypeA {
          const kind = "A";
          value: string;
        }
        
        class TypeB {
          const kind = "B";
          value: int;
        }
        
        function testWrongDiscriminant(obj: TypeA | TypeB): string {
          if (obj.kind == "C") { // Non-existent discriminant value
            return "impossible";
          }
          return "fallback";
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]); // Should not error, just generate condition that never matches
      
      // Should still generate proper discriminant check even if value doesn't match any variant
      expect(result.source).toContain('std::visit([](auto&& variant) { return variant->kind; }, obj) == "C"');
    });
  });

  describe('Integration with Other Features', () => {
    it('should work with function parameters and return types', () => {
      const input = `
        class StringResult {
          const resultType = "string";
          value: string;
          
          getString(): string {
            return this.value;
          }
        }
        
        class NumberResult {
          const resultType = "number";
          value: double;
          
          getNumber(): double {
            return this.value;
          }
        }
        
        function processResult(result: StringResult | NumberResult): string {
          if (result.resultType == "string") {
            return result.getString();
          } else {
            return "Number result";
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<StringResult>>(result)');
    });

    it('should work with local variable declarations', () => {
      const input = `
        class Success {
          const status = "success";
          data: string;
          
          getData(): string {
            return this.data;
          }
        }
        
        class Error {
          const status = "error";
          message: string;
          
          getMessage(): string {
            return this.message;
          }
        }
        
        function handleResult(): string {
          let result: Success | Error = Success("success", "OK");
          
          if (result.status == "success") {
            return result.getData();
          } else {
            return result.getMessage();
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      expect(result.source).toContain('std::get<std::shared_ptr<Success>>(result)');
      expect(result.source).toContain('std::get<std::shared_ptr<Error>>(result)');
    });
  });

  describe('Code Generation Quality', () => {
    it('should generate clean C++ code with proper indentation', () => {
      const input = `
        class A {
          const kind = "A";
          valueA: string;
          
          getValueA(): string {
            return this.valueA;
          }
        }
        
        class B {
          const kind = "B";
          valueB: int;
          
          getValueB(): string {
            return "B value";
          }
        }
        
        function test(obj: A | B): string {
          if (obj.kind == "A") {
            return obj.getValueA();
          } else {
            return obj.getValueB();
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Check that the generated code has proper structure
      expect(result.source).toContain('if ((std::visit([](auto&& variant) { return variant->kind; }, obj) == "A")) {');
      expect(result.source).toMatch(/std::get<std::shared_ptr<A>>\(obj\)/);
      expect(result.source).toMatch(/^\s*}\s*else\s*\{/m);
      expect(result.source).toMatch(/std::get<std::shared_ptr<B>>\(obj\)/);
    });

    it('should preserve type safety in generated C++ code', () => {
      const input = `
        class Rectangle {
          const shape = "rectangle";
          width: double;
          height: double;
        }
        
        class Circle {
          const shape = "circle";
          radius: double;
        }
        
        function getArea(shape: Rectangle | Circle): double {
          if (shape.shape == "rectangle") {
            return shape.width * shape.height;
          } else {
            return 3.14159 * shape.radius * shape.radius;
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Verify the function signature uses std::variant
      expect(result.header).toContain('double getArea(std::variant<std::shared_ptr<Rectangle>, std::shared_ptr<Circle>> shape)');
      
      // Verify proper type extraction in branches
      expect(result.source).toContain('std::get<std::shared_ptr<Rectangle>>(shape)->width');
      expect(result.source).toContain('std::get<std::shared_ptr<Rectangle>>(shape)->height');
      expect(result.source).toContain('std::get<std::shared_ptr<Circle>>(shape)->radius');
    });
  });
});
