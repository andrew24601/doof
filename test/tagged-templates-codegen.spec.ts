import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('Tagged Templates Code Generation', () => {
  function generateCode(source: string) {
    const lexer = new Lexer(source);
    const parser = new Parser(lexer.tokenize());
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return {
      ...result,
      ast,
      errors: context.errors
    };
  }

  it('should generate C++ code for simple tagged template', () => {
    const source = `
      function html(quasis: string[], values: string[]): string {
        return "";
      }
      const name = "world";
      const result = html\`Hello \${name}!\`;
    `;
    const result = generateCode(source);
    
    expect(result.header).toContain('#include <vector>');
    expect(result.source).toContain('html(std::vector<std::string>{"Hello ", "!"}, std::vector<std::string>{name})');
  });

  it('should generate C++ code for tagged template with multiple interpolations', () => {
    const source = `
      function format(quasis: string[], values: string[]): string {
        return "";
      }
      const name = "Alice";
      const age = 30;
      const result = format\`Name: \${name}, Age: \${age}\`;
    `;
    const result = generateCode(source);
    
    expect(result.source).toContain('format(std::vector<std::string>{"Name: ", ", Age: ", ""}, std::vector<std::string>{name, age})');
  });

  it('should generate C++ code for tagged template with only interpolation', () => {
    const source = `
      function tag(quasis: string[], values: string[]): string { return ""; }
      const value = "test";
      const result = tag\`\${value}\`;
    `;
    const result = generateCode(source);
    
  // debug logs removed
    expect(result.errors.length).toBe(0);
    expect(result.source).toContain('result =');
  });

  it('should generate C++ code for tagged template with no interpolation', () => {
    const source = `
      function html(quasis: string[], values: string[]): string {
        return "";
      }
      const result = html\`<div>Static content</div>\`;
    `;
    const result = generateCode(source);
    
    expect(result.source).toContain('html(std::vector<std::string>{"<div>Static content</div>"}, std::vector<std::string>{})');
  });

  it('should generate C++ code for tagged template with complex expressions', () => {
    const source = `
      function formatter(quasis: string[], values: string[]): string {
        return "";
      }
      const x = 5;
      const y = 10;
      const result = formatter\`Sum: \${x + y}, Product: \${x * y}\`;
    `;
    const result = generateCode(source);
    
    expect(result.source).toContain('formatter(std::vector<std::string>{"Sum: ", ", Product: ", ""}, std::vector<std::string>{(x + y), (x * y)})');
  });

  it('should generate C++ code for tagged template with consecutive interpolations', () => {
    const source = `
      function join(quasis: string[], values: string[]): string {
        return "";
      }
      const first = "hello";
      const second = "world";
      const result = join\`\${first}\${second}\`;
    `;
    const result = generateCode(source);
    
    expect(result.source).toContain('join(std::vector<std::string>{"", "", ""}, std::vector<std::string>{first, second})');
  });

  it('should work with tagged double-quoted strings', () => {
    const source = `
      function sql(quasis: string[], values: string[]): string {
        return "";
      }
      const table = "users";
      const result = sql"SELECT * FROM \${table}";
    `;
    const result = generateCode(source);
    
    expect(result.source).toContain('sql(std::vector<std::string>{"SELECT * FROM ", ""}, std::vector<std::string>{table})');
  });
});
