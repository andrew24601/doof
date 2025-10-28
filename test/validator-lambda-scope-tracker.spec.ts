import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { LambdaExpression, Identifier, BinaryExpression } from '../src/types.js';

function parse(code: string) {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do', {});
  return parser.parse();
}

describe('Validator lambda scope tracker integration', () => {
  it('marks lambda parameters as parameters with scope tracker entries', () => {
    const program = parse(`
      function outer(): void {
        const cb = (value: int) => value + 1;
        cb(42);
      }
    `);

    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(program);

    expect(context.errors).toHaveLength(0);

    const outerFn = program.body[0];
    if (outerFn.kind !== 'function') {
      throw new Error('Expected function declaration');
    }

    const variableStmt = outerFn.body.body.find(stmt => stmt.kind === 'variable');
    if (!variableStmt || variableStmt.kind !== 'variable') {
      throw new Error('Expected variable declaration statement');
    }

    const lambda = variableStmt.initializer as LambdaExpression;
    if (!lambda || lambda.kind !== 'lambda') {
      throw new Error('Expected lambda initializer');
    }

    const lambdaParameter = lambda.parameters[0].name;
    const bodyBinary = lambda.body as BinaryExpression;
    const identifier = bodyBinary.left as Identifier;

    expect(identifier.scopeInfo?.isParameter).toBe(true);
    expect(identifier.scopeInfo?.isLocalVariable).toBe(false);

    const trackerInfo = context.codeGenHints.scopeTracker.get(lambdaParameter.name);
  expect(trackerInfo?.kind).toBe('parameter');
  expect(trackerInfo?.declarationScope?.startsWith('<lambda:')).toBe(true);
  expect(trackerInfo?.isConstant).toBe(true);
  });

  it('marks function parameters and method parameters distinctly', () => {
    const program = parse(`
      function wrap(cb: (msg: string): string): void {
        cb('hi');
      }

      class Greeter {
        greet(message: string): string {
          return message;
        }
      }
    `);

    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(program);

    expect(context.errors).toHaveLength(0);

    const classDecl = validator.context.classes.get('Greeter');
    if (!classDecl) {
      throw new Error('Expected Greeter class in context');
    }

    const method = classDecl.methods[0];
    const methodParam = method.parameters[0].name.name;

    const methodTracker = context.codeGenHints.scopeTracker.get(methodParam);
    expect(methodTracker?.kind).toBe('parameter');
    expect(methodTracker?.declarationScope).toContain('Greeter');

    const wrapFn = validator.context.functions.get('wrap');
    if (!wrapFn) {
      throw new Error('Expected wrap function in context');
    }

    const wrapParam = wrapFn.parameters[0].name.name;
    const wrapTracker = context.codeGenHints.scopeTracker.get(wrapParam);
    expect(wrapTracker?.kind).toBe('parameter');
    expect(wrapTracker?.declarationScope).toContain('wrap');
  });
});
