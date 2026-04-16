/**
 * Type checker tests for generics support (Phases 1–3).
 *
 * Phase 1: Generic type aliases
 * Phase 2: Generic functions
 * Phase 3: Generic classes (including method-level type params)
 */

import { describe, it, expect } from "vitest";
import { check, collectExprs, findId, findTypes } from "./checker-test-helpers.js";
import { isStreamSensitiveType, typeContainsTypeVar, typeToString, type ResolvedType } from "./checker-types.js";

// ==========================================================================
// Phase 1: Generic Type Aliases
// ==========================================================================

describe("Checker — generic type aliases", () => {
  it("resolves a generic type alias with a concrete type arg", () => {
    const cr = check({
      "/main.do": `
        type Pair<A, B> = Tuple<A, B>
        const p: Pair<int, string> = (1, "hi")
        const q = p
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "p");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("tuple");
  });

  it("resolves a generic type alias used as function param type", () => {
    const cr = check({
      "/main.do": `
        type Callback<T> = (value: T): void
        function doStuff(cb: Callback<int>) {
          cb(42)
        }
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("resolves nested generic type alias", () => {
    const cr = check({
      "/main.do": `
        type Container<T> = T[]
        const items: Container<string> = ["a", "b"]
        const copy = items
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "items");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("array");
  });
});

// ==========================================================================
// Phase 2: Generic Functions
// ==========================================================================

describe("Checker — generic functions", () => {
  it("infers type arg from argument type", () => {
    const cr = check({
      "/main.do": `
        function identity<T>(x: T): T => x
        const result = identity(42)
        const use = result
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "result");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("primitive");
    if (ids[0].type.kind === "primitive") {
      expect(ids[0].type.name).toBe("int");
    }
  });

  it("infers type arg from string argument", () => {
    const cr = check({
      "/main.do": `
        function identity<T>(x: T): T => x
        const result = identity("hello")
        const use = result
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "result");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("primitive");
    if (ids[0].type.kind === "primitive") {
      expect(ids[0].type.name).toBe("string");
    }
  });

  it("infers type args for multi-param generic function", () => {
    const cr = check({
      "/main.do": `
        function pair<A, B>(a: A, b: B): Tuple<A, B> => (a, b)
        const p = pair(1, "hi")
        const use = p
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "p");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("tuple");
  });

  it("infers type arg from array element", () => {
    const cr = check({
      "/main.do": `
        function first<T>(arr: T[]): T => arr[0]
        const r = first([10, 20])
        const use = r
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "r");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("generic function with no inference context uses unknown", () => {
    const cr = check({
      "/main.do": `
        function makeEmpty<T>(): T[] => []
        const r = makeEmpty()
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("infers type arg through Stream<T> parameter", () => {
    const cr = check({
      "/main.do": `
        class Counter implements Stream<int> {
          current: int
          endExclusive: int

          next(): int | null {
            if this.current < this.endExclusive {
              value := this.current
              this.current = this.current + 1
              return value
            }
            return null
          }
        }

        function readOnce<T>(stream: Stream<T>): T | null => stream.next()

        source: Stream<int> := Counter(1, 3)
        const value = readOnce(source)
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const readOnceCall = collectExprs(cr.program)
      .find((expr): expr is import("./ast.js").CallExpression => expr.kind === "call-expression"
        && expr.callee.kind === "identifier"
        && expr.callee.name === "readOnce");
    expect(readOnceCall).toBeDefined();
    expect(typeToString(readOnceCall!.resolvedType!)).toBe("int | null");
  });

  it("decorates generic call expressions with resolved type arguments", () => {
    const cr = check({
      "/main.do": `
        class Counter implements Stream<int> {
          current: int
          endExclusive: int

          next(): int | null {
            if this.current < this.endExclusive {
              value := this.current
              this.current = this.current + 1
              return value
            }
            return null
          }
        }

        function readOnce<T>(stream: Stream<T>): T | null => stream.next()
        source: Stream<int> := Counter(1, 3)
        const value = readOnce(source)
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);

    const readOnceCall = collectExprs(cr.program)
      .find((expr): expr is import("./ast.js").CallExpression => expr.kind === "call-expression"
        && expr.callee.kind === "identifier"
        && expr.callee.name === "readOnce");

    expect(readOnceCall).toBeDefined();
    expect(readOnceCall?.resolvedGenericBinding?.name).toBe("readOnce");
    expect(readOnceCall?.resolvedGenericTypeArgs).toBeDefined();
    expect(readOnceCall?.resolvedGenericTypeArgs?.map(typeToString)).toEqual(["int"]);
  });

  it("decorates generic function with typeParams in resolvedType", () => {
    const cr = check({
      "/main.do": `
        function identity<T>(x: T): T => x
        const use = identity(42)
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    // The call expression identity(42) should reference identity, which has typeParams
    const fnTypes = findTypes(cr, (t) => t.kind === "function" && !!t.typeParams && t.typeParams.length > 0);
    expect(fnTypes.length).toBeGreaterThan(0);
    const fnType = fnTypes[0];
    if (fnType.kind === "function") {
      expect(fnType.typeParams).toEqual(["T"]);
    }
  });
});

// ==========================================================================
// Phase 3: Generic Classes
// ==========================================================================

describe("Checker — generic classes", () => {
  it("resolves a generic class construction with explicit type args", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
        }
        const b = Box<int> { value: 42 }
        const use = b
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "b");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("class");
    if (ids[0].type.kind === "class") {
      expect(ids[0].type.symbol.name).toBe("Box");
      expect(ids[0].type.typeArgs).toBeDefined();
      expect(ids[0].type.typeArgs?.length).toBe(1);
    }
  });

  it("resolves field types on a generic class instance", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
        }
        const b = Box<int> { value: 42 }
        const v = b.value
        const use = v
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "v");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("primitive");
    if (ids[0].type.kind === "primitive") {
      expect(ids[0].type.name).toBe("int");
    }
  });

  it("resolves method return types on generic class instance", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
          get(): T => this.value
        }
        const b = Box<string> { value: "hello" }
        const v = b.get()
        const use = v
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "v");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0].type.kind).toBe("primitive");
    if (ids[0].type.kind === "primitive") {
      expect(ids[0].type.name).toBe("string");
    }
  });

  it("generic class with multiple type params", () => {
    const cr = check({
      "/main.do": `
        class Pair<A, B> {
          first: A
          second: B
        }
        const p = Pair<int, string> { first: 1, second: "hi" }
        const a = p.first
        const b = p.second
        const useA = a
        const useB = b
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const aIds = findId(cr, "a");
    expect(aIds.length).toBeGreaterThan(0);
    expect(aIds[0].type.kind).toBe("primitive");
    if (aIds[0].type.kind === "primitive") {
      expect(aIds[0].type.name).toBe("int");
    }
    const bIds = findId(cr, "b");
    expect(bIds.length).toBeGreaterThan(0);
    expect(bIds[0].type.kind).toBe("primitive");
    if (bIds[0].type.kind === "primitive") {
      expect(bIds[0].type.name).toBe("string");
    }
  });

  it("resolves explicit generic positional construction", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
        }
        const b = Box<int>(42)
        const use = b
      `,
    }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "b");
    expect(ids[0]?.type.kind).toBe("class");
    if (ids[0]?.type.kind === "class") {
      expect(ids[0].type.typeArgs?.map(typeToString)).toEqual(["int"]);
    }
  });

  it("infers generic class type args from positional constructor calls", () => {
    const cr = check({
      "/main.do": `
        class Counter implements Stream<int> {
          current: int
          endExclusive: int

          next(): int | null {
            if this.current < this.endExclusive {
              value := this.current
              this.current = this.current + 1
              return value
            }
            return null
          }
        }

        class Chain<T> implements Stream<T> {
          source: Stream<T>

          next(): T | null => this.source.next()
        }

        const chain = Chain(Counter(1, 4))
        const use = chain
      `,
    }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "chain");
    expect(ids[0]?.type.kind).toBe("class");
    if (ids[0]?.type.kind === "class") {
      expect(ids[0].type.symbol.name).toBe("Chain");
      expect(ids[0].type.typeArgs?.map(typeToString)).toEqual(["int"]);
    }
  });

  it("infers generic class type args for imported constructor calls", () => {
    const cr = check({
      "/stream.do": `
        export class Chain<T> implements Stream<T> {
          source: Stream<T>

          next(): T | null => this.source.next()
        }
      `,
      "/main.do": `
        import { Chain } from "./stream"

        class Counter implements Stream<int> {
          current: int
          endExclusive: int

          next(): int | null {
            if this.current < this.endExclusive {
              value := this.current
              this.current = this.current + 1
              return value
            }
            return null
          }
        }

        const chain = Chain(Counter(1, 4))
        const use = chain
      `,
    }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const ids = findId(cr, "chain");
    expect(ids[0]?.type.kind).toBe("class");
    if (ids[0]?.type.kind === "class") {
      expect(ids[0].type.symbol.name).toBe("Chain");
      expect(ids[0].type.typeArgs?.map(typeToString)).toEqual(["int"]);
    }
  });
});

// ==========================================================================
// Phase 3: Method-level Type Parameters
// ==========================================================================

describe("Checker — method-level type params", () => {
  it("generic method on a non-generic class", () => {
    const cr = check({
      "/main.do": `
        class Utils {
          static wrap<T>(value: T): T[] => [value]
        }
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("generic method on a generic class", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
          map<U>(f: (value: T): U): U => f(this.value)
        }
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("decorates generic method calls with owner class metadata", () => {
    const cr = check({
      "/main.do": `
        function stringify(value: int): string => string(value)

        class Box<T> {
          value: T
          map<U>(f: (value: T): U): U => f(this.value)
        }

        const b = Box<int> { value: 42 }
        const result = b.map(stringify)
      `,
    }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);

    const mapCall = collectExprs(cr.program)
      .find((expr): expr is import("./ast.js").CallExpression => expr.kind === "call-expression"
        && expr.callee.kind === "member-expression"
        && expr.callee.property === "map");

    expect(mapCall).toBeDefined();
    expect(mapCall?.resolvedGenericOwnerClass?.name).toBe("Box");
    expect(mapCall?.resolvedGenericMethodName).toBe("map");
    expect(mapCall?.resolvedGenericMethodStatic).toBe(false);
    expect(mapCall?.resolvedGenericTypeArgs?.map(typeToString)).toEqual(["string"]);
  });

  it("contextually types shorthand lambdas in generic positional method calls", () => {
    const cr = check({
      "/main.do": `
        class Box<T> {
          value: T
          map<U>(f: (it: T): U): U => f(this.value)
        }

        const b = Box<int> { value: 42 }
        const result = b.map(=> "{${it}}")
      `,
    }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);

    const mapCall = collectExprs(cr.program)
      .find((expr): expr is import("./ast.js").CallExpression => expr.kind === "call-expression"
        && expr.callee.kind === "member-expression"
        && expr.callee.property === "map");

    expect(mapCall?.resolvedGenericTypeArgs?.map(typeToString)).toEqual(["string"]);
  });
});

describe("checker-types — stream sensitivity", () => {
  it("detects type variables nested under Stream", () => {
    const type: ResolvedType = {
      kind: "function",
      params: [{ name: "source", type: { kind: "stream", elementType: { kind: "typevar", name: "T" } } }],
      returnType: { kind: "primitive", name: "bool" },
    };

    expect(typeContainsTypeVar(type)).toBe(true);
    expect(isStreamSensitiveType(type)).toBe(true);
  });

  it("does not mark concrete Stream<int> signatures as stream-sensitive", () => {
    const type: ResolvedType = {
      kind: "function",
      params: [{ name: "source", type: { kind: "stream", elementType: { kind: "primitive", name: "int" } } }],
      returnType: { kind: "array", elementType: { kind: "primitive", name: "int" }, readonly_: false },
    };

    expect(typeContainsTypeVar(type)).toBe(false);
    expect(isStreamSensitiveType(type)).toBe(false);
  });
});
