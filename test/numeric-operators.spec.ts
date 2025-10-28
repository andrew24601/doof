import { describe, it, expect } from 'vitest';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Validator } from '../src/validation/validator.js';

describe('Numeric Operation Semantics', () => {
  function generateCode(source: string): { header: string; source: string } {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(ast);
    
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', validationContext);
    return {
      header: result.header || '',
      source: result.source || ''
    };
  }

  describe('Division Operators', () => {
    it('should handle integer division with / operator', () => {
      const source = `
        let a: int = 7;
        let b: int = 2;
        let c = a / b;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int c = (a / b)');
    });

    it('should handle integer division with target type', () => {
      const source = `
        let a: int = 7;
        let b: int = 2;
        let c: int = a / b;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int c = (a / b)');
    });

    it('should handle mixed types in division with double target', () => {
      const source = `
        let x: double = 7.5;
        let y: double = 2.1;
        let z: double = x / y;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double z = (x / y)');
    });

    it('should handle mixed types in division with integer target', () => {
      const source = `
        let f: float = 7.5;
        let i: int = 2;
        let result: int = f / i;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int result = static_cast<int>((f / static_cast<float>(i)))');
    });
  });

  describe('Type Promotion and Assignment', () => {
    it('should apply reverse type inference for variable assignment', () => {
      const source = `
        let x: int = 3.7;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int x = static_cast<int>(3.7)');
    });

    it('should apply reverse type inference for division assignment', () => {
      const source = `
        let z: int = 5 / 2;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int z = (5 / 2);');
    });

    it('should handle function parameters with type conversion', () => {
      const source = `
        function takesInt(val: int): void {
          println(val);
        }
        
        function test(): void {
          takesInt(5 / 2);
        }
      `;
      const result = generateCode(source);
      expect(result.source).toContain('takesInt((5 / 2))');
    });

    it('should handle return statements with type conversion', () => {
      const source = `
        function getInt(): int {
          return 7.5 / 2.1;
        }
      `;
      const result = generateCode(source);
      expect(result.source).toContain('return static_cast<int>((7.5 / 2.1))');
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative numbers with division', () => {
      const source = `
        let result: int = -7 / 2;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int result = (-7 / 2);');
    });

    it('should handle complex expressions with mixed operators', () => {
      const source = `
        let result: int = (7 / 2) + (9 / 4);
      `;
      const result = generateCode(source);
      expect(result.source).toContain('int result = ((7 / 2) + (9 / 4));');
    });

    it('should avoid redundant casts for numeric literals', () => {
      const source = `
        let a: double = 1.0;
        let b: double = 2;
        let c: float = 3;
        let d: float = 4.0;
      `;
      const result = generateCode(source);
      expect(result.source).toContain('double a = 1.0;');
      expect(result.source).toContain('double b = 2.0;');
      expect(result.source).toContain('float c = 3.0f;');
      expect(result.source).toContain('float d = 4.0;');
    });
  });
});
