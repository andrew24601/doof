import { describe, expect, it } from "vitest";
import type { SourceSpan, TypeAnnotation } from "./ast.js";
import { ModuleAnalyzer } from "./analyzer.js";
import type { EmitContext } from "./emitter-context.js";
import { parse } from "./parser.js";
import { typeToString } from "./checker-types.js";
import { resolveTypeAnnotation } from "./emitter-expr-utils.js";
import { VirtualFS } from "./test-helpers.js";

const TEST_SPAN: SourceSpan = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function parameterType(source: string): TypeAnnotation {
  const statement = parse(source).statements[0];
  if (statement.kind !== "function-declaration" || !statement.params[0]?.type) {
    throw new Error("Expected a function with a typed first parameter");
  }
  return statement.params[0].type;
}

function aliasedType(source: string): TypeAnnotation {
  const statement = parse(source).statements[0];
  if (statement.kind !== "type-alias-declaration") {
    throw new Error("Expected a type alias");
  }
  return statement.type;
}

function contextWithClass(name: string): EmitContext {
  const analysis = new ModuleAnalyzer(new VirtualFS({ "/main.do": `class ${name} {}` }))
    .analyzeModule("/main.do");
  const module = analysis.modules.get("/main.do");
  if (!module) throw new Error("Expected the test module to be analyzed");

  return { module, allModules: analysis.modules } as EmitContext;
}

describe("resolveTypeAnnotation", () => {
  it("resolves array type annotations recursively", () => {
    expect(resolveTypeAnnotation(parameterType("function f(value: readonly int[]): void {}"))).toEqual({
      kind: "array",
      elementType: { kind: "primitive", name: "int" },
      readonly_: true,
    });
  });

  it("resolves union type annotations recursively", () => {
    expect(resolveTypeAnnotation(parameterType("function f(value: int | null): void {}"))).toEqual({
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "null" },
      ],
    });
  });

  it("resolves function type annotations and preserves parameter names", () => {
    expect(resolveTypeAnnotation(aliasedType("type Callback = (value: int, label: string): bool"))).toEqual({
      kind: "function",
      params: [
        { name: "value", type: { kind: "primitive", name: "int" } },
        { name: "label", type: { kind: "primitive", name: "string" } },
      ],
      returnType: { kind: "primitive", name: "bool" },
    });
  });

  it("resolves tuple type annotations supplied by the AST", () => {
    const tupleType: TypeAnnotation = {
      kind: "tuple-type",
      elements: [
        { kind: "named-type", name: "int", typeArgs: [], span: TEST_SPAN },
        { kind: "named-type", name: "string", typeArgs: [], span: TEST_SPAN },
      ],
      span: TEST_SPAN,
    };

    expect(resolveTypeAnnotation(tupleType)).toEqual({
      kind: "tuple",
      elements: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
      ],
    });
  });

  it("resolves weak type annotations recursively", () => {
    expect(resolveTypeAnnotation(parameterType("function f(value: weak int): void {}"))).toEqual({
      kind: "weak",
      inner: { kind: "primitive", name: "int" },
    });
  });

  it("resolves Array and ReadonlyArray named types, including missing element types", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Array<int>): void {}"))))
      .toBe("int[]");
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: ReadonlyArray<string>): void {}"))))
      .toBe("readonly string[]");
    expect(resolveTypeAnnotation(parameterType("function f(value: Array): void {}"))).toEqual({
      kind: "array",
      elementType: { kind: "unknown" },
      readonly_: false,
    });
  });

  it("resolves Tuple named types recursively", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Tuple<int, string>): void {}"))))
      .toBe("Tuple<int, string>");
    expect(resolveTypeAnnotation(parameterType("function f(value: Tuple): void {}"))).toEqual({
      kind: "tuple",
      elements: [],
    });
  });

  it("resolves Set and ReadonlySet named types, including missing element types", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Set<int>): void {}"))))
      .toBe("Set<int>");
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: ReadonlySet<string>): void {}"))))
      .toBe("ReadonlySet<string>");
    expect(resolveTypeAnnotation(parameterType("function f(value: ReadonlySet): void {}"))).toEqual({
      kind: "set",
      elementType: { kind: "unknown" },
      readonly_: true,
    });
  });

  it("resolves Actor named types only when they wrap a class", () => {
    const ctx = contextWithClass("Worker");
    const actor = resolveTypeAnnotation(
      parameterType("function f(value: Actor<Worker>): void {}"),
      ctx,
    );
    expect(actor.kind).toBe("actor");
    if (actor.kind === "actor") expect(actor.innerClass.symbol.name).toBe("Worker");

    expect(resolveTypeAnnotation(parameterType("function f(value: Actor<int>): void {}"), ctx))
      .toEqual({ kind: "unknown" });
    expect(resolveTypeAnnotation(parameterType("function f(value: Actor): void {}"), ctx))
      .toEqual({ kind: "unknown" });
  });

  it("resolves Promise named types and rejects missing type arguments", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Promise<int>): void {}"))))
      .toBe("Promise<int>");
    expect(resolveTypeAnnotation(parameterType("function f(value: Promise): void {}"))).toEqual({
      kind: "unknown",
    });
  });

  it("resolves Result named types and rejects incorrect arity", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Result<int, string>): void {}"))))
      .toBe("Result<int, string>");
    expect(resolveTypeAnnotation(parameterType("function f(value: Result<int>): void {}"))).toEqual({
      kind: "unknown",
    });
  });

  it("resolves Success and Failure named types and rejects incorrect arity", () => {
    expect(resolveTypeAnnotation(parameterType("function f(value: Success<int>): void {}"))).toEqual({
      kind: "success",
      valueType: { kind: "primitive", name: "int" },
    });
    expect(resolveTypeAnnotation(parameterType("function f(value: Failure<string>): void {}"))).toEqual({
      kind: "failure",
      errorType: { kind: "primitive", name: "string" },
    });
    expect(resolveTypeAnnotation(parameterType("function f(value: Success): void {}"))).toEqual({
      kind: "unknown",
    });
  });

  it("resolves Stream named types and rejects missing type arguments", () => {
    expect(typeToString(resolveTypeAnnotation(parameterType("function f(value: Stream<int>): void {}"))))
      .toBe("Stream<int>");
    expect(resolveTypeAnnotation(parameterType("function f(value: Stream): void {}"))).toEqual({
      kind: "unknown",
    });
  });
});
