import { Validator } from '../src/validation/validator.js';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Program, GlobalValidationContext } from '../src/types.js';
import { describe, it, expect } from 'vitest';

describe('Multi-file Validation', () => {
  function parseSource(source: string, filename: string): Program {
    const lexer = new Lexer(source, filename);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, filename);
    const ast = parser.parse();
    ast.filename = filename;
    ast.moduleName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
    return ast;
  }

  it('should validate imports and exports across multiple files', () => {
    // File 1: exports a function
    const file1Source = `
      export function add(a: int, b: int): int {
        return a + b;
      }
      
      export class Calculator {
        result: int = 0;
        
        multiply(a: int, b: int): int {
          return a * b;
        }
      }
    `;

    // File 2: imports and uses the function and class
    const file2Source = `
      import { add, Calculator } from "./math";
      
      function main(): void {
        let sum = add(5, 3);
        let calc = Calculator{ result: 10 };
        let product = calc.multiply(2, 4);
        println(sum);
      }
    `;

    const mathAst = parseSource(file1Source, 'math.do');
    const mainAst = parseSource(file2Source, 'main.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['math.do', mathAst],
        ['main.do', mainAst]
      ]),
      moduleMap: new Map([
        ['math.do', 'math'],
        ['main.do', 'main']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator({ allowTopLevelStatements: true });
    const results = validator.validateWithGlobalContext([mathAst, mainAst], globalContext);

    // Check that there are no validation errors
    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors).toEqual([]);
  });

  it('should detect import of non-existent symbol', () => {
    // File 1: exports a function
    const file1Source = `
      export function add(a: int, b: int): int {
        return a + b;
      }
    `;

    // File 2: tries to import non-existent function
    const file2Source = `
      import { subtract } from "./math";
      
      function main(): void {
        let result = subtract(5, 3);
      }
    `;

    const mathAst = parseSource(file1Source, 'math.do');
    const mainAst = parseSource(file2Source, 'main.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['math.do', mathAst],
        ['main.do', mainAst]
      ]),
      moduleMap: new Map([
        ['math.do', 'math'],
        ['main.do', 'main']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator();
    const results = validator.validateWithGlobalContext([mathAst, mainAst], globalContext);

    // Check that there is an import error
    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => error.message.includes('is not exported'))).toBe(true);
  });

  it('should detect import from non-existent module', () => {
    // File 1: tries to import from non-existent module
    const file1Source = `
      import { nonExistent } from "./missing";
      
      function main(): void {
        nonExistent();
      }
    `;

    const mainAst = parseSource(file1Source, 'main.do');

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

    const validator = new Validator();
    const results = validator.validateWithGlobalContext([mainAst], globalContext);

    // Check that there is an import error
    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors.length).toBeGreaterThan(0);
    expect(allErrors.some(error => error.message.includes('Cannot resolve import'))).toBe(true);
  });

  it('should validate class inheritance across modules', () => {
    // File 1: base class
    const baseSource = `
      export class Animal {
        name: string = "";
        
        speak(): void {
          println("Animal speaks");
        }
      }
    `;

    // File 2: derived class (Note: inheritance not yet implemented, but structure test)
    const derivedSource = `
      import { Animal } from "./animal";
      
      export class Dog {
        animal: Animal = Animal{ name: "Buddy" };
        
        bark(): void {
          println("Woof!");
        }
      }
    `;

    const animalAst = parseSource(baseSource, 'animal.do');
    const dogAst = parseSource(derivedSource, 'dog.do');

    const globalContext: GlobalValidationContext = {
      files: new Map([
        ['animal.do', animalAst],
        ['dog.do', dogAst]
      ]),
      moduleMap: new Map([
        ['animal.do', 'animal'],
        ['dog.do', 'dog']
      ]),
      exportedSymbols: new Map(),
      errors: []
    };

    const validator = new Validator();
    const results = validator.validateWithGlobalContext([animalAst, dogAst], globalContext);

    // Should validate successfully
    const allErrors = results.flatMap(result => result.errors);
    expect(allErrors).toEqual([]);
  });
});
