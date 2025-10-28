import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { VMGenerator } from '../src/codegen/vmgen';
import { Validator } from '../src';
import type { Program, ValidationContext } from '../src';

function parseProgram(source: string): { program: Program; context: ValidationContext } {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();

  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(ast);

  return { program: ast, context };
}

function extractOpcodes(bytecodeJson: string): string[] {
  const parsed = JSON.parse(bytecodeJson);
  if (!parsed.instructions || !Array.isArray(parsed.instructions)) {
    return [];
  }
  return parsed.instructions
    .map((instruction: { mnemonic?: string }) => instruction?.mnemonic)
    .filter((mnemonic: string | undefined): mnemonic is string => typeof mnemonic === 'string');
}

describe('VM switch code generation', () => {
  it('uses string equality opcode for string cases', () => {
    const { program, context } = parseProgram(`
      function classify(value: string): string {
        switch (value) {
          case "ok":
            return "good";
          case "error":
            return "bad";
          default:
            return "unknown";
        }
      }
    `);

  const generator = new VMGenerator();
  const result = generator.generate(program, 'test', context);
    const opcodes = extractOpcodes(result.source);

    expect(opcodes).toContain('EQ_STRING');
  });

  it('uses IS_NULL when matching null cases', () => {
  const { program, context } = parseProgram(`
      function describe(input: string | null): string {
        switch (input) {
          case null:
            return "none";
          case "value":
            return "value";
          default:
            return "other";
        }
      }
    `);

  const generator = new VMGenerator();
  const result = generator.generate(program, 'test', context);
    const opcodes = extractOpcodes(result.source);

    expect(opcodes).toContain('IS_NULL');
  });

  it('supports numeric range cases', () => {
  const { program, context } = parseProgram(`
      function bucket(value: int): int {
        switch (value) {
          case 0..5:
            return 1;
          case 6..<10:
            return 2;
          default:
            return 3;
        }
      }
    `);

  const generator = new VMGenerator();
  const result = generator.generate(program, 'test', context);
    const opcodes = extractOpcodes(result.source);

    expect(opcodes).toContain('AND_BOOL');
    expect(opcodes.filter(opcode => opcode === 'LT_INT').length).toBeGreaterThan(0);
  });

  it('allows break inside switch statements', () => {
  const { program, context } = parseProgram(`
      function test(value: int): void {
        switch (value) {
          case 1:
            break;
          default:
            println(value);
        }
      }
    `);

  const generator = new VMGenerator();
  expect(() => generator.generate(program, 'test', context)).not.toThrow();
  });

  it('rejects continue inside switch statements', () => {
  const { program, context } = parseProgram(`
      function test(value: int): void {
        switch (value) {
          case 1:
            continue;
          default:
            println(value);
        }
      }
    `);

  const generator = new VMGenerator();
  expect(() => generator.generate(program, 'test', context)).toThrow(/Continue statement not allowed inside switch/);
  });
});
