/**
 * Emitter tests — basics: primitive types, declarations, functions,
 * expressions, control flow, classes, enums, interfaces, for-of,
 * includes, runtime header, type mapping, union type mapping.
 */

import { describe, it, expect } from "vitest";
import { emit, emitMulti } from "./emitter-test-helpers.js";
import { emitType } from "./emitter-types.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import type { ResolvedType } from "./checker-types.js";

// ============================================================================
// Phase 1: Primitives & Basic Constructs
// ============================================================================

describe("emitter — primitive types", () => {
  it("maps byte to uint8_t", () => {
    const t: ResolvedType = { kind: "primitive", name: "byte" };
    expect(emitType(t)).toBe("uint8_t");
  });

  it("maps int to int32_t", () => {
    const t: ResolvedType = { kind: "primitive", name: "int" };
    expect(emitType(t)).toBe("int32_t");
  });

  it("maps long to int64_t", () => {
    const t: ResolvedType = { kind: "primitive", name: "long" };
    expect(emitType(t)).toBe("int64_t");
  });

  it("maps float to float", () => {
    const t: ResolvedType = { kind: "primitive", name: "float" };
    expect(emitType(t)).toBe("float");
  });

  it("maps double to double", () => {
    const t: ResolvedType = { kind: "primitive", name: "double" };
    expect(emitType(t)).toBe("double");
  });

  it("maps string to std::string", () => {
    const t: ResolvedType = { kind: "primitive", name: "string" };
    expect(emitType(t)).toBe("std::string");
  });

  it("maps char to char32_t", () => {
    const t: ResolvedType = { kind: "primitive", name: "char" };
    expect(emitType(t)).toBe("char32_t");
  });

  it("maps bool to bool", () => {
    const t: ResolvedType = { kind: "primitive", name: "bool" };
    expect(emitType(t)).toBe("bool");
  });

  it("maps void to void", () => {
    const t: ResolvedType = { kind: "void" };
    expect(emitType(t)).toBe("void");
  });

  it("throws on unknown types", () => {
    const t: ResolvedType = { kind: "unknown" };
    expect(() => emitType(t)).toThrow("Cannot emit unresolved unknown type");
  });
});

describe("emitter — const declarations", () => {
  it("emits constexpr for literal int", () => {
    const cpp = emit(`const X = 42`);
    expect(cpp).toContain("constexpr auto X = 42;");
  });

  it("emits constexpr for literal float", () => {
    const cpp = emit(`const PI = 3.14`);
    expect(cpp).toContain("constexpr auto PI = 3.14");
  });

  it("emits constexpr for literal bool", () => {
    const cpp = emit(`const DEBUG = true`);
    expect(cpp).toContain("constexpr auto DEBUG = true;");
  });

  it("emits constexpr for literal string", () => {
    const cpp = emit(`const NAME = "hello"`);
    expect(cpp).toContain('constexpr auto NAME = std::string("hello");');
  });
});

describe("emitter — readonly declarations", () => {
  it("emits const auto for readonly", () => {
    const cpp = emit(`readonly X = 42`);
    expect(cpp).toContain("const auto X = 42;");
  });
});

describe("emitter — immutable bindings (:=)", () => {
  it("emits const auto for immutable binding", () => {
    const cpp = emit(`
      function main(): void {
        x := 42
      }
    `);
    expect(cpp).toContain("const auto x = 42;");
  });

  it("emits union-array literals using function parameter element types", () => {
    const cpp = emit(`
      type SqliteValue = int | bool | string

      function record(values: SqliteValue[]): void {
      }

      function main(): void {
        record(["task", true])
      }
    `);

    expect(cpp).toContain("record(std::make_shared<std::vector<std::variant<int32_t, bool, std::string>>>(std::vector<std::variant<int32_t, bool, std::string>>{");
  });
});

describe("emitter — let declarations", () => {
  it("emits auto for let", () => {
    const cpp = emit(`
      function main(): void {
        let x = 42
      }
    `);
    expect(cpp).toContain("auto x = 42;");
  });

  it("preserves explicit local types", () => {
    const cpp = emit(`
      function main(): void {
        let t0: float = 1
        let t1: float = t0 / 24.0f
      }
    `);
    expect(cpp).toContain("float t0 = 1;");
    expect(cpp).toContain("float t1 = t0 / 24.0f;");
  });
});

