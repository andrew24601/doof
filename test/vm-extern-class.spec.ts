import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer';
import { Parser } from '../src/parser/parser';
import { Validator } from '../src/validation/validator';
import { VMGenerator } from '../src/codegen/vmgen';
import { Program } from '../src/types';

type Bytecode = {
  constants: Array<{ type: string; value: unknown }>;
  instructions: Array<{ mnemonic?: string }>;
};

function parseProgram(source: string): Program {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

function compileToBytecode(program: Program) {
  const validator = new Validator();
  const context = validator.validate(program);
  expect(context.errors).toHaveLength(0);

  const generator = new VMGenerator();
  const result = generator.generate(program, 'test', context);
  const bytecode = JSON.parse(result.source) as Bytecode;
  return { bytecode, context };
}

describe('VM extern class integration', () => {
  it('emits extern calls for extern class methods', () => {
    const program = parseProgram(`
      extern class RemoteRunner {
        static shared(): RemoteRunner;
        show(): void;
        createLabel(): RemoteLabel;
      }

      extern class RemoteLabel {
        setText(text: string): void;
      }

      class Foo {
        x: int;
        y: int;
      }

      function main(): void {
        const y: Foo = { x: 10, y: 12 };
        const x = 12;

        const runner = RemoteRunner.shared();
        runner.show();

        println("Hello world!");
        println(y);
        println("How are you? " + y);

        const label = runner.createLabel();
        label.setText("ready");
      }
    `);

    const { bytecode } = compileToBytecode(program);

    const stringConstants = bytecode.constants
      .filter(constant => constant.type === 'string')
      .map(constant => constant.value);

    expect(stringConstants).toContain('RemoteRunner::shared');
    expect(stringConstants).toContain('RemoteRunner::show');
    expect(stringConstants).toContain('RemoteRunner::createLabel');
    expect(stringConstants).toContain('RemoteLabel::setText');

    const externCalls = bytecode.instructions.filter(inst => inst.mnemonic === 'EXTERN_CALL');
    expect(externCalls.length).toBeGreaterThanOrEqual(4);
  });
});
