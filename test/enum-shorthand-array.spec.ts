import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Validator } from '../src/validation/validator.js';
import { Program } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: any[]; context: any } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, errors: context.errors, context };
}

describe('Enum shorthand in array literals', () => {
  it('infers enum element type from annotated array variable using shorthand', () => {
    const code = `
      enum Color { RED, GREEN, BLUE }

      const colors: Color[] = [.RED, .GREEN, .BLUE];

      function main(): int {
        return 0;
      }
    `;

    const { errors, program } = parseAndValidate(code);

    // Should have no validation errors
    expect(errors).toHaveLength(0);

    // Verify the variable declaration inferred type is Color[]
    const varDecl = program.body.find((s: any) => s.kind === 'variable' && s.identifier.name === 'colors');
    expect(varDecl).toBeDefined();
    if (varDecl) {
      const v: any = varDecl;
      expect(v.type).toBeDefined();
      expect(v.type.kind).toBe('array');
      expect((v.type as any).elementType.kind).toBe('enum');
      expect((v.type as any).elementType.name).toBe('Color');
    }
  });
});
