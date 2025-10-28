import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { ArrayTypeNode, PrimitiveTypeNode } from '../src/types.js';

describe('Multi-Dimensional Arrays', () => {
  function parseAndValidate(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const validator = new Validator();
    const context = validator.validate(program);
    return { program, errors: context.errors, context };
  }

  function generateCpp(code: string) {
  const { program, errors, context } = parseAndValidate(code);
    if (errors.length > 0) {
      // debug logs removed
      return '';
    }
  const generator = new CppGenerator();
  const result = generator.generate(program, 'test', context);
    // Return both header and source as a combined string for easier testing
    return result.header + '\n' + result.source;
  }

  describe('Parser', () => {
    it('should parse 2D dynamic array type T[][]', () => {
      const code = 'function test(): void { let matrix: int[][]; }';
      const { program, errors } = parseAndValidate(code);
      
      expect(errors).toHaveLength(0);
      const funcDecl = program.body[0] as any;
      const varDecl = funcDecl.body.body[0] as any;
      expect(varDecl.type.kind).toBe('array');
      
      const innerType = (varDecl.type as ArrayTypeNode).elementType as ArrayTypeNode;
      expect(innerType.kind).toBe('array');
      expect((innerType.elementType as PrimitiveTypeNode).type).toBe('int');
    });

    it('should parse 3D arrays T[][][]', () => {
      const code = 'function test(): void { let cube: bool[][][]; }';
      const { program, errors } = parseAndValidate(code);
      
      expect(errors).toHaveLength(0);
      const funcDecl = program.body[0] as any;
      const varDecl = funcDecl.body.body[0] as any;
      expect(varDecl.type.kind).toBe('array');
      
      const secondLevel = (varDecl.type as ArrayTypeNode).elementType as ArrayTypeNode;
      expect(secondLevel.kind).toBe('array');
      
      const thirdLevel = secondLevel.elementType as ArrayTypeNode;
      expect(thirdLevel.kind).toBe('array');
      expect((thirdLevel.elementType as PrimitiveTypeNode).type).toBe('bool');
    });
  });

  describe('Code Generation', () => {
    it('should generate correct C++ type for 2D dynamic array', () => {
      const code = 'let matrix: int[][] = [];';
      const cpp = generateCpp(code);
      
      expect(cpp).toContain('std::shared_ptr<std::vector<std::shared_ptr<std::vector<int>>>>');
    });

    it('should generate correct C++ type for 3D dynamic array', () => {
      const code = 'let cube: string[][][] = [];';
      const cpp = generateCpp(code);
      
      expect(cpp).toContain('std::shared_ptr<std::vector<std::shared_ptr<std::vector<std::shared_ptr<std::vector<std::string>>>>>');
    });
  });
});
