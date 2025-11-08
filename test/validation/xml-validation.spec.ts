import { describe, it, expect } from 'vitest';
import { Lexer } from '../../src/parser/lexer';
import { Parser } from '../../src/parser/parser';
import { Validator } from '../../src/validation/validator';
import { Program, XmlCallExpression, CallExpression, ObjectProperty, Identifier } from '../../src/types';

function parse(src: string): Program {
  const lexer = new Lexer(src, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do');
  return parser.parse();
}

function validate(program: Program) {
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, context };
}

describe('XML Validation', () => {
  it('normalizes children to named argument when parameter exists', () => {
    const prog = parse('function foo(children: string[]) {}\n<foo> one two </foo>;');
    const { program: p, context } = validate(prog);
    const stmt: any = p.body[p.body.length - 1];
    const xml = stmt.expression as XmlCallExpression;
    expect(xml.normalizedCall).toBeTruthy();
    const call = xml.normalizedCall as CallExpression;
    const childrenNamedArg = (call.namedArguments ?? []).find((arg: ObjectProperty) => arg.key.kind === 'identifier' && (arg.key as Identifier).name === 'children');
    expect(childrenNamedArg).toBeTruthy();
  });

  it('errors when children provided but no children param', () => {
      const prog = parse('function foo(a: int) {}\n<foo> child </foo>;');
    const { context } = validate(prog);
    // Call validator will complain about unknown parameter 'children'
    expect(context.errors.some(e => e.message.includes("Unknown parameter 'children'"))).toBe(true);
  });

  it('unbraced shorthand lambda attribute infers implicit parameter', () => {
    const prog = parse('function foo(onClick: (value:int): void) {}\n<foo onClick=> println(value) />;');
    const { program: p, context } = validate(prog);
    expect((p.errors ?? [])).toStrictEqual([]);
    expect(context.errors.length).toBe(0);
    const exprStmt = p.body.find(s => s.kind === 'expression') as any;
    expect(exprStmt).toBeTruthy();
    const xml = exprStmt.expression as XmlCallExpression;
    const attr = xml.attributes.find(a => a.name.name === 'onClick');
    expect(attr).toBeTruthy();
    expect(attr!.value!.kind).toBe('lambda');
  });

  it('relaxed attribute ordering does not error', () => {
      const prog = parse('function foo(a:int, b:string) {}\n<foo b="hi" a=1 />;');
    const { context } = validate(prog);
    expect(context.errors.length).toBe(0);
  });
});
