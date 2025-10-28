import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Panic Function', () => {
  function transpile(code: string) {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    
    if (context.errors.length > 0) {
      throw new Error(`Validation errors: ${context.errors.map(e => e.message).join(', ')}`);
    }
    
    const generator = new CppGenerator({
      includeHeaders: ['<iostream>', '<string>', '<memory>'],
      namespace: undefined
    });
    
    const result = generator.generate(ast, 'test', context);
    return result;
  }

  it('should validate panic function call', () => {
    const code = `
      function test(): void {
        panic("Something went wrong");
      }
    `;
    
    expect(() => transpile(code)).not.toThrow();
  });

  it('should generate correct C++ code for panic', () => {
    const code = `
      function test(): void {
        panic("Test error message");
      }
    `;
    
    const result = transpile(code);
    expect(result.source).toContain('std::cerr << "panic: " << "Test error message" << std::endl');
    expect(result.source).toContain('std::exit(1)');
  });

  it('should accept string expressions in panic', () => {
    const code = `
      function test(message: string): void {
        panic(message);
      }
    `;
    
    expect(() => transpile(code)).not.toThrow();
  });

  it('should generate code for panic with variable', () => {
    const code = `
      function test(): void {
        let msg = "Dynamic error";
        panic(msg);
      }
    `;
    
    const result = transpile(code);
    expect(result.source).toContain('std::cerr << "panic: " << msg << std::endl');
    expect(result.source).toContain('std::exit(1)');
  });

  it('should handle panic with empty string', () => {
    const code = `
      function test(): void {
        panic("");
      }
    `;
    
    const result = transpile(code);
    expect(result.source).toContain('std::cerr << "panic: " << "" << std::endl');
    expect(result.source).toContain('std::exit(1)');
  });
});
