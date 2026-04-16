import { describe, it, expect } from "vitest";
import { parse } from "./parser.js";
import type { Program, Expression, Statement } from "./ast.js";

function parseExpr(source: string): Expression {
  // Wrap in expression statement for parsing
  const program = parse(source);
  const stmt = program.statements[0];
  if (stmt.kind === "expression-statement") return stmt.expression;
  throw new Error(`Expected expression statement, got ${stmt.kind}`);
}

function firstStmt(source: string): Statement {
  return parse(source).statements[0];
}

// ==========================================================================
// Variable Declarations
// ==========================================================================

describe("Parser — variable declarations", () => {
  it("parses const declaration", () => {
    const stmt = firstStmt('const PI = 3.14');
    expect(stmt).toMatchObject({
      kind: "const-declaration",
      name: "PI",
      exported: false,
    });
  });

  it("parses readonly declaration", () => {
    const stmt = firstStmt('readonly config = loadConfig()');
    expect(stmt).toMatchObject({
      kind: "readonly-declaration",
      name: "config",
      exported: false,
    });
  });

  it("parses let declaration", () => {
    const stmt = firstStmt("let counter = 0");
    expect(stmt).toMatchObject({
      kind: "let-declaration",
      name: "counter",
    });
  });

  it("parses immutable binding (:=)", () => {
    const stmt = firstStmt("x := 42");
    expect(stmt).toMatchObject({
      kind: "immutable-binding",
      name: "x",
      type: null,
    });
  });

  it("parses typed immutable binding", () => {
    const stmt = firstStmt("x: int := 42");
    expect(stmt).toMatchObject({
      kind: "immutable-binding",
      name: "x",
    });
    if (stmt.kind === "immutable-binding") {
      expect(stmt.type).toMatchObject({ kind: "named-type", name: "int" });
    }
  });

  it("parses let with type annotation", () => {
    const stmt = firstStmt("let x: int = 0");
    expect(stmt.kind).toBe("let-declaration");
    if (stmt.kind === "let-declaration") {
      expect(stmt.type).toMatchObject({ kind: "named-type", name: "int" });
    }
  });
});

// ==========================================================================
// Type Annotations
// ==========================================================================

describe("Parser — type annotations", () => {
  it("parses simple named type", () => {
    const stmt = firstStmt("let x: int = 0");
    if (stmt.kind === "let-declaration" && stmt.type) {
      expect(stmt.type).toMatchObject({ kind: "named-type", name: "int" });
    }
  });

  it("parses array type", () => {
    const stmt = firstStmt("let x: int[] = []");
    if (stmt.kind === "let-declaration" && stmt.type) {
      expect(stmt.type).toMatchObject({ kind: "array-type", readonly_: false });
    }
  });

  it("parses nullable type", () => {
    const stmt = firstStmt("let x: int | null = null");
    if (stmt.kind === "let-declaration" && stmt.type) {
      expect(stmt.type.kind).toBe("union-type");
    }
  });

  it("parses generic type", () => {
    const stmt = firstStmt("let x: Map<string, int> = Map()");
    if (stmt.kind === "let-declaration" && stmt.type) {
      expect(stmt.type).toMatchObject({
        kind: "named-type",
        name: "Map",
      });
      if (stmt.type.kind === "named-type") {
        expect(stmt.type.typeArgs).toHaveLength(2);
      }
    }
  });

  it("parses readonly array type", () => {
    const stmt = firstStmt("let x: readonly int[] = []");
    if (stmt.kind === "let-declaration" && stmt.type) {
      expect(stmt.type).toMatchObject({ kind: "array-type", readonly_: true });
    }
  });
});

// ==========================================================================
// Functions
// ==========================================================================

