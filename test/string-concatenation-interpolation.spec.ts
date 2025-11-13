import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

describe('String Concatenation and Interpolation Enhancement', () => {
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

  function expectTranspilationError(source: string, expectedError: string) {
    const transpiler = new Transpiler();
    const result = transpiler.transpile(source, 'test.do');
    
    if (result.errors.length === 0) {
      throw new Error(`Expected transpilation errors but got none. Result: ${JSON.stringify(result)}`);
    }
    
    const errorFound = result.errors.some(error => error.includes(expectedError));
    if (!errorFound) {
      throw new Error(`Expected error containing "${expectedError}" but got errors: ${JSON.stringify(result.errors)}`);
    }
  }

  describe('Valid String Interpolation', () => {
    it('should support string interpolation with primitives', () => {
      const source = `
        let name = "Alice";
        let age = 30;
        let msg = \`Name: \${name}, Age: \${age}\`;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string name = "Alice"');
      expect(result.source).toContain('int age = 30');
      expect(result.source).toContain('std::string msg =');
    });

    it('should support string interpolation with multiple types', () => {
      const source = `
        let intVal = 42;
        let floatVal = 3.14f;
        let doubleVal = 2.718;
        let boolVal = true;
        let charVal = 'X';
        let msg = \`Values: \${intVal}, \${floatVal}, \${doubleVal}, \${boolVal}, \${charVal}\`;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string msg =');
    });

    it('should support nested string interpolation', () => {
      const source = `
        let x = 5;
        let y = 10;
        let msg = \`Point: (\${x}, \${y}) = \${x + y}\`;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string msg =');
    });
  });

  describe('Valid String Concatenation', () => {
    it('should allow string + string concatenation', () => {
      const source = `
        let name = "Alice";
        let greeting = "Hello, " + name + "!";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string greeting = ((std::string("Hello, ") + name) + std::string("!"))');
    });

    it('should allow string + number concatenation with left-to-right evaluation', () => {
      const source = `
        let msg = "Value: " + 42;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string msg = (std::string("Value: ") + std::to_string(42))');
    });

    it('should allow number + string concatenation', () => {
      const source = `
        let result = 42 + " is the answer";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string result = (std::to_string(42) + std::string(" is the answer"))');
    });

    it('should allow string + boolean concatenation', () => {
      const source = `
        let result = "Active: " + true;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string result = (std::string("Active: ") + (true ? std::string("true") : std::string("false")))');
    });

    it('should allow string + char concatenation', () => {
      const source = `
        let result = "Grade: " + 'A';
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string result = (std::string("Grade: ") + std::string(1, \'A\'))');
    });

    it('should allow mixed type concatenation chain', () => {
      const source = `
        let name = "Alice";
        let age = 30;
        let active = true;
        let msg = "Name: " + name + ", Age: " + age + ", Active: " + active;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string msg =');
      expect(result.source).toContain('std::to_string(age)');
      expect(result.source).toContain('std::string("true") : std::string("false")');
    });

    it('should handle left-to-right evaluation with numbers first', () => {
      const source = `
        let result = 1 + 2 + " items";
      `;
      const result = generateCode(source);
      
      // Should be: (1 + 2) first = 3, then 3 + " items" = "3 items"
      expect(result.source).toContain('std::string result =');
    });

    it('should handle pure numeric addition when no strings present', () => {
      const source = `
        let x = 5;
        let y = 10; 
        let sum = x + y;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('int sum = (x + y)');
    });
  });

  describe('Invalid String Concatenation', () => {
    // These tests should now pass since we allow string concatenation
    it.skip('should error on string concatenation with + operator', () => {
      const source = `
        let name = "Alice";
        let age = 30;
        let msg = "Name: " + name + ", Age: " + age;
      `;
      
      expectTranspilationError(source, "Operator '+' cannot be used for string concatenation");
    });

    it.skip('should error on string + number concatenation', () => {
      const source = `
        let result = "Value: " + 42;
      `;
      expectTranspilationError(source, "Operator '+' cannot be used for string concatenation");
    });

    it.skip('should error on number + string concatenation', () => {
      const source = `
        let result = 42 + " is the answer";
      `;
      expectTranspilationError(source, "Operator '+' cannot be used for string concatenation");
    });

    it.skip('should error on string + boolean concatenation', () => {
      const source = `
        let result = "Active: " + true;
      `;
      expectTranspilationError(source, "Operator '+' cannot be used for string concatenation");
    });

    it.skip('should error on string + char concatenation', () => {
      const source = `
        let result = "Grade: " + 'A';
      `;
      expectTranspilationError(source, "Operator '+' cannot be used for string concatenation");
    });
  });

  describe('Valid Numeric Addition', () => {
    it('should allow numeric addition without strings', () => {
      const source = `
        let x = 5;
        let y = 10;
        let sum = x + y;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('int sum = (x + y)');
    });

    it('should allow float addition', () => {
      const source = `
        let a = 3.14f;
        let b = 2.71f;
        let sum = a + b;
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('float sum = (a + b)');
    });
  });
});
