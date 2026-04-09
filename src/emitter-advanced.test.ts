/**
 * Emitter tests — advanced: Result type, Success/Failure construction,
 * case expression on Result, catch expression, emitter-types utilities,
 * null coercion, private fields/methods, JSON serialization,
 * with statement, description metadata.
 */

import { describe, it, expect } from "vitest";
import { emit } from "./emitter-test-helpers.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import { emitType } from "./emitter-types.js";
import { isVariantUnionType, emitNullForType, isMonostateNullable } from "./emitter-types.js";
import type { ResolvedType } from "./checker-types.js";

// ============================================================================
// Result<T, E> type emission and try operators
// ============================================================================

describe("emitter — Result type", () => {
  it("emits doof::Result<T, E> for Result return type", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Success(42)
      }
    `);
    expect(cpp).toContain("doof::Result<int32_t, std::string>");
  });

  it("emits doof::Result<void, E> for void Result return type", () => {
    const cpp = emit(`
      function f(): Result<void, string> {
        return Success()
      }
    `);
    expect(cpp).toContain("doof::Result<void, std::string>");
    const header = generateRuntimeHeader();
    expect(header).toContain("template <typename E>");
    expect(header).toContain("struct Result<void, E>");
  });

  it("emits doof::Result with class error type", () => {
    const cpp = emit(`
      class MyError { message: string }
      function f(): Result<int, MyError> {
        return Success(42)
      }
    `);
    expect(cpp).toContain("doof::Result<int32_t, std::shared_ptr<MyError>>");
  });

  it("emits Result parameter type correctly", () => {
    const cpp = emit(`
      function f(r: Result<int, string>): int {
        return try! r
      }
    `);
    expect(cpp).toContain("doof::Result<int32_t, std::string>");
  });

  it("emits try statement with typed Result on success unwrap", () => {
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

  it("emits try! with typed IIFE and improved error in panic", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Success(0) }
      function f(): void {
        x := try! getVal()
      }
    `);
    expect(cpp).toContain("isFailure()");
    expect(cpp).toContain("doof::panic");
    expect(cpp).toContain("doof::to_string");
    expect(cpp).toContain("-> int32_t");
  });

  it("emits try? with typed std::optional<T>", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Success(0) }
      function f(): void {
        x := try? getVal()
      }
    `);
    expect(cpp).toContain("std::optional<int32_t>");
    expect(cpp).toContain("std::nullopt");
  });

  it("always includes JSON runtime support", () => {
    const header = generateRuntimeHeader();
    expect(header).toContain("nlohmann/json.hpp");
    expect(header).toContain("json_from_nlohmann");
    expect(header).toContain("struct JsonValue");
  });
});

// ============================================================================
// emitType — Result type mapping
// ============================================================================

describe("emitType — Result", () => {
  it("maps Result<int, string> to doof::Result<int32_t, std::string>", () => {
    const t: ResolvedType = {
      kind: "result",
      successType: { kind: "primitive", name: "int" },
      errorType: { kind: "primitive", name: "string" },
    };
    expect(emitType(t)).toBe("doof::Result<int32_t, std::string>");
  });

  it("maps Result<bool, int> to doof::Result<bool, int32_t>", () => {
    const t: ResolvedType = {
      kind: "result",
      successType: { kind: "primitive", name: "bool" },
      errorType: { kind: "primitive", name: "int" },
    };
    expect(emitType(t)).toBe("doof::Result<bool, int32_t>");
  });

  it("maps Result<void, string> to doof::Result<void, std::string>", () => {
    const t: ResolvedType = {
      kind: "result",
      successType: { kind: "void" },
      errorType: { kind: "primitive", name: "string" },
    };
    expect(emitType(t)).toBe("doof::Result<void, std::string>");
  });
});

// ============================================================================
// Success / Failure construction
// ============================================================================

describe("emitter — Success/Failure construction", () => {
  it("emits Success { value: expr } as Result::success()", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Success { value: 42 }
      }
    `);
    expect(cpp).toContain("::success(42)");
    expect(cpp).not.toContain("make_shared<Success>");
  });

  it("emits Failure { error: expr } as Result::failure()", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Failure { error: "something went wrong" }
      }
    `);
    expect(cpp).toContain('::failure(std::string("something went wrong"))');
    expect(cpp).not.toContain("make_shared<Failure>");
  });

  it("emits Success() as Result<void, E>::success()", () => {
    const cpp = emit(`
      function f(): Result<void, string> {
        return Success()
      }
    `);
    expect(cpp).toContain("doof::Result<void, std::string>::success()");
  });

  it("emits Success {} as Result<void, E>::success()", () => {
    const cpp = emit(`
      function f(): Result<void, string> {
        return Success {}
      }
    `);
    expect(cpp).toContain("doof::Result<void, std::string>::success()");
  });

  it("emits Success without double-wrapping in Result::success", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Success { value: 42 }
      }
    `);
    // Should NOT have Result::success(Result::success(...))
    expect(cpp).not.toContain("success(doof::Result");
  });

  it("emits Failure in if/else branch", () => {
    const cpp = emit(`
      function validate(x: int): Result<int, string> {
        if x < 0 {
          return Failure { error: "negative" }
        }
        return Success { value: x }
      }
    `);
    expect(cpp).toContain('::failure(std::string("negative"))');
    expect(cpp).toContain("::success(x)");
  });

  it("constructs a user-defined Success class with named syntax", () => {
    const cpp = emit(`
      class Success {
        const kind = "Success"
        value: int
      }

      function f(): Success {
        return Success { value: 42 }
      }
    `);
    expect(cpp).toContain("std::make_shared<Success>(42)");
    expect(cpp).not.toContain("::success(42)");
  });

  it("constructs a user-defined Failure class with named syntax", () => {
    const cpp = emit(`
      class Failure {
        const kind = "Failure"
        error: string
      }

      function f(): Failure {
        return Failure { error: "bad" }
      }
    `);
    expect(cpp).toContain('std::make_shared<Failure>(std::string("bad"))');
    expect(cpp).not.toContain("::failure(");
  });
});

