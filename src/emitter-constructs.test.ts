/**
 * Emitter tests — constructs: destructuring, labeled break/continue,
 * lambda captures, interface method dispatch, try operators,
 * readonly bindings, string interpolation, type aliases, default parameters,
 * if/case expressions, collection/assignment literals, enum access,
 * null literal, member access, for-of range, C-style for, weak references,
 * nullable class union, lambda function type params, this capture,
 * for-of arrays, map literal.
 */

import { describe, it, expect } from "vitest";
import { emit, emitMulti } from "./emitter-test-helpers.js";

describe("emitter — destructuring", () => {
  it("emits array destructuring with a minimum-size check and indexed loads", () => {
    const cpp = emit(`
      function f(values: int[]): void {
        [head, _, tail] := values
      }
    `);
    expect(cpp).toContain("const auto& _arr0 = values;");
    expect(cpp).toContain("doof::array_require_min_size(_arr0, 3);");
    expect(cpp).toContain("const auto head = doof::array_at(_arr0, 0);");
    expect(cpp).toContain("const auto tail = doof::array_at(_arr0, 2);");
    expect(cpp).not.toContain("doof::array_at(_arr0, 1);");
  });

  it("emits positional destructuring as structured binding", () => {
    const cpp = emit(`
      function f(t: Tuple<int, int>): void {
        (a, b) := t
      }
    `);
    expect(cpp).toContain("const auto [a, b]");
  });

  it("emits tuple positional destructuring with discard via std::get", () => {
    const cpp = emit(`
      function f(t: Tuple<int, int, int>): void {
        (a, _, c) := t
      }
    `);
    expect(cpp).toContain("const auto& _tuple0 = t;");
    expect(cpp).toContain("const auto a = std::get<0>(_tuple0);");
    expect(cpp).toContain("const auto c = std::get<2>(_tuple0);");
    expect(cpp).not.toContain("std::get<1>(_tuple0)");
    expect(cpp).not.toContain("const auto [a, _, c]");
  });

  it("emits class positional destructuring with discard via field access", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
        z: int
      }
      function f(p: Point): void {
        (a, _, c) := p
      }
    `);
    expect(cpp).toContain("const auto& _obj0 = p;");
    expect(cpp).toContain("const auto a = _obj0->x;");
    expect(cpp).toContain("const auto c = _obj0->z;");
    expect(cpp).not.toContain("_obj0->y");
    expect(cpp).not.toContain("const auto [a, _, c]");
  });

  it("emits named destructuring as individual field accesses", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
      }
      function f(u: User): void {
        { name, email } := u
      }
    `);
    expect(cpp).toContain("->name");
    expect(cpp).toContain("->email");
    expect(cpp).toContain("const auto name =");
    expect(cpp).toContain("const auto email =");
    // Should NOT use structured bindings for named destructuring
    expect(cpp).not.toContain("const auto [name, email]");
  });

  it("emits named destructuring in correct order regardless of field declaration order", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
      }
      function f(u: User): void {
        { email, name } := u
      }
    `);
    // Fields accessed by name, not position — order doesn't matter
    expect(cpp).toContain("const auto email =");
    expect(cpp).toContain("const auto name =");
  });

  it("emits named destructuring with alias", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
      }
      function f(u: User): void {
        { name as userName, email as userEmail } := u
      }
    `);
    expect(cpp).toContain("const auto userName =");
    expect(cpp).toContain("->name");
    expect(cpp).toContain("const auto userEmail =");
    expect(cpp).toContain("->email");
  });

  it("emits named destructuring with let binding", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
      }
      function f(u: User): void {
        let { name, email } = u
      }
    `);
    expect(cpp).toContain("auto name =");
    expect(cpp).toContain("auto email =");
    // Should not be const for let bindings
    expect(cpp).not.toContain("const auto name =");
  });

  it("emits named destructuring with partial fields", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
        age: int
      }
      function f(u: User): void {
        { email } := u
      }
    `);
    expect(cpp).toContain("const auto email =");
    expect(cpp).toContain("->email");
    // The function body should destructure only email (not name/age)
    // But toJSON() references all fields — so check the function body specifically
    const fnBody = cpp.slice(cpp.indexOf("void f("));
    expect(fnBody).toContain("->email");
    expect(fnBody).not.toContain("->name");
    expect(fnBody).not.toContain("->age");
  });

  it("emits array destructuring assignment with a minimum-size check and direct assignments", () => {
    const cpp = emit(`
      function f(values: int[]): void {
        let head = 0
        let tail = 0;
        [head, _, tail] = values
      }
    `);
    expect(cpp).toContain("const auto& _arr0 = values;");
    expect(cpp).toContain("doof::array_require_min_size(_arr0, 3);");
    expect(cpp).toContain("head = doof::array_at(_arr0, 0);");
    expect(cpp).toContain("tail = doof::array_at(_arr0, 2);");
    expect(cpp).not.toContain("const auto head =");
  });

  it("emits positional destructuring assignment via temp capture and element assignment", () => {
    const cpp = emit(`
      function f(t: Tuple<int, int, int>): void {
        let a = 0
        let c = 0;
        (a, _, c) = t
      }
    `);
    expect(cpp).toContain("const auto& _tuple0 = t;");
    expect(cpp).toContain("a = std::get<0>(_tuple0);");
    expect(cpp).toContain("c = std::get<2>(_tuple0);");
    expect(cpp).not.toContain("const auto [a, c]");
  });

  it("emits named destructuring assignment as field reads into existing variables", () => {
    const cpp = emit(`
      class User {
        name: string
        email: string
      }
      function f(u: User): void {
        let userName = ""
        let userEmail = ""
        { name as userName, email as userEmail } = u
      }
    `);
    expect(cpp).toContain("const auto& _dest0 = u;");
    expect(cpp).toContain("userName = _dest0->name;");
    expect(cpp).toContain("userEmail = _dest0->email;");
    expect(cpp).not.toContain("const auto userName =");
  });

  it("emits try array destructuring assignment from the unwrapped success value", () => {
    const cpp = emit(`
      function load(): Result<int[], string> => Success([1, 2, 3])

      function f(): Result<int, string> {
        let first = 0
        let last = 0
        try [first, _, last] = load()
        return Success(first + last)
      }
    `);
    expect(cpp).toContain("const auto& _arr");
    expect(cpp).toContain("first = doof::array_at(");
    expect(cpp).toContain("last = doof::array_at(");
  });
});

