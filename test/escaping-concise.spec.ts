// Test file for concise function type forms after removing explicit escaping tracking

import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { ParseError } from '../src/types.js';
import { FunctionDeclaration, ClassDeclaration, FunctionTypeNode } from '../src/types.js';
import { validateProgramForTests } from './helpers/validation';

describe('Concise Function Type Forms', () => {
  function parseAndValidate(code: string) {
    try {
      const lexer = new Lexer(code, 'test.do');
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens, 'test.do', {});
      const ast = parser.parse();
      
  const context = validateProgramForTests(ast);
      
      return { ast, context, errors: context.errors };
    } catch (error) {
      const emptyProgram = { 
        kind: 'program' as const, 
        body: [], 
        location: { 
          start: { line: 1, column: 1 }, 
          end: { line: 1, column: 1 }, 
          filename: 'test' 
        }
      };
      const errorMessage = error instanceof ParseError ? error.message : (error as Error).message;
      return { ast: emptyProgram, context: null, errors: [{ message: errorMessage, line: 1, column: 1 }] };
    }
  }

  function parseValidateAndGenerate(code: string) {
    const result = parseAndValidate(code);
    if (!result.ast || result.errors.length > 0) {
      return { generated: null, errors: result.errors };
    }
    
  const generator = new CppGenerator();
  const generated = generator.generate(result.ast, 'test', result.context!);
    return { ...result, generated };
  }

  describe('Function Parameters', () => {
    it('parses concise function parameter syntax', () => {
      const code = `
        function registerHandler(callback(event: string)): void {
          // Test concise parameter parsing
        }
      `;

      const { ast, errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
      expect(ast.body).toHaveLength(1);
      
      const func = ast.body[0] as FunctionDeclaration;
      expect(func.kind).toBe('function');
      expect(func.parameters).toHaveLength(1);
      
      const param = func.parameters[0];
      expect(param.name.name).toBe('callback');
      expect(param.isConciseForm).toBe(true);
      
      const funcType = param.type as FunctionTypeNode;
      expect(funcType.kind).toBe('function');
      expect(funcType.isConciseForm).toBe(true);
      expect((funcType as any).isEscaping).toBeUndefined();
    });

    it('generates correct C++ for concise parameters', () => {
      const code = `
        function storeCallback(handler(data: int)): void {
          // Test C++ generation for concise parameters
        }
      `;

      const { generated, errors } = parseValidateAndGenerate(code);
      expect(errors).toHaveLength(0);
      expect(generated?.header).toContain('void storeCallback(std::function<void(int)> handler)');
    });

    it('supports multiple function parameters', () => {
      const code = `
        function setupHandlers(
          onSuccess(result: string),
          onError: (error: string): bool
        ): void {
          // Store both handlers
        }
      `;

      const { ast, errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
      
      const func = ast.body[0] as FunctionDeclaration;
      expect(func.parameters).toHaveLength(2);
      
      const param1 = func.parameters[0];
      const param2 = func.parameters[1];
  expect((param1.type as FunctionTypeNode).isConciseForm).toBe(true);
  expect((param2.type as FunctionTypeNode).isConciseForm).toBeFalsy();
      expect(((param1.type as any).isEscaping)).toBeUndefined();
      expect(((param2.type as any).isEscaping)).toBeUndefined();
    });
  });

  describe('Callable Class Fields', () => {
    it('parses concise callable field syntax', () => {
      const code = `
        class EventEmitter {
          onEvent(data: string);
          onError: (error: string): bool;
        }
      `;

      const { ast, errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
      
      const classDecl = ast.body[0] as ClassDeclaration;
      expect(classDecl.fields).toHaveLength(2);
      
      const field1 = classDecl.fields[0];
      const field2 = classDecl.fields[1];
      
      expect(field1.isConciseCallable).toBe(true);
      expect(field2.isConciseCallable).toBeFalsy();

      const funcType1 = field1.type as FunctionTypeNode;
      const funcType2 = field2.type as FunctionTypeNode;
  expect(funcType1.isConciseForm).toBe(true);
  expect(funcType2.isConciseForm).toBeFalsy();
      expect((funcType1 as any).isEscaping).toBeUndefined();
      expect((funcType2 as any).isEscaping).toBeUndefined();
    });

    it('generates correct C++ for callable fields', () => {
      const code = `
        class AsyncProcessor {
          onComplete(data: string);
          onProgress: (percent: int): bool;
        }
      `;

      const { generated, errors } = parseValidateAndGenerate(code);
      expect(errors).toHaveLength(0);
      expect(generated?.header).toContain('std::function<void(std::string)> onComplete');
      expect(generated?.header).toContain('std::function<bool(int)> onProgress');
    });
  });

  describe('Mixed Syntax Forms', () => {
    it('handles both concise and verbose syntax', () => {
      const code = `
        function setupCallbacks(
          concise(data: string),
          verbose: (error: string): bool
        ): void {
          // Mix of concise and verbose with escaping
        }
      `;

      const { ast, errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
      
      const func = ast.body[0] as FunctionDeclaration;
      expect(func.parameters).toHaveLength(2);
      
      const conciseParam = func.parameters[0];
      const verboseParam = func.parameters[1];
      
      expect(conciseParam.isConciseForm).toBe(true);
      expect(verboseParam.isConciseForm).toBeFalsy();
      expect(((conciseParam.type as any).isEscaping)).toBeUndefined();
      expect(((verboseParam.type as any).isEscaping)).toBeUndefined();
    });

    it('works in complex class hierarchies', () => {
      const code = `
        class BaseHandler {
          onEvent(data: string);
        }
        
        class SpecificHandler {
          onSpecificEvent: (data: string): bool;
          process(item: string) {
            // non-callable member to ensure methods stay separate
          }
        }
      `;

      const { ast, errors } = parseAndValidate(code);
      expect(errors).toHaveLength(0);
      
      const baseClass = ast.body[0] as ClassDeclaration;
      const specificClass = ast.body[2] as ClassDeclaration;
      
      expect(baseClass.fields).toHaveLength(1);
      expect(specificClass.fields).toHaveLength(1);
      expect(specificClass.methods).toHaveLength(1);

      const baseField = baseClass.fields[0];
      const specificField = specificClass.fields[0];
      const specificMethod = specificClass.methods[0];

      expect((baseField.type as FunctionTypeNode).isConciseForm).toBe(true);
      expect((specificField.type as FunctionTypeNode).isConciseForm).toBeFalsy();
      expect((baseField.type as any).isEscaping).toBeUndefined();
      expect((specificField.type as any).isEscaping).toBeUndefined();
      expect(specificMethod.kind).toBe('method');
    });
  });
});
