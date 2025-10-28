// Test file for concise lambda declaration forms

import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { ParseError } from '../src/types.js';

describe('Concise Lambda Declarations - Simple Tests', () => {
  function parseAndValidate(code: string) {
    try {
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();
      
      const validator = new Validator({ allowTopLevelStatements: true });
      const context = validator.validate(ast);
      
      return { ast, context, errors: context.errors };
    } catch (error) {
      // Return parse errors as validation errors for test consistency
      const emptyProgram = { kind: 'program' as const, body: [] };
      const errorMessage = error instanceof ParseError ? error.message : (error as Error).message;
      return { ast: emptyProgram, context: null, errors: [{ message: errorMessage, line: 1, column: 1 }] };
    }
  }

  it('should work with all three concise forms', () => {
    const code = `
      function process(callback(value: int)): void {
        callback(42);
      }
      
      class Handler {
        onEvent(data: string);
      }
      
      function main(): void {
        const logger(msg: int) => println(msg);
        process(logger);
      }
    `;
    
    const { ast, errors } = parseAndValidate(code);
    expect(errors).toHaveLength(0);
    const nonBlankStatements = ast.body.filter(stmt => stmt.kind !== 'blank');
    expect(nonBlankStatements).toHaveLength(3);
  });
});
