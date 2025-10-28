import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('println Function', () => {
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

  it('should generate C++ code for println with string literal', () => {
    const code = `
      println("Hello, world!");
    `;
    
    const result = transpileCode(code);
    expect(result.source).toContain('std::cout << "Hello, world!" << std::endl;');
  });

  it('should generate C++ code for println with variable', () => {
    const code = `
      let message: string = "Hello";
      println(message);
    `;
    
    const result = transpileCode(code);
    expect(result.source).toContain('std::cout << message << std::endl;');
  });

  it('should generate C++ code for println with number', () => {
    const code = `
      let num: int = 42;
      println(num);
    `;
    
    const result = transpileCode(code);
    expect(result.source).toContain('std::cout << num << std::endl;');
  });

  it('should generate C++ code for println with enum', () => {
    const code = `
      enum Color { Red, Green, Blue }
      let color = Color.Red;
      println(color);
    `;
    
    const result = transpileCode(code);
    // Enhanced implementation uses direct operator<< for enums
    expect(result.source).toContain('std::cout << color << std::endl;');
    // Should also generate operator<< overload in header
    expect(result.header).toContain('std::ostream& operator<<(std::ostream& os, Color value)');
  });

  it('should generate C++ code for println with interpolated string', () => {
    const code = `
      let name: string = "Alice";
      println(\`Hello \${name}!\`);
    `;
    
    const result = transpileCode(code);
    // Enhanced implementation uses direct << chaining for println with interpolated strings
    expect(result.source).toContain('std::cout << "Hello " << name << "!" << std::endl;');
  });
});
