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

describe('Default Parameters', () => {
  describe('Syntax and Parsing', () => {
    it('should parse function parameters with default values', () => {
      const input = `
        function greet(name: string = "world", age: int = 25): void {
          println("Hello \${name}");
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void greet(const std::string& name = "world", int age = 25);');
      expect(result.source).toContain('void greet(const std::string& name, int age)');
    });

    it('should parse method parameters with default values', () => {
      const input = `
        class Calculator {
          multiply(a: int, b: int = 2): int {
            return a * b;
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('int multiply(int a, int b = 2);');
      expect(result.source).toContain('int Calculator::multiply(int a, int b)');
    });

    it('should parse static method parameters with default values', () => {
      const input = `
        class Point {
          x: int;
          y: int;
          
          static create(x: int = 0, y: int = 0): Point {
            return { x: x, y: y };
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('static std::shared_ptr<Point> create(int x = 0, int y = 0);');
      expect(result.source).toContain('std::shared_ptr<Point> Point::create(int x, int y)');
    });

    it('should parse mixed parameters with and without defaults', () => {
      const input = `
        function process(required: string, optional: int = 42, alsoOptional: bool = true): void {
          println(required);
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void process(const std::string& required, int optional = 42, bool alsoOptional = true);');
      expect(result.source).toContain('void process(const std::string& required, int optional, bool alsoOptional)');
    });
  });

  describe('Default Value Types', () => {
    it('should support number literals as defaults', () => {
      const input = `
        function test(intVal: int = 42, floatVal: float = 3.14, doubleVal: double = 2.718): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('int intVal = 42');
      expect(result.header).toContain('float floatVal = 3.14');
      expect(result.header).toContain('double doubleVal = 2.718');
    });

    it('should support string literals as defaults', () => {
      const input = `
        function test(name: string = "default", message: string = 'hello'): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('const std::string& name = "default"');
      expect(result.header).toContain('const std::string& message = "hello"');
    });

    it('should support boolean literals as defaults', () => {
      const input = `
        function test(flag1: bool = true, flag2: bool = false): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('bool flag1 = true');
      expect(result.header).toContain('bool flag2 = false');
    });

    it('should support enum values as defaults', () => {
      const input = `
        enum Color { Red, Green, Blue }
        
        function test(color: Color = Color.Red): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('Color color = Color::Red');
    });

    it('should support enum shorthand as defaults', () => {
      const input = `
        enum Status { Active, Inactive }
        
        function test(status: Status = .Active): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('Status status = Status::Active');
    });
  });

  describe('Type Validation', () => {
    it('should validate that default value type matches parameter type', () => {
      const input = `
        function test(name: string = 42): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Parameter default value type');
      expect(result.errors[0]).toContain('not compatible');
    });

    it('should reject non-literal default values', () => {
      const input = `
        function test(arr: int[] = [1, 2, 3]): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Parameter default values must be strict literals');
    });

    it('should reject object literals as default values', () => {
      const input = `
        class Point { x: int; y: int; }
        function test(pt: Point = Point { x: 1, y: 2 }): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Parameter default values must be strict literals');
    });

    it('should reject function calls as default values', () => {
      const input = `
        function getValue(): int { return 42; }
        function test(val: int = getValue()): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Parameter default values must be strict literals');
    });

    it('should reject null as default value', () => {
      const input = `
        function test(val: int = null): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Parameter default values must be strict literals');
    });
  });

  describe('Complex Examples', () => {
    it('should handle class methods with default parameters', () => {
      const input = `
        enum Priority { Low, Medium, High }
        
        class Task {
          name: string;
          priority: Priority;
          
          update(newName: string = "untitled", newPriority: Priority = .Low): void {
            this.name = newName;
            this.priority = newPriority;
          }
          
          static create(name: string = "new task"): Task {
            return Task { name: name, priority: .Medium };
          }
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      
      // Check method declaration
      expect(result.header).toContain('void update(const std::string& newName = "untitled", Priority newPriority = Priority::Low);');
      expect(result.source).toContain('void Task::update(const std::string& newName, Priority newPriority)');
      
      // Check static method declaration
      expect(result.header).toContain('static std::shared_ptr<Task> create(const std::string& name = "new task");');
      expect(result.source).toContain('std::shared_ptr<Task> Task::create(const std::string& name)');
    });

    it('should handle function with all types of default parameters', () => {
      const input = `
        enum Mode { Fast, Slow }
        
        function configure(
          name: string = "default",
          count: int = 10,
          rate: double = 1.5,
          enabled: bool = true,
          mode: Mode = .Fast
        ): void {
          println(name);
        }
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void configure(const std::string& name = "default", int count = 10, double rate = 1.5, bool enabled = true, Mode mode = Mode::Fast);');
      expect(result.source).toContain('void configure(const std::string& name, int count, double rate, bool enabled, Mode mode)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty parameter list', () => {
      const input = `
        function test(): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void test();');
    });

    it('should handle parameters with no defaults', () => {
      const input = `
        function test(a: int, b: string): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void test(int a, const std::string& b);');
      expect(result.source).toContain('void test(int a, const std::string& b)');
    });

    it('should handle single parameter with default', () => {
      const input = `
        function test(value: int = 42): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('void test(int value = 42);');
      expect(result.source).toContain('void test(int value)');
    });

    it('should validate enum default values exist', () => {
      const input = `
        enum Color { Red, Green, Blue }
        function test(color: Color = Color.Yellow): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors.length).toBeGreaterThan(0);
      const yellowError = result.errors.find(err => err.includes('Yellow'));
      expect(yellowError).toBeDefined();
    });
  });

  describe('Numeric Types', () => {
    it('should handle different numeric literal formats', () => {
      const input = `
        function test(
          floatVal: double = 1.234
        ): void {}
      `;
      
      const result = generateCodeFromString(input);
      expect(result.errors).toEqual([]);
      expect(result.header).toContain('double floatVal = 1.234');
    });
  });
});
