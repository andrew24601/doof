import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

describe('String Concatenation - Multiple Targets', () => {
  function generateCodeForTargets(source: string): { cpp: string; js: string } {
    const cppTranspiler = new Transpiler({ target: 'cpp' });
    const jsTranspiler = new Transpiler({ target: 'js' });
    
    const cppResult = cppTranspiler.transpile(source, 'test.do');
    const jsResult = jsTranspiler.transpile(source, 'test.do');
    
    if (cppResult.errors.length > 0) {
      throw new Error(`C++ transpilation errors: ${cppResult.errors.join(', ')}`);
    }
    
    if (jsResult.errors.length > 0) {
      throw new Error(`JS transpilation errors: ${jsResult.errors.join(', ')}`);
    }
    
    return {
      cpp: cppResult.source || '',
      js: jsResult.source || ''
    };
  }

  it('should handle string + string concatenation in both targets', () => {
    const source = `
      function test() {
        let greeting = "Hello, " + "World!";
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string greeting = (std::string("Hello, ") + std::string("World!"))');
    expect(result.js).toContain('let greeting = ("Hello, " + "World!")');
  });

  it('should handle string + number concatenation in both targets', () => {
    const source = `
      function test() {
        let msg = "Count: " + 42;
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string msg = (std::string("Count: ") + std::to_string(42))');
    expect(result.js).toContain('let msg = ("Count: " + 42)');
  });

  it('should handle number + string concatenation in both targets', () => {
    const source = `
      function test() {
        let result = 42 + " is the answer";
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string result = (std::to_string(42) + std::string(" is the answer"))');
    expect(result.js).toContain('let result = (42 + " is the answer")');
  });

  it('should handle left-to-right evaluation with numbers first in both targets', () => {
    const source = `
      function test() {
        let msg = 1 + 2 + " items";
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string msg = (std::to_string((1 + 2)) + std::string(" items"))');
    expect(result.js).toContain('let msg = (String((1 + 2)) + " items")');
  });

  it('should handle pure numeric operations in both targets', () => {
    const source = `
      function test() {
        let sum = 5 + 10;
        let product = 3.14 * 2;
      }
    `;
    const result = generateCodeForTargets(source);
    
    // Both should remain numeric operations
    expect(result.cpp).toContain('int sum = (5 + 10)');
    expect(result.cpp).toContain('double product = (3.14 * 2.0)');
    
    expect(result.js).toContain('let sum = (5 + 10)');
    expect(result.js).toContain('let product = (3.14 * 2)');
  });

  it('should handle boolean concatenation in both targets', () => {
    const source = `
      function test() {
        let msg = "Active: " + true;
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string msg = (std::string("Active: ") + (true ? std::string("true") : std::string("false")))');
    expect(result.js).toContain('let msg = ("Active: " + true)');
  });

  it('should handle complex concatenation chains in both targets', () => {
    const source = `
      function test() {
        let name = "Alice";
        let age = 30;
        let msg = "Name: " + name + ", Age: " + age;
      }
    `;
    const result = generateCodeForTargets(source);
    
    expect(result.cpp).toContain('std::string msg = (((std::string("Name: ") + name) + std::string(", Age: ")) + std::to_string(age))');
    expect(result.js).toContain('let msg = ((("Name: " + name) + ", Age: ") + age)');
  });
});