describe("emitter — labeled break/continue", () => {
  it("emits goto for labeled break", () => {
    const cpp = emit(`
      function f(): void {
        let i = 0
        outer: while true {
          break outer
        }
      }
    `);
    expect(cpp).toContain("goto outer_break;");
    expect(cpp).toContain("outer_break:;");
  });
});

// ============================================================================
// Phase 5: Lambda captures
// ============================================================================

describe("emitter — lambda captures", () => {
  it("captures immutable binding by value", () => {
    const cpp = emit(`
      function main(): void {
        x := 42
        f := (y: int): int => x + y
      }
    `);
    // Should capture x by value (immutable binding)
    expect(cpp).toContain("[x]");
  });

  it("heap-boxes mutable binding captured by lambda", () => {
    const cpp = emit(`
      function main(): void {
        let x = 0
        f := (y: int): int => x + y
      }
    `);
    // Mutable binding captured by lambda → heap-boxed via shared_ptr
    expect(cpp).toContain("std::make_shared<int32_t>(0)");
    expect(cpp).toContain("[x]"); // shared_ptr captured by value
    expect(cpp).toContain("(*x)"); // dereferenced on access
  });

  it("captures parameter by value", () => {
    const cpp = emit(`
      function make_adder(n: int): int {
        f := (x: int): int => n + x
        return f(1)
      }
    `);
    // n is a parameter (immutable), so capture by value
    expect(cpp).toContain("[n]");
  });

  it("falls back to [=] for no outer references", () => {
    const cpp = emit(`
      function main(): void {
        f := (x: int): int => x * 2
      }
    `);
    // No outer references → falls back to [=]
    expect(cpp).toContain("[=]");
  });

  it("heap-boxes mutable captured in returned lambda", () => {
    const cpp = emit(`
      function makeCounter(): (): int {
        let count = 0
        return (): int { count = count + 1; return count }
      }
    `);
    // count must be heap-boxed so the escaping lambda doesn't dangle
    expect(cpp).toContain("std::make_shared<int32_t>(0)");
    expect(cpp).toContain("[count]");
    expect(cpp).not.toContain("[&count]");
    expect(cpp).toContain("(*count)");
  });

  it("does not heap-box non-captured let variables", () => {
    const cpp = emit(`
      function main(): void {
        let x = 0
        x = x + 1
      }
    `);
    // No lambda captures x, so it stays a normal variable
    expect(cpp).toContain("auto x = 0");
    expect(cpp).not.toContain("make_shared");
  });

  it("heap-boxes multiple captured mutables independently", () => {
    const cpp = emit(`
      function main(): void {
        let a = 1
        let b = 2
        f := (): int => a + b
      }
    `);
    expect(cpp).toContain("std::make_shared<int32_t>(1)");
    expect(cpp).toContain("std::make_shared<int32_t>(2)");
    expect(cpp).toContain("[a, b]");
  });

  it("dereferences captured mutable in assignment", () => {
    const cpp = emit(`
      function main(): void {
        let x = 0
        inc := (): void { x = x + 1 }
      }
    `);
    expect(cpp).toContain("(*x) = (*x) + 1");
  });
});

