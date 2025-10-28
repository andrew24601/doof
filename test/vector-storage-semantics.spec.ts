import { describe, it, expect } from 'vitest';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { validateProgramForTests } from './helpers/validation';

describe('Vector Storage Semantics', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
  const ast = parser.parse();
  const context = validateProgramForTests(ast);
    const generator = new CppGenerator();
  const result = generator.generate(ast, 'test', context);
  return { header: result.header ?? '', source: result.source ?? '' };
  }

  describe('Dynamic Arrays (std::shared_ptr<std::vector<T>>)', () => {
    it('should generate shared_ptr storage for dynamic arrays', () => {
      const code = `
        function test(): void {
          let numbers: int[] = [1, 2, 3];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('std::shared_ptr<std::vector<int>> numbers');
      expect(result.source).toContain('std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2, 3})');
    });

    it('should use shared_ptr for empty dynamic arrays', () => {
      const code = `
        function test(): void {
          let empty: string[] = [];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('std::shared_ptr<std::vector<std::string>> empty');
      expect(result.source).toContain('std::make_shared<std::vector<std::string>>()');
    });

    it('should use -> for dynamic array member access', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          let size = arr.length;
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->size()');
    });

    it('should use -> for dynamic array element access', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          let first = arr[0];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->at(0)');
    });

    it('should use -> for dynamic array method calls', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          arr.push(4);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->push_back(4)');
    });

    it('should return shared_ptr from functions', () => {
      const code = `
        function createArray(): int[] {
          return [1, 2, 3];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.header).toContain('std::shared_ptr<std::vector<int>> createArray();');
      expect(result.source).toContain('std::shared_ptr<std::vector<int>> createArray()');
    });

    it('should pass dynamic arrays as shared_ptr parameters', () => {
      const code = `
        function processArray(arr: int[]): void {
          arr.push(42);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.header).toContain('void processArray(std::shared_ptr<std::vector<int>> arr);');
      expect(result.source).toContain('arr->push_back(42)');
    });
  });

  describe('Array Method Transformations', () => {
    it('should use -> for dynamic array method calls', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          arr.push(4);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->push_back(4)');
    });

    it('should use -> for dynamic array size access', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          let size = arr.length;
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->size()');
    });

    it('should use -> for dynamic array element access', () => {
      const code = `
        function test(): void {
          let arr: int[] = [1, 2, 3];
          let first = arr[0];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('arr->at(0)');
    });
  });

  describe('Class Member Arrays', () => {
    it('should generate correct field types for dynamic arrays in classes', () => {
      const code = `
        class Container {
          items: int[] = [];
        }
      `;
      
      const result = transpileCode(code);
      expect(result.header).toContain('std::shared_ptr<std::vector<int>> items');
    });
  });
});
