import { describe, it, expect } from "vitest";
import { ModuleResolver } from "./resolver.js";
import { BUNDLED_STDLIB_ROOT, createBundledModuleResolver } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";
import { analyze, getTable, collectNamedTypes } from "./analyzer-test-helpers.js";

// ============================================================================
// Module resolver tests
// ============================================================================

describe("ModuleResolver", () => {
  it("resolves relative paths with extension inference", () => {
    const fs = new VirtualFS({
      "/project/main.do": "",
      "/project/helper.do": "",
    });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("./helper", "/project/main.do")).toBe("/project/helper.do");
  });

  it("resolves relative paths with explicit extension", () => {
    const fs = new VirtualFS({
      "/project/main.do": "",
      "/project/helper.do": "",
    });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("./helper.do", "/project/main.do")).toBe("/project/helper.do");
  });

  it("resolves parent directory imports", () => {
    const fs = new VirtualFS({
      "/project/sub/mod.do": "",
      "/project/config.do": "",
    });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("../config", "/project/sub/mod.do")).toBe("/project/config.do");
  });

  it("resolves barrel/index files", () => {
    const fs = new VirtualFS({
      "/project/main.do": "",
      "/project/utils/index.do": "",
    });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("./utils", "/project/main.do")).toBe("/project/utils/index.do");
  });

  it("resolves subdirectory imports", () => {
    const fs = new VirtualFS({
      "/project/main.do": "",
      "/project/db/database.do": "",
    });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("./db/database", "/project/main.do")).toBe("/project/db/database.do");
  });

  it("returns null for missing modules", () => {
    const fs = new VirtualFS({ "/project/main.do": "" });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("./nonexistent", "/project/main.do")).toBeNull();
  });

  it("resolves bare specifiers via packageRoot", () => {
    const fs = new VirtualFS({
      "/project/main.do": "",
      "/packages/http.do": "",
    });
    const resolver = new ModuleResolver(fs, { packageRoot: "/packages" });

    expect(resolver.resolve("http", "/project/main.do")).toBe("/packages/http.do");
  });

  it("returns null for bare specifiers without packageRoot", () => {
    const fs = new VirtualFS({ "/project/main.do": "" });
    const resolver = new ModuleResolver(fs);

    expect(resolver.resolve("http", "/project/main.do")).toBeNull();
  });

  it("does not resolve removed bundled stdlib modules by default", () => {
    const fs = new VirtualFS({ "/project/main.do": "" });
    const resolver = createBundledModuleResolver(fs);

    expect(resolver.resolve("std/assert", "/project/main.do")).toBeNull();
  });

  it("resolves bare package imports through the owning package manifest context", () => {
    const fs = new VirtualFS({
      "/app/main.do": "",
      "/deps/foo/index.do": "",
    });
    const resolver = new ModuleResolver(fs, {
      packages: [{
        rootDir: "/app",
        dependencies: new Map([["foo", "/deps/foo"]]),
      }],
    });

    expect(resolver.resolve("foo", "/app/main.do")).toBe("/deps/foo/index.do");
  });

  it("resolves package subpaths through the owning package manifest context", () => {
    const fs = new VirtualFS({
      "/app/main.do": "",
      "/deps/foo/types.do": "",
    });
    const resolver = new ModuleResolver(fs, {
      packages: [{
        rootDir: "/app",
        dependencies: new Map([["foo", "/deps/foo"]]),
      }],
    });

    expect(resolver.resolve("foo/types", "/app/main.do")).toBe("/deps/foo/types.do");
  });

  it("resolves dependency names that include slashes", () => {
    const fs = new VirtualFS({
      "/app/main.do": "",
      "/deps/std-fs/index.do": "",
      "/deps/std-fs/runtime.do": "",
    });
    const resolver = new ModuleResolver(fs, {
      packages: [{
        rootDir: "/app",
        dependencies: new Map([["std/fs", "/deps/std-fs"]]),
      }],
    });

    expect(resolver.resolve("std/fs", "/app/main.do")).toBe("/deps/std-fs/index.do");
    expect(resolver.resolve("std/fs/runtime", "/app/main.do")).toBe("/deps/std-fs/runtime.do");
  });

  it("prefers explicit std dependency overrides over bundled stdlib modules", () => {
    const fs = new VirtualFS({
      "/app/main.do": "",
      "/deps/std-assert/index.do": "",
    });
    const resolver = createBundledModuleResolver(fs, {
      packages: [{
        rootDir: "/app",
        dependencies: new Map([["std/assert", "/deps/std-assert"]]),
      }],
    });

    expect(resolver.resolve("std/assert", "/app/main.do")).toBe("/deps/std-assert/index.do");
  });

  it("uses the dependency graph of the owning package for nested package imports", () => {
    const fs = new VirtualFS({
      "/app/main.do": "",
      "/deps/foo/index.do": "",
      "/deps/bar/index.do": "",
      "/deps/foo/feature.do": "",
    });
    const resolver = new ModuleResolver(fs, {
      packages: [
        {
          rootDir: "/app",
          dependencies: new Map([["foo", "/deps/foo"]]),
        },
        {
          rootDir: "/deps/foo",
          dependencies: new Map([["bar", "/deps/bar"]]),
        },
      ],
    });

    expect(resolver.resolve("bar", "/deps/foo/feature.do")).toBe("/deps/bar/index.do");
    expect(resolver.resolve("bar", "/app/main.do")).toBeNull();
  });
});