// ============================================================================
// Positional Success / Failure construction
// ============================================================================

describe("emitter — positional Success/Failure construction", () => {
  it("emits Success(expr) as Result::success()", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Success(42)
      }
    `);
    expect(cpp).toContain("::success(42)");
    expect(cpp).not.toContain("make_shared<Success>");
  });

  it("emits Failure(expr) as Result::failure()", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Failure("something went wrong")
      }
    `);
    expect(cpp).toContain('::failure(std::string("something went wrong"))');
    expect(cpp).not.toContain("make_shared<Failure>");
  });

  it("emits positional Success without double-wrapping", () => {
    const cpp = emit(`
      function f(): Result<int, string> {
        return Success(42)
      }
    `);
    expect(cpp).not.toContain("success(doof::Result");
  });

  it("emits positional Failure in if/else branch", () => {
    const cpp = emit(`
      function validate(x: int): Result<int, string> {
        if x < 0 {
          return Failure("negative")
        }
        return Success(x)
      }
    `);
    expect(cpp).toContain('::failure(std::string("negative"))');
    expect(cpp).toContain("::success(x)");
  });

  it("constructs a user-defined Success class with positional syntax", () => {
    const cpp = emit(`
      class Success {
        value: int
      }

      function f(): Success {
        return Success(42)
      }
    `);
    expect(cpp).toContain("std::make_shared<Success>(42)");
    expect(cpp).not.toContain("::success(42)");
  });
});

// ============================================================================
// Case expression on Result type
// ============================================================================

describe("emitter — case expression on Result", () => {
  it("emits case on Result with Success/Failure patterns", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Success { value: 42 } }
      function f(): int {
        const r = getVal()
        return case r {
          s: Success => s.value,
          _: Failure => -1
        }
      }
    `);
    expect(cpp).toContain("isSuccess()");
    expect(cpp).toContain(".value()");
  });

  it("emits case on Result with Failure pattern binding", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Failure { error: "bad" } }
      function f(): string {
        const r = getVal()
        return case r {
          _: Success => "ok",
          e: Failure => e.error
        }
      }
    `);
    expect(cpp).toContain("isFailure()");
    expect(cpp).toContain(".error()");
  });

  it("evaluates case subject only once when it is a function call", () => {
    const cpp = emit(`
      function getVal(): Result<int, string> { return Success { value: 42 } }
      function f(): int {
        return case getVal() {
          s: Success => s.value,
          _: Failure => -1
        }
      }
    `);
    // The IIFE should store the subject in a temp variable
    expect(cpp).toContain("auto _case_result = ");
    // isSuccess()/isFailure() should reference the temp, not re-call getVal()
    expect(cpp).toContain("_case_result.isSuccess()");
    // Inside f(), getVal() should appear only in the temp initialization,
    // not repeated in each arm. (It also appears once in its own definition.)
    const fBody = cpp.slice(cpp.indexOf("int32_t f()"));
    const callCount = (fBody.match(/getVal\(\)/g) || []).length;
    expect(callCount).toBe(1);
  });
});

// ============================================================================
// Catch expression
// ============================================================================