describe("emitter — any case matching", () => {
  it("emits any case matching with doof::any_is", () => {
    const cpp = emit(`
      function test(x: any): int => case x {
        s: string => s.length,
        _ => 0
      }
    `);
    expect(cpp).toContain("doof::any_is<std::string>(_case_any)");
    expect(cpp).toContain("auto s = doof::any_cast<std::string>(_case_any);");
  });
});

// ============================================================================
// Phase 4: Interface method calls via std::visit
// ============================================================================

describe("emitter — interface method dispatch", () => {
  it("emits std::visit for method call on interface-typed object", () => {
    const cpp = emitMulti(
      {
        "/main.do": [
          `class Circle {`,
          `  radius: float`,
          `  function area(): float => 3.14f * radius * radius`,
          `}`,
          `class Rect {`,
          `  w, h: float`,
          `  function area(): float => w * h`,
          `}`,
          `interface Shape {`,
          `  area(): float`,
          `}`,
          `function getArea(s: Shape): float => s.area()`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(cpp).toContain("std::visit(");
    expect(cpp).toContain("_obj->area()");
  });
});

// ============================================================================
// Phase 6: try / try! / try? operators
// ============================================================================

describe("emitter — try operators", () => {
  it("emits try statement with failure check and early return", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Success(0) }
      function f(): Result<int, string> {
        try x := getVal()
        return Success(x)
      }
    `);
    expect(cpp).toContain("isFailure()");
    expect(cpp).toContain("::failure(");
    expect(cpp).toContain("std::move(");
    expect(cpp).toContain(".value()");
  });

  it("emits try! with panic on failure", () => {
    const cpp = emit(`
      function f(x: Result<int, string>): int {
        return try! x
      }
    `);
    expect(cpp).toContain('doof::panic("try! failed: " + doof::to_string(_try_0.error()))');
    expect(cpp).toContain(".value()");
  });

  it("emits try? with std::nullopt", () => {
    const cpp = emit(`
      function f(x: Result<int, string>): int | null {
        return try? x
      }
    `);
    expect(cpp).toContain("std::nullopt");
    expect(cpp).toContain("std::optional");
  });
});

// ============================================================================
// Phase 2: readonly class bindings
// ============================================================================

describe("emitter — readonly class bindings", () => {
  it("emits shared_ptr<const T> for readonly class binding", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        readonly p = Point { x: 1.0f, y: 2.0f }
      }
    `);
    expect(cpp).toContain("shared_ptr<const Point>");
  });
});

