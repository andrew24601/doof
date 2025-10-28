import { describe, it, expect } from 'vitest';
import { transpileCode } from './util';

describe('Type alias with union including null', () => {
  const source = `
class Adult {
    const kind = "Adult";
    name: string;
    age: int;
    income: double;

    greet(): int {
        println("Hello, I'm an adult");
        return age;
    }
}

class Child {
    const kind = "Child";
    name: string;
    age: int;
    lollipop: string;

    greet(): int {
        println("Hello, I'm an child");
        return age;
    }
}

type Person = Adult | Child;

function main(): int {
    let x: Person | null = null;
    return 0;
}
`;

  it('should parse and transpile Person | null as a variant type including null', () => {
    const result = transpileCode(source);
    expect(result.errors).toStrictEqual([]);
    // Check that the generated C++ code has expanded to a variant type for Adult | Child | null
    expect(result.source).toContain("std::optional<std::variant<std::shared_ptr<Adult>, std::shared_ptr<Child>>> x = std::nullopt;");
  });
});