describe("emitter — catch expression", () => {
  it("emits catch binding with do/while and break on failure", () => {
    const cpp = emit(`
      class IOError { message: string }
      function readFile(): Result<string, IOError> {
        return Success { value: "hello" }
      }
      function main(): void {
        const err = catch {
          try content := readFile()
        }
      }
    `);
    expect(cpp).toContain("do {");
    expect(cpp).toContain("} while (false);");
    expect(cpp).toContain("isFailure()");
    expect(cpp).toContain("break;");
    // Should NOT contain return ...::failure (that's the non-catch try behavior)
    const mainBody = cpp.slice(cpp.indexOf("void main()"));
    expect(mainBody).not.toContain("::failure(");
  });

  it("emits catch with multiple try statements", () => {
    const cpp = emit(`
      class IOError { message: string }
      class ParseError { message: string }
      function readFile(): Result<string, IOError> {
        return Success { value: "data" }
      }
      function parseData(s: string): Result<int, ParseError> {
        return Success { value: 42 }
      }
      function main(): void {
        const err = catch {
          try content := readFile()
          try parsed := parseData(content)
        }
      }
    `);
    expect(cpp).toContain("do {");
    expect(cpp).toContain("} while (false);");
    // Two try statements → two isFailure checks + breaks
    const mainBody = cpp.slice(cpp.indexOf("void main()"));
    const failureChecks = (mainBody.match(/isFailure\(\)/g) || []).length;
    expect(failureChecks).toBe(2);
    const breakCount = (mainBody.match(/break;/g) || []).length;
    expect(breakCount).toBe(2);
  });

  it("emits catch binding with nullptr initialization for class error type", () => {
    const cpp = emit(`
      class IOError { message: string }
      function readFile(): Result<string, IOError> {
        return Success { value: "hello" }
      }
      function main(): void {
        const err = catch {
          try content := readFile()
        }
      }
    `);
    // Single class error → std::shared_ptr<IOError> with nullptr init
    expect(cpp).toContain("nullptr");
  });
});

// ============================================================================
// Union type casting (shared_ptr ↔ variant) — emitter-types utility tests
// ============================================================================

describe("emitter-types — isVariantUnionType", () => {
  it("returns false for single class | null union (shared_ptr)", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(isVariantUnionType(type)).toBe(false);
  });

  it("returns true for multi-class | null union (variant)", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "class", symbol: { symbolKind: "class", name: "Bar", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(isVariantUnionType(type)).toBe(true);
  });

  it("returns true for multi-class union without null (variant)", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "class", symbol: { symbolKind: "class", name: "Bar", module: "/m" } as any },
      ],
    };
    expect(isVariantUnionType(type)).toBe(true);
  });

  it("returns false for non-union type", () => {
    const type: ResolvedType = { kind: "primitive", name: "int" };
    expect(isVariantUnionType(type)).toBe(false);
  });

  it("returns false for single primitive | null (optional)", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "null" },
      ],
    };
    expect(isVariantUnionType(type)).toBe(false);
  });
});

describe("emitter-types — emitNullForType", () => {
  it("returns monostate for multi-class nullable union", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "class", symbol: { symbolKind: "class", name: "Bar", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(emitNullForType(type)).toBe("std::monostate{}");
  });

  it("returns nullptr for single class nullable union", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(emitNullForType(type)).toBe("nullptr");
  });

  it("returns nullopt for single primitive nullable union", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "null" },
      ],
    };
    expect(emitNullForType(type)).toBe("std::nullopt");
  });

  it("returns nullptr for plain class type", () => {
    const type: ResolvedType = {
      kind: "class",
      symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any,
    };
    expect(emitNullForType(type)).toBe("nullptr");
  });
});

describe("emitter-types — isMonostateNullable", () => {
  it("returns true for nullable multi-class union", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "class", symbol: { symbolKind: "class", name: "Bar", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(isMonostateNullable(type)).toBe(true);
  });

  it("returns false for non-nullable multi-class union", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "class", symbol: { symbolKind: "class", name: "Bar", module: "/m" } as any },
      ],
    };
    expect(isMonostateNullable(type)).toBe(false);
  });

  it("returns false for single class nullable (shared_ptr)", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "class", symbol: { symbolKind: "class", name: "Foo", module: "/m" } as any },
        { kind: "null" },
      ],
    };
    expect(isMonostateNullable(type)).toBe(false);
  });
});

describe("emitter — null coercion in generated C++", () => {
  it("emits monostate for null return in multi-class union function", () => {
    const cpp = emit(`
      class Foo { x: int }
      class Bar { y: int }
      function test(): Foo | Bar | null => null
      function main(): int => 0
    `);
    expect(cpp).toContain("std::monostate{}");
    expect(cpp).not.toContain("return nullptr");
  });

  it("emits nullptr for null return in single-class nullable function", () => {
    const cpp = emit(`
      class Foo { x: int }
      function test(): Foo | null => null
      function main(): int => 0
    `);
    expect(cpp).toContain("nullptr");
  });

  it("emits explicit variant type for let with multi-class nullable union", () => {
    const cpp = emit(`
      class Foo { x: int }
      class Bar { y: int }
      function main(): int {
        let v: Foo | Bar | null = Foo { x: 1 }
        return 0
      }
    `);
    expect(cpp).toContain("std::variant<std::monostate, std::shared_ptr<Foo>, std::shared_ptr<Bar>>");
    expect(cpp).not.toContain("auto v");
  });

  it("emits holds_alternative for null check on multi-class nullable union", () => {
    const cpp = emit(`
      class Foo { x: int }
      class Bar { y: int }
      function check(v: Foo | Bar | null): bool => v == null
      function check2(v: Foo | Bar | null): bool => v != null
      function main(): int => 0
    `);
    expect(cpp).toContain("std::holds_alternative<std::monostate>");
    expect(cpp).toContain("!std::holds_alternative<std::monostate>");
  });
});

