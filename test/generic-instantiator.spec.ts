import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { collectGenericInstantiations } from '../src/project/generic-instantiator.js';
import type { Program, ValidationContext } from '../src/types.js';

function parseValidate(code: string): { program: Program; context: ValidationContext } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, context };
}

describe('Generic instantiation collector', () => {
  it('collects unique function instantiations', () => {
    const code = `
      function identity<T>(value: T): T {
        return value;
      }

      let first = identity<int>(42);
      let second = identity<int>(99);
    `;

    const { program, context } = parseValidate(code);
    const summary = collectGenericInstantiations(program, context);

    expect(summary.diagnostics).toHaveLength(0);
    expect(summary.instantiations).toHaveLength(1);
    const record = summary.instantiations[0];
    expect(record.kind).toBe('function');
    expect(record.name).toBe('identity');
    expect(record.typeArguments).toHaveLength(1);
    expect(record.typeArguments[0]).toEqual({ kind: 'primitive', type: 'int' });
  });

  it('collects class instantiations from expressions and type annotations', () => {
    const code = `
      class Box<T> {
        value: T;
      }

      function createBox(): Box<int> {
        return Box<int>(1);
      }

      let cached: Box<int> = createBox();
    `;

    const { program, context } = parseValidate(code);
    const summary = collectGenericInstantiations(program, context);

    expect(summary.diagnostics).toHaveLength(0);
    expect(summary.instantiations).toHaveLength(1);
    const record = summary.instantiations[0];
    expect(record.kind).toBe('class');
    expect(record.name).toBe('Box');
    expect(record.typeArguments).toHaveLength(1);
    expect(record.typeArguments[0]).toEqual({ kind: 'primitive', type: 'int' });
  });
});
