import { describe, it, expect } from "vitest";
import type { ResolvedType } from "./checker-types.js";
import {
  typeToString,
  isAssignableTo,
  typesEqual,
  INT_TYPE,
  LONG_TYPE,
  FLOAT_TYPE,
  DOUBLE_TYPE,
  STRING_TYPE,
  CHAR_TYPE,
  BOOL_TYPE,
  VOID_TYPE,
  NULL_TYPE,
  UNKNOWN_TYPE,
  JSON_VALUE_TYPE,
} from "./checker-types.js";
import { check, findId, findTypes } from "./checker-test-helpers.js";

// ============================================================================
// Import type resolution
// ============================================================================

describe("Import type resolution", () => {
  it("resolves imported class types in function signatures", () => {
    const info = check(
      {
        "/main.do": `
          import { Vector } from "./math"
          function scale(v: Vector, s: float): float => v.x * s
        `,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );

    const vRefs = findId(info, "v");
    expect(vRefs.length).toBeGreaterThanOrEqual(1);
    expect(vRefs[0].kind).toBe("parameter");
    expect(typeToString(vRefs[0].type)).toBe("Vector");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves imported function return types in calls", () => {
    const info = check(
      {
        "/main.do": `
          import { add } from "./math"
          const result = add(1, 2)
        `,
        "/math.do": `export function add(a: int, b: int): int => a + b`,
      },
      "/main.do",
    );

    const refs = findId(info, "add");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].kind).toBe("import");
    expect(refs[0].type.kind).toBe("function");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves member access on imported types", () => {
    const info = check(
      {
        "/main.do": `
          import { User } from "./models"
          function getName(u: User): string => u.name
        `,
        "/models.do": `export class User { name: string; age: int }`,
      },
      "/main.do",
    );

    // u.name should resolve to string
    const strs = findTypes(info, (t) => t.kind === "primitive" && t.name === "string");
    expect(strs.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Full scenario
// ============================================================================

describe("Full type-checking scenario", () => {
  it("analyses a multi-function module end to end", () => {
    const info = check(
      {
        "/main.do": `
          class Point { x, y: float }

          function distance(a: Point, b: Point): float {
            let dx = b.x - a.x
            let dy = b.y - a.y
            return dx * dx + dy * dy
          }

          const origin = Point(0.0, 0.0)
        `,
      },
      "/main.do",
    );

    // Parameters resolve correctly
    const aRefs = findId(info, "a");
    expect(aRefs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(aRefs[0].type)).toBe("Point");

    // Local variables resolve correctly
    const dxRefs = findId(info, "dx");
    expect(dxRefs.length).toBeGreaterThanOrEqual(1);
    expect(dxRefs[0].kind).toBe("let");

    // No diagnostics
    expect(info.diagnostics).toHaveLength(0);
  });

  it("analyses a multi-module project with imports", () => {
    const info = check(
      {
        "/app/main.do": `
          import { Vector, add } from "./math"
          import { Config } from "./config"

          function main(): void {
            let v = Vector(1.0, 2.0)
            let sum = add(1, 2)
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

    // Imported identifiers resolve
    const vecRefs = findId(info, "Vector");
    expect(vecRefs.length).toBeGreaterThanOrEqual(1);
    expect(vecRefs[0].kind).toBe("import");

    const addRefs = findId(info, "add");
    expect(addRefs.length).toBeGreaterThanOrEqual(1);
    expect(addRefs[0].kind).toBe("import");

    expect(info.diagnostics).toHaveLength(0);
  });

  it("handles enum types", () => {
    const info = check(
      {
        "/main.do": `
          enum Direction { North, South, East, West }
          function test(dir: Direction): bool => dir == Direction.North
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "dir");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(typeToString(refs[0].type)).toBe("Direction");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("handles type aliases", () => {
    const info = check(
      {
        "/main.do": `
          type Id = int
          function getUser(id: Id): Id => id
        `,
      },
      "/main.do",
    );
    const refs = findId(info, "id");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    // Type alias resolves to the underlying type
    expect(typeToString(refs[0].type)).toBe("int");
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// typeToString helper
// ============================================================================

describe("typeToString", () => {
  it("formats primitive types", () => {
    expect(typeToString({ kind: "primitive", name: "int" })).toBe("int");
    expect(typeToString({ kind: "primitive", name: "string" })).toBe("string");
  });

  it("formats void and null", () => {
    expect(typeToString({ kind: "void" })).toBe("void");
    expect(typeToString({ kind: "null" })).toBe("null");
  });

  it("formats unknown", () => {
    expect(typeToString({ kind: "unknown" })).toBe("unknown");
  });

  it("formats array types", () => {
    expect(
      typeToString({
        kind: "array",
        elementType: { kind: "primitive", name: "int" },
        readonly_: false,
      }),
    ).toBe("int[]");
    expect(
      typeToString({
        kind: "array",
        elementType: { kind: "primitive", name: "string" },
        readonly_: true,
      }),
    ).toBe("readonly string[]");
  });

  it("formats union types", () => {
    expect(
      typeToString({
        kind: "union",
        types: [
          { kind: "primitive", name: "int" },
          { kind: "null" },
        ],
      }),
    ).toBe("int | null");
  });

  it("formats function types", () => {
    expect(
      typeToString({
        kind: "function",
        params: [{ name: "x", type: { kind: "primitive", name: "int" } }],
        returnType: { kind: "primitive", name: "int" },
      }),
    ).toBe("(x: int): int");
  });

  it("formats tuple types", () => {
    expect(
      typeToString({
        kind: "tuple",
        elements: [
          { kind: "primitive", name: "int" },
          { kind: "primitive", name: "string" },
        ],
      }),
    ).toBe("Tuple<int, string>");
  });
});

// ============================================================================
// isAssignableTo — type compatibility
// ============================================================================

describe("isAssignableTo", () => {
  it("identical primitives are assignable", () => {
    expect(isAssignableTo(INT_TYPE, INT_TYPE)).toBe(true);
    expect(isAssignableTo(STRING_TYPE, STRING_TYPE)).toBe(true);
    expect(isAssignableTo(BOOL_TYPE, BOOL_TYPE)).toBe(true);
  });

  it("unknown is assignable to anything", () => {
    expect(isAssignableTo(UNKNOWN_TYPE, INT_TYPE)).toBe(true);
    expect(isAssignableTo(INT_TYPE, UNKNOWN_TYPE)).toBe(true);
  });

  it("void is only assignable to void", () => {
    expect(isAssignableTo(VOID_TYPE, VOID_TYPE)).toBe(true);
    expect(isAssignableTo(VOID_TYPE, INT_TYPE)).toBe(false);
    expect(isAssignableTo(INT_TYPE, VOID_TYPE)).toBe(false);
  });

  it("null is assignable to union containing null", () => {
    const nullable: ResolvedType = {
      kind: "union",
      types: [INT_TYPE, NULL_TYPE],
    };
    expect(isAssignableTo(NULL_TYPE, nullable)).toBe(true);
  });

  it("null is not assignable to non-nullable type", () => {
    expect(isAssignableTo(NULL_TYPE, INT_TYPE)).toBe(false);
    expect(isAssignableTo(NULL_TYPE, STRING_TYPE)).toBe(false);
  });

  it("numeric widening: int → long", () => {
    expect(isAssignableTo(INT_TYPE, LONG_TYPE)).toBe(true);
  });

  it("numeric widening: int → float", () => {
    expect(isAssignableTo(INT_TYPE, FLOAT_TYPE)).toBe(true);
  });

  it("numeric widening: int → double", () => {
    expect(isAssignableTo(INT_TYPE, DOUBLE_TYPE)).toBe(true);
  });

  it("numeric widening: float → double", () => {
    expect(isAssignableTo(FLOAT_TYPE, DOUBLE_TYPE)).toBe(true);
  });

  it("numeric widening: long → double", () => {
    expect(isAssignableTo(LONG_TYPE, DOUBLE_TYPE)).toBe(true);
  });

  it("numeric narrowing is not allowed: long → int", () => {
    expect(isAssignableTo(LONG_TYPE, INT_TYPE)).toBe(false);
  });

  it("numeric narrowing is not allowed: double → float", () => {
    expect(isAssignableTo(DOUBLE_TYPE, FLOAT_TYPE)).toBe(false);
  });

  it("numeric narrowing is not allowed: double → int", () => {
    expect(isAssignableTo(DOUBLE_TYPE, INT_TYPE)).toBe(false);
  });

  it("incompatible primitives", () => {
    expect(isAssignableTo(INT_TYPE, STRING_TYPE)).toBe(false);
    expect(isAssignableTo(BOOL_TYPE, INT_TYPE)).toBe(false);
    expect(isAssignableTo(STRING_TYPE, BOOL_TYPE)).toBe(false);
    expect(isAssignableTo(CHAR_TYPE, INT_TYPE)).toBe(false);
  });

  it("union target: source matches one member", () => {
    const union: ResolvedType = {
      kind: "union",
      types: [INT_TYPE, STRING_TYPE],
    };
    expect(isAssignableTo(INT_TYPE, union)).toBe(true);
    expect(isAssignableTo(STRING_TYPE, union)).toBe(true);
    expect(isAssignableTo(BOOL_TYPE, union)).toBe(false);
  });

  it("union source: all members must match target", () => {
    const source: ResolvedType = {
      kind: "union",
      types: [INT_TYPE, LONG_TYPE],
    };
    // Both int and long can widen to double.
    expect(isAssignableTo(source, DOUBLE_TYPE)).toBe(true);
    // Long can't narrow to int.
    expect(isAssignableTo(source, INT_TYPE)).toBe(false);
  });

  it("array compatibility: matching element types", () => {
    const intArr: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    const intArr2: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    expect(isAssignableTo(intArr, intArr2)).toBe(true);
  });

  it("array: readonly source cannot go to mutable target", () => {
    const readonlyArr: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: true };
    const mutableArr: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    expect(isAssignableTo(readonlyArr, mutableArr)).toBe(false);
  });

  it("array: mutable source cannot go to readonly target", () => {
    const mutableArr: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    const readonlyArr: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: true };
    expect(isAssignableTo(mutableArr, readonlyArr)).toBe(false);
  });

  it("map: mutable source cannot go to readonly target", () => {
    const mutableMap: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: INT_TYPE,
      readonly_: false,
    };
    const readonlyMap: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: INT_TYPE,
      readonly_: true,
    };
    expect(isAssignableTo(mutableMap, readonlyMap)).toBe(false);
  });

  it("set: mutable source cannot go to readonly target", () => {
    const mutableSet: ResolvedType = {
      kind: "set",
      elementType: INT_TYPE,
      readonly_: false,
    };
    const readonlySet: ResolvedType = {
      kind: "set",
      elementType: INT_TYPE,
      readonly_: true,
    };
    expect(isAssignableTo(mutableSet, readonlySet)).toBe(false);
  });

  it("array element types are invariant", () => {
    const source: ResolvedType = {
      kind: "array",
      readonly_: false,
      elementType: {
        kind: "union",
        types: [STRING_TYPE, BOOL_TYPE],
      },
    };
    const target: ResolvedType = {
      kind: "array",
      readonly_: false,
      elementType: {
        kind: "union",
        types: [INT_TYPE, BOOL_TYPE, STRING_TYPE],
      },
    };

    expect(isAssignableTo(source, target)).toBe(false);
  });

  it("requires exact JsonValue arrays for JsonValue[] targets", () => {
    const source: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    const target: ResolvedType = { kind: "array", elementType: JSON_VALUE_TYPE, readonly_: false };
    expect(isAssignableTo(source, target)).toBe(false);
  });

  it("requires exact JsonValue maps for Map<string, JsonValue> targets", () => {
    const source: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: {
        kind: "union",
        types: [LONG_TYPE, DOUBLE_TYPE, STRING_TYPE, NULL_TYPE],
      },
    };
    const target: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: JSON_VALUE_TYPE,
    };
    expect(isAssignableTo(source, target)).toBe(false);
  });

  it("map value types are invariant", () => {
    const source: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: INT_TYPE,
    };
    const target: ResolvedType = {
      kind: "map",
      keyType: STRING_TYPE,
      valueType: LONG_TYPE,
    };
    expect(isAssignableTo(source, target)).toBe(false);
  });

  it("set element types are invariant", () => {
    const source: ResolvedType = {
      kind: "set",
      elementType: INT_TYPE,
      readonly_: false,
    };
    const target: ResolvedType = {
      kind: "set",
      elementType: LONG_TYPE,
      readonly_: false,
    };
    expect(isAssignableTo(source, target)).toBe(false);
  });

  it("tuple compatibility: same arity and element types", () => {
    const t1: ResolvedType = { kind: "tuple", elements: [INT_TYPE, STRING_TYPE] };
    const t2: ResolvedType = { kind: "tuple", elements: [INT_TYPE, STRING_TYPE] };
    expect(isAssignableTo(t1, t2)).toBe(true);
  });

  it("tuple: different arity", () => {
    const t1: ResolvedType = { kind: "tuple", elements: [INT_TYPE] };
    const t2: ResolvedType = { kind: "tuple", elements: [INT_TYPE, STRING_TYPE] };
    expect(isAssignableTo(t1, t2)).toBe(false);
  });

  it("tuple: widening in elements", () => {
    const t1: ResolvedType = { kind: "tuple", elements: [INT_TYPE, FLOAT_TYPE] };
    const t2: ResolvedType = { kind: "tuple", elements: [LONG_TYPE, DOUBLE_TYPE] };
    expect(isAssignableTo(t1, t2)).toBe(true);
  });

  it("function: matching signatures", () => {
    const f1: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }],
      returnType: INT_TYPE,
    };
    const f2: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }],
      returnType: INT_TYPE,
    };
    expect(isAssignableTo(f1, f2)).toBe(true);
  });

  it("function: co-variant return type", () => {
    const f1: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }],
      returnType: INT_TYPE,
    };
    const f2: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }],
      returnType: DOUBLE_TYPE,
    };
    // int return widens to double.
    expect(isAssignableTo(f1, f2)).toBe(true);
  });

  it("function: different param count", () => {
    const f1: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }],
      returnType: VOID_TYPE,
    };
    const f2: ResolvedType = {
      kind: "function",
      params: [{ name: "x", type: INT_TYPE }, { name: "y", type: INT_TYPE }],
      returnType: VOID_TYPE,
    };
    expect(isAssignableTo(f1, f2)).toBe(false);
  });
});