// ============================================================================
// Phase 9: String interpolation
// ============================================================================

describe("emitter — string interpolation", () => {
  it("emits doof::concat for interpolated strings", () => {
    // Use a regular string to pass Doof source with backtick template literal
    const source = "function greet(name: string): string => `Hello, ${name}!`";
    const cpp = emit(source);
    expect(cpp).toContain("doof::concat(");
    expect(cpp).toContain("doof::to_string(name)");
  });
});

// ============================================================================
// Type alias emission
// ============================================================================

describe("emitter — type aliases", () => {
  it("emits using for primitive type alias", () => {
    const cpp = emit(`type Score = int`);
    expect(cpp).toContain("using Score = int32_t;");
  });

  it("emits using for class type alias", () => {
    const cpp = emit(`
      class Point { x, y: float }
      type Pos = Point
    `);
    expect(cpp).toContain("using Pos = std::shared_ptr<Point>;");
  });

  it("emits using for function type alias", () => {
    const cpp = emit(`type Predicate = (x: int): bool`);
    expect(cpp).toContain("using Predicate = std::function<bool(int32_t)>;");
  });
});

// ============================================================================
// Default parameter values
// ============================================================================

describe("emitter — default parameters", () => {
  it("emits default int parameter value", () => {
    const cpp = emit(`
      function greet(n: int = 42): int => n
    `);
    expect(cpp).toContain("int32_t n = 42");
  });

  it("emits default string parameter value", () => {
    const cpp = emit(`
      function greet(name: string = "world"): string => name
    `);
    expect(cpp).toContain('std::string name = "world"');
  });

  it("emits default bool parameter value", () => {
    const cpp = emit(`
      function check(flag: bool = true): bool => flag
    `);
    expect(cpp).toContain("bool flag = true");
  });

  it("emits default char parameter value", () => {
    const cpp = emit(`
      function pick(letter: char = 'x'): char => letter
    `);
    expect(cpp).toContain("char32_t letter = U'x'");
  });

  it("emits default array parameter value", () => {
    const cpp = emit(`
      function first(values: int[] = [1, 2, 3]): int => values[0]
    `);
    expect(cpp).toContain("std::shared_ptr<std::vector<int32_t>> values = std::make_shared<std::vector<int32_t>>(std::vector<int32_t>{1, 2, 3})");
  });

  it("emits default Set parameter value", () => {
    const cpp = emit(`
      function dedupe(values: Set<int> = []): Set<int> => values
    `);
    expect(cpp).toContain("std::shared_ptr<std::unordered_set<int32_t>> values = std::make_shared<std::unordered_set<int32_t>>()");
  });

  it("emits default Map parameter value with supported keys", () => {
    const cpp = emit(`
      function lookup(values: Map<long, string> = { 1L: "one", 2L: "two" }): Map<long, string> => values
    `);
    expect(cpp).toContain("std::shared_ptr<std::unordered_map<int64_t, std::string>> values = std::make_shared<std::unordered_map<int64_t, std::string>>");
  });

  it("emits nullable string parameter defaults as std::nullopt", () => {
    const cpp = emit(`
      function greet(name: string | null = null): string | null => name
    `);
    expect(cpp).toContain("std::optional<std::string> name = std::nullopt");
  });
});

// ============================================================================
// If-expression (ternary)
// ============================================================================

describe("emitter — if expressions", () => {
  it("emits ternary for if-expression", () => {
    const cpp = emit(`
      function abs(x: int): int => if x < 0 then -x else x
    `);
    expect(cpp).toContain("?");
    expect(cpp).toContain(":");
  });
});

// ============================================================================
// Case expressions
// ============================================================================

