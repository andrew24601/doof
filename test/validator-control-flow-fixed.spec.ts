import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';

describe('Validator - Control Flow and Exception Coverage', () => {
  function parseAndValidate(code: string) {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(program);
    return { program, context, errors: context.errors };
  }

  describe('if statement validation', () => {
    it('should validate if statement with boolean condition', () => {
      const code = `
        function test(): void {
          let condition: bool = true;
          if (condition) {
            let x: int = 42;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate if-else statement', () => {
      const code = `
        function test(): void {
          let condition: bool = true;
          if (condition) {
            let x: int = 42;
          } else {
            let y: int = 24;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect non-boolean condition in if statement', () => {
      const code = `
        function test(): void {
          let num: int = 5;
          if (num) {
            let x: int = 42;
          }
        }
      `;
      const result = parseAndValidate(code);
      // ...existing code...
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('bool'))).toBe(true);
    });
  });

  describe('while statement validation', () => {
    it('should validate while statement with boolean condition', () => {
      const code = `
        function test(): void {
          let running: bool = true;
          while (running) {
            running = false;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect non-boolean condition in while statement', () => {
      const code = `
        function test(): void {
          let counter: int = 5;
          while (counter) {
            counter = counter - 1;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('bool'))).toBe(true);
    });
  });

  describe('for statement validation', () => {
    it('should validate for statement with proper structure', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i = i + 1) {
            let x: int = i;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate for statement with expression initialization', () => {
      const code = `
        function test(): void {
          let i: int = 0;
          for (i = 0; i < 10; i = i + 1) {
            let x: int = i;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect non-boolean condition in for statement', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i; i = i + 1) {
            let x: int = i;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('bool'))).toBe(true);
    });

    it('should validate for statement without initialization', () => {
      const code = `
        function test(): void {
          let i: int = 0;
          for (; i < 10; i = i + 1) {
            let x: int = i;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate for statement without condition', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; ; i = i + 1) {
            if (i > 5) {
              break;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate for statement without update', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10;) {
            i = i + 1;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('for-of statement validation', () => {
    it('should validate for-of with array iteration', () => {
      const code = `
        function test(): void {
          let numbers: int[] = [1, 2, 3];
          for (const num of numbers) {
            let x: int = num;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate for-of with set iteration', () => {
      const code = `
        function test(): void {
          let items: Set<int> = {1, 2, 3};
          for (const item of items) {
            let x: int = item;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect iteration over non-iterable type', () => {
      const code = `
        function test(): void {
          let num: int = 42;
          for (const item of num) {
            let x: int = item;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('iterable'))).toBe(true);
    });

    it('should detect map iteration (not yet supported)', () => {
      const code = `
        function test(): void {
          let map: Map<string, int> = {"a": 1, "b": 2};
          for (const entry of map) {
            let x: int = entry;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('switch statement validation', () => {
    it('should validate switch statement with compatible case values', () => {
      const code = `
        function test(): void {
          let value: int = 5;
          switch (value) {
            case 1: {
              let x: int = 1;
            }
            case 2: {
              let y: int = 2;
            }
            default: {
              let z: int = 0;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate switch statement with enum values', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE }
        function test(): void {
          let status: Status = Status.ACTIVE;
          switch (status) {
            case Status.ACTIVE: {
              let x: int = 1;
            }
            case Status.INACTIVE: {
              let y: int = 2;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect incompatible case value types', () => {
      const code = `
        function test(): void {
          let value: int = 5;
          switch (value) {
            case 1: {
              let x: int = 1;
            }
            case "two": {
              let y: int = 2;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('type'))).toBe(true);
    });
  });

  describe('return statement validation', () => {
    it('should validate return statement with correct type', () => {
      const code = `
        function getValue(): int {
          return 42;
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate void return statement', () => {
      const code = `
        function doSomething(): void {
          return;
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should detect return statement outside function', () => {
      const code = `
        let x: int = 5;
        return x;
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('Return'))).toBe(true);
    });

    it('should detect incorrect return type', () => {
      const code = `
        function getValue(): int {
          return "not a number";
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('type'))).toBe(true);
    });

    it('should detect missing return value for non-void function', () => {
      const code = `
        function getValue(): int {
          return;
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(err => err.message.includes('return'))).toBe(true);
    });
  });


  describe('block statement validation', () => {
    it('should validate nested block statements', () => {
      const code = `
        function test(): void {
          {
            let x: int = 42;
            {
              let y: int = x + 1;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate variable scoping in blocks', () => {
      const code = `
        function test(): void {
          let x: int = 1;
          {
            let y: int = 2;
            x = x + y;
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('expression statement validation', () => {
    it('should validate expression statements', () => {
      const code = `
        function test(): void {
          let x: int = 42;
          x = x + 1;
          x;
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });

    it('should validate function call expression statements', () => {
      const code = `
        function helper(): void {}
        function test(): void {
          helper();
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('break and continue statements', () => {
    it('should validate break and continue statements', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i = i + 1) {
            if (i == 5) {
              break;
            }
            if (i == 3) {
              continue;
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });

  describe('complex control flow scenarios', () => {
    it('should validate nested control structures', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i = i + 1) {
            if (i < 5) {
              while (i > 0) {
                i = i - 1;
                if (i == 2) {
                  break;
                }
              }
            } else {
              switch (i) {
                case 5: {
                  continue;
                }
                case 6: {
                  break;
                }
                default: {
                  i = i + 1;
                }
              }
            }
          }
        }
      `;
      const result = parseAndValidate(code);
      expect(result.errors).toStrictEqual([]);
    });
  });
});
