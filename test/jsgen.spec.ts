import { describe, it, expect } from 'vitest';
import { JsGenerator } from '../src/codegen/jsgen';
import { Transpiler } from '../src/transpiler.js';
import type { Program, Identifier, Literal, BlockStatement, Expression, Statement } from '../src/types';
import { validateProgramForTests } from './helpers/validation';

// Helper to create a dummy source location
function loc(): any {
  return { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } };
}

function ident(name: string): Identifier {
  return { kind: 'identifier', name, location: loc() };
}

function lit(value: any, literalType: 'string' | 'char' | 'number' | 'boolean' | 'null'): Literal {
  const literal: Literal = { kind: 'literal', value, literalType, location: loc() };
  if (literalType === 'number') {
    literal.originalText = String(value);
  }
  return literal;
}

function block(body: Statement[]): BlockStatement {
  return { kind: 'block', body, location: loc() };
}

function printlnCall(argument: Expression): Expression {
  return {
    kind: 'call',
    callee: ident('println'),
    arguments: [argument],
    location: loc()
  };
}

// Helper to normalize whitespace for easier comparison
function normalize(code: string) {
  return code.replace(/\s+/g, ' ').trim();
}

function generateJs(program: Program): string {
  const context = validateProgramForTests(program);
  const gen = new JsGenerator();
  return gen.generate(program, 'test', context).source;
}