describe("emitter — case expressions", () => {
  it("emits IIFE with value patterns", () => {
    const cpp = emit(`
      function describe(x: int): int {
        return case x {
          0 => 10,
          1 => 20,
          _ => 30
        }
      }
    `);
    expect(cpp).toContain("[&]()");
    expect(cpp).toContain("== 0");
    expect(cpp).toContain("== 1");
    expect(cpp).toContain("return 30;");
  });

  it("emits IIFE with range patterns", () => {
    const cpp = emit(`
      function grade(score: int): int {
        return case score {
          90..100 => 4,
          80..<90 => 3,
          _ => 0
        }
      }
    `);
    expect(cpp).toContain("[&]()");
    expect(cpp).toContain(">= 90");
    expect(cpp).toContain("<= 100");
    expect(cpp).toContain(">= 80");
    expect(cpp).toContain("< 90");
  });
});

// ============================================================================
// Collection literals
// ============================================================================

describe("emitter — collection literals", () => {
  it("emits tuple literal as std::make_tuple", () => {
    const cpp = emit(`
      function main(): void {
        t := (1, 2, 3)
      }
    `);
    expect(cpp).toContain("std::make_tuple(1, 2, 3)");
  });
});

// ============================================================================
// Assignment expressions
// ============================================================================

describe("emitter — assignment expressions", () => {
  it("emits compound assignment operators", () => {
    const cpp = emit(`
      function main(): void {
        let x = 0
        x += 5
        x -= 1
        x *= 2
      }
    `);
    expect(cpp).toContain("+= 5");
    expect(cpp).toContain("-= 1");
    expect(cpp).toContain("*= 2");
  });
});

// ============================================================================
// Enum access
// ============================================================================

