import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { validateProgramForTests } from './helpers/validation';
import { CallExpression } from '../src/types.js';

describe('Named Arguments', () => {
  function parseCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return ast;
  }

  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast, { allowErrors: true });
    if (context.errors.length > 0) {
      return { header: '', source: '', errors: context.errors };
    }

    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  describe('Parser', () => {
    it('should parse method calls with named arguments', () => {
      const code = `
        obj.method { arg1: value1, arg2: value2 };
      `;
      
      const ast = parseCode(code);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('expression');
      
      const expr = (stmt as any).expression as CallExpression;
      expect(expr.kind).toBe('call');
      expect(expr.callee.kind).toBe('member');
      expect(expr.arguments).toHaveLength(0);
      expect(expr.namedArguments).toBeDefined();
      expect(expr.namedArguments).toHaveLength(2);
      
      const firstArg = expr.namedArguments![0];
      expect(firstArg.key.kind).toBe('identifier');
      expect((firstArg.key as any).name).toBe('arg1');
      expect(firstArg.value!.kind).toBe('identifier');
      expect((firstArg.value as any).name).toBe('value1');
      
      const secondArg = expr.namedArguments![1];
      expect(secondArg.key.kind).toBe('identifier');
      expect((secondArg.key as any).name).toBe('arg2');
      expect(firstArg.value!.kind).toBe('identifier');
      expect((secondArg.value as any).name).toBe('value2');
    });

    it('should parse method calls with named arguments using shorthand syntax', () => {
      const code = `
        obj.method { arg1, arg2: value2 };
      `;
      
      const ast = parseCode(code);
      const stmt = ast.body[0];
      const expr = (stmt as any).expression as CallExpression;
      
      expect(expr.namedArguments).toHaveLength(2);
      
      const firstArg = expr.namedArguments![0];
      expect(firstArg.shorthand).toBe(true);
      expect((firstArg.key as any).name).toBe('arg1');
      expect((firstArg.value as any).name).toBe('arg1');
      
      const secondArg = expr.namedArguments![1];
      expect(secondArg.shorthand).toBe(false);
      expect((secondArg.key as any).name).toBe('arg2');
      expect((secondArg.value as any).name).toBe('value2');
    });

    it('should parse empty named arguments', () => {
      const code = `
        obj.method { };
      `;
      
      const ast = parseCode(code);
      const stmt = ast.body[0];
      const expr = (stmt as any).expression as CallExpression;
      
      expect(expr.namedArguments).toHaveLength(0);
    });

    it('should still parse regular method calls with parentheses', () => {
      const code = `
        obj.method(arg1, arg2);
      `;
      
      const ast = parseCode(code);
      const stmt = ast.body[0];
      const expr = (stmt as any).expression as CallExpression;
      
      expect(expr.arguments).toHaveLength(2);
      expect(expr.namedArguments).toBeUndefined();
    });

    it('should preserve object literal syntax for constructors', () => {
      const code = `
        let obj = Person { name: "John", age: 30 };
      `;
      
      const ast = parseCode(code);
      const stmt = ast.body[0];
      expect(stmt.kind).toBe('variable');
      
      const init = (stmt as any).initializer;
      expect(init.kind).toBe('object');
      expect(init.className).toBe('Person');
      expect(init.properties).toHaveLength(2);
    });
  });

  describe('Validation and Code Generation', () => {
    it('should validate and generate C++ code for basic named argument method calls', () => {
      const code = `
        class TestClass {
          method(param1: int, param2: string): void {
            println("Method called with parameters");
          }
        }
        
        function test(): void {
          let obj = TestClass {};
          obj.method { param1: 42, param2: "hello" };
        }
      `;
      
      const result = transpileCode(code);
  // debug logs removed
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('obj->method(42, "hello")');
    });

    it('should accept named arguments in any order', () => {
      const code = `
        function testFunc(first: int, second: string): void {}
        
        function test(): void {
          testFunc { second: "hello", first: 42 };
        }
      `;
      
      const result = transpileCode(code);
      // Order constraint relaxed; no error expected
      expect(result.errors.some(err => 
        err.message.includes('Named arguments must be provided in the same order')
      )).toBe(false);
    });

    it('should validate unknown parameter names', () => {
      const code = `
        function testFunc(param1: int, param2: string): void {}
        
        function test(): void {
          testFunc { param1: 42, unknown: "hello" };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.some(err => 
        err.message.includes("Unknown parameter 'unknown'")
      )).toBe(true);
    });

    it('should validate missing required parameters', () => {
      const code = `
        function testFunc(param1: int, param2: string): void {}
        
        function test(): void {
          testFunc { param1: 42 };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.some(err => 
        err.message.includes("Missing required parameter 'param2'")
      )).toBe(true);
    });

    it('should validate duplicate parameter names', () => {
      const code = `
        function testFunc(param1: int, param2: string): void {}
        
        function test(): void {
          testFunc { param1: 42, param1: 43, param2: "hello" };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.some(err => 
        err.message.includes("Parameter 'param1' specified multiple times")
      )).toBe(true);
    });

    it('should support shorthand syntax', () => {
      const code = `
        function testFunc(param1: int, param2: string): void {}
        
        function test(): void {
          let param1 = 42;
          let param2 = "hello";
          testFunc { param1, param2 };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('testFunc(param1, param2)');
    });

    it('should work with mixed shorthand and regular syntax', () => {
      const code = `
        function testFunc(param1: int, param2: string): void {}
        
        function test(): void {
          let param1 = 42;
          testFunc { param1, param2: "hello" };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('testFunc(param1, "hello")');
    });

    it('should generate temporaries for reordered side-effecting arguments', () => {
      const code = `
        class State {
          value: int;
        }
        
        function increment(state: State): int {
          state.value = state.value + 1;
          return state.value;
        }
        
        function testFunc(first: int, second: int): int {
          return first + second;
        }
        
        function test(): int {
          let state = State { value: 0 };
          // Arguments provided in reverse order with side effects
          // second should be evaluated FIRST (lexical order)
          // but passed SECOND (positional order)
          return testFunc { second: increment(state), first: increment(state) };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      // Should generate IIFE with temporaries to preserve evaluation order
      expect(result.source).toContain('[&]()');
      expect(result.source).toContain('_arg0');
      expect(result.source).toContain('_arg1');
    });

    it('should not generate temporaries for literal reordered arguments', () => {
      const code = `
        function testFunc(first: int, second: int): int {
          return first + second;
        }
        
        function test(): int {
          // Arguments reordered but all literals (truly constant)
          return testFunc { second: 2, first: 1 };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      // Should NOT generate IIFE since all args are literals
      expect(result.source).not.toContain('[&]()');
      expect(result.source).toContain('testFunc(1, 2)');
    });

    it('should generate temporaries for identifier arguments (conservative)', () => {
      const code = `
        function testFunc(first: int, second: int): int {
          return first + second;
        }
        
        function test(): int {
          let a = 1;
          let b = 2;
          // Arguments reordered with identifiers - conservative: use temps
          // (identifiers could be mutated by other calls in nested expressions)
          return testFunc { second: b, first: a };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      // Should generate IIFE since identifiers are not considered constant
      expect(result.source).toContain('[&]()');
    });

    it('should generate temporaries only for side-effecting arguments in mixed cases', () => {
      const code = `
        function sideEffect(): int {
          return 42;
        }
        
        function testFunc(first: int, second: int, third: int): int {
          return first + second + third;
        }
        
        function test(): int {
          let x = 10;
          // second is side-effecting, first and third are not
          return testFunc { third: x, second: sideEffect(), first: 5 };
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors.length).toBe(0);
      // Should generate IIFE because of the side-effecting call
      expect(result.source).toContain('[&]()');
    });
  });
});
