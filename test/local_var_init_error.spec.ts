import { transpileCode } from './util';
import { describe, it, expect } from 'vitest';

describe('Local variable initialization state', () => {
  it('should allow declaration without initialization for later assignment', () => {
    const source = `
class Adult {
    const kind = "Adult";
    name: string;
    age: int;
    income: double;
}
function main(): int {
    let x: Adult;
    x = Adult("Adult", "Alice", 30, 50000.0);
    return 0;
}`;
    const {errors} = transpileCode(source);
    // This should be allowed - the variable is declared and later assigned
    expect(errors).toStrictEqual([]);
  });

  it('should allow union type declaration without initialization', () => {
    const source = `
class Adult {
    const kind = "Adult";
    name: string;
    age: int;
    income: double;
}
class Child {
    const kind = "Child";
    name: string;
    age: int;
    lollipop: string;
}
type Person = Adult | Child;
function main(): int {
    let x: Person;
    x = Adult("Adult", "Alice", 30, 50000.0);
    return 0;
}`;
    const {errors} = transpileCode(source);
    // This should be allowed - union types can be declared and later assigned
    expect(errors).toStrictEqual([]);
  });
});