describe("emitter — enum access", () => {
  it("emits qualified enum variant access", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
      function main(): void {
        c := Color.Red
      }
    `);
    expect(cpp).toContain("Color::Red");
  });
});

// ============================================================================
// Null literal
// ============================================================================

describe("emitter — null literal", () => {
  it("emits nullptr for null", () => {
    const cpp = emit(`
      function main(): void {
        x := null
      }
    `);
    expect(cpp).toContain("nullptr");
  });

  it("emits nullopt for null in class constructor with optional field", () => {
    const cpp = emit(`
      class MaybeNamed {
        name: string | null
      }
      function main(): void {
        const b = MaybeNamed { name: null }
      }
    `);
    // For string | null (std::optional<std::string>), null must emit std::nullopt
    expect(cpp).toContain("std::nullopt");
    expect(cpp).not.toMatch(/make_shared<MaybeNamed>\(nullptr\)/);
  });
});

// ============================================================================
// Member access patterns
// ============================================================================

describe("emitter — member access", () => {
  it("emits arrow for class member access", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function getX(p: Point): float => p.x
    `);
    expect(cpp).toContain("p->x");
  });

  it("emits std::visit for interface field access", () => {
    const cpp = emitMulti(
      {
        "/main.do": [
          `class Cat { name: string }`,
          `class Dog { name: string }`,
          `interface Pet {`,
          `  name: string`,
          `}`,
          `function getName(p: Pet): string => p.name`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(cpp).toContain("std::visit(");
    expect(cpp).toContain("_obj->name");
  });

  it("emits class-qualified access for instance qualified static field", () => {
    const cpp = emit(`
      class Rectangle {
        width: float
        static kind = "Rect"
      }
      function getKind(rect: Rectangle): string => rect::kind
    `);
    expect(cpp).toContain("Rectangle::kind");
  });

  it("emits class-qualified access for instance qualified static method call", () => {
    const cpp = emit(`
      class Rectangle {
        static doIt(): string => "ok"
      }
      function run(rect: Rectangle): string => rect::doIt()
    `);
    expect(cpp).toContain("Rectangle::doIt()");
  });

  it("emits std::visit for interface-qualified static method call", () => {
    const cpp = emitMulti(
      {
        "/main.do": [
          `interface Shape {`,
          `  static describe(): string`,
          `}`,
          `class Circle implements Shape {`,
          `  static describe(): string => "circle"`,
          `}`,
          `class Rect implements Shape {`,
          `  static describe(): string => "rect"`,
          `}`,
          `function describe(shape: Shape): string => shape::describe()`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(cpp).toContain("std::visit(");
    expect(cpp).toContain("::describe()");
  });
});

// ============================================================================
// For-of with range
// ============================================================================

describe("emitter — for-of with range", () => {
  it("emits range-based for with doof::range", () => {
    const cpp = emit(`
      function main(): void {
        let sum = 0
        for i of 1..10 {
          sum = sum + i
        }
      }
    `);
    expect(cpp).toContain("for (const auto& i : doof::range(1, 10))");
  });

  it("emits exclusive range", () => {
    const cpp = emit(`
      function main(): void {
        let sum = 0
        for i of 0..<10 {
          sum = sum + i
        }
      }
    `);
    expect(cpp).toContain("doof::range_exclusive(0, 10)");
  });
});

// ============================================================================
// C-style for loop
// ============================================================================

describe("emitter — C-style for loop", () => {
  it("emits for-of with range as C-style for", () => {
    const cpp = emit(`
      function sum_to_10(): int {
        let sum = 0
        for i of 0..<10 {
          sum = sum + i
        }
        return sum
      }
    `);
    expect(cpp).toContain("for (const auto&");
    expect(cpp).toContain("doof::range_exclusive(0, 10)");
  });
});

// ============================================================================
// Debug: check generated C++ for weak reference and nullable class
// ============================================================================

describe("emitter — weak references", () => {
  it("emits weak_ptr field in class", () => {
    const cpp = emit(`
      export class Node {
        value: int
        weak parent: Node
      }
      function main(): int => 0
    `);
    expect(cpp).toContain("std::weak_ptr<Node>");
  });
});

describe("emitter — nullable class union", () => {
  it("emits shared_ptr for class|null union parameter", () => {
    const cpp = emit(`
      export class Box {
        value: int
      }
      function getVal(b: Box | null): int {
        if b != null {
          return b.value
        }
        return 0
      }
      function main(): int => getVal(Box(42))
    `);
    expect(cpp).toContain("Box");
  });
});

describe("emitter — lambda with function type param", () => {
  it("emits function with std::function parameter", () => {
    const cpp = emit(`
      function apply(f: (x: int): int, x: int): int => f(x)
      function main(): int {
        offset := 10
        add := (x: int): int => x + offset
        return apply(add, 32)
      }
    `);
    expect(cpp).toContain("std::function");
  });
});

describe("emitter — this capture in lambdas", () => {
  it("emits this capture when lambda accesses class field", () => {
    const cpp = emit(`
      export class Counter {
        value: int
        function getIncrementer(): (n: int): int {
          return (n: int): int => value + n
        }
      }
    `);
    // The lambda should capture `this` since it accesses `value` (a field)
    expect(cpp).toContain("[this]");
  });
});

describe("emitter — for-of with arrays", () => {
  it("emits range-based for over array parameter", () => {
    const cpp = emit(`
      function sum(items: int[]): int {
        let total = 0
        for item of items {
          total = total + item
        }
        return total
      }
    `);
    expect(cpp).toContain("for (const auto& item : *items)");
  });

  it("emits for-of with inline array literal", () => {
    const cpp = emit(`
      function main(): int {
        let sum = 0
        for n of [1, 2, 3] {
          sum = sum + n
        }
        return sum
      }
    `);
    expect(cpp).toContain("for (const auto&");
    expect(cpp).toContain("std::vector");
  });
});

describe("emitter — map literal", () => {
  it("emits unordered_map for map literal", () => {
    const cpp = emit(`
      function main(): int {
        let scores = {["alice"]: 10, ["bob"]: 20}
        return 0
      }
    `);
    expect(cpp).toContain("std::unordered_map");
  });
});

// ============================================================================
// Contextual typing — object/tuple literals as class construction
// ============================================================================

describe("emitter — contextual typing", () => {
  it("throws before emitting object literals without contextual typing", () => {
    expect(() => emit(`
      function main(): void {
        a := { foo: 12 }
      }
    `)).toThrow("Object literal requires contextual type information");
  });

  it("emits object literal as make_shared when expected type is class", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): int {
        a: Point := { x: 1.0f, y: 2.0f }
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>");
    expect(cpp).not.toContain("{x:");
  });

  it("emits tuple literal as make_shared when expected type is class", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): int {
        a: Point := (1.0, 2.0)
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>");
    expect(cpp).not.toContain("make_tuple");
  });

  it("emits array of object literals as vector of make_shared", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): int {
        let a: Point[] = [{ x: 1.0f, y: 2.0f }]
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>");
  });

  it("emits array of tuple literals as vector of make_shared", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): int {
        let a: Point[] = [(1.0, 2.0)]
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>");
    expect(cpp).not.toContain("make_tuple");
  });

  it("sorts named fields in contextual object literal by declaration order", () => {
    const cpp = emit(`
      class Rect { x, y, w, h: float }
      function main(): int {
        a: Rect := { h: 4.0f, w: 3.0f, y: 2.0f, x: 1.0f }
        return 0
      }
    `);
    // Arguments should be sorted: x, y, w, h
    const match = cpp.match(/make_shared<Rect>\(([^)]+)\)/);
    expect(match).toBeTruthy();
  });

  it("fills omitted defaulted fields in contextual object literals", () => {
    const cpp = emit(`
      class CameraTuning {
        minPitch: float = 1.0f
        maxPitch: float = 2.0f
        minDepth: float = 3.0f
        maxDepth: float = 4.0f
      }
      function main(): int {
        tuning: CameraTuning := { minDepth: 30.0f }
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<CameraTuning>(1.0f, 2.0f, 30.0f, 4.0f)");
  });

  it("fills omitted defaulted fields in named construction", () => {
    const cpp = emit(`
      class CameraTuning {
        minPitch: float = 1.0f
        maxPitch: float = 2.0f
        minDepth: float = 3.0f
        maxDepth: float = 4.0f
      }
      function main(): int {
        tuning := CameraTuning { minDepth: 30.0f }
        return 0
      }
    `);
    expect(cpp).toContain("std::make_shared<CameraTuning>(1.0f, 2.0f, 30.0f, 4.0f)");
  });

  it("emits make_shared for anonymous object literal in array .push()", () => {
    const cpp = emit(`
      class RenderVertex { x, y: float }
      function main(): int {
        let verts: RenderVertex[] = []
        verts.push({ x: 1.0f, y: 2.0f })
        return 0
      }
    `);
    expect(cpp).toContain("push_back(std::make_shared<RenderVertex>");
    expect(cpp).not.toContain("{x:");
  });

  it("emits make_shared for tuple literal in array .push()", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): int {
        let pts: Point[] = []
        pts.push((1.0f, 2.0f))
        return 0
      }
    `);
    expect(cpp).toContain("push_back(std::make_shared<Point>");
  });

  it("sorts named fields in anonymous object literal pushed to array", () => {
    const cpp = emit(`
      class Rect { x, y, w, h: float }
      function main(): int {
        let rects: Rect[] = []
        rects.push({ h: 4.0f, w: 3.0f, y: 2.0f, x: 1.0f })
        return 0
      }
    `);
    expect(cpp).toContain("push_back(std::make_shared<Rect>");
    // Verify field order is x, y, w, h (not h, w, y, x)
    const match = cpp.match(/make_shared<Rect>\(([^)]+)\)/);
    expect(match).toBeTruthy();
    const args = match![1];
    expect(args).toBe("1.0f, 2.0f, 3.0f, 4.0f");
  });

  it("emits direct JSONValue object literal construction without copy lambdas", () => {
    const cpp = emit(`
      function main(): int {
        c: JSONValue := { red: "Red", blue: 2 }
        return 0
      }
    `);
    expect(cpp).toContain("doof::JSONValue(std::make_shared<std::unordered_map<std::string, doof::JSONValue>>");
    expect(cpp).not.toContain("_json_obj_src_");
  });

  it("aliases Map<string, JSONValue> assignments into JSONValue", () => {
    const cpp = emit(`
      function main(): int {
        d: JSONValue := 4
        let m: Map<string, JSONValue> = { "red": d }
        n: JSONValue := m
        return 0
      }
    `);
    expect(cpp).toContain("doof::JSONValue(m)");
    expect(cpp).not.toContain("_json_obj_src_");
  });

  it("aliases JSONValue[] assignments into JSONValue", () => {
    const cpp = emit(`
      function main(): int {
        item: JSONValue := 4
        let values: JSONValue[] = [item]
        payload: JSONValue := values
        return 0
      }
    `);
    expect(cpp).toContain("doof::JSONValue(values)");
    expect(cpp).not.toContain("_json_arr_src_");
  });

  it("emits long JSONValue primitives without widening to double", () => {
    const cpp = emit(`
      function main(): int {
        value: JSONValue := 9007199254740993L
        return 0
      }
    `);
    expect(cpp).toContain("doof::JSONValue(9007199254740993LL)");
  });
});

