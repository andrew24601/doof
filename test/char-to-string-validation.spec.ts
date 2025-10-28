import { describe, it, expect } from 'vitest';
import { Validator } from '../src/validation/validator.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Program } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: any[] } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, errors: context.errors };
}

describe('Character to String Validation (Strict Typing)', () => {
  describe('implicit char to string conversion (should be rejected)', () => {
    it('should reject passing char literal to string parameter', () => {
      const code = `
        function processText(text: string): void {
          // process text
        }
        
        processText('c'); // should error - char literal passed to string param
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBeGreaterThan(0);
      expect(typeErrors[0].message).toMatch(/cannot convert.*char.*to.*string/);
    });

    it('should reject char literal in string method calls', () => {
      const code = `
        let text: string = "hello world";
        let parts = text.split('\\n'); // should error - char literal passed to string method
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBeGreaterThan(0);
    });

    it('should reject char variable passed to string parameter', () => {
      const code = `
        function processText(text: string): void {
          // process text
        }
        
        let separator: char = ',';
        processText(separator); // should error - char variable passed to string param
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBeGreaterThan(0);
    });
  });

  describe('explicit char to string conversion (should be accepted)', () => {
    it('should accept string(char) explicit conversion', () => {
      const code = `
        function processText(text: string): void {
          // process text
        }
        
        processText(string('c')); // should work - explicit conversion
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBe(0);
    });

    it('should accept string(char) in method calls', () => {
      const code = `
        let text: string = "hello world";
        let parts = text.split(string('\\n')); // should work - explicit conversion
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBe(0);
    });

    it('should accept string() with char variable', () => {
      const code = `
        function processText(text: string): void {
          // process text
        }
        
        let separator: char = ',';
        processText(string(separator)); // should work - explicit conversion
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') && 
        e.message.includes('char') && 
        e.message.includes('string')
      );
      
      expect(typeErrors.length).toBe(0);
    });
  });

  describe('char() cast validation', () => {
    it('should accept char() with single-character string literal', () => {
      const code = `
        let c: char = char("x"); // should work - single char string
      `;
      
      const { errors } = parseAndValidate(code);
      // Should not have type conversion errors for this valid cast
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') ||
        e.message.includes('char() requires')
      );
      
      expect(typeErrors.length).toBe(0);
    });

    it('should reject char() with multi-character string literal', () => {
      const code = `
        let c: char = char("hello"); // should error - multi-char string
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('char() requires') ||
        e.message.includes('single-character')
      );
      
      expect(typeErrors.length).toBeGreaterThan(0);
    });

    it('should accept char() with numeric codepoint', () => {
      const code = `
        let c: char = char(65); // should work - numeric codepoint
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert') ||
        e.message.includes('char() requires')
      );
      
      expect(typeErrors.length).toBe(0);
    });
  });

  describe('control cases (should continue to work)', () => {
    it('should accept double-quoted string literals in string parameters', () => {
      const code = `
        function processText(text: string): void {
          // process text
        }
        
        processText("hello"); // should work - string literal
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert')
      );
      
      expect(typeErrors.length).toBe(0);
    });

    it('should accept char literals in char parameters', () => {
      const code = `
        function processChar(c: char): void {
          // process character
        }
        
        processChar('x'); // should work - char literal to char param
      `;
      
      const { errors } = parseAndValidate(code);
      const typeErrors = errors.filter(e => 
        e.message.includes('cannot convert')
      );
      
      expect(typeErrors.length).toBe(0);
    });
  });
});