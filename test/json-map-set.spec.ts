import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

function transpile(code: string) {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const ctx = validator.validate(ast);
  const gen = new CppGenerator();
  const result = gen.generate(ast, 'test', ctx);
  return { ...result, errors: ctx.errors };
}

describe('JSON Map/Set support', () => {
  it('serializes Map<string, V> fields as JSON objects', () => {
    const code = `
      class Bag {
        tags: Map<string, string>;
      }
      function main() {
        let b = Bag { tags: Map<string, string>() };
        println(b);
      }
    `;
    const r = transpile(code);
    expect(r.errors).toHaveLength(0);
    // Expect object formatting path
    expect(r.source).toMatch(/for \(const auto& kv : tags\)/);
    expect(r.source).toMatch(/os << doof_runtime::json_encode\(kv.first\) << ":"/);
    expect(r.source).toMatch(/os << doof_runtime::json_encode\(kv.second\)/);
  });

  it('deserializes Map<string, V> from JSON objects', () => {
    const code = `
      class Cfg { values: Map<string, int>; }
      function main() { let _ = Cfg.fromJSON("{}" ); }
    `;
    const r = transpile(code);
    // Force generation
    expect(r.header).toContain('class Cfg');
    // _fromJSON should iterate object and use as_int
    expect(r.source).toMatch(/const auto& values_obj = doof_runtime::json::get_object\(json_obj, "values"\)/);
    expect(r.source).toMatch(/values\[kv.first\] = kv.second.as_int\(\);/);
  });

  it('serializes Set<T> fields as JSON arrays', () => {
    const code = `
      class S { items: Set<int>; }
      function main() { let s = S { items: Set<int>() }; println(s); }
    `;
    const r = transpile(code);
    expect(r.errors).toHaveLength(0);
    expect(r.source).toMatch(/for \(const auto& element : items\)/);
  });
});