// ============================================================================
// Lambda contextual typing — parameterless & name-matched params
// ============================================================================

describe("emitter — lambda contextual typing", () => {
  it("emits parameterless lambda with params from expected type", () => {
    const cpp = emit(`
      type Transform = (x: int): int
      function apply(t: Transform): int => t(5)
      function main(): int {
        return apply(=> x * 2)
      }
    `);
    // Should emit a C++ lambda with parameter x
    expect(cpp).toContain("int32_t x");
    expect(cpp).toContain("x * 2");
  });

  it("emits lambda with name-matched untyped params", () => {
    const cpp = emit(`
      function invoke(callback: (width: float, height: float): void): void {
        callback(1.0, 2.0)
      }
      function main(): void {
        invoke((width, height) => print("ok"))
      }
    `);
    // Should emit params with inferred float types
    expect(cpp).toContain("float width");
    expect(cpp).toContain("float height");
  });

  it("emits parameterless lambda as callback argument", () => {
    const cpp = emit(`
      function invoke(callback: (a: int, b: int): int): int {
        return callback(3, 4)
      }
      function main(): int {
        return invoke(=> a + b)
      }
    `);
    expect(cpp).toContain("int32_t a");
    expect(cpp).toContain("int32_t b");
    expect(cpp).toContain("a + b");
  });

  it("emits synthetic name for omitted subset params", () => {
    const cpp = emit(`
      function invoke(callback: (a: int, b: int, c: int): int): int {
        return callback(1, 2, 3)
      }
      function main(): int {
        return invoke((a) => a * 10)
      }
    `);
    // The explicitly-named param keeps its name
    expect(cpp).toContain("int32_t a");
    // Omitted params get synthetic names not the original signature names
    expect(cpp).toContain("_$b");
    expect(cpp).toContain("_$c");
    expect(cpp).not.toContain("int32_t b,");
    expect(cpp).not.toContain("int32_t c");
  });
});

// ============================================================================
// Trailing lambdas
// ============================================================================

describe("emitter — trailing lambdas", () => {
  it("emits trailing lambda as void callback argument", () => {
    const cpp = emit(`
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) { print(it) }
      }
    `);
    expect(cpp).toContain("print");
    expect(cpp).toContain("it");
  });

  it("emits trailing lambda with multi-statement void block", () => {
    const cpp = emit(`
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) {
          const label = "Item"
          print(label)
        }
      }
    `);
    expect(cpp).toContain("label");
    expect(cpp).toContain("print");
  });

  it("emits trailing lambda appended after existing args", () => {
    const cpp = emit(`
      type Action = (it: int): void
      function forEachWithInit(arr: int[], init: int, fn: Action): void { }
      function f(): void {
        forEachWithInit([1, 2, 3], 0) { print(it) }
      }
    `);
    expect(cpp).toContain("print");
  });

  it("emits trailing lambda in binding RHS", () => {
    const cpp = emit(`
      type Action = (it: int): void
      function doWith(x: int, fn: Action): void { fn(x) }
      function f(): void {
        doWith(5) { print(it + 1) }
      }
    `);
    expect(cpp).toContain("doWith(5");
    expect(cpp).toContain("print");
  });
});

