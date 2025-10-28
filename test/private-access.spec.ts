import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';

describe('Validator Private Access Control', () => {
  function validateCode(code: string) {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    return validator.validate(program);
  }

  it('allows access to public fields from outside class', () => {
    const code = `
      class Test {
        publicField: int = 42;
      }
      let obj = Test { publicField: 100 };
      let value = obj.publicField;
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks access to private fields from outside class', () => {
    const code = `
      class Test {
        private privateField: int = 42;
      }
      let obj = Test {};
      let value = obj.privateField;
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Cannot access private field 'privateField' outside class");
  });

  it('allows access to private fields from within class', () => {
    const code = `
      class Test {
        private privateField: int = 42;
        
        getPrivateValue(): int {
          return this.privateField;
        }
      }
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks access to private methods from outside class', () => {
    const code = `
      class Test {
        private privateMethod(): int {
          return 42;
        }
      }
      let obj = Test {};
      let value = obj.privateMethod();
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Cannot access private method 'privateMethod' outside class");
  });

  it('allows access to private methods from within class', () => {
    const code = `
      class Test {
        private privateMethod(): int {
          return 42;
        }
        publicMethod(): int {
          return this.privateMethod();
        }
      }
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks private field initialization from outside class in object literals', () => {
    const code = `
      class Test {
        private privateField: int = 0;
        publicField: int;
      }
      let obj = Test { privateField: 42, publicField: 100 };
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Cannot access private field 'privateField' outside class");
  });

  it('does not require private fields in object literal construction from outside class', () => {
    const code = `
      class Test {
        private privateField: int = 0;
        publicField: int;
      }
      let obj = Test { publicField: 100 };
    `;
    const result = validateCode(code);
    expect(result.errors).toHaveLength(0);
  });
});
