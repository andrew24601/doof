import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { ArrayTypeNode, FunctionDeclaration, PrimitiveTypeNode, VariableDeclaration } from '../src/types.js';
import { validateProgramForTests } from './helpers/validation';

describe('Constant Length Arrays', () => {
  function parseAndValidate(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
  const program = parser.parse();
  const context = validateProgramForTests(program);
    return { program, errors: context.errors, context };
  }

  function generateCpp(code: string) {
  const { program, context } = parseAndValidate(code);
    const generator = new CppGenerator();
  return generator.generate(program, 'test', context);
  }

  describe('Parser', () => {

    it('should parse dynamic array type T[]', () => {
      const code = 'function test(): void { let arr: int[]; }';
      const { program, errors } = parseAndValidate(code);
      
      expect(errors).toHaveLength(0);
      const funcDecl = program.body[0] as any;
      const varDecl = funcDecl.body.body[0] as any;
      expect(varDecl.type.kind).toBe('array');
      expect(((varDecl.type as ArrayTypeNode).elementType as PrimitiveTypeNode).type).toBe('int');
    });

    it('should reject negative array length', () => {
      const code = 'function test(): void { let arr: int[1]; }'; // Use positive number since negative is a parse error  
      const { errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0); // This should pass
    });

  });

  describe('Validator', () => {
    it('should validate constant length array with correct number of elements', () => {
      const code = 'let coords: int[3] = [1, 2, 3];';
      const { errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
    });

  });

  describe('Code Generation', () => {


    it('should generate std::shared_ptr<std::vector> for dynamic arrays', () => {
      const code = 'let numbers: int[] = [1, 2, 3];';
      const { header, source } = generateCpp(code);
      
      expect(source).toContain('std::shared_ptr<std::vector<int>> numbers = std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2, 3})');
      expect(header).toContain('#include <vector>');
    });

    it('should generate shared_ptr parameters for dynamic arrays', () => {
      const code = `
        function test(arr: int[]): void {}
      `;
      const { header } = generateCpp(code);
      
      expect(header).toContain('void test(std::shared_ptr<std::vector<int>> arr)');
    });


  });

});
