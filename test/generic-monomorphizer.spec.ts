import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { monomorphizePrograms } from '../src/project/monomorphizer.js';
import type { Program, ValidationContext, ClassDeclaration, MethodDeclaration } from '../src/types.js';

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

  it('specializes generic instance methods and rewrites call sites', () => {
    const code = `
      class Transformer {
        transform<T>(value: T): T {
          return value;
        }
      }

      let t = Transformer {};
      let result = t.transform<int>(42);
    `;

    const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);
    expect(result.diagnostics).toHaveLength(0);

    // Find the class declaration
    const classDecl = program.body.find(stmt => stmt.kind === 'class') as ClassDeclaration;
    expect(classDecl).toBeDefined();
    expect(classDecl.name.name).toBe('Transformer');

    // The generic method should be replaced with specialized version
    expect(classDecl.methods.length).toBe(1);
    const specializedMethod = classDecl.methods[0];
    expect(specializedMethod.name.name).toBe('transform__primitive_int');
    expect(specializedMethod.typeParameters).toBeUndefined();
    expect(specializedMethod.parameters[0].type).toEqual({ kind: 'primitive', type: 'int' });
    expect(specializedMethod.returnType).toEqual({ kind: 'primitive', type: 'int' });

    // Find the call expression in the second variable declaration
    const varDecls = program.body.filter(stmt => stmt.kind === 'variable');
    expect(varDecls.length).toBe(2);
    const resultVar = varDecls[1];
    if (resultVar.kind !== 'variable' || resultVar.initializer?.kind !== 'call') {
      throw new Error('expected variable declaration with call initializer');
    }
    const call = resultVar.initializer;
    expect(call.callee.kind).toBe('member');
    if (call.callee.kind === 'member' && call.callee.property.kind === 'identifier') {
      expect(call.callee.property.name).toBe('transform__primitive_int');
    }
    expect(call.typeArguments).toBeUndefined();
    expect(call.genericInstantiation).toBeUndefined();
  });

  it('specializes generic static methods and rewrites call sites', () => {
    const code = `
      class Factory {
        static create<T>(value: T): T {
          return value;
        }
      }

      let result = Factory.create<string>("hello");
    `;

    const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);
    expect(result.diagnostics).toHaveLength(0);

    // Find the class declaration
    const classDecl = program.body.find(stmt => stmt.kind === 'class') as ClassDeclaration;
    expect(classDecl).toBeDefined();
    expect(classDecl.name.name).toBe('Factory');

    // The generic method should be replaced with specialized version
    expect(classDecl.methods.length).toBe(1);
    const specializedMethod = classDecl.methods[0];
    expect(specializedMethod.name.name).toBe('create__primitive_string');
    expect(specializedMethod.typeParameters).toBeUndefined();
    expect(specializedMethod.parameters[0].type).toEqual({ kind: 'primitive', type: 'string' });
    expect(specializedMethod.returnType).toEqual({ kind: 'primitive', type: 'string' });

    // Find the call expression
    const varDecl = program.body.find(stmt => stmt.kind === 'variable');
    expect(varDecl).toBeDefined();
    if (varDecl?.kind !== 'variable' || varDecl.initializer?.kind !== 'call') {
      throw new Error('expected variable declaration with call initializer');
    }
    const call = varDecl.initializer;
    expect(call.callee.kind).toBe('member');
    if (call.callee.kind === 'member' && call.callee.property.kind === 'identifier') {
      expect(call.callee.property.name).toBe('create__primitive_string');
    }
    expect(call.typeArguments).toBeUndefined();
    expect(call.genericInstantiation).toBeUndefined();
  });

  it('creates multiple method specializations for different type arguments', () => {
    const code = `
      class Converter {
        convert<T>(value: T): T {
          return value;
        }
      }

      let c = Converter {};
      let intResult = c.convert<int>(42);
      let strResult = c.convert<string>("hello");
    `;

    const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);
    expect(result.diagnostics).toHaveLength(0);

    // Find the class declaration
    const classDecl = program.body.find(stmt => stmt.kind === 'class') as ClassDeclaration;
    expect(classDecl).toBeDefined();

    // Should have two specialized methods
    expect(classDecl.methods.length).toBe(2);
    const methodNames = classDecl.methods.map(m => m.name.name).sort();
    expect(methodNames).toContain('convert__primitive_int');
    expect(methodNames).toContain('convert__primitive_string');

    // All methods should have typeParameters removed
    for (const method of classDecl.methods) {
      expect(method.typeParameters).toBeUndefined();
    }
  });

  it('reports diagnostic when generic method has no instantiations', () => {
    const code = `
      class Unused {
        transform<T>(value: T): T {
          return value;
        }
      }
    `;

    const { program, context } = parseAndValidate(code);
    const result = monomorphizePrograms([{ program, context }]);

    // Should have a diagnostic about no concrete instantiations
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('no concrete instantiations');
  });
});
