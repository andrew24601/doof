import { CppGenerator } from '../src/codegen/cppgen.js';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { Program, ValidationContext, GlobalValidationContext } from '../src/types.js';
import { describe, it, expect } from 'vitest';

describe('Multi-file Code Generation', () => {
  function parseAndValidate(source: string, filename: string): { ast: Program; context: ValidationContext } {
    const lexer = new Lexer(source, filename);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, filename);
    const ast = parser.parse();
    ast.filename = filename;
    ast.moduleName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
    
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    
    return { ast, context };
  }

  function setupMultiFileValidation(files: Array<{ source: string; filename: string }>): {
    asts: Program[];
    validationResults: ValidationContext[];
  } {
    const asts: Program[] = [];
    
    // Parse all files
    for (const file of files) {
      const lexer = new Lexer(file.source, file.filename);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens, file.filename);
      const ast = parser.parse();
      ast.filename = file.filename;
      ast.moduleName = file.filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
      asts.push(ast);
    }

    // Set up global validation context
    const globalContext: GlobalValidationContext = {
      files: new Map(),
      moduleMap: new Map(),
      exportedSymbols: new Map(),
      errors: []
    };

    for (const ast of asts) {
      globalContext.files.set(ast.filename!, ast);
      globalContext.moduleMap.set(ast.filename!, ast.moduleName!);
    }

    // Validate with global context
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationResults = validator.validateWithGlobalContext(asts, globalContext);
    
    return { asts, validationResults };
  }

  it('should generate fully-qualified names for imported symbols', () => {
    const { asts, validationResults } = setupMultiFileValidation([
      {
        filename: 'math.do',
        source: `
          export function add(a: int, b: int): int {
            return a + b;
          }
          
          export class Calculator {
            value: int = 0;
          }
        `
      },
      {
        filename: 'main.do',
        source: `
          import { add, Calculator } from "./math";
          
          function main(): void {
            let result = add(5, 3);
            let calc = Calculator{ value: 10 };
          }
        `
      }
    ]);

    const generator = new CppGenerator({
      namespace: 'main',
      includeHeaders: ['<iostream>']
    });

    const mainAst = asts[1];
    const mainValidation = validationResults[1];
    const generated = generator.generate(mainAst, 'main', mainValidation);

    // Check that imported symbols are properly qualified
    expect(generated.source).toContain('math::add(5, 3)');
    expect(generated.source).toContain('math::Calculator');
  });

  it('should include doof_runtime.h when runtime helpers are used', () => {
    const { ast, context } = parseAndValidate(`
      function main(): void {
        println("Hello, World!");
        let result = Math.sqrt(16.0);
      }
    `, 'main.do');

    const generator = new CppGenerator({
      namespace: 'main',
      includeHeaders: ['<iostream>']
    });

    const generated = generator.generate(ast, 'main', context);

    // Should include runtime header because println, Instant, and Math are used
    expect(generated.header).toContain('#include "doof_runtime.h"');
    expect(generated.source).toContain('#include "doof_runtime.h"');
  });
  
  it('should generate proper namespace for user code', () => {
    const { ast, context } = parseAndValidate(`
      function hello(): void {
        println("Hello from namespace!");
      }
      
      class MyClass {
        value: int = 42;
      }
    `, 'example.do');

    const generator = new CppGenerator({
      namespace: 'example_namespace',
      includeHeaders: ['<iostream>']
    });

    const generated = generator.generate(ast, 'example', context);

    // Check namespace generation
    expect(generated.header).toContain('namespace example_namespace {');
    expect(generated.header).toContain('} // namespace example_namespace');
    expect(generated.source).toContain('namespace example_namespace {');
    expect(generated.source).toContain('} // namespace example_namespace');
  });

  it('should handle mixed imports and runtime usage', () => {
    const { asts, validationResults } = setupMultiFileValidation([
      {
        filename: 'utils.do',
        source: `
          export function log(message: string): void {
            println(message);
          }
        `
      },
      {
        filename: 'app.do',
        source: `
          import { log } from "./utils";
          
            function main(): void {
            log("Application started");
            let calculation = Math.pow(2.0, 3.0);
          }
        `
      }
    ]);

    const generator = new CppGenerator({
      namespace: 'app',
      includeHeaders: ['<iostream>']
    });

    const appAst = asts[1];
    const appValidation = validationResults[1];
    const generated = generator.generate(appAst, 'app', appValidation);

    // Should have both import declarations and runtime inclusion
    expect(generated.header).toContain('#include "doof_runtime.h"');
    expect(generated.source).toContain('utils::log(');
  });
});
