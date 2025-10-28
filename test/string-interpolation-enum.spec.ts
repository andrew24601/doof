import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('String Interpolation with Enums', () => {
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

  it('should interpolate enum values in strings', () => {
    const code = `
      enum Color { Red, Green, Blue }
      let color = Color.Red;
      let message = \`Color is \${color}\`;
    `;
    
    const result = transpileCode(code);
    expect(result.source).toContain('doof_runtime::StringBuilder');
    expect(result.source).toContain('->append("Color is ");');
    expect(result.source).toContain('->append(to_string(color));');
    expect(result.source).toContain('->toString()');
  });

  it('should generate to_string function for enums', () => {
    const code = `
      enum Color { Red, Green, Blue }
      let color = Color.Red;
      let message = \`Color is \${color}\`;
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('std::string to_string(Color value)');
    expect(result.header).toContain('case Color::Red: return "Red";');
    expect(result.header).toContain('case Color::Green: return "Green";');
    expect(result.header).toContain('case Color::Blue: return "Blue";');
  });

  it('should handle multiple enum interpolations', () => {
    const code = `
      enum Color { Red, Green, Blue }
      enum Size { Small, Medium, Large }
      
      let color = Color.Red;
      let size = Size.Large;
      let message = \`Item: \${color} \${size}\`;
    `;
    
    const result = transpileCode(code);
    expect(result.source).toContain('->append(to_string(color));');
    expect(result.source).toContain('->append(to_string(size));');
    expect(result.header).toContain('std::string to_string(Color value)');
    expect(result.header).toContain('std::string to_string(Size value)');
  });

  it('should handle enum interpolation with println', () => {
    const code = `
      enum Color { Red, Green, Blue }
      let color = Color.Red;
      println(\`Color is \${color}\`);
    `;
    
    const result = transpileCode(code);
    // Enhanced implementation uses direct << chaining for println with interpolated strings
    expect(result.source).toContain('std::cout << "Color is " << color << std::endl;');
  });

  it('should handle direct enum println', () => {
    const code = `
      enum Status { Active, Inactive }
      let status = Status.Active;
      println(status);
    `;
    
    const result = transpileCode(code);
    // Enhanced implementation uses direct operator<< for enum println
    expect(result.source).toContain('std::cout << status << std::endl;');
  });
});
