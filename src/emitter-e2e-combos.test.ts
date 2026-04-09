/**
 * End-to-end C++ compilation tests (part 5).
 *
 * Covers: feature combinations, boundary conditions, loop-then clause,
 * multi-module feature combinations.
 */

import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from "vitest";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

// ============================================================================
// Feature combination and boundary condition tests
// ============================================================================

describe("e2e — feature combinations", () => {

  it("builds nested render-style batches from local vertex arrays", () => {
    const result = ctx.compileAndRun(`
      class RenderVertex {
        x: float = 0.0f
        y: float = 0.0f
      }

      class RenderDraw {
        textureId: int = -1
        vertices: RenderVertex[] = []
      }

      class WorldRenderPlan {
        draws: RenderDraw[] = []
      }

      function buildDraw(textureId: int, base: float): RenderDraw {
        let verts: RenderVertex[] = []
        verts.push(RenderVertex { x: base, y: 1.0f })
        verts.push(RenderVertex { x: base + 1.0f, y: 2.0f })
        return RenderDraw { textureId: textureId, vertices: verts }
      }

      function addDraw(world: WorldRenderPlan, textureId: int, base: float): void {
        world.draws.push(buildDraw(textureId, base))
      }

      function main(): int {
        world := WorldRenderPlan {}
        addDraw(world, 7, 10.0f)
        addDraw(world, 8, 20.0f)
        return world.draws.length + world.draws[0].vertices.length
      }
    `)
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`)
    }
    expect(result.exitCode).toBe(4)
  })

  it("anonymous object literal in array .push() compiles and runs", () => {
    const result = ctx.compileAndRun(`
      class RenderVertex {
        x: float = 0.0f
        y: float = 0.0f
      }

      function main(): int {
        let verts: RenderVertex[] = []
        verts.push({ x: 1.0f, y: 2.0f })
        verts.push({ x: 3.0f, y: 4.0f })
        verts.push((5.0f, 6.0f))
        return verts.length
      }
    `)
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`)
    }
    expect(result.exitCode).toBe(3)
  })

  // ---- Case expression inside lambda body ----
  it("case expression inside lambda body", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        describe := (n: int): string => case n {
          1 => "one",
          2 => "two",
          _ => "other"
        }
        println(describe(1))
        println(describe(2))
        println(describe(99))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("one\ntwo\nother");
  });

  // ---- Nested case expressions ----
  it("nested case expressions (case inside case arm)", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        x := 2
        y := 3
        result := case x {
          1 => "x=1",
          2 => case y {
            3 => "x=2,y=3",
            _ => "x=2,y=other"
          },
          _ => "x=other"
        }
        println(result)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("x=2,y=3");
  });

  // ---- Case expression with string matching ----
  it("case expression with string value matching", () => {
    const result = ctx.compileAndRun(`
      function greet(lang: string): string => case lang {
        "en" => "hello",
        "es" => "hola",
        "fr" => "bonjour",
        _ => "hi"
      }

      function main(): int {
        println(greet("en"))
        println(greet("es"))
        println(greet("fr"))
        println(greet("de"))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("hello\nhola\nbonjour\nhi");
  });

  // ---- Case expression as function return (expression-bodied) ----
  it("case expression as expression-bodied function return", () => {
    const result = ctx.compileAndRun(`
      function classify(n: int): string => case n {
        0 => "zero",
        1..10 => "small",
        _ => "big"
      }

      function main(): int {
        println(classify(0))
        println(classify(5))
        println(classify(100))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("zero\nsmall\nbig");
  });

  // ---- Lambda returning a lambda (closure factory) ----
  it("lambda returning a lambda (closure factory)", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        adder := (n: int): (x: int): int => {
          return (x: int): int => x + n
        }
        add5 := adder(5)
        add10 := adder(10)
        println(add5(3))
        println(add10(3))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("8\n13");
  });

  // ---- Lambda capturing loop variable ----
  it("lambda capturing for-of loop iteration state", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        const nums: int[] = [10, 20, 30]
        doubler := (x: int): int => x * 2
        for n of nums {
          sum += doubler(n)
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("120");
  });

  // ---- Lambda inside with block capturing with binding ----
  it("lambda inside with block captures with binding", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with factor := 10 {
          multiply := (x: int): int => x * factor
          println(multiply(5))
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("50");
  });

  // ---- try inside a while loop ----
  it("try inside a while loop with early return", () => {
    const result = ctx.compileAndRun(`
      function mayFail(n: int): Result<int, string> {
        if n == 3 {
          return Failure("bad")
        }
        return Success(n * 10)
      }

      function process(): Result<int, string> {
        let i = 0
        let sum = 0
        while i < 5 {
          try val := mayFail(i)
          sum += val
          i += 1
        }
        return Success(sum)
      }

      function main(): int {
        r := process()
        out := case r {
          _: Success => "no-err",
          f: Failure => f.error
        }
        println(out)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("bad");
  });

  // ---- try inside a for-of loop ----
  it("try inside a for-of loop with early return", () => {
    const result = ctx.compileAndRun(`
      function validate(n: int): Result<int, string> {
        if n < 0 {
          return Failure("negative")
        }
        return Success(n)
      }

      function sumPositive(nums: int[]): Result<int, string> {
        let total = 0
        for n of nums {
          try v := validate(n)
          total += v
        }
        return Success(total)
      }

      function main(): int {
        r1 := sumPositive([1, 2, 3])
        out1 := case r1 {
          s: Success => s.value,
          _: Failure => -1
        }
        println(out1)

        r2 := sumPositive([1, -5, 3])
        out2 := case r2 {
          s: Success => s.value,
          _: Failure => -1
        }
        println(out2)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("6\n-1");
  });

  // ---- Deeply nested control flow ----
  it("deeply nested control flow (if inside while inside for-of)", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const rows: int[] = [1, 2, 3]
        let total = 0
        for r of rows {
          let c = 0
          while c < r {
            if c % 2 == 0 {
              total += 1
            } else {
              total += 2
            }
            c += 1
          }
        }
        println(total)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // r=1: c=0 (even,+1) → 1
    // r=2: c=0 (even,+1), c=1 (odd,+2) → 3
    // r=3: c=0 (+1), c=1 (+2), c=2 (+1) → 4
    // total = 1+3+4 = 8
    expect(result.stdout.trim()).toBe("8");
  });

  // ---- Class with destructor e2e ----
  // BUG: destructor block was not being emitted as C++ destructor (~ClassName)
  it("class with destructor runs deterministically", () => {
    const result = ctx.compileAndRun(`
      class Resource {
        name: string

        destructor {
          println("destroyed " + name)
        }
      }

      function main(): int {
        r := Resource { name: "file" }
        println("created")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // shared_ptr destructor should fire when r goes out of scope
    expect(result.stdout.trim()).toBe("created\ndestroyed file");
  });

  // ---- Self-referential class (linked list) ----
  // BUG: (1) emitter uses '.' instead of '->' after null-assert on shared_ptr
  // BUG: (2) auto-generated JSON fromJsonValue constructor conflicts with field defaults
  it("self-referential class (linked list node)", () => {
    const result = ctx.compileAndRun(`
      class Node {
        value: int
        next: Node | null = null
      }

      function main(): int {
        a := Node { value: 1 }
        b := Node { value: 2, next: a }
        c := Node { value: 3, next: b }
        println(c.value)
        println(c.next!.value)
        println(c.next!.next!.value)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("3\n2\n1");
  });

  // ---- Multiple classes with shared interface and dispatch ----
  it("interface with 3+ implementors dispatches correctly", () => {
    const result = ctx.compileAndRun(`
      interface Shape {
        area(): double
      }

      class Circle {
        radius: double
        area(): double => 3.14159 * radius * radius
      }

      class Rect {
        w: double
        h: double
        area(): double => w * h
      }

      class Triangle {
        base: double
        height: double
        area(): double => 0.5 * base * height
      }

      function printArea(s: Shape) {
        println(s.area())
      }

      function main(): int {
        printArea(Circle { radius: 1.0 })
        printArea(Rect { w: 3.0, h: 4.0 })
        printArea(Triangle { base: 6.0, height: 2.0 })
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(parseFloat(lines[0])).toBeCloseTo(3.14159, 3);
    expect(parseFloat(lines[1])).toBeCloseTo(12.0, 3);
    expect(parseFloat(lines[2])).toBeCloseTo(6.0, 3);
  });

  // ---- Interface with both fields and methods ----
  it("interface with both fields and methods", () => {
    const result = ctx.compileAndRun(`
      interface Named {
        name: string
        greet(): string
      }

      class Person {
        name: string
        greet(): string => "Hi, I'm " + name
      }

      class Bot {
        name: string
        greet(): string => "Beep boop, I'm " + name
      }

      function introduce(n: Named) {
        println(n.greet())
      }

      function main(): int {
        introduce(Person { name: "Alice" })
        introduce(Bot { name: "R2D2" })
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("Hi, I'm Alice\nBeep boop, I'm R2D2");
  });

  // ---- Traditional C-style for loop e2e ----
  it("traditional for loop compiles and runs", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        for let i = 0; i < 5; i += 1 {
          sum += i
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10");
  });

  // ---- Labeled break e2e ----
  it("labeled break exits outer loop", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let found = 0
        outer: for x of 1..5 {
          for y of 1..5 {
            if x * y == 12 {
              found = x * 100 + y
              break outer
            }
          }
        }
        println(found)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // 3*4=12, so found = 304
    expect(result.stdout.trim()).toBe("304");
  });

  // ---- Bitwise operators e2e ----
  it("bitwise operators compile and run correctly", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        a := 0b1100
        b := 0b1010
        println(a & b)
        println(a | b)
        println(a ^ b)
        println(~0)
        println(1 << 4)
        println(32 >> 2)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("8\n14\n6\n-1\n16\n8");
  });

  // ---- Integer division vs float division ----
  it("integer division truncates, float division preserves", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        intDiv := 7 \\ 2
        println(intDiv)
        floatDiv := 7.0 / 2.0
        println(floatDiv)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("3");
    expect(parseFloat(lines[1])).toBeCloseTo(3.5, 5);
  });

  // ---- Modulo with negative numbers ----
  it("modulo with negative numbers follows C++ semantics", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        println(-7 % 3)
        println(7 % -3)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // C++ truncated division: -7 % 3 = -1, 7 % -3 = 1
    expect(result.stdout.trim()).toBe("-1\n1");
  });

  // ---- Numeric casts ----
  it("numeric casts convert between types", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        a := 7
        b := 2
        println(float(a) / float(b))
        println(int(3.9))
        println(double(42))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(parseFloat(lines[0])).toBeCloseTo(3.5, 5);
    expect(lines[1]).toBe("3");
    expect(lines[2]).toBe("42");
  });

  // ---- Integer division operator ----
  it("integer division with \\\\ operator", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        println(7 \\ 2)
        println(100 \\ 3)
        println(-7 \\ 2)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("3\n33\n-3");
  });

  // ---- Exponentiation edge cases ----
  it("exponentiation edge cases (0**0, negative base)", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        println(2 ** 10)
        println(0 ** 0)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("1024");
    expect(lines[1]).toBe("1");  // 0^0 = 1 per std::pow
  });

  // ---- String interpolation with complex expressions ----
  it("string interpolation with complex expressions", () => {
    const source = [
      'function main(): int {',
      '  a := 3',
      '  b := 4',
      '  println(`sum=${a + b}, product=${a * b}`)',
      '  label := if a > b then "greater" else "lesser"',
      '  println(`nested: ${label}`)',
      '  return 0',
      '}',
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("sum=7, product=12\nnested: lesser");
  });

  // ---- Adjacent string interpolations ----
  it("adjacent string interpolations", () => {
    const source = [
      'function main(): int {',
      '  a := "hello"',
      '  b := "world"',
      '  println(`${a}${b}`)',
      '  println(`${a} ${b}!`)',
      '  return 0',
      '}',
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("helloworld\nhello world!");
  });

  it("double-quoted string interpolation", () => {
    const source = [
      'function main(): int {',
      '  name := "world"',
      '  count := 2',
      '  println("hello ${name}")',
      '  println("count=${count}")',
      '  return 0',
      '}',
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("hello world\ncount=2");
  });

  // ---- String interpolation with non-string types ----
  it("string interpolation with non-string types", () => {
    const source = [
      'function main(): int {',
      '  n := 42',
      '  b := true',
      '  d := 3.14',
      '  println(`int=${n}`)',
      '  println(`bool=${b}`)',
      '  println(`double=${d}`)',
      '  return 0',
      '}',
    ].join("\n");
    const result = ctx.compileAndRun(source);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("int=42");
    expect(lines[1]).toBe("bool=true");  // doof::to_string prints booleans as true/false
    expect(lines[2]).toMatch(/double=3\.14/);
  });

  // ---- Numeric widening in mixed expressions ----
  it("numeric widening int + double yields double", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        i := 3
        d := 0.5
        result := i + d
        println(result)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("3.5");
  });

  // ---- Class with both readonly and mutable fields ----
  // BUG: auto-generated JSON constructor conflicts when class has const field + defaulted fields
  it("class with both readonly and mutable fields", () => {
    const result = ctx.compileAndRun(`
      class Config {
        const VERSION = "1.0"
        name: string
        count: int = 0

        increment() {
          this.count = this.count + 1
        }
      }

      function main(): int {
        c := Config { name: "test" }
        c.increment()
        c.increment()
        println(c.name)
        println(c.count)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("test\n2");
  });

  // ---- Higher order function with lambda and closure ----
  it("higher order function composition with closures", () => {
    const result = ctx.compileAndRun(`
      function apply(f: (n: int): int, x: int): int => f(x)

      function main(): int {
        offset := 100
        result := apply((n: int): int => n + offset, 42)
        println(result)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("142");
  });

  // ---- Recursive function with default parameter ----
  it("recursive function with default parameter", () => {
    const result = ctx.compileAndRun(`
      function factorial(n: int, acc: int = 1): int {
        if n <= 1 {
          return acc
        }
        return factorial(n - 1, acc * n)
      }

      function main(): int {
        println(factorial(5))
        println(factorial(5, 2))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("120\n240");
  });

  // ---- Enum with methods used in case expression ----
  // BUG: case expression emits 'Color.Red' instead of 'Color::Red' for enum values
  it("enum in case expression (dot shorthand match)", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }

      function describe(c: Color): string => case c {
        Color.Red => "warm",
        Color.Green => "cool",
        Color.Blue => "cool"
      }

      function main(): int {
        println(describe(Color.Red))
        println(describe(Color.Blue))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("warm\ncool");
  });

  // ---- Result combined with case + try in sequence ----
  it("Result pipeline: multiple try + case on final result", () => {
    const result = ctx.compileAndRun(`
      function step1(n: int): Result<int, string> {
        if n < 0 {
          return Failure("negative")
        }
        return Success(n + 1)
      }

      function step2(n: int): Result<int, string> {
        if n > 100 {
          return Failure("too big")
        }
        return Success(n * 2)
      }

      function pipeline(n: int): Result<int, string> {
        try a := step1(n)
        try b := step2(a)
        return Success(b)
      }

      function main(): int {
        r := pipeline(5)
        out := case r {
          s: Success => s.value,
          _: Failure => -1
        }
        println(out)

        r2 := pipeline(-1)
        out2 := case r2 {
          s: Success => s.value,
          _: Failure => -1
        }
        println(out2)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("12\n-1");
  });

  // ---- Catch expression with case on error ----
  // BUG: emitter uses 'nullptr' instead of 'std::nullopt' for optional<string> null comparison
  it("catch expression combined with case on captured error", () => {
    const result = ctx.compileAndRun(`
      function mayFail(x: int): Result<int, string> {
        if x == 0 {
          return Failure("zero!")
        }
        return Success(100 \\ x)
      }

      function main(): int {
        const err = catch {
          try a := mayFail(0)
          println(a)
        }
        if err != null {
          println("caught error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("caught error");
  });

  // ---- Positional construction ----
  it("positional class construction", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }

      function main(): int {
        p := Point(10, 20)
        println(p.x)
        println(p.y)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10\n20");
  });

  // ---- Tuple with class elements ----
  // NOTE: tuple destructuring of a variable `(a,b) := pair` doesn't parse —
  // only function calls work `(a,b) := fn()`. This is a known parser limitation.
  // Workaround: wrap in a function.
  it("tuple containing class instances", () => {
    const result = ctx.compileAndRun(`
      class Point {
        x: int
        y: int
      }

      function makePair(): Tuple<Point, Point> {
        p1 := Point { x: 1, y: 2 }
        p2 := Point { x: 3, y: 4 }
        return (p1, p2)
      }

      function main(): int {
        (a, b) := makePair()
        println(a.x + b.x)
        println(a.y + b.y)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("4\n6");
  });

  // ---- Named destructuring with method call ----
  it("named destructuring then method call on extracted field", () => {
    const result = ctx.compileAndRun(`
      class Inner {
        value: int
        doubled(): int => value * 2
      }

      class Outer {
        inner: Inner
        name: string
      }

      function main(): int {
        obj := Outer { inner: Inner { value: 21 }, name: "test" }
        { inner, name } := obj
        println(inner.doubled())
        println(name)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42\ntest");
  });

  // ---- Multiple enums in same module ----
  it("multiple enums coexist correctly", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }
      enum Size { Small, Medium, Large }

      function main(): int {
        c := Color.Green
        s := Size.Large
        println(c == Color.Green)
        println(s == Size.Small)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("true\nfalse");
  });

  // ---- Array of arrays ----
  it("array of arrays (2D array)", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const matrix: int[][] = [[1, 2], [3, 4], [5, 6]]
        let sum = 0
        for row of matrix {
          for val of row {
            sum += val
          }
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("21");
  });

  // ---- Class with method calling another method ----
  it("class method calling another method on same instance", () => {
    const result = ctx.compileAndRun(`
      class Calculator {
        value: int

        add(n: int): int => value + n

        addAndDouble(n: int): int => this.add(n) * 2
      }

      function main(): int {
        c := Calculator { value: 10 }
        println(c.addAndDouble(5))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("30");
  });

  // ---- Multiple with blocks nested ----
  it("nested with blocks with different bindings", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with x := 10 {
          with y := 20 {
            with z := x + y {
              println(z)
            }
          }
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("30");
  });

  // ---- While loop with early break ----
  it("while true with break pattern", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let i = 0
        while true {
          if i >= 5 {
            break
          }
          i += 1
        }
        println(i)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("5");
  });

  // ---- Compound assignment operators ----
  it("all compound assignment operators", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let x = 10
        x += 5
        println(x)
        x -= 3
        println(x)
        x *= 2
        println(x)
        x /= 6
        println(x)
        x %= 3
        println(x)
        x **= 3
        println(x)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("15\n12\n24\n4\n1\n1");
  });

  // ---- Class with many fields ----
  it("class with many fields (10+)", () => {
    const result = ctx.compileAndRun(`
      class BigClass {
        a: int
        b: int
        c: int
        d: int
        e: int
        f: int
        g: int
        h: int
        i: int
        j: int

        sum(): int => a + b + c + d + e + f + g + h + i + j
      }

      function main(): int {
        obj := BigClass { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 }
        println(obj.sum())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("55");
  });

  // ---- Function with many parameters ----
  it("function with many parameters (8 params)", () => {
    const result = ctx.compileAndRun(`
      function sum8(a: int, b: int, c: int, d: int, e: int, f: int, g: int, h: int): int {
        return a + b + c + d + e + f + g + h
      }

      function main(): int {
        println(sum8(1, 2, 3, 4, 5, 6, 7, 8))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("36");
  });

  // ---- Empty class (no fields, no methods) ----
  it("empty class with no fields", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Empty {}

      function main(): int {
        e := Empty()
        return 0
      }
    `);
    expect(success).toBe(true);
  });

  // ---- Single-element array ----
  it("single-element array operations", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const arr: int[] = [42]
        println(arr[0])
        let sum = 0
        for x of arr {
          sum += x
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42\n42");
  });
});

describe("e2e — boundary conditions", () => {

  // ---- Empty string operations ----
  // BUG: empty string "" emits as const char*, then char* + char* is invalid C++
  it("empty string concatenation and interpolation", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        empty := ""
        result := empty + "hello"
        println(result)
        println("prefix" + empty + "suffix")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("hello\nprefixsuffix");
  });

  // ---- Zero and negative ranges ----
  // BUG: reversed range 5..3 causes infinite loop or timeout instead of 0 iterations
  it("for-of range with zero iterations", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let count = 0
        for i of 5..3 {
          count += 1
        }
        println(count)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("0");
  });

  // ---- Single iteration range ----
  it("for-of range with exactly one iteration", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let count = 0
        for i of 5..5 {
          count += 1
        }
        println(count)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("1");
  });

  // ---- Exclusive range boundary ----
  it("exclusive range excludes upper bound", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let last = -1
        for i of 0..<3 {
          last = i
        }
        println(last)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("2");
  });

  // ---- Case with only wildcard ----
  it("case expression with only wildcard arm", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        x := 42
        result := case x {
          _ => "always this"
        }
        println(result)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("always this");
  });

  // ---- Deeply nested class instances ----
  it("deeply nested class instances (3 levels)", () => {
    const result = ctx.compileAndRun(`
      class C { value: int }
      class B { c: C }
      class A { b: B }

      function main(): int {
        a := A { b: B { c: C { value: 99 } } }
        println(a.b.c.value)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("99");
  });

  // ---- Numeric boundary: large int ----
  it("large int values near 32-bit boundary", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        maxish := 2147483647
        println(maxish)
        minish := -2147483647
        println(minish)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("2147483647\n-2147483647");
  });

  // ---- Boolean edge cases ----
  it("boolean operators with chained conditions", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        a := true
        b := false
        c := true
        println(a && b || c)
        println(a && (b || c))
        println(!a || b)
        println(!(a || b))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // a&&b||c = false||true = true
    // a&&(b||c) = true&&true = true
    // !a||b = false||false = false
    // !(a||b) = !true = false
    expect(result.stdout.trim()).toBe("true\ntrue\nfalse\nfalse");
  });

  // ---- Result<T,E> all success path through try ----
  it("Result pipeline all success (no early return)", () => {
    const result = ctx.compileAndRun(`
      function add(a: int, b: int): Result<int, string> {
        return Success(a + b)
      }

      function compute(): Result<int, string> {
        try a := add(1, 2)
        try b := add(a, 3)
        try c := add(b, 4)
        return Success(c)
      }

      function main(): int {
        r := compute()
        out := case r {
          s: Success => s.value,
          _: Failure => -1
        }
        println(out)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10");
  });

  // ---- Shadowed variables across scopes ----
  it("variable shadowing across nested scopes", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        x := 1
        if true {
          x := 2
          if true {
            x := 3
            println(x)
          }
          println(x)
        }
        println(x)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("3\n2\n1");
  });

  // ---- Multiple return paths ----
  it("function with many conditional return paths", () => {
    const result = ctx.compileAndRun(`
      function classify(n: int): string {
        if n < 0 {
          return "negative"
        }
        if n == 0 {
          return "zero"
        }
        if n < 10 {
          return "small"
        }
        if n < 100 {
          return "medium"
        }
        return "large"
      }

      function main(): int {
        println(classify(-5))
        println(classify(0))
        println(classify(7))
        println(classify(42))
        println(classify(999))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("negative\nzero\nsmall\nmedium\nlarge");
  });

  // ---- Union type null coalescing ----
  it("null coalescing on nullable class instance", () => {
    const result = ctx.compileAndRun(`
      class Box {
        value: int
      }

      function maybeBox(n: int): Box | null {
        if n > 0 {
          return Box { value: n }
        }
        return null
      }

      function main(): int {
        b1 := maybeBox(5)
        b2 := maybeBox(-1)
        if b1 != null {
          println(b1!.value)
        }
        if b2 == null {
          println("null")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("5\nnull");
  });

  // ---- Recursive data structure traversal ----
  // BUG: same as self-referential class — auto-generated JSON constructor + member access
  it("recursive linked list traversal", () => {
    const result = ctx.compileAndRun(`
      class Node {
        value: int
        next: Node | null = null
      }

      function sumList(node: Node): int {
        let sum = node.value
        let current = node.next
        while current != null {
          sum += current!.value
          current = current!.next
        }
        return sum
      }

      function main(): int {
        list := Node { value: 1, next: Node { value: 2, next: Node { value: 3 } } }
        println(sumList(list))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("6");
  });

  // ---- Array as class field ----
  it("class with array field", () => {
    const result = ctx.compileAndRun(`
      class NumberList {
        items: int[]

        sum(): int {
          let total = 0
          for item of items {
            total += item
          }
          return total
        }
      }

      function main(): int {
        list := NumberList { items: [10, 20, 30] }
        println(list.sum())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("60");
  });

  // ---- For-of with inline range expressions ----
  it("for-of with computed range bounds", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        start := 2
        end := 4
        let sum = 0
        for i of start..end {
          sum += i
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // 2+3+4 = 9
    expect(result.stdout.trim()).toBe("9");
  });

  // ---- Type alias used in function signatures ----
  it("type alias used in function parameter and return", () => {
    const result = ctx.compileAndRun(`
      type ID = int

      function nextId(current: ID): ID => current + 1

      function main(): int {
        const id: ID = 100
        println(nextId(id))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("101");
  });

  // ---- If-expression in various contexts ----
  it("if-expression used in different contexts", () => {
    const result = ctx.compileAndRun(`
      function magnitude(n: int): int => if n < 0 then -n else n

      function main(): int {
        println(magnitude(-5))
        println(magnitude(3))
        msg := if true then "yes" else "no"
        println(msg)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("5\n3\nyes");
  });

  // ---- Nested if-expressions ----
  it("nested if-expressions", () => {
    const result = ctx.compileAndRun(`
      function sign(n: int): string {
        return if n > 0 then "positive" else if n < 0 then "negative" else "zero"
      }

      function main(): int {
        println(sign(5))
        println(sign(-3))
        println(sign(0))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("positive\nnegative\nzero");
  });
});

describe("e2e — loop-then clause", () => {

  it("while/then runs when condition is initially false", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let x = 0
        while x > 10 {
          println("loop")
          x += 1
        } then {
          println("completed")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("completed");
  });

  it("while/then runs after natural completion", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let x = 0
        while x < 3 {
          x += 1
        } then {
          println("completed")
        }
        println(x)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("completed\n3");
  });

  it("while/then skips then on break", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let x = 0
        while x < 5 {
          x += 1
          if x == 2 {
            break
          }
        } then {
          println("completed")
        }
        println(x)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("2");
  });

  // BUG: empty array [] with type annotation still emits std::vector<auto>{} (auto not allowed in templates)
  it("for-of/then runs for empty iterable", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const empty: int[] = []
        for x of empty {
          println("loop")
        } then {
          println("completed")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("completed");
  });

  it("for-of/then runs after iterating non-empty iterable", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const nums: int[] = [1, 2, 3]
        for x of nums {
          println(x)
        } then {
          println("completed")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("1\n2\n3\ncompleted");
  });

  it("labeled break suppresses outer then", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        const nums: int[] = [1, 2, 3]
        outer: for x of nums {
          for y of nums {
            println(x * 10 + y)
            break outer
          }
        } then {
          println("completed")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("11");
  });

  it("traditional for/then runs after natural completion", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        let sum = 0
        for let i = 0; i < 3; i += 1 {
          sum += i
        } then {
          println("completed")
        }
        println(sum)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("completed\n3");
  });
});

describe("e2e — multi-module feature combinations", () => {

  // BUG: case expression emits 'Status.Active' instead of 'Status::Active' for enum values
  it("multi-module with shared enum type", () => {
    const result = ctx.compileAndRunProject({
      "/types.do": `
        export enum Status { Active, Inactive, Pending }
      `,
      "/main.do": `
        import { Status } from "./types"

        function describe(s: Status): string => case s {
          Status.Active => "active",
          Status.Inactive => "inactive",
          Status.Pending => "pending"
        }

        function main(): int {
          println(describe(Status.Active))
          println(describe(Status.Pending))
          return 0
        }
      `,
    }, "/main.do");
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("active\npending");
  });

  // BUG: interface variant type references Square before it's declared (Square is in importing module)
  it("multi-module with interface spanning modules", () => {
    const result = ctx.compileAndRunProject({
      "/shape.do": `
        export interface Shape {
          area(): double
        }

        export class Circle {
          radius: double

          area(): double => 3.14159 * radius * radius
        }
      `,
      "/main.do": `
        import { Shape, Circle } from "./shape"

        class Square {
          side: double

          area(): double => side * side
        }

        function printArea(s: Shape) {
          println(s.area())
        }

        function main(): int {
          printArea(Circle { radius: 2.0 })
          printArea(Square { side: 3.0 })
          return 0
        }
      `,
    }, "/main.do");
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(parseFloat(lines[0])).toBeCloseTo(12.566, 2);
    expect(parseFloat(lines[1])).toBeCloseTo(9.0, 2);
  });

  // BUG: string + int concatenation doesn't emit std::to_string() wrapper
  it("multi-module with type alias from another module", () => {
    const mainSource = [
      'import { ID, Name } from "./types"',
      '',
      'function greet(id: ID, name: Name): string {',
      '  return "User " + id + ": " + name',
      '}',
      '',
      'function main(): int {',
      '  println(greet(42, "Alice"))',
      '  return 0',
      '}',
    ].join("\n");
    const result = ctx.compileAndRunProject({
      "/types.do": `
        export type ID = int
        export type Name = string
      `,
      "/main.do": mainSource,
    }, "/main.do");
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("User 42: Alice");
  });
});
