import { describe, expect, it } from "vitest";
import { ModuleAnalyzer } from "./analyzer.js";
import { findActorBoundaryViolation } from "./checker-actor-boundary.js";
import { TypeChecker } from "./checker.js";
import type { CheckerHost } from "./checker-internal.js";
import {
  INT_TYPE,
  STRING_TYPE,
  type ClassType,
  type InterfaceType,
  type ResolvedType,
} from "./checker-types.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";
import type { ClassSymbol, InterfaceSymbol, ModuleSymbolTable } from "./types.js";

function setup(source: string): { host: CheckerHost; table: ModuleSymbolTable } {
  const fs = new VirtualFS({ "/main.do": source });
  const resolver = createBundledModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fs), resolver);
  const result = analyzer.analyzeModule("/main.do");
  const checker = new TypeChecker(result);
  const info = checker.checkModule("/main.do");
  const diagnostics = [...result.diagnostics, ...info.diagnostics];
  expect(diagnostics).toHaveLength(0);

  const table = result.modules.get("/main.do");
  if (!table) throw new Error("Expected /main.do to be analyzed");
  return { host: (checker as unknown as { host: CheckerHost }).host, table };
}

function classType(table: ModuleSymbolTable, name: string, typeArgs?: ResolvedType[]): ClassType {
  const symbol = table.symbols.get(name);
  if (symbol?.symbolKind !== "class") throw new Error(`Expected class symbol ${name}`);
  return { kind: "class", symbol: symbol as ClassSymbol, ...(typeArgs ? { typeArgs } : {}) };
}

function interfaceType(table: ModuleSymbolTable, name: string, typeArgs?: ResolvedType[]): InterfaceType {
  const symbol = table.symbols.get(name);
  if (symbol?.symbolKind !== "interface") throw new Error(`Expected interface symbol ${name}`);
  return { kind: "interface", symbol: symbol as InterfaceSymbol, ...(typeArgs ? { typeArgs } : {}) };
}

