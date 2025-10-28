import { describe, test, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Lexer } from '../src/parser/lexer.js';
import { TrailingLambdaExpression } from '../src/types.js';
import { Validator } from '../src/validation/validator.js';

describe('Trailing Lambda/Block Syntax', () => {
  const parseCode = (code: string) => {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return ast;
  };

  const generateCpp = (code: string) => {
    const ast = parseCode(code);
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    const generator = new CppGenerator();
    return generator.generate(ast, 'test', context);
  };

  describe('Parser', () => {
    test('should parse trailing lambda with parentheses and expression body', () => {
      const code = 'numbers.forEach(print) => println("done");';
      const ast = parseCode(code);

      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');

      const expr = (stmt as any).expression;
      expect(expr.kind).toBe('trailingLambda');

      const trailingLambda = expr as TrailingLambdaExpression;
      expect(trailingLambda.callee.kind).toBe('member');
      expect(trailingLambda.arguments).toHaveLength(1);
      expect(trailingLambda.lambda.isBlock).toBe(false);
      expect(trailingLambda.lambda.body.kind).toBe('call');
    });

    test('should parse trailing lambda without parentheses', () => {
      const code = 'numbers.forEach => println(it);';
      const ast = parseCode(code);

      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');

      const expr = (stmt as any).expression;
      expect(expr.kind).toBe('trailingLambda');

      const trailingLambda = expr as TrailingLambdaExpression;
      expect(trailingLambda.callee.kind).toBe('member');
      expect(trailingLambda.arguments).toHaveLength(0); // No parentheses means no arguments
      expect(trailingLambda.lambda.isBlock).toBe(false);
    });

    test('should parse trailing lambda with block body', () => {
      const code = `numbers.map(transform) => {
        println("Processing");
        return result;
      };`;
      const ast = parseCode(code);

      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');

      const expr = (stmt as any).expression;
      expect(expr.kind).toBe('trailingLambda');

      const trailingLambda = expr as TrailingLambdaExpression;
      expect(trailingLambda.lambda.isBlock).toBe(true);
      expect(trailingLambda.lambda.body.kind).toBe('block');
    });

    test('should not parse trailing lambda after non-call expressions', () => {
      // This should be parsed as a variable declaration with a lambda initializer
      const code = 'let x = (someVar: int) => y;';
      const ast = parseCode(code);

      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('variable');

      const varDecl = stmt as any;
      expect(varDecl.initializer.kind).toBe('lambda'); // Should be a regular lambda
    });
  });

  describe('Code Generation', () => {
    test('should generate C++ for trailing lambda with expression body', () => {
      const code = `
        function test() {
          let numbers: string[] = ["a", "b"];
          numbers.forEach => println("done");
        }`;
      const result = generateCpp(code);

      expect(result.source).toContain('forEach');
      expect(result.source).toContain('done');
    });

    test('should generate C++ for trailing lambda without parentheses', () => {
      const code = `
        function test() {
          let numbers: string[] = ["a", "b"];
          numbers.forEach => { 
            println("processing"); 
          };
        }`;
      const result = generateCpp(code);

      // The generated code should call forEach with a lambda
      expect(result.source).toContain('forEach');
      expect(result.source).toContain('processing');
    });

    test('should generate C++ for trailing lambda with block body', () => {
      const code = `
        function test() {
          let numbers: string[] = ["a", "b"];
          numbers.forEach => {
            println("Processing");
            let result: string = "done";
          };
        }`;
      const result = generateCpp(code);

      expect(result.source).toContain('forEach');
      expect(result.source).toContain('Processing');
      expect(result.source).toContain('result');
    });
  });

  describe('Error Cases', () => {
    test('should handle syntax errors gracefully', () => {
      // Test that missing lambda body generates parse errors (expected behavior)
      const result = parseCode('numbers.forEach() =>;');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);

      // Test that standalone expression => lambda parses as a regular lambda, not trailing lambda
      const ast = parseCode('(someProperty: int) => lambda;');
      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');
      const expr = (stmt as any).expression;
      expect(expr.kind).toBe('lambda'); // Should be regular lambda, not trailing lambda
    });

    test('should reject trailing lambda on function that does not expect lambda parameter', async () => {
      // println only expects one string parameter, so trailing lambda should be invalid
      const code = 'println("hello") => println("world");';
      const ast = parseCode(code);

      // Parse should succeed, but validation should fail
      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');

      const expr = (stmt as any).expression;
      expect(expr.kind).toBe('trailingLambda');

      // Now validate it - should produce validation errors
      const { Validator } = await import('../src/validation/validator.js');
      const validator = new Validator();
      const context = validator.validate(ast);

      // Should have validation errors about trailing lambda not being allowed
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors.some(e => e.message.includes('does not accept a trailing lambda'))).toBe(true);
    });
  });
});
