import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { CppGenerator } from '../src/codegen/cppgen.js';

describe('Type Narrowing Debug', () => {
  it('should debug type narrowing context', () => {
    const code = `
class Adult {
  const kind = "Adult";
  getIncomeReport(): string { return "High earner"; }
}

class Child {
  const kind = "Child";
  getFavoriteCandy(): string { return "Gummy bears"; }
}

function testNarrowing(person: Adult | Child): string {
  if (person.kind == "Adult") {
    return person.getIncomeReport();
  } else {
    return person.getFavoriteCandy();
  }
}
    `;
    
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(ast);
    
    console.log('=== Type Narrowing Debug ===');
    console.log('Validation errors:', validationContext.errors);
    console.log('Type narrowing keys:');
    for (const [key, value] of validationContext.codeGenHints.typeNarrowing.entries()) {
      console.log(`  ${key}:`, value);
    }
    
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', validationContext);
    
    console.log('Generated C++:');
    console.log(result.source);
    
    expect(validationContext.errors).toHaveLength(0);
  });
});
