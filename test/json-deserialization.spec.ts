import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { validateProgramForTests } from './helpers/validation';

describe('Automatic JSON Deserialization', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast);

    // Ensure JSON code generation helpers run for all classes under test
    for (const className of context.classes.keys()) {
      context.codeGenHints.jsonFromTypes.add(className);
      context.codeGenHints.jsonPrintTypes.add(className);
    }

    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  it('should generate fromJSON and _fromJSON for a simple class', () => {
    const code = `
      class Person {
        name: string;
        age: int;
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    
    // Check header declarations
    expect(result.header).toContain('static std::shared_ptr<Person> fromJSON(const std::string& json_str);');
    expect(result.header).toContain('static std::shared_ptr<Person> _fromJSON(const doof_runtime::json::JSONObject& json_obj);');
    
    // Check source implementations
    expect(result.source).toContain('std::shared_ptr<Person> Person::fromJSON(const std::string& json_str)');
    expect(result.source).toContain('std::shared_ptr<Person> Person::_fromJSON(const doof_runtime::json::JSONObject& json_obj)');
    expect(result.source).toContain('doof_runtime::json::get_string(json_obj, "name")');
    expect(result.source).toContain('doof_runtime::json::get_int(json_obj, "age")');
  });

  it('should handle private fields in field-based deserialization', () => {
    const code = `
      class Secret {
        name: string;
        private key: string = "default";
        private count: int = 0;
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    
    // Should deserialize all fields using field-based deserialization
    expect(result.source).toContain('Aggregate deserialization - all fields are deserialized');
    expect(result.source).toContain('doof_runtime::json::get_string(json_obj, "name")');
    expect(result.source).toContain('Optional field: key'); // has default
    expect(result.source).toContain('Optional field: count'); // has default now
  });

  it('should work with round-trip consistency for simple class', () => {
    const code = `
      class Person {
        name: string;
        age: int;
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    
    // Both serialization and deserialization should be present
    expect(result.source).toContain('Person::_toJSON');
    expect(result.source).toContain('Person::fromJSON');
    expect(result.source).toContain('Person::_fromJSON');
    
    // Should have both toJSON and fromJSON for name and age
    expect(result.source).toContain('doof_runtime::json_encode(name)'); // serialization
    expect(result.source).toContain('doof_runtime::json::get_string(json_obj, "name")'); // deserialization
    
    expect(result.source).toContain('os << "\\"age\\":" << age'); // serialization  
    expect(result.source).toContain('doof_runtime::json::get_int(json_obj, "age")'); // deserialization
  });

  it('should work with round-trip consistency for class with defaults', () => {
    const code = `
      class User {
        name: string;
        email: string;
        score: int = 0;
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);
    
    // Serialization should include ALL fields (including score)
    expect(result.source).toContain('os << "\\"name\\":" << doof_runtime::json_encode(name)');
    expect(result.source).toContain('os << "\\"email\\":" << doof_runtime::json_encode(email)');
    expect(result.source).toContain('os << "\\"score\\":" << score');
    
    // Deserialization should include all fields using aggregate initialization
    expect(result.source).toContain('doof_runtime::json::get_string(json_obj, "name")');
    expect(result.source).toContain('doof_runtime::json::get_string(json_obj, "email")');
    expect(result.source).toContain('auto result = std::make_shared<User>()');
    
    // All fields should be deserialized since we use aggregate initialization
    expect(result.source).toContain('doof_runtime::json::get_int(json_obj, "score")');
  });

  it('should invoke constructors during deserialization when present', () => {
    const code = `
      class Record {
        value: int = 0;
        message: string = "ok";

        constructor(value: int, message: string = "ok") {
          this.value = value;
          this.message = message;
        }
      }
    `;
    const result = transpileCode(code);
    expect(result.errors).toHaveLength(0);

    expect(result.header).toContain('static std::shared_ptr<Record> _new(int value, const std::string& message = "ok");');
    expect(result.source).toContain('auto result = Record::_new(value, message);');
    expect(result.source).toContain('doof_runtime::json::get_int(json_obj, "value")');
    expect(result.source).toContain('Optional field: message');
  });
});
