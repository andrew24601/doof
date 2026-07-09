import { describe, expect, it } from "vitest";
import { ModuleAnalyzer } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import type { CheckerHost } from "./checker-internal.js";
import {
  typeToString,
  type ClassType,
  type InterfaceType,
  type ResolvedType,
} from "./checker-types.js";
import {
  applyDeepReadonly,
  findDeepReadonlyViolation,
} from "./checker-readonly.js";
import { check } from "./checker-test-helpers.js";
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
  expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);

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

function classFieldType(table: ModuleSymbolTable, className: string, fieldName: string): ResolvedType {
  const symbol = table.symbols.get(className);
  if (symbol?.symbolKind !== "class") throw new Error(`Expected class symbol ${className}`);
  const field = symbol.declaration.fields.find((candidate) => candidate.names.includes(fieldName));
  if (!field?.resolvedType) throw new Error(`Expected resolved field type ${className}.${fieldName}`);
  return field.resolvedType;
}

function interfaceFieldType(table: ModuleSymbolTable, interfaceName: string, fieldName: string): ResolvedType {
  const symbol = table.symbols.get(interfaceName);
  if (symbol?.symbolKind !== "interface") throw new Error(`Expected interface symbol ${interfaceName}`);
  const field = symbol.declaration.fields.find((candidate) => candidate.name === fieldName);
  if (!field?.resolvedType) throw new Error(`Expected resolved field type ${interfaceName}.${fieldName}`);
  return field.resolvedType;
}

describe("checker readonly helpers", () => {
  it("applies deep readonly to collection types parsed from Doof declarations", () => {
    const { table } = setup(`
      class Shapes {
        values: int[]
        lookup: Map<string, int[]>
        seen: Set<int>
        outcome: Result<Map<string, int[]>, Set<string> >
      }
    `);

    expect(typeToString(applyDeepReadonly(classFieldType(table, "Shapes", "values"))))
      .toBe("readonly int[]");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "Shapes", "lookup"))))
      .toBe("ReadonlyMap<string, readonly int[]>");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "Shapes", "seen"))))
      .toBe("ReadonlySet<int>");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "Shapes", "outcome"))))
      .toBe("Result<ReadonlyMap<string, readonly int[]>, ReadonlySet<string>>");
  });

  it("applies deep readonly through parsed wrappers and generic type arguments", () => {
    const { table } = setup(`
      class Worker {
        readonly id: int
      }

      class Box<T> {
        readonly item: T
      }

      class UsesWrappers {
        pending: Promise<int[]>
        worker: Actor<Worker>
        boxed: Box<int[]>
      }
    `);

    expect(typeToString(applyDeepReadonly(classFieldType(table, "UsesWrappers", "pending"))))
      .toBe("Promise<readonly int[]>");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "UsesWrappers", "worker"))))
      .toBe("Actor<Worker>");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "UsesWrappers", "boxed"))))
      .toBe("Box<readonly int[]>");
  });

  it("reports mutable collections discovered through parsed nested containers", () => {
    const { host, table } = setup(`
      class ParsedTypes {
        nested: Result<readonly Map<string, Set<int> >, string>
      }
    `);

    const violation = findDeepReadonlyViolation(
      host,
      classFieldType(table, "ParsedTypes", "nested"),
      table,
    );

    expect(violation?.reason).toBe('set type "Set<int>" is mutable');
  });

  it("rejects mutable fields on parsed classes and interfaces", () => {
    const { host, table } = setup(`
      class MutableClass {
        value: int
      }

      interface MutableInterface {
        value: int
      }
    `);

    expect(findDeepReadonlyViolation(host, classType(table, "MutableClass"), table)?.reason)
      .toBe('field "value" is mutable');
    expect(findDeepReadonlyViolation(host, interfaceType(table, "MutableInterface"), table)?.reason)
      .toBe('field "value" is mutable');
  });

  it("uses concrete generic arguments from parsed declarations when validating fields", () => {
    const { host, table } = setup(`
      class Box<T> {
        readonly item: T
      }

      interface Slot<T> {
        readonly item: T
      }

      class MutablePayload {
        value: int
      }
    `);

    const mutablePayload = classType(table, "MutablePayload");

    expect(findDeepReadonlyViolation(host, classType(table, "Box", [mutablePayload]), table)?.reason)
      .toContain('field "item" is not deeply immutable: field "value" is mutable');
    expect(findDeepReadonlyViolation(host, interfaceType(table, "Slot", [mutablePayload]), table)?.reason)
      .toContain('field "item" is not deeply immutable: field "value" is mutable');
  });

  it("accepts recursive readonly class and interface graphs without looping", () => {
    const { host, table } = setup(`
      class Node {
        readonly value: int
        readonly next: Node | null
      }

      interface Linked<T> {
        readonly value: T
        readonly next: Linked<T> | null
      }
    `);

    expect(findDeepReadonlyViolation(host, classType(table, "Node"), table)).toBeNull();
    expect(findDeepReadonlyViolation(host, interfaceType(table, "Linked", [
      classFieldType(table, "Node", "value"),
    ]), table)).toBeNull();
  });

  it("applies deep readonly semantics to declarations before validation", () => {
    const cr = check({
      "/main.do": `
        readonly nested: Map<string, int[]> = { "a": [1, 2] }
      `,
    }, "/main.do");

    expect(cr.diagnostics).toHaveLength(0);
    expect(typeToString((cr.program.statements[0] as { resolvedType?: ResolvedType }).resolvedType!))
      .toBe("ReadonlyMap<string, readonly int[]>");
  });

  it("surfaces readonly declaration violations with the reachable mutable field", () => {
    const cr = check({
      "/main.do": `
        class MutablePayload {
          value: int
        }

        readonly payload = MutablePayload { value: 1 }
      `,
    }, "/main.do");

    expect(cr.diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Readonly declaration requires a deeply immutable type")
        && diagnostic.message.includes('field "value" is mutable'),
    )).toBe(true);
  });

  it("keeps readonly interface field types aligned with parsed annotations", () => {
    const { table } = setup(`
      interface Envelope<T> {
        readonly item: T
      }

      class IntEnvelope implements Envelope<int[]> {
        readonly item: int[]
      }

      class ParsedTypes {
        item: Envelope<int[]>
      }
    `);

    expect(typeToString(applyDeepReadonly(interfaceFieldType(table, "Envelope", "item"))))
      .toBe("T");
    expect(typeToString(applyDeepReadonly(classFieldType(table, "ParsedTypes", "item"))))
      .toBe("Envelope<readonly int[]>");
  });
});
