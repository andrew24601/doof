import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Extern Class Debug Advanced', () => {
  it('should debug the exact path for extern static methods', () => {
    const source = `
        extern class Foo {
          field: int;
          static create(param: int): Foo;
        }
        
        let foo = Foo.create(42);
      `;
    
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator();
    const context = validator.validate(ast);
    
    console.log('=== ADVANCED DEBUG ===');
    console.log('Symbol Foo.create exists?', context.symbols.has('Foo.create'));
    console.log('Symbol Foo.create:', context.symbols.get('Foo.create'));
    
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    
    console.log('Generated source:');
    console.log(result.source);
    
    expect(context.errors).toEqual([]);
  });
});
