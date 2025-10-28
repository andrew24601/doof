import { describe, test, expect } from 'vitest';
import { Lexer, TokenType } from '../src/parser/lexer';

describe('Lexer Token Generation', () => {
  test('tokenizes standalone comment with blank lines', () => {
    const code = `let x = 1;

// standalone comment

let y = 2;`;
    
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    
    console.log('Tokens:');
    tokens.forEach((token, i) => {
      if (token.type !== TokenType.EOF) {
        console.log(`  [${i}] ${token.type}: "${token.value}"`);
      }
    });
  });
});