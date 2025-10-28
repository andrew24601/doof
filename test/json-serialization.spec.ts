import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('Automatic JSON Serialization', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  it('should generate _toJSON for a simple class', () => {
    const code = `
      class Person {
        name: string;
        age: int;
      }
      
      function test() {
        let p = Person { name: "John", age: 30 };
        println(p);
      }
    `;
    const result = transpileCode(code);
    expect(result.header).toContain('void _toJSON(std::ostream& os) const;');
    expect(result.source).toContain('void Person::_toJSON(std::ostream& os) const');
    expect(result.source).toContain('os << "\\"name\\":" << doof_runtime::json_encode(name)');
    expect(result.source).toContain('os << "\\"age\\":" << age');
  });

  it('should call _toJSON for contained classes', () => {
    const code = `
      class Address {
        city: string;
      }
      class Person {
        name: string;
        address: Address;
      }
      
      function test() {
        let p = Person { name: "John", address: Address { city: "NYC" } };
        println(p);
      }
    `;
    const result = transpileCode(code);
    expect(result.source).toContain('address->_toJSON(os)');
  });

  it('should handle collections in _toJSON', () => {
    const code = `
      class Person {
        name: string;
      }
      class Group {
        members: Person[];
      }
      
      function test() {
        let g = Group { members: [] };
        println(g);
      }
    `;
    const result = transpileCode(code);
    expect(result.source).toContain('for (size_t i = 0; i < members->size(); ++i)');
    expect(result.source).toContain('const auto& element = (*members)[i];');
    expect(result.source).toContain('element->_toJSON(os);');
  });

  it('should use json_encode for string members', () => {
    const code = `
      class Book {
        title: string;
      }
      
      function test() {
        let b = Book { title: "Test Book" };
        println(b);
      }
    `;
    const result = transpileCode(code);
    expect(result.source).toContain('doof_runtime::json_encode(title)');
  });

  it('should generate valid JSON for primitive members', () => {
    const code = `
      class Point {
        x: float;
        y: float;
      }
      
      function test() {
        let p = Point { x: 1.0, y: 2.0 };
        println(p);
      }
    `;
    const result = transpileCode(code);
    expect(result.source).toContain('os << "\\"x\\":" << x');
    expect(result.source).toContain('os << "\\"y\\":" << y');
  });

  it('should include private fields in JSON serialization', () => {
    const code = `
      class Secret {
        name: string;
        private apiKey: string = "secret123";
        private userId: int = 0;
      }
      
      function test() {
        let s = Secret { name: "Test" };
        println(s);
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toContain('os << "\\"name\\":" << doof_runtime::json_encode(name)');
    expect(result.source).toContain('os << "\\"apiKey\\":" << doof_runtime::json_encode(apiKey)');
    expect(result.source).toContain('os << "\\"userId\\":" << userId');
  });
});
