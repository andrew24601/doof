/**
 * End-to-end C++ compilation tests (part 2).
 *
 * Covers: named destructuring, weak references, optional chaining, lambda closures,
 * nested control flow, weak_ptr fields, recursion, multiple classes, string operations,
 * higher-order functions.
 */

import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from "vitest";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

describe("e2e — byte", () => {
  it("runs byte arrays as shared uint8_t vectors", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        payload: byte[] := [1, 2, 255]
        println(payload)
        return payload.length
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.stdout.trim()).toBe("[1, 2, 255]");
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Named destructuring
// ============================================================================

describe("e2e — named destructuring", () => {
  it("runs named destructuring of class fields", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }
      function main(): int {
        p := Point(10, 20)
        { x, y } := p
        return x + y
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(30);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named destructuring in reversed field order", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }
      function main(): int {
        p := Point(3, 7)
        { y, x } := p
        return x * 10 + y
      }
    `);
    if (result.exitCode !== -1) {
      // x=3, y=7 regardless of destructuring order → 3*10 + 7 = 37
      expect(result.exitCode).toBe(37);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named destructuring with alias", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }
      function main(): int {
        p := Point(5, 8)
        { x as px, y as py } := p
        return px + py
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(13);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named destructuring with partial fields", () => {
    const result = ctx.compileAndRun(`
      class Triple {
        a: int
        b: int
        c: int
      }
      function main(): int {
        t := Triple(10, 20, 30)
        { b } := t
        return b
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(20);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named destructuring with println output", () => {
    const result = ctx.compileAndRun(`
      class User {
        name: string
        age: int
      }
      function main(): int {
        u := User("Alice", 30)
        { name, age } := u
        println(name)
        return age
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.stdout.trim()).toBe("Alice");
      expect(result.exitCode).toBe(30);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs let named destructuring (mutable bindings)", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }
      function main(): int {
        p := Point(1, 2)
        let { x, y } = p
        x = x + 10
        y = y + 20
        return x + y
      }
    `);
    if (result.exitCode !== -1) {
      // x=1+10=11, y=2+20=22 → 33
      expect(result.exitCode).toBe(33);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs class positional destructuring with discard", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
        z: int
      }
      function main(): int {
        (x, _, z) := Point(3, 7, 11)
        return x + z
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(14);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs named destructuring assignment into existing variables", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }
      function main(): int {
        p := Point(9, 4)
        let px = 0
        let py = 0
        { x as px, y as py } = p
        return px * 10 + py
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(94);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Weak references
// ============================================================================

describe("e2e — weak references", () => {
  it("compiles class with weak_ptr field", () => {
    // weak fields require the checker to resolve weak types on class fields
    // For now, just test that the emitter produces compilable output for a class
    // that has a regular field (weak fully tested after checker support)
    const result = ctx.compileOnly(`
      export class Node {
        value: int
      }
      function make(): Node => Node(42)
      function main(): int => make().value
    `);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Tests: Optional chaining
// ============================================================================

describe("e2e — optional chaining", () => {
  it("compiles class construction and field access", () => {
    const result = ctx.compileOnly(`
      export class Box {
        value: int
      }
      function getVal(b: Box): int => b.value
      function main(): int => getVal(Box(42))
    `);
    expect(result.success).toBe(true);
  });

  it("runs class method returning field", () => {
    const result = ctx.compileAndRun(`
      export class Pair {
        x, y: int
        function sum(): int => x + y
      }
      function main(): int {
        p := Pair(15, 27)
        return p.sum()
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(42);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Array safety helpers
// ============================================================================

describe("e2e — array safety", () => {
  it("panics on explicit panic calls", () => {
    const result = ctx.compileAndRun(`
      function main() {
        panic("aieee")
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("panic: aieee");
  });

  it("runs in-bounds array indexing", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        values := [10, 20, 30]
        println(values[1])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20");
  });

  it("panics on out-of-bounds array indexing", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        values := [10, 20, 30]
        println(values[5])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("panic: Index out of bounds: 5");
  });

  it("returns Failure on empty array pop", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let values: int[] = []
        popped := values.pop()
        message := case popped {
          _: Success => "unexpected success",
          f: Failure => f.error,
        }
        println(message)
        if message == "Attempted to pop from empty array" {
          return 0
        }
        return 1
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("Attempted to pop from empty array");
  });

  it("runs documented mutable array methods", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let nums: int[] = [1, 2]
        nums.push(3)
        if nums.length != 3 { return 1 }

        popped := nums.pop()
        last := case popped {
          s: Success => s.value,
          _: Failure => -1,
        }
        if last != 3 { return 2 }
        if nums.length != 2 { return 3 }
        if !nums.contains(2) { return 4 }

        head := nums.slice(0, 1)
        if head.length != 1 { return 5 }
        if head[0] != 1 { return 6 }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("buildReadonly drains source array", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let builder: int[] = [1, 2, 3]
        frozen := builder.buildReadonly()
        if builder.length != 0 { return 1 }
        if frozen.length != 3 { return 2 }
        if !frozen.contains(2) { return 3 }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("cloneMutable returns independent mutable copy", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let frozen: readonly int[] = [1, 2, 3]
        copy := frozen.cloneMutable()
        copy.push(4)
        if copy.length != 4 { return 1 }
        if frozen.length != 3 { return 2 }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("runs array indexOf/some/every/filter/map", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        nums := [1, 2, 3, 4]

        if nums.indexOf(3) != 2 { return 3 }
        if nums.indexOf(9) != -1 { return 4 }

        if !nums.some((it: int): bool => it % 2 == 0) { return 5 }
        if nums.some((it: int): bool => it > 10) { return 6 }
        if !nums.every((it: int): bool => it > 0) { return 7 }
        if nums.every((it: int): bool => it < 4) { return 8 }

        evens := nums.filter((it: int): bool => it % 2 == 0)
        if evens.length != 2 { return 9 }
        if evens[0] != 2 || evens[1] != 4 { return 10 }

        labels := nums.map((it: int): string => "#\${string(it)}")
        if labels.length != 4 { return 11 }
        if labels[2] != "#3" { return 12 }

        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("runs array destructuring with discard", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        [head, _, tail] := [10, 20, 30]
        return head + tail
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(40);
  });

  it("runs try array destructuring", () => {
    const result = ctx.compileAndRun(`
      function load(): Result<int[], string> => Success([3, 4, 5])

      function total(): Result<int, string> {
        try [a, _, c] := load()
        return Success(a + c)
      }

      function main(): int => try! total()
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(8);
  });

  it("runs try array destructuring assignment", () => {
    const result = ctx.compileAndRun(`
      function load(): Result<int[], string> => Success([6, 7, 8])

      function total(): Result<int, string> {
        let first = 0
        let last = 0
        try [first, _, last] = load()
        return Success(first + last)
      }

      function main(): int => try! total()
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(14);
  });

  it("panics when array destructuring needs more elements", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        [a, b, c] := [1, 2]
        return a + b + c
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("panic: Array destructuring expected at least 3 elements, got 2");
  });

  it("runs Set literals and methods", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let unique: Set<int> = [1, 2, 3, 2]
        if !unique.has(2) {
          return 1
        }
        unique.add(4)
        unique.delete(1)
        println(unique.size)
        if unique.has(4) && !unique.has(1) {
          return 0
        }
        return 2
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("3");
  });

  it("runs explicit enum-access Set initializers", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Blue }

      function main(): int {
        let palette: Set<Color> = [Color.Red, Color.Blue, Color.Red]
        if palette.has(Color.Red) && palette.has(Color.Blue) {
          println(palette.size)
          return 0
        }
        return 1
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("runs contextual int-to-long Set initializers", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let ids: Set<long> = [1, 2, 3]
        if ids.has(2L) {
          println(ids.size)
          return 0
        }
        return 1
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("3");
  });
});

describe("e2e — map safety", () => {
  it("runs Map.get() through Result case matching", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<string, int> = { "a": 10, "b": 20 }
        const found = case m.get("b") {
          s: Success => s.value,
          _: Failure => -1
        }
        const missing = case m.get("missing") {
          s: Success => s.value,
          _: Failure => -1
        }
        println(found)
        println(missing)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20\n-1");
  });

  it("runs try? on Map.get() failures", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<string, int> = { "a": 10 }
        const found = try? m.get("a")
        const missing = try? m.get("missing")
        if found != null {
          println(found)
        }
        if missing == null {
          println("missing")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("10\nmissing");
  });

  it("runs map index read for existing key", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<string, int> = { "a": 10, "b": 20 }
        println(m["b"])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20");
  });

  it("panics on missing map key via index read", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<string, int> = { "a": 10 }
        println(m["missing"])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("panic: Map key not found");
  });

  it("inserts new entries on map index assignment", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<string, int> = { "a": 10 }
        m["b"] = 25
        println(m["b"])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("25");
  });

  it("runs long-keyed map reads", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<long, int> = { 1L: 10, 2L: 20 }
        println(m[2L])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20");
  });

  it("runs enum-keyed map reads", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }

      function main(): int {
        let m: Map<Color, int> = { .Red: 1, .Green: 2, .Blue: 3 }
        println(m[Color.Green])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("runs explicit enum-access map initializers", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }

      function main(): int {
        let m: Map<Color, int> = { Color.Red: 1, Color.Green: 2 }
        println(m[Color.Red])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("1");
  });

  it("runs contextual int-to-long map initializers", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let m: Map<long, int> = { 1: 10, 2: 20 }
        println(m[2L])
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20");
  });

  it("prints maps arrays and enums readably", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }

      function main(): int {
        config: Map<string, string> := { "kind": "toy", "color": "red" }
        numbers := [1, 2, 3, 4]
        c: Color := .Green

        println(config)
        println(numbers)
        println(c)

        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "{kind: toy, color: red}",
      "[1, 2, 3, 4]",
      "Green",
    ]);
  });

  it("preserves map insertion order across keys values and iteration", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let scores: Map<string, int> = { "alice": 1, "bob": 2, "carol": 3 }
        scores.set("bob", 20)

        println(scores.keys())
        println(scores.values())
        for name, score of scores {
          println("\${name}=\${score}")
        }

        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "[alice, bob, carol]",
      "[1, 20, 3]",
      "alice=1",
      "bob=20",
      "carol=3",
    ]);
  });

  it("moves deleted and reinserted map keys to the end", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let scores: Map<string, int> = { "alice": 1, "bob": 2, "carol": 3 }
        scores.delete("bob")
        scores.set("bob", 20)
        println(scores.keys())
        println(scores.values())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "[alice, carol, bob]",
      "[1, 3, 20]",
    ]);
  });

  it("preserves set insertion order and appends re-added values", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let values: Set<int> = [3, 1, 2, 1]
        println(values.values())
        values.delete(1)
        values.add(1)
        println(values.values())
        for value of values {
          println(value)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "[3, 1, 2]",
      "[3, 2, 1]",
      "3",
      "2",
      "1",
    ]);
  });

  it("runs map and set churn with ordered collection validation enabled", () => {
    const result = ctx.compileAndRunProject({
      "/main.do": `
        function main(): int {
          let scores: Map<int, int> = {}
          for let i = 0; i < 32; i += 1 {
            scores.set(i, i + 1)
          }
          for let i = 0; i < 32; i += 2 {
            scores.delete(i)
          }
          for let i = 0; i < 32; i += 2 {
            scores.set(i, i * 10)
          }

          let values: Set<int> = []
          for let i = 0; i < 32; i += 1 {
            values.add(i % 7)
          }
          for let i = 0; i < 7; i += 2 {
            values.delete(i)
            values.add(i)
          }

          let total = 0
          for key, value of scores {
            total += value
          }
          for value of values {
            total += value
          }

          println(scores.size)
          println(scores.keys().length)
          println(scores.values().length)
          println(values.size)
          println(values.values().length)
          println(total)
          return 0
        }
      `,
    }, "/main.do", {
      defines: ["DOOF_RUNTIME_VALIDATE_ORDERED_COLLECTIONS"],
      compilerFlags: ["-O2"],
    });
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "32",
      "32",
      "32",
      "7",
      "7",
      "2693",
    ]);
  });
});

