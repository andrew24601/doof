import { describe, it, expect } from "vitest";
import { typeToString } from "./checker-types.js";
import { check, collectExprs, findId, findTypes } from "./checker-test-helpers.js";

// ============================================================================
// Literal type inference
// ============================================================================

describe("Literal type inference", () => {
  it("infers int for integer literals", () => {
    const info = check({ "/main.do": `const x = 42` }, "/main.do");
    const ints = findTypes(info, (t) => t.kind === "primitive" && t.name === "int");
    expect(ints.length).toBeGreaterThanOrEqual(1);
  });

  it("infers double for decimal literals", () => {
    const info = check({ "/main.do": `const x = 3.14` }, "/main.do");
    const doubles = findTypes(info, (t) => t.kind === "primitive" && t.name === "double");
    expect(doubles.length).toBeGreaterThanOrEqual(1);
  });

  it("infers string for string literals", () => {
    const info = check({ "/main.do": `const x = "hello"` }, "/main.do");
    const strs = findTypes(info, (t) => t.kind === "primitive" && t.name === "string");
    expect(strs.length).toBeGreaterThanOrEqual(1);
  });

  it("infers bool for boolean literals", () => {
    const info = check({ "/main.do": `const x = true` }, "/main.do");
    const bools = findTypes(info, (t) => t.kind === "primitive" && t.name === "bool");
    expect(bools.length).toBeGreaterThanOrEqual(1);
  });

  it("infers null for null literals", () => {
    const info = check({ "/main.do": `const x = null` }, "/main.do");
    const nulls = findTypes(info, (t) => t.kind === "null");
    expect(nulls.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Variable type inference
// ============================================================================

describe("Variable type inference", () => {
  it("infers const type from initializer", () => {
    const info = check({ "/main.do": `const PI = 3.14` }, "/main.do");
    const bindings = findId(info, "PI");
    // PI itself won't appear as an identifier *reference* unless used,
    // but we can check expression types.
    const doubles = findTypes(info, (t) => t.kind === "primitive" && t.name === "double");
    expect(doubles.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });

  it("uses explicit type annotation over inference", () => {
    const info = check(
      { "/main.do": `function foo(): void { let x: double = 42 }` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers let variable type from initializer", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let count = 0
            let name = "alice"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Identifier resolution
// ============================================================================

describe("Identifier resolution", () => {
  it("resolves identifier to const binding", () => {
    const info = check(
      {
        "/main.do": `
          const x = 42
          const y = x
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("const");
    expect(typeToString(refs[0].type)).toBe("int");
  });

  it("resolves identifier to function parameter", () => {
    const info = check(
      { "/main.do": `function double(n: int): int => n * 2` },
      "/main.do",
    );
    const refs = findId(info, "n");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("parameter");
    expect(typeToString(refs[0].type)).toBe("int");
  });

  it("resolves identifier to let binding", () => {
    const info = check(
      {
        "/main.do": `
          function test(): int {
            let x = 42
            return x
          }
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("let");
    expect(refs[0].mutable).toBe(true);
    expect(typeToString(refs[0].type)).toBe("int");
  });

  it("resolves identifier to function binding", () => {
    const info = check(
      {
        "/main.do": `
          function add(a: int, b: int): int => a + b
          const result = add(1, 2)
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "add");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("function");
    expect(refs[0].type.kind).toBe("function");
  });

  it("resolves identifier to class binding", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }
          const p = Point(1.0, 2.0)
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "Point");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("class");
  });

  it("resolves identifier to import binding", () => {
    const info = check(
      {
        "/main.do": `
          import { Vector } from "./math"
          const v = Vector(1.0, 2.0)
        `,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );
    const refs = findId(info, "Vector");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("import");
    expect(refs[0].type.kind).toBe("class");
  });

  it("reports error for undefined identifier", () => {
    const info = check(
      { "/main.do": `function foo(): int => nonexistent` },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("Undefined identifier"))).toBe(true);
  });
});

// ============================================================================
// Function and parameter types
// ============================================================================

describe("Function and parameter types", () => {
  it("resolves parameter types in expression body", () => {
    const info = check(
      { "/main.do": `function add(a: int, b: int): int => a + b` },
      "/main.do",
    );
    const aRefs = findId(info, "a");
    const bRefs = findId(info, "b");
    expect(aRefs.length).toBeGreaterThanOrEqual(1);
    expect(bRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(aRefs[0].type)).toBe("int");
    expect(typeToString(bRefs[0].type)).toBe("int");
  });

  it("resolves parameter types in block body", () => {
    const info = check(
      {
        "/main.do": `
          function greet(name: string): string {
            return name
          }
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "name");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("parameter");
    expect(typeToString(refs[0].type)).toBe("string");
  });

  it("infers return type from expression body", () => {
    const info = check(
      {
        "/main.do": `
          function double(x: int) => x * 2
          const result = double(5)
        `,
      },
      "/main.do",
    );
    // The call to double should return int (inferred from x * 2)
    const ints = findTypes(info, (t) => t.kind === "primitive" && t.name === "int");
    expect(ints.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves function type with multiple parameters", () => {
    const info = check(
      {
        "/main.do": `
          function clamp(value: int, lo: int, hi: int): int {
            if value < lo { return lo }
            if value > hi { return hi }
            return value
          }
        `,
      },
      "/main.do",
    );
    const valueRefs = findId(info, "value");
    const loRefs = findId(info, "lo");
    const hiRefs = findId(info, "hi");
    expect(valueRefs.length).toBeGreaterThanOrEqual(1);
    expect(loRefs.length).toBeGreaterThanOrEqual(1);
    expect(hiRefs.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Class field and method types
// ============================================================================

describe("Class field and method types", () => {
  it("resolves field access via implicit this in methods", () => {
    const info = check(
      {
        "/main.do": `
          class Counter {
            count: int
            getCount(): int => count
          }
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "count");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("field");
    expect(typeToString(refs[0].type)).toBe("int");
  });

  it("resolves parameter shadowing field in method", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            x: float
            setX(x: float): void {
              return
            }
          }
        `,
      },
      "/main.do",
    );
    // In setX, 'x' refers to the parameter, not the field
    // (No body reference to x in this case, but the parameter is set up correctly)
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves multiple fields of the same type", () => {
    const info = check(
      {
        "/main.do": `
          class Vector {
            x, y, z: float
            magnitude(): float => x * x + y * y + z * z
          }
        `,
      },
      "/main.do",
    );
    const xRefs = findId(info, "x");
    const yRefs = findId(info, "y");
    const zRefs = findId(info, "z");
    expect(xRefs.length).toBeGreaterThanOrEqual(1);
    expect(yRefs.length).toBeGreaterThanOrEqual(1);
    expect(zRefs.length).toBeGreaterThanOrEqual(1);
    expect(xRefs[0].kind).toBe("field");
    expect(typeToString(xRefs[0].type)).toBe("float");
  });

  it("does not expose fields in static methods", () => {
    const info = check(
      {
        "/main.do": `
          class Utils {
            count: int
            static create(): int => count
          }
        `,
      },
      "/main.do",
    );
    // 'count' should be undefined in the static method
    expect(info.diagnostics.some((d) => d.message.includes("Undefined identifier"))).toBe(true);
  });

  it("resolves member expression on class instance", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }
          function getX(p: Point): float => p.x
        `,
      },
      "/main.do",
    );
    // p.x should resolve to float
    const floats = findTypes(info, (t) => t.kind === "primitive" && t.name === "float");
    expect(floats.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves qualified static access on class instance", () => {
    const info = check(
      {
        "/main.do": `
          class Rectangle {
            width: float
            static kind = "Rect"
          }
          function getKind(rect: Rectangle): string => rect::kind
        `,
      },
      "/main.do",
    );
    const strs = findTypes(info, (t) => t.kind === "primitive" && t.name === "string");
    expect(strs.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on instance dot access to static member", () => {
    const info = check(
      {
        "/main.do": `
          class Rectangle {
            static doIt(): void { }
          }
          function bad(rect: Rectangle): void {
            rect.doIt()
          }
        `,
      },
      "/main.do",
    );
        expect(info.diagnostics.some((d) => d.message.toLowerCase().includes("static") && d.message.includes("doIt"))).toBe(true);
  });

  it("errors on class dot access to instance method", () => {
    const info = check(
      {
        "/main.do": `
          class Rectangle {
            doIt(): void { }
          }
          function bad(): void {
            Rectangle.doIt()
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("instance") && d.message.includes("doIt"))).toBe(true);
  });

  it("errors on class dot access to const field", () => {
    const info = check(
      {
        "/main.do": `
          class Rectangle {
            const kind = "Rect"
          }
          function bad(): string {
            return Rectangle.kind
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("instance") && d.message.includes("kind"))).toBe(true);
  });

  it("errors on qualified access to const field", () => {
    const info = check(
      {
        "/main.do": `
          class Rectangle {
            width: float
            const kind = "Rect"
          }
          function bad(rect: Rectangle): string => rect::kind
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("instance") && d.message.includes("kind"))).toBe(true);
  });
});

// ============================================================================
// Expression type inference
// ============================================================================

describe("Expression type inference", () => {
  it("infers comparison operators as bool", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: int): bool => a < b` },
      "/main.do",
    );
    const bools = findTypes(info, (t) => t.kind === "primitive" && t.name === "bool");
    expect(bools.length).toBeGreaterThanOrEqual(1);
  });

  it("infers logical operators as bool", () => {
    const info = check(
      { "/main.do": `function test(a: bool, b: bool): bool => a && b` },
      "/main.do",
    );
    const bools = findTypes(info, (t) => t.kind === "primitive" && t.name === "bool");
    expect(bools.length).toBeGreaterThanOrEqual(1);
  });

  it("infers negation as bool", () => {
    const info = check(
      { "/main.do": `function test(a: bool): bool => !a` },
      "/main.do",
    );
    const bools = findTypes(info, (t) => t.kind === "primitive" && t.name === "bool");
    expect(bools.length).toBeGreaterThanOrEqual(1);
  });

  it("infers string concatenation", () => {
    const info = check(
      { "/main.do": `function test(a: string, b: string): string => a + b` },
      "/main.do",
    );
    const strs = findTypes(info, (t) => t.kind === "primitive" && t.name === "string");
    expect(strs.length).toBeGreaterThanOrEqual(1);
  });

  it("widens numeric types in arithmetic", () => {
    const info = check(
      { "/main.do": `function test(a: int, b: double): double => a + b` },
      "/main.do",
    );
    const doubles = findTypes(info, (t) => t.kind === "primitive" && t.name === "double");
    expect(doubles.length).toBeGreaterThanOrEqual(1);
  });

  it("infers array literal type", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let nums = [1, 2, 3]
          }
        `,
      },
      "/main.do",
    );
    const arrays = findTypes(info, (t) => t.kind === "array");
    expect(arrays.length).toBeGreaterThanOrEqual(1);
    const arr = arrays[0];
    if (arr.kind === "array") {
      expect(typeToString(arr.elementType)).toBe("int");
    }
  });

  it("infers enum shorthand inside contextually typed array literals", () => {
    const info = check(
      {
        "/main.do": `
          enum Suit { Spades, Hearts, Diamonds, Clubs }
          function main(): void {
            let suits: Suit[] = [.Spades, .Hearts, .Diamonds, .Clubs]
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);

    const exprs = collectExprs(info.program);
    const shorthandExprs = exprs.filter((expr) => expr.kind === "dot-shorthand");
    expect(shorthandExprs).toHaveLength(4);
    for (const expr of shorthandExprs) {
      expect(expr.resolvedType?.kind).toBe("enum");
      if (expr.resolvedType?.kind === "enum") {
        expect(expr.resolvedType.symbol.name).toBe("Suit");
      }
    }

    const arrayLit = exprs.find((expr) => expr.kind === "array-literal");
    expect(arrayLit?.resolvedType?.kind).toBe("array");
    if (arrayLit?.resolvedType?.kind === "array") {
      expect(arrayLit.resolvedType.elementType.kind).toBe("enum");
      if (arrayLit.resolvedType.elementType.kind === "enum") {
        expect(arrayLit.resolvedType.elementType.symbol.name).toBe("Suit");
      }
    }
  });

  it("infers union element types for heterogeneous array literals", () => {
    const info = check(
      {
        "/main.do": `
          function main(): void {
            values := ["task", true, 3]
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);

    const exprs = collectExprs(info.program);
    const arrayLit = exprs.find((expr) => expr.kind === "array-literal");
    expect(arrayLit?.resolvedType?.kind).toBe("array");
    if (arrayLit?.resolvedType?.kind === "array") {
      expect(typeToString(arrayLit.resolvedType.elementType)).toBe("string | bool | int");
    }
  });

  it("infers array index type", () => {
    const info = check(
      {
        "/main.do": `
          function first(items: int[]): int => items[0]
        `,
      },
      "/main.do",
    );
    // items[0] should produce int
    const ints = findTypes(info, (t) => t.kind === "primitive" && t.name === "int");
    expect(ints.length).toBeGreaterThanOrEqual(1);
  });

  it("infers array destructuring binding types and skips discards", () => {
    const info = check(
      {
        "/main.do": `
          function total(): int {
            [a, _, c] := [10, 20, 30]
            return a + c
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);
    const aRefs = findId(info, "a");
    const cRefs = findId(info, "c");
    expect(aRefs.length).toBeGreaterThanOrEqual(1);
    expect(cRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(aRefs[0].type)).toBe("int");
    expect(typeToString(cRefs[0].type)).toBe("int");
  });

  it("infers tuple positional destructuring binding types and skips discards", () => {
    const info = check(
      {
        "/main.do": `
          function pair(): Tuple<int, string, int> => (10, "skip", 30)
          function total(): int {
            (a, _, c) := pair()
            return a + c
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);
    const aRefs = findId(info, "a");
    const cRefs = findId(info, "c");
    expect(aRefs.length).toBeGreaterThanOrEqual(1);
    expect(cRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(aRefs[0].type)).toBe("int");
    expect(typeToString(cRefs[0].type)).toBe("int");
  });

  it("infers class positional destructuring binding types and skips discards", () => {
    const info = check(
      {
        "/main.do": `
          class Point {
            x: int
            y: int
            z: int
          }

          function main(): void {
            (x, _, z) := Point(1, 2, 3)
            println(x)
            println(z)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);
    const xRefs = findId(info, "x");
    const zRefs = findId(info, "z");
    expect(xRefs.length).toBeGreaterThanOrEqual(1);
    expect(zRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(xRefs[0].type)).toBe("int");
    expect(typeToString(zRefs[0].type)).toBe("int");
  });

  it("retypes try array destructuring bindings from the success payload", () => {
    const info = check(
      {
        "/main.do": `
          function load(): Result<int[], string> => Success([4, 5, 6])

          function total(): Result<int, string> {
            try [a, _, c] := load()
            return Success(a + c)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics).toHaveLength(0);
    const aRefs = findId(info, "a");
    const cRefs = findId(info, "c");
    expect(aRefs.length).toBeGreaterThanOrEqual(1);
    expect(cRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(aRefs[0].type)).toBe("int");
    expect(typeToString(cRefs[0].type)).toBe("int");
  });

  it("reports a diagnostic for non-array destructuring values", () => {
    const info = check(
      {
        "/main.do": `
          function main(): void {
            [a, b] := 42
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Array destructuring requires a T[] value"))).toBe(true);
  });

  it("reports a diagnostic when try unwraps a non-array success payload", () => {
    const info = check(
      {
        "/main.do": `
          function load(): Result<int, string> => Success(42)

          function main(): Result<int, string> {
            try [value] := load()
            return Success(value)
          }
        `,
      },
      "/main.do",
    );

    expect(info.diagnostics.some((d) => d.message.includes("Array destructuring requires a T[] value"))).toBe(true);
  });

  it("infers function call return type", () => {
    const info = check(
      {
        "/main.do": `
          function double(x: int): int => x * 2
          const result = double(5)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
    // The call expression should return int
    const ints = findTypes(info, (t) => t.kind === "primitive" && t.name === "int");
    expect(ints.length).toBeGreaterThanOrEqual(1);
  });

  it("infers lambda expression type", () => {
    const info = check(
      {
        "/main.do": `
          const double = (x: int): int => x * 2
        `,
      },
      "/main.do",
    );
    const fns = findTypes(info, (t) => t.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
    const fn = fns[0];
    if (fn.kind === "function") {
      expect(typeToString(fn.returnType)).toBe("int");
    }
  });
});

// ============================================================================
// Scope and shadowing
// ============================================================================

describe("Scope and shadowing", () => {
  it("resolves local binding over module binding", () => {
    const info = check(
      {
        "/main.do": `
          const x = 42
          function test(): int {
            let x = 99
            return x
          }
        `,
      },
      "/main.do",
    );
    // The 'x' in 'return x' should resolve to the let binding
    const refs = findId(info, "x");
    const letRef = refs.find((b) => b.kind === "let");
    expect(letRef).toBeDefined();
    expect(letRef!.mutable).toBe(true);
  });

  it("resolves outer scope when inner has no match", () => {
    const info = check(
      {
        "/main.do": `
          const PI = 3.14
          function circumference(r: float): float => r * PI
        `,
      },
      "/main.do",
    );
    // 'PI' should resolve to the module-level const
    const refs = findId(info, "PI");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("const");
  });

  it("block scope does not leak bindings", () => {
    const info = check(
      {
        "/main.do": `
          function test(): int {
            if true {
              let inner = 42
            }
            return inner
          }
        `,
      },
      "/main.do",
    );
    // 'inner' should be undefined outside the if block
    expect(info.diagnostics.some((d) => d.message.includes("Undefined identifier"))).toBe(true);
  });

  it("handles nested function scopes", () => {
    const info = check(
      {
        "/main.do": `
          function outer(): int {
            let x = 10
            function inner(): int => x + 1
            return inner()
          }
        `,
      },
      "/main.do",
    );
    // 'x' in inner resolves to the outer let binding
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("let");
  });
});

// ============================================================================
// this handling
// ============================================================================

describe("this handling", () => {
  it("reports error for this outside class method", () => {
    const info = check(
      { "/main.do": `function test(): int => this` },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("this"))).toBe(true);
  });
});

// ============================================================================
// Type annotation resolution
// ============================================================================

describe("Type annotation resolution", () => {
  it("resolves primitive type annotations", () => {
    const info = check(
      { "/main.do": `function id(x: int): int => x` },
      "/main.do",
    );
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(refs[0].type)).toBe("int");
  });

  it("resolves array type annotations", () => {
    const info = check(
      { "/main.do": `function sum(nums: int[]): int => nums[0]` },
      "/main.do",
    );
    const refs = findId(info, "nums");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(refs[0].type)).toBe("int[]");
  });

  it("resolves union type annotations", () => {
    const info = check(
      { "/main.do": `function test(x: int | string): int | string => x` },
      "/main.do",
    );
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(refs[0].type)).toBe("int | string");
  });

  it("resolves class type annotations", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }
          function origin(): Point => Point(0.0, 0.0)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves nullable type annotations", () => {
    const info = check(
      { "/main.do": `function test(x: int | null): int | null => x` },
      "/main.do",
    );
    const refs = findId(info, "x");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(refs[0].type)).toBe("int | null");
  });
});