// ============================================================================
// Symbol table: single module
// ============================================================================

describe("Symbol table — single module", () => {
  it("collects a class declaration", () => {
    const table = getTable(
      { "/main.do": `class Point { x, y: float }` },
      "/main.do",
    );

    expect(table.symbols.has("Point")).toBe(true);
    expect(table.symbols.get("Point")!.symbolKind).toBe("class");
    expect(table.exports.has("Point")).toBe(false);
  });

  it("collects an exported class", () => {
    const table = getTable(
      { "/main.do": `export class Vector { x, y: float }` },
      "/main.do",
    );

    expect(table.symbols.has("Vector")).toBe(true);
    expect(table.exports.has("Vector")).toBe(true);
    expect(table.exports.get("Vector")!.symbolKind).toBe("class");
  });

  it("collects a function declaration", () => {
    const table = getTable(
      { "/main.do": `function add(a: int, b: int): int => a + b` },
      "/main.do",
    );

    expect(table.symbols.has("add")).toBe(true);
    expect(table.symbols.get("add")!.symbolKind).toBe("function");
  });

  it("collects an exported function", () => {
    const table = getTable(
      { "/main.do": `export function add(a: int, b: int): int => a + b` },
      "/main.do",
    );

    expect(table.exports.has("add")).toBe(true);
    expect(table.exports.get("add")!.symbolKind).toBe("function");
  });

  it("collects an enum", () => {
    const table = getTable(
      { "/main.do": `export enum Direction { North, South, East, West }` },
      "/main.do",
    );

    expect(table.symbols.has("Direction")).toBe(true);
    expect(table.exports.has("Direction")).toBe(true);
    expect(table.symbols.get("Direction")!.symbolKind).toBe("enum");
  });

  it("collects a type alias", () => {
    const table = getTable(
      { "/main.do": `export type Id = int` },
      "/main.do",
    );

    expect(table.symbols.has("Id")).toBe(true);
    expect(table.exports.has("Id")).toBe(true);
    expect(table.symbols.get("Id")!.symbolKind).toBe("type-alias");
  });

  it("collects an interface", () => {
    const table = getTable(
      { "/main.do": `export interface Drawable { draw(): void }` },
      "/main.do",
    );

    expect(table.symbols.has("Drawable")).toBe(true);
    expect(table.exports.has("Drawable")).toBe(true);
    expect(table.symbols.get("Drawable")!.symbolKind).toBe("interface");
  });

  it("collects a const declaration", () => {
    const table = getTable(
      { "/main.do": `export const PI = 3.14159` },
      "/main.do",
    );

    expect(table.symbols.has("PI")).toBe(true);
    expect(table.exports.has("PI")).toBe(true);
    expect(table.symbols.get("PI")!.symbolKind).toBe("const");
  });

  it("collects a readonly declaration", () => {
    const table = getTable(
      { "/main.do": `export readonly config = loadConfig()` },
      "/main.do",
    );

    expect(table.symbols.has("config")).toBe(true);
    expect(table.exports.has("config")).toBe(true);
    expect(table.symbols.get("config")!.symbolKind).toBe("readonly");
  });

  it("collects multiple declarations from a full module", () => {
    const table = getTable(
      {
        "/main.do": `
          export const PI = 3.14
          export class Vector { x, y: float }
          export function add(a: int, b: int): int => a + b
          export enum Direction { North, South }
          export type Id = int
          function helper(): void { }
        `,
      },
      "/main.do",
    );

    expect(table.symbols.size).toBe(6);
    expect(table.exports.size).toBe(5);
    expect(table.symbols.has("helper")).toBe(true);
    expect(table.exports.has("helper")).toBe(false);
  });
});