describe("emitter — functions", () => {
  it("emits function with int parameters and return", () => {
    const cpp = emit(`function add(a: int, b: int): int => a + b`);
    expect(cpp).toContain("int32_t add(int32_t a, int32_t b)");
    expect(cpp).toContain("return a + b;");
  });

  it("emits void function", () => {
    const cpp = emit(`
      function greet(name: string): void {
      }
    `);
    expect(cpp).toContain("void greet(std::string name)");
  });

  it("emits function with block body", () => {
    const cpp = emit(`
      function max(a: int, b: int): int {
        if a > b {
          return a
        }
        return b
      }
    `);
    expect(cpp).toContain("int32_t max(int32_t a, int32_t b)");
    expect(cpp).toContain("if (a > b)");
    expect(cpp).toContain("return a;");
    expect(cpp).toContain("return b;");
  });

  it("emits expression-bodied function with return wrapper", () => {
    const cpp = emit(`function square(x: int): int => x * x`);
    expect(cpp).toContain("return x * x;");
  });

  it("wraps inferred-void top-level main in a valid C++ entrypoint", () => {
    const cpp = emit(`
      function main() {
        println("Hello world")
      }
    `);

    expect(cpp).toContain("void doof_main()");
    expect(cpp).toContain("int main(int argc, char** argv)");
    expect(cpp).toContain("doof_main();");
    expect(cpp).toContain("return 0;");
    expect(cpp).not.toContain("void main()");
  });
});

describe("emitter — expressions", () => {
  it("emits integer literals", () => {
    const cpp = emit(`const X = 42`);
    expect(cpp).toContain("42");
  });

  it("emits float literals with f suffix", () => {
    const cpp = emit(`const X = 3.14f`);
    expect(cpp).toContain("3.14f");
  });

  it("emits boolean literals", () => {
    const cpp = emit(`const A = true`);
    expect(cpp).toContain("true");
  });

  it("emits string literals", () => {
    const cpp = emit(`const S = "hello world"`);
    expect(cpp).toContain('"hello world"');
  });

  it("emits binary expressions with parentheses", () => {
    const cpp = emit(`function f(a: int, b: int): int => a + b * 2`);
    expect(cpp).toContain("return a + b * 2;");
  });

  it("emits unary negation", () => {
    const cpp = emit(`function f(x: int): int => -x`);
    expect(cpp).toContain("return -x;");
  });

  it("emits power operator as std::pow", () => {
    const cpp = emit(`function f(x: double, y: double): double => x ** y`);
    expect(cpp).toContain("std::pow(x, y)");
  });

  it("emits comparison operators", () => {
    const cpp = emit(`function f(a: int, b: int): bool => a >= b`);
    expect(cpp).toContain("return a >= b;");
  });

  it("emits logical operators", () => {
    const cpp = emit(`function f(a: bool, b: bool): bool => a && b`);
    expect(cpp).toContain("return a && b;");
  });

  it("emits integer division operator as C++ /", () => {
    const cpp = emit(`function f(a: int, b: int): int => a \\ b`);
    expect(cpp).toContain("return a / b;");
  });

  it("emits numeric cast to static_cast", () => {
    const cpp = emit(`function f(x: int): float => float(x)`);
    expect(cpp).toContain("return static_cast<float>(x);");
  });

  it("emits double cast to static_cast<double>", () => {
    const cpp = emit(`function f(x: int): double => double(x)`);
    expect(cpp).toContain("return static_cast<double>(x);");
  });

  it("emits int cast to static_cast<int32_t>", () => {
    const cpp = emit(`function f(x: double): int => int(x)`);
    expect(cpp).toContain("return static_cast<int32_t>(x);");
  });

  it("emits long cast to static_cast<int64_t>", () => {
    const cpp = emit(`function f(x: int): long => long(x)`);
    expect(cpp).toContain("return static_cast<int64_t>(x);");
  });

  it("emits byte cast to static_cast<uint8_t>", () => {
    const cpp = emit(`function f(x: int): byte => byte(x)`);
    expect(cpp).toContain("return static_cast<uint8_t>(x);");
  });

  it("emits numeric cast in division expression", () => {
    const cpp = emit(`function f(a: int, b: int): float => float(a) / float(b)`);
    expect(cpp).toContain("static_cast<float>(a) / static_cast<float>(b)");
  });

  it("does not emit a user-defined function named double as a cast", () => {
    const cpp = emit(`
      function double(x: int): int => x * 2
      function f(): int => double(21)
    `);
    expect(cpp).toContain("return double_(21);");
    expect(cpp).not.toContain("static_cast<double>(21)");
  });

  it("emits string() as doof::to_string", () => {
    const cpp = emit(`function f(x: int): string => string(x)`);
    expect(cpp).toContain("return doof::to_string(x);");
  });

  it("emits int.parse as doof::parse_int", () => {
    const cpp = emit(`function f(): Result<int, ParseError> => int.parse("42")`);
    expect(cpp).toContain("return doof::parse_int(std::string(\"42\"));");
  });

  it("emits byte.parse as doof::parse_byte", () => {
    const cpp = emit(`function f(): Result<byte, ParseError> => byte.parse("255")`);
    expect(cpp).toContain("return doof::parse_byte(std::string(\"255\"));");
  });
});

