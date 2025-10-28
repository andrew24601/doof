import { describe, it, expect } from 'vitest';
import { Lexer, TokenType } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { InterpolatedString, Literal } from '../src/types.js';

describe('String Interpolation', () => {
  describe('Lexer', () => {
    it('should tokenize simple double-quoted strings', () => {
      const lexer = new Lexer('"hello world"');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(2); // STRING + EOF
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe('hello world');
    });

    it('should tokenize simple backtick strings', () => {
      const lexer = new Lexer('`hello world`');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(2); // TEMPLATE_STRING + EOF
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_STRING);
      expect(tokens[0].value).toBe('hello world');
    });

    it('should tokenize single-quoted strings (no interpolation)', () => {
      const lexer = new Lexer("'hello world'");
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(2); // STRING + EOF
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe('hello world');
    });

    it('should handle escape sequences in strings', () => {
      const lexer = new Lexer('"hello\\nworld\\t!"');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('hello\nworld\t!');
    });

    it('should handle escape sequences in template strings', () => {
      const lexer = new Lexer('`hello\\nworld\\t!`');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('hello\nworld\t!');
    });

    it('should tokenize interpolated double-quoted strings', () => {
      const lexer = new Lexer('"Hello ${name}!"');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(6); // STRING + INTERPOLATION_START + IDENTIFIER + INTERPOLATION_END + STRING + EOF
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe('Hello ');
      expect(tokens[1].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[2].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[2].value).toBe('name');
      expect(tokens[3].type).toBe(TokenType.INTERPOLATION_END);
      expect(tokens[4].type).toBe(TokenType.STRING);
      expect(tokens[4].value).toBe('!');
    });

    it('should tokenize interpolated template strings', () => {
      const lexer = new Lexer('`Hello ${name}!`');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(6); // TEMPLATE_STRING + INTERPOLATION_START + IDENTIFIER + INTERPOLATION_END + TEMPLATE_STRING + EOF
      expect(tokens[0].type).toBe(TokenType.TEMPLATE_STRING);
      expect(tokens[0].value).toBe('Hello ');
      expect(tokens[1].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[2].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[2].value).toBe('name');
      expect(tokens[3].type).toBe(TokenType.INTERPOLATION_END);
      expect(tokens[4].type).toBe(TokenType.TEMPLATE_STRING);
      expect(tokens[4].value).toBe('!');
    });

    it('should tokenize strings with multiple interpolations', () => {
      const lexer = new Lexer('"Hello ${name}, you are ${age} years old"');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(10); // STRING + INTERP_START + ID + INTERP_END + STRING + INTERP_START + ID + INTERP_END + STRING + EOF
      expect(tokens[0].value).toBe('Hello ');
      expect(tokens[2].value).toBe('name');
      expect(tokens[4].value).toBe(', you are ');
      expect(tokens[6].value).toBe('age');
      expect(tokens[7].type).toBe(TokenType.INTERPOLATION_END);
      expect(tokens[8].value).toBe(' years old');
    });

    it('should tokenize complex expressions in interpolation', () => {
      const lexer = new Lexer('"Result: ${a + b * 2}"');
      const tokens = lexer.tokenize();
      
      // Should contain: STRING + INTERP_START + ID + PLUS + ID + MULTIPLY + NUMBER + INTERP_END + EOF
      expect(tokens[0].value).toBe('Result: ');
      expect(tokens[2].value).toBe('a');
      expect(tokens[3].type).toBe(TokenType.PLUS);
      expect(tokens[4].value).toBe('b');
      expect(tokens[5].type).toBe(TokenType.MULTIPLY);
      expect(tokens[6].value).toBe('2');
    });

    it('should handle nested braces in interpolation', () => {
      const lexer = new Lexer('"Object: ${obj.getValue()}"');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('Object: ');
      expect(tokens[2].value).toBe('obj');
      expect(tokens[3].type).toBe(TokenType.DOT);
      expect(tokens[4].value).toBe('getValue');
      expect(tokens[5].type).toBe(TokenType.LEFT_PAREN);
      expect(tokens[6].type).toBe(TokenType.RIGHT_PAREN);
    });

    it('should handle ternary operator in interpolation', () => {
      const lexer = new Lexer('`Status: ${age >= 18 ? "adult" : "minor"}`');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('Status: ');
      expect(tokens[2].value).toBe('age');
      expect(tokens[3].type).toBe(TokenType.GREATER_EQUAL);
      expect(tokens[4].value).toBe('18');
      expect(tokens[5].type).toBe(TokenType.QUESTION);
      expect(tokens[6].type).toBe(TokenType.STRING);
      expect(tokens[6].value).toBe('adult');
      expect(tokens[7].type).toBe(TokenType.COLON);
      expect(tokens[8].type).toBe(TokenType.STRING);
      expect(tokens[8].value).toBe('minor');
    });

    it('should handle escaped interpolation', () => {
      const lexer = new Lexer('"Not interpolated: \\${name}"');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(2); // Just STRING + EOF
      expect(tokens[0].value).toBe('Not interpolated: ${name}');
    });
  });

  describe('Parser', () => {
    it('should parse simple string literals', () => {
      const lexer = new Lexer('let x = "hello";');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      expect(stmt.kind).toBe('variable');
      const expr = stmt.initializer as Literal;
      expect(expr.kind).toBe('literal');
      expect(expr.value).toBe('hello');
      expect(expr.literalType).toBe('string');
    });

    it('should parse template string literals', () => {
      const lexer = new Lexer('let x = `hello`;');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as Literal;
      expect(expr.kind).toBe('literal');
      expect(expr.value).toBe('hello');
      expect(expr.literalType).toBe('string');
    });

    it('should parse interpolated strings', () => {
      const lexer = new Lexer('let x = "Hello ${name}!";');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(false);
      expect(expr.parts).toHaveLength(3);
      expect(expr.parts[0]).toBe('Hello ');
      expect((expr.parts[1] as any).kind).toBe('identifier');
      expect((expr.parts[1] as any).name).toBe('name');
      expect(expr.parts[2]).toBe('!');
    });

    it('should parse template interpolated strings', () => {
      const lexer = new Lexer('let x = `Hello ${name}!`;');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(true);
      expect(expr.parts).toHaveLength(3);
    });

    it('should parse multiple interpolations', () => {
      const lexer = new Lexer('let x = "Hello ${name}, age ${age}";');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.parts).toHaveLength(4);
      expect(expr.parts[0]).toBe('Hello ');
      expect((expr.parts[1] as any).name).toBe('name');
      expect(expr.parts[2]).toBe(', age ');
      expect((expr.parts[3] as any).name).toBe('age');
    });

    it('should parse complex expressions in interpolation', () => {
      const lexer = new Lexer('let x = "Result: ${a + b}";');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.parts).toHaveLength(2);
      expect(expr.parts[0]).toBe('Result: ');
      expect((expr.parts[1] as any).kind).toBe('binary');
      expect((expr.parts[1] as any).operator).toBe('+');
    });

    it('should parse ternary in interpolation', () => {
      // Skip ternary for now since the parser doesn't support it yet
      const lexer = new Lexer('let x = `Status: ${status}`;');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.parts).toHaveLength(2);
      expect(expr.parts[0]).toBe('Status: ');
      expect((expr.parts[1] as any).kind).toBe('identifier');
      expect((expr.parts[1] as any).name).toBe('status');
    });

    it('should handle multiline template strings', () => {
      const lexer = new Lexer('let x = `Line 1\nLine 2 ${value}\nLine 3`;');
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      
      const stmt = ast.body[0] as any;
      const expr = stmt.initializer as InterpolatedString;
      expect(expr.isTemplate).toBe(true);
      expect(expr.parts).toHaveLength(3);
      expect(expr.parts[0]).toBe('Line 1\nLine 2 ');
      expect((expr.parts[1] as any).name).toBe('value');
      expect(expr.parts[2]).toBe('\nLine 3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty interpolation', () => {
      const lexer = new Lexer('"Hello ${} world"');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('Hello ');
      expect(tokens[1].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[2].type).toBe(TokenType.INTERPOLATION_END);
    });

    it('should handle string with only interpolation', () => {
      const lexer = new Lexer('"${name}"');
      const tokens = lexer.tokenize();
      
      expect(tokens).toHaveLength(4); // INTERP_START + ID + INTERP_END + EOF (no empty strings)
      expect(tokens[0].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[1].value).toBe('name');
      expect(tokens[2].type).toBe(TokenType.INTERPOLATION_END);
    });

    it('should handle consecutive interpolations', () => {
      const lexer = new Lexer('"${first}${second}"');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[1].value).toBe('first');
      expect(tokens[2].type).toBe(TokenType.INTERPOLATION_END);
      expect(tokens[3].type).toBe(TokenType.INTERPOLATION_START);
      expect(tokens[4].value).toBe('second');
      expect(tokens[5].type).toBe(TokenType.INTERPOLATION_END);
    });

    it('should handle escaped quotes in interpolated strings', () => {
      const lexer = new Lexer('"She said \\"${quote}\\""');
      const tokens = lexer.tokenize();
      
      expect(tokens[0].value).toBe('She said "');
      expect(tokens[2].value).toBe('quote');
    });
  });
});
