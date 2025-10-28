
import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler';
import { errorMessages } from './helpers/error-helpers.js';

describe('Quoted Property Names Enhancement', () => {
  it('should allow class fields with quoted property names', () => {
    const src = `class Foo { "bar-baz": int; } function test() { let obj = Foo{ "bar-baz": 42 }; println(obj); }`;
    const result = transpile(src);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toMatch(/bar-baz/);
  });

  it('should allow object literals with quoted property names', () => {
    const src = `class Foo { "bar-baz": int; } function test() { let obj = Foo{ "bar-baz": 42 }; println(obj); }`;
    const result = transpile(src);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toMatch(/bar-baz/);
  });

  it('should allow property access using quoted property names', () => {
    const src = `class Foo { "bar-baz": int; } function test() { let obj = Foo{ "bar-baz": 42 }; let x = obj."bar-baz"; println(obj); }`;
    const result = transpile(src);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toMatch(/bar-baz/);
  });


  it('should support integration (arrays.do sample)', () => {
    const src = [
      'class MyClass {',
      '  "my-names": string[];',
      '  values: int[];',
      '}',
      'function processArray(arr: MyClass) {',
      '  for (let i = 0; i < arr."my-names".length; i++) {',
      '    println(`Name: ${arr."my-names"[i]}, Value: ${arr.values[i]}`);',
      '  }',
      '}',
      'function main(): int {',
      '  let cls: MyClass = {"my-names":["Alice","Bob","Charlie"],"values":[10,20,30]};',
      '  processArray(cls);',
      '  println(cls);',
      '  return 0;',
      '}',
    ].join('\n');
    const result = transpile(src);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toMatch(/my-names/);
  });

  it('should reject computed property names in class fields', () => {
    const src = `let key = "bar-baz"; class Foo { [key]: int; }`;
    const result = transpile(src);
    expect(result.errors).not.toHaveLength(0);
     const messages = errorMessages(result.errors);
     expect(messages[0]).toMatch(/computed property name/);
  });

  it('should reject computed property names in object literals', () => {
    const src = `let key = "bar-baz"; let obj = {[key]: 123};`;
    const result = transpile(src);
    expect(result.errors).not.toHaveLength(0);
     const messages = errorMessages(result.errors);
     expect(messages[0]).toMatch(/computed property name/);
  });

  it('should reject computed property names in property access', () => {
    const src = `class Foo { "bar-baz": int; } let key = "bar-baz"; let obj = Foo{ "bar-baz": 42 }; let x = obj[key];`;
    const result = transpile(src);
    expect(result.errors).not.toHaveLength(0);
     const messages = errorMessages(result.errors);
     expect(messages[0]).toMatch(/computed property name/);
  });
});