describe("emitter — control flow", () => {
  it("emits if statement", () => {
    const cpp = emit(`
      function f(x: int): int {
        if x > 0 {
          return x
        }
        return 0
      }
    `);
    expect(cpp).toContain("if (x > 0)");
    expect(cpp).toContain("return x;");
    expect(cpp).toContain("return 0;");
  });

  it("emits comparison conditions without double parentheses", () => {
    const cpp = emit(`
      function f(x: int): int {
        let current = x
        if x == 0 {
          return 1
        }
        while current != 0 {
          current = current - 1
        }
        return current
      }
    `);
    expect(cpp).toContain("if (x == 0) {");
    expect(cpp).toContain("while (current != 0) {");
    expect(cpp).not.toContain("if ((x == 0)) {");
    expect(cpp).not.toContain("while ((x != 0)) {");
  });

  it("preserves grouping when lower-precedence child needs parentheses", () => {
    const cpp = emit(`function f(a: int, b: int, c: int): int => (a + b) * c`);
    expect(cpp).toContain("return (a + b) * c;");
  });

  it("preserves right-side grouping for same-precedence binary operators", () => {
    const cpp = emit(`function f(a: int, b: int, c: int): int => a - (b - c)`);
    expect(cpp).toContain("return a - (b - c);");
  });

  it("preserves unary operand grouping when needed", () => {
    const cpp = emit(`function f(a: int, b: int): int => -(a + b)`);
    expect(cpp).toContain("return -(a + b);");
  });

  it("emits if/else if/else", () => {
    const cpp = emit(`
      function classify(x: int): string {
        if x > 0 {
          return "positive"
        } else if x < 0 {
          return "negative"
        } else {
          return "zero"
        }
      }
    `);
    expect(cpp).toContain("if (x > 0)");
    expect(cpp).toContain("else if (x < 0)");
    expect(cpp).toContain("else");
  });

  it("emits while loop", () => {
    const cpp = emit(`
      function countdown(n: int): void {
        let i = n
        while i > 0 {
          i = i - 1
        }
      }
    `);
    expect(cpp).toContain("while (i > 0)");
  });

  it("emits for-of loop", () => {
    const cpp = emit(`
      function sum(items: int[]): int {
        let s = 0
        for x of items {
          s = s + x
        }
        return s
      }
    `);
    expect(cpp).toContain("for (const auto& x : *items)");
  });

  it("emits return statement", () => {
    const cpp = emit(`
      function f(): int {
        return 42
      }
    `);
    expect(cpp).toContain("return 42;");
  });

  it("emits break and continue", () => {
    const cpp = emit(`
      function f(): void {
        let i = 0
        while true {
          if i > 10 {
            break
          }
          i = i + 1
          continue
        }
      }
    `);
    expect(cpp).toContain("break;");
    expect(cpp).toContain("continue;");
  });

  it("emits statement-level case without an IIFE", () => {
    const cpp = emit(`
      function f(): int {
        case 1 {
          1 => { return 42 }
          _ => { return 0 }
        }
      }
    `);
    expect(cpp).toContain("if (_case_subject_");
    expect(cpp).toContain("return 42;");
    expect(cpp).not.toContain("[&]() ->");
  });

  it("emits continue inside statement-level case arms directly", () => {
    const cpp = emit(`
      function f(): int {
        let i = 0
        while i < 2 {
          case i {
            0 => {
              i = i + 1
              continue
            }
            _ => { break }
          }
        }
        return i
      }
    `);
    expect(cpp).toContain("continue;");
    expect(cpp).toContain("break;");
    expect(cpp).not.toContain("[&]() ->");
  });

  it("emits yield inside case-expression blocks as branch returns", () => {
    const cpp = emit(`
      function f(x: int): string {
        return case x {
          0 => {
            yield "zero"
          },
          _ => {
            yield "other"
          }
        }
      }
    `);
    expect(cpp).not.toContain("unhandled statement: yield-statement");
    expect(cpp).toContain("return");
  });

  it("emits <- declaration blocks as IIFEs", () => {
    const cpp = emit(`
      function f(flag: bool): int {
        let x: int <- {
          if flag {
            yield 10
          }
          yield 5
        }
        return x
      }
    `);
    expect(cpp).toContain("[&]() -> int32_t {");
    expect(cpp).toContain("return 10;");
    expect(cpp).toContain("return 5;");
  });

  it("emits <- reassignment through an IIFE result", () => {
    const cpp = emit(`
      function f(): int {
        let x = 1
        x <- {
          yield x + 1
        }
        return x
      }
    `);
    expect(cpp).toContain("x = [&]() -> int32_t {");
    expect(cpp).toContain("return x + 1;");
  });
});

