import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';

function parseAndValidate(code: string) {
  try {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);

    return { ast, context, errors: context.errors };
  } catch (error: any) {
    return { ast: null, context: null, errors: [{ message: error.message, location: { start: { line: 1, column: 1 } } }] };
  }
}

describe('Lambda parameter names', () => {
  it('accepts different parameter names for a user-defined callback', () => {
    const code = `
      function process(callback(value: int)): void {
        callback(10);
      }

      function main(): void {
        // Lambda uses different parameter name 'x' instead of 'value'
        process((x: int) => println(x));
      }
    `;

    const { errors } = parseAndValidate(code);
    expect(errors).toHaveLength(0);
  });

  it('accepts lambdas with arbitrary parameter names for array.map/forEach', () => {
    const code = `
      function main(): void {
        const arr = [1, 2, 3];
        // intrinsic methods expect (it, index) or similar arity; use arbitrary names
        arr.forEach((x: int, idx: int) => println(x));
        arr.map((value: int, i: int) => value + 1);
      }
    `;

    const { errors } = parseAndValidate(code);
    if (errors.length) console.log('Validation errors:', JSON.stringify(errors, null, 2));
    expect(errors).toHaveLength(0);
  });
});