// ============================================================================
// Private access control in C++ emission
// ============================================================================

describe("Private fields and methods emit valid C++", () => {
  it("emits class with private fields as regular C++ struct members", () => {
    const cpp = emit(`
      class Foo {
        private secret: int
        name: string
      }
      function main(): int => 0
    `);
    // Private fields should still appear as struct members (no C++ private:)
    expect(cpp).toContain("int32_t secret");
    expect(cpp).toContain("std::string name");
    expect(cpp).not.toContain("private:");
  });

  it("emits class with private methods as regular C++ methods", () => {
    const cpp = emit(`
      class Foo {
        x: int
        private function internal(): int { return x }
        function pub(): int { return this.internal() }
      }
      function main(): int => 0
    `);
    expect(cpp).toContain("internal()");
    expect(cpp).toContain("pub()");
  });

  it("emits private top-level function as regular C++ function", () => {
    const cpp = emit(`
      private function helper(): int => 42
      function main(): int => helper()
    `);
    expect(cpp).toContain("helper()");
  });
});

// ============================================================================
// JSON serialization — toJsonValue / fromJsonValue emission
// ============================================================================

describe("emitter — JSON serialization", () => {
  it("emits toJsonValue method for simple class", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
      }
      function test(p: Point): JsonValue => p.toJsonValue()
    `);
    expect(cpp).toContain("doof::JsonValue toJsonValue() const {");
    expect(cpp).toContain("std::make_shared<std::unordered_map<std::string, doof::JsonValue>>()");
    expect(cpp).toContain('(*_j)["x"] = doof::JsonValue(this->x);');
    expect(cpp).toContain('(*_j)["y"] = doof::JsonValue(this->y);');
  });

  it("emits fromJsonValue method for simple class", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
      }
      function test(json: JsonValue): Result<Point, string> => Point.fromJsonValue(json)
    `);
    expect(cpp).toContain("static doof::Result<std::shared_ptr<Point>, std::string> fromJsonValue(const doof::JsonValue& _j) {");
    expect(cpp).toContain('auto _it_x = _obj->find("x");');
    expect(cpp).toContain('auto _it_y = _obj->find("y");');
    expect(cpp).toContain('doof::json_as_int(_it_x->second)');
    expect(cpp).toContain('doof::json_as_int(_it_y->second)');
    expect(cpp).toContain("std::make_shared<Point>(_f_x, _f_y)");
  });

  it("emits toJsonValue for class with string and bool fields", () => {
    const cpp = emit(`
      class Config {
        name: string
        enabled: bool
      }
      function test(c: Config): JsonValue => c.toJsonValue()
    `);
    expect(cpp).toContain('(*_j)["name"] = doof::JsonValue(this->name);');
    expect(cpp).toContain('(*_j)["enabled"] = doof::JsonValue(this->enabled);');
  });

  it("emits fromJsonValue with default value handling", () => {
    const cpp = emit(`
      class Config {
        name: string
        count: int = 10
      }
      function test(json: JsonValue): Result<Config, string> => Config.fromJsonValue(json)
    `);
    expect(cpp).toContain('Missing required field \\"name\\"');
    expect(cpp).toContain('_obj->find("count")');
    expect(cpp).toContain("_f_count = 10;");
  });

  it("emits missing nullable string defaults as std::nullopt in fromJsonValue", () => {
    const cpp = emit(`
      class Config {
        name: string
        notes: string | null = null
      }
      function test(json: JsonValue): Result<Config, string> => Config.fromJsonValue(json)
    `);
    expect(cpp).toContain("_f_notes = std::nullopt;");
    expect(cpp).not.toContain("_f_notes = nullptr;");
  });

  it("handles const fields in toJsonValue and fromJsonValue", () => {
    const cpp = emit(`
      class Dog {
        const kind = "dog"
        name: string
      }
      function test(d: Dog): JsonValue => d.toJsonValue()
    `);
    expect(cpp).toContain('(*_j)["kind"]');
    expect(cpp).toContain('"dog"');
  });

  it("emits toJsonValue for class with nested class field", () => {
    const cpp = emit(`
      class Inner {
        value: int
      }
      class Outer {
        inner: Inner
      }
      function test(o: Outer): JsonValue => o.toJsonValue()
    `);
    expect(cpp).toContain("this->inner->toJsonValue()");
  });

  it("emits fromJsonValue for class with nested class field", () => {
    const cpp = emit(`
      class Inner {
        value: int
      }
      class Outer {
        inner: Inner
      }
      function test(json: JsonValue): Result<Outer, string> => Outer.fromJsonValue(json)
    `);
    expect(cpp).toContain("Inner::fromJsonValue");
  });

  it("emits toJsonValue for class with array field", () => {
    const cpp = emit(`
      class Numbers {
        values: int[]
      }
      function test(n: Numbers): JsonValue => n.toJsonValue()
    `);
    expect(cpp).toContain("_arr->push_back");
  });

  it("emits toJsonValue for nullable field", () => {
    const cpp = emit(`
      class Container {
        label: string | null
      }
      function test(c: Container): JsonValue => c.toJsonValue()
    `);
    expect(cpp).toContain("isNull()");
  });

  it("does NOT emit toJsonValue for non-serializable class", () => {
    const cpp = emit(`
      class Handler {
        callback: (x: int): void
      }
    `);
    expect(cpp).not.toContain("toJsonValue");
    expect(cpp).not.toContain("fromJsonValue");
  });

  it("emits Class.fromJsonValue() as static call", () => {
    const cpp = emit(`
      class User {
        name: string
      }
      function parse(json: JsonValue): Result<User, string> {
        return User.fromJsonValue(json)
      }
    `);
    expect(cpp).toContain("User::fromJsonValue(json)");
  });

  it("emits obj.toJsonValue() as instance call", () => {
    const cpp = emit(`
      class User {
        name: string
      }
      function serialize(u: User): JsonValue {
        return u.toJsonValue()
      }
    `);
    expect(cpp).toContain("u->toJsonValue()");
  });

  it("emits interface fromJsonValue dispatcher with discriminator", () => {
    const cpp = emit(`
      interface Shape {
        area(): double
      }
      class Circle implements Shape {
        const kind = "circle"
        radius: double
        area(): double => 3.14159 * radius * radius
      }
      class Square implements Shape {
        const kind = "square"
        side: double
        area(): double => side * side
      }
      function test(json: JsonValue): Result<Shape, string> => Shape.fromJsonValue(json)
    `);
    expect(cpp).toContain("Shape_fromJsonValue");
    expect(cpp).toContain('_disc == "circle"');
    expect(cpp).toContain('_disc == "square"');
    expect(cpp).toContain("Circle::fromJsonValue");
    expect(cpp).toContain("Square::fromJsonValue");
  });

  it("emits Interface.fromJsonValue() as free function call", () => {
    const cpp = emit(`
      interface Shape {
        area(): double
      }
      class Circle implements Shape {
        const kind = "circle"
        radius: double
        area(): double => 3.14159 * radius * radius
      }
      class Square implements Shape {
        const kind = "square"
        side: double
        area(): double => side * side
      }
      function parse(json: JsonValue): Result<Shape, string> {
        return Shape.fromJsonValue(json)
      }
    `);
    expect(cpp).toContain("Shape_fromJsonValue(json)");
  });

  it("emits enum field serialization", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
      class Pixel {
        color: Color
        x: int
        y: int
      }
      function test(p: Pixel): JsonValue => p.toJsonValue()
    `);
    expect(cpp).toContain("Color_name(");
    expect(cpp).toContain("Color_fromName(");
  });

  // --- On-demand generation tests ---

  it("does NOT emit JSON methods when toJsonValue/fromJsonValue are not called", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
      }
      function test(p: Point): int => p.x + p.y
    `);
    expect(cpp).not.toContain("toJsonValue");
    expect(cpp).not.toContain("fromJsonValue");
    expect(cpp).not.toContain("nlohmann");
  });

  it("does NOT include nlohmann/json.hpp when no JSON is used", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
      }
    `);
    expect(cpp).not.toContain("#include <nlohmann/json.hpp>");
  });

  it("includes nlohmann/json.hpp when toJsonValue is called", () => {
    const cpp = emit(`
      class Point {
        x: int
        y: int
      }
      function test(p: Point): JsonValue => p.toJsonValue()
    `);
    expect(cpp).toContain("#include <nlohmann/json.hpp>");
  });

  it("generates JSON for nested class transitively via toJsonValue call", () => {
    const cpp = emit(`
      class Inner { value: int }
      class Outer { inner: Inner }
      function test(o: Outer): JsonValue => o.toJsonValue()
    `);
    expect(cpp).toContain("this->inner->toJsonValue()");
    expect(cpp).toContain("Inner::fromJsonValue");
  });
});

// ============================================================================
// With statement emission
// ============================================================================

describe("With statement emission", () => {
  it("emits a scoped block with const auto binding", () => {
    const cpp = emit(`
      function test(): int {
        with x := 42 {
          return x
        }
        return 0
      }
    `);
    expect(cpp).toContain("{");
    expect(cpp).toContain("const auto x = 42;");
    expect(cpp).toContain("return x;");
    expect(cpp).toContain("}");
  });

  it("emits multiple bindings in the same scoped block", () => {
    const cpp = emit(`
      function test(): int {
        with x := 10, y := 20 {
          return x + y
        }
        return 0
      }
    `);
    expect(cpp).toContain("const auto x = 10;");
    expect(cpp).toContain("const auto y = 20;");
  });

  it("emits typed binding with class type", () => {
    const cpp = emit(`
      class Point {
        x, y: int
      }
      function test(): int {
        with p := Point(1, 2) {
          return p.x
        }
        return 0
      }
    `);
    expect(cpp).toContain("const std::shared_ptr<Point> p =");
  });
});

describe("description metadata comments", () => {
  it("emits class description as comment", () => {
    const cpp = emit(`
      class Foo "A foo class." {
        x: int
      }
    `);
    expect(cpp).toContain("// A foo class.");
    expect(cpp).toContain("struct Foo");
  });

  it("emits field description as comment", () => {
    const cpp = emit(`
      class Foo {
        name "The name.": string
      }
    `);
    expect(cpp).toContain("// The name.");
  });

  it("emits multi-name field descriptions as comments", () => {
    const cpp = emit(`
      class Vec {
        x "x-axis", y "y-axis": float
      }
    `);
    expect(cpp).toContain("// x-axis");
    expect(cpp).toContain("// y-axis");
  });

  it("emits function description as comment", () => {
    const cpp = emit(`
      function greet "Greets the user."(name: string): string {
        return name
      }
    `);
    expect(cpp).toContain("// Greets the user.");
  });

  it("emits parameter descriptions as @param comments", () => {
    const cpp = emit(`
      function greet(name "The name.": string): string {
        return name
      }
    `);
    expect(cpp).toContain("// @param name The name.");
  });

  it("emits enum description as comment", () => {
    const cpp = emit(`
      enum Color "Available colors." {
        Red, Green, Blue
      }
    `);
    expect(cpp).toContain("// Available colors.");
    expect(cpp).toContain("enum class Color");
  });

  it("emits enum variant description as comment", () => {
    const cpp = emit(`
      enum Color {
        Red "Primary red.",
        Green,
        Blue "Primary blue."
      }
    `);
    expect(cpp).toContain("// Primary red.");
    expect(cpp).toContain("// Primary blue.");
  });

  it("emits const description as comment", () => {
    const cpp = emit(`
      const MAX "Maximum value." = 100
    `);
    expect(cpp).toContain("// Maximum value.");
  });

  it("emits type alias description as comment", () => {
    const cpp = emit(`
      type ID "A unique identifier." = string
    `);
    expect(cpp).toContain("// A unique identifier.");
  });

  it("does not emit comments when no descriptions", () => {
    const cpp = emit(`
      class Foo { x: int }
    `);
    // Should not have any stray // comments for descriptions
    const lines = cpp.split("\\n").filter((l: string) => l.trim().startsWith("// ") && !l.includes("#"));
    // Only expected comments are section dividers, not description comments
    for (const line of lines) {
      expect(line).not.toMatch(/\/\/ [A-Z][a-z]/);
    }
  });

  it("emits short method description as comment", () => {
    const cpp = emit(`
      class Foo {
        x: int
        greet "Says hello."(name: string): string {
          return name
        }
      }
    `);
    expect(cpp).toContain("// Says hello.");
  });

  it("emits the DevAssistant example with descriptions", () => {
    const cpp = emit(`
      class DevAssistant "AI assistant for development workflows." {
        rootPath "Path to the project root.": string
        createProject "Creates a new project scaffold."(
          name "The name of the project.": string
        ): string {
          return name
        }
      }
    `);
    expect(cpp).toContain("// AI assistant for development workflows.");
    expect(cpp).toContain("// Path to the project root.");
    expect(cpp).toContain("// Creates a new project scaffold.");
    expect(cpp).toContain("// @param name The name of the project.");
  });
});

// ============================================================================
// Map<K, V> type emission
// ============================================================================

describe("emitType — Map", () => {
  it("emits Map<string, int> as shared_ptr<unordered_map>", () => {
    const t: ResolvedType = {
      kind: "map",
      keyType: { kind: "primitive", name: "string" },
      valueType: { kind: "primitive", name: "int" },
    };
    expect(emitType(t)).toBe("std::shared_ptr<std::unordered_map<std::string, int32_t>>");
  });
});

describe("emitter — Map literal", () => {
  it("emits string-keyed map literal with resolved type", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1, "b": 2 }
    `);
    expect(cpp).toContain("std::unordered_map<std::string, int32_t>");
  });

  it("emits bracket-keyed map literal", () => {
    const cpp = emit(`
      let m: Map<int, string> = { [1]: "one", [2]: "two" }
    `);
    expect(cpp).toContain("std::unordered_map<int32_t, std::string>");
  });

  it("emits long-keyed map literal", () => {
    const cpp = emit(`
      let m: Map<long, string> = { 1L: "one", 2L: "two" }
    `);
    expect(cpp).toContain("std::unordered_map<int64_t, std::string>");
  });

  it("emits dot-shorthand enum-keyed map literal", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
      let m: Map<Color, int> = { .Red: 1, .Green: 2, .Blue: 3 }
    `);
    expect(cpp).toContain("std::unordered_map<Color, int32_t>");
    expect(cpp).toContain("Color::Red");
    expect(cpp).toContain("Color::Green");
    expect(cpp).toContain("Color::Blue");
  });

  it("emits explicit enum-access map literal", () => {
    const cpp = emit(`
      enum Color { Red, Green, Blue }
      let m: Map<Color, int> = { Color.Red: 1, Color.Green: 2 }
    `);
    expect(cpp).toContain("std::unordered_map<Color, int32_t>");
    expect(cpp).toContain("Color::Red");
    expect(cpp).toContain("Color::Green");
  });
});

describe("emitter — Map methods", () => {
  it("emits map index reads via doof::map_at()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      x := m["a"]
    `);
    expect(cpp).toContain("doof::map_at(");
  });

  it("emits .size as ->size()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      x := m.size
    `);
    expect(cpp).toContain("->size()");
  });

  it("emits .get() as doof::map_get()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      x := m.get("a")
    `);
    expect(cpp).toContain("doof::map_get(");
  });

  it("emits .has() as ->count() > 0", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      x := m.has("a")
    `);
    expect(cpp).toContain("->count(");
  });

  it("emits .set() as doof::map_index(...)=value", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      m.set("b", 2)
    `);
    expect(cpp).toContain("doof::map_index(");
    expect(cpp).toContain(") = 2");
  });

  it("emits .delete() as ->erase()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      m.delete("a")
    `);
    expect(cpp).toContain("->erase(");
  });

  it("emits .keys() as doof::map_keys()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      k := m.keys()
    `);
    expect(cpp).toContain("doof::map_keys(");
  });

  it("emits .values() as doof::map_values()", () => {
    const cpp = emit(`
      let m: Map<string, int> = { "a": 1 }
      v := m.values()
    `);
    expect(cpp).toContain("doof::map_values(");
  });

  it("emits Set members with unordered_set operations", () => {
    const cpp = emit(`
      let unique: Set<int> = [1, 2, 3]
      hasTwo := unique.has(2)
      unique.add(4)
      unique.delete(1)
      values := unique.values()
      count := unique.size
    `);
    expect(cpp).toContain("->count(2) > 0");
    expect(cpp).toContain("->insert(4)");
    expect(cpp).toContain("->erase(1)");
    expect(cpp).toContain("doof::set_values(");
    expect(cpp).toContain("->size()");
  });

  it("emits explicit enum-access Set literals", () => {
    const cpp = emit(`
      enum Color { Red, Blue }
      let palette: Set<Color> = [Color.Red, Color.Blue]
    `);
    expect(cpp).toContain("std::unordered_set<Color>");
    expect(cpp).toContain("Color::Red");
    expect(cpp).toContain("Color::Blue");
  });

  it("emits contextual int elements for Set<long>", () => {
    const cpp = emit(`
      let ids: Set<long> = [1, 2, 3]
    `);
    expect(cpp).toContain("std::unordered_set<int64_t>");
    expect(cpp).toContain("std::unordered_set<int64_t>{1, 2, 3}");
  });

  it("emits bare inferred Set literals with concrete element types", () => {
    const cpp = emit(`
      unique: Set := [1, 2, 3]
    `);
    expect(cpp).toContain("std::unordered_set<int32_t>");
    expect(cpp).toContain("std::unordered_set<int32_t>{1, 2, 3}");
  });
});

