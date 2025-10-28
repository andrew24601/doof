import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser';
import { Lexer } from '../src/parser/lexer';
import { CppGenerator } from '../src/codegen/cppgen';
import { JsGenerator } from '../src/codegen/jsgen';
import { VMGenerator } from '../src/codegen/vmgen';
import { ValidationContext, Program, BreakStatement, ContinueStatement } from '../src/types';
import { validateProgramForTests } from './helpers/validation';

// Helper function to parse code
function parseCode(source: string): { program: Program; context: ValidationContext } {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const context = validateProgramForTests(ast);
  return { program: ast, context };
}

describe('Break and Continue Statement Code Generation', () => {
  describe('C++ Generator', () => {
    it('should generate break statement', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i == 5) {
              break;
            }
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('for (int i = 0; (i < 10); (i++))');
    });

    it('should generate continue statement', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i % 2 == 0) {
              continue;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('continue;');
      expect(result.source).toContain('for (int i = 0; (i < 10); (i++))');
    });

    it('should generate break and continue in while loop', () => {
      const code = `
        function test(): void {
          let x: int = 0;
          while (x < 100) {
            x++;
            if (x % 10 == 0) {
              continue;
            }
            if (x > 50) {
              break;
            }
            println(x);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('continue;');
      expect(result.source).toContain('while ((x < 100))');
    });

    it('should generate break and continue in for-of range loop', () => {
      const code = `
        function test(): void {
          for (const i of 0..<10) {
            if (i == 3) {
              continue;
            }
            if (i == 7) {
              break;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('continue;');
      expect(result.source).toContain('for (int i = 0; i < 10; i++)');
    });

    it('should handle nested loops with break and continue', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 5; i++) {
            for (let j: int = 0; j < 5; j++) {
              if (j == 2) {
                continue;  // Only affects inner loop
              }
              if (i == 3 && j == 4) {
                break;     // Only affects inner loop
              }
              println(i * 5 + j);
            }
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('continue;');
      // Should have two nested for loops
      expect((result.source.match(/for \(int/g) || []).length).toBe(2);
    });
  });

  describe('JavaScript Generator', () => {
    it('should generate break statement', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i == 5) {
              break;
            }
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new JsGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('for (  let i = 0; (i < 10); i++)');
    });

    it('should generate continue statement', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i % 2 == 0) {
              continue;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new JsGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('continue;');
      expect(result.source).toContain('for (  let i = 0; (i < 10); i++)');
    });

    it('should generate break and continue in while loop', () => {
      const code = `
        function test(): void {
          let x: int = 0;
          while (x < 100) {
            x++;
            if (x % 10 == 0) {
              continue;
            }
            if (x > 50) {
              break;
            }
            println(x);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new JsGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('continue;');
      expect(result.source).toContain('while ((x < 100))');
    });

    it('should generate break and continue in for-of range loop', () => {
      const code = `
        function test(): void {
          for (const i of 0..<10) {
            if (i == 3) {
              continue;
            }
            if (i == 7) {
              break;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new JsGenerator();
  const result = generator.generate(program, 'test', context);

      expect(result.source).toContain('break;');
      expect(result.source).toContain('continue;');
      expect(result.source).toContain('for (let i = 0; i < 10; i++)');
    });
  });

  describe('VM Generator', () => {
    it('should generate break statement bytecode', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i == 5) {
              break;
            }
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new VMGenerator();

      // This should not throw an error
      expect(() => {
  generator.generate(program, 'test', context);
      }).not.toThrow();
    });

    it('should generate continue statement bytecode', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 10; i++) {
            if (i % 2 == 0) {
              continue;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new VMGenerator();

      // This should not throw an error
      expect(() => {
  generator.generate(program, 'test', context);
      }).not.toThrow();
    });

    it('should handle break and continue in while loop', () => {
      const code = `
        function test(): void {
          let x: int = 0;
          while (x < 100) {
            x++;
            if (x % 10 == 0) {
              continue;
            }
            if (x > 50) {
              break;
            }
            println(x);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new VMGenerator();

      // This should not throw an error
      expect(() => {
  generator.generate(program, 'test', context);
      }).not.toThrow();
    });

    it('should handle break and continue in for-of range loop', () => {
      const code = `
        function test(): void {
          for (const i of 0..<10) {
            if (i == 3) {
              continue;
            }
            if (i == 7) {
              break;
            }
            println(i);
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new VMGenerator();

      // This should not throw an error
      expect(() => {
  generator.generate(program, 'test', context);
      }).not.toThrow();
    });

    it('should handle nested loops with break and continue', () => {
      const code = `
        function test(): void {
          for (let i: int = 0; i < 3; i++) {
            for (let j: int = 0; j < 3; j++) {
              if (j == 1) {
                continue;
              }
              if (i == 2 && j == 2) {
                break;
              }
              println(i * 3 + j);
            }
          }
        }
      `;
        const { program, context } = parseCode(code);
      const generator = new VMGenerator();

      // This should not throw an error
      expect(() => {
  generator.generate(program, 'test', context);
      }).not.toThrow();
    });

    it('should throw error for break outside loop', () => {
      const code = `
        function test(): void {
          break;
        }
      `;
  expect(() => parseCode(code)).toThrow(/'break' statement can only be used inside loops or switch statements/);
    });

    it('should throw error for continue outside loop', () => {
      const code = `
        function test(): void {
          continue;
        }
      `;
  expect(() => parseCode(code)).toThrow(/'continue' statement can only be used inside loops/);
    });

    it('should throw error for break in if statement outside loop', () => {
      const code = `
        function test(): void {
          if (true) {
            break;
          }
        }
      `;
  expect(() => parseCode(code)).toThrow(/'break' statement can only be used inside loops or switch statements/);
    });
  });
});
