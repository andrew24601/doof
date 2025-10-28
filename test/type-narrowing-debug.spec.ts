import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Type Narrowing Issue', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', validationContext);
    return {
      errors: validationContext.errors,
      source: result.source,
      header: result.header
    };
  }

  it('should allow operations on narrowed types', () => {
    const code = `
      function main(): int {
        let i: string | int = "fred";

        if (i is int) {
          println(i * 23);
        } else {
          println(i);
        }

        println("Hello world");
        return 0;
      }
    `;
    
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
  });
});