describe("emitter — Map bare-key and empty literal", () => {
  it("emits bare integer-keyed map literal", () => {
    const cpp = emit(`
      let m: Map<int, string> = { 1: "one", 2: "two" }
    `);
    expect(cpp).toContain("std::unordered_map<int32_t, std::string>");
  });

  it("emits empty map literal with Map expected type", () => {
    const cpp = emit(`
      let m: Map<string, int> = {}
    `);
    expect(cpp).toContain("std::make_shared<std::unordered_map<std::string, int32_t>>()");
  });

  it("emits contextual int keys for Map<long, int>", () => {
    const cpp = emit(`
      let m: Map<long, int> = { 1: 10, 2: 20 }
    `);
    expect(cpp).toContain("std::unordered_map<int64_t, int32_t>");
  });

  it("emits bare inferred Map literals with concrete key and value types", () => {
    const cpp = emit(`
      scores: Map := { "Alice": 100, "Bob": 95 }
    `);
    expect(cpp).toContain("std::unordered_map<std::string, int32_t>");
    expect(cpp).toContain('{std::string("Alice"), 100}');
    expect(cpp).toContain('{std::string("Bob"), 95}');
  });

  it("emits map literal returned from function", () => {
    const cpp = emit(`
      function getMap(): Map<int, string> {
        return { 1: "one", 2: "two" }
      }
    `);
    expect(cpp).toContain("std::unordered_map<int32_t, std::string>");
  });

  it("emits empty map returned from function", () => {
    const cpp = emit(`
      function getMap(): Map<int, string> {
        return {}
      }
    `);
    expect(cpp).toContain("std::make_shared<std::unordered_map<int32_t, std::string>>()");
  });
});

