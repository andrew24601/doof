import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

describe('String Literal Concatenation', () => {
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

  describe('C++ String Literal Concatenation', () => {
    it('should wrap both operands when concatenating two string literals', () => {
      const source = `
        let result: string = "Hello" + "World";
      `;
      const result = generateCode(source);
      
      // Both literals must be wrapped to avoid const char* pointer arithmetic
      expect(result.source).toContain('std::string result = (std::string("Hello") + std::string("World"))');
    });

    it('should handle multiple literal concatenations', () => {
      const source = `
        let result: string = "a" + "b" + "c";
      `;
      const result = generateCode(source);
      
      // All literals must be wrapped
      expect(result.source).toContain('std::string result = ((std::string("a") + std::string("b")) + std::string("c"))');
    });

    it('should handle nested literal concatenations', () => {
      const source = `
        let result: string = ("foo" + "bar") + "baz";
      `;
      const result = generateCode(source);
      
      // All literals must be wrapped
      expect(result.source).toContain('std::string result = ((std::string("foo") + std::string("bar")) + std::string("baz"))');
    });

    it('should wrap literal on left when concatenating with variable', () => {
      const source = `
        let name: string = "World";
        let greeting: string = "Hello " + name;
      `;
      const result = generateCode(source);
      
      // Literal on left must be wrapped, variable can stay as-is
      expect(result.source).toContain('std::string greeting = (std::string("Hello ") + name)');
    });

    it('should wrap literal on right when concatenating with variable', () => {
      const source = `
        let name: string = "Hello";
        let greeting: string = name + " World";
      `;
      const result = generateCode(source);
      
      // Variable can stay as-is, literal on right must be wrapped
      expect(result.source).toContain('std::string greeting = (name + std::string(" World"))');
    });

    it('should not wrap variables in concatenation', () => {
      const source = `
        let first: string = "Hello";
        let second: string = "World";
        let greeting: string = first + second;
      `;
      const result = generateCode(source);
      
      // Variables should not be wrapped, only literals
      expect(result.source).toContain('std::string greeting = (first + second)');
    });

    it('should handle mixed literal and expression concatenation', () => {
      const source = `
        let name: string = "Alice";
        let age: int = 30;
        let msg: string = "Name: " + name + ", Age: " + age;
      `;
      const result = generateCode(source);
      
      // Literals must be wrapped, variables and expressions should not
      expect(result.source).toContain('std::string msg = (((std::string("Name: ") + name) + std::string(", Age: ")) + std::to_string(age))');
    });

    it('should handle literal concatenation with numbers', () => {
      const source = `
        let result: string = "Count: " + 42;
      `;
      const result = generateCode(source);
      
      // Literal must be wrapped, number conversion doesn't need wrapping
      expect(result.source).toContain('std::string result = (std::string("Count: ") + std::to_string(42))');
    });

    it('should handle literal concatenation with booleans', () => {
      const source = `
        let result: string = "Active: " + true;
      `;
      const result = generateCode(source);
      
      // Literal must be wrapped
      expect(result.source).toContain('std::string result = (std::string("Active: ") + (true ? std::string("true") : std::string("false")))');
    });

    it('should handle literal concatenation with chars', () => {
      const source = `
        let result: string = "Grade: " + 'A';
      `;
      const result = generateCode(source);
      
      // Literal must be wrapped
      expect(result.source).toContain('std::string result = (std::string("Grade: ") + std::string(1, \'A\'))');
    });

    it('should handle complex literal concatenation chains', () => {
      const source = `
        let result: string = "a" + "b" + "c" + "d" + "e";
      `;
      const result = generateCode(source);
      
      // All literals must be wrapped to ensure valid C++
      expect(result.source).toMatch(/std::string\("a"\)/);
      expect(result.source).toMatch(/std::string\("b"\)/);
      expect(result.source).toMatch(/std::string\("c"\)/);
      expect(result.source).toMatch(/std::string\("d"\)/);
      expect(result.source).toMatch(/std::string\("e"\)/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string literals', () => {
      const source = `
        let result: string = "" + "World";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string result = (std::string("") + std::string("World"))');
    });

    it('should handle literals with escape sequences', () => {
      const source = `
        let result: string = "Hello\\n" + "World\\t";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string result = (std::string("Hello\\n") + std::string("World\\t"))');
    });

    it('should handle literals with quotes', () => {
      const source = `
        let result: string = "She said \\"Hello\\"" + " to me";
      `;
      const result = generateCode(source);
      
      expect(result.source).toContain('std::string("She said');
      expect(result.source).toContain('std::string(" to me")');
    });
  });
});
