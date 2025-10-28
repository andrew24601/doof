import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('Debug regex patterns', () => {
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

  it('should debug ServiceA regex issue', () => {
    const code = `
      class CommonData {
        id: int;
        name: string;
      }

      class ServiceA {
        common: CommonData;
        serviceAData: string;
        
        static fromJSON(json: string): ServiceA {
          return ServiceA { common: CommonData { id: 1, name: "test" }, serviceAData: "a" };
        }
      }

      class ServiceB {
        common: CommonData;
        serviceBData: int;
        
        static fromJSON(json: string): ServiceB {
          return ServiceB { common: CommonData { id: 2, name: "test2" }, serviceBData: 42 };
        }
      }

      function main(): void {
        let serviceA = ServiceA.fromJSON("{}");
        let serviceB = ServiceB { common: CommonData { id: 3, name: "test3" }, serviceBData: 100 };
        println(serviceB);
      }
    `;
    const result = transpileCode(code);
  // debug logs removed
  });
});