// ============================================================================
// Else-narrow statement
// ============================================================================

describe("emitter — else-narrow statement", () => {
  it("emits nullable optional else-narrow", () => {
    const cpp = emit(`
      function getValue(): int | null => null
      function test(): int {
        x := getValue() else { return 0 }
        return x
      }
    `);
    expect(cpp).toContain("auto _else");
    expect(cpp).toContain(".has_value()");
    expect(cpp).toContain("return 0");
    expect(cpp).toContain(".value()");
  });

  it("emits nullable shared_ptr else-narrow", () => {
    const cpp = emit(`
      class Config { name: string }
      function getConfig(): Config | null => null
      function test(): string {
        x := getConfig() else { return "" }
        return x.name
      }
    `);
    expect(cpp).toContain("auto _else");
    expect(cpp).toContain("nullptr");
    expect(cpp).toContain("return");
  });

  it("emits Result else-narrow with isFailure check", () => {
    const cpp = emit(`
      class Config { name: string }
      class AppError { message: string }
      function loadConfig(): Result<Config, AppError> => Success { value: Config { name: "app" } }
      function test(): string {
        x := loadConfig() else { return "" }
        return x.name
      }
    `);
    expect(cpp).toContain("auto _else");
    expect(cpp).toContain("isFailure()");
    expect(cpp).toContain(".value()");
  });

  it("emits else block with full-type binding", () => {
    const cpp = emit(`
      function getValue(): string | null => null
      function test(): int {
        x := getValue() else {
          println("got null")
          return 0
        }
        return x.length
      }
    `);
    // Inside the else block, x is bound to the temp
    expect(cpp).toMatch(/auto& x = _else\d+;/);
  });
});