// ============================================================================
// Tests: Lambda capture and closures
// ============================================================================

describe("e2e — lambda closures", () => {
  it("runs lambda capturing immutable binding", () => {
    const result = ctx.compileAndRun(`
      function apply(f: (x: int): int, x: int): int => f(x)
      function main(): int {
        offset := 10
        add := (x: int): int => x + offset
        return apply(add, 32)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(42);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs lambda capturing mutable binding by reference", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let count = 0
        inc := (): void { count = count + 1 }
        inc()
        inc()
        inc()
        return count
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs escaping lambda with mutable capture (makeCounter)", () => {
    const result = ctx.compileAndRun(`
      function makeCounter(): (): int {
        let count = 0
        return (): int { count = count + 1; return count }
      }
      function main(): int {
        counter := makeCounter()
        counter()
        counter()
        return counter()
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs two escaping closures sharing mutable state", () => {
    const result = ctx.compileAndRun(`
      function makeAccumulator(start: int): (n: int): int {
        let total = start
        return (n: int): int { total = total + n; return total }
      }
      function main(): int {
        acc := makeAccumulator(0)
        acc(10)
        acc(20)
        return acc(12)
      }
    `);
    if (result.exitCode !== -1) {
      // 0 + 10 = 10, 10 + 20 = 30, 30 + 12 = 42
      expect(result.exitCode).toBe(42);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Nested control flow
// ============================================================================

describe("e2e — nested control flow", () => {
  it("runs nested if/else with multiple returns", () => {
    const result = ctx.compileAndRun(`
      function classify(n: int): int {
        if n < 0 {
          return -1
        } else if n == 0 {
          return 0
        } else {
          return 1
        }
      }
      function main(): int => classify(42) + classify(-5) + classify(0)
    `);
    if (result.exitCode !== -1) {
      // 1 + (-1) + 0 = 0
      expect(result.exitCode).toBe(0);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs while loop with counter", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        let i = 1
        while i <= 10 {
          sum = sum + i
          i = i + 1
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
});

// ============================================================================
// Tests: Weak pointer fields
// ============================================================================

describe("e2e — weak_ptr fields", () => {
  it("compiles class with weak_ptr field correctly", () => {
    const result = ctx.compileOnly(`
      export class Node {
        value: int
        weak parent: Node
      }
      function main(): int => 0
    `);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Tests: Recursion
// ============================================================================

describe("e2e — recursion", () => {
  it("runs recursive fibonacci", () => {
    const result = ctx.compileAndRun(`
      function fib(n: int): int {
        if n <= 1 {
          return n
        }
        return fib(n - 1) + fib(n - 2)
      }
      function main(): int => fib(10)
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(55);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Multiple class instances
// ============================================================================

describe("e2e — multiple classes", () => {
  it("compiles and runs multiple class types", () => {
    const result = ctx.compileAndRun(`
      export class Point {
        x, y: int
        function distSq(): int => x * x + y * y
      }
      export class Rect {
        width, height: int
        function area(): int => width * height
      }
      function main(): int {
        p := Point(3, 4)
        r := Rect(5, 6)
        return p.distSq() + r.area()
      }
    `);
    if (result.exitCode !== -1) {
      // 3*3 + 4*4 + 5*6 = 9 + 16 + 30 = 55
      expect(result.exitCode).toBe(55);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: String operations
// ============================================================================

describe("e2e — string operations", () => {
  it("runs string comparison", () => {
    const result = ctx.compileAndRun(`
      function check(s: string): int {
        if s == "hello" {
          return 1
        }
        return 0
      }
      function main(): int => check("hello")
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("runs multi-part string interpolation", () => {
    const source = [
      "function main(): int {",
      "  x := 42",
      "  y := 58",
      "  println(`${x} + ${y} = ${x + y}`)",
      "  return 0",
      "}",
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("42 + 58 = 100");
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Tests: Higher-order functions with std::function
// ============================================================================

describe("e2e — higher-order functions", () => {
  it("runs function passed as parameter", () => {
    const result = ctx.compileAndRun(`
      function apply(f: (x: int): int, x: int): int => f(x)
      function double(n: int): int => n * 2
      function main(): int => apply(double, 21)
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(42);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// String methods (end-to-end)
// ============================================================================

describe("e2e — string methods", () => {
  it("string.length works on variable and class field", () => {
    const result = ctx.compileAndRun(`
      class Msg { body: string }
      function main(): int {
        s := "hello"
        m := Msg("world!")
        return s.length + m.body.length
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(11); // 5 + 6
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.indexOf returns correct position", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "hello world"
        return s.indexOf("world")
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(6);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.indexOf returns -1 when not found", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "hello"
        pos := s.indexOf("xyz")
        if pos == -1 { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.contains works", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "hello world"
        if s.contains("world") { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.startsWith and endsWith work", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "hello world"
        let r = 0
        if s.startsWith("hello") { r = r + 1 }
        if s.endsWith("world") { r = r + 1 }
        return r
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(2);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.substring extracts range", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "hello world"
        sub := s.substring(0, 5)
        if sub == "hello" { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.split produces correct parts", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        parts := "a,b,c".split(",")
        return parts.length
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(3);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("array.contains and array.slice work", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        nums := [1, 2, 3, 4]
        if !nums.contains(3) { return 0 }
        mid := nums.slice(1, 3)
        if mid.length != 2 { return 0 }
        if mid[0] != 2 { return 0 }
        if mid[1] != 3 { return 0 }
        return 1
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.toUpperCase and toLowerCase work", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        u := "hello".toUpperCase()
        l := "HELLO".toLowerCase()
        if u == "HELLO" && l == "hello" { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.replace replaces first occurrence", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "aabaa".replace("a", "x")
        if s == "xabaa" { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.replaceAll replaces all occurrences", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "aabaa".replaceAll("a", "x")
        if s == "xxbxx" { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.trim removes whitespace", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "  hello  ".trim()
        if s == "hello" { return 1 }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(1);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("string.repeat works", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        s := "ab".repeat(3)
        if s == "ababab" { return s.length }
        return 0
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(6);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });
});

// ============================================================================
// Non-null assertion (end-to-end)
// ============================================================================

describe("e2e — non-null assertion", () => {
  it("postfix ! unwraps nullable and passes to function", () => {
    const result = ctx.compileAndRun(`
      function greet(name: string): int => name.length
      function main(): int {
        name: string | null := "hello"
        return greet(name!)
      }
    `);
    if (result.exitCode !== -1) {
      expect(result.exitCode).toBe(5);
    } else {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
  });

  it("prints nullable ints without C++ compile errors", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        a: int | null := 12
        b: int | null := null
        println(a)
        println(b)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("12\nnull");
  });

  it("prints primitive unions without C++ compile errors", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        x: int | float := 4.3f
        y: int | float := 7
        println(x)
        println(y)
        println(string(x))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("4.3\n7\n4.3");
  });
});