describe("checker actor-boundary analysis", () => {
  it("accepts recursive readonly class graphs without looping", () => {
    const { host, table } = setup(`
      class Node {
        readonly value: int
        readonly next: Node | null
      }
    `);

    expect(findActorBoundaryViolation(host, classType(table, "Node"), table)).toBeNull();
  });

  it("rejects actor handles discovered through generic class substitution", () => {
    const { host, table } = setup(`
      class Box<T> {
        readonly item: T
      }

      class Child {
        readonly id: int
      }
    `);
    const childActor: ResolvedType = {
      kind: "actor",
      innerClass: classType(table, "Child"),
    };

    const violation = findActorBoundaryViolation(
      host,
      classType(table, "Box", [childActor]),
      table,
    );

    expect(violation?.reason).toContain('field "item" cannot cross actor boundaries');
    expect(violation?.reason).toContain("Actor<T> references cannot cross actor boundaries");
    expect(violation?.offendingType).toEqual(childActor);
  });

  it("rejects mutable interface fields before resolving their type", () => {
    const { host, table } = setup(`
      interface MutableShape {
        value: int
      }

      class Point implements MutableShape {
        value: int
      }
    `);

    const violation = findActorBoundaryViolation(host, interfaceType(table, "MutableShape"), table);

    expect(violation?.reason).toBe('field "value" is mutable');
    expect(violation?.offendingType.kind).toBe("unknown");
  });

  it("rejects actor handles discovered through generic interface substitution", () => {
    const { host, table } = setup(`
      interface Envelope<T> {
        item: T
      }

      class Child {
        readonly id: int
      }

      class ChildEnvelope implements Envelope<Child> {
        readonly item: Child
      }
    `);
    const envelope = table.symbols.get("Envelope");
    if (envelope?.symbolKind !== "interface") throw new Error("Expected Envelope interface");
    envelope.declaration.fields[0].readonly_ = true;

    const childActor: ResolvedType = {
      kind: "actor",
      innerClass: classType(table, "Child"),
    };
    const violation = findActorBoundaryViolation(
      host,
      interfaceType(table, "Envelope", [childActor]),
      table,
    );

    expect(violation?.reason).toContain('field "item" cannot cross actor boundaries');
    expect(violation?.reason).toContain("Actor<T> references cannot cross actor boundaries");
    expect(violation?.offendingType).toEqual(childActor);
  });

  it("checks collection mutability before recursing into element types", () => {
    const { host, table } = setup("");
    const worker = setup("class Worker { readonly id: int }");
    const actorType: ResolvedType = {
      kind: "actor",
      innerClass: classType(worker.table, "Worker"),
    };

    const mutableArray: ResolvedType = { kind: "array", elementType: actorType, readonly_: false };
    const readonlyArray: ResolvedType = { kind: "array", elementType: actorType, readonly_: true };

    expect(findActorBoundaryViolation(host, mutableArray, table)?.reason).toBe('array type "Actor<Worker>[]" is mutable');
    expect(findActorBoundaryViolation(host, readonlyArray, table)?.reason).toBe("Actor<T> references cannot cross actor boundaries");
  });

  it("recurses through maps, sets, tuples, unions, weak references, and results", () => {
    const { host, table } = setup("");
    const promiseString: ResolvedType = { kind: "promise", valueType: STRING_TYPE };

    const nested: ResolvedType = {
      kind: "result",
      successType: {
        kind: "tuple",
        elements: [
          { kind: "weak", inner: { kind: "set", elementType: INT_TYPE, readonly_: true } },
          {
            kind: "union",
            types: [
              { kind: "map", keyType: INT_TYPE, valueType: promiseString, readonly_: true },
              { kind: "null" },
            ],
          },
        ],
      },
      errorType: STRING_TYPE,
    };

    const violation = findActorBoundaryViolation(host, nested, table);

    expect(violation?.reason).toBe("Promise<T> values cannot cross actor boundaries");
    expect(violation?.offendingType).toBe(promiseString);
  });

  it("reports callback parameter violations with the parameter name", () => {
    const { host, table } = setup("");
    const callback: ResolvedType = {
      kind: "function",
      params: [{ name: "payload", type: { kind: "array", elementType: INT_TYPE, readonly_: false } }],
      returnType: INT_TYPE,
    };

    const violation = findActorBoundaryViolation(host, callback, table);

    expect(violation?.reason).toBe('callback parameter "payload" cannot cross actor boundaries: array type "int[]" is mutable');
  });

  it("checks wrapper and reflection-like internal resolved types", () => {
    const { host, table } = setup(`
      class MutablePayload {
        value: int
      }
    `);
    const mutablePayload = classType(table, "MutablePayload");

    expect(findActorBoundaryViolation(host, { kind: "success-wrapper", valueType: mutablePayload }, table)?.reason)
      .toContain('field "value" is mutable');
    expect(findActorBoundaryViolation(host, { kind: "failure-wrapper", errorType: mutablePayload }, table)?.reason)
      .toContain('field "value" is mutable');
    expect(findActorBoundaryViolation(host, { kind: "class-metadata", classType: mutablePayload }, table)?.reason)
      .toContain('field "value" is mutable');
    expect(findActorBoundaryViolation(host, { kind: "method-reflection", classType: mutablePayload }, table)?.reason)
      .toContain('field "value" is mutable');
  });

  it("rejects stream, namespace, builtin namespace, and mock capture handles", () => {
    const { host, table } = setup("");

    expect(findActorBoundaryViolation(host, { kind: "stream", elementType: INT_TYPE }, table)?.reason)
      .toBe('stream type "Stream<int>" is mutable');
    expect(findActorBoundaryViolation(host, { kind: "namespace", sourceModule: "/other.do" }, table)?.reason)
      .toBe('type "namespace(/other.do)" cannot cross actor boundaries');
    expect(findActorBoundaryViolation(host, { kind: "builtin-namespace", name: "int" }, table)?.reason)
      .toBe('type "int" cannot cross actor boundaries');
    expect(findActorBoundaryViolation(host, { kind: "mock-capture", typeName: "Call", fields: [] }, table)?.reason)
      .toBe('type "Call" cannot cross actor boundaries');
  });
});
