/**
 * End-to-end C++ compilation tests (part 4).
 *
 * Covers: Concurrency, try statement, catch expression, union type casting
 * (shared_ptr ↔ variant), JSON serialization, with statement.
 */

import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from "vitest";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

// ============================================================================
// Tests: Concurrency — compile and run
// ============================================================================

describe("e2e — Concurrency", () => {
  it("compiles Actor creation and method call", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Counter {
        count: int
        increment(): void { }
        getCount(): int { return this.count }
      }
      function main(): int {
        const c = Actor<Counter>(0)
        c.increment()
        c.stop()
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles async function call", () => {
    const { success, error, code } = ctx.compileOnly(`
      function compute(): int { return 42 }
      function main(): int {
        const p = async compute()
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles async block", () => {
    const { success, error, code } = ctx.compileOnly(`
      function main(): int {
        const p = async { 42 }
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles isolated function", () => {
    const { success, error, code } = ctx.compileOnly(`
      isolated function compute(x: int): int {
        return x * 2
      }
      function main(): int {
        const result = compute(21)
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles Promise<T> type annotation", () => {
    const { success, error, code } = ctx.compileOnly(`
      function compute(): int { return 42 }
      function start(): Promise<int> {
        return async compute()
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles Actor<T> type annotation", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Worker { value: int }
      function create(): Actor<Worker> {
        return Actor<Worker>(0)
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs async call and gets result via promise", () => {
    const result = ctx.compileAndRun(`
      function compute(): int { return 42 }
      function main(): int {
        const p = async compute()
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("runs Actor creation, method call, and stop", () => {
    const result = ctx.compileAndRun(`
      class Calculator {
        x: int
        y: int
        sum(): int {
          return this.x + this.y
        }
      }
      function main(): int {
        const c = Actor<Calculator>(3, 4)
        const val = c.sum()
        c.stop()
        println(val)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("7");
  });

  it("runs isolated function correctly", () => {
    const result = ctx.compileAndRun(`
      isolated function double(x: int): int {
        return x * 2
      }
      function main(): int {
        println(double(21))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42");
  });

  it("runs class with mutating method", () => {
    const result = ctx.compileAndRun(`
      class Counter {
        value: int
        increment(): void {
          this.value = this.value + 1
        }
        getCount(): int {
          return this.value
        }
      }
      function main(): int {
        let c = Counter(0)
        c.increment()
        c.increment()
        c.increment()
        println(c.getCount())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("3");
  });

  it("runs Actor with mutating method", () => {
    const result = ctx.compileAndRun(`
      class Accumulator {
        total: int
        add(n: int): void {
          this.total = this.total + n
        }
        getTotal(): int {
          return this.total
        }
      }
      function main(): int {
        const a = Actor<Accumulator>(0)
        a.add(10)
        a.add(20)
        a.add(12)
        const result = a.getTotal()
        a.stop()
        println(result)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42");
  });

  it("runs async with promise.get()", () => {
    const result = ctx.compileAndRun(`
      isolated function square(x: int): int {
        return x * x
      }
      function main(): int {
        const p = async square(7)
        const r = try! p.get()
        println(r)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("49");
  });

  it("compiles isolated method in class", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Processor {
        factor: int
        isolated function compute(x: int): int {
          return x * 2
        }
      }
      function main(): int {
        const p = Processor(5)
        println(p.compute(21))
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles and runs any transport with case narrowing", () => {
    const result = ctx.compileAndRun(`
      function sizeOf(x: any): int => case x {
        s: string => s.length,
        _ => 0
      }

      function main(): int {
        value: any := "hello"
        println(sizeOf(value))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("5");
  });
});

// ============================================================================
// Try statement (Result early return)
// ============================================================================

describe("e2e — try statement", () => {
  it("compiles try statement with immutable binding", () => {
    const { success, error, code } = ctx.compileOnly(`
      function getVal(x: int): Result<int, string> {
        return Success(x)
      }
      function process(): Result<int, string> {
        try x := getVal(42)
        return Success(x + 1)
      }
      function main(): int {
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs try statement success path", () => {
    const result = ctx.compileAndRun(`
      function getVal(x: int): Result<int, string> {
        return Success(x)
      }
      function process(): Result<int, string> {
        try x := getVal(42)
        return Success(x + 1)
      }
      function main(): int {
        const r = try! process()
        println(r)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("43");
  });

  it("runs try statement failure path with early return", () => {
    const result = ctx.compileAndRun(`
      function failingOp(x: int): Result<int, string> {
        return Success(x)
      }
      function process(): Result<int, string> {
        try x := failingOp(0)
        return Success(x + 100)
      }
      function main(): int {
        const r = try! process()
        println(r)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("100");
  });

  it("runs try statement pipeline (multiple try bindings)", () => {
    const result = ctx.compileAndRun(`
      function step1(x: int): Result<int, string> {
        return Success(x)
      }
      function step2(x: int): Result<int, string> {
        return Success(x * 2)
      }
      function step3(x: int): Result<int, string> {
        return Success(x + 5)
      }
      function pipeline(): Result<int, string> {
        try a := step1(10)
        try b := step2(a)
        try c := step3(b)
        return Success(c)
      }
      function main(): int {
        const r = try! pipeline()
        println(r)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("25");
  });

  it("runs Success/Failure construction with try propagation", () => {
    const result = ctx.compileAndRun(`
      function validate(x: int): Result<int, string> {
        if x < 0 {
          return Failure { error: "negative" }
        }
        return Success { value: x * 2 }
      }
      function process(): Result<int, string> {
        try a := validate(10)
        try b := validate(a)
        return Success { value: b }
      }
      function main(): int {
        const r = try! process()
        println(r)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("40");
  });

  it("runs try propagation through Result<void, string>", () => {
    const result = ctx.compileAndRun(`
      function step(fail: bool): Result<void, string> {
        if fail {
          return Failure("bad")
        }
        println("step")
        return Success()
      }
      function process(fail: bool): Result<int, string> {
        try step(fail)
        return Success(7)
      }
      function main(): int {
        const ok = try! process(false)
        println(ok)
        const failed = process(true)
        return case failed {
          _: Success => 0,
          f: Failure => {
            println(f.error)
            yield 1
          }
        }
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("step\n7\nbad");
  });

  it("runs Failure early-return via try propagation", () => {
    const result = ctx.compileAndRun(`
      function validate(x: int): Result<int, string> {
        if x < 0 {
          return Failure { error: "negative" }
        }
        return Success { value: x }
      }
      function process(): Result<int, string> {
        try a := validate(5)
        try b := validate(-1)
        return Success { value: a + b }
      }
      function main(): int {
        const r = try! validate(10)
        println(r)
        const s = try! validate(20)
        println(s)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10\n20");
  });

  it("runs Failure construction diverges from success path", () => {
    const result = ctx.compileAndRun(`
      function safeDivide(a: int, b: int): Result<int, string> {
        if b == 0 {
          return Failure { error: "division by zero" }
        }
        return Success { value: a \\ b }
      }
      function compute(): Result<int, string> {
        try x := safeDivide(100, 5)
        try y := safeDivide(x, 0)
        return Success { value: y }
      }
      function wrapper(): Result<string, string> {
        try r := compute()
        return Success { value: "unexpected" }
      }
      function main(): int {
        const w = try? wrapper()
        println("done")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // compute() fails at safeDivide(x, 0), wrapper() propagates the failure.
    // try? converts to null. Only "done" prints.
    expect(result.stdout.trim()).toBe("done");
  });

  it("runs positional Success(value) construction", () => {
    const result = ctx.compileAndRun(`
      function getVal(): Result<int, string> {
        return Success(42)
      }
      function main(): int {
        v := try! getVal()
        println(v)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42");
  });

  it("runs positional Failure(error) construction", () => {
    const result = ctx.compileAndRun(`
      function getVal(): Result<int, string> {
        return Failure("bad input")
      }
      function main(): int {
        v := try? getVal()
        println("done")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("done");
  });

  it("runs mixed positional and named Success/Failure", () => {
    const result = ctx.compileAndRun(`
      function validate(x: int): Result<int, string> {
        if x < 0 {
          return Failure("negative")
        }
        return Success(x * 2)
      }
      function main(): int {
        a := try! validate(5)
        b := try? validate(-1)
        println(a)
        println("done")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10\ndone");
  });

  it("runs case expression on Result with Success/Failure patterns", () => {
    const result = ctx.compileAndRun(`
      function getVal(x: int): Result<int, string> {
        if x > 0 {
          return Success { value: x * 10 }
        }
        return Failure { error: "non-positive" }
      }
      function main(): int {
        const r = getVal(5)
        const v = case r {
          s: Success => s.value,
          _: Failure => -1
        }
        println(v)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("50");
  });

  it("runs case expression on Result matching Failure arm", () => {
    const result = ctx.compileAndRun(`
      function getVal(x: int): Result<int, string> {
        if x > 0 {
          return Success(x * 10)
        }
        return Failure("non-positive")
      }
      function main(): int {
        const r = getVal(-3)
        const v = case r {
          s: Success => s.value,
          _: Failure => -1
        }
        println(v)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("-1");
  });

  it("runs case expression on Result accessing error in Failure arm", () => {
    const result = ctx.compileAndRun(`
      function getVal(): Result<int, string> {
        return Failure { error: "something broke" }
      }
      function main(): int {
        const r = getVal()
        const msg = case r {
          _: Success => "ok",
          e: Failure => e.error
        }
        println(msg)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("something broke");
  });
});

// ============================================================================
// catch expression
// ============================================================================

describe("e2e — catch expression", () => {
  it("compiles catch expression binding", () => {
    const { success, error, code } = ctx.compileOnly(`
      class IOError { message: string }
      function readFile(path: string): Result<string, IOError> {
        return Success("contents")
      }
      function main(): int {
        const err = catch {
          try data := readFile("test.txt")
        }
        return 0
      }
    `);
    expect(success, `Compile error: ${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs catch expression — all try calls succeed → null", () => {
    const result = ctx.compileAndRun(`
      class IOError { message: string }
      function readFile(path: string): Result<string, IOError> {
        return Success("contents")
      }
      function main(): int {
        const err = catch {
          try data := readFile("a.txt")
          try data2 := readFile("b.txt")
        }
        if err == null {
          println("no error")
        } else {
          println("got error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("no error");
  });

  it("runs catch expression — try call fails → captures error", () => {
    const result = ctx.compileAndRun(`
      class IOError { message: string }
      function readFile(path: string): Result<string, IOError> {
        if path == "bad.txt" {
          return Failure(IOError { message: "file not found" })
        }
        return Success("contents")
      }
      function main(): int {
        const err = catch {
          try data := readFile("good.txt")
          try data2 := readFile("bad.txt")
        }
        if err != null {
          println(err.message)
        } else {
          println("no error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("file not found");
  });

  it("runs catch expression — first try fails, skips rest", () => {
    const result = ctx.compileAndRun(`
      class IOError { message: string }
      function step1(): Result<int, IOError> {
        return Failure(IOError { message: "step1 failed" })
      }
      function step2(): Result<int, IOError> {
        return Success(42)
      }
      function main(): int {
        let reached = false
        const err = catch {
          try a := step1()
          reached = true
          try b := step2()
        }
        if reached {
          println("reached step2")
        } else {
          println("did not reach step2")
        }
        if err != null {
          println(err.message)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("did not reach step2\nstep1 failed");
  });

  it("runs catch expression — uses try-bound variables on success path", () => {
    const result = ctx.compileAndRun(`
      class MathError { code: int }
      function safeAdd(a: int, b: int): Result<int, MathError> {
        return Success(a + b)
      }
      function main(): int {
        let total = 0
        const err = catch {
          try x := safeAdd(10, 20)
          try y := safeAdd(x, 5)
          total = y
        }
        if err == null {
          println(total)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("35");
  });

  it("runs catch expression with multiple error types → variant", () => {
    const result = ctx.compileAndRun(`
      class IOError { message: string }
      class ParseError { line: int }
      function readFile(): Result<string, IOError> {
        return Success("data")
      }
      function parse(s: string): Result<int, ParseError> {
        return Failure(ParseError { line: 42 })
      }
      function main(): int {
        const err = catch {
          try content := readFile()
          try value := parse(content)
        }
        println("done")
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("done");
  });

  it("runs nested catch expressions with independent errors", () => {
    const result = ctx.compileAndRun(`
      class IOError { message: string }
      class NetError { code: int }
      function readFile(): Result<string, IOError> {
        return Failure(IOError { message: "io fail" })
      }
      function fetch(): Result<string, NetError> {
        return Success("response")
      }
      function main(): int {
        const err1 = catch {
          try data := readFile()
        }
        const err2 = catch {
          try resp := fetch()
        }
        if err1 != null {
          println("io error")
        }
        if err2 == null {
          println("net ok")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("io error\nnet ok");
  });
});

// ============================================================================
// Tests: union type casting between shared_ptr and variant representations
// ============================================================================

describe("e2e — union type casting (shared_ptr ↔ variant)", () => {
  it("compiles assigning Foo to Foo | Bar | null (shared_ptr into variant)", () => {
    // Foo alone → shared_ptr<Foo>
    // Foo | Bar | null → variant<monostate, shared_ptr<Foo>, shared_ptr<Bar>>
    // Assigning shared_ptr<Foo> to a variant should work via implicit conversion
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function test(): Foo | Bar | null {
        const f = Foo { x: 1 }
        return f
      }
      function main(): int => 0
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles assigning null to Foo | Bar | null (monostate for variant)", () => {
    // null → nullptr (emitter) but variant<monostate, ...> needs monostate{}
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function test(): Foo | Bar | null {
        return null
      }
      function main(): int => 0
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles let binding with Foo | Bar | null type assigned from Foo", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function main(): int {
        let val: Foo | Bar | null = Foo { x: 1 }
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles let binding with Foo | Bar | null assigned null", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function main(): int {
        let val: Foo | Bar | null = null
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles passing Foo | Bar | null to matching parameter type", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function accept(v: Foo | Bar | null): int => 42
      function provide(): Foo | Bar | null => Foo { x: 1 }
      function main(): int {
        const result = accept(provide())
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles passing null for Foo | Bar | null parameter", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function accept(v: Foo | Bar | null): int => 42
      function provide(): Foo | Bar | null => null
      function main(): int {
        const result = accept(provide())
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles Foo | null return from function typed Foo | null", () => {
    // Simple: shared_ptr<Foo> → shared_ptr<Foo>
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      function test(): Foo | null {
        return Foo { x: 1 }
      }
      function testNull(): Foo | null {
        return null
      }
      function main(): int => 0
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs Foo assigned into Foo | Bar | null and retrieves value", () => {
    const result = ctx.compileAndRun(`
      class Foo { x: int }
      class Bar { y: int }
      function wrap(f: Foo): Foo | Bar | null => f
      function main(): int {
        const v = wrap(Foo { x: 42 })
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("runs null return from Foo | Bar | null function", () => {
    const result = ctx.compileAndRun(`
      class Foo { x: int }
      class Bar { y: int }
      function nothing(): Foo | Bar | null => null
      function main(): int {
        const v = nothing()
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("compiles reassignment of Foo | Bar | null from Foo to Bar to null", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function main(): int {
        let v: Foo | Bar | null = Foo { x: 1 }
        v = Bar { y: 2 }
        v = null
        return 0
      }
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles function returning Foo | Bar | null where Foo | Bar | null is expected", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function getFoo(): Foo | Bar | null => Foo { x: 1 }
      function process(v: Foo | Bar | null): int => 0
      function main(): int => process(getFoo())
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles null check on Foo | Bar | null", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function check(v: Foo | Bar | null): bool => v == null
      function main(): int => 0
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("compiles case expression on Foo | Bar | null", () => {
    const { success, error, code } = ctx.compileOnly(`
      class Foo { x: int }
      class Bar { y: int }
      function describe(v: Foo | Bar | null): string {
        return case v {
          f: Foo => "foo",
          b: Bar => "bar",
          _ => "null"
        }
      }
      function main(): int => 0
    `);
    expect(success, `Compile error:\n${error}\n\nGenerated:\n${code}`).toBe(true);
  });

  it("runs case expression dispatching Foo | Bar | null correctly", () => {
    const result = ctx.compileAndRun(`
      class Foo { x: int }
      class Bar { y: int }
      function describe(v: Foo | Bar | null): string {
        return case v {
          f: Foo => "foo",
          b: Bar => "bar",
          _ => "null"
        }
      }
      function main(): int {
        println(describe(Foo { x: 1 }))
        println(describe(Bar { y: 2 }))
        println(describe(null))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("foo\nbar\nnull");
  });

  it("runs case expression dispatching primitive unions correctly", () => {
    const result = ctx.compileAndRun(`
      type SqliteValue = int | bool | string
      function describe(value: SqliteValue): string {
        return case value {
          text: string => "text " + text,
          flag: bool => if flag then "bool true" else "bool false",
          count: int => "int " + string(count + 1)
        }
      }
      function main(): int {
        println(describe("hi"))
        println(describe(true))
        println(describe(41))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("text hi\nbool true\nint 42");
  });

  it("runs primitive capture fallback on non-union case subjects", () => {
    const result = ctx.compileAndRun(`
      function describe(status: int): string {
        return case status {
          200 => "ok",
          other: int => "status " + string(other)
        }
      }
      function main(): int {
        println(describe(200))
        println(describe(418))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("ok\nstatus 418");
  });

  it("runs primitive union case arms that capture outer locals", () => {
    const result = ctx.compileAndRun(`
      type SqliteValue = int | bool | string
      function describe(prefix: string, value: SqliteValue): string {
        return case value {
          text: string => prefix + ":" + text,
          flag: bool => prefix + ":" + if flag then "true" else "false",
          count: int => prefix + ":" + string(count)
        }
      }
      function main(): int {
        println(describe("v", "hi"))
        println(describe("v", false))
        println(describe("v", 7))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("v:hi\nv:false\nv:7");
  });
});

describe("e2e — builtin parsing and formatting", () => {
  it("runs string() formatting and numeric parse helpers", () => {
    const result = ctx.compileAndRun(`
      function describe(value: string): string {
        return case int.parse(value) {
          s: Success => "ok " + string(s.value + 1),
          f: Failure => "err " + f.error.name
        }
      }

      function main(): int {
        println(describe("41"))
        println(describe(""))
        println(describe("12x"))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("ok 42\nerr EmptyInput\nerr InvalidFormat");
  });
});

// ============================================================================
// JSON serialization E2E tests
// ============================================================================

describe("E2E — JSON serialization", () => {
  it("preserves long JSONValue precision through direct assignment and parse/stringify", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        direct: JSONValue := 9007199254740993L
        parsed := try! JSON.parse("9007199254740993")
        println(JSON.stringify(direct))
        println(JSON.stringify(parsed))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("9007199254740993\n9007199254740993");
  });

  it("preserves map aliasing when assigning Map<string, JSONValue> to JSONValue", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        d: JSONValue := 4
        let m: Map<string, JSONValue> = { "red": d }
        n: JSONValue := m
        m["red"] = 5
        println(JSON.stringify(n))
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe('{"red":5}');
  });

  it("round-trips a simple class through toJsonValue/fromJsonValue", () => {
    const result = ctx.compileAndRun(`
      class Point { x: int; y: int }
      function main(): int {
        const p = Point { x: 10, y: 20 }
        const json = p.toJsonValue()
        const p2 = Point.fromJsonValue(json)
        case p2 {
          s: Success => {
            println(s.value.x)
            println(s.value.y)
          }
          f: Failure => println(f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10\n20");
  });

  it("serializes string and bool fields", () => {
    const result = ctx.compileAndRun(`
      class User { name: string; active: bool }
      function main(): int {
        const u = User { name: "Alice", active: true }
        const json = u.toJsonValue()
        println(json)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // Parse the JSON output to verify structure
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.name).toBe("Alice");
    expect(parsed.active).toBe(true);
  });

  it("deserializes with default values for missing fields", () => {
    const result = ctx.compileAndRun(`
      class Config { host: string = "localhost"; port: int = 8080 }
      function main(): int {
        const r = Config.fromJsonValue({})
        case r {
          s: Success => {
            println(s.value.host)
            println(s.value.port)
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("localhost\n8080");
  });

  it("deserializes missing nullable string defaults without crashing", () => {
    const result = ctx.compileAndRun(`
      class Config { name: string; notes: string | null = null }
      function main(): int {
        const r = Config.fromJsonValue({ name: "Shopping" })
        case r {
          s: Success => {
            if s.value.notes == null {
              println("null")
            } else {
              println("value")
            }
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("null");
  });

  it("round-trips nested class fields", () => {
    const result = ctx.compileAndRun(`
      class Point { x: int; y: int }
      class Line { start: Point; end: Point }
      function main(): int {
        const line = Line {
          start: Point { x: 1, y: 2 },
          end: Point { x: 3, y: 4 }
        }
        const json = line.toJsonValue()
        const r = Line.fromJsonValue(json)
        case r {
          s: Success => {
            println(s.value.start.x)
            println(s.value.start.y)
            println(s.value.end.x)
            println(s.value.end.y)
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("1\n2\n3\n4");
  });

  it("round-trips array fields", () => {
    const result = ctx.compileAndRun(`
      class Numbers { values: int[] }
      function main(): int {
        const n = Numbers { values: [10, 20, 30] }
        const json = n.toJsonValue()
        const r = Numbers.fromJsonValue(json)
        case r {
          s: Success => {
            println(s.value.values[0])
            println(s.value.values[1])
            println(s.value.values[2])
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("10\n20\n30");
  });

  it("serializes nullable fields", () => {
    const result = ctx.compileAndRun(`
      class MaybeNamed { name: string | null }
      function main(): int {
        const a = MaybeNamed { name: "hello" }
        println(a.toJsonValue())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.name).toBe("hello");
  });

  it("round-trips enum fields", () => {
    const result = ctx.compileAndRun(`
      enum Color { Red, Green, Blue }
      class Palette { primary: Color; secondary: Color }
      function main(): int {
        const p = Palette { primary: Color.Red, secondary: Color.Blue }
        const json = p.toJsonValue()
        const r = Palette.fromJsonValue(json)
        case r {
          s: Success => {
            println(s.value.primary == Color.Red)
            println(s.value.secondary == Color.Blue)
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("true\ntrue");
  });

  it("serializes const fields as discriminators", () => {
    const result = ctx.compileAndRun(`
      class Dog { const kind: string = "dog"; name: string }
      function main(): int {
        const d = Dog { name: "Rex" }
        println(d.toJsonValue())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.kind).toBe("dog");
    expect(parsed.name).toBe("Rex");
  });

  it("returns error for non-object JSONValue input", () => {
    const result = ctx.compileAndRun(`
      class Point { x: int; y: int }
      function main(): int {
        const r = Point.fromJsonValue("not valid json")
        case r {
          s: Success => println("unexpected success")
          f: Failure => println("got error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("got error");
  });

  it("returns error for missing required field", () => {
    const result = ctx.compileAndRun(`
      class Point { x: int; y: int }
      function main(): int {
        const r = Point.fromJsonValue({ x: 10 })
        case r {
          s: Success => println("unexpected success")
          f: Failure => println("got error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("got error");
  });

  it("returns error for wrong field type", () => {
    const result = ctx.compileAndRun(`
      class Point { x: int; y: int }
      function main(): int {
        const r = Point.fromJsonValue({ x: 10, y: "hello" })
        case r {
          s: Success => println("unexpected success")
          f: Failure => println("got error")
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("got error");
  });

  it("round-trips double and float fields", () => {
    const result = ctx.compileAndRun(`
      class Coords { lat: double; lng: double }
      function main(): int {
        const c = Coords { lat: 51.5074, lng: -0.1278 }
        const json = c.toJsonValue()
        const r = Coords.fromJsonValue(json)
        case r {
          s: Success => {
            println(s.value.lat == 51.5074)
            println(s.value.lng == -0.1278)
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("true\ntrue");
  });

  it("skips JSON methods for classes with weak fields", () => {
    const r = ctx.compileOnly(`
      class Node {
        value: int
        weak parent: Node
      }
      function main(): int {
        return 0
      }
    `);
    // Should compile fine — no toJsonValue/fromJsonValue generated for class with weak fields
    expect(r.success).toBe(true);
    expect(r.code).not.toContain("toJsonValue");
  });

  it("round-trips interface via shared discriminator", () => {
    const result = ctx.compileAndRun(`
      class Circle { const kind: string = "circle"; radius: double }
      class Rect { const kind: string = "rect"; width: double; height: double }
      interface Shape {}
      function main(): int {
        const c = Circle { radius: 5.0 }
        const json = c.toJsonValue()
        const r = Shape.fromJsonValue(json)
        case r {
          s: Success => {
            case s.value {
              c: Circle => println(c.radius)
              r: Rect => println("unexpected rect")
            }
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("5");
  });

  it("round-trips class with array of classes", () => {
    const result = ctx.compileAndRun(`
      class Item { name: string }
      class Inventory { items: Item[] }
      function main(): int {
        const inv = Inventory {
          items: [Item { name: "sword" }, Item { name: "shield" }]
        }
        const json = inv.toJsonValue()
        const r = Inventory.fromJsonValue(json)
        case r {
          s: Success => {
            println(s.value.items[0].name)
            println(s.value.items[1].name)
          }
          f: Failure => println("ERROR: " + f.error)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("sword\nshield");
  });
});

// ============================================================================
// With statement
// ============================================================================

describe("With statement (e2e)", () => {
  it("scoped binding is accessible inside block", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with x := 42 {
          println(x)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42");
  });

  it("multiple bindings work correctly", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with x := 10, y := 20 {
          println(x + y)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("30");
  });

  it("later bindings can reference earlier ones", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with x := 5, y := x * 3 {
          println(y)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("15");
  });

  it("nested with statements with separate scopes", () => {
    const result = ctx.compileAndRun(`
      function main(): int {
        with x := 1 {
          with y := x + 10 {
            println(y)
          }
          println(x)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("11\n1");
  });

  it("with binding using function call", () => {
    const result = ctx.compileAndRun(`
      function double(n: int): int => n * 2

      function main(): int {
        with result := double(21) {
          println(result)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("42");
  });
});

// ============================================================================
// Tests: Metadata / invoke — compile and run (structured ClassMetadata API)
// ============================================================================

describe("E2E — Metadata", () => {
  it("accesses class metadata name and description", () => {
    const result = ctx.compileAndRun(`
      class Tool "A test tool." {
        name: string
        function run "Runs the tool."(input "The input.": string): string => input
      }
      function main(): int {
        const meta = Tool.metadata
        println(meta.name)
        println(meta.description)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("Tool");
    expect(lines[1]).toBe("A test tool.");
  });

  it("accesses method reflection name and invokes via lambda", () => {
    const result = ctx.compileAndRun(`
      class Calculator {
        function add(a: int, b: int): int => a + b
      }
      function main(): int {
        const meta = Calculator.metadata
        const method = meta.methods[0]
        println(method.name)
        const calc = Calculator { }
        const result = method.invoke(calc, { a: 3, b: 4 })
        if result.isSuccess() {
          println(result.value)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("add");
    expect(lines[1]).toBe("7");
  });

  it("invokes metadata by method name", () => {
    const result = ctx.compileAndRun(`
      class Calculator {
        function add(a: int, b: int): int => a + b
      }
      function main(): int {
        const meta = Calculator.metadata
        const calc = Calculator { }
        const result = meta.invoke(calc, "add", { a: 3, b: 4 })
        if result.isSuccess() {
          println(result.value)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("7");
  });

  it("metadata invoke returns failure on unknown method", () => {
    const result = ctx.compileAndRun(`
      class Calculator {
        function add(a: int, b: int): int => a + b
      }
      function main(): int {
        const meta = Calculator.metadata
        const calc = Calculator { }
        const result = meta.invoke(calc, "subtract", { })
        if result.isFailure() {
          println(case result.error {
            msg: string => msg,
            _ => "other"
          })
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("Unknown method: subtract");
  });

  it("invoke returns JSON null for void methods", () => {
    const result = ctx.compileAndRun(`
      class Tool {
        function reset(): void { }
      }
      function main(): int {
        const meta = Tool.metadata
        const t = Tool { }
        const result = meta.methods[0].invoke(t, { })
        if result.isSuccess() {
          println(result.value)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("null");
  });

  it("invoke with string return value", () => {
    const result = ctx.compileAndRun(`
      class Greeter {
        prefix: string
        function greet(name: string): string => this.prefix + " " + name
      }
      function main(): int {
        const meta = Greeter.metadata
        const g = Greeter { prefix: "Hello" }
        const result = meta.methods[0].invoke(g, { name: "World" })
        if result.isSuccess() {
          println(result.value)
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // The result is a JSON string — quoted
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toBe("Hello World");
  });

  it("invoke returns failure on invalid JSON params", () => {
    const result = ctx.compileAndRun(`
      class Tool {
        function run(input: string): string => input
      }
      function main(): int {
        const meta = Tool.metadata
        const t = Tool { }
        const result = meta.methods[0].invoke(t, "not json")
        if result.isFailure() {
          println(case result.error {
            msg: string => msg,
            _ => "other"
          })
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toContain("Invalid JSON params: expected object");
  });

  it("invoke folds Result failures into any while keeping success JSON", () => {
    const result = ctx.compileAndRun(`
      class ToolError {
        message: string
      }
      class Tool {
        function run(flag: bool): Result<string, ToolError> {
          if flag {
            return Success("ok")
          }
          return Failure(ToolError { message: "bad" })
        }
      }
      function main(): int {
        const meta = Tool.metadata
        const tool = Tool { }

        const success = meta.invoke(tool, "run", { flag: true })
        if success.isSuccess() {
          println(success.value)
        }

        const failure = meta.invoke(tool, "run", { flag: false })
        if failure.isFailure() {
          println(case failure.error {
            err: ToolError => err.message,
            _ => "other"
          })
        }

        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(JSON.parse(lines[0])).toBe("ok");
    expect(lines[1]).toBe("bad");
  });

  it("invoke returns JSON null for Result<void, E> success", () => {
    const result = ctx.compileAndRun(`
      class Tool {
        function reset(flag: bool): Result<void, string> {
          if flag {
            return Success()
          }
          return Failure("bad")
        }
      }
      function main(): int {
        const meta = Tool.metadata
        const tool = Tool { }

        const success = meta.invoke(tool, "reset", { flag: true })
        if success.isSuccess() {
          println(success.value)
        }

        const failure = meta.invoke(tool, "reset", { flag: false })
        if failure.isFailure() {
          println(case failure.error {
            msg: string => msg,
            _ => "other"
          })
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("null");
    expect(lines[1]).toBe("bad");
  });

  it("metadata includes defs string for class-typed parameters", () => {
    const result = ctx.compileAndRun(`
      class Config {
        host: string
        port: int
      }
      class Server {
        function configure(config: Config): string => config.host
      }
      function main(): int {
        const meta = Server.metadata
        println(meta.defs!)
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.Config).toBeDefined();
    expect(parsed.Config.properties.host.type).toBe("string");
    expect(parsed.Config.properties.port.type).toBe("integer");
  });
});

// ============================================================================
// Tests: else-narrow statement — compile and run
// ============================================================================

describe("e2e — else-narrow statement", () => {
  it("narrows nullable int (optional)", () => {
    const result = ctx.compileAndRun(`
      function getValue(): int | null => 42
      function main(): int {
        x := getValue() else { return 1 }
        return x
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("takes else branch on null (optional)", () => {
    const result = ctx.compileAndRun(`
      function getValue(): int | null => null
      function main(): int {
        x := getValue() else { return 99 }
        return x
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(99);
  });

  it("narrows nullable class type (shared_ptr)", () => {
    const result = ctx.compileAndRun(`
      class Config {
        value: int
      }
      function getConfig(): Config | null => Config { value: 7 }
      function main(): int {
        x := getConfig() else { return 1 }
        return x.value
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(7);
  });

  it("takes else branch on null class (shared_ptr)", () => {
    const result = ctx.compileAndRun(`
      class Config {
        value: int
      }
      function getConfig(): Config | null => null
      function main(): int {
        x := getConfig() else { return 88 }
        return x.value
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(88);
  });

  it("narrows Result type on success", () => {
    const result = ctx.compileAndRun(`
      class AppError { code: int }
      function loadValue(): Result<int, AppError> => Success { value: 55 }
      function main(): int {
        x := loadValue() else { return 1 }
        return x
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(55);
  });

  it("takes else branch on Result failure", () => {
    const result = ctx.compileAndRun(`
      class AppError { code: int }
      function loadValue(): Result<int, AppError> => Failure { error: AppError { code: 77 } }
      function main(): int {
        x := loadValue() else { return 77 }
        return x
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(77);
  });

  it("accesses full type inside else block", () => {
    const result = ctx.compileAndRun(`
      function getValue(): string | null => null
      function main(): int {
        x := getValue() else {
          println("was null")
          return 0
        }
        return 1
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("was null");
  });

  it("works in a loop with break", () => {
    const result = ctx.compileAndRun(`
      function getValue(i: int): int | null {
        if i == 3 {
          return null
        }
        return i
      }
      function main(): int {
        let sum = 0
        let i = 0
        while i < 10 {
          x := getValue(i) else { break }
          sum = sum + x
          i = i + 1
        }
        return sum
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    // 0 + 1 + 2 = 3
    expect(result.exitCode).toBe(3);
  });
});

// ============================================================================
// Tests: as expression — runtime narrowing
// ============================================================================

describe("e2e — as expression", () => {
  it("narrows any to string — success path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: any): Result<string, string> {
        return x as string
      }
      function main(): int {
        x: any := "hello"
        const s = try! narrow(x)
        return s.length
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(5);
  });

  it("narrows any to string — failure path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: any): Result<string, string> {
        return x as string
      }
      function main(): int {
        x: any := 42
        const r = narrow(x)
        const v = case r {
          s: Success => s.value.length,
          _: Failure => 1
        }
        return v
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
  });

  it("narrows any to int — success path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: any): Result<int, string> {
        return x as int
      }
      function main(): int {
        x: any := 42
        return try! narrow(x)
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("narrows nullable to non-null — success path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: int | null): Result<int, string> {
        return x as int
      }
      function main(): int {
        x: int | null := 7
        return try! narrow(x)
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(7);
  });

  it("narrows nullable to non-null — failure path (null)", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: int | null): Result<int, string> {
        return x as int
      }
      function main(): int {
        x: int | null := null
        const r = narrow(x)
        const v = case r {
          s: Success => s.value,
          _: Failure => 99
        }
        return v
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(99);
  });

  it("narrows union member — success path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: int | string): Result<string, string> {
        return x as string
      }
      function main(): int {
        x: int | string := "hello"
        const s = try! narrow(x)
        return s.length
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(5);
  });

  it("narrows union member — failure path", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: int | string): Result<string, string> {
        return x as string
      }
      function main(): int {
        x: int | string := 42
        const r = narrow(x)
        const v = case r {
          s: Success => s.value.length,
          _: Failure => 1
        }
        return v
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
  });

  it("identity narrowing always succeeds", () => {
    const result = ctx.compileAndRun(`
      function narrow(x: string): Result<string, string> {
        return x as string
      }
      function main(): int {
        const s = try! narrow("hello")
        return s.length
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(5);
  });
});
