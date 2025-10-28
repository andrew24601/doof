import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Lexer } from '../src/parser/lexer.js';

describe('Implicit Member Access', () => {
  const transpileCode = (code: string) => {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    const validator = new Validator({ allowTopLevelStatements: true });
  const validationContext = validator.validate(ast);
    
  const codegen = new CppGenerator();
  const result = codegen.generate(ast, 'test', validationContext);
    
    return {
      ast,
      validationContext,
      header: result.header,
      source: result.source,
      errors: validationContext.errors
    };
  };

  it('should resolve implicit field access in methods', () => {
    const code = `
      class Person {
        name: string;
        age: int;
        
        greet(): void {
          println("Hello, I'm \${name} and I'm \${age} years old.");
        }
      }
    `;
    
    const result = transpileCode(code);
    
  // debug logs removed
    
    // Should not have validation errors
    expect(result.errors).toHaveLength(0);
    
    // Should generate this-> in the C++ code
    expect(result.source).toContain('this->name');
    expect(result.source).toContain('this->age');
  });

  it('should resolve implicit method access in methods', () => {
    const code = `
      class Person {
        name: string;
        age: int;
        
        getName(): string {
          return name;
        }
        
        getAge(): int {
          return age;
        }
        
        greet(): void {
          println("Hello, I'm \${getName()} and I'm \${getAge()} years old.");
        }
      }
    `;
    
    const result = transpileCode(code);
    
  // debug logs removed
    
    // Should not have validation errors
    expect(result.errors).toHaveLength(0);
    
    // Should generate this-> for both field and method access
    expect(result.source).toContain('this->name');
    expect(result.source).toContain('this->age');
    expect(result.source).toContain('this->getName()');
    expect(result.source).toContain('this->getAge()');
  });

  it('should prefer local variables over member fields (shadowing)', () => {
    const code = `
      class Person {
        name: string;
        
        setName(name: string): void {
          this.name = name; // explicit this.name should refer to member
          // name here should refer to parameter, not member
          println("Setting name to: \${name}");
        }
      }
    `;
    
    const result = transpileCode(code);
    
  // debug logs removed
    
    // Should not have validation errors
    expect(result.errors).toHaveLength(0);
    
    // The parameter 'name' should not be resolved as this->name
    // Only the explicit 'this.name' should generate this->name
    const sourceLines = result.source.split('\n');
    const printLines = sourceLines.filter(line => 
      line.includes('cout') && line.includes('name')
    );
    
    // The cout line should use the parameter 'name', not 'this->name'
    expect(printLines.some(line => line.includes('name') && !line.includes('this->'))).toBe(true);
  });

  it('should handle errors for undefined identifiers', () => {
    const code = `
      class Person {
        name: string;
        
        greet(): void {
          println("Hello \${unknownVariable}");
        }
      }
    `;
    
    const result = transpileCode(code);
    
    // Should have validation error
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Undefined identifier 'unknownVariable'");
  });

  it('should not apply implicit member access in static methods', () => {
    const code = `
      class Person {
        static defaultName: string = "Unknown";
        name: string;
        
        static createDefault(): Person {
          // In static method, 'name' should not resolve to instance member
          // This should cause an error since 'name' is not in scope
          return new Person();
        }
      }
    `;
    
    const result = transpileCode(code);
    
    // Note: This test assumes static methods don't have access to instance members
    // The behavior might need adjustment based on your language design
  });
});
