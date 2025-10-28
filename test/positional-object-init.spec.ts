import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { Transpiler } from '../src/transpiler.js';

describe('Positional Object Initialization', () => {
  function parseAndValidate(source: string) {
    const lexer = new Lexer(source, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    return { ast, errors: context.errors };
  }
  
  function transpileCode(source: string) {
    const transpiler = new Transpiler();
    const result = transpiler.transpile(source, 'test.do');
    return result;
  }

  describe('Parser', () => {

    it('should parse class positional initialization', () => {
      const source = `
        class User {
          id: int;
          name: string;
        }
        
        function main(): int {
          let u = User(42, "Alice");
          return 0;
        }
      `;
      
      const { ast, errors } = parseAndValidate(source);
      
      expect(errors).toHaveLength(0);
      const mainFunc = ast.body[2];
      const blockStmt = (mainFunc as any).body;
      const varDecl = blockStmt.body[0];
      expect(varDecl.initializer.kind).toBe('positionalObject');
      expect(varDecl.initializer.className).toBe('User');
      expect(varDecl.initializer.arguments).toHaveLength(2);
    });

    it('should parse class positional initialization without object syntax', () => {
      const source = `
        class Point {
          x: int;
          y: int;
        }
        
        function main(): int {
          let p = Point(10, 20);
          return 0;
        }
      `;
      
      const { ast, errors } = parseAndValidate(source);
      
      expect(errors).toHaveLength(0);
      const mainFunc = ast.body[2];
      const blockStmt = (mainFunc as any).body;
      const varDecl = blockStmt.body[0];
      expect(varDecl.initializer.kind).toBe('positionalObject');
      expect(varDecl.initializer.className).toBe('Point');
      expect(varDecl.initializer.arguments).toHaveLength(2);
    });
  });

  describe('Validator', () => {

    it('should validate class positional initialization by field order', () => {
      const source = `
        class User {
          id: int;
          name: string;
        }
        
        function main(): int {
          let u = User(42, "Alice");
          return 0;
        }
      `;
      
      const { errors } = parseAndValidate(source);
      expect(errors).toHaveLength(0);
    });

    it('should validate class positional initialization without constructor (field order)', () => {
      const source = `
        class Person {
          age: int;
          email: string;
        }
        
        function main(): int {
          let p = Person(25, "alice@example.com");
          return 0;
        }
      `;
      
      const { errors } = parseAndValidate(source);
      expect(errors).toHaveLength(0);
    });

    it('should error on extern class positional initialization', () => {
      const source = `
        extern class ExternalClass {
          field: int;
        }
        
        function main(): int {
          let e = ExternalClass(42);
          return 0;
        }
      `;
      
      const { errors } = parseAndValidate(source);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Cannot construct extern class');
    });

    it('should error on undefined type', () => {
      const source = `
        function main(): int {
          let p = UndefinedType(1, 2);
          return 0;
        }
      `;
      
      const { errors } = parseAndValidate(source);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Undefined identifier');
    });
  });

  describe('Code Generation', () => {
    it('should generate C++ aggregate initialization for classes', () => {
      const source = `
        class User {
          id: int;
          name: string;
        }
        
        function main(): int {
          let u = User(42, "Alice");
          return 0;
        }
      `;
      
      const result = transpileCode(source);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('std::make_shared<User>(42, "Alice")');
    });

    it('should generate C++ make_shared for classes without constructor', () => {
      const source = `
        class Person {
          age: int;
          email = "";
        }
        
        function main(): int {
          let p = Person(25, "alice@example.com");
          return 0;
        }
      `;
      
      const result = transpileCode(source);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('std::make_shared<Person>(25, "alice@example.com")');
    });

    it('should generate C++ aggregate initialization for structs', () => {
      const source = `
        class CustomError {
          code: int = 500;
          message: string;
        }
        
        function main(): int {
          let e = CustomError(404, "Not found");
          return 0;
        }
      `;
      
      const result = transpileCode(source);
      expect(result.errors).toStrictEqual([]);
      expect(result.source).toContain('std::make_shared<CustomError>(404, "Not found")');
    });

  });
});
