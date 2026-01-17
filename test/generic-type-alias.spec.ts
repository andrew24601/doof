import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { validateProgramForTests } from './helpers/validation';
import { Formatter } from '../src/formatter.js';
import { TypeAliasDeclaration } from '../src/types.js';

describe('Generic Type Aliases', () => {
  function transpileCode(code: string, allowErrors = false) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast, { allowErrors });
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors, ast };
  }

  function validateOnly(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast, { allowErrors: true });
    return { errors: context.errors, ast };
  }

  function parseCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
  }

  function formatCode(code: string): string {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const formatter = new Formatter();
    return formatter.format(ast);
  }

  describe('Parsing', () => {
    it('should parse generic type alias with single type parameter', () => {
      const code = `type Row<T> = T[];`;
      const ast = parseCode(code);
      
      expect(ast.body).toHaveLength(1);
      const typeAlias = ast.body[0] as TypeAliasDeclaration;
      expect(typeAlias.kind).toBe('typeAlias');
      expect(typeAlias.name.name).toBe('Row');
      expect(typeAlias.typeParameters).toBeDefined();
      expect(typeAlias.typeParameters).toHaveLength(1);
      expect(typeAlias.typeParameters![0].name).toBe('T');
      expect(typeAlias.type.kind).toBe('array');
    });

    it('should parse generic type alias with multiple type parameters', () => {
      const code = `type Pair<K, V> = Map<K, V>;`;
      const ast = parseCode(code);
      
      const typeAlias = ast.body[0] as TypeAliasDeclaration;
      expect(typeAlias.typeParameters).toHaveLength(2);
      expect(typeAlias.typeParameters![0].name).toBe('K');
      expect(typeAlias.typeParameters![1].name).toBe('V');
    });

    it('should parse non-generic type alias (backwards compatibility)', () => {
      const code = `type IntArray = int[];`;
      const ast = parseCode(code);
      
      const typeAlias = ast.body[0] as TypeAliasDeclaration;
      expect(typeAlias.typeParameters).toBeUndefined();
    });
  });

  describe('Validation', () => {
    it('should validate generic type alias usage with correct type arguments', () => {
      const code = `
        type Row<T> = T[];
        let numbers: Row<int> = [1, 2, 3];
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate nested generic type alias', () => {
      const code = `
        type Row<T> = T[];
        type Matrix<T> = Row<T>[];
        let m: Matrix<int> = [[1, 2], [3, 4]];
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate generic type alias with multiple parameters', () => {
      const code = `
        type Tuple<A, B> = A | B;
        let t: Tuple<int, string> = 42;
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should error when missing type arguments for generic alias', () => {
      const code = `
        type Row<T> = T[];
        let numbers: Row = [1, 2, 3];
      `;
      
      const result = validateOnly(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("requires 1 type argument");
    });

    it('should error when providing wrong number of type arguments', () => {
      const code = `
        type Row<T> = T[];
        let numbers: Row<int, string> = [1, 2, 3];
      `;
      
      const result = validateOnly(code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("expects 1 type argument but got 2");
    });

    it('should error when providing type arguments to non-generic alias', () => {
      const code = `
        type IntArray = int[];
        let numbers: IntArray<string> = [1, 2, 3];
      `;
      
      const result = transpileCode(code, true);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("does not accept type arguments");
    });

    it('should validate type parameter usage in alias definition', () => {
      const code = `
        type Transform<T, U> = (x: T): U;
        let double: Transform<int, int> = (n: int): int => n * 2;
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Code Generation', () => {
    it('should resolve generic type alias to concrete type in generated C++', () => {
      const code = `
        type Row<T> = T[];
        let numbers: Row<int> = [1, 2, 3];
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      // Should generate std::vector<int> not Row<int>
      expect(result.source).toContain('std::shared_ptr<std::vector<int>>');
    });

    it('should resolve nested generic type aliases', () => {
      const code = `
        type Row<T> = T[];
        type Matrix<T> = Row<T>[];
        let m: Matrix<int> = [[1, 2], [3, 4]];
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      // Should generate nested vectors
      expect(result.source).toContain('std::shared_ptr<std::vector<std::shared_ptr<std::vector<int>>>>');
    });
  });

  describe('Formatting', () => {
    it('should format generic type alias declaration', () => {
      const code = `type Row<T> = T[];`;
      const formatted = formatCode(code);
      expect(formatted.trim()).toBe('type Row<T> = T[];');
    });

    it('should format generic type alias with multiple parameters', () => {
      const code = `type   Pair<K,V>   =   Map<K, V>;`;
      const formatted = formatCode(code);
      expect(formatted.trim()).toBe('type Pair<K, V> = Map<K, V>;');
    });

    it('should format usage of generic type alias', () => {
      const code = `
        type Row<T> = T[];
        let r: Row<int> = [];
      `;
      const formatted = formatCode(code);
      expect(formatted).toContain('type Row<T> = T[];');
      expect(formatted).toContain('let r: Row<int> = [];');
    });
  });

  describe('Complex Scenarios', () => {
    it('should work with generic type alias in function parameter', () => {
      const code = `
        type Callback<T> = (value: T): void;
        
        function process(cb: Callback<int>): void {
          cb(42);
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should work with generic type alias in function return type', () => {
      const code = `
        type Result<T> = T | null;
        
        function find(items: int[], value: int): Result<int> {
          for (const item of items) {
            if (item == value) {
              return item;
            }
          }
          return null;
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should work with generic type alias in class field', () => {
      const code = `
        type List<T> = T[];
        
        class Container {
          items: List<int>;
        }
        
        let c = Container { items: [1, 2, 3] };
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should work with exported generic type alias', () => {
      const code = `
        export type Row<T> = T[];
        let r: Row<string> = ["a", "b"];
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });
  });
});
