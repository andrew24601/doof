import { describe, expect, it } from "vitest";
import { collectExprs, check, findId } from "./checker-test-helpers.js";
import { getResultShape, typeToString } from "./checker-types.js";

describe("checker-expr — result object literals", () => {
  it("rejects both Result payload fields and unknown fields", () => {
    const cr = check({ "/main.do": `
      function both(): Result<int, string> => { value: 1, error: "bad" }
      function extra(): Result<int, string> => { value: 1, label: "bad" }
    ` }, "/main.do");

    expect(cr.diagnostics.some((d) => d.message.includes("either a \"value\" field or an \"error\" field"))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes('only supports "value" and "error" fields'))).toBe(true);
  });

  it("enforces the void Result object-literal form", () => {
    const cr = check({ "/main.do": `
      function missing(): Result<int, string> { return {} }
      function hasValue(): Result<void, string> { return { value: 1 } }
    ` }, "/main.do");

    expect(cr.diagnostics.some((d) => d.message.includes('must contain a "value" field or an "error" field'))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes('Result<void, E> object literal must not specify a "value" field'))).toBe(true);
  });
});

describe("checker-expr — calls and nominal unions", () => {
  it("reports duplicate named arguments while still checking the call", () => {
    const cr = check({ "/main.do": `
      function clamp(value: int, min: int, max: int): int => value
      result := clamp{ value: 10, value: 20, min: 0, max: 100 }
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain('Parameter "value" is specified more than once');
  });

  it("resolves a tuple literal to the only matching class in a union", () => {
    const cr = check({ "/main.do": `
      class Point { x, y: float }
      class Label { name: string }
      type Value = Point | Label
      value: Value := (1.0, 2.0)
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const tuple = collectExprs(cr.program).find((expr) => expr.kind === "tuple-literal");
    expect(typeToString(tuple!.resolvedType!)).toBe("Point");
  });

  it("uses a shared const discriminator to resolve a class union object literal", () => {
    const cr = check({ "/main.do": `
      class Circle { const kind = "circle"; radius: float }
      class Rectangle { const kind = "rectangle"; width: float }
      type Shape = Circle | Rectangle
      shape: Shape := { kind: "circle", radius: 2.0 }
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const object = collectExprs(cr.program).find((expr) => expr.kind === "object-literal");
    expect(typeToString(object!.resolvedType!)).toBe("Circle");
  });

  it("reports a discriminator value that matches no union member", () => {
    const cr = check({ "/main.do": `
      class Circle { const kind = "circle"; radius: float }
      class Rectangle { const kind = "rectangle"; width: float }
      type Shape = Circle | Rectangle
      shape: Shape := { kind: "triangle", radius: 2.0 }
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain('discriminator "kind" value "triangle" does not match');
  });
});

describe("checker-expr — decorated expression results", () => {
  it("decorates Result constructor arms before combining a case expression", () => {
    const cr = check({ "/main.do": `
      function choose(flag: bool): Result<int, string> => case flag {
        true -> Success { value: 1 },
        false -> Failure { error: "no" }
      }
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const caseExpr = collectExprs(cr.program).find((expr) => expr.kind === "case-expression");
    expect(caseExpr?.resolvedType && getResultShape(caseExpr.resolvedType)).not.toBeNull();
  });
});
