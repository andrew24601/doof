/**
 * Emitter tests — generics: template declarations, type parameter
 * emission, generic class construction, generic function calls.
 */

import { describe, it, expect } from "vitest";
import { emit, emitSplit } from "./emitter-test-helpers.js";
import { emitType } from "./emitter-types.js";
import type { ResolvedType } from "./checker-types.js";

// ============================================================================
// Type mapping
// ============================================================================

describe("emitter — generic type mapping", () => {
  it("maps typevar to its name", () => {
    const t: ResolvedType = { kind: "typevar", name: "T" };
    expect(emitType(t)).toBe("T");
  });

  it("maps generic class type with typeArgs", () => {
    const t: ResolvedType = {
      kind: "class",
      symbol: {
        name: "Box",
        symbolKind: "class",
        module: "/main.do",
        exported: false,
        declaration: { kind: "class-declaration", name: "Box", typeParams: ["T"], fields: [], methods: [], description: undefined, exported: false, implements_: [], private_: false, span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } },
      },
      typeArgs: [{ kind: "primitive", name: "int" }],
    };
    expect(emitType(t)).toBe("std::shared_ptr<Box<int32_t>>");
  });
});

// ============================================================================
// Generic function declarations
// ============================================================================

describe("emitter — generic function declarations", () => {
  it("emits template prefix for generic function", () => {
    const cpp = emit(`function identity<T>(x: T): T => x`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("T identity(T x)");
  });

  it("emits template prefix with multiple type params", () => {
    const cpp = emit(`function pair<A, B>(a: A, b: B): Tuple<A, B> => (a, b)`);
    expect(cpp).toContain("template<typename A, typename B>");
  });
});

// ============================================================================
// Generic class declarations
// ============================================================================

describe("emitter — generic class declarations", () => {
  it("emits template prefix for generic class", () => {
    const cpp = emit(`class Box<T> {
  value: T
}`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("struct Box");
  });

  it("emits template prefix with multiple type params on class", () => {
    const cpp = emit(`class Pair<A, B> {
  first: A
  second: B
}`);
    expect(cpp).toContain("template<typename A, typename B>");
  });
});

// ============================================================================
// Generic type alias declarations
// ============================================================================

describe("emitter — generic type alias declarations", () => {
  it("emits template prefix for generic type alias", () => {
    const cpp = emit(`type Container<T> = T[]`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("using Container");
  });
});

// ============================================================================
// Generic construction expressions
// ============================================================================

describe("emitter — generic construction", () => {
  it("emits explicit type args in construction", () => {
    const cpp = emit(`class Box<T> {
  value: T
}
const b = Box<int> { value: 42 }
`);
    expect(cpp).toContain("make_shared<Box<int32_t>>");
  });
});

// ============================================================================
// Module splitting for generics
// ============================================================================

describe("emitter — generic module splitting", () => {
  it("puts generic function body in header", () => {
    const result = emitSplit(`export function identity<T>(x: T): T => x`);
    // Generic function body must be in header since templates need definition at use-site
    expect(result.hppCode).toContain("template<typename T>");
    expect(result.hppCode).toContain("identity");
  });

  it("emits template forward declaration for generic class", () => {
    const result = emitSplit(`export class Box<T> {
  value: T
}`);
    expect(result.hppCode).toContain("template<typename T>");
    expect(result.hppCode).toContain("Box");
  });
});
