import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';

function parseCode(code: string) {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

describe('Parser - Additional Coverage', () => {
  describe('basic parsing coverage', () => {
    it('should handle empty input gracefully', () => {
      const program = parseCode('');
      expect(program.body).toEqual([]);
    });

    it('should parse simple enum correctly', () => {
      const program = parseCode('enum Status { ACTIVE, INACTIVE }');
      expect(program.body).toHaveLength(1);
      expect(program.body[0].kind).toBe('enum');
    });

    it('should parse class with empty body', () => {
      const program = parseCode('class Empty { }');
      expect(program.body).toHaveLength(1);
      const classDecl = program.body[0] as any;
      expect(classDecl.kind).toBe('class');
      expect(classDecl.fields).toHaveLength(0);
      expect(classDecl.methods).toHaveLength(0);
    });

    it('should parse function with no parameters', () => {
      const program = parseCode('function test(): void { }');
      expect(program.body).toHaveLength(1);
      const funcDecl = program.body[0] as any;
      expect(funcDecl.kind).toBe('function');
      expect(funcDecl.parameters).toHaveLength(0);
    });

    it('should parse class with method', () => {
      const program = parseCode(`
        class Test {
          doSomething(x: int, y: string): void { }
        }
      `);
      expect(program.body).toHaveLength(1);
      const classDecl = program.body[0] as any;
      expect(classDecl.methods).toHaveLength(1);
      expect(classDecl.methods[0].parameters).toHaveLength(2);
    });

    it('should parse empty object literal', () => {
      const program = parseCode('let obj = {};');
      expect(program.body).toHaveLength(1);
      const varDecl = program.body[0] as any;
      expect(varDecl.initializer.properties).toHaveLength(0);
    });

    it('should parse empty array literal', () => {
      const program = parseCode('let arr = [];');
      expect(program.body).toHaveLength(1);
      const varDecl = program.body[0] as any;
      expect(varDecl.initializer.elements).toHaveLength(0);
    });

    it('should parse nested member access', () => {
      const program = parseCode('let result = obj.prop.subprop;');
      expect(program.body).toHaveLength(1);
      const varDecl = program.body[0] as any;
      expect(varDecl.initializer.kind).toBe('member');
    });

    it('should parse enum shorthand', () => {
      const program = parseCode('let value = .ACTIVE;');
      expect(program.body).toHaveLength(1);
      const varDecl = program.body[0] as any;
      expect(varDecl.initializer.kind).toBe('enumShorthand');
    });

    it('should parse expression statement', () => {
      const program = parseCode('someFunction();');
      expect(program.body).toHaveLength(1);
      expect(program.body[0].kind).toBe('expression');
    });

    it('should parse binary expressions', () => {
      const operators = ['+', '-', '*', '/', '==', '!=', '<', '>', '<=', '>=', '&&', '||'];
      
      for (const op of operators) {
        const program = parseCode(`let result = a ${op} b;`);
        expect(program.body).toHaveLength(1);
        const varDecl = program.body[0] as any;
        expect(varDecl.initializer.kind).toBe('binary');
        expect(varDecl.initializer.operator).toBe(op);
      }
    });

    it('should parse unary expressions', () => {
      const operators = ['-', '!'];
      
      for (const op of operators) {
        const program = parseCode(`let result = ${op}value;`);
        expect(program.body).toHaveLength(1);
        const varDecl = program.body[0] as any;
        expect(varDecl.initializer.kind).toBe('unary');
        expect(varDecl.initializer.operator).toBe(op);
      }
    });

    it('should parse constructor calls', () => {
      const program = parseCode('let obj = Test{ field1: value1 };');
      expect(program.body).toHaveLength(1);
      const varDecl = program.body[0] as any;
      expect(varDecl.initializer.kind).toBe('object');
    });

    it('should parse return statements', () => {
      const program = parseCode(`
        function test(): int {
          return 42;
        }
      `);
      expect(program.body).toHaveLength(1);
      const funcDecl = program.body[0] as any;
      expect(funcDecl.body).toBeDefined();
      expect(funcDecl.body.body).toHaveLength(1);
      expect(funcDecl.body.body[0].kind).toBe('return');
    });

    it('should parse assignment expressions', () => {
      const program = parseCode('x = 42;');
      expect(program.body).toHaveLength(1);
      const exprStmt = program.body[0] as any;
      expect(exprStmt.expression.kind).toBe('binary');
      expect(exprStmt.expression.operator).toBe('=');
    });
  });
});
