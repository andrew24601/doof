import { describe, test, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { Program, BlankStatement, VariableDeclaration } from '../src/types';

describe('Parser Comment and Blank Line Generation', () => {
  function parseCode(code: string): Program {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    // preserveTrivia now defaults to true in Parser constructor
    const parser = new Parser(tokens, 'test.do', {});
    return parser.parse();
  }

  test('parses trailing comments on variable declarations', () => {
    const code = 'let x = 1; // initialize x';
    const program = parseCode(code);
    
    expect(program.body).toHaveLength(1);
    const stmt = program.body[0] as VariableDeclaration;
    expect(stmt.kind).toBe('variable');
    expect(stmt.trailingComment).toBe(' initialize x');
  });

  test('parses standalone comments as blank statements', () => {
    const code = `let x = 1;

// standalone comment

let y = 2;`;
    
    const program = parseCode(code);
    
    expect(program.body).toHaveLength(5);
    expect(program.body[0].kind).toBe('variable'); // let x = 1;
    expect(program.body[1].kind).toBe('blank');    // blank line before comment
    expect(program.body[2].kind).toBe('blank');    // comment statement
    expect(program.body[3].kind).toBe('blank');    // blank line after comment  
    expect(program.body[4].kind).toBe('variable'); // let y = 2;
    
    const commentStmt = program.body[2] as BlankStatement;
    expect(commentStmt.trailingComment).toBe(' standalone comment');
  });

  test('parses multiple consecutive blank lines', () => {
    const code = `let x = 1;



let y = 2;`;
    
    const program = parseCode(code);
    
    expect(program.body).toHaveLength(3);
    expect(program.body[0].kind).toBe('variable'); // let x = 1;
    expect(program.body[1].kind).toBe('blank');    // multiple blank lines collapsed  
    expect(program.body[2].kind).toBe('variable'); // let y = 2;
  });

  test('parses mixed trailing and standalone comments', () => {
    const code = `let x = 1; // trailing comment

// standalone comment
let y = 2;`;
    
    const program = parseCode(code);
    
    expect(program.body).toHaveLength(4);
    
    const stmt1 = program.body[0] as VariableDeclaration;
    expect(stmt1.kind).toBe('variable');
    expect(stmt1.trailingComment).toBe(' trailing comment');
    
    expect(program.body[1].kind).toBe('blank'); // blank line
    
    const commentStmt = program.body[2] as BlankStatement;
    expect(commentStmt.kind).toBe('blank');
    expect(commentStmt.trailingComment).toBe(' standalone comment');
    
    expect(program.body[3].kind).toBe('variable'); // let y = 2;
  });

  test('parses return statement with trailing comment', () => {
    const code = 'return 5; // return value';
    const program = parseCode(code);
    
    expect(program.body).toHaveLength(1);
    const stmt = program.body[0];
    expect(stmt.kind).toBe('return');
    expect(stmt.trailingComment).toBe(' return value');
  });
});