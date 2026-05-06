import { describe, it, expect } from "vitest";
import type {
  BinaryExpression, Identifier, FunctionDeclaration,
  ConstDeclaration, LetDeclaration, ClassDeclaration, ExpressionStatement,
} from "./ast.js";
import { validateEmitReadyDeclarations } from "./checker.js";
import { UNKNOWN_TYPE, typeToString } from "./checker-types.js";
import { check, findId, findTypes } from "./checker-test-helpers.js";

// ============================================================================
// Assignment validation
// ============================================================================

describe("Assignment validation", () => {
  it("accepts assignment to mutable variable", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let x = 42
            x = 99
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects assignment to const", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            const x = 42
            x = 99
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
    expect(info.diagnostics[0].message).toContain("constant");
  });

  it("rejects assignment to immutable binding", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            x := 42
            x = 99
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
  });

  it("rejects assignment to function parameter", () => {
    const info = check(
      { "/main.do": `function test(x: int): void { x = 42 }` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
  });

  it("rejects type-incompatible assignment", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let x = 42
            x = "hello"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("accepts yielding block reassignment to mutable variable", () => {
    const info = check(
      {
        "/main.do": `
          function test(flag: bool): void {
            let x = 42
            x <- {
              if flag {
                yield 99
              }
              yield 100
            }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects yielding block reassignment to const", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            const x = 42
            x <- { yield 99 }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
  });

  it("rejects yielding block reassignment to a parameter", () => {
    const info = check(
      {
        "/main.do": `
          function test(x: int): void {
            x <- { yield 42 }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
  });

  it("rejects <- declarations at module scope", () => {
    const info = check(
      {
        "/main.do": `
          const x <- { yield 42 }
        `,
      },
      "/main.do",
    );
    const diag = info.diagnostics.find((d) => d.message.includes("local declarations"));
    expect(diag).toBeDefined();
  });

  it("accepts widened type in assignment", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let x: double = 1.0
            x = 42
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects assignment to readonly field", () => {
    const info = check(
      {
        "/main.do": `
          class Point { readonly x: float; y: float }
          function test(p: Point): void {
            p.x = 1.0
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Cannot assign");
    expect(info.diagnostics[0].message).toContain("readonly field");
  });

  it("accepts assignment to mutable field", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x: float; y: float }
          function test(p: Point): void {
            p.y = 2.0f
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects assignment to readonly map entry", () => {
    const info = check(
      {
        "/main.do": `
          function test(m: ReadonlyMap<string, int>): void {
            m["x"] = 1
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("readonly map");
  });

  it("rejects readonly declarations of mutable classes", () => {
    const info = check(
      {
        "/main.do": `
          class Foo {
            x: int
          }

          readonly a = Foo { x: 1 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Readonly declaration requires a deeply immutable type");
    expect(info.diagnostics[0].message).toContain('field "x" is mutable');
  });

  it("accepts readonly declarations of deeply immutable classes", () => {
    const info = check(
      {
        "/main.do": `
          class Foo {
            readonly x: int
          }

          readonly a = Foo { x: 1 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects readonly fields whose element type is mutable", () => {
    const info = check(
      {
        "/main.do": `
          class Foo {
            x: int
          }

          class Test {
            readonly items: Foo[]
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('Readonly field "items" requires a deeply immutable type');
    expect(info.diagnostics[0].message).toContain('field "x" is mutable');
  });

  it("accepts readonly fields whose collection surface is implied readonly", () => {
    const info = check(
      {
        "/main.do": `
          class Foo {
            readonly x: int
          }

          class Test {
            readonly items: Foo[]
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts readonly fields with recursive JsonValue maps", () => {
    const info = check(
      {
        "/main.do": `
          class Jwt {
            readonly claims: readonly Map<string, JsonValue>
          }

          const jwt = Jwt {
            claims: { "ok": true }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects readonly fields that reference mutable classes transitively", () => {
    const info = check(
      {
        "/main.do": `
          class Bar {
            y: int
          }

          class Foo {
            readonly b: Bar
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('Readonly field "b" requires a deeply immutable type');
    expect(info.diagnostics[0].message).toContain('field "y" is mutable');
  });

  it("accepts tuple destructuring assignment to mutable variables", () => {
    const info = check(
      {
        "/main.do": `
          function pair(): Tuple<int, string> => (10, "ok")

          function test(): void {
            let count = 0
            let label = "";
            (count, label) = pair()
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts named destructuring assignment with aliases", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            x: int
            y: int
          }

          function test(p: Point): void {
            let px = 0
            let py = 0
            { x as px, y as py } = p
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects destructuring assignment to immutable targets", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            left := 0
            let right = 0;
            [left, right] = [1, 2]
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Cannot assign to "left"'))).toBe(true);
  });

  it("rejects destructuring assignment when a target is undefined", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            x: int
            y: int
          }

          function test(p: Point): void {
            let x = 0
            { x, y } = p
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Undefined identifier "y"'))).toBe(true);
  });

  it("rejects incompatible destructuring assignment target types", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            x: int
            y: int
          }

          function test(p: Point): void {
            let x = ""
            let y = 0
            { x, y } = p
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Type "int" is not assignable to type "string"'))).toBe(true);
  });

  it("rejects non-array destructuring assignment values", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let a = 0
            let b = 0;
            [a, b] = 42
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("Array destructuring requires a T[] value"))).toBe(true);
  });

  it("accepts try array destructuring assignment against the success payload", () => {
    const info = check(
      {
        "/main.do": `
          function load(): Result<int[], string> => Success([4, 5, 6])

          function test(): Result<int, string> {
            let first = 0
            let last = 0
            try [first, _, last] = load()
            return Success(first + last)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Declaration validation
// ============================================================================

describe("Declaration validation", () => {
  it("rejects duplicate const declaration in the same scope", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            const value = 1
            const value = 2
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("already declared"))).toBe(true);
  });

  it("rejects duplicate readonly declaration in the same scope", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            readonly value = 1
            readonly value = 2
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("already declared"))).toBe(true);
  });

  it("rejects duplicate let declaration in the same scope", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let value = 1
            let value = 2
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("already declared"))).toBe(true);
  });

  it("rejects duplicate immutable binding in the same scope", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }

          function test(): void {
            value := 12
            value := Point { x: 0.0, y: 0.0 }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("already declared"))).toBe(true);
  });

  it("allows nested scopes to shadow bindings", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            value := 1
            if true {
              value := 2
            }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("reports declarations that lose resolved types before emission", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            value := 42
          }
        `,
      },
      "/main.do",
    );

    const table = info.result.modules.get("/main.do")!;
    const fn = table.program.statements[0] as FunctionDeclaration;
    if (fn.body.kind !== "block") {
      throw new Error("Expected block body in test fixture");
    }
    const decl = fn.body.statements[0];
    if (decl.kind !== "immutable-binding") {
      throw new Error("Expected immutable binding in test fixture");
    }

    decl.resolvedType = UNKNOWN_TYPE;
    const validationInfo = {
      diagnostics: [] as typeof info.diagnostics,
    };
    validateEmitReadyDeclarations(table, validationInfo);

    expect(validationInfo.diagnostics.some((d) => d.message.includes("Cannot emit declaration \"value\" with unresolved type"))).toBe(true);
  });

  it("does not duplicate declaration emit blockers when a nested error already exists", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            value := missingValue
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Undefined identifier \"missingValue\""))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Cannot emit declaration \"value\""))).toBe(false);
  });

  it("reports expressions that lose resolved types before emission", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            println("hello")
          }
        `,
      },
      "/main.do",
    );

    const table = info.result.modules.get("/main.do")!;
    const fn = table.program.statements[0] as FunctionDeclaration;
    if (fn.body.kind !== "block") {
      throw new Error("Expected block body in test fixture");
    }
    const stmt = fn.body.statements[0];
    if (stmt.kind !== "expression-statement") {
      throw new Error("Expected expression statement in test fixture");
    }

    (stmt as ExpressionStatement).expression.resolvedType = UNKNOWN_TYPE;
    const validationInfo = {
      diagnostics: [] as typeof info.diagnostics,
    };
    validateEmitReadyDeclarations(table, validationInfo);

    expect(validationInfo.diagnostics.some((d) => d.message.includes("Cannot emit call expression with unresolved type"))).toBe(true);
  });

  it("does not duplicate expression emit blockers when a nested error already exists", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            println(missingValue)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Undefined identifier \"missingValue\""))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Cannot emit call expression"))).toBe(false);
  });

  it("does not mark imported calls with inferred return types as unresolved", () => {
    const info = check(
      {
        "/helper.do": `
          export function testAll() {
            return 1
          }
        `,
        "/main.do": `
          import { testAll } from "./helper"

          function run(): void {
            testAll()
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Cannot emit call expression with unresolved type"))).toBe(false);
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Condition type validation
// ============================================================================

describe("Condition type validation", () => {
  it("accepts bool condition in if statement", () => {
    const info = check(
      {
        "/main.do": `
          function test(x: bool): void {
            if x { return }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts comparison result as condition", () => {
    const info = check(
      {
        "/main.do": `
          function test(x: int): void {
            if x > 0 { return }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects non-bool condition in if statement", () => {
    const info = check(
      {
        "/main.do": `
          function test(x: int): void {
            if x { return }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Condition must be of type");
  });

  it("rejects non-bool condition in while statement", () => {
    const info = check(
      {
        "/main.do": `
          function test(x: int): void {
            while x { return }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Condition must be of type");
  });

  it("rejects non-bool condition in if expression", () => {
    const info = check(
      { "/main.do": `function test(x: int): int => if x then 1 else 0` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Condition must be of type");
  });

  it("accepts bool condition in if expression", () => {
    const info = check(
      { "/main.do": `function test(x: bool): int => if x then 1 else 0` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Logical operator validation
// ============================================================================

describe("Logical operator validation", () => {
  it("accepts bool operands for &&", () => {
    const info = check(
      { "/main.do": `function test(a: bool, b: bool): bool => a && b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects non-bool operands for &&", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): bool => a && b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("requires bool operands");
  });

  it("rejects non-bool operands for ||", () => {
    const info = check(
      { "/main.do": `function test(a: string, b: bool): bool => a || b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("requires bool operands");
  });
});

// ============================================================================
// Interface structural checking
// ============================================================================

describe("Interface structural checking", () => {
  it("class satisfies interface with matching fields", () => {
    const info = check(
      {
        "/main.do": `
          interface HasName { name: string }
          class User implements HasName {
            name: string
            age: int
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("class fails interface missing field", () => {
    const info = check(
      {
        "/main.do": `
          interface HasName { name: string }
          class Empty implements HasName {
            age: int
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("does not satisfy interface");
  });

  it("class satisfies interface with methods", () => {
    const info = check(
      {
        "/main.do": `
          interface Greetable { greet(name: string): string }
          class Greeter implements Greetable {
            greet(name: string): string => name
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("class fails interface missing method", () => {
    const info = check(
      {
        "/main.do": `
          interface Greetable { greet(name: string): string }
          class Silent implements Greetable {
            name: string
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("does not satisfy interface");
  });

  it("resolves member access on interface-typed parameter", () => {
    const info = check(
      {
        "/main.do": `
          interface HasName { name: string }
          class Person implements HasName { name: string }
          function getName(thing: HasName): string => thing.name
        `,
      },
      "/main.do",
    );
    // thing.name should resolve to string
    const strs = findTypes(info, (t) => t.kind === "primitive" && t.name === "string");
    expect(strs.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });

  it("class satisfies interface with static method contract", () => {
    const info = check(
      {
        "/main.do": `
          interface Describable { static describe(): string }
          class Rectangle implements Describable {
            static describe(): string => "rect"
          }
          function describe(value: Describable): string => value::describe()
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("class fails interface missing static method", () => {
    const info = check(
      {
        "/main.do": `
          interface Describable { static describe(): string }
          class Rectangle implements Describable {
            describe(): string => "rect"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("does not satisfy interface"))).toBe(true);
  });
});

// ============================================================================
// Class field default value validation
// ============================================================================

describe("Class field validation", () => {
  it("rejects field without type annotation or default value", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            z
            x, y: float
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Class field "z" must have a type annotation or a default value'))).toBe(true);
  });

  it("accepts compatible field default value", () => {
    const info = check(
      {
        "/main.do": `
          class Config {
            port: int = 8080
            host: string = "localhost"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible field default value", () => {
    const info = check(
      {
        "/main.do": `
          class Config {
            port: int = "not a port"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to field type");
  });

  it("rejects unsupported interpolated field default value", () => {
    const info = check(
      {
        "/main.do": `
          class Config {
            host: string = "http://\${"localhost"}"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("Field default value is not supported"))).toBe(true);
  });

  it("accepts Map field defaults with supported key types", () => {
    const info = check(
      {
        "/main.do": `
          enum Color { Red, Blue }

          class Config {
            names: Map<string, int> = { "alice": 1 }
            counts: Map<int, string> = { 1: "one" }
            ids: Map<long, string> = { 1L: "one" }
            palette: Map<Color, int> = { Color.Red: 1 }
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects Map field defaults with unsupported key types", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x: int }

          class Config {
            lookup: Map<Point, int> = {}
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Map key type "Point" is not supported'))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Field default value is not supported"))).toBe(true);
  });

  it("accepts Set field defaults with supported element types", () => {
    const info = check(
      {
        "/main.do": `
          enum Color { Red, Blue }

          class Config {
            names: Set<string> = ["alice"]
            ids: Set<long> = [1, 2]
            palette: Set<Color> = [Color.Red]
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects Set field defaults with unsupported element types", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x: int }

          class Config {
            lookup: Set<Point> = []
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Set element type "Point" is not supported'))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Field default value is not supported"))).toBe(true);
  });
});

// ============================================================================
// Tuple field access
// ============================================================================

describe("Tuple field access", () => {
  it("infers tuple literal type", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let t = (1, "hello", true)
          }
        `,
      },
      "/main.do",
    );
    const tuples = findTypes(info, (t) => t.kind === "tuple");
    expect(tuples.length).toBeGreaterThanOrEqual(1);
    const tup = tuples[0];
    if (tup.kind === "tuple") {
      expect(tup.elements.length).toBe(3);
      expect(typeToString(tup.elements[0])).toBe("int");
      expect(typeToString(tup.elements[1])).toBe("string");
      expect(typeToString(tup.elements[2])).toBe("bool");
    }
  });
});

// ============================================================================
// Lambda validation
// ============================================================================

describe("Lambda type validation", () => {
  it("accepts compatible lambda return type", () => {
    const info = check(
      { "/main.do": `const fn = (x: int): int => x * 2` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible lambda return type", () => {
    const info = check(
      { "/main.do": `const fn = (x: int): string => x * 2` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to return type");
  });

  it("validates return statement in lambda block body", () => {
    const info = check(
      {
        "/main.do": `
          const fn = (x: int): int {
            return "not an int"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to return type");
  });
});

// ============================================================================
// Numeric widening in expressions
// ============================================================================

describe("Numeric widening in expressions", () => {
  it("widens int + long to long", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: long): long => a + b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("widens int + double to double", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: double): double => a + b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("widens float + double to double", () => {
    const info = check(
      { "/main.do": `function test(a: float, b: double): double => a + b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("widens int + float to float", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: float): float => a + b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

describe("Binary operator union operand validation", () => {
  it("rejects nullable union operands in arithmetic", () => {
    const info = check(
      {
        "/main.do": `
          function main(): int {
            x: int | null := null
            println(x + 3)
            return 0
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Operator "+" cannot be applied to union type "int | null"'))).toBe(true);
  });

  it("rejects mixed union operands even when one member is numeric", () => {
    const info = check(
      { "/main.do": `function test(x: int | float): float => x + 1.0f` },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Operator "+" cannot be applied to union type "int | float"'))).toBe(true);
  });

  it("rejects string concatenation when the non-string side is a union", () => {
    const info = check(
      { "/main.do": `function test(x: int | string): string => x + "!"` },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Operator "+" cannot be applied to union type "int | string"'))).toBe(true);
  });
});

// ============================================================================
// Integer division and modulo operator validation
// ============================================================================

describe("Integer division and modulo validation", () => {
  it("errors on / with two int operands", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): int => a / b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "/" cannot be applied to two integer operands');
  });

  it("errors on / with two long operands", () => {
    const info = check(
      { "/main.do": `function test(a: long, b: long): long => a / b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "/" cannot be applied to two integer operands');
  });

  it("allows / with float operands", () => {
    const info = check(
      { "/main.do": `function test(a: float, b: float): float => a / b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows / with double operands", () => {
    const info = check(
      { "/main.do": `function test(a: double, b: double): double => a / b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows / with mixed int and float (widened to float)", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: float): float => a / b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows \\\\ with two int operands", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): int => a \\ b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows \\\\ with two long operands", () => {
    const info = check(
      { "/main.do": `function test(a: long, b: long): long => a \\ b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on \\\\ with float operands", () => {
    const info = check(
      { "/main.do": `function test(a: float, b: float): float => a \\ b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "\\" requires integer operands');
  });

  it("errors on \\\\ with mixed int and double", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: double): double => a \\ b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "\\" requires integer operands');
  });

  it("errors on % with float operands", () => {
    const info = check(
      { "/main.do": `function test(a: float, b: float): float => a % b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "%" requires integer operands');
  });

  it("errors on % with double operands", () => {
    const info = check(
      { "/main.do": `function test(a: double, b: double): double => a % b` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Operator "%" requires integer operands');
  });

  it("allows % with int operands", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): int => a % b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows % with long operands", () => {
    const info = check(
      { "/main.do": `function test(a: long, b: long): long => a % b` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Numeric cast validation
// ============================================================================

describe("Numeric cast validation", () => {
  it("casts int to float", () => {
    const info = check(
      { "/main.do": `function test(x: int): float => float(x)` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("casts float to int", () => {
    const info = check(
      { "/main.do": `function test(x: float): int => int(x)` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("casts int to double", () => {
    const info = check(
      { "/main.do": `function test(x: int): double => double(x)` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("casts double to long", () => {
    const info = check(
      { "/main.do": `function test(x: double): long => long(x)` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on non-numeric cast argument", () => {
    const info = check(
      { "/main.do": `function test(x: string): int => int(x)` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain("Cannot cast");
  });

  it("errors on wrong argument count for cast", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): float => float(a, b)` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain("requires exactly 1 argument");
  });

  it("allows numeric cast in division expression", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): float => float(a) / float(b)` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("does not treat a user-defined function named double as a numeric cast", () => {
    const info = check(
      {
        "/main.do": `
          function double(x: int): int => x * 2
          function test(): int => double(21)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Null safety
// ============================================================================

describe("Null safety", () => {
  it("accepts null in nullable union", () => {
    const info = check(
      {
        "/main.do": `
          function test(): int | null {
            return null
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts value in nullable union", () => {
    const info = check(
      {
        "/main.do": `
          function test(): int | null {
            return 42
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects null for non-nullable return type", () => {
    const info = check(
      {
        "/main.do": `
          function test(): int {
            return null
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("reduces nullable enum unions with null coalescing", () => {
    const { diagnostics, program } = check(
      {
        "/main.do": `
          enum Suit { Spades = 0, Hearts = 1, Diamonds = 2, Clubs = 3 }
          function foundationSuit(index: int): Suit {
            return Suit.fromValue(index) ?? .Spades
          }
        `,
      },
      "/main.do",
    );

    expect(diagnostics).toHaveLength(0);

    const fnDecl = program.statements[1] as FunctionDeclaration;
    const returnStmt = (fnDecl.body as { statements: Array<{ value: BinaryExpression }> }).statements[0];
    const bodyExpr = returnStmt.value;
    expect(bodyExpr.operator).toBe("??");
    expect(typeToString(bodyExpr.left.resolvedType!)).toBe("Suit | null");
    expect(typeToString(bodyExpr.resolvedType!)).toBe("Suit");
  });
});

// ============================================================================
// Cross-module type checking
// ============================================================================

describe("Cross-module type checking", () => {
  it("validates argument types for imported functions", () => {
    const info = check(
      {
        "/main.do": `
          import { createUser } from "./user"
          const u = createUser("Alice", 30)
        `,
        "/user.do": `
          export class User { name: string; age: int }
          export function createUser(name: string, age: int): User {
            return User(name, age)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects wrong argument types for imported functions", () => {
    const info = check(
      {
        "/main.do": `
          import { createUser } from "./user"
          const u = createUser(42, "not an age")
        `,
        "/user.do": `
          export class User { name: string; age: int }
          export function createUser(name: string, age: int): User {
            return User(name, age)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to parameter");
  });

  it("validates field access types on imported classes", () => {
    const info = check(
      {
        "/main.do": `
          import { User } from "./user"
          function getAge(u: User): int => u.age
        `,
        "/user.do": `export class User { name: string; age: int }`,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Comprehensive end-to-end scenario
// ============================================================================

describe("End-to-end type checking scenario", () => {
  it("validates a full module with multiple features", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }

          function distance(a: Point, b: Point): float {
            let dx = b.x - a.x
            let dy = b.y - a.y
            return dx * dx + dy * dy
          }

          function isClose(a: Point, b: Point): bool {
            return distance(a, b) < 1.0
          }

          const origin = Point(0.0, 0.0)
          const unit = Point(1.0, 1.0)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("catches multiple errors in a module", () => {
    const info = check(
      {
        "/main.do": `
          function bad1(): int => "hello"
          function bad2(x: int): void {
            let y: string = 42
          }
        `,
      },
      "/main.do",
    );
    // Should have at least 2 errors
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  it("handles method calls with type checking", () => {
    const info = check(
      {
        "/main.do": `
          class Calculator {
            value: int
            add(n: int): int => value + n
            multiply(n: int): int => value * n
          }

          function compute(calc: Calculator): int {
            let sum = calc.add(5)
            let product = calc.multiply(3)
            return sum + product
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("validates for-of loop element types", () => {
    const info = check(
      {
        "/main.do": `
          function sum(items: int[]): int {
            let total = 0
            for item of items {
              total = total + item
            }
            return total
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("validates enum usage", () => {
    const info = check(
      {
        "/main.do": `
          enum Color { Red, Green, Blue }
          function isRed(c: Color): bool => c == Color.Red
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("validates a multi-module system", () => {
    const info = check(
      {
        "/app/main.do": `
          import { Vector, add } from "./math"
          import { Config } from "./config"

          function main(): void {
            let v = Vector(1.0, 2.0)
            let sum = add(1, 2)
            let cfg = Config("app", true)
          }
        `,
        "/app/math.do": `
          export class Vector { x, y: float }
          export function add(a: int, b: int): int => a + b
        `,
        "/app/config.do": `
          export class Config { name: string; debug: bool }
        `,
      },
      "/app/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// AST decoration tests
// ============================================================================

describe("AST decoration — expression resolvedType", () => {
  it("decorates int literal with resolvedType", () => {
    const { program } = check({ "/main.do": `const x = 42` }, "/main.do");
    const constDecl = program.statements[0] as ConstDeclaration;
    expect(constDecl.value.resolvedType).toBeDefined();
    expect(constDecl.value.resolvedType!.kind).toBe("primitive");
    if (constDecl.value.resolvedType!.kind === "primitive") {
      expect(constDecl.value.resolvedType!.name).toBe("int");
    }
  });

  it("decorates string literal with resolvedType", () => {
    const { program } = check({ "/main.do": `const s = "hello"` }, "/main.do");
    const constDecl = program.statements[0] as ConstDeclaration;
    expect(constDecl.value.resolvedType).toBeDefined();
    expect(typeToString(constDecl.value.resolvedType!)).toBe("string");
  });

  it("decorates binary expression and its operands", () => {
    const { program } = check(
      { "/main.do": `const x = 1 + 2` },
      "/main.do",
    );
    const constDecl = program.statements[0] as ConstDeclaration;
    const binExpr = constDecl.value as BinaryExpression;
    // The binary expression itself should be typed
    expect(binExpr.resolvedType).toBeDefined();
    expect(typeToString(binExpr.resolvedType!)).toBe("int");
    // Its operands should also be typed
    expect(binExpr.left.resolvedType).toBeDefined();
    expect(typeToString(binExpr.left.resolvedType!)).toBe("int");
    expect(binExpr.right.resolvedType).toBeDefined();
    expect(typeToString(binExpr.right.resolvedType!)).toBe("int");
  });

  it("decorates string concatenation and shows operand types", () => {
    const { program } = check(
      { "/main.do": `const x = "hello" + 42` },
      "/main.do",
    );
    const constDecl = program.statements[0] as ConstDeclaration;
    const binExpr = constDecl.value as BinaryExpression;
    expect(typeToString(binExpr.resolvedType!)).toBe("string");
    expect(typeToString(binExpr.left.resolvedType!)).toBe("string");
    expect(typeToString(binExpr.right.resolvedType!)).toBe("int");
  });

  it("decorates call expression with return type", () => {
    const { program } = check(
      {
        "/main.do": `
          function add(a: int, b: int): int => a + b
          const x = add(1, 2)
        `,
      },
      "/main.do",
    );
    const constDecl = program.statements[1] as ConstDeclaration;
    expect(constDecl.value.resolvedType).toBeDefined();
    expect(typeToString(constDecl.value.resolvedType!)).toBe("int");
  });
});

describe("AST decoration — identifier resolvedBinding", () => {
  it("decorates identifier with its binding", () => {
    const { program } = check(
      {
        "/main.do": `
          const x = 42
          const y = x
        `,
      },
      "/main.do",
    );
    const yDecl = program.statements[1] as ConstDeclaration;
    const ident = yDecl.value as Identifier;
    expect(ident.resolvedBinding).toBeDefined();
    expect(ident.resolvedBinding!.name).toBe("x");
    expect(ident.resolvedBinding!.kind).toBe("const");
    expect(typeToString(ident.resolvedBinding!.type)).toBe("int");
  });

  it("decorates import identifier with import binding", () => {
    const { program } = check(
      {
        "/main.do": `
          import { Vector } from "./math"
          const v = Vector(1.0, 2.0)
        `,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );
    const constDecl = program.statements[1] as ConstDeclaration;
    // The callee of the call expression is the identifier
    if (constDecl.value.kind === "call-expression") {
      const callee = constDecl.value.callee as Identifier;
      expect(callee.resolvedBinding).toBeDefined();
      expect(callee.resolvedBinding!.kind).toBe("import");
      expect(callee.resolvedBinding!.type.kind).toBe("class");
    }
  });
});

describe("AST decoration — variable declaration resolvedType", () => {
  it("decorates const declaration with resolved type", () => {
    const { program } = check({ "/main.do": `const x = 42` }, "/main.do");
    const constDecl = program.statements[0] as ConstDeclaration;
    expect(constDecl.resolvedType).toBeDefined();
    expect(typeToString(constDecl.resolvedType!)).toBe("int");
  });

  it("decorates let declaration with declared type", () => {
    const { program } = check(
      { "/main.do": `function f(): void { let x: float = 1.0 }` },
      "/main.do",
    );
    const fnDecl = program.statements[0] as FunctionDeclaration;
    if (fnDecl.body.kind === "block") {
      const letDecl = fnDecl.body.statements[0] as LetDeclaration;
      expect(letDecl.resolvedType).toBeDefined();
      expect(typeToString(letDecl.resolvedType!)).toBe("float");
    }
  });
});

describe("AST decoration — function and parameter resolvedType", () => {
  it("decorates function declaration with full function type", () => {
    const { program } = check(
      { "/main.do": `function add(a: int, b: int): int => a + b` },
      "/main.do",
    );
    const fnDecl = program.statements[0] as FunctionDeclaration;
    expect(fnDecl.resolvedType).toBeDefined();
    expect(fnDecl.resolvedType!.kind).toBe("function");
    if (fnDecl.resolvedType!.kind === "function") {
      expect(fnDecl.resolvedType!.params).toHaveLength(2);
      expect(typeToString(fnDecl.resolvedType!.returnType)).toBe("int");
    }
  });

  it("decorates parameters with resolved types", () => {
    const { program } = check(
      { "/main.do": `function greet(name: string, count: int): void {}` },
      "/main.do",
    );
    const fnDecl = program.statements[0] as FunctionDeclaration;
    expect(fnDecl.params[0].resolvedType).toBeDefined();
    expect(typeToString(fnDecl.params[0].resolvedType!)).toBe("string");
    expect(fnDecl.params[1].resolvedType).toBeDefined();
    expect(typeToString(fnDecl.params[1].resolvedType!)).toBe("int");
  });

  it("decorates method parameters with resolved types", () => {
    const { program } = check(
      {
        "/main.do": `
          class Calculator {
            function add(a: int, b: int): int => a + b
          }
        `,
      },
      "/main.do",
    );
    const classDecl = program.statements[0] as ClassDeclaration;
    const method = classDecl.methods[0];
    expect(method.params[0].resolvedType).toBeDefined();
    expect(typeToString(method.params[0].resolvedType!)).toBe("int");
    expect(method.resolvedType).toBeDefined();
    expect(method.resolvedType!.kind).toBe("function");
  });
});

describe("AST decoration — class field resolvedType", () => {
  it("decorates class fields with resolved types", () => {
    const { program } = check(
      {
        "/main.do": `
          class Point {
            x, y: float
            label: string
          }
        `,
      },
      "/main.do",
    );
    const classDecl = program.statements[0] as ClassDeclaration;
    expect(classDecl.fields[0].resolvedType).toBeDefined();
    expect(typeToString(classDecl.fields[0].resolvedType!)).toBe("float");
    expect(classDecl.fields[1].resolvedType).toBeDefined();
    expect(typeToString(classDecl.fields[1].resolvedType!)).toBe("string");
  });
});

describe("AST decoration — end-to-end compilation readiness", () => {
  it("full expression tree has types for compilation", () => {
    const { program } = check(
      {
        "/main.do": `
          function compute(x: int, y: float): float => x + y
          const result = compute(1, 2.0)
        `,
      },
      "/main.do",
    );

    // Function declaration is decorated
    const fnDecl = program.statements[0] as FunctionDeclaration;
    expect(fnDecl.resolvedType).toBeDefined();
    expect(fnDecl.resolvedType!.kind).toBe("function");

    // Parameters are decorated
    expect(fnDecl.params[0].resolvedType).toBeDefined();
    expect(fnDecl.params[1].resolvedType).toBeDefined();

    // Function body expression is decorated (the `x + y` binary expr)
    if (fnDecl.body.kind !== "block") {
      const bodyExpr = fnDecl.body as BinaryExpression;
      expect(bodyExpr.resolvedType).toBeDefined();
      expect(bodyExpr.left.resolvedType).toBeDefined();
      expect(bodyExpr.right.resolvedType).toBeDefined();
    }

    // Const declaration is decorated
    const constDecl = program.statements[1] as ConstDeclaration;
    expect(constDecl.resolvedType).toBeDefined();
    // The call expression is decorated
    expect(constDecl.value.resolvedType).toBeDefined();
  });

  it("numeric widening is visible on operands and result", () => {
    const { program } = check(
      { "/main.do": `const x = 1 + 2.0` },
      "/main.do",
    );
    const constDecl = program.statements[0] as ConstDeclaration;
    const binExpr = constDecl.value as BinaryExpression;
    // Result is widened
    expect(typeToString(binExpr.resolvedType!)).toBe("double");
    // But operands retain their original types
    expect(typeToString(binExpr.left.resolvedType!)).toBe("int");
    expect(typeToString(binExpr.right.resolvedType!)).toBe("double");
  });
});

describe("Mock validation", () => {
  it("rejects .calls on non-mock functions", () => {
    const info = check(
      {
        "/main.do": `
          function sendPayment(targetId: string, amount: int): bool => true

          function main(): int {
            return sendPayment.calls.length
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes('Property "calls" is only available on mock functions and mock methods'))).toBe(true);
  });

  it("rejects unsupported generic and static mock declarations", () => {
    const info = check(
      {
        "/main.do": `
          mock function wrap<T>(value: T): T => value

          mock class Gateway<T> {
            static sendPayment(targetId: string): void {
              return
            }

            refund<U>(targetId: U): void {
              return
            }
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Generic mock functions are not supported yet"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Generic mock classes are not supported yet"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Static mock methods are not supported yet"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Generic mock methods are not supported yet"))).toBe(true);
  });
});

describe("Collection member validation", () => {
  it("rejects unknown methods on arrays", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            items := [1, 2, 3]
            println(items.boom())
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes('Property "boom" does not exist on type "int[]"'))).toBe(true);
  });

  it("accepts known array methods", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            items := [1, 2, 3]
            length := items.length
            items.push(4)
            result := items.pop()
            contains := items.contains(2)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("rejects unknown methods on maps", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            m: Map<string, int> := {}
            result := m.boom()
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes('Property "boom" does not exist on type "Map<string, int>"'))).toBe(true);
  });

  it("accepts known map methods", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            m: Map<string, int> := {}
            size := m.size
            m.set("key", 42)
            result := m.get("key")
            has := m.has("key")
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("rejects unknown methods on sets", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            s: Set<int> := []
            result := s.boom()
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes('Property "boom" does not exist on type "Set<int>"'))).toBe(true);
  });

  it("accepts known set methods", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            s: Set<int> := []
            size := s.size
            s.add(42)
            has := s.has(42)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("rejects unknown methods on strings", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            s := "hello"
            result := s.boom()
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes('Property "boom" does not exist on type "string"'))).toBe(true);
  });

  it("accepts known string methods", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            s := "hello"
            length := s.length
            contains := s.contains("ll")
            index := s.indexOf("l")
            upper := s.toUpperCase()
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});