describe('JavaScript Code Generation', () => {

  it('should generate simple variable declaration', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'variable',
          isConst: false,
          identifier: ident('x'),
          type: { kind: 'primitive', type: 'int' },
          initializer: lit(42, 'number'),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);
    expect(normalize(js)).toContain('let x = 42');
  });

  it('should generate function declaration', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'function',
          name: ident('add'),
          parameters: [
            { kind: 'parameter', name: ident('a'), type: { kind: 'primitive', type: 'int' }, location: loc() },
            { kind: 'parameter', name: ident('b'), type: { kind: 'primitive', type: 'int' }, location: loc() }
          ],
          returnType: { kind: 'primitive', type: 'int' },
          body: block([
            {
              kind: 'return',
              argument: {
                kind: 'binary',
                operator: '+',
                left: ident('a'),
                right: ident('b'),
                location: loc(),
                inferredType: { kind: 'primitive', type: 'int' }
              },
              location: loc()
            }
          ]),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toContain('function add(a, b)');
    expect(normalize(js)).toMatch(/return.+a.+\+.+b/);
  });

  it('should generate if statement', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'variable',
          isConst: false,
          identifier: ident('x'),
          type: { kind: 'primitive', type: 'int' },
          initializer: lit(1, 'number'),
          location: loc()
        },
        {
          kind: 'if',
          condition: {
            kind: 'binary',
            operator: '>',
            left: ident('x'),
            right: lit(0, 'number'),
            location: loc()
          },
          thenStatement: {
            kind: 'expression',
            expression: printlnCall(lit('positive', 'string')),
            location: loc()
          },
          elseStatement: {
            kind: 'expression',
            expression: printlnCall(lit('non-positive', 'string')),
            location: loc()
          },
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toMatch(/if *\(.*x.*>.*0.*\)/);
    expect(normalize(js)).toMatch(/console\.log\(["']positive["']\)/);
    expect(normalize(js)).toMatch(/else/);
    expect(normalize(js)).toMatch(/console\.log\(["']non-positive["']\)/);
  });

  it('should generate for-of loop with range expressions', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'function',
          name: ident('test'),
          parameters: [],
          returnType: { kind: 'primitive', type: 'void' },
          body: block([
            {
              kind: 'forOf',
              variable: ident('i'),
              iterable: {
                kind: 'range',
                start: lit(0, 'number'),
                end: lit(5, 'number'),
                inclusive: false,
                location: loc()
              },
              body: {
                kind: 'expression',
                expression: printlnCall(ident('i')),
                location: loc()
              },
              isConst: true,
              location: loc()
            }
          ]),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toMatch(/for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*5\s*;\s*i\+\+\s*\)/);
    expect(normalize(js)).toMatch(/console\.log\(i\)/);
  });

  it('should generate for-of loop with inclusive range expressions', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'function',
          name: ident('test'),
          parameters: [],
          returnType: { kind: 'primitive', type: 'void' },
          body: block([
            {
              kind: 'forOf',
              variable: ident('j'),
              iterable: {
                kind: 'range',
                start: lit(1, 'number'),
                end: lit(3, 'number'),
                inclusive: true,
                location: loc()
              },
              body: {
                kind: 'expression',
                expression: printlnCall(ident('j')),
                location: loc()
              },
              isConst: false,
              location: loc()
            }
          ]),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toMatch(/for\s*\(\s*let\s+j\s*=\s*1\s*;\s*j\s*<=\s*3\s*;\s*j\+\+\s*\)/);
  });

  it('should generate for-of loop with array iteration', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'function',
          name: ident('test'),
          parameters: [],
          returnType: { kind: 'primitive', type: 'void' },
          body: block([
            {
              kind: 'variable',
              isConst: true,
              identifier: ident('array'),
              type: { kind: 'array', elementType: { kind: 'primitive', type: 'int' } },
              initializer: {
                kind: 'array',
                elements: [lit(1, 'number'), lit(2, 'number'), lit(3, 'number')],
                location: loc()
              },
              location: loc()
            },
            {
              kind: 'forOf',
              variable: ident('item'),
              iterable: ident('array'),
              body: {
                kind: 'expression',
                expression: printlnCall(ident('item')),
                location: loc()
              },
              isConst: true,
              location: loc()
            }
          ]),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toMatch(/for\s*\(\s*const\s+item\s+of\s+array\s*\)/);
    expect(normalize(js)).toMatch(/console\.log\(item\)/);
  });

  it('should respect isConst property in for-of loops', () => {
    const ast: Program = {
      kind: 'program',
      body: [
        {
          kind: 'function',
          name: ident('test'),
          parameters: [
            {
              kind: 'parameter',
              name: ident('array'),
              type: { kind: 'array', elementType: { kind: 'primitive', type: 'int' } },
              location: loc()
            }
          ],
          returnType: { kind: 'primitive', type: 'void' },
          body: block([
            {
              kind: 'variable',
              isConst: true,
              identifier: ident('array'),
              type: { kind: 'array', elementType: { kind: 'primitive', type: 'int' } },
              initializer: {
                kind: 'array',
                elements: [lit(4, 'number'), lit(5, 'number')],
                location: loc()
              },
              location: loc()
            },
            {
              kind: 'forOf',
              variable: ident('item'),
              iterable: ident('array'),
              body: {
                kind: 'expression',
                expression: printlnCall(ident('item')),
                location: loc()
              },
              isConst: false, // Should generate 'let'
              location: loc()
            }
          ]),
          location: loc()
        }
      ],
      location: loc()
    };
  const js = generateJs(ast);

    expect(normalize(js)).toMatch(/for\s*\(\s*let\s+item\s+of\s+array\s*\)/);
  });

  it('should place reducer callback before initial value for array.reduce', () => {
    const source = `
      function main(): int {
        let arr = [1, 2, 3];
        let doubled = arr.map(=> it * 2);
        let total = doubled.reduce(0, (acc: int, it: int, index: int, array: int[]) => acc + it);
        println(total);
        return total;
      }
    `;

    const transpiler = new Transpiler({ target: 'js', outputHeader: false, outputSource: true });
    const result = transpiler.transpile(source, 'reduce-test.do');

    expect(result.errors).toHaveLength(0);
    const js = result.source ?? '';
    expect(normalize(js)).toContain('let total = doubled.reduce((acc, it, index, array) => (acc + it), 0);');
  });

  // Add more tests for edge cases and complex constructs as needed
});
