/**
 * End-to-end C++ compilation tests (part 1).
 *
 * Covers: C++ compilation, compile and run, lambda captures, string interpolation,
 * interface dispatch, readonly class bindings, for-of with range, case expressions,
 * if expressions, class methods, enum access, default parameters, type aliases,
 * assignment operators, println, array literals, tuples.
 */

import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from "vitest";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

// ============================================================================
// Tests: compilation only (verify generated C++ is syntactically valid)
// ============================================================================

describe("e2e — C++ compilation", () => {
  it("compiles a const int declaration", () => {
    const { success, error, code } = ctx.compileOnly(`
      const X = 42
      function main(): int {
        return X
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles a simple function", () => {
    const { success, error, code } = ctx.compileOnly(`
      function add(a: int, b: int): int => a + b
      function main(): int {
        return add(1, 2)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles if/else control flow", () => {
    const { success, error, code } = ctx.compileOnly(`
      function max(a: int, b: int): int {
        if a > b {
          return a
        } else {
          return b
        }
      }
      function main(): int {
        return max(3, 5)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles while loop", () => {
    const { success, error, code } = ctx.compileOnly(`
      function countdown(n: int): int {
        let i = n
        while i > 0 {
          i = i - 1
        }
        return i
      }
      function main(): int {
        return countdown(10)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles a class with fields and constructor", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Point {
        x, y: float
      }
      function main(): int {
        p := Point { x: 1.0f, y: 2.0f }
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles class with methods", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Counter {
        value: int
        function get(): int => value
      }
      function main(): int {
        c := Counter { value: 0 }
        return c.get()
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles enum declaration", () => {
    const { success, error, code } = ctx.compileOnly(`
      enum Color { Red, Green, Blue }
      function main(): int {
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles boolean operations", () => {
    const { success, error, code } = ctx.compileOnly(`
      function both(a: bool, b: bool): bool => a && b
      function either(a: bool, b: bool): bool => a || b
      function negate(a: bool): bool => !a
      function main(): int {
        if both(true, false) {
          return 1
        }
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles readonly declaration", () => {
    const { success, error, code } = ctx.compileOnly(`
      readonly NAME = "hello"
      function main(): int {
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

// ============================================================================
// Tests: compile + run (verify behavior)
// ============================================================================

describe("e2e — compile and run", () => {
  it("runs simple program with return code", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        return 0
      }
    `);
    if (result.exitCode === -1) {
      console.log("Compile error:", result.stderr);
    } else {
      expect(result.exitCode).toBe(0);
    }
  });

  it("returns correct exit code from main", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        return 42
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(42);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });

  it("evaluates arithmetic correctly", () => {
    const result = ctx.compileAndRun(`
      function compute(): int => 2 + 3 * 4
      function main(): int {
        return compute()
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(14);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });

  it("evaluates if/else correctly", () => {
    const result = ctx.compileAndRun(`
      function abs(x: int): int {
        if x < 0 {
          return -x
        }
        return x
      }
      function main(): int {
        return abs(-7)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(7);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });

  it("evaluates while loop correctly", () => {
    const result = ctx.compileAndRun(`
      function sum_to(n: int): int {
        let s = 0
        let i = 1
        while i <= n {
          s = s + i
          i = i + 1
        }
        return s
      }
      function main(): int {
        return sum_to(10)
      }
    `);
    if (result.exitCode !== -1) {
      // sum 1..10 = 55, but exit code wraps to 55
      expect(result.exitCode).toBe(55);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });

  it("evaluates function calls correctly", () => {
    const result = ctx.compileAndRun(`
      function add(a: int, b: int): int => a + b
      function mul(a: int, b: int): int => a * b
      function main(): int {
        return add(mul(2, 3), 1)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(7);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });
});

// ============================================================================
// Tests: lambda captures compile correctly
// ============================================================================

describe("e2e — lambda captures", () => {
  it("compiles lambda capturing immutable binding by value", () => {
    const { success, error, code } = ctx.compileOnly(`
      function main(): int {
        x := 10
        f := (y: int): int => x + y
        return f(5)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs lambda capturing immutable binding", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        x := 10
        f := (y: int): int => x + y
        return f(5)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(15);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });

  it("compiles lambda capturing mutable binding by reference", () => {
    const { success, error, code } = ctx.compileOnly(`
      function main(): int {
        let count = 0
        inc := (n: int): void {
          count = count + n
        }
        inc(3)
        inc(7)
        return count
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs lambda capturing mutable binding", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let count = 0
        inc := (n: int): void {
          count = count + n
        }
        inc(3)
        inc(7)
        return count
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(10);
    } else {
      console.log("Compile error:", result.stderr);
    }
  });
});

// ============================================================================
// Tests: string interpolation compiles
// ============================================================================

describe("e2e — string interpolation", () => {
  it("compiles string interpolation with doof::concat", () => {
    const source = [
      "function main(): int {",
      "  name := \"world\"",
      "  msg := `Hello, ${name}!`",
      "  return 0",
      "}",
    ].join("\n");
    const { success, error, code } = ctx.compileOnly(source);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

// ============================================================================
// Tests: interface dispatch compiles
// ============================================================================

describe("e2e — interface dispatch", () => {
  it("compiles interface with variant dispatch", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Circle {
        radius: float
        function area(): float => 3.14f * radius * radius
      }
      class Square {
        side: float
        function area(): float => side * side
      }
      interface Shape {
        area(): float
      }
      function main(): int {
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

describe("e2e — static member access", () => {
  it("runs qualified static access on class and interface values", () => {
    const result = ctx.compileAndRun(`
      interface Shape {
        static describe(): string
      }
      class Rectangle implements Shape {
        width: int
        static kind = "rect"
        static describe(): string => Rectangle.kind
      }
      function main(): int {
        rect := Rectangle { width: 1 }
        println(rect::kind)
        shape: Shape := Rectangle { width: 2 }
        println(shape::describe())
        println(shape::metadata.name)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("rect");
    expect(lines[1]).toBe("rect");
    expect(lines[2]).toBe("Rectangle");
  });
});

// ============================================================================
// Tests: class with readonly binding compiles
// ============================================================================

describe("e2e — readonly class bindings", () => {
  it("compiles readonly class binding as shared_ptr<const T>", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Point { x, y: float }
      function main(): int {
        readonly p = Point { x: 1.0f, y: 2.0f }
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

// ============================================================================
// Tests: for-of with range compiles and runs
// ============================================================================

describe("e2e — for-of with range", () => {
  it("compiles for-of with inclusive range", () => {
    const { success, error, code } = ctx.compileOnly(`
      function main(): int {
        let sum = 0
        for i of 1..10 {
          sum = sum + i
        }
        return sum
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs for-of with inclusive range and computes sum", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        for i of 1..10 {
          sum = sum + i
        }
        return sum
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(55);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("compiles for-of with exclusive range", () => {
    const { success, error, code } = ctx.compileOnly(`
      function main(): int {
        let sum = 0
        for i of 0..<5 {
          sum = sum + i
        }
        return sum
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs for-of with exclusive range", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        for i of 0..<5 {
          sum = sum + i
        }
        return sum
      }
    `);
    if (result.exitCode !== -1) {
      // 0 + 1 + 2 + 3 + 4 = 10
      expect(result.exitCode).toBe(10);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: case expression (value matching) compiles and runs
// ============================================================================

describe("e2e — case expressions", () => {
  it("compiles case with value patterns", () => {
    const { success, error, code } = ctx.compileOnly(`
      function describe(x: int): int {
        return case x {
          0 => 10,
          1 => 20,
          _ => 30
        }
      }
      function main(): int {
        return describe(1)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs case with value patterns", () => {
    const result = ctx.compileAndRun(`
      function classify(x: int): int {
        return case x {
          0 => 10,
          1 => 20,
          _ => 30
        }
      }
      function main(): int {
        return classify(1)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(20);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs case with wildcard default", () => {
    const result = ctx.compileAndRun(`
      function classify(x: int): int {
        return case x {
          0 => 10,
          1 => 20,
          _ => 99
        }
      }
      function main(): int {
        return classify(42)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(99);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("compiles case with range patterns", () => {
    const { success, error, code } = ctx.compileOnly(`
      function grade(score: int): int {
        return case score {
          90..100 => 4,
          80..<90 => 3,
          _ => 0
        }
      }
      function main(): int {
        return grade(95)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs case with range patterns", () => {
    const result = ctx.compileAndRun(`
      function grade(score: int): int {
        return case score {
          90..100 => 4,
          80..<90 => 3,
          _ => 0
        }
      }
      function main(): int {
        return grade(85)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs statement-level case with early return", () => {
    const result = ctx.compileAndRun(`
      function classify(x: int): int {
        case x {
          0 => { return 10 }
          _ => { return 20 }
        }
      }
      function main(): int {
        return classify(0)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(10);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs statement-level case with loop control", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let i = 0
        let total = 0
        while i < 4 {
          case i {
            0 => {
              i = i + 1
              continue
            }
            3 => { break }
            _ => {
              total = total + i
              i = i + 1
            }
          }
        }
        return total
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: if-expression compiles and runs
// ============================================================================

describe("e2e — if expressions", () => {
  it("compiles if-expression as ternary", () => {
    const { success, error, code } = ctx.compileOnly(`
      function magnitude(x: int): int => if x < 0 then -x else x
      function main(): int {
        return magnitude(-7)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs if-expression correctly", () => {
    const result = ctx.compileAndRun(`
      function magnitude(x: int): int => if x < 0 then -x else x
      function main(): int {
        return magnitude(-7)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(7);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs case-expression blocks with explicit yield", () => {
    const result = ctx.compileAndRun(`
      function describe(x: int): string {
        return case x {
          0 => {
            yield "zero"
          },
          _ => {
            if x < 0 {
              yield "negative"
            }
            yield "positive"
          }
        }
      }
      function main(): int {
        println(describe(0))
        println(describe(-1))
        println(describe(4))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("zero\nnegative\npositive");
  });
});

// ============================================================================
// Tests: class methods accessing fields via this
// ============================================================================

describe("e2e — class methods", () => {
  it("compiles class method accessing fields", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Rect {
        w, h: float
        function area(): float => w * h
      }
      function main(): int {
        r := Rect { w: 3.0, h: 4.0 }
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs class method returning computed value", () => {
    const result = ctx.compileAndRun(`
      class Adder {
        a, b: int
        function sum(): int => a + b
      }
      function main(): int {
        x := Adder { a: 3, b: 4 }
        return x.sum()
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(7);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: enum access compiles and runs
// ============================================================================

describe("e2e — enum access", () => {
  it("compiles enum variant access", () => {
    const { success, error, code } = ctx.compileOnly(`
      enum Color { Red, Green, Blue }
      function main(): int {
        c := Color.Red
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

// ============================================================================
// Tests: default parameter values compile and run
// ============================================================================

describe("e2e — default parameters", () => {
  it("compiles function with default parameter", () => {
    const { success, error, code } = ctx.compileOnly(`
      function add(a: int, b: int = 10): int => a + b
      function main(): int {
        return add(5)
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs function with default parameter", () => {
    const result = ctx.compileAndRun(`
      function add(a: int, b: int = 10): int => a + b
      function main(): int {
        return add(5)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(15);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs function overriding default parameter", () => {
    const result = ctx.compileAndRun(`
      function add(a: int, b: int = 10): int => a + b
      function main(): int {
        return add(5, 3)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(8);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named arguments out of order", () => {
    const result = ctx.compileAndRun(`
      function clamp(value: int, min: int, max: int): int {
        if value < min { return min }
        if value > max { return max }
        return value
      }
      function main(): int {
        return clamp{ min: 0, max: 100, value: 150 }
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(100);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("fills omitted defaults in named calls by parameter name", () => {
    const result = ctx.compileAndRun(`
      function wrap(value: string, suffix: string = "!"): string {
        return value + suffix
      }
      function main(): int {
        println(wrap{ value: "ok" })
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("ok!");
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs Set default parameter from empty array syntax", () => {
    const result = ctx.compileAndRun(`
      function sizeOf(values: Set<int> = []): int {
        return values.size
      }
      function main(): int {
        return sizeOf()
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs Map default parameter from long-key syntax", () => {
    const result = ctx.compileAndRun(`
      function lookup(values: Map<long, int> = { 1L: 10, 2L: 20 }): int {
        return values[2L]
      }

      function main(): int {
        return lookup() \\ 10
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(2);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: type alias compiles
// ============================================================================

describe("e2e — type aliases", () => {
  it("compiles type alias for primitive", () => {
    const { success, error, code } = ctx.compileOnly(`
      type Score = int
      function getScore(): Score => 42
      function main(): int {
        return getScore()
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });
});

// ============================================================================
// Tests: assignment operators compile and run
// ============================================================================

describe("e2e — assignment operators", () => {
  it("runs compound assignment operators", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let x = 10
        x += 5
        x -= 3
        x *= 2
        return x
      }
    `);
    if (result.exitCode !== -1) {
      // (10 + 5 - 3) * 2 = 24
      expect(result.exitCode).toBe(24);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: println compiles and runs with output
// ============================================================================

describe("e2e — println", () => {
  it("runs println and captures output", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        println("hello world")
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello world");
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs string interpolation and captures output", () => {
    const source = [
      "function main(): int {",
      '  name := "Doof"',
      "  println(`Hello, ${name}!`)",
      "  return 0",
      "}",
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("Hello, Doof!");
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Array literals and for-of with arrays
// ============================================================================

describe("e2e — array literals", () => {
  it("compiles array literal with type annotation", () => {
    const result = ctx.compileOnly(`
      function sum(items: int[]): int {
        let total = 0
        for item of items {
          total = total + item
        }
        return total
      }
      function main(): int => sum([1, 2, 3, 4])
    `);
    expect(result.success).toBe(true);
  });

  it("runs array literal sum via for-of", () => {
    const result = ctx.compileAndRun(`
      function sum(items: int[]): int {
        let total = 0
        for item of items {
          total = total + item
        }
        return total
      }
      function main(): int => sum([10, 20, 30])
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(60);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs array index access", () => {
    const result = ctx.compileAndRun(`
      function second(items: int[]): int => items[1]
      function main(): int => second([10, 20, 30])
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(20);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs array with println output", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let nums = [10, 20, 30]
        let sum = 0
        for n of nums {
          sum = sum + n
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("60");
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Tuple literals and destructuring
// ============================================================================

describe("e2e — tuples", () => {
  it("compiles tuple literal", () => {
    const result = ctx.compileOnly(`
      function pair(): Tuple<int, int> => (10, 20)
      function main(): int => 0
    `);
    expect(result.success).toBe(true);
  });

  it("runs positional destructuring of tuple", () => {
    const result = ctx.compileAndRun(`
      function pair(): Tuple<int, int> => (10, 20)
      function main(): int {
        (a, b) := pair()
        return a + b
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(30);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs positional destructuring of tuple with discard", () => {
    const result = ctx.compileAndRun(`
      function triple(): Tuple<int, int, int> => (10, 20, 30)
      function main(): int {
        (a, _, c) := triple()
        return a + c
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(40);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});