// ============================================================================
// typesEqual
// ============================================================================

describe("typesEqual", () => {
  it("equal primitives", () => {
    expect(typesEqual(INT_TYPE, INT_TYPE)).toBe(true);
    expect(typesEqual(INT_TYPE, DOUBLE_TYPE)).toBe(false);
  });

  it("null, void, unknown", () => {
    expect(typesEqual(NULL_TYPE, NULL_TYPE)).toBe(true);
    expect(typesEqual(VOID_TYPE, VOID_TYPE)).toBe(true);
    expect(typesEqual(UNKNOWN_TYPE, UNKNOWN_TYPE)).toBe(true);
    expect(typesEqual(NULL_TYPE, VOID_TYPE)).toBe(false);
  });

  it("arrays with same element type and mutability", () => {
    const a1: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    const a2: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: false };
    const a3: ResolvedType = { kind: "array", elementType: INT_TYPE, readonly_: true };
    expect(typesEqual(a1, a2)).toBe(true);
    expect(typesEqual(a1, a3)).toBe(false);
  });

  it("tuples with same elements", () => {
    const t1: ResolvedType = { kind: "tuple", elements: [INT_TYPE, STRING_TYPE] };
    const t2: ResolvedType = { kind: "tuple", elements: [INT_TYPE, STRING_TYPE] };
    const t3: ResolvedType = { kind: "tuple", elements: [INT_TYPE, BOOL_TYPE] };
    expect(typesEqual(t1, t2)).toBe(true);
    expect(typesEqual(t1, t3)).toBe(false);
  });
});

