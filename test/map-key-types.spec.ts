import { describe, it, expect } from 'vitest';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { validateProgramForTests } from './helpers/validation';

function transpileCode(code: string): { header: string; source: string; errors: any[] } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const context = validateProgramForTests(program, { allowErrors: true });
  const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);
  return { header: result.header ?? '', source: result.source ?? '', errors: context.errors };
}

describe('Map and Set Key Type Support', () => {
  describe('Map literals with valid key types', () => {
    it('generates correct C++ code for string key maps', () => {
      const code = `
        function test(): void {
          let stringMap: Map<string, int> = { "Alice": 30, "Bob": 25 };
        }
      `;
      const { source, errors } = transpileCode(code);
      expect(errors.filter(e => e.message.includes('Invalid map key type'))).toHaveLength(0);
      expect(source).toContain('std::shared_ptr<std::map<std::string, int>> stringMap = std::make_shared<std::map<std::string, int>>');
      expect(source).toContain('{"Alice", 30}');
      expect(source).toContain('{"Bob", 25}');
    });

    it('generates correct C++ code for integer key maps', () => {
      const code = `
        function test(): void {
          let intMap: Map<int, string> = { 1: "one", 2: "two" };
        }
      `;
      const { source, errors } = transpileCode(code);
      expect(errors.filter(e => e.message.includes('Invalid map key type'))).toHaveLength(0);
      expect(source).toContain('std::shared_ptr<std::map<int, std::string>> intMap = std::make_shared<std::map<int, std::string>>');
      expect(source).toContain('{1, "one"}');
      expect(source).toContain('{2, "two"}');
    });

    it('generates correct C++ code for boolean key maps', () => {
      const code = `
        function test(): void {
          let boolMap: Map<bool, string> = { true: "enabled", false: "disabled" };
        }
      `;
      const { source, errors } = transpileCode(code);
      expect(errors.filter(e => e.message.includes('Invalid map key type'))).toHaveLength(0);
      expect(source).toContain('std::shared_ptr<std::map<bool, std::string>> boolMap = std::make_shared<std::map<bool, std::string>>');
      expect(source).toContain('{true, "enabled"}');
      expect(source).toContain('{false, "disabled"}');
    });
  });

  describe('Type validation for map keys', () => {
    it('rejects invalid map key types', () => {
      const code = `
        function test(): void {
          let floatMap: Map<float, int>;
          let doubleMap: Map<double, int>;
        }
      `;
      const { errors } = transpileCode(code);
      expect(errors.filter(e => e.message.includes('Invalid map key type'))).toHaveLength(2);
      expect(errors.some(e => e.message.includes('float'))).toBe(true);
      expect(errors.some(e => e.message.includes('double'))).toBe(true);
    });

    it('rejects invalid set element types', () => {
      const code = `
        function test(): void {
          let floatSet: Set<float>;
          let doubleSet: Set<double>;
        }
      `;
      const { errors } = transpileCode(code);
      expect(errors.filter(e => e.message.includes('Invalid set element type'))).toHaveLength(2);
      expect(errors.some(e => e.message.includes('float'))).toBe(true);
      expect(errors.some(e => e.message.includes('double'))).toBe(true);
    });
  });

  describe('Comprehensive map literal functionality', () => {
    it('handles complex map literal scenarios', () => {
      const code = `
        function test(): void {
          let ages: Map<string, int> = { "Alice": 30, "Bob": 25, "Charlie": 35 };
          let codes: Map<int, string> = { 1: "one", 2: "two", 3: "three" };
          let flags: Map<bool, string> = { true: "enabled", false: "disabled" };
        }
      `;
      const { source, errors } = transpileCode(code);
      
      // Should not have validation errors
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
      expect(errors.filter(e => e.message.includes('Object literal without class type'))).toHaveLength(0);
      
      // Should generate correct C++ code with shared_ptr maps
      expect(source).toContain('std::shared_ptr<std::map<std::string, int>> ages = std::make_shared<std::map<std::string, int>>');
      expect(source).toContain('std::shared_ptr<std::map<int, std::string>> codes = std::make_shared<std::map<int, std::string>>');
      expect(source).toContain('std::shared_ptr<std::map<bool, std::string>> flags = std::make_shared<std::map<bool, std::string>>');
    });
  });
});