// ============================================================================
// As expression — runtime narrowing to Result
// ============================================================================

describe("emitter — as expression", () => {
  it("emits identity narrowing as unconditional success", () => {
    const cpp = emit(`
      function test(x: string): Result<string, string> => x as string
    `);
    expect(cpp).toContain("::success(x)");
    // No IIFE needed for identity
    expect(cpp).not.toContain("[&]()");
  });

  it("emits nullable narrowing with has_value check", () => {
    const cpp = emit(`
      function test(x: int | null): Result<int, string> => x as int
    `);
    expect(cpp).toContain("has_value()");
    expect(cpp).toContain(".value()");
    expect(cpp).toContain("::success(");
    expect(cpp).toContain("::failure(");
  });

  it("emits union member narrowing with holds_alternative", () => {
    const cpp = emit(`
      function test(x: int | string): Result<string, string> => x as string
    `);
    expect(cpp).toContain("std::holds_alternative<std::string>");
    expect(cpp).toContain("std::get<std::string>");
  });

  it("emits interface→class narrowing with holds_alternative", () => {
    const cpp = emit(`
      interface Shape {
        area(): float
      }
      class Circle implements Shape {
        radius: float
        function area(): float => radius * radius
      }
      function test(s: Shape): Result<Circle, string> {
        return s as Circle
      }
    `);
    expect(cpp).toContain("std::holds_alternative<std::shared_ptr<Circle>>");
    expect(cpp).toContain("std::get<std::shared_ptr<Circle>>");
  });

  it("works with try binding on as expression", () => {
    const cpp = emit(`
      function test(x: int | string): Result<string, string> {
        try s := x as string
        return Success { value: s }
      }
    `);
    expect(cpp).toContain("std::holds_alternative<std::string>");
    expect(cpp).toContain("isFailure()");
  });

  it("works with try! on as expression", () => {
    const cpp = emit(`
      function test(x: int | string): string {
        s := try! x as string
        return s
      }
    `);
    expect(cpp).toContain("std::holds_alternative<std::string>");
    expect(cpp).toContain("doof::panic");
  });
});
