import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { validateProgramForTests } from './helpers/validation';

describe('Sum Types', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
  const ast = parser.parse();
  const context = validateProgramForTests(ast, { allowErrors: true });
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  it('should parse and generate nullable primitive type', () => {
    const code = `
      let x: int | null;
    `;
    
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toContain('std::optional<int>');
  });

  it('should parse and generate simple union type', () => {
    const code = `
      let x: int | string;
    `;
    
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toContain('std::variant<int, std::string>');
  });

  it('should parse and validate type guard expressions', () => {
    const code = `
      let x: int | string;
      if (x is int) {
        // x is narrowed to int here
      }
    `;
    
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toContain('std::holds_alternative<int>');
  });

  it('should handle nullable class types', () => {
    const code = `
      class Person {
        name: string;
      }
      
      function test() {
        let p: Person | null = null;
        if (p is null) {
          // p is null
        }
      }
    `;
    
    const result = transpileCode(code);
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('std::shared_ptr<Person>');
    // TODO: Fix null type guard generation for collapsed nullable types
    // expect(result.source).toContain('== nullptr');
  });

  it('should validate duplicate types in union', () => {
    const code = `
      let x: int | int;
    `;
    
    const result = transpileCode(code);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message?.includes('Duplicate type'))).toBe(true);
  });

  it('should validate impossible type guards', () => {
    const code = `
      let x: int;
      if (x is string) {
        // This should be an error
      }
    `;
    
    const result = transpileCode(code);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message?.includes('will never be true'))).toBe(true);
  });
});