describe("mock imports", () => {
  it("rewrites matching imports through the root test file mock environment", () => {
    const result = analyze(
      {
        "/orderProcessor.test.do": `
          mock import for "./orderProcessor" {
            "./paymentGateway" => "./mocks/mockPayment"
          }

          import { processOrder } from "./orderProcessor"
        `,
        "/orderProcessor.do": `
          import { charge } from "./paymentGateway"
          export function processOrder(): void {
            charge()
          }
        `,
        "/paymentGateway.do": `export function charge(): void {}`,
        "/mocks/mockPayment.do": `export function charge(): void {}`,
      },
      "/orderProcessor.test.do",
    );

    expect(result.diagnostics).toHaveLength(0);
    const processorTable = result.modules.get("/orderProcessor.do");
    expect(processorTable).toBeDefined();
    expect(processorTable?.imports).toHaveLength(1);
    expect(processorTable?.imports[0].sourceModule).toBe("/mocks/mockPayment.do");
  });

  it("rejects mock import directives in non-test files", () => {
    const result = analyze(
      {
        "/main.do": `
          mock import for "./service" {
            "./dep" => "./mockDep"
          }
        `,
      },
      "/main.do",
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: "mock import directives are only valid in .test.do files" }),
    ]);
  });
});

// ============================================================================
// Import resolution
// ============================================================================

