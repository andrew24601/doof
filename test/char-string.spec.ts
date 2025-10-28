import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler';

describe('Char vs String and String Indexing', () => {
  it('should parse and transpile char literals correctly', () => {
    const code = "let c: char = 'a'; let n: char = '\\n'; let q: char = '\\'';";
    const result = transpile(code);
    const cpp = result.source || '';
    expect(cpp).toContain("char c = 'a';");
    expect(cpp).toContain("char n = '\\n';");
    expect(cpp).toContain("char q = '\\'';");
  });

  it('should parse and transpile string literals correctly', () => {
    const code = 'let s: string = "foo\\nbar";';
    const result = transpile(code);
    const cpp = result.source || '';
    expect(cpp).toContain('std::string s = "foo\\nbar";');
  });

  it('should transpile string indexing to char', () => {
    const code = 'let s: string = "abc"; let c: char = s[1];';
    const result = transpile(code);
    const cpp = result.source || '';
    expect(cpp).toContain('char c = s.at(1);');
  });

  it('should error on assigning string to char', () => {
    const code = "let c: char = \"foo\";";
    const result = transpile(code);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should error on assigning char to string', () => {
    const code = "let s: string = 'a';";
    const result = transpile(code);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
