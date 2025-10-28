import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { Validator } from '../src';
import { VMGenerator } from '../src/codegen/vmgen';

function compileToBytecode(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();

  const validator = new Validator({ allowTopLevelStatements: true });
  const validationContext = validator.validate(program);

  const generator = new VMGenerator();
  const result = generator.generate(program, 'test', validationContext);
  return JSON.parse(result.source);
}

function getFunctionInstructionMnemonics(bytecode: any, functionName: string): string[] {
  const fnInfo = bytecode.debug?.functions?.find((fn: any) => fn.name === functionName);
  expect(fnInfo).toBeDefined();
  const start = fnInfo.startInstruction ?? 0;
  const end = fnInfo.endInstruction ?? start;
  return bytecode.instructions
    .slice(start, end + 1)
    .map((instruction: any) => instruction.mnemonic);
}

describe('VM for-of iterators', () => {
  it('uses iterator opcodes for array iteration', () => {
    const bytecode = compileToBytecode(`
      function iterateArray(arr: int[]): int {
        let sum = 0;
        for (const value of arr) {
          sum += value;
        }
        return sum;
      }
    `);

    const mnemonics = getFunctionInstructionMnemonics(bytecode, 'iterateArray');
    expect(mnemonics).toContain('ITER_INIT');
    expect(mnemonics).toContain('ITER_NEXT');
    expect(mnemonics).toContain('ITER_VALUE');
  });

  it('uses iterator opcodes for set iteration', () => {
    const bytecode = compileToBytecode(`
      function iterateSet(items: Set<int>): int {
        let total = 0;
        for (const value of items) {
          total += value;
        }
        return total;
      }
    `);

    const mnemonics = getFunctionInstructionMnemonics(bytecode, 'iterateSet');
    expect(mnemonics).toContain('ITER_INIT');
    expect(mnemonics).toContain('ITER_NEXT');
    expect(mnemonics).toContain('ITER_VALUE');
  });
});