// ============================================================================
// Variable declaration type checking
// ============================================================================

describe("Variable declaration type checking", () => {
  it("accepts compatible type annotation and initializer", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: int = 42 }` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts numeric widening in declaration", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: long = 42 }` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts int to double widening in declaration", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: double = 42 }` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible type annotation", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: int = "hello" }` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("rejects string assigned to bool", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: bool = "true" }` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("rejects numeric narrowing long to int", () => {
    const info = check(
      {
        "/main.do": `
          function test(): void {
            let a: long = 42L
            let b: int = a
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("accepts null for nullable type", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: int | null = null }` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects null for non-nullable type", () => {
    const info = check(
      { "/main.do": `function test(): void { let x: int = null }` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });

  it("validates const declarations", () => {
    const info = check(
      { "/main.do": `const x: string = 42` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable");
  });
});

// ============================================================================
// Return type validation
// ============================================================================

describe("Return type validation", () => {
  it("accepts compatible return type in expression body", () => {
    const info = check(
      { "/main.do": `function double(x: int): int => x * 2` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts widened return type in expression body", () => {
    const info = check(
      { "/main.do": `function toDouble(x: int): double => x` },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible expression body return type", () => {
    const info = check(
      { "/main.do": `function bad(): int => "hello"` },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to return type");
  });

  it("validates return statement against function return type", () => {
    const info = check(
      {
        "/main.do": `
          function bad(): int {
            return "hello"
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to return type");
  });

  it("accepts compatible return in block body", () => {
    const info = check(
      {
        "/main.do": `
          function good(): int {
            return 42
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts widened return value", () => {
    const info = check(
      {
        "/main.do": `
          function widen(): double {
            return 42
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts void return in void function", () => {
    const info = check(
      {
        "/main.do": `
          function doNothing(): void {
            return
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects empty return in non-void function", () => {
    const info = check(
      {
        "/main.do": `
          function bad(): int {
            return
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("must return a value");
  });

  it("validates method return types", () => {
    const info = check(
      {
        "/main.do": `
          class Calc {
            x: int
            getX(): int => x
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible method return type", () => {
    const info = check(
      {
        "/main.do": `
          class Calc {
            x: int
            bad(): string => x
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
// Function argument type checking
// ============================================================================

describe("Function argument type checking", () => {
  it("accepts matching argument types", () => {
    const info = check(
      {
        "/main.do": `
          function add(a: int, b: int): int => a + b
          const result = add(1, 2)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts widened argument types", () => {
    const info = check(
      {
        "/main.do": `
          function process(x: double): double => x * 2.0
          const result = process(42)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible argument type", () => {
    const info = check(
      {
        "/main.do": `
          function process(x: int): int => x + 1
          const result = process("hello")
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to parameter");
  });

  it("rejects passing mutable arrays to readonly array parameters", () => {
    const info = check(
      {
        "/main.do": `
          function test(a: readonly int[]): void {
            println(a.length)
          }

          function main(): void {
            let a = [1, 2, 3]
            test(a)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('Argument of type "int[]" is not assignable to parameter "a" of type "readonly int[]"');
  });

  it("rejects passing mutable arrays to ReadonlyArray parameters", () => {
    const info = check(
      {
        "/main.do": `
          function test(a: ReadonlyArray<int>): void {
            println(a.length)
          }

          function main(): void {
            let a = [1, 2, 3]
            test(a)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('Argument of type "int[]" is not assignable to parameter "a" of type "readonly int[]"');
  });

  it("accepts passing readonly arrays to readonly array parameters", () => {
    const info = check(
      {
        "/main.do": `
          function test(a: readonly int[]): void {
            println(a.length)
          }

          function main(): void {
            let a: readonly int[] = [1, 2, 3]
            test(a)
          }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects too many arguments", () => {
    const info = check(
      {
        "/main.do": `
          function single(x: int): int => x
          const result = single(1, 2)
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Expected 1 argument(s) but got 2");
  });

  it("accepts named arguments out of order", () => {
    const info = check(
      {
        "/main.do": `
          function clamp(value: int, min: int, max: int): int => value
          const result = clamp{ min: 0, max: 100, value: 50 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts named arguments with omitted defaulted parameters", () => {
    const info = check(
      {
        "/main.do": `
          function greet(name: string, punctuation: string = "!"): string => name + punctuation
          const result = greet{ name: "Ada" }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects unknown named arguments", () => {
    const info = check(
      {
        "/main.do": `
          function clamp(value: int, min: int, max: int): int => value
          const result = clamp{ min: 0, max: 100, score: 50 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('does not have a parameter named "score"');
  });

  it("rejects missing required named arguments", () => {
    const info = check(
      {
        "/main.do": `
          function clamp(value: int, min: int, max: int): int => value
          const result = clamp{ min: 0, max: 100 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain('Missing required parameter "value"');
  });

  it("rejects spaced named call syntax", () => {
    const info = check(
      {
        "/main.do": `
          function clamp(value: int, min: int, max: int): int => value
          const result = clamp { min: 0, max: 100, value: 50 }
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("requires '{' to immediately follow \"clamp\"");
  });

  it("accepts correct argument types with imported functions", () => {
    const info = check(
      {
        "/main.do": `
          import { add } from "./math"
          const result = add(1, 2)
        `,
        "/math.do": `export function add(a: int, b: int): int => a + b`,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects wrong argument types with imported functions", () => {
    const info = check(
      {
        "/main.do": `
          import { add } from "./math"
          const result = add("hello", "world")
        `,
        "/math.do": `export function add(a: int, b: int): int => a + b`,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("not assignable to parameter");
  });

  it("validates default parameter values", () => {
    const info = check(
      {
        "/main.do": `function greet(name: string = "World"): string => name`,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects incompatible default parameter value", () => {
    const info = check(
      {
        "/main.do": `function bad(x: int = "hello"): int => x`,
      },
      "/main.do",
    );
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("Default value");
  });

  it("rejects unsupported binary-expression default parameter value", () => {
    const info = check(
      {
        "/main.do": `function bad(x: int = 1 + 2): int => x`,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("Parameter default value is not supported"))).toBe(true);
  });

  it("rejects parameter defaults that reference another parameter", () => {
    const info = check(
      {
        "/main.do": `function bad(a: int, b: int = a): int => b`,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes("identifier \"a\" resolves to a parameter binding"))).toBe(true);
  });

  it("accepts Set default parameter values from array literal syntax", () => {
    const info = check(
      {
        "/main.do": `function dedupe(values: Set<int> = []): Set<int> => values`,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("accepts Set default parameter values with supported element types", () => {
    const info = check(
      {
        "/main.do": `
          enum Color { Red, Blue }

          function load(
            names: Set<string> = ["alice"],
            ids: Set<long> = [1, 2],
            palette: Set<Color> = [Color.Red]
          ): void {}
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects Set default parameter values with unsupported element types", () => {
    const info = check(
      {
        "/main.do": `function load(values: Set<float> = []): void {}`,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Set element type "float" is not supported'))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Parameter default value is not supported"))).toBe(true);
  });

  it("accepts Map default parameter values with supported key types", () => {
    const info = check(
      {
        "/main.do": `
          enum Color { Red, Blue }

          function load(
            names: Map<string, int> = { "alice": 1 },
            counts: Map<int, string> = { 1: "one" },
            ids: Map<long, string> = { 1L: "one" },
            palette: Map<Color, int> = { Color.Red: 1 }
          ): void {}
        `,
      },
      "/main.do",
    );
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects Map default parameter values with unsupported key types", () => {
    const info = check(
      {
        "/main.do": `function load(values: Map<float, int> = {}): void {}`,
      },
      "/main.do",
    );
    expect(info.diagnostics.some((d) => d.message.includes('Map key type "float" is not supported'))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("Parameter default value is not supported"))).toBe(true);
  });
});