describe("Parser — function declarations", () => {
  it("parses expression-body function", () => {
    const stmt = firstStmt("function double(x: int): int => x * 2");
    expect(stmt).toMatchObject({
      kind: "function-declaration",
      name: "double",
      exported: false,
      static_: false,
    });
    if (stmt.kind === "function-declaration") {
      expect(stmt.params).toHaveLength(1);
      expect(stmt.params[0].name).toBe("x");
      expect(stmt.returnType).toMatchObject({ kind: "named-type", name: "int" });
    }
  });

  it("parses block-body function", () => {
    const stmt = firstStmt(`function factorial(n: int): int {
      if n <= 1 {
        return 1
      }
      return n * factorial(n - 1)
    }`);
    expect(stmt).toMatchObject({ kind: "function-declaration", name: "factorial" });
    if (stmt.kind === "function-declaration") {
      expect(stmt.body).toMatchObject({ kind: "block" });
    }
  });

  it("parses function with inferred return type", () => {
    const stmt = firstStmt("function double(x: int) => x * 2");
    if (stmt.kind === "function-declaration") {
      expect(stmt.returnType).toBeNull();
    }
  });

  it("parses exported function", () => {
    const stmt = firstStmt("export function add(a: int, b: int): int => a + b");
    expect(stmt.kind).toBe("export-declaration");
    if (stmt.kind === "export-declaration") {
      expect(stmt.declaration).toMatchObject({
        kind: "function-declaration",
        name: "add",
        exported: true,
      });
    }
  });

  it("parses bodiless mock function", () => {
    const stmt = firstStmt("mock function sendPayment(targetId: string): void");
    expect(stmt).toMatchObject({
      kind: "function-declaration",
      name: "sendPayment",
      mock_: true,
      bodyless: true,
    });
  });

  it("parses exported mock function", () => {
    const stmt = firstStmt("export mock function sendPayment(targetId: string): void {}");
    expect(stmt.kind).toBe("export-declaration");
    if (stmt.kind === "export-declaration") {
      expect(stmt.declaration).toMatchObject({
        kind: "function-declaration",
        name: "sendPayment",
        exported: true,
        mock_: true,
      });
    }
  });
});

// ==========================================================================
// Classes
// ==========================================================================

