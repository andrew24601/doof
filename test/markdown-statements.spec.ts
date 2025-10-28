import { describe, expect, it } from 'vitest';
import { Lexer, TokenType } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { Validator } from '../src/validation/validator';
import { CppGenerator } from '../src/codegen/cppgen';
import {
  BinaryExpression,
  BlockStatement,
  ExpressionStatement,
  FunctionDeclaration,
  IfStatement,
  MarkdownTable
} from '../src/types';

function createParser(code: string): Parser {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  return new Parser(tokens, 'test.do');
}

describe('Markdown statements', () => {
  it('lexes markdown headers and table rows with indentation', () => {
    const source = `  # Heading\n    | A | B |\nvalue | other`;
    const lexer = new Lexer(source, 'lex.do');
    const tokens = lexer.tokenize();

    const markdownTokens = tokens.filter(token => token.type === TokenType.MD_HEADER || token.type === TokenType.MD_TABLE_ROW);
    expect(markdownTokens).toHaveLength(2);
    expect(markdownTokens[0]?.type).toBe(TokenType.MD_HEADER);
    expect(markdownTokens[0]?.value).toBe('# Heading');
    expect(markdownTokens[1]?.type).toBe(TokenType.MD_TABLE_ROW);
    expect(markdownTokens[1]?.value).toBe('| A | B |');

    const bitwiseOrTokens = tokens.filter(token => token.type === TokenType.BITWISE_OR);
    expect(bitwiseOrTokens.length).toBeGreaterThan(0);
  });

  it('parses markdown header and table inside function bodies', () => {
    const code = `
function rules(value: int): void {
  # Section
  let result: int = 0;
  |   | =result |
  | --- | --- |
  | value > 0 | value |
  |  | 0 |
  println(result);
}
`;
    const parser = createParser(code);
    const program = parser.parse();
    const fn = program.body.find(stmt => stmt.kind === 'function') as FunctionDeclaration | undefined;
    expect(fn).toBeDefined();
  const statements = fn?.body.body ?? [];
  expect(statements.find(stmt => stmt.kind === 'markdownHeader')).toBeDefined();

    const table = statements.find(stmt => stmt.kind === 'markdownTable') as MarkdownTable | undefined;
    expect(table).toBeDefined();
    const markdownTable = table!;
    expect(parser.errors).toHaveLength(0);

    expect(markdownTable.headers).toEqual(['', '=result']);
  expect(markdownTable.alignments).toEqual(['left', 'left']);
    expect(markdownTable.rows).toEqual([
      ['value > 0', 'value'],
      ['', '0']
    ]);
    expect(markdownTable.columns.map(column => column.kind)).toEqual(['conditionBoolean', 'conclusionDeclaration']);
    expect(markdownTable.structuredRows).toHaveLength(2);
    expect(markdownTable.structuredRows[0]?.cells).toHaveLength(2);
    expect(markdownTable.structuredRows[0]?.cells[0]?.rawText).toBe('value > 0');
  });

  it('desugars markdown tables into if/else chains during validation', () => {
    const code = `
function sample(value: int): int {
  let result: int = 0;
  |  | =result | = |
  | --- | --- | --- |
  | value > 10 | value + 1 | println("gt"); |
  |  | value - 1 | println("le"); |
  return result;
}
`;
    const parser = createParser(code);
    const program = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(program);
    if (context.errors.length > 0) {
      console.log('validation errors', context.errors.map(err => ({ message: err.message, location: err.location })));
    }
    expect(context.errors).toHaveLength(0);

    const fn = program.body.find(stmt => stmt.kind === 'function') as FunctionDeclaration;
    expect(fn).toBeDefined();

    const statements = fn.body.body;
    expect(statements).toHaveLength(3);
    const desugaredBlock = statements[1] as BlockStatement;
    expect(desugaredBlock.kind).toBe('block');
    expect(desugaredBlock.body).toHaveLength(1);

    const rootIf = desugaredBlock.body[0] as IfStatement;
    expect(rootIf.kind).toBe('if');
    expect(rootIf.elseStatement).toBeDefined();

    const thenBlock = rootIf.thenStatement as BlockStatement;
    expect(thenBlock.body).toHaveLength(2);
    const assignmentStmt = thenBlock.body[0] as ExpressionStatement;
    const assignmentExpr = assignmentStmt.expression as BinaryExpression;
    expect(assignmentExpr.operator).toBe('=');

    const elseBranch = rootIf.elseStatement as IfStatement;
    expect(elseBranch.kind).toBe('if');
    const elseThenBlock = elseBranch.thenStatement as BlockStatement;
    expect(elseThenBlock.body.length).toBeGreaterThan(0);
  });

  it('emits markdown header comments in generated C++', () => {
    const code = `
function doc(): void {
  # Notes
  let count: int = 1;
}
`;
    const parser = createParser(code);
    const program = parser.parse();

    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(program);
    expect(validationContext.errors).toHaveLength(0);

    const generator = new CppGenerator();
    const { source } = generator.generate(program, 'test', validationContext);

    expect(source).toContain('// # Notes');
  });

  it('generates C++ if/else chain for markdown tables', () => {
    const code = `
function sample(value: int): int {
  let result: int = 0;
  |  | =result | = |
  | --- | --- | --- |
  | value > 10 | value + 1 | println("gt"); |
  |  | value - 1 | println("le"); |
  return result;
}
`;
    const parser = createParser(code);
    const program = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(program);
    if (validationContext.errors.length > 0) {
      console.log('validation errors', validationContext.errors.map(err => ({ message: err.message, location: err.location })));
    }
    expect(validationContext.errors).toHaveLength(0);

    const generator = new CppGenerator();
    const { source } = generator.generate(program, 'sample', validationContext);
    expect(source).toMatch(/if\s*\(/);
    expect(source).toMatch(/else if\s*\(/);
  });

  it('reports an error when a table row omits boundary pipes', () => {
    const code = `
function broken(value: int): void {
  | label | =value |
  | --- | --- |
  | missing closing | value
}
`;
    const parser = createParser(code);
    parser.parse();
    expect(parser.errors.some(err => err.message.includes('must start and end with a pipe'))).toBe(true);
  });

  it('reports an error when the separator row is missing', () => {
    const code = `
function broken(): void {
  | cond | =value |
  | value > 0 | value |
}
`;
    const parser = createParser(code);
    parser.parse();
    expect(parser.errors.some(err => err.message.includes('separator row whose cells are composed of dashes'))).toBe(true);
  });
});
