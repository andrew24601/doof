import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Extern Class Debug', () => {
  function parseValidateAndGenerate(source: string) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    // Check for parse errors first
    if (ast.errors && ast.errors.length > 0) {
      return { ast, errors: ast.errors, result: null };
    }
    
    const validator = new Validator();
    const context = validator.validate(ast);
    if (context.errors.length > 0) {
      return { ast, errors: context.errors, result: null };
    }
    const generator = new CppGenerator();
    const result = generator.generate(ast, undefined, context);
    return { ast, errors: context.errors, result };
  }

  it('should debug extern class generation', () => {
    const source = `
        extern class Foo {
          field: int;
          static create(param: int): Foo;
        }
        
        let foo = Foo.create(42);
        let x = foo.field;
      `;
      
    const { result, errors, ast } = parseValidateAndGenerate(source);
    
    console.log('=== Extern Class Debug ===');
    console.log('Errors:', errors);
    
    // Get a fresh validation context to inspect symbols
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const freshAst = parser.parse();
    const validator = new Validator();
    const context = validator.validate(freshAst);
    
    console.log('=== Symbols in validation context ===');
    for (const [key, value] of context.symbols.entries()) {
      console.log(`  ${key}:`, value);
    }
    
    console.log('Header:');
    console.log(result?.header);
    console.log('Source:');
    console.log(result?.source);
    
    console.log('Contains foo = Foo::create(42)?', result?.source?.includes('std::shared_ptr<Foo> foo = Foo::create(42)'));
    console.log('Contains return Foo::create()?', result?.source?.includes('return Foo::create()'));
    
    expect(errors).toEqual([]);
  });
});
