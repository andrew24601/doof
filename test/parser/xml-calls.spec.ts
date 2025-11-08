import { describe, it, expect } from 'vitest';
import { Lexer } from '../../src/parser/lexer';
import { Parser } from '../../src/parser/parser';
import { validateExpression } from '../../src/validation/expression-validator';
import { Validator } from '../../src/validation/validator';
import { Program, XmlCallExpression, CallExpression, Expression, Identifier } from '../../src/types';

function parseSingleExpr(src: string): Expression {
  const lexer = new Lexer(src, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do');
  const program: Program = parser.parse();
  if (program.errors && program.errors.length) {
    throw new Error('Parse errors: ' + program.errors.map(e => e.message).join(', '));
  }
  // Expect a single expression statement or declaration
  const first = program.body.find(b => b.kind === 'expression') as any;
  if (!first) throw new Error('No expression statement parsed');
  return first.expression as Expression;
}

describe('XML Call Parsing', () => {
  it('parses self-closing with simple attributes', () => {
    const expr = parseSingleExpr('<foo a=1 b="hi" />;');
    expect(expr.kind).toBe('xmlCall');
    const xml = expr as XmlCallExpression;
    expect(xml.attributes.length).toBe(2);
    expect((xml.attributes[0].name.name)).toBe('a');
    expect(xml.selfClosing).toBe(true);
  });

  it('parses attribute expression value (braced full expr)', () => {
    const expr = parseSingleExpr('<foo bar={x+7} />;');
    const xml = expr as XmlCallExpression;
    const barAttr = xml.attributes.find(a => a.name.name === 'bar');
    expect(barAttr).toBeTruthy();
    expect(barAttr!.value!.kind).toBe('binary');
  });

  it('parses lambda attribute (braced short form)', () => {
    const expr = parseSingleExpr('<foo onClick={=>42} />;');
    const xml = expr as XmlCallExpression;
    const attr = xml.attributes.find(a => a.name.name === 'onClick');
    expect(attr).toBeTruthy();
    expect(attr!.value!.kind).toBe('lambda');
  });

  it('parses lambda attribute with implicit it parameter (unbraced shorthand)', () => {
    const expr = parseSingleExpr('<foo onClick=>println(it) />;');
    const xml = expr as XmlCallExpression;
    const attr = xml.attributes.find(a => a.name.name === 'onClick');
    expect(attr).toBeTruthy();
    expect(attr!.value!.kind).toBe('lambda');
    const lambda: any = attr!.value!;
    expect(lambda.isShortForm).toBe(true);
  });

  it('parses nested children with text and expression', () => {
    const expr = parseSingleExpr('<foo a=1> hello <bar/> {x} world </foo>;');
    const xml = expr as XmlCallExpression;
    expect(xml.children).toBeTruthy();
    // Should contain literals, nested xmlCall, identifier expression
    const kinds = xml.children!.map(c => c.kind);
    expect(kinds.includes('literal')).toBe(true);
    expect(kinds.includes('xmlCall')).toBe(true);
  });

  it('reports mismatched closing tag', () => {
    const lexer = new Lexer('<foo></bar>;','test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, 'test.do');
    const program = parser.parse();
    expect((program.errors ?? []).length).toBeGreaterThan(0);
  });
});
