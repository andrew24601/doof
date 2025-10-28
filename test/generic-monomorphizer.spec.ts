import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { monomorphizePrograms } from '../src/project/monomorphizer.js';
import type { Program, ValidationContext } from '../src/types.js';

function parseAndValidate(source: string): { program: Program; context: ValidationContext } {
  const lexer = new Lexer(source, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do');
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  expect(context.errors).toHaveLength(0);
  return { program, context };
}

describe('Monomorphizer', () => {
  it('specializes generic functions and rewrites call sites', () => {
    const code = `
      function identity<T>(value: T): T {
        return value;
      }

      let result = identity<int>(42);
    `;

  const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);
    expect(result.diagnostics).toHaveLength(0);

    const fnDecl = program.body.find(stmt => stmt.kind === 'function')!;
    expect(fnDecl).toBeDefined();
    if (fnDecl.kind !== 'function') throw new Error('expected function');
    expect(fnDecl.name.name).toBe('identity__primitive_int');
    expect(fnDecl.typeParameters).toBeUndefined();
    expect(fnDecl.parameters[0].type).toEqual({ kind: 'primitive', type: 'int' });
    expect(fnDecl.returnType).toEqual({ kind: 'primitive', type: 'int' });

    const varDecl = program.body.find(stmt => stmt.kind === 'variable');
    expect(varDecl).toBeDefined();
    if (!varDecl || varDecl.kind !== 'variable' || varDecl.initializer?.kind !== 'call') {
      throw new Error('expected variable declaration with call initializer');
    }
    const call = varDecl.initializer;
    expect(call.callee.kind).toBe('identifier');
    if (call.callee.kind === 'identifier') {
      expect(call.callee.name).toBe('identity__primitive_int');
    }
    expect(call.typeArguments).toBeUndefined();
    expect(call.genericInstantiation).toBeUndefined();

    expect(context.functions.has('identity')).toBe(false);
    expect(context.functions.has('identity__primitive_int')).toBe(true);
  });

  it('specializes generic classes and rewrites type annotations', () => {
    const code = `
      class Box<T> {
        value: T;
      }

      let boxed: Box<int> = Box<int>(42);
    `;

    const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);
    expect(result.diagnostics).toHaveLength(0);

    const classDecl = program.body.find(stmt => stmt.kind === 'class');
    expect(classDecl).toBeDefined();
    if (!classDecl || classDecl.kind !== 'class') {
      throw new Error('expected class declaration');
    }
    expect(classDecl.name.name).toBe('Box__primitive_int');
    expect(classDecl.typeParameters).toBeUndefined();
    expect(classDecl.fields[0].type).toEqual({ kind: 'primitive', type: 'int' });

    const varDecl = program.body.find(stmt => stmt.kind === 'variable');
    expect(varDecl).toBeDefined();
    if (!varDecl || varDecl.kind !== 'variable') {
      throw new Error('expected variable declaration');
    }
    expect(varDecl.type).toEqual({ kind: 'class', name: 'Box__primitive_int' });

    if (!varDecl.initializer || varDecl.initializer.kind !== 'positionalObject') {
      throw new Error('expected positional object initializer');
    }
    expect(varDecl.initializer.className).toBe('Box__primitive_int');
    expect(varDecl.initializer.typeArguments).toBeUndefined();
    expect(varDecl.initializer.genericInstantiation).toBeUndefined();

    expect(context.classes.has('Box')).toBe(false);
    expect(context.classes.has('Box__primitive_int')).toBe(true);
  });
});
