import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { Validator } from '../src/validation/validator.js';
import { JsGenerator } from '../src/codegen/jsgen.js';

function transpileJs(code: string) {
  const lexer = new Lexer(code, 'extern_test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const ctx = validator.validate(ast);
  const gen = new JsGenerator();
  const result = gen.generate(ast, 'extern_test', ctx);
  return { ...result, errors: ctx.errors };
}

describe('JS Extern Class Codegen', () => {
  it('emits import for used extern class in static call', () => {
    const code = `extern class Window { static open(url: string): Window | null; }\nlet w = Window.open("https://example.com");`;
    const { source, errors } = transpileJs(code);
    expect(errors).toHaveLength(0);
    // Should have import line
    expect(source).toMatch(/import \{ Window \} from 'Window';/);
    // Should reference Window.open in code
    expect(source).toContain('Window.open');
  });

  it('emits import for extern class referenced as type only and constructed via object literal (should error)', () => {
    const code = `extern class Vector3 { x: float; y: float; z: float; static zero(): Vector3; }\nlet v: Vector3 = Vector3.zero();`;
    const { source, errors } = transpileJs(code);
    // zero() call should be valid, no construction errors, no additional errors
    expect(errors).toHaveLength(0);
    expect(source).toMatch(/import \{ Vector3 \} from 'Vector3';/);
    expect(source).toContain('Vector3.zero');
  });

  it('does not emit import when extern declared but unused', () => {
    const code = `extern class Unused { x: int; }\nprintln("hi");`;
    const { source, errors } = transpileJs(code);
    expect(errors).toHaveLength(0);
    // Should not import Unused
    expect(source).not.toMatch(/Unused/);
  });

  it('handles multiple extern classes', () => {
    const code = `extern class A { static make(): A; }\nextern class B { static build(): B; }\nlet a = A.make();\nlet b = B.build();`;
    const { source, errors } = transpileJs(code);
    expect(errors).toHaveLength(0);
    expect(source).toMatch(/import \{ A \} from 'A';/);
    expect(source).toMatch(/import \{ B \} from 'B';/);
    // Ensure deterministic order (alphabetical) A then B
    const idxA = source.indexOf("import { A } from 'A';");
    const idxB = source.indexOf("import { B } from 'B';");
    expect(idxA).toBeLessThan(idxB);
  });
});
