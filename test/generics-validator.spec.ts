import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { Program } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: any[] } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, errors: context.errors };
}

describe('Generic function validation', () => {
  it('accepts calls with explicit type arguments', () => {
    const code = `
      function identity<T>(value: T): T {
        return value;
      }

      let result: int = identity<int>(42);
    `;

    const { errors } = parseAndValidate(code);
    expect(errors).toHaveLength(0);
  });

  it('requires explicit type arguments for generic functions', () => {
    const code = `
      function identity<T>(value: T): T {
        return value;
      }

      let result = identity(42);
    `;

    const { errors } = parseAndValidate(code);
    expect(errors.some(err => err.message.includes("requires 1 type argument"))).toBe(true);
  });

  it('rejects mismatched type arguments in calls', () => {
    const code = `
      function pick<T>(value: T): T {
        return value;
      }

      pick<int>("nope");
    `;

    const { errors } = parseAndValidate(code);
    expect(errors.some(err => err.message.includes("cannot convert 'string' to 'int'"))).toBe(true);
  });
});

describe('Generic class validation', () => {
  it('accepts constructor calls with explicit type arguments', () => {
    const code = `
      class Box<T> {
        value: T;
      }

      let boxed = Box<int>(42);
    `;

    const { errors } = parseAndValidate(code);
    expect(errors).toHaveLength(0);
  });

  it('requires explicit type arguments for generic classes', () => {
    const code = `
      class Box<T> {
        value: T;
      }

      let boxed = Box(42);
    `;

    const { errors } = parseAndValidate(code);
    expect(errors.some(err => err.message.includes("requires 1 type argument"))).toBe(true);
  });

  it('rejects constructor arguments that do not match instantiated types', () => {
    const code = `
      class Box<T> {
        value: T;
      }

      Box<int>("oops");
    `;

    const { errors } = parseAndValidate(code);
    expect(errors.some(err => err.message.includes("cannot convert 'string' to 'int'"))).toBe(true);
  });
});
