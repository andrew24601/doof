/**
 * Tests for JSON Schema Draft 7 generation from ResolvedType.
 */

import { describe, it, expect } from "vitest";
import {
  typeToJsonSchema,
  classToJsonSchema,
  methodInputSchema,
  methodOutputSchema,
  buildClassMetadata,
  type JsonSchema,
} from "./emitter-schema.js";
import type { ResolvedType, ClassType } from "./checker-types.js";
import { check } from "./checker-test-helpers.js";
import type { ClassDeclaration, FunctionDeclaration } from "./ast.js";

// ============================================================================
// Helper: get the class declaration from a check result
// ============================================================================
function getClassDecl(source: string, className = "Test"): ClassDeclaration {
  const cr = check({ "/main.do": source }, "/main.do");
  expect(cr.diagnostics).toHaveLength(0);
  const decl = cr.program.statements.find(
    (s) => s.kind === "class-declaration" && s.name === className,
  );
  if (!decl || decl.kind !== "class-declaration") {
    throw new Error(`Class "${className}" not found`);
  }
  return decl;
}

function getClassType(source: string, className = "Test"): ClassType {
  const cr = check({ "/main.do": source }, "/main.do");
  expect(cr.diagnostics).toHaveLength(0);
  const table = cr.result.modules.get("/main.do")!;
  const sym = table.symbols.get(className);
  if (!sym || sym.symbolKind !== "class") {
    throw new Error(`Class symbol "${className}" not found`);
  }
  return { kind: "class", symbol: sym };
}

// ============================================================================
// Primitive types
// ============================================================================
describe("typeToJsonSchema — primitives", () => {
  it("maps byte to bounded integer", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "byte" }, new Map());
    expect(schema).toEqual({ type: "integer", minimum: 0, maximum: 255 });
  });

  it("maps int to integer/int32", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "int" }, new Map());
    expect(schema).toEqual({ type: "integer", format: "int32" });
  });

  it("maps long to integer/int64", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "long" }, new Map());
    expect(schema).toEqual({ type: "integer", format: "int64" });
  });

  it("maps float to number", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "float" }, new Map());
    expect(schema).toEqual({ type: "number" });
  });

  it("maps double to number", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "double" }, new Map());
    expect(schema).toEqual({ type: "number" });
  });

  it("maps string to string", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "string" }, new Map());
    expect(schema).toEqual({ type: "string" });
  });

  it("maps char to string", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "char" }, new Map());
    expect(schema).toEqual({ type: "string" });
  });

  it("maps bool to boolean", () => {
    const schema = typeToJsonSchema({ kind: "primitive", name: "bool" }, new Map());
    expect(schema).toEqual({ type: "boolean" });
  });
});

// ============================================================================
// Null and void
// ============================================================================
describe("typeToJsonSchema — null/void", () => {
  it("maps null to null", () => {
    const schema = typeToJsonSchema({ kind: "null" }, new Map());
    expect(schema).toEqual({ type: "null" });
  });

  it("maps void to null", () => {
    const schema = typeToJsonSchema({ kind: "void" }, new Map());
    expect(schema).toEqual({ type: "null" });
  });
});

// ============================================================================
// Array types
// ============================================================================
describe("typeToJsonSchema — arrays", () => {
  it("maps array of int", () => {
    const type: ResolvedType = {
      kind: "array",
      elementType: { kind: "primitive", name: "int" },
      readonly_: false,
    };
    const schema = typeToJsonSchema(type, new Map());
    expect(schema).toEqual({ type: "array", items: { type: "integer", format: "int32" } });
  });
});

// ============================================================================
// Tuple types
// ============================================================================
describe("typeToJsonSchema — tuples", () => {
  it("maps tuple of (int, string)", () => {
    const type: ResolvedType = {
      kind: "tuple",
      elements: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
      ],
    };
    const schema = typeToJsonSchema(type, new Map());
    expect(schema).toEqual({
      type: "array",
      items: [{ type: "integer", format: "int32" }, { type: "string" }],
      minItems: 2,
      maxItems: 2,
    });
  });
});

// ============================================================================
// Enum types
// ============================================================================
describe("typeToJsonSchema — enums", () => {
  it("maps enum to enum array", () => {
    const decl = getClassDecl(`
      enum Status { Active, Inactive, Archived }
      class Test { status: Status }
    `);
    const field = decl.fields[0];
    expect(field.resolvedType).toBeDefined();
    const defs = new Map<string, JsonSchema>();
    const schema = typeToJsonSchema(field.resolvedType!, defs);
    expect(schema).toEqual({ enum: ["Active", "Inactive", "Archived"] });
  });
});

