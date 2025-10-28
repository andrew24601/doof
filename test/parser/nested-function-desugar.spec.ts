import { describe, it, expect } from 'vitest';
import { Parser } from '../../src/parser/parser';
import { Lexer } from '../../src/parser/lexer';
import { Program } from '../../src/types';

function parseSource(source: string): Program {
  const lexer = new Lexer(source, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do');
  return parser.parse();
}

describe('Parser nested function desugar', () => {
  it('converts nested function declarations into const lambda variables', () => {
    const source = `
function outer(): void {
  let v = 5;
  function nested(a: int): int {
    v += a;
    return a + 12;
  }

  println(nested(1));
  println(nested(2));
  println(nested(3));
}
`;
    const program = parseSource(source);
    // Root should contain one function declaration
    const outer = program.body[0] as any;
    expect(outer.kind).toBe('function');
    // Inside outer body should have a variable declaration for nested
    const innerStmt = outer.body.body.find((s: any) => s.kind === 'variable' && s.identifier.name === 'nested');
    expect(innerStmt).toBeTruthy();
    expect(innerStmt.isConst).toBe(true);
    const lambda = innerStmt.initializer;
    expect(lambda).toBeTruthy();
    expect(lambda.kind).toBe('lambda');
    expect(lambda.parameters[0].name.name).toBe('a');
  });
});
