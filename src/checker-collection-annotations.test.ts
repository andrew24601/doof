import { describe, expect, it } from "vitest";
import type { FunctionDeclaration } from "./ast.js";
import {
  getCollectionTypeAnnotationInfo,
  validateCollectionTypeAnnotation,
} from "./checker-collection-annotations.js";
import { check } from "./checker-test-helpers.js";

describe("collection type annotation helpers", () => {
  it("describes all collection annotation spellings", () => {
    const cr = check({ "/main.do": `
      function use(
        m: Map<string, int>,
        rm: ReadonlyMap<string, int>,
        s: Set<int>,
        rs: ReadonlySet<int>
      ): void {}
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    const fn = cr.program.statements[0] as FunctionDeclaration;
    expect(fn.params.map((param) => {
      const info = getCollectionTypeAnnotationInfo(param.type);
      return info && {
        name: info.name,
        kind: info.kind,
        readonly_: info.readonly_,
        expectedTypeArgCount: info.expectedTypeArgCount,
        typeArgCount: info.typeArgCount,
        omitsTypeArgs: info.omitsTypeArgs,
        hasFullTypeArgs: info.hasFullTypeArgs,
      };
    })).toEqual([
      {
        name: "Map",
        kind: "map",
        readonly_: false,
        expectedTypeArgCount: 2,
        typeArgCount: 2,
        omitsTypeArgs: false,
        hasFullTypeArgs: true,
      },
      {
        name: "ReadonlyMap",
        kind: "map",
        readonly_: true,
        expectedTypeArgCount: 2,
        typeArgCount: 2,
        omitsTypeArgs: false,
        hasFullTypeArgs: true,
      },
      {
        name: "Set",
        kind: "set",
        readonly_: false,
        expectedTypeArgCount: 1,
        typeArgCount: 1,
        omitsTypeArgs: false,
        hasFullTypeArgs: true,
      },
      {
        name: "ReadonlySet",
        kind: "set",
        readonly_: true,
        expectedTypeArgCount: 1,
        typeArgCount: 1,
        omitsTypeArgs: false,
        hasFullTypeArgs: true,
      },
    ]);
  });

  it("accepts omitted arguments only when the caller explicitly permits literal inference", () => {
    const cr = check({ "/main.do": `function use(m: Map): void {}` }, "/main.do");
    const fn = cr.program.statements[0] as FunctionDeclaration;
    const table = cr.result.modules.get("/main.do")!;
    const info = { diagnostics: [] as typeof cr.diagnostics };

    expect(validateCollectionTypeAnnotation(fn.params[0].type, fn.params[0].span, table, info, {
      allowOmittedTypeArgs: true,
    })?.omitsTypeArgs).toBe(true);
    expect(info.diagnostics).toHaveLength(0);

    expect(validateCollectionTypeAnnotation(fn.params[0].type, fn.params[0].span, table, info, {
      allowOmittedTypeArgs: false,
    })).toBeNull();
    expect(info.diagnostics[0].message).toContain("same-site non-empty map literal");
  });

  it("rejects partial annotations using the collection-specific arity", () => {
    const cr = check({ "/main.do": `
      function use(m: Map<string>, s: Set<int, string>): void {}
    ` }, "/main.do");

    expect(cr.diagnostics).toHaveLength(2);
    expect(cr.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Map requires either 0 or 2 type arguments",
      "Set requires either 0 or 1 type arguments",
    ]);
  });

  it("returns null for non-collection annotations", () => {
    const cr = check({ "/main.do": `function use(value: string): void {}` }, "/main.do");
    const fn = cr.program.statements[0] as FunctionDeclaration;
    expect(getCollectionTypeAnnotationInfo(fn.params[0].type)).toBeNull();
  });

  it("requires same-site literals that match the collection kind for omitted arguments", () => {
    const cr = check({ "/main.do": `
      mapFromArray: Map := [1]
      setFromMap: Set := { "one": 1 }
      mapWithUnknownKey: Map := { [missingKey]: 1 }
      setWithUnknownElement: Set := [missingElement]
    ` }, "/main.do");

    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Map require a same-site non-empty map literal"))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Set require a same-site non-empty set literal"))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Map type arguments from this map literal"))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Set element type from this set literal"))).toBe(true);
  });
});