describe("emitter — classes", () => {
  it("emits struct with fields and enable_shared_from_this", () => {
    const cpp = emit(`
      class Point {
        x, y: float
      }
    `);
    expect(cpp).toContain("struct Point : public std::enable_shared_from_this<Point>");
    expect(cpp).toContain("float x;");
    expect(cpp).toContain("float y;");
  });

  it("emits constructor from fields", () => {
    const cpp = emit(`
      class Point {
        x, y: float
      }
    `);
    expect(cpp).toContain("Point(float x, float y)");
    expect(cpp).toContain(": x(x), y(y) {}");
  });

  it("emits nested class defaults in constructor parameters", () => {
    const cpp = emit(`
      class CardSprite {
        textureId: int = -1
      }

      class CardDefinition {
        id: string = ""
        front: CardSprite = {}
        back: CardSprite = {}
      }
    `);
    expect(cpp).toContain("std::shared_ptr<CardSprite> front = std::make_shared<CardSprite>(-1)");
    expect(cpp).toContain("std::shared_ptr<CardSprite> back = std::make_shared<CardSprite>(-1)");
    expect(cpp).not.toContain("/* complex default */");
  });

  it("emits methods", () => {
    const cpp = emit(`
      class Circle {
        radius: float
        function area(): float => 3.14159f * radius * radius
      }
    `);
    expect(cpp).toContain("float area() {");
    // 3.14159 parses as a double literal — verify it appears in output
    expect(cpp).toContain("3.14159");
  });

  it("emits static methods as real C++ statics", () => {
    const cpp = emit(`
      class MathUtils {
        static max(a: int, b: int): int => if a > b then a else b
      }
    `);
    expect(cpp).toContain("static int32_t max(int32_t a, int32_t b)");
  });

  it("emits static fields outside the constructor surface", () => {
    const cpp = emit(`
      class Rectangle {
        width: float
        static kind = "Rect"
      }
    `);
    expect(cpp).toContain('static inline std::string kind = std::string("Rect")');
    expect(cpp).toContain("Rectangle(float width)");
    expect(cpp).not.toContain("Rectangle(std::string kind");
  });

  it("emits class field Set defaults from empty array syntax", () => {
    const cpp = emit(`
      class Point {
        x, y: float
      }
      class Rectangle {
        origin: Point
        width, height: float
        colours: Set<int> = []
      }
    `);
    expect(cpp).toContain("std::shared_ptr<doof::ordered_set<int32_t>> colours = std::make_shared<doof::ordered_set<int32_t>>()");
    expect(cpp).toContain("std::shared_ptr<doof::ordered_set<int32_t>> colours = std::make_shared<doof::ordered_set<int32_t>>()");
  });

  it("emits const fields as instance const members", () => {
    const cpp = emit(`
      class Circle {
        radius: float
        const kind = "circle"
      }
    `);
    expect(cpp).toContain("const std::string kind = std::string(\"circle\")");
    expect(cpp).toContain("Circle(float radius)");
    expect(cpp).not.toContain("static inline const std::string kind");
    expect(cpp).toContain('"circle"');
  });

  it("emits construction with make_shared", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        p := Point { x: 1.0f, y: 2.0f }
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>");
  });

  it("emits named constructor args in declaration order", () => {
    const cpp = emit(`
      class Rect { x, y, w, h: float }
      function main(): void {
        r := Rect { h: 4.0f, x: 1.0f, w: 3.0f, y: 2.0f }
      }
    `);
    // Args should be reordered to match declaration: x, y, w, h
    expect(cpp).toContain("std::make_shared<Rect>(1.0f, 2.0f, 3.0f, 4.0f)");
  });

  it("emits shorthand property in named construction", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        y := 2.0f
        p := Point { x, y }
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>(x, y)");
  });

  it("emits mixed shorthand and explicit properties in named construction", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        p := Point { x, y: 2.0f }
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>(x, 2.0f)");
  });

  it("emits shorthand property in contextual object literal", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        y := 2.0f
        p: Point := { x, y }
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>(x, y)");
  });

  it("emits shorthand in array push with contextual class type", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function main(): void {
        let points: Point[] = []
        x := 1.0f
        y := 2.0f
        points.push({ x, y })
      }
    `);
    expect(cpp).toContain("std::make_shared<Point>(x, y)");
  });

  it("emits member access with arrow operator", () => {
    const cpp = emit(`
      class Point { x, y: float }
      function getX(p: Point): float => p.x
    `);
    expect(cpp).toContain("p->x");
  });

  it("emits destructor", () => {
    const cpp = emit(`
      class Resource {
        name: string
        destructor {
        }
      }
    `);
    expect(cpp).toContain("~Resource()");
  });
});

describe("emitter — enums", () => {
  it("emits enum class", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
    `);
    expect(cpp).toContain("enum class Color");
    expect(cpp).toContain("Red");
    expect(cpp).toContain("Green");
    expect(cpp).toContain("Blue");
  });

  it("emits name helper function", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
    `);
    expect(cpp).toContain("Color_name(Color _v)");
    expect(cpp).toContain('case Color::Red: return "Red"');
  });

  it("emits fromName helper function", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
    `);
    expect(cpp).toContain("std::optional<Color> Color_fromName(std::string_view _s)");
    expect(cpp).toContain('if (_s == "Red") return Color::Red;');
    expect(cpp).toContain('if (_s == "Blue") return Color::Blue;');
    expect(cpp).toContain("return std::nullopt;");
  });

  it("emits ostream operator for enum printing", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
    `);
    expect(cpp).toContain("inline std::ostream& operator<<(std::ostream& _os, Color _v)");
    expect(cpp).toContain("return _os << Color_name(_v);");
  });

  it("emits contextually typed dot shorthand as scoped enum variants", () => {
    const cpp = emit(`
      enum Suit { Spades, Hearts, Diamonds, Clubs }
      function main(): void {
        let suits: Suit[] = [.Spades, .Hearts, .Diamonds, .Clubs]
      }
    `);
    expect(cpp).toContain("std::shared_ptr<std::vector<Suit>> suits");
    expect(cpp).toContain("std::vector<Suit>{Suit::Spades, Suit::Hearts, Suit::Diamonds, Suit::Clubs}");
  });
});

describe("emitter — interfaces as variant", () => {
  it("emits using alias for interface with implementors", () => {
    const cpp = emitMulti(
      {
        "/main.do": [
          `class Circle {`,
          `  radius: float`,
          `  function area(): float => 3.14f * radius * radius`,
          `}`,
          `class Rectangle {`,
          `  width, height: float`,
          `  function area(): float => width * height`,
          `}`,
          `interface Shape {`,
          `  area(): float`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(cpp).toContain("using Shape = std::variant<");
    expect(cpp).toContain("std::shared_ptr<Circle>");
    expect(cpp).toContain("std::shared_ptr<Rectangle>");
  });

  it("emits forward declarations when interface precedes classes", () => {
    const cpp = emit([
      `interface Shape {`,
      `  area(): float`,
      `}`,
      `class Circle {`,
      `  radius: float`,
      `  function area(): float => 3.14f * radius * radius`,
      `}`,
      `class Rectangle {`,
      `  width, height: float`,
      `  function area(): float => width * height`,
      `}`,
    ].join("\n"));
    // Forward declarations must appear before the using alias
    const fwdCircle = cpp.indexOf("struct Circle;");
    const fwdRect = cpp.indexOf("struct Rectangle;");
    const alias = cpp.indexOf("using Shape = std::variant<");
    expect(fwdCircle).toBeGreaterThan(-1);
    expect(fwdRect).toBeGreaterThan(-1);
    expect(alias).toBeGreaterThan(-1);
    expect(fwdCircle).toBeLessThan(alias);
    expect(fwdRect).toBeLessThan(alias);
  });

  it("throws when interface has no implementors", () => {
    expect(() => emit(`
      interface Shape {
        area(): float
      }
    `)).toThrow('Cannot emit interface "Shape" without implementing classes');
  });
});

describe("emitter — for-of loops", () => {
  it("emits range-based for", () => {
    const cpp = emit(`
      function sum(items: int[]): int {
        let s = 0
        for x of items {
          s = s + x
        }
        return s
      }
    `);
    expect(cpp).toContain("for (const auto& x : *items)");
  });

  it("emits stream aliases and next() dispatch", () => {
    const cpp = emit(`
      class Counter implements Stream<int> {
        current: int
        end: int

        next(): int | null {
          if this.current < this.end {
            value := this.current
            this.current = this.current + 1
            return value
          }
          return null
        }
      }

      function readOnce(stream: Stream<int>): int | null {
        return stream.next()
      }
    `);

    expect(cpp).toContain("using __doof_stream_int = std::variant<std::shared_ptr<Counter>>;");
    expect(cpp).toContain("__doof_stream_next___doof_stream_int(stream)");
  });

  it("lowers for-of over streams to next-driven loops", () => {
    const cpp = emit(`
      class Counter implements Stream<int> {
        current: int
        end: int

        next(): int | null {
          if this.current < this.end {
            value := this.current
            this.current = this.current + 1
            return value
          }
          return null
        }
      }

      function sum(items: Stream<int>): int {
        let total = 0
        for item of items {
          total = total + item
        }
        return total
      }
    `);

    expect(cpp).toContain("while (true)");
    expect(cpp).toContain("auto _stream_next_");
    expect(cpp).toContain("__doof_stream_next___doof_stream_int(_stream_");
    expect(cpp).toContain("if (!_stream_next_");
  });
});

describe("emitter — includes", () => {
  it("emits standard includes", () => {
    const cpp = emit(`const X = 42`);
    expect(cpp).toContain('#include "doof_runtime.hpp"');
    expect(cpp).toContain("#include <cstdint>");
    expect(cpp).toContain("#include <memory>");
    expect(cpp).toContain("#include <string>");
  });
});

describe("emitter — runtime header", () => {
  it("generates doof_runtime.hpp content", () => {
    const header = generateRuntimeHeader();
    expect(header).toContain("#pragma once");
    expect(header).toContain("namespace doof");
    expect(header).toContain("struct Result");
    expect(header).toContain("void panic");
    expect(header).toContain("void println");
    expect(header).toContain("std::string concat");
    expect(header).toContain("struct Range");
  });

  it("generates std::variant stringification support", () => {
    const header = generateRuntimeHeader();
    expect(header).toContain("inline std::string to_string(const std::variant<Ts...>& val)");
    expect(header).toContain('std::is_same_v<Inner, std::monostate>');
  });
});

describe("emitter — type mapping", () => {
  it("emits array types as std::shared_ptr<std::vector>", () => {
    const t: ResolvedType = {
      kind: "array",
      elementType: { kind: "primitive", name: "int" },
      readonly_: false,
    };
    expect(emitType(t)).toBe("std::shared_ptr<std::vector<int32_t>>");
  });

  it("emits tuple types as std::tuple", () => {
    const t: ResolvedType = {
      kind: "tuple",
      elements: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
      ],
    };
    expect(emitType(t)).toBe("std::tuple<int32_t, std::string>");
  });

  it("emits function types as std::function", () => {
    const t: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: { kind: "primitive", name: "int" } }],
      returnType: { kind: "primitive", name: "bool" },
    };
    expect(emitType(t)).toBe("std::function<bool(int32_t)>");
  });

  it("emits null type as std::monostate", () => {
    const t: ResolvedType = { kind: "null" };
    expect(emitType(t)).toBe("std::monostate");
  });
});

describe("emitter — union type mapping", () => {
  it("emits simple primitive union as std::variant", () => {
    const t: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
      ],
    };
    expect(emitType(t)).toBe("std::variant<int32_t, std::string>");
  });

  it("emits nullable primitive as std::optional", () => {
    const t: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "null" },
      ],
    };
    expect(emitType(t)).toBe("std::optional<int32_t>");
  });

  it("emits multi-type nullable union with monostate", () => {
    const t: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
        { kind: "null" },
      ],
    };
    expect(emitType(t)).toBe("std::variant<std::monostate, int32_t, std::string>");
  });

  it("coerces narrower primitive unions into nullable primitive unions", () => {
    const cpp = emit(`
      function main(): void {
        str: string | int := "Cat"
        foo: string | int | null := str
        println(foo)
      }
    `);
    expect(cpp).toContain("[&]() -> std::variant<std::monostate, std::string, int32_t>");
    expect(cpp).toContain("std::visit(");
  });
});

// ============================================================================
// String methods & length
// ============================================================================

describe("emitter — string.length", () => {
  it("emits string.length as .length()", () => {
    const cpp = emit(`
      function test(s: string): int {
        return s.length
      }
    `);
    expect(cpp).toContain(".length()");
    expect(cpp).not.toMatch(/\.length(?!\()/);
  });

  it("emits string.length on class field", () => {
    const cpp = emit(`
      class Message { body: string }
      function test(m: Message): int {
        return m.body.length
      }
    `);
    expect(cpp).toContain(".length()");
  });
});

describe("emitter — string methods", () => {
  it("emits indexOf", () => {
    const cpp = emit(`
      function test(s: string): int {
        return s.indexOf("world")
      }
    `);
    expect(cpp).toContain("doof::string_indexOf(");
  });

  it("emits contains", () => {
    const cpp = emit(`
      function test(s: string): bool {
        return s.contains("hello")
      }
    `);
    expect(cpp).toContain("doof::string_contains(");
  });

  it("emits startsWith and endsWith", () => {
    const cpp = emit(`
      function test(s: string): bool {
        return s.startsWith("hel")
      }
      function test2(s: string): bool {
        return s.endsWith("lo")
      }
    `);
    expect(cpp).toContain("doof::string_startsWith(");
    expect(cpp).toContain("doof::string_endsWith(");
  });

  it("emits substring and slice", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.substring(0, 5)
      }
      function test2(s: string): string {
        return s.slice(3)
      }
    `);
    expect(cpp).toContain("doof::string_substring(");
    expect(cpp).toContain("doof::string_slice(");
  });

  it("emits trim, trimStart, trimEnd", () => {
    const cpp = emit(`
      function test(s: string): string {
        a := s.trim()
        b := s.trimStart()
        c := s.trimEnd()
        return a
      }
    `);
    expect(cpp).toContain("doof::string_trim(");
    expect(cpp).toContain("doof::string_trimStart(");
    expect(cpp).toContain("doof::string_trimEnd(");
  });

  it("emits trimEnd with a fill character", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.trimEnd('0')
      }
    `);
    expect(cpp).toContain("doof::string_trimEnd(s, U'0')");
  });

  it("emits padStart", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.padStart(4, '0')
      }
    `);
    expect(cpp).toContain("doof::string_padStart(");
  });

  it("emits toUpperCase and toLowerCase", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.toUpperCase()
      }
      function test2(s: string): string {
        return s.toLowerCase()
      }
    `);
    expect(cpp).toContain("doof::string_toUpperCase(");
    expect(cpp).toContain("doof::string_toLowerCase(");
  });

  it("emits replace and replaceAll", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.replace("a", "b")
      }
      function test2(s: string): string {
        return s.replaceAll("a", "b")
      }
    `);
    expect(cpp).toContain("doof::string_replace(");
    expect(cpp).toContain("doof::string_replaceAll(");
  });

  it("emits split", () => {
    const cpp = emit(`
      function test(s: string): string[] {
        return s.split(",")
      }
    `);
    expect(cpp).toContain("doof::string_split(");
  });

  it("emits charAt and repeat", () => {
    const cpp = emit(`
      function test(s: string): string {
        return s.charAt(0)
      }
      function test2(s: string): string {
        return s.repeat(3)
      }
    `);
    expect(cpp).toContain("doof::string_charAt(");
    expect(cpp).toContain("doof::string_repeat(");
  });

  it("emits array indexing via runtime helper", () => {
    const cpp = emit(`
      function first(values: int[]): int {
        return values[0]
      }
    `);
    expect(cpp).toContain("doof::array_at(values, 0)");
  });

  it("emits array pop via runtime helper", () => {
    const cpp = emit(`
      function trim(values: int[]): Result<int, string> {
        return values.pop()
      }
    `);
    expect(cpp).toContain("doof::array_pop(values)");
  });

  it("emits array contains and slice via runtime helpers", () => {
    const cpp = emit(`
      function hasValue(values: int[]): bool {
        return values.contains(2)
      }
      function middle(values: int[]): int[] {
        return values.slice(1, 3)
      }
    `);
    expect(cpp).toContain("doof::array_contains(values, 2)");
    expect(cpp).toContain("doof::array_slice(values, 1, 3)");
  });

  it("emits array includes, indexOf, some, every, filter, and map via runtime helpers", () => {
    const cpp = emit(`
      function findValue(values: int[]): int {
        return values.indexOf(2)
      }

      function hasEven(values: int[]): bool {
        return values.some((it: int): bool => it % 2 == 0)
      }

      function allPositive(values: int[]): bool {
        return values.every((it: int): bool => it > 0)
      }

      function onlyEven(values: int[]): int[] {
        return values.filter((it: int): bool => it % 2 == 0)
      }

      function labels(values: int[]): string[] {
        return values.map((it: int): string => string(it))
      }
    `);
    expect(cpp).toContain("doof::array_indexOf(values, 2)");
    expect(cpp).toContain("doof::array_some(values");
    expect(cpp).toContain("doof::array_every(values");
    expect(cpp).toContain("doof::array_filter(values");
    expect(cpp).toContain("doof::array_map(values");
  });

  it("emits array buildReadonly via runtime helper", () => {
    const cpp = emit(`
      function freeze(values: int[]): readonly int[] {
        return values.buildReadonly()
      }
    `);
    expect(cpp).toContain("doof::array_buildReadonly(values)");
  });

  it("emits array cloneMutable on mutable array via runtime helper", () => {
    const cpp = emit(`
      function copyMut(values: int[]): int[] {
        return values.cloneMutable()
      }
    `);
    expect(cpp).toContain("doof::array_cloneMutable(values)");
  });

  it("emits array cloneMutable on readonly array via runtime helper", () => {
    const cpp = emit(`
      function copyMut(values: readonly int[]): int[] {
        return values.cloneMutable()
      }
    `);
    expect(cpp).toContain("doof::array_cloneMutable(values)");
  });

  it("emits contextual Set literals as ordered_set", () => {
    const cpp = emit(`
      function makeSet(): Set<int> {
        return [1, 2, 3, 2]
      }
    `);
    expect(cpp).toContain("doof::ordered_set<int32_t>{1, 2, 3, 2}");
  });

});

// ============================================================================
// Non-null assertion expression
// ============================================================================

describe("emitter — non-null assertion", () => {
  it("emits postfix ! on nullable primitive with .value()", () => {
    const cpp = emit(`
      function test(s: string | null): void {
        println(s!)
      }
    `);
    expect(cpp).toContain(".value()");
  });

  it("emits postfix ! on non-nullable as passthrough", () => {
    const cpp = emit(`
      function test(s: string): void {
        println(s!)
      }
    `);
    // Should just emit the variable name, no .value()
    expect(cpp).toContain("doof::println(s)");
  });
});