// ============================================================================
// Union types
// ============================================================================
describe("typeToJsonSchema — unions", () => {
  it("maps nullable type to anyOf with null", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "string" },
        { kind: "null" },
      ],
    };
    const schema = typeToJsonSchema(type, new Map());
    expect(schema).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("maps multi-type union to anyOf", () => {
    const type: ResolvedType = {
      kind: "union",
      types: [
        { kind: "primitive", name: "int" },
        { kind: "primitive", name: "string" },
      ],
    };
    const schema = typeToJsonSchema(type, new Map());
    expect(schema).toEqual({
      anyOf: [{ type: "integer", format: "int32" }, { type: "string" }],
    });
  });
});

// ============================================================================
// Class types → $ref/$defs
// ============================================================================
describe("typeToJsonSchema — class $ref", () => {
  it("emits $ref and populates defs for class type", () => {
    const classType = getClassType(`
      class Test {
        x, y: float
      }
    `);
    const defs = new Map<string, JsonSchema>();
    const schema = typeToJsonSchema(classType, defs);
    expect(schema).toEqual({ $ref: "#/$defs/Test" });
    expect(defs.has("Test")).toBe(true);
    const testDef = defs.get("Test")!;
    expect(testDef.type).toBe("object");
    expect((testDef.properties as any).x).toEqual({ type: "number" });
    expect((testDef.properties as any).y).toEqual({ type: "number" });
    expect(testDef.required).toEqual(["x", "y"]);
  });

  it("handles nested class references", () => {
    const cr = check({ "/main.do": `
      class Point { x, y: float }
      class Line {
        start: Point
        end_: Point
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const table = cr.result.modules.get("/main.do")!;
    const lineSym = table.symbols.get("Line");
    if (!lineSym || lineSym.symbolKind !== "class") throw new Error("Line not found");
    const lineType: ClassType = { kind: "class", symbol: lineSym };

    const defs = new Map<string, JsonSchema>();
    const schema = typeToJsonSchema(lineType, defs);
    expect(schema).toEqual({ $ref: "#/$defs/Line" });
    expect(defs.has("Line")).toBe(true);
    expect(defs.has("Point")).toBe(true);

    const lineDef = defs.get("Line")!;
    expect((lineDef.properties as any).start).toEqual({ $ref: "#/$defs/Point" });
    expect((lineDef.properties as any).end_).toEqual({ $ref: "#/$defs/Point" });
  });

  it("handles circular class references without infinite loop", () => {
    const cr = check({ "/main.do": `
      class Node {
        value: int
        next: Node | null
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const table = cr.result.modules.get("/main.do")!;
    const nodeSym = table.symbols.get("Node");
    if (!nodeSym || nodeSym.symbolKind !== "class") throw new Error("Node not found");

    const defs = new Map<string, JsonSchema>();
    const schema = typeToJsonSchema({ kind: "class", symbol: nodeSym }, defs);
    expect(schema).toEqual({ $ref: "#/$defs/Node" });
    expect(defs.has("Node")).toBe(true);
  });
});

// ============================================================================
// classToJsonSchema
// ============================================================================
describe("classToJsonSchema", () => {
  it("generates object schema with properties and required", () => {
    const decl = getClassDecl(`
      class Test "A test class." {
        name "The name.": string
        count: int
      }
    `);
    const defs = new Map<string, JsonSchema>();
    classToJsonSchema(decl, defs);
    const schema = defs.get("Test")!;
    expect(schema.type).toBe("object");
    expect(schema.description).toBe("A test class.");
    expect((schema.properties as any).name).toEqual({ type: "string", description: "The name." });
    expect((schema.properties as any).count).toEqual({ type: "integer", format: "int32" });
    expect(schema.required).toEqual(["name", "count"]);
  });

  it("excludes private and const fields", () => {
    const decl = getClassDecl(`
      class Test {
        const kind = "test"
        private secret: string
        name: string
      }
    `);
    const defs = new Map<string, JsonSchema>();
    classToJsonSchema(decl, defs);
    const schema = defs.get("Test")!;
    const props = schema.properties as Record<string, unknown>;
    expect(props.kind).toBeUndefined();
    expect(props.secret).toBeUndefined();
    expect(props.name).toEqual({ type: "string" });
  });

  it("marks fields with defaults as optional", () => {
    const decl = getClassDecl(`
      class Test {
        name: string
        count: int = 0
      }
    `);
    const defs = new Map<string, JsonSchema>();
    classToJsonSchema(decl, defs);
    const schema = defs.get("Test")!;
    expect(schema.required).toEqual(["name"]);
  });
});

// ============================================================================
// methodInputSchema / methodOutputSchema
// ============================================================================
describe("methodInputSchema", () => {
  it("generates object schema from method params", () => {
    const decl = getClassDecl(`
      class Test {
        function greet "Says hello."(
          name "The name.": string,
          count: int = 1
        ): string => name
      }
    `);
    const method = decl.methods[0];
    const defs = new Map<string, JsonSchema>();
    const schema = methodInputSchema(method, defs);
    expect(schema.type).toBe("object");
    expect((schema.properties as any).name).toEqual({ type: "string", description: "The name." });
    expect((schema.properties as any).count).toEqual({ type: "integer", format: "int32" });
    expect(schema.required).toEqual(["name"]);
  });
});

describe("methodOutputSchema", () => {
  it("generates schema from return type", () => {
    const decl = getClassDecl(`
      class Test {
        function greet(name: string): string => name
      }
    `);
    const method = decl.methods[0];
    const defs = new Map<string, JsonSchema>();
    const schema = methodOutputSchema(method, defs);
    expect(schema).toEqual({ type: "string" });
  });

  it("generates null schema for void return", () => {
    const decl = getClassDecl(`
      class Test {
        function doStuff(): void { }
      }
    `);
    const method = decl.methods[0];
    const defs = new Map<string, JsonSchema>();
    const schema = methodOutputSchema(method, defs);
    expect(schema).toEqual({ type: "null" });
  });

  it("unwraps Result success type for metadata output schema", () => {
    const decl = getClassDecl(`
      class Test {
        function greet(name: string): Result<string, int> => Success(name)
      }
    `);
    const method = decl.methods[0];
    const defs = new Map<string, JsonSchema>();
    const schema = methodOutputSchema(method, defs);
    expect(schema).toEqual({ type: "string" });
  });

  it("unwraps Result<void, E> to null schema", () => {
    const decl = getClassDecl(`
      class Test {
        function reset(): Result<void, string> => Success()
      }
    `);
    const method = decl.methods[0];
    const defs = new Map<string, JsonSchema>();
    const schema = methodOutputSchema(method, defs);
    expect(schema).toEqual({ type: "null" });
  });
});

// ============================================================================
// buildClassMetadata (full integration)
// ============================================================================
describe("buildClassMetadata", () => {
  it("produces complete metadata object", () => {
    const decl = getClassDecl(`
      class Test "A test tool." {
        name: string
        function run "Runs the tool."(
          input "The input.": string
        ): string => input
        function reset(): void { }
      }
    `);
    const meta = buildClassMetadata(decl);
    expect(meta.name).toBe("Test");
    expect(meta.description).toBe("A test tool.");
    expect(meta.methods).toHaveLength(2);

    const run = (meta.methods as any[])[0];
    expect(run.name).toBe("run");
    expect(run.description).toBe("Runs the tool.");
    expect(run.inputSchema.properties.input).toEqual({ type: "string", description: "The input." });
    expect(run.inputSchema.required).toEqual(["input"]);
    expect(run.outputSchema).toEqual({ type: "string" });

    const reset = (meta.methods as any[])[1];
    expect(reset.name).toBe("reset");
    expect(reset.description).toBeUndefined();
    expect(reset.outputSchema).toEqual({ type: "null" });
  });

  it("excludes private and static methods", () => {
    const decl = getClassDecl(`
      class Test {
        function run(input: string): string => input
        private function helper(): void { }
        static function create(): Test => Test { }
      }
    `);
    const meta = buildClassMetadata(decl);
    expect(meta.methods).toHaveLength(1);
    expect((meta.methods as any[])[0].name).toBe("run");
  });

  it("populates $defs for class-typed parameters", () => {
    const cr = check({ "/main.do": `
      class Config {
        host: string
        port: int
      }
      class Test {
        function configure(config: Config): string => config.host
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const decl = cr.program.statements.find(
      (s) => s.kind === "class-declaration" && s.name === "Test",
    ) as ClassDeclaration;

    const meta = buildClassMetadata(decl);
    expect(meta.$defs).toBeDefined();
    const defs = meta.$defs as Record<string, any>;
    expect(defs.Config).toBeDefined();
    expect(defs.Config.type).toBe("object");
    expect(defs.Config.properties.host).toEqual({ type: "string" });
    expect(defs.Config.properties.port).toEqual({ type: "integer", format: "int32" });
  });

  it("omits $defs when no class types are referenced", () => {
    const decl = getClassDecl(`
      class Test {
        function add(a: int, b: int): int => a + b
      }
    `);
    const meta = buildClassMetadata(decl);
    expect(meta.$defs).toBeUndefined();
  });
});
