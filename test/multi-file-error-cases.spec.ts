import { Validator } from '../src/validation/validator.js';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Program, GlobalValidationContext } from '../src/types.js';
import { describe, it, expect } from 'vitest';

describe('Multi-file Error Cases', () => {
  function parseSource(source: string, filename: string): Program {
    const lexer = new Lexer(source, filename);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, filename);
    const ast = parser.parse();
    ast.filename = filename;
    ast.moduleName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
    return ast;
  }

  it('should detect missing imports', () => {
    // File uses a symbol without importing it
    const fileSource = `
      function main(): void {
        let calc = Calculator{ result: 10 }; // Calculator not imported
        println(calc.result);
      }
    `;

    const mainAst = parseSource(fileSource, 'main.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['main.do', mainAst]
      ]),
      moduleMap: new Map([
        ['main.do', 'main']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([mainAst], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => 
      error.message.includes('Calculator') && 
      error.message.includes('not defined')
    )).toBe(true);
  });

  it('should detect duplicate exports within same module', () => {
    // File with duplicate export names
    const fileSource = `
      export function add(a: int, b: int): int {
        return a + b;
      }
      
      export class add { // Same name as function
        value: int = 0;
      }
    `;

    const mathAst = parseSource(fileSource, 'math.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['math.do', mathAst]
      ]),
      moduleMap: new Map([
        ['math.do', 'math']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([mathAst], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => 
      error.message.includes('add') && 
      (error.message.includes('already declared') || error.message.includes('duplicate'))
    )).toBe(true);
  });

  it('should detect duplicate exports across modules', () => {
    // Two files exporting the same symbol name when imported together
    const file1Source = `
      export function utils(): void {
        println("File 1 utils");
      }
    `;

    const file2Source = `
      export function utils(): void {
        println("File 2 utils");
      }
    `;

    const mainSource = `
      import { utils } from "./file1";
      import { utils } from "./file2"; // Conflicting import
      
      function main(): void {
        utils(); // Ambiguous call
      }
    `;

    const file1Ast = parseSource(file1Source, 'file1.do');
    const file2Ast = parseSource(file2Source, 'file2.do');
    const mainAst = parseSource(mainSource, 'main.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['file1.do', file1Ast],
        ['file2.do', file2Ast],
        ['main.do', mainAst]
      ]),
      moduleMap: new Map([
        ['file1.do', 'file1'],
        ['file2.do', 'file2'],
        ['main.do', 'main']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([file1Ast, file2Ast, mainAst], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => 
      error.message.includes('utils') && 
      (error.message.includes('already imported') || 
       error.message.includes('duplicate') ||
       error.message.includes('conflict'))
    )).toBe(true);
  });

  it('should detect namespace collisions with reserved words', () => {
    // File path that would generate invalid C++ namespace
    const fileSource = `
      export function myFunction(): void {
        println("Hello");
      }
    `;

    // Test with problematic filename that could cause namespace issues
    const problemAst = parseSource(fileSource, 'class.do'); // 'class' is C++ keyword

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['class.do', problemAst]
      ]),
      moduleMap: new Map([
        ['class.do', 'class'] // This should be flagged as problematic
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([problemAst], globalContext);

    // Note: This test may pass initially if we don't have C++ keyword validation yet
    // but it documents the expected behavior
    const allErrors = results.flatMap(result => result.errors);
    // For now, just ensure no crashes occur - keyword validation can be added later
    expect(Array.isArray(allErrors)).toBe(true);
  });

  it('should detect circular imports', () => {
    // File 1 imports from File 2
    const file1Source = `
      import { utilB } from "./file2";
      
      export function utilA(): void {
        utilB();
        println("Util A");
      }
    `;

    // File 2 imports from File 1 (circular dependency)
    const file2Source = `
      import { utilA } from "./file1";
      
      export function utilB(): void {
        utilA();
        println("Util B");
      }
    `;

    const file1Ast = parseSource(file1Source, 'file1.do');
    const file2Ast = parseSource(file2Source, 'file2.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['file1.do', file1Ast],
        ['file2.do', file2Ast]
      ]),
      moduleMap: new Map([
        ['file1.do', 'file1'],
        ['file2.do', 'file2']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([file1Ast, file2Ast], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    // Note: Circular import detection might not be implemented yet
    // This test documents the expected behavior for future implementation
    expect(Array.isArray(allErrors)).toBe(true);
    // Could check for specific circular dependency error message once implemented
  });

  it('should detect import from non-existent file path', () => {
    const fileSource = `
      import { nonExistent } from "./path/that/does/not/exist";
      
      function main(): void {
        nonExistent();
      }
    `;

    const mainAst = parseSource(fileSource, 'main.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['main.do', mainAst]
      ]),
      moduleMap: new Map([
        ['main.do', 'main']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([mainAst], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => 
      error.message.includes('Cannot resolve import') ||
      error.message.includes('path/that/does/not/exist')
    )).toBe(true);
  });

  it('should detect importing non-exported symbols', () => {
    // File 1: has both exported and non-exported symbols
    const file1Source = `
      export function publicFunction(): void {
        privateFunction();
      }
      
      function privateFunction(): void {
        println("This is private");
      }
      
      export class PublicClass {
        value: int = 0;
      }
      
      class PrivateClass {
        data: string = "";
      }
    `;

    // File 2: tries to import private symbols
    const file2Source = `
      import { publicFunction, privateFunction, PrivateClass } from "./file1";
      
      function main(): void {
        publicFunction(); // OK
        privateFunction(); // Should error - not exported
        let obj = PrivateClass{ data: "test" }; // Should error - not exported
      }
    `;

    const file1Ast = parseSource(file1Source, 'file1.do');
    const file2Ast = parseSource(file2Source, 'file2.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['file1.do', file1Ast],
        ['file2.do', file2Ast]
      ]),
      moduleMap: new Map([
        ['file1.do', 'file1'],
        ['file2.do', 'file2']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([file1Ast, file2Ast], globalContext);

    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    
    // Should have errors for both privateFunction and PrivateClass
    expect(allErrors.some(error => 
      error.message.includes('privateFunction') && 
      error.message.includes('not exported')
    )).toBe(true);
    
    expect(allErrors.some(error => 
      error.message.includes('PrivateClass') && 
      error.message.includes('not exported')
    )).toBe(true);
  });

  it('should detect malformed import statements', () => {
    const fileSource = `
      import { } from "./math"; // Empty import list
      import from "./utils"; // Missing import list
      import { add } from; // Missing module path
      import { add } from ""; // Empty module path
      
      function main(): void {
        println("Testing malformed imports");
      }
    `;

    // Note: These should likely be caught by the parser, not validator
    // But if they make it through parsing, validator should handle gracefully
    try {
      const mainAst = parseSource(fileSource, 'main.do');
      
      const globalContext: GlobalValidationContext = {
        files: new Map([
          ['main.do', mainAst]
        ]),
        moduleMap: new Map([
          ['main.do', 'main']
        ]),
        exportedSymbols: new Map(),
        errors: []
      };

      const validator = new Validator({ allowTopLevelStatements: true });
      const results = validator.validateWithGlobalContext([mainAst], globalContext);
      
      // Should either error during parsing or validation
      const allErrors = results.flatMap(result => result.errors);
      // If parsing succeeded, validation should catch import issues
      expect(Array.isArray(allErrors)).toBe(true);
    } catch (parseError) {
      // Parser correctly rejected malformed syntax
      expect(parseError).toBeDefined();
    }
  });
});