describe("Parser — class declarations", () => {
  it("parses simple class", () => {
    const stmt = firstStmt(`class Point {
      x, y, z: float;
    }`);
    expect(stmt).toMatchObject({ kind: "class-declaration", name: "Point" });
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields).toHaveLength(1);
      expect(stmt.fields[0].names).toEqual(["x", "y", "z"]);
    }
  });

  it("parses class with readonly and default fields", () => {
    const stmt = firstStmt(`class User {
      readonly id: int;
      name: string;
      email: string | null;
      role: string = "user";
    }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields).toHaveLength(4);
      expect(stmt.fields[0].readonly_).toBe(true);
      expect(stmt.fields[3].defaultValue).toMatchObject({ kind: "string-literal" });
    }
  });

  it("parses class with const field", () => {
    const stmt = firstStmt(`class Success {
      const kind = "Success";
      value: int;
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields[0].const_).toBe(true);
      expect(stmt.fields[0].names).toEqual(["kind"]);
    }
  });

  it("parses class with methods", () => {
    const stmt = firstStmt(`class Counter {
      count = 0;
      increment(amount: int): void {
        count += amount;
      }
      getCount(): int {
        return count;
      }
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(2);
      expect(stmt.methods[0].name).toBe("increment");
      expect(stmt.methods[1].name).toBe("getCount");
    }
  });

  it("parses class with static method", () => {
    const stmt = firstStmt(`class MathUtils {
      static max(a: int, b: int): int => if a > b then a else b;
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].static_).toBe(true);
    }
  });

  it("parses class with static field", () => {
    const stmt = firstStmt(`class Rectangle {
      static kind = "Rect";
      width: float;
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields).toHaveLength(2);
      expect(stmt.fields[0].static_).toBe(true);
      expect(stmt.fields[0].names).toEqual(["kind"]);
      expect(stmt.fields[0].defaultValue).toMatchObject({ kind: "string-literal", value: "Rect" });
    }
  });

  it("parses class implements", () => {
    const stmt = firstStmt(`class Circle implements Drawable, Positioned {
      readonly x: float;
      readonly y: float;
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.implements_.map((impl) => impl.name)).toEqual(["Drawable", "Positioned"]);
    }
  });

  it("parses class implements generic builtin stream", () => {
    const stmt = firstStmt(`class Counter implements Stream<int> { next(): int | null => null }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.implements_).toHaveLength(1);
      expect(stmt.implements_[0].name).toBe("Stream");
      expect(stmt.implements_[0].typeArgs).toHaveLength(1);
      expect(stmt.implements_[0].typeArgs[0]).toMatchObject({ kind: "named-type", name: "int" });
    }
  });

  it("parses class with destructor", () => {
    const stmt = firstStmt(`class FileHandle {
      handle: int;
      destructor {
        closeRawHandle(handle)
      }
    }`);
    if (stmt.kind === "class-declaration") {
      expect(stmt.destructor).not.toBeNull();
      expect(stmt.destructor?.kind).toBe("block");
    }
  });

  it("parses mock class with bodiless methods", () => {
    const stmt = firstStmt(`mock class PaymentGateway {
      sendPayment(targetId: string): void
      refund(targetId: string, amount: float): void {
        return
      }
    }`);
    expect(stmt).toMatchObject({ kind: "class-declaration", name: "PaymentGateway", mock_: true });
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(2);
      expect(stmt.methods[0]).toMatchObject({ name: "sendPayment", mock_: true, bodyless: true });
      expect(stmt.methods[1]).toMatchObject({ name: "refund", mock_: true, bodyless: false });
    }
  });
});

// ==========================================================================
// Interfaces
// ==========================================================================

describe("Parser — interface declarations", () => {
  it("parses interface with fields", () => {
    const stmt = firstStmt(`interface Positioned {
      readonly x: float;
      readonly y: float;
    }`);
    expect(stmt).toMatchObject({
      kind: "interface-declaration",
      name: "Positioned",
    });
    if (stmt.kind === "interface-declaration") {
      expect(stmt.fields).toHaveLength(2);
      expect(stmt.fields[0].readonly_).toBe(true);
    }
  });

  it("parses interface with methods", () => {
    const stmt = firstStmt(`interface Drawable {
      draw(canvas: Canvas): void;
    }`);
    if (stmt.kind === "interface-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("draw");
    }
  });

  it("parses interface with static method", () => {
    const stmt = firstStmt(`interface HasStatic {
      static doIt(): void;
    }`);
    if (stmt.kind === "interface-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("doIt");
      expect(stmt.methods[0].static_).toBe(true);
    }
  });
});

// ==========================================================================
// Enums
// ==========================================================================

describe("Parser — enum declarations", () => {
  it("parses simple enum", () => {
    const stmt = firstStmt("enum Color { Red, Green, Blue }");
    expect(stmt).toMatchObject({ kind: "enum-declaration", name: "Color" });
    if (stmt.kind === "enum-declaration") {
      expect(stmt.variants).toHaveLength(3);
      expect(stmt.variants.map(v => v.name)).toEqual(["Red", "Green", "Blue"]);
      expect(stmt.variants[0].value).toBeNull();
    }
  });

  it("parses enum with integer values", () => {
    const stmt = firstStmt(`enum Direction {
      North = 1,
      South = 2,
      East = 4,
      West = 8
    }`);
    if (stmt.kind === "enum-declaration") {
      expect(stmt.variants).toHaveLength(4);
      expect(stmt.variants[0].value).toMatchObject({ kind: "int-literal", value: 1 });
    }
  });

  it("parses enum with string values", () => {
    const stmt = firstStmt(`enum LogLevel {
      Debug = "DEBUG",
      Info = "INFO"
    }`);
    if (stmt.kind === "enum-declaration") {
      expect(stmt.variants[0].value).toMatchObject({ kind: "string-literal", value: "DEBUG" });
    }
  });

  it("parses exported enum", () => {
    const stmt = firstStmt("export enum Direction { North, South }");
    expect(stmt.kind).toBe("export-declaration");
  });
});

// ==========================================================================
// Type Aliases
// ==========================================================================

describe("Parser — type alias declarations", () => {
  it("parses simple type alias", () => {
    const stmt = firstStmt("type UserId = int");
    expect(stmt).toMatchObject({
      kind: "type-alias-declaration",
      name: "UserId",
      typeParams: [],
    });
  });

  it("parses generic type alias", () => {
    const stmt = firstStmt("type Result<T, E> = Success<T> | Failure<E>");
    expect(stmt).toMatchObject({
      kind: "type-alias-declaration",
      name: "Result",
    });
    if (stmt.kind === "type-alias-declaration") {
      expect(stmt.typeParams).toEqual(["T", "E"]);
      expect(stmt.type.kind).toBe("union-type");
    }
  });
});

// ==========================================================================
// Imports
// ==========================================================================

describe("Parser — imports", () => {
  it("parses mock import directives", () => {
    const stmt = firstStmt(`mock import for "./orderProcessor" {
      "./paymentGateway" => "./mocks/mockPayment"
      "./inventory" => "./mocks/mockInventory"
    }`);
    expect(stmt).toMatchObject({
      kind: "mock-import-directive",
      sourcePattern: "./orderProcessor",
    });
    if (stmt.kind === "mock-import-directive") {
      expect(stmt.mappings).toEqual([
        expect.objectContaining({ dependency: "./paymentGateway", replacement: "./mocks/mockPayment" }),
        expect.objectContaining({ dependency: "./inventory", replacement: "./mocks/mockInventory" }),
      ]);
    }
  });

  it("parses named imports", () => {
    const stmt = firstStmt('import { Vector, add } from "math"');
    expect(stmt).toMatchObject({ kind: "import-declaration", typeOnly: false });
    if (stmt.kind === "import-declaration") {
      expect(stmt.specifiers).toHaveLength(2);
      expect(stmt.specifiers[0]).toMatchObject({
        kind: "named-import-specifier",
        name: "Vector",
        alias: null,
      });
      expect(stmt.source).toBe("math");
    }
  });

  it("parses import with alias", () => {
    const stmt = firstStmt('import { Vector as Vec3 } from "math"');
    if (stmt.kind === "import-declaration") {
      expect(stmt.specifiers[0]).toMatchObject({
        kind: "named-import-specifier",
        name: "Vector",
        alias: "Vec3",
      });
    }
  });

  it("parses namespace import", () => {
    const stmt = firstStmt('import * as math from "math"');
    if (stmt.kind === "import-declaration") {
      expect(stmt.specifiers[0]).toMatchObject({
        kind: "namespace-import-specifier",
        alias: "math",
      });
    }
  });

  it("parses type-only import", () => {
    const stmt = firstStmt('import type { User } from "./types"');
    expect(stmt).toMatchObject({
      kind: "import-declaration",
      typeOnly: true,
    });
  });
});

// ==========================================================================
// Exports
// ==========================================================================

describe("Parser — exports", () => {
  it("parses export list", () => {
    const stmt = firstStmt("export { Helper, publicFunction }");
    expect(stmt).toMatchObject({ kind: "export-list" });
    if (stmt.kind === "export-list") {
      expect(stmt.specifiers).toHaveLength(2);
      expect(stmt.source).toBeNull();
    }
  });

  it("parses re-export", () => {
    const stmt = firstStmt('export { Vector } from "./math"');
    if (stmt.kind === "export-list") {
      expect(stmt.source).toBe("./math");
    }
  });

  it("parses export all", () => {
    const stmt = firstStmt('export * from "./math"');
    expect(stmt).toMatchObject({ kind: "export-all-declaration", alias: null });
  });

  it("parses export all as namespace", () => {
    const stmt = firstStmt('export * as math from "./math"');
    expect(stmt).toMatchObject({ kind: "export-all-declaration", alias: "math" });
  });

  it("parses export with rename", () => {
    const stmt = firstStmt("export { InternalVector as Vector }");
    if (stmt.kind === "export-list") {
      expect(stmt.specifiers[0]).toMatchObject({
        name: "InternalVector",
        alias: "Vector",
      });
    }
  });
});
