import { describe, it, expect } from "vitest";
import type { NamedType, FunctionDeclaration, ClassDeclaration } from "./ast.js";
import { analyze, collectNamedTypes } from "./analyzer-test-helpers.js";

// ============================================================================
// NamedType AST decoration tests
// ============================================================================

describe("NamedType AST decoration — resolvedSymbol", () => {
  it("decorates NamedType nodes with their resolved symbol", () => {
    const result = analyze(
      {
        "/main.do": `
          class Point { x, y: float }
          function origin(): Point => Point(0.0, 0.0)
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const program = result.modules.get("/main.do")!.program;
    // The function's return type annotation is a NamedType "Point"
    const fnDecl = program.statements[1] as FunctionDeclaration;
    expect(fnDecl.returnType).toBeDefined();
    expect(fnDecl.returnType!.kind).toBe("named-type");
    const namedType = fnDecl.returnType as NamedType;
    expect(namedType.resolvedSymbol).toBeDefined();
    expect(namedType.resolvedSymbol!.name).toBe("Point");
    expect(namedType.resolvedSymbol!.symbolKind).toBe("class");
  });

  it("decorates imported type references with their resolved symbol", () => {
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
    const fnDecl = program.statements[1] as FunctionDeclaration;
    // The parameter type annotation references imported User
    const paramType = fnDecl.params[0].type as NamedType;
    expect(paramType.resolvedSymbol).toBeDefined();
    expect(paramType.resolvedSymbol!.name).toBe("User");
    expect(paramType.resolvedSymbol!.symbolKind).toBe("class");
  });

  it("does not set resolvedSymbol for builtin types", () => {
    const result = analyze(
      { "/main.do": `function id(x: int): int => x` },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const program = result.modules.get("/main.do")!.program;
    const fnDecl = program.statements[0] as FunctionDeclaration;
    const paramType = fnDecl.params[0].type as NamedType;
    // Builtins like "int" are not resolved to a user symbol
    expect(paramType.resolvedSymbol).toBeUndefined();
  });

  it("decorates class field type references", () => {
    const result = analyze(
      {
        "/main.do": `
          class Color { r, g, b: int }
          class Pixel {
            pos: int
            color: Color
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const program = result.modules.get("/main.do")!.program;
    const pixelDecl = program.statements[1] as ClassDeclaration;
    // The "color" field has type "Color" which is a NamedType
    const colorFieldType = pixelDecl.fields[1].type as NamedType;
    expect(colorFieldType.resolvedSymbol).toBeDefined();
    expect(colorFieldType.resolvedSymbol!.name).toBe("Color");
    expect(colorFieldType.resolvedSymbol!.symbolKind).toBe("class");
  });
});

// ============================================================================
// Extern class declarations
// ============================================================================

describe("extern class declarations", () => {
  it("creates class symbol from extern class", () => {
    const result = analyze(
      {
        "/main.do": `
          import class Logger {
            log(message: string): void
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("Logger");
    expect(sym).toBeDefined();
    expect(sym!.symbolKind).toBe("class");
    if (sym?.symbolKind === "class") {
      expect(sym.extern_).toBeDefined();
      expect(sym.extern_!.headerPath).toBeNull();
      expect(sym.extern_!.cppName).toBeNull();
      expect(sym.declaration.methods).toHaveLength(1);
      expect(sym.declaration.methods[0].name).toBe("log");
    }
  });

  it("preserves static methods on extern class synthesis", () => {
    const result = analyze(
      {
        "/main.do": `
          import class MathBridge from "math_bridge.hpp" {
            static cos(x: float): float
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("MathBridge");
    expect(sym?.symbolKind).toBe("class");
    if (sym?.symbolKind === "class") {
      expect(sym.declaration.methods).toHaveLength(1);
      expect(sym.declaration.methods[0].name).toBe("cos");
      expect(sym.declaration.methods[0].static_).toBe(true);
    }
  });

  it("preserves explicit header path", () => {
    const result = analyze(
      {
        "/main.do": `
          import class HttpClient from "./vendor/http.hpp" {
            get(url: string): string
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("HttpClient");
    expect(sym?.symbolKind).toBe("class");
    if (sym?.symbolKind === "class") {
      expect(sym.extern_!.headerPath).toBe("./vendor/http.hpp");
    }
  });

  it("preserves cppName", () => {
    const result = analyze(
      {
        "/main.do": `
          import class Client from "<httplib.h>" as httplib::Client {
            get(path: string): string
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("Client");
    if (sym?.symbolKind === "class") {
      expect(sym.extern_!.cppName).toBe("httplib::Client");
    }
  });

  it("extern class is not exported", () => {
    const result = analyze(
      {
        "/main.do": `
          import class Logger {
            log(message: string): void
          }
        `,
      },
      "/main.do",
    );
    const table = result.modules.get("/main.do")!;
    expect(table.exports.has("Logger")).toBe(false);
  });

  it("exported extern class appears in exports", () => {
    const result = analyze(
      {
        "/main.do": `
          export import class Mat4 from "matrix.hpp" as ns::Mat4 {
            static multiply(a: Mat4, b: Mat4): Mat4
            projectX(x: float, y: float, z: float): float
          }
        `,
      },
      "/main.do",
    );
    const table = result.modules.get("/main.do")!;
    expect(table.exports.has("Mat4")).toBe(true);
    const sym = table.exports.get("Mat4")!;
    expect(sym.symbolKind).toBe("class");
    expect(sym.extern_?.headerPath).toBe("matrix.hpp");
    expect(sym.extern_?.cppName).toBe("ns::Mat4");
  });

  it("importing exported extern class from another module", () => {
    const result = analyze(
      {
        "/matrix.do": `
          export import class Mat4 from "matrix.hpp" {
            static multiply(a: Mat4, b: Mat4): Mat4
          }
        `,
        "/main.do": `
          import { Mat4 } from "./matrix"
          function test(a: Mat4, b: Mat4): Mat4 {
            return Mat4.multiply(a, b)
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    expect(table.imports).toHaveLength(1);
    expect(table.imports[0].localName).toBe("Mat4");
  });

  it("resolves NamedType references to extern class", () => {
    const result = analyze(
      {
        "/main.do": `
          import class Logger {
            log(message: string): void
          }
          function logMessage(l: Logger): void {
            l.log("hello")
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const program = result.modules.get("/main.do")!.program;
    // The function's Logger parameter should resolve to the extern class
    const fn = program.statements[1] as FunctionDeclaration;
    const paramType = fn.params[0].type as NamedType;
    expect(paramType.resolvedSymbol).toBeDefined();
    expect(paramType.resolvedSymbol!.name).toBe("Logger");
    expect(paramType.resolvedSymbol!.symbolKind).toBe("class");
  });

  it("synthesizes fields in class declaration", () => {
    const result = analyze(
      {
        "/main.do": `
          import class Vec3 from "./math.hpp" {
            x, y, z: float
            length(): float
          }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const sym = result.modules.get("/main.do")!.symbols.get("Vec3");
    if (sym?.symbolKind === "class") {
      expect(sym.declaration.fields).toHaveLength(1);
      expect(sym.declaration.fields[0].names).toEqual(["x", "y", "z"]);
      expect(sym.declaration.methods).toHaveLength(1);
      expect(sym.declaration.methods[0].name).toBe("length");
    }
  });
});

// ============================================================================
// Diagnostic span quality
// ============================================================================

describe("diagnostic spans", () => {
  it("module-not-found diagnostic has non-zero span from import statement", () => {
    const result = analyze(
      { "/main.do": `import { foo } from "./missing"` },
      "/main.do",
    );
    const diag = result.diagnostics.find((d) =>
      d.message.includes("Cannot resolve module") || d.message.includes("not found"),
    );
    expect(diag).toBeDefined();
    // The span should come from the import statement, not be zero
    expect(diag!.span).toBeDefined();
    expect(diag!.span.start.offset + diag!.span.end.offset).toBeGreaterThan(0);
  });

  it("parse error diagnostic has structured span from ParseError", () => {
    const result = analyze(
      { "/main.do": `fn broken( {` },
      "/main.do",
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diag = result.diagnostics.find((d) =>
      d.message.toLowerCase().includes("expected") ||
      d.message.toLowerCase().includes("parse") ||
      d.message.toLowerCase().includes("unexpected"),
    );
    expect(diag).toBeDefined();
    expect(diag!.span).toBeDefined();
  });

  it("unresolved import name diagnostic has non-zero span", () => {
    const result = analyze(
      {
        "/main.do": `import { nonexistent } from "./lib"`,
        "/lib.do": `export function something(): int => 1`,
      },
      "/main.do",
    );
    const diag = result.diagnostics.find((d) =>
      d.message.includes("does not export"),
    );
    expect(diag).toBeDefined();
    expect(diag!.span).toBeDefined();
    expect(diag!.span.start.offset + diag!.span.end.offset).toBeGreaterThan(0);
  });

  it("surfaces lexer diagnostics for unterminated string", () => {
    const result = analyze(
      { "/main.do": `const x = "hello` },
      "/main.do",
    );
    // Should have at least one diagnostic about unterminated string
    const diag = result.diagnostics.find((d) =>
      d.message.toLowerCase().includes("unterminated"),
    );
    expect(diag).toBeDefined();
  });
});

// ============================================================================
// Private access control
// ============================================================================

describe("Private access control", () => {
  it("private function is not added to exports", () => {
    const table = analyze(
      { "/main.do": `private function helper(): int => 0` },
      "/main.do",
    ).modules.get("/main.do")!;
    expect(table.symbols.has("helper")).toBe(true);
    expect(table.exports.has("helper")).toBe(false);
  });

  it("private class is not added to exports", () => {
    const table = analyze(
      { "/main.do": `private class Internal { x: int }` },
      "/main.do",
    ).modules.get("/main.do")!;
    expect(table.symbols.has("Internal")).toBe(true);
    expect(table.exports.has("Internal")).toBe(false);
  });

  it("errors when trying to import a private function", () => {
    const result = analyze(
      {
        "/lib.do": `private function helper(): int => 0`,
        "/main.do": `import { helper } from "./lib"`,
      },
      "/main.do",
    );
    expect(result.diagnostics.some(d => d.message.includes('does not export "helper"'))).toBe(true);
  });

  it("errors when trying to import a private class", () => {
    const result = analyze(
      {
        "/lib.do": `private class Internal { x: int }`,
        "/main.do": `import { Internal } from "./lib"`,
      },
      "/main.do",
    );
    expect(result.diagnostics.some(d => d.message.includes('does not export "Internal"'))).toBe(true);
  });

  it("errors when trying to re-export private local symbol via export list", () => {
    const result = analyze(
      {
        "/main.do": `
          private function helper(): int => 0
          export { helper }
        `,
      },
      "/main.do",
    );
    expect(result.diagnostics.some(d => d.message.includes('Cannot export private declaration "helper"'))).toBe(true);
  });

  it("non-private exported function is importable", () => {
    const result = analyze(
      {
        "/lib.do": `export function helper(): int => 0`,
        "/main.do": `import { helper } from "./lib"`,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Imported function declarations
// ============================================================================

describe("Analyzer — import function declarations", () => {
  it("creates function symbol from import function", () => {
    const result = analyze(
      { "/main.do": `import function cos(x: float): float from "<cmath>" as std::cos` },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("cos");
    expect(sym).toBeDefined();
    expect(sym!.symbolKind).toBe("function");
    if (sym!.symbolKind === "function") {
      expect(sym!.extern_).toBeDefined();
      expect(sym!.extern_!.headerPath).toBe("<cmath>");
      expect(sym!.extern_!.cppName).toBe("std::cos");
      expect(sym!.declaration.params).toHaveLength(1);
      expect(sym!.declaration.params[0].name).toBe("x");
    }
  });

  it("non-exported import function is not in exports", () => {
    const result = analyze(
      { "/main.do": `import function cos(x: float): float from "<cmath>"` },
      "/main.do",
    );
    const table = result.modules.get("/main.do")!;
    expect(table.symbols.has("cos")).toBe(true);
    expect(table.exports.has("cos")).toBe(false);
  });

  it("exported import function is in exports", () => {
    const result = analyze(
      { "/main.do": `export import function cos(x: float): float from "<cmath>"` },
      "/main.do",
    );
    const table = result.modules.get("/main.do")!;
    expect(table.exports.has("cos")).toBe(true);
    const sym = table.exports.get("cos")!;
    expect(sym.symbolKind).toBe("function");
    if (sym.symbolKind === "function") {
      expect(sym.extern_).toBeDefined();
    }
  });

  it("import function without header has null headerPath", () => {
    const result = analyze(
      { "/main.do": `import function myFunc(): int` },
      "/main.do",
    );
    const table = result.modules.get("/main.do")!;
    const sym = table.symbols.get("myFunc")!;
    if (sym.symbolKind === "function") {
      expect(sym.extern_!.headerPath).toBeNull();
      expect(sym.extern_!.cppName).toBeNull();
    }
  });

  it("imported import function resolves through modules", () => {
    const result = analyze(
      {
        "/math.do": `export import function sin(x: float): float from "<cmath>" as std::sin`,
        "/main.do": `import { sin } from "./math"`,
      },
      "/main.do",
    );
    expect(result.diagnostics).toHaveLength(0);
    const table = result.modules.get("/main.do")!;
    expect(table.imports).toHaveLength(1);
    expect(table.imports[0].localName).toBe("sin");
    expect(table.imports[0].symbol).toBeDefined();
    expect(table.imports[0].symbol!.symbolKind).toBe("function");
  });
});