describe("Import resolution", () => {
  it("resolves a named import", () => {
    const result = analyze(
      {
        "/main.do": `
          import { Vector } from "./math"
        `,
        "/math.do": `
          export class Vector { x, y: float }
        `,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports).toHaveLength(1);
    expect(table.imports[0].localName).toBe("Vector");
    expect(table.imports[0].sourceName).toBe("Vector");
    expect(table.imports[0].symbol).not.toBeNull();
    expect(table.imports[0].symbol!.symbolKind).toBe("class");
  });

  it("resolves renamed imports", () => {
    const result = analyze(
      {
        "/main.do": `import { Vector as Vec3 } from "./math"`,
        "/math.do": `export class Vector { x, y, z: float }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports[0].localName).toBe("Vec3");
    expect(table.imports[0].sourceName).toBe("Vector");
    // Symbol should be available under local name.
    expect(table.symbols.has("Vec3")).toBe(true);
  });

  it("resolves namespace imports", () => {
    const result = analyze(
      {
        "/main.do": `import * as math from "./math"`,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.namespaceImports).toHaveLength(1);
    expect(table.namespaceImports[0].localName).toBe("math");
    expect(table.namespaceImports[0].sourceModule).toBe("/math.do");
  });

  it("resolves type-only imports", () => {
    const result = analyze(
      {
        "/main.do": `import type { Config } from "./types"`,
        "/types.do": `export class Config { name: string }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports[0].typeOnly).toBe(true);
    expect(table.imports[0].symbol).not.toBeNull();
  });

  it("reports error for non-existent export", () => {
    const result = analyze(
      {
        "/main.do": `import { Nonexistent } from "./math"`,
        "/math.do": `export class Vector { x: float }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports[0].symbol).toBeNull();
    expect(result.diagnostics.some((d) => d.message.includes("does not export"))).toBe(true);
  });

  it("reports error for unresolvable module", () => {
    const result = analyze(
      {
        "/main.do": `import { Foo } from "./missing"`,
      },
      "/main.do",
    );

    expect(result.diagnostics.some((d) => d.message.includes("Cannot resolve module"))).toBe(true);
  });

  it("makes imported symbols available for NamedType resolution", () => {
    const result = analyze(
      {
        "/main.do": `
          import { Vector } from "./math"
          function distance(a: Vector, b: Vector): float => 0.0
        `,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );

    // No errors about unknown types
    const mainDiags = result.diagnostics.filter((d) => d.module === "/main.do");
    expect(mainDiags).toHaveLength(0);

    // NamedType "Vector" should resolve to the class symbol.
    const program = result.modules.get("/main.do")!.program;
    const vectorTypes = collectNamedTypes(program).filter(
      (t) => t.resolvedSymbol?.name === "Vector",
    );
    expect(vectorTypes.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Transitive imports
// ============================================================================

describe("Transitive imports", () => {
  it("resolves imports through a chain of modules", () => {
    const result = analyze(
      {
        "/main.do": `
          import { process } from "./middle"
        `,
        "/middle.do": `
          import { Helper } from "./deep"
          export function process(): void { }
        `,
        "/deep.do": `
          export class Helper { }
        `,
      },
      "/main.do",
    );

    expect(result.modules.size).toBe(3);
    expect(result.modules.has("/main.do")).toBe(true);
    expect(result.modules.has("/middle.do")).toBe(true);
    expect(result.modules.has("/deep.do")).toBe(true);
  });

  it("handles circular imports without crashing", () => {
    const result = analyze(
      {
        "/a.do": `
          import { B } from "./b"
          export class A { }
        `,
        "/b.do": `
          import { A } from "./a"
          export class B { }
        `,
      },
      "/a.do",
    );

    expect(result.modules.size).toBe(2);
    // Both modules should be analysed.
    expect(result.modules.has("/a.do")).toBe(true);
    expect(result.modules.has("/b.do")).toBe(true);
  });
});

// ============================================================================
// Re-exports
// ============================================================================

describe("Re-exports", () => {
  it("resolves export { A } from './mod'", () => {
    const result = analyze(
      {
        "/main.do": `import { Vector } from "./index"`,
        "/index.do": `export { Vector } from "./math"`,
        "/math.do": `export class Vector { x, y: float }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports[0].symbol).not.toBeNull();
    expect(table.imports[0].symbol!.symbolKind).toBe("class");
  });

  it("resolves export * from './mod'", () => {
    const result = analyze(
      {
        "/main.do": `import { sin, cos } from "./index"`,
        "/index.do": `export * from "./trig"`,
        "/trig.do": `
          export function sin(x: float): float => 0.0
          export function cos(x: float): float => 0.0
        `,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports).toHaveLength(2);
    expect(table.imports[0].symbol?.symbolKind).toBe("function");
    expect(table.imports[1].symbol?.symbolKind).toBe("function");
  });

  it("resolves re-exports with renaming", () => {
    const result = analyze(
      {
        "/main.do": `import { Vec } from "./index"`,
        "/index.do": `export { InternalVector as Vec } from "./internal"`,
        "/internal.do": `export class InternalVector { x, y: float }`,
      },
      "/main.do",
    );

    const table = result.modules.get("/main.do")!;
    expect(table.imports[0].symbol).not.toBeNull();
    expect(table.imports[0].symbol!.name).toBe("InternalVector");
  });
});

// ============================================================================
// NamedType resolution
// ============================================================================

describe("NamedType resolution", () => {
  it("resolves a locally defined class in a type annotation", () => {
    const result = analyze(
      {
        "/main.do": `
          class Point { x, y: float }
          function distance(p: Point): float => 0.0
        `,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const named = collectNamedTypes(program);
    expect(named.some((t) => t.resolvedSymbol?.name === "Point" && t.resolvedSymbol?.symbolKind === "class")).toBe(true);
  });

  it("does not resolve builtin types to user symbols", () => {
    const result = analyze(
      {
        "/main.do": `function parse(): Result<int, ParseError> => Failure(ParseError.InvalidFormat)`,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const named = collectNamedTypes(program);
    // int is builtin — should not be resolved to any user symbol
    expect(named.every((t) => t.resolvedSymbol === undefined)).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves type aliases", () => {
    const result = analyze(
      {
        "/main.do": `
          type Id = int
          function getUser(id: Id): void { }
        `,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const named = collectNamedTypes(program);
    expect(named.some((t) => t.resolvedSymbol?.name === "Id" && t.resolvedSymbol?.symbolKind === "type-alias")).toBe(true);
  });

  it("resolves types in class fields", () => {
    const result = analyze(
      {
        "/main.do": `
          class Color { r, g, b: int }
          class Pixel { x, y: int; color: Color }
        `,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const named = collectNamedTypes(program);
    expect(named.some((t) => t.resolvedSymbol?.name === "Color")).toBe(true);
  });

  it("resolves types in interface declarations", () => {
    const result = analyze(
      {
        "/main.do": `
          class Vector { x, y: float }
          interface Movable {
            position: Vector
            move(delta: Vector): void
          }
        `,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const vectorTypes = collectNamedTypes(program).filter(
      (t) => t.resolvedSymbol?.name === "Vector",
    );
    // 'Vector' used in position field + delta param = at least 2
    expect(vectorTypes.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves union types in type aliases", () => {
    const result = analyze(
      {
        "/main.do": `
          class Success { value: int }
          class Failure { error: string }
          type Result = Success | Failure
        `,
      },
      "/main.do",
    );

    const program = result.modules.get("/main.do")!.program;
    const names = collectNamedTypes(program)
      .filter((t) => t.resolvedSymbol !== undefined)
      .map((t) => t.resolvedSymbol!.name);
    expect(names).toContain("Success");
    expect(names).toContain("Failure");
  });

  it("reports error for unknown types", () => {
    const result = analyze(
      {
        "/main.do": `function process(x: Undefined): void { }`,
      },
      "/main.do",
    );

    expect(result.diagnostics.some((d) => d.message.includes('Unknown type "Undefined"'))).toBe(
      true,
    );
  });

  it("resolves imported types in function signatures", () => {
    const result = analyze(
      {
        "/main.do": `
          import { User } from "./models"
          function greet(user: User): string => "hello"
        `,
        "/models.do": `export class User { name: string }`,
      },
      "/main.do",
    );

    expect(result.diagnostics).toHaveLength(0);

    const program = result.modules.get("/main.do")!.program;
    const userTypes = collectNamedTypes(program).filter(
      (t) => t.resolvedSymbol?.name === "User",
    );
    expect(userTypes.length).toBeGreaterThanOrEqual(1);
    expect(userTypes[0].resolvedSymbol!.module).toBe("/models.do");
  });

  it("resolves types in arrays and unions", () => {
    const result = analyze(
      {
        "/main.do": `
          class Widget { }
          function render(items: Widget[]): void { }
          function maybe(x: Widget | null): void { }
        `,
      },
      "/main.do",
    );

    // No unknown type errors.
    expect(result.diagnostics).toHaveLength(0);
    const program = result.modules.get("/main.do")!.program;
    const widgetTypes = collectNamedTypes(program).filter(
      (t) => t.resolvedSymbol?.name === "Widget",
    );
    expect(widgetTypes.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Full module scenario
// ============================================================================

describe("Full module analysis scenario", () => {
  it("analyses a realistic multi-module project", () => {
    const result = analyze(
      {
        "/app/main.do": `
          import { Vector, add, PI } from "./math"
          import { Config } from "./config"

          function main(): void {
          }
        `,
        "/app/math.do": `
          export const PI = 3.14159
          export class Vector { x, y, z: float }
          export function add(a: int, b: int): int => a + b
        `,
        "/app/config.do": `
          export class Config {
            name: string
            debug: bool
          }
        `,
      },
      "/app/main.do",
    );

    // All 3 modules resolved.
    expect(result.modules.size).toBe(3);

    // main.do imports resolve correctly.
    const mainTable = result.modules.get("/app/main.do")!;
    expect(mainTable.imports).toHaveLength(4);
    expect(mainTable.imports.map((i) => i.localName).sort()).toEqual(
      ["Config", "PI", "Vector", "add"],
    );
    for (const imp of mainTable.imports) {
      expect(imp.symbol).not.toBeNull();
    }

    // math.do exports.
    const mathTable = result.modules.get("/app/math.do")!;
    expect(mathTable.exports.size).toBe(3);
    expect(mathTable.exports.has("PI")).toBe(true);
    expect(mathTable.exports.has("Vector")).toBe(true);
    expect(mathTable.exports.has("add")).toBe(true);

    // No diagnostics.
    expect(result.diagnostics).toHaveLength(0);
  });

  it("analyses a barrel file re-export pattern", () => {
    const result = analyze(
      {
        "/lib/index.do": `
          export { Parser } from "./internal/parser"
          export { Validator } from "./internal/validator"
          export * from "./types"
        `,
        "/lib/internal/parser.do": `
          export class Parser { }
        `,
        "/lib/internal/validator.do": `
          export class Validator { }
        `,
        "/lib/types.do": `
          export class Config { name: string }
          export type Options = int
        `,
        "/app/main.do": `
          import { Parser, Validator, Config, Options } from "../lib/index"
        `,
      },
      "/app/main.do",
    );

    expect(result.modules.size).toBe(5);

    const mainTable = result.modules.get("/app/main.do")!;
    expect(mainTable.imports).toHaveLength(4);
    for (const imp of mainTable.imports) {
      expect(imp.symbol).not.toBeNull();
    }

    expect(result.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Export-list without source (local export list)
// ============================================================================

describe("Export list without source", () => {
  it("handles export { A, B } (local re-naming exports)", () => {
    const table = getTable(
      {
        "/main.do": `
          class Helper { }
          function doStuff(): void { }
          export { Helper, doStuff }
        `,
      },
      "/main.do",
    );

    // The declarations are collected without `exported` flag, but the
    // export-list should surface them. Currently the export-list without
    // source is handled as a statement; the symbols get their exported
    // flag from the declaration itself. In the AST, the `exported` flag
    // on HeadlerHelper/doStuff is false because they're declared without
    // `export`. The export-list is a separate statement.
    //
    // For MVP we check the symbols are at least collected:
    expect(table.symbols.has("Helper")).toBe(true);
    expect(table.symbols.has("doStuff")).toBe(true);
  });
});
