import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Extern Class Bridging', () => {
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
    const result = generator.generate(ast, 'output', context);
    return { ast, errors: context.errors, result };
  }

  describe('Parser', () => {
    it('should parse extern class declaration', () => {
      const source = `
        extern class Foo {
          field: int;
          doTheThing(param: string): void;
          static create(param: int): Foo;
        }
      `;
      
      const { ast, errors } = parseValidateAndGenerate(source);
      
      expect(errors).toHaveLength(0);
      expect(ast.body).toHaveLength(1);
      expect(ast.body[0].kind).toBe('externClass');
      
      const externClass = ast.body[0] as any;
      expect(externClass.name.name).toBe('Foo');
      expect(externClass.fields).toHaveLength(1);
      expect(externClass.methods).toHaveLength(2);
    });
  });

  describe('Validator', () => {
    it('should validate extern class usage via static methods', () => {
      const source = `
        extern class Foo {
          field: int;
          doTheThing(param: string): void;
          static create(param: int): Foo;
        }

        function main(): int {
          let foo = Foo.create(42);
          foo.doTheThing("hello");
          let x = foo.field;
          return 0;
        }
      `;
      
      const { errors } = parseValidateAndGenerate(source);
    // debug logs removed
      expect(errors).toHaveLength(0);
    });

    it('should prevent extern class construction', () => {
      const source = `
        extern class Foo {
          field: int;
          static create(param: int): Foo;
        }
        
        let foo = Foo{field: 42};
      `;
      
      const { errors } = parseValidateAndGenerate(source);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Cannot construct extern class');
    });

    it('should prevent extern class methods from having bodies', () => {
      const source = `
        extern class Foo {
          doTheThing(): void {
            // This should cause an error
          }
        }
      `;
      
      const { ast, errors } = parseValidateAndGenerate(source);
      
      // Check if there are parse errors first
      if (ast.errors && ast.errors.length > 0) {
        const hasExpectedError = ast.errors.some(error => 
          error.message.includes("Expected ';' after extern method declaration")
        );
        expect(hasExpectedError).toBe(true);
      } else {
        // If no parse errors, check validation errors
        const hasExpectedError = errors.some(error => 
          error.message.includes("Expected ';' after extern method declaration")
        );
        expect(hasExpectedError).toBe(true);
      }
    });
  });

  describe('Code Generation', () => {
    it('should generate header include for extern class', () => {
      const source = `
        extern class Foo {
          field: int;
          static create(param: int): Foo;
        }
        
        let foo = Foo.create(42);
        let x = foo.field;
      `;
      
      const { result } = parseValidateAndGenerate(source);
      
      expect(result).not.toBeNull();
      expect(result!.header).toContain('#include "Foo.h"');
      expect(result!.source).toContain('std::shared_ptr<Foo> foo = Foo::create(42)');
      expect(result!.source).toContain('int x = foo->field');
    });

    it('should generate correct C++ types for extern classes', () => {
      const source = `
        extern class Foo {
          static create(): Foo;
        }
        
        function test(): Foo {
          return Foo.create();
        }
      `;
      
      const { result } = parseValidateAndGenerate(source);
      
      expect(result).not.toBeNull();
      expect(result!.header).toContain('std::shared_ptr<Foo> test()');
      expect(result!.source).toContain('return Foo::create()');
    });

    it('should generate custom header include with from { cpp: "..." } syntax', () => {
      const source = `
        extern class Vec3 from { cpp: "math_types.h" } {
          x: float;
          y: float;
          z: float;
          static create(x: float, y: float, z: float): Vec3;
        }
        
        let v = Vec3.create(1.0, 2.0, 3.0);
      `;
      
      const { result, errors } = parseValidateAndGenerate(source);
      
      expect(errors).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.header).toContain('#include "math_types.h"');
      expect(result!.header).not.toContain('#include "Vec3.h"');
    });

    it('should generate default header when no from clause', () => {
      const source = `
        extern class MyClass {
          static create(): MyClass;
        }
        
        let obj = MyClass.create();
      `;
      
      const { result, errors } = parseValidateAndGenerate(source);
      
      expect(errors).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.header).toContain('#include "MyClass.h"');
    });

    it('should parse from clause with both cpp and js targets', () => {
      const source = `
        extern class AudioEngine from { cpp: "audio/engine.h", js: "./audio-module" } {
          static init(): AudioEngine;
        }
        
        let engine = AudioEngine.init();
      `;
      
      const { ast, errors } = parseValidateAndGenerate(source);
      
      expect(errors).toHaveLength(0);
      const externDecl = ast.body[0] as any;
      expect(externDecl.header).toBe('audio/engine.h');
      expect(externDecl.jsModule).toBe('./audio-module');
    });

    it('should support simple string syntax from "header.h" for C++', () => {
      const source = `
        extern class Mat4 from "metal_bridge.h" {
          static identity(): Mat4;
          multiply(other: Mat4): Mat4;
        }
        
        let m = Mat4.identity();
      `;
      
      const { ast, result, errors } = parseValidateAndGenerate(source);
      
      expect(errors).toHaveLength(0);
      const externDecl = ast.body[0] as any;
      expect(externDecl.header).toBe('metal_bridge.h');
      expect(externDecl.jsModule).toBe('metal_bridge.h');
      expect(result).not.toBeNull();
      expect(result!.header).toContain('#include "metal_bridge.h"');
    });
  });
});
