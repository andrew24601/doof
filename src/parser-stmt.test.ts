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
// Control Flow
// ==========================================================================

describe("Parser — control flow", () => {
  it("parses if statement", () => {
    const stmt = firstStmt(`if x > 0 {
      print("positive")
    }`);
    expect(stmt).toMatchObject({ kind: "if-statement" });
  });

  it("parses if-else statement", () => {
    const stmt = firstStmt(`if x > 0 {
      print("positive")
    } else {
      print("non-positive")
    }`);
    if (stmt.kind === "if-statement") {
      expect(stmt.else_).not.toBeNull();
    }
  });

  it("parses if-else if-else chain", () => {
    const stmt = firstStmt(`if score >= 90 {
      print("A")
    } else if score >= 80 {
      print("B")
    } else {
      print("F")
    }`);
    if (stmt.kind === "if-statement") {
      expect(stmt.elseIfs).toHaveLength(1);
      expect(stmt.else_).not.toBeNull();
    }
  });

  it("parses while loop", () => {
    const stmt = firstStmt(`while count < 10 {
      count += 1
    }`);
    expect(stmt).toMatchObject({
      kind: "while-statement",
      label: null,
    });
  });

  it("parses for-of loop", () => {
    const stmt = firstStmt(`for name of names {
      print(name)
    }`);
    expect(stmt).toMatchObject({
      kind: "for-of-statement",
      bindings: ["name"],
    });
  });

  it("parses for-of with multiple bindings", () => {
    const stmt = firstStmt(`for key, value of scores {
      print(key)
    }`);
    if (stmt.kind === "for-of-statement") {
      expect(stmt.bindings).toEqual(["key", "value"]);
    }
  });

  it("parses for-of with range", () => {
    const stmt = firstStmt(`for i of 0..<10 {
      print(i)
    }`);
    expect(stmt.kind).toBe("for-of-statement");
  });

  it("parses labeled loop", () => {
    const stmt = firstStmt(`outer: for y of items {
      break outer
    }`);
    if (stmt.kind === "for-of-statement") {
      expect(stmt.label).toBe("outer");
    }
  });

  it("parses break with label", () => {
    const program = parse(`outer: while true {
      break outer
    }`);
    const whileStmt = program.statements[0];
    if (whileStmt.kind === "while-statement") {
      const breakStmt = whileStmt.body.statements[0];
      expect(breakStmt).toMatchObject({
        kind: "break-statement",
        label: "outer",
      });
    }
  });

  it("parses continue statement", () => {
    const program = parse(`for i of items {
      continue
    }`);
    const forStmt = program.statements[0];
    if (forStmt.kind === "for-of-statement") {
      expect(forStmt.body.statements[0]).toMatchObject({
        kind: "continue-statement",
        label: null,
      });
    }
  });

  it("parses return statement", () => {
    const stmt = firstStmt("return 42");
    expect(stmt).toMatchObject({
      kind: "return-statement",
    });
    if (stmt.kind === "return-statement") {
      expect(stmt.value).toMatchObject({ kind: "int-literal", value: 42 });
    }
  });

  it("parses return without value", () => {
    // Wrap in function to give return a proper context
    const program = parse(`function f() { return }`);
    const fn = program.statements[0];
    if (fn.kind === "function-declaration" && fn.body.kind === "block") {
      expect(fn.body.statements[0]).toMatchObject({
        kind: "return-statement",
        value: null,
      });
    }
  });

  it("parses while then clause", () => {
    const stmt = firstStmt(`while count < 3 {
      count += 1
    } then {
      print("done")
    }`);
    if (stmt.kind === "while-statement") {
      expect(stmt.then_).not.toBeNull();
    }
  });

  it("parses for-of then clause", () => {
    const stmt = firstStmt(`for item of items {
      break
    } then {
      print("done")
    }`);
    if (stmt.kind === "for-of-statement") {
      expect(stmt.then_).not.toBeNull();
    }
  });

  it("parses traditional for then clause", () => {
    const stmt = firstStmt(`for let i = 0; i < 3; i += 1 {
      print(i)
    } then {
      print("done")
    }`);
    if (stmt.kind === "for-statement") {
      expect(stmt.then_).not.toBeNull();
    }
  });

  it("rejects legacy loop else clause", () => {
    expect(() => parse(`while false {
      print("nope")
    } else {
      print("done")
    }`)).toThrow("while loop follow-up clause uses 'then', not 'else'");
  });
});

// ==========================================================================
// Destructuring
// ==========================================================================

describe("Parser — destructuring", () => {
  it("parses positional destructuring with discard", () => {
    const stmt = firstStmt("(x, _, z) := point");
    expect(stmt).toMatchObject({
      kind: "positional-destructuring",
      bindings: ["x", "_", "z"],
      bindingKind: "immutable",
    });
  });

  it("parses array destructuring with :=", () => {
    const stmt = firstStmt("[x, y, z] := values");
    expect(stmt).toMatchObject({
      kind: "array-destructuring",
      bindings: ["x", "y", "z"],
      bindingKind: "immutable",
    });
  });

  it("parses let array destructuring with discard", () => {
    const stmt = firstStmt("let [head, _, tail] = values");
    expect(stmt).toMatchObject({
      kind: "array-destructuring",
      bindings: ["head", "_", "tail"],
      bindingKind: "let",
    });
  });

  it("parses positional destructuring with :=", () => {
    const stmt = firstStmt("(x, y, z) := point");
    expect(stmt).toMatchObject({
      kind: "positional-destructuring",
      bindings: ["x", "y", "z"],
      bindingKind: "immutable",
    });
  });

  it("parses named destructuring with :=", () => {
    const stmt = firstStmt("{ name, email } := user");
    expect(stmt).toMatchObject({
      kind: "named-destructuring",
      bindingKind: "immutable",
    });
    if (stmt.kind === "named-destructuring") {
      expect(stmt.bindings).toHaveLength(2);
      expect(stmt.bindings[0].name).toBe("name");
    }
  });

  it("parses named destructuring with alias", () => {
    const stmt = firstStmt("{ name as userName, email } := user");
    if (stmt.kind === "named-destructuring") {
      expect(stmt.bindings[0]).toMatchObject({ name: "name", alias: "userName" });
    }
  });

  it("parses positional destructuring assignment", () => {
    const stmt = firstStmt("(x, _, z) = point");
    expect(stmt).toMatchObject({
      kind: "positional-destructuring-assignment",
      bindings: ["x", "_", "z"],
    });
  });

  it("parses array destructuring assignment", () => {
    const stmt = firstStmt("[head, _, tail] = values");
    expect(stmt).toMatchObject({
      kind: "array-destructuring-assignment",
      bindings: ["head", "_", "tail"],
    });
  });

  it("parses named destructuring assignment with alias", () => {
    const stmt = firstStmt("{ name as userName, email } = user");
    expect(stmt).toMatchObject({ kind: "named-destructuring-assignment" });
    if (stmt.kind === "named-destructuring-assignment") {
      expect(stmt.bindings[0]).toMatchObject({ name: "name", alias: "userName" });
    }
  });
});

// ==========================================================================
// Constructor Expressions
// ==========================================================================

describe("Parser — constructor expressions", () => {
  it("parses named construction", () => {
    const expr = parseExpr('Point { x: 1.0, y: 2.0 }');
    expect(expr).toMatchObject({
      kind: "construct-expression",
      type: "Point",
      named: true,
    });
    if (expr.kind === "construct-expression") {
      expect(expr.args).toHaveLength(2);
    }
  });

  it("parses shorthand construction", () => {
    const expr = parseExpr("Person { name, age }");
    expect(expr).toMatchObject({
      kind: "construct-expression",
      type: "Person",
      named: true,
    });
  });
});

describe("Parser — array destructuring boundaries", () => {
  it("parses array literals as expression statements", () => {
    const stmt = firstStmt("[1, 2, 3]");
    expect(stmt.kind).toBe("expression-statement");
  });

  it("does not treat a line-leading array destructuring assignment as indexing on the previous line", () => {
    const program = parse(`
      values := [1, 2, 3]
      [head, _, tail] = values
    `);
    expect(program.statements).toHaveLength(2);
    expect(program.statements[1]).toMatchObject({
      kind: "array-destructuring-assignment",
      bindings: ["head", "_", "tail"],
    });
  });

  it("does not treat a line-leading positional destructuring assignment as a call on the previous line", () => {
    const program = parse(`
      pair := getPair()
      (left, right) = pair
    `);
    expect(program.statements).toHaveLength(2);
    expect(program.statements[1]).toMatchObject({
      kind: "positional-destructuring-assignment",
      bindings: ["left", "right"],
    });
  });

  it("does not treat a line-leading parenthesized expression as a call on the previous line", () => {
    const program = parse(`
      value := foo
      (bar)
    `);
    expect(program.statements).toHaveLength(2);
    expect(program.statements[1].kind).toBe("expression-statement");
  });
});

// ==========================================================================
// Dot Shorthand for Enums
// ==========================================================================

describe("Parser — dot shorthand", () => {
  it("parses .Variant", () => {
    const expr = parseExpr(".North");
    expect(expr).toMatchObject({ kind: "dot-shorthand", name: "North" });
  });
});

// ==========================================================================
// Try Operators
// ==========================================================================

describe("Parser — try operators", () => {
  it("parses try statement with immutable binding", () => {
    const stmt = firstStmt("try content := readFile(path)");
    expect(stmt).toMatchObject({
      kind: "try-statement",
    });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "immutable-binding",
        name: "content",
      });
    }
  });

  it("parses try statement with const", () => {
    const stmt = firstStmt("try const x = readFile(path)");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "const-declaration",
        name: "x",
      });
    }
  });

  it("parses try statement with readonly", () => {
    const stmt = firstStmt("try readonly x = readFile(path)");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "readonly-declaration",
        name: "x",
      });
    }
  });

  it("parses try statement with let", () => {
    const stmt = firstStmt("try let x = readFile(path)");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "let-declaration",
        name: "x",
      });
    }
  });

  it("parses try statement with assignment", () => {
    const stmt = firstStmt("try x = readFile(path)");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "expression-statement",
      });
      if (stmt.binding.kind === "expression-statement") {
        expect(stmt.binding.expression).toMatchObject({
          kind: "assignment-expression",
          operator: "=",
        });
      }
    }
  });

  it("parses try statement with positional destructuring", () => {
    const stmt = firstStmt("try (x, y) := getCoords()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "positional-destructuring",
        bindings: ["x", "y"],
        bindingKind: "immutable",
      });
    }
  });

  it("parses try statement with positional destructuring discard", () => {
    const stmt = firstStmt("try (x, _, z) := getCoords()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "positional-destructuring",
        bindings: ["x", "_", "z"],
        bindingKind: "immutable",
      });
    }
  });

  it("parses try statement with named destructuring", () => {
    const stmt = firstStmt("try {name, age} := getPerson()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "named-destructuring",
        bindingKind: "immutable",
      });
    }
  });

  it("parses try statement with array destructuring", () => {
    const stmt = firstStmt("try [a, _, c] := getItems()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "array-destructuring",
        bindings: ["a", "_", "c"],
        bindingKind: "immutable",
      });
    }
  });

  it("parses try statement with positional destructuring assignment", () => {
    const stmt = firstStmt("try (x, y) = getCoords()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "positional-destructuring-assignment",
        bindings: ["x", "y"],
      });
    }
  });

  it("parses try statement with named destructuring assignment", () => {
    const stmt = firstStmt("try {name as userName} = getPerson()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "named-destructuring-assignment",
      });
    }
  });

  it("parses try statement with array destructuring assignment", () => {
    const stmt = firstStmt("try [a, _, c] = getItems()");
    expect(stmt).toMatchObject({ kind: "try-statement" });
    if (stmt.kind === "try-statement") {
      expect(stmt.binding).toMatchObject({
        kind: "array-destructuring-assignment",
        bindings: ["a", "_", "c"],
      });
    }
  });

  it("parses try! expression", () => {
    const expr = parseExpr("try! loadConfig()");
    expect(expr).toMatchObject({
      kind: "unary-expression",
      operator: "try!",
    });
  });

  it("parses try? expression", () => {
    const expr = parseExpr("try? loadConfig()");
    expect(expr).toMatchObject({
      kind: "unary-expression",
      operator: "try?",
    });
  });
});

// ==========================================================================
// Identifier parsing
// ==========================================================================

describe("Parser — identifiers", () => {
  it("parses is as an identifier", () => {
    const expr = parseExpr("is");
    expect(expr).toMatchObject({ kind: "identifier", name: "is" });
  });
});

// ==========================================================================
// Complete Programs
// ==========================================================================

describe("Parser — complete programs", () => {
  it("parses hello world", () => {
    const program = parse(`
      function main(): void {
        print("Hello, Doof!")
      }
    `);
    expect(program.kind).toBe("program");
    expect(program.statements).toHaveLength(1);
    expect(program.statements[0]).toMatchObject({
      kind: "function-declaration",
      name: "main",
    });
  });

  it("parses a class with enum pattern matching", () => {
    const program = parse(`
      enum Direction { North, South, East, West }

      function opposite(dir: Direction): Direction => case dir {
        .North => .South,
        .South => .North,
        .East  => .West,
        .West  => .East
      }
    `);
    expect(program.statements).toHaveLength(2);
    expect(program.statements[0]).toMatchObject({ kind: "enum-declaration" });
    expect(program.statements[1]).toMatchObject({ kind: "function-declaration" });
  });

  it("parses imports and class definitions", () => {
    const program = parse(`
      import { readFile } from "io"

      class User {
        readonly id: int;
        readonly name: string;
        readonly email: string | null = null;
      }

      function main(): void {
        users := [
          User { id: 1, name: "Alice", email: "alice@example.com" },
          User { id: 2, name: "Bob" }
        ]
        print("done")
      }
    `);
    expect(program.statements).toHaveLength(3);
    expect(program.statements[0].kind).toBe("import-declaration");
    expect(program.statements[1].kind).toBe("class-declaration");
    expect(program.statements[2].kind).toBe("function-declaration");
  });

  it("parses type alias with Result type", () => {
    const program = parse(`
      class Success {
        const kind = "Success";
        value: int;
      }

      class Failure {
        const kind = "Failure";
        error: string;
      }

      type Result = Success | Failure
    `);
    expect(program.statements).toHaveLength(3);
  });

  it("parses error handling with try", () => {
    const program = parse(`
      function loadConfig(): void {
        try content := readFile("config.json")
        try parsed := parseJSON(content)
        return parsed
      }
    `);
    expect(program.statements).toHaveLength(1);
    if (program.statements[0].kind === "function-declaration") {
      const body = program.statements[0].body;
      if (body.kind === "block") {
        expect(body.statements).toHaveLength(3);
        // First statement is try-statement wrapping immutable binding
        const first = body.statements[0];
        expect(first).toMatchObject({
          kind: "try-statement",
        });
        if (first.kind === "try-statement") {
          expect(first.binding).toMatchObject({
            kind: "immutable-binding",
            name: "content",
          });
        }
      }
    }
  });
});

// ==========================================================================
// Error Handling
// ==========================================================================

describe("Parser — error handling", () => {
  it("throws ParseError on unexpected token", () => {
    expect(() => parse("let = 42")).toThrow();
  });

  it("includes line and column in error", () => {
    try {
      parse("let = 42");
    } catch (e: any) {
      expect(e.name).toBe("ParseError");
      expect(e.line).toBe(1);
    }
  });
});

// ==========================================================================
// Assignment operators
// ==========================================================================

describe("Parser — assignments", () => {
  it("parses simple assignment", () => {
    const stmt = firstStmt("x = 42");
    expect(stmt).toMatchObject({ kind: "expression-statement" });
    if (stmt.kind === "expression-statement") {
      expect(stmt.expression).toMatchObject({
        kind: "assignment-expression",
        operator: "=",
      });
    }
  });

  it("parses compound assignment", () => {
    const stmt = firstStmt("x += 1");
    if (stmt.kind === "expression-statement") {
      expect(stmt.expression).toMatchObject({
        kind: "assignment-expression",
        operator: "+=",
      });
    }
  });

  it("parses null-coalescing assignment", () => {
    const stmt = firstStmt("cache ??= loadFromDisk()");
    if (stmt.kind === "expression-statement") {
      expect(stmt.expression).toMatchObject({
        kind: "assignment-expression",
        operator: "??=",
      });
    }
  });

  it("parses yielding block assignment statement", () => {
    const stmt = firstStmt(`x <- {
      if ready {
        yield 10
      }
      yield 5
    }`);
    expect(stmt.kind).toBe("yield-block-assignment-statement");
    if (stmt.kind === "yield-block-assignment-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.value.kind).toBe("yield-block-expression");
      expect(stmt.value.body.statements).toHaveLength(2);
    }
  });

  it("rejects non-block yielding assignment rhs", () => {
    expect(() => firstStmt("x <- 42")).toThrow(/Expected block after '<-'/);
  });

  it("rejects yielding block assignment on non-identifier target", () => {
    expect(() => firstStmt("point.x <- { yield 42 }")).toThrow(/Left side of <- must be an identifier/);
  });
});

// ==========================================================================
// String Interpolation
// ==========================================================================

describe("Parser — string interpolation", () => {
  it("parses template literal with expression", () => {
    const expr = parseExpr("`Hello, ${name}!`");
    expect(expr.kind).toBe("string-literal");
    if (expr.kind === "string-literal") {
      expect(expr.parts).toHaveLength(3);
      expect(expr.parts[0]).toBe("Hello, ");
      expect(typeof expr.parts[1]).toBe("object"); // Expression
      expect(expr.parts[2]).toBe("!");
    }
  });
});

// ==========================================================================
// Source Spans
// ==========================================================================

describe("Parser — source spans", () => {
  it("attaches spans to all nodes", () => {
    const expr = parseExpr("1 + 2");
    expect(expr.span).toBeDefined();
    expect(expr.span.start.line).toBe(1);
  });

  it("attaches spans across lines", () => {
    const program = parse(`let x = 1
let y = 2`);
    expect(program.statements[0].span.start.line).toBe(1);
    expect(program.statements[1].span.start.line).toBe(2);
  });
});

// ==========================================================================
// Extern class declarations (import class)
// ==========================================================================

describe("Parser — extern class declarations", () => {
  it("parses import class with inferred header", () => {
    const stmt = firstStmt(`import class Logger {
      log(message: string): void
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.name).toBe("Logger");
      expect(stmt.headerPath).toBeNull();
      expect(stmt.cppName).toBeNull();
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("log");
      expect(stmt.methods[0].params).toHaveLength(1);
      expect(stmt.fields).toHaveLength(0);
    }
  });

  it("parses import class with explicit header", () => {
    const stmt = firstStmt(`import class HttpClient from "./vendor/http.hpp" {
      get(url: string): string
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.name).toBe("HttpClient");
      expect(stmt.headerPath).toBe("./vendor/http.hpp");
      expect(stmt.cppName).toBeNull();
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("get");
    }
  });

  it("parses import class with namespace-qualified C++ name", () => {
    const stmt = firstStmt(`import class Client from "<httplib.h>" as httplib::Client {
      get(path: string): string
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.name).toBe("Client");
      expect(stmt.headerPath).toBe("<httplib.h>");
      expect(stmt.cppName).toBe("httplib::Client");
    }
  });

  it("parses import class with fields", () => {
    const stmt = firstStmt(`import class Vec3 from "./math.hpp" {
      x, y, z: float
      length(): float
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.name).toBe("Vec3");
      expect(stmt.fields).toHaveLength(1);
      expect(stmt.fields[0].names).toEqual(["x", "y", "z"]);
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("length");
    }
  });

  it("parses import class with multiple methods", () => {
    const stmt = firstStmt(`import class Database {
      connect(url: string): bool
      query(sql: string): string
      close(): void
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.name).toBe("Database");
      expect(stmt.methods).toHaveLength(3);
      expect(stmt.methods[0].name).toBe("connect");
      expect(stmt.methods[1].name).toBe("query");
      expect(stmt.methods[2].name).toBe("close");
    }
  });

  it("parses import class with static method", () => {
    const stmt = firstStmt(`import class MathBridge from "math_bridge.hpp" {
      static cos(x: float): float
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("cos");
      expect(stmt.methods[0].static_).toBe(true);
    }
  });

  it("parses deeply nested C++ namespace", () => {
    const stmt = firstStmt(`import class Foo from "<foo.h>" as a::b::c::Foo {
      bar(): int
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.cppName).toBe("a::b::c::Foo");
    }
  });

  it("marks non-exported import class as not exported", () => {
    const stmt = firstStmt(`import class Logger {
      log(message: string): void
    }`);
    expect(stmt.kind).toBe("extern-class-declaration");
    if (stmt.kind === "extern-class-declaration") {
      expect(stmt.exported).toBe(false);
    }
  });

  it("parses export import class", () => {
    const program = parse(`export import class Mat4 from "matrix_bridge.hpp" as ns::Mat4 {
      static perspective(fovY: float, aspect: float): Mat4
      projectX(x: float, y: float, z: float): float
    }`);
    const stmt = program.statements[0];
    expect(stmt.kind).toBe("export-declaration");
    if (stmt.kind === "export-declaration") {
      expect(stmt.declaration.kind).toBe("extern-class-declaration");
      if (stmt.declaration.kind === "extern-class-declaration") {
        expect(stmt.declaration.name).toBe("Mat4");
        expect(stmt.declaration.exported).toBe(true);
        expect(stmt.declaration.headerPath).toBe("matrix_bridge.hpp");
        expect(stmt.declaration.cppName).toBe("ns::Mat4");
        expect(stmt.declaration.methods).toHaveLength(2);
        expect(stmt.declaration.methods[0].static_).toBe(true);
        expect(stmt.declaration.methods[1].static_).toBe(false);
      }
    }
  });
});

// ==========================================================================
// Imported function declarations
// ==========================================================================

describe("Parser — import function declarations", () => {
  it("parses import function with return type", () => {
    const stmt = firstStmt(`import function cos(x: float): float`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.name).toBe("cos");
      expect(stmt.headerPath).toBeNull();
      expect(stmt.cppName).toBeNull();
      expect(stmt.params).toHaveLength(1);
      expect(stmt.params[0].name).toBe("x");
      expect(stmt.exported).toBe(false);
    }
  });

  it("parses import function with header path", () => {
    const stmt = firstStmt(`import function cos(x: float): float from "<cmath>"`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.name).toBe("cos");
      expect(stmt.headerPath).toBe("<cmath>");
      expect(stmt.cppName).toBeNull();
    }
  });

  it("parses import function with cppName", () => {
    const stmt = firstStmt(`import function cos(x: float): float from "<cmath>" as std::cos`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.headerPath).toBe("<cmath>");
      expect(stmt.cppName).toBe("std::cos");
    }
  });

  it("parses import function with multiple params", () => {
    const stmt = firstStmt(`import function atan2(y: double, x: double): double from "<cmath>" as std::atan2`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.name).toBe("atan2");
      expect(stmt.params).toHaveLength(2);
      expect(stmt.params[0].name).toBe("y");
      expect(stmt.params[1].name).toBe("x");
      expect(stmt.cppName).toBe("std::atan2");
    }
  });

  it("parses exported import function", () => {
    const program = parse(`export import function sin(x: float): float from "<cmath>" as std::sin`);
    const stmt = program.statements[0];
    expect(stmt.kind).toBe("export-declaration");
    if (stmt.kind === "export-declaration") {
      expect(stmt.declaration.kind).toBe("extern-function-declaration");
      if (stmt.declaration.kind === "extern-function-declaration") {
        expect(stmt.declaration.name).toBe("sin");
        expect(stmt.declaration.exported).toBe(true);
        expect(stmt.declaration.cppName).toBe("std::sin");
      }
    }
  });

  it("parses deeply nested C++ namespace in import function", () => {
    const stmt = firstStmt(`import function myFunc(): int from "<lib.h>" as a::b::c::myFunc`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.cppName).toBe("a::b::c::myFunc");
    }
  });

  it("parses import function with no params", () => {
    const stmt = firstStmt(`import function now(): long from "<chrono>"`);
    expect(stmt.kind).toBe("extern-function-declaration");
    if (stmt.kind === "extern-function-declaration") {
      expect(stmt.name).toBe("now");
      expect(stmt.params).toHaveLength(0);
    }
  });
});

// ==========================================================================
// Concurrency
// ==========================================================================

describe("Parser — concurrency", () => {
  it("parses isolated function", () => {
    const stmt = firstStmt("isolated function sum(a: int, b: int): int => a + b");
    expect(stmt.kind).toBe("function-declaration");
    if (stmt.kind === "function-declaration") {
      expect(stmt.name).toBe("sum");
      expect(stmt.isolated_).toBe(true);
      expect(stmt.params).toHaveLength(2);
    }
  });

  it("parses non-isolated function has isolated_ false", () => {
    const stmt = firstStmt("function add(a: int, b: int): int => a + b");
    expect(stmt.kind).toBe("function-declaration");
    if (stmt.kind === "function-declaration") {
      expect(stmt.isolated_).toBe(false);
    }
  });

  it("parses export isolated function", () => {
    const stmt = firstStmt("export isolated function compute(x: int): int => x * 2");
    expect(stmt.kind).toBe("export-declaration");
    if (stmt.kind === "export-declaration") {
      const decl = stmt.declaration;
      expect(decl.kind).toBe("function-declaration");
      if (decl.kind === "function-declaration") {
        expect(decl.isolated_).toBe(true);
        expect(decl.exported).toBe(true);
        expect(decl.name).toBe("compute");
      }
    }
  });

  it("parses Actor<T>() creation", () => {
    const expr = parseExpr("Actor<Counter>()");
    expect(expr.kind).toBe("actor-creation-expression");
    if (expr.kind === "actor-creation-expression") {
      expect(expr.className).toBe("Counter");
      expect(expr.args).toHaveLength(0);
    }
  });

  it("parses Actor<T>(args) creation with arguments", () => {
    const expr = parseExpr("Actor<Worker>(42, true)");
    expect(expr.kind).toBe("actor-creation-expression");
    if (expr.kind === "actor-creation-expression") {
      expect(expr.className).toBe("Worker");
      expect(expr.args).toHaveLength(2);
    }
  });

  it("parses async function call", () => {
    const expr = parseExpr("async compute(42)");
    expect(expr.kind).toBe("async-expression");
    if (expr.kind === "async-expression") {
      expect(expr.expression.kind).toBe("call-expression");
    }
  });

  it("parses async method call", () => {
    const expr = parseExpr("async counter.increment(5)");
    expect(expr.kind).toBe("async-expression");
    if (expr.kind === "async-expression") {
      const inner = expr.expression;
      expect(inner.kind).toBe("call-expression");
    }
  });

  it("parses async block", () => {
    const expr = parseExpr("async { return 42 }");
    expect(expr.kind).toBe("async-expression");
    if (expr.kind === "async-expression") {
      expect(expr.expression.kind).toBe("block");
    }
  });

  it("parses isolated function with block body", () => {
    const stmt = firstStmt(`isolated function process(data: int): int {
      return data * 2
    }`);
    expect(stmt.kind).toBe("function-declaration");
    if (stmt.kind === "function-declaration") {
      expect(stmt.isolated_).toBe(true);
      expect(stmt.name).toBe("process");
      expect(stmt.body.kind).toBe("block");
    }
  });

  it("parses Actor creation in let binding", () => {
    const stmt = firstStmt("let counter = Actor<Counter>()");
    expect(stmt.kind).toBe("let-declaration");
    if (stmt.kind === "let-declaration") {
      expect(stmt.value.kind).toBe("actor-creation-expression");
    }
  });

  it("parses isolated short method in class", () => {
    const stmt = firstStmt(`class Worker {
      isolated process(data: int): int => data * 2
    }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("process");
      expect(stmt.methods[0].isolated_).toBe(true);
    }
  });

  it("parses isolated function method in class", () => {
    const stmt = firstStmt(`class Worker {
      isolated function compute(x: int): int {
        return x + 1
      }
    }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].name).toBe("compute");
      expect(stmt.methods[0].isolated_).toBe(true);
    }
  });

  it("parses non-isolated method in class has isolated_ false", () => {
    const stmt = firstStmt(`class Counter {
      value: int
      increment(): void { }
    }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].isolated_).toBe(false);
    }
  });
});

// ==========================================================================
// Semicolons
// ==========================================================================

describe("Parser — semicolons", () => {
  it("parses const declaration with optional trailing semicolon", () => {
    const withSemi = firstStmt(`const X = 42;`);
    const withoutSemi = firstStmt(`const X = 42`);
    expect(withSemi.kind).toBe("const-declaration");
    expect(withoutSemi.kind).toBe("const-declaration");
  });

  it("parses let declaration with optional trailing semicolon", () => {
    const withSemi = firstStmt(`let x = 10;`);
    const withoutSemi = firstStmt(`let x = 10`);
    expect(withSemi.kind).toBe("let-declaration");
    expect(withoutSemi.kind).toBe("let-declaration");
  });

  it("parses readonly declaration with optional trailing semicolon", () => {
    const withSemi = firstStmt(`readonly x = 10;`);
    const withoutSemi = firstStmt(`readonly x = 10`);
    expect(withSemi.kind).toBe("readonly-declaration");
    expect(withoutSemi.kind).toBe("readonly-declaration");
  });

  it("parses <- block declarations with optional trailing semicolon", () => {
    const constStmt = firstStmt(`const x <- { yield 10 };`);
    const letStmt = firstStmt(`let x <- { yield 10 }`);
    const readonlyStmt = firstStmt(`readonly x <- { yield 10 };`);

    expect(constStmt.kind).toBe("const-declaration");
    expect(letStmt.kind).toBe("let-declaration");
    expect(readonlyStmt.kind).toBe("readonly-declaration");

    for (const stmt of [constStmt, letStmt, readonlyStmt]) {
      if (
        stmt.kind === "const-declaration"
        || stmt.kind === "let-declaration"
        || stmt.kind === "readonly-declaration"
      ) {
        expect(stmt.value.kind).toBe("yield-block-expression");
      }
    }
  });

  it("parses immutable binding with optional trailing semicolon", () => {
    const withSemi = firstStmt(`x := 10;`);
    const withoutSemi = firstStmt(`x := 10`);
    expect(withSemi.kind).toBe("immutable-binding");
    expect(withoutSemi.kind).toBe("immutable-binding");
  });

  it("keeps := block rhs invalid", () => {
    expect(() => firstStmt(`x := { yield 10 }`)).toThrow();
  });

  it("parses expression statement with optional trailing semicolon", () => {
    const withSemi = firstStmt(`print("hello");`);
    const withoutSemi = firstStmt(`print("hello")`);
    expect(withSemi.kind).toBe("expression-statement");
    expect(withoutSemi.kind).toBe("expression-statement");
  });

  it("parses return statement with optional trailing semicolon", () => {
    const withSemi = firstStmt(`return 42;`);
    const withoutSemi = firstStmt(`return 42`);
    expect(withSemi.kind).toBe("return-statement");
    expect(withoutSemi.kind).toBe("return-statement");
  });

  it("parses import declaration with optional trailing semicolon", () => {
    const withSemi = firstStmt(`import { Foo } from "./foo";`);
    const withoutSemi = firstStmt(`import { Foo } from "./foo"`);
    expect(withSemi.kind).toBe("import-declaration");
    expect(withoutSemi.kind).toBe("import-declaration");
  });

  it("parses break/continue with optional trailing semicolon", () => {
    const breakSemi = firstStmt(`for i of items { break; }`);
    const breakNoSemi = firstStmt(`for i of items { break }`);
    expect(breakSemi.kind).toBe("for-of-statement");
    expect(breakNoSemi.kind).toBe("for-of-statement");
  });

  it("parses type alias with optional trailing semicolon", () => {
    const withSemi = firstStmt(`type Id = int;`);
    const withoutSemi = firstStmt(`type Id = int`);
    expect(withSemi.kind).toBe("type-alias-declaration");
    expect(withoutSemi.kind).toBe("type-alias-declaration");
  });

  it("parses multiple statements on one line separated by semicolons", () => {
    const program = parse(`let x = 1; let y = 2; let z = 3`);
    expect(program.statements).toHaveLength(3);
    expect(program.statements[0].kind).toBe("let-declaration");
    expect(program.statements[1].kind).toBe("let-declaration");
    expect(program.statements[2].kind).toBe("let-declaration");
  });

  it("parses class fields with optional trailing semicolons", () => {
    const withSemi = firstStmt(`class Foo { x: int; y: string; }`);
    const withoutSemi = firstStmt(`class Foo { x: int\n  y: string }`);
    expect(withSemi.kind).toBe("class-declaration");
    expect(withoutSemi.kind).toBe("class-declaration");
    if (withSemi.kind === "class-declaration" && withoutSemi.kind === "class-declaration") {
      expect(withSemi.fields).toHaveLength(2);
      expect(withoutSemi.fields).toHaveLength(2);
    }
  });
});

// ==========================================================================
// Traditional for-loop
// ==========================================================================

describe("Parser — traditional for-loop", () => {
  it("parses traditional for with let init", () => {
    const stmt = firstStmt(`for let i = 0; i < 10; i += 1 {
      print(i)
    }`);
    expect(stmt.kind).toBe("for-statement");
    if (stmt.kind === "for-statement") {
      expect(stmt.init).not.toBeNull();
      expect(stmt.init!.kind).toBe("let-declaration");
      expect(stmt.condition).not.toBeNull();
      expect(stmt.update).toHaveLength(1);
    }
  });

  it("parses traditional for with expression init", () => {
    const stmt = firstStmt(`for i = 0; i < 10; i += 1 {
      print(i)
    }`);
    expect(stmt.kind).toBe("for-statement");
    if (stmt.kind === "for-statement") {
      expect(stmt.init).not.toBeNull();
      expect(stmt.init!.kind).toBe("expression-statement");
    }
  });

  it("parses traditional for with empty init", () => {
    const stmt = firstStmt(`for ; i < 10; i += 1 {
      print(i)
    }`);
    expect(stmt.kind).toBe("for-statement");
    if (stmt.kind === "for-statement") {
      expect(stmt.init).toBeNull();
      expect(stmt.condition).not.toBeNull();
    }
  });

  it("parses traditional for with empty condition", () => {
    const stmt = firstStmt(`for let i = 0; ; i += 1 {
      print(i)
    }`);
    expect(stmt.kind).toBe("for-statement");
    if (stmt.kind === "for-statement") {
      expect(stmt.init).not.toBeNull();
      expect(stmt.condition).toBeNull();
    }
  });

  it("requires semicolons as separators in traditional for", () => {
    // Missing first semicolon should fail
    expect(() => parse(`for let i = 0 i < 10; i += 1 { }`)).toThrow();
  });

  it("parses labeled traditional for-loop", () => {
    const stmt = firstStmt(`outer: for let i = 0; i < 10; i += 1 {
      break outer
    }`);
    expect(stmt.kind).toBe("for-statement");
    if (stmt.kind === "for-statement") {
      expect(stmt.label).toBe("outer");
    }
  });
});

// ==========================================================================
// Catch expression
// ==========================================================================

describe("Parser — catch expression", () => {
  it("parses basic catch expression", () => {
    const expr = parseExpr(`catch { try a() }`);
    expect(expr.kind).toBe("catch-expression");
    if (expr.kind === "catch-expression") {
      expect(expr.body).toHaveLength(1);
      expect(expr.body[0].kind).toBe("try-statement");
    }
  });

  it("parses catch expression with multiple try statements", () => {
    const expr = parseExpr(`catch { try a(); try b() }`);
    expect(expr.kind).toBe("catch-expression");
    if (expr.kind === "catch-expression") {
      expect(expr.body).toHaveLength(2);
      expect(expr.body[0].kind).toBe("try-statement");
      expect(expr.body[1].kind).toBe("try-statement");
    }
  });

  it("parses catch expression with mixed statements", () => {
    const expr = parseExpr(`catch { const x = 1; try a(); println(x) }`);
    expect(expr.kind).toBe("catch-expression");
    if (expr.kind === "catch-expression") {
      expect(expr.body).toHaveLength(3);
      expect(expr.body[0].kind).toBe("const-declaration");
      expect(expr.body[1].kind).toBe("try-statement");
      expect(expr.body[2].kind).toBe("expression-statement");
    }
  });

  it("parses catch expression as binding RHS", () => {
    const stmt = firstStmt(`const err = catch { try a() }`);
    expect(stmt.kind).toBe("const-declaration");
    if (stmt.kind === "const-declaration") {
      expect(stmt.value.kind).toBe("catch-expression");
    }
  });

  it("parses catch expression as case subject", () => {
    const stmt = firstStmt(`const value = case catch { try a() } { _ => 0 }`);
    expect(stmt.kind).toBe("const-declaration");
    if (stmt.kind === "const-declaration") {
      expect(stmt.value.kind).toBe("case-expression");
      if (stmt.value.kind === "case-expression") {
        expect(stmt.value.subject.kind).toBe("catch-expression");
      }
    }
  });

  it("parses nested catch expressions", () => {
    const stmt = firstStmt(`const outer = catch { const inner = catch { try a() }; try b() }`);
    expect(stmt.kind).toBe("const-declaration");
    if (stmt.kind === "const-declaration") {
      expect(stmt.value.kind).toBe("catch-expression");
      if (stmt.value.kind === "catch-expression") {
        expect(stmt.value.body).toHaveLength(2);
        const innerDecl = stmt.value.body[0];
        expect(innerDecl.kind).toBe("const-declaration");
        if (innerDecl.kind === "const-declaration") {
          expect(innerDecl.value.kind).toBe("catch-expression");
        }
      }
    }
  });
});

// ==========================================================================
// Private access control
// ==========================================================================

describe("Parser — private access control", () => {
  it("parses private class field", () => {
    const stmt = firstStmt(`class Foo { private secret: int }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields).toHaveLength(1);
      expect(stmt.fields[0].private_).toBe(true);
      expect(stmt.fields[0].names).toEqual(["secret"]);
    }
  });

  it("parses private readonly class field", () => {
    const stmt = firstStmt(`class Foo { private readonly id: int }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields).toHaveLength(1);
      expect(stmt.fields[0].private_).toBe(true);
      expect(stmt.fields[0].readonly_).toBe(true);
    }
  });

  it("parses non-private class field as private_ false", () => {
    const stmt = firstStmt(`class Foo { name: string }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.fields[0].private_).toBe(false);
    }
  });

  it("parses private class method", () => {
    const stmt = firstStmt(`class Foo { private function secret(): int { return 0 } }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].private_).toBe(true);
      expect(stmt.methods[0].name).toBe("secret");
    }
  });

  it("parses private static method", () => {
    const stmt = firstStmt(`class Foo { private static function helper(): void {} }`);
    expect(stmt.kind).toBe("class-declaration");
    if (stmt.kind === "class-declaration") {
      expect(stmt.methods).toHaveLength(1);
      expect(stmt.methods[0].private_).toBe(true);
      expect(stmt.methods[0].static_).toBe(true);
    }
  });

  it("parses private top-level function", () => {
    const stmt = firstStmt(`private function helper(): void {}`);
    expect(stmt).toMatchObject({
      kind: "function-declaration",
      name: "helper",
      private_: true,
      exported: false,
    });
  });

  it("parses private class declaration", () => {
    const stmt = firstStmt(`private class Internal { x: int }`);
    expect(stmt).toMatchObject({
      kind: "class-declaration",
      name: "Internal",
      private_: true,
      exported: false,
    });
  });

  it("throws on export private", () => {
    expect(() => parse(`export private function foo() {}`)).toThrow(
      "Cannot export a private declaration"
    );
  });

  it("throws on private interface member", () => {
    expect(() => parse(`interface Foo { private x: int }`)).toThrow(
      '"private" is not allowed on interface members'
    );
  });
});

// ==========================================================================
// With statement
// ==========================================================================

describe("Parser — with statement", () => {
  it("parses single binding", () => {
    const stmt = firstStmt(`with x := 42 { print(x) }`);
    expect(stmt.kind).toBe("with-statement");
    if (stmt.kind === "with-statement") {
      expect(stmt.bindings).toHaveLength(1);
      expect(stmt.bindings[0].name).toBe("x");
      expect(stmt.bindings[0].type).toBeNull();
      expect(stmt.bindings[0].value.kind).toBe("int-literal");
      expect(stmt.body.statements).toHaveLength(1);
    }
  });

  it("parses multiple bindings", () => {
    const stmt = firstStmt(`with x := 1, y := 2 { print(x + y) }`);
    expect(stmt.kind).toBe("with-statement");
    if (stmt.kind === "with-statement") {
      expect(stmt.bindings).toHaveLength(2);
      expect(stmt.bindings[0].name).toBe("x");
      expect(stmt.bindings[1].name).toBe("y");
    }
  });

  it("parses typed binding", () => {
    const stmt = firstStmt(`with x: int := 42 { print(x) }`);
    expect(stmt.kind).toBe("with-statement");
    if (stmt.kind === "with-statement") {
      expect(stmt.bindings).toHaveLength(1);
      expect(stmt.bindings[0].name).toBe("x");
      expect(stmt.bindings[0].type).not.toBeNull();
      expect(stmt.bindings[0].type!.kind).toBe("named-type");
    }
  });

  it("parses binding with call expression", () => {
    const stmt = firstStmt(`with result := getValue() { use(result) }`);
    expect(stmt.kind).toBe("with-statement");
    if (stmt.kind === "with-statement") {
      expect(stmt.bindings[0].name).toBe("result");
      expect(stmt.bindings[0].value.kind).toBe("call-expression");
    }
  });

  it("parses nested with statements", () => {
    const stmt = firstStmt(`with x := 1 {
      with y := 2 {
        print(x + y)
      }
    }`);
    expect(stmt.kind).toBe("with-statement");
    if (stmt.kind === "with-statement") {
      expect(stmt.bindings[0].name).toBe("x");
      const inner = stmt.body.statements[0];
      expect(inner.kind).toBe("with-statement");
      if (inner.kind === "with-statement") {
        expect(inner.bindings[0].name).toBe("y");
      }
    }
  });

  it("throws on missing := operator", () => {
    expect(() => parse(`with x = 42 { }`)).toThrow();
  });

  it("throws on missing block body", () => {
    expect(() => parse(`with x := 42`)).toThrow();
  });
});

// ==========================================================================
// Description metadata
// ==========================================================================

describe("Parser — description metadata", () => {
  it("parses class with description", () => {
    const stmt = firstStmt(`class Foo "A foo class." { x: int }`) as any;
    expect(stmt.kind).toBe("class-declaration");
    expect(stmt.name).toBe("Foo");
    expect(stmt.description).toBe("A foo class.");
  });

  it("parses class without description", () => {
    const stmt = firstStmt(`class Foo { x: int }`) as any;
    expect(stmt.kind).toBe("class-declaration");
    expect(stmt.description).toBeUndefined();
  });

  it("parses class with description and implements", () => {
    const stmt = firstStmt(`class Foo "Implements Bar." implements Bar { x: int }`) as any;
    expect(stmt.kind).toBe("class-declaration");
    expect(stmt.description).toBe("Implements Bar.");
    expect(stmt.implements_.map((impl: { name: string }) => impl.name)).toEqual(["Bar"]);
  });

  it("parses class field with description", () => {
    const stmt = firstStmt(`class Foo { name "The name.": string }`) as any;
    expect(stmt.fields[0].names).toEqual(["name"]);
    expect(stmt.fields[0].descriptions).toEqual(["The name."]);
  });

  it("parses multi-name field with per-name descriptions", () => {
    const stmt = firstStmt(`class Vec { x "x-axis", y "y-axis", z "z-axis": float }`) as any;
    expect(stmt.fields[0].names).toEqual(["x", "y", "z"]);
    expect(stmt.fields[0].descriptions).toEqual(["x-axis", "y-axis", "z-axis"]);
  });

  it("parses multi-name field with some descriptions", () => {
    const stmt = firstStmt(`class Vec { x "x-axis", y, z "z-axis": float }`) as any;
    expect(stmt.fields[0].names).toEqual(["x", "y", "z"]);
    expect(stmt.fields[0].descriptions).toEqual(["x-axis", undefined, "z-axis"]);
  });

  it("parses multi-name field without any descriptions", () => {
    const stmt = firstStmt(`class Vec { x, y, z: float }`) as any;
    expect(stmt.fields[0].names).toEqual(["x", "y", "z"]);
    expect(stmt.fields[0].descriptions).toEqual([undefined, undefined, undefined]);
  });

  it("parses function with description", () => {
    const stmt = firstStmt(`function greet "Greets the user."(name: string): string { return "hi" }`) as any;
    expect(stmt.kind).toBe("function-declaration");
    expect(stmt.name).toBe("greet");
    expect(stmt.description).toBe("Greets the user.");
  });

  it("parses function without description", () => {
    const stmt = firstStmt(`function greet(name: string): string { return "hi" }`) as any;
    expect(stmt.description).toBeUndefined();
  });

  it("parses parameter with description", () => {
    const stmt = firstStmt(`function greet(name "The name.": string): string { return "hi" }`) as any;
    expect(stmt.params[0].name).toBe("name");
    expect(stmt.params[0].description).toBe("The name.");
  });

  it("parses parameter without description", () => {
    const stmt = firstStmt(`function greet(name: string): string { return "hi" }`) as any;
    expect(stmt.params[0].description).toBeUndefined();
  });

  it("parses short method with description", () => {
    const stmt = firstStmt(`class Foo { greet "Says hi."(name: string): string { return "hi" } }`) as any;
    expect(stmt.methods[0].name).toBe("greet");
    expect(stmt.methods[0].description).toBe("Says hi.");
  });

  it("parses interface with description", () => {
    const stmt = firstStmt(`interface Animal "Represents an animal." { name: string }`) as any;
    expect(stmt.kind).toBe("interface-declaration");
    expect(stmt.name).toBe("Animal");
    expect(stmt.description).toBe("Represents an animal.");
  });

  it("parses interface field with description", () => {
    const stmt = firstStmt(`interface Animal { name "The animal name.": string }`) as any;
    expect(stmt.fields[0].name).toBe("name");
    expect(stmt.fields[0].description).toBe("The animal name.");
  });

  it("parses interface method with description", () => {
    const stmt = firstStmt(`interface Animal { speak "Makes a sound."(volume: int): string }`) as any;
    expect(stmt.methods[0].name).toBe("speak");
    expect(stmt.methods[0].description).toBe("Makes a sound.");
  });

  it("parses enum with description", () => {
    const stmt = firstStmt(`enum Color "Available colors." { Red, Green, Blue }`) as any;
    expect(stmt.kind).toBe("enum-declaration");
    expect(stmt.name).toBe("Color");
    expect(stmt.description).toBe("Available colors.");
  });

  it("parses enum variant with description", () => {
    const stmt = firstStmt(`enum Color { Red "Primary red.", Green, Blue "Primary blue." }`) as any;
    expect(stmt.variants[0].name).toBe("Red");
    expect(stmt.variants[0].description).toBe("Primary red.");
    expect(stmt.variants[1].description).toBeUndefined();
    expect(stmt.variants[2].name).toBe("Blue");
    expect(stmt.variants[2].description).toBe("Primary blue.");
  });

  it("parses type alias with description", () => {
    const stmt = firstStmt(`type ID "A unique identifier." = string`) as any;
    expect(stmt.kind).toBe("type-alias-declaration");
    expect(stmt.name).toBe("ID");
    expect(stmt.description).toBe("A unique identifier.");
  });

  it("parses const with description", () => {
    const stmt = firstStmt(`const MAX "Maximum value." = 100`) as any;
    expect(stmt.kind).toBe("const-declaration");
    expect(stmt.name).toBe("MAX");
    expect(stmt.description).toBe("Maximum value.");
  });

  it("parses readonly with description", () => {
    const stmt = firstStmt(`readonly config "Configuration object." = 42`) as any;
    expect(stmt.kind).toBe("readonly-declaration");
    expect(stmt.name).toBe("config");
    expect(stmt.description).toBe("Configuration object.");
  });

  it("parses the full DevAssistant example", () => {
    const stmt = firstStmt(`
      class DevAssistant "AI assistant for development workflows." {
        createProject "Creates a new project scaffold."(
          name "The name of the project.": string
        ): string { return name }

        rootPath "Path to the project root.": string
      }
    `) as any;
    expect(stmt.kind).toBe("class-declaration");
    expect(stmt.name).toBe("DevAssistant");
    expect(stmt.description).toBe("AI assistant for development workflows.");

    expect(stmt.methods[0].name).toBe("createProject");
    expect(stmt.methods[0].description).toBe("Creates a new project scaffold.");
    expect(stmt.methods[0].params[0].name).toBe("name");
    expect(stmt.methods[0].params[0].description).toBe("The name of the project.");

    expect(stmt.fields[0].names).toEqual(["rootPath"]);
    expect(stmt.fields[0].descriptions).toEqual(["Path to the project root."]);
  });
});

// ============================================================================
// Map literal syntax
// ============================================================================

describe("Parser — map literal with dot-shorthand keys", () => {
  it("parses dot-shorthand map literal", () => {
    const stmt = firstStmt(`m := { .Red: 1, .Green: 2, .Blue: 3 }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(3);
        expect(expr.entries[0].key.kind).toBe("dot-shorthand");
        if (expr.entries[0].key.kind === "dot-shorthand") {
          expect(expr.entries[0].key.name).toBe("Red");
        }
        expect(expr.entries[1].key.kind).toBe("dot-shorthand");
        expect(expr.entries[2].key.kind).toBe("dot-shorthand");
      }
    }
  });

  it("parses explicit enum-access map literal", () => {
    const stmt = firstStmt(`m := { Color.Red: 1, Color.Blue: 2 }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(2);
        expect(expr.entries[0].key.kind).toBe("member-expression");
        expect(expr.entries[1].key.kind).toBe("member-expression");
      }
    }
  });

  it("parses dot-shorthand map with object literal values", () => {
    const stmt = firstStmt(`m := { .Clubs: {}, .Spades: {} }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(2);
        expect(expr.entries[0].key.kind).toBe("dot-shorthand");
        expect(expr.entries[0].value.kind).toBe("object-literal");
        expect(expr.entries[1].key.kind).toBe("dot-shorthand");
        expect(expr.entries[1].value.kind).toBe("object-literal");
      }
    }
  });
});

describe("Parser — map literal with bare literal keys", () => {
  it("parses integer-keyed map literal", () => {
    const stmt = firstStmt(`m := { 1: "one", 2: "two", 3: "three" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(3);
        expect(expr.entries[0].key.kind).toBe("int-literal");
        expect(expr.entries[1].key.kind).toBe("int-literal");
        expect(expr.entries[2].key.kind).toBe("int-literal");
      }
    }
  });

  it("parses bool-keyed map literal", () => {
    const stmt = firstStmt(`m := { true: "yes", false: "no" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(2);
        expect(expr.entries[0].key.kind).toBe("bool-literal");
        expect(expr.entries[1].key.kind).toBe("bool-literal");
      }
    }
  });

  it("parses long-keyed map literal", () => {
    const stmt = firstStmt(`m := { 1L: "one", 2L: "two" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(2);
        expect(expr.entries[0].key.kind).toBe("long-literal");
        expect(expr.entries[1].key.kind).toBe("long-literal");
      }
    }
  });

  it("parses float-keyed map literal", () => {
    const stmt = firstStmt(`m := { 1.5f: "one point five" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(1);
        expect(expr.entries[0].key.kind).toBe("float-literal");
      }
    }
  });

  it("parses double-keyed map literal", () => {
    const stmt = firstStmt(`m := { 1.5: "one point five" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(1);
        expect(expr.entries[0].key.kind).toBe("double-literal");
      }
    }
  });

  it("parses single-entry bare key map", () => {
    const stmt = firstStmt(`m := { 42: "answer" }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(1);
        expect(expr.entries[0].key.kind).toBe("int-literal");
        if (expr.entries[0].key.kind === "int-literal") {
          expect(expr.entries[0].key.value).toBe(42);
        }
        expect(expr.entries[0].value.kind).toBe("string-literal");
      }
    }
  });

  it("parses mixed quoted and bare identifier string keys", () => {
    const stmt = firstStmt(`m := { "name": "Bob", age: 23, favouriteColours: ["red", "green"] }`);
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("map-literal");
      if (expr.kind === "map-literal") {
        expect(expr.entries).toHaveLength(3);
        expect(expr.entries[0].key.kind).toBe("string-literal");
        expect(expr.entries[1].key.kind).toBe("string-literal");
        expect(expr.entries[2].key.kind).toBe("string-literal");
      }
    }
  });
});

// ==========================================================================
// Case Statement Forms
// ==========================================================================

describe("Parser — case statement forms", () => {
  it("rejects removed case-narrow syntax", () => {
    expect(() => parse(`case x := getValue() { null => { return } }`)).toThrow();
  });

  it("parses standalone case as a statement", () => {
    const stmt = firstStmt(`case direction {
      .North => "up"
      .South => "down"
    }`);
    expect(stmt.kind).toBe("case-statement");
    if (stmt.kind === "case-statement") {
      expect(stmt.subject.kind).toBe("identifier");
      expect(stmt.arms).toHaveLength(2);
      expect(stmt.arms[0].body.kind).toBe("string-literal");
    }
  });

  it("parses statement case arms with blocks and grouped patterns", () => {
    const stmt = firstStmt(`case request.kind {
      "initialized-notification" | "notification" => { continue }
      _ => { return }
    }`);
    expect(stmt.kind).toBe("case-statement");
    if (stmt.kind === "case-statement") {
      expect(stmt.arms).toHaveLength(2);
      expect(stmt.arms[0].patterns).toHaveLength(2);
      expect(stmt.arms[0].body.kind).toBe("block");
      expect(stmt.arms[1].body.kind).toBe("block");
    }
  });

  it("parses bare return arms in statement-level case", () => {
    const stmt = firstStmt(`case x {
      0..10 => return 0
      _ => return 4
    }`);
    expect(stmt.kind).toBe("case-statement");
    if (stmt.kind === "case-statement") {
      expect(stmt.arms).toHaveLength(2);
      expect(stmt.arms[0].body.kind).toBe("block");
      expect(stmt.arms[1].body.kind).toBe("block");

      if (stmt.arms[0].body.kind === "block") {
        expect(stmt.arms[0].body.statements).toHaveLength(1);
        expect(stmt.arms[0].body.statements[0].kind).toBe("return-statement");
      }
      if (stmt.arms[1].body.kind === "block") {
        expect(stmt.arms[1].body.statements).toHaveLength(1);
        expect(stmt.arms[1].body.statements[0].kind).toBe("return-statement");
      }
    }
  });

  it("parses bare return/break/continue/try arms in statement-level case", () => {
    const stmt = firstStmt(`case x {
      0 => return 0
      1 => break
      2 => continue
      _ => try value := read()
    }`);
    expect(stmt.kind).toBe("case-statement");
    if (stmt.kind === "case-statement") {
      expect(stmt.arms).toHaveLength(4);
      expect(stmt.arms[0].body.kind).toBe("block");
      expect(stmt.arms[1].body.kind).toBe("block");
      expect(stmt.arms[2].body.kind).toBe("block");
      expect(stmt.arms[3].body.kind).toBe("block");

      if (stmt.arms[0].body.kind === "block") {
        expect(stmt.arms[0].body.statements[0]?.kind).toBe("return-statement");
      }
      if (stmt.arms[1].body.kind === "block") {
        expect(stmt.arms[1].body.statements[0]?.kind).toBe("break-statement");
      }
      if (stmt.arms[2].body.kind === "block") {
        expect(stmt.arms[2].body.statements[0]?.kind).toBe("continue-statement");
      }
      if (stmt.arms[3].body.kind === "block") {
        expect(stmt.arms[3].body.statements[0]?.kind).toBe("try-statement");
      }
    }
  });

  it("rejects commas between statement case arms", () => {
    expect(() => firstStmt(`case direction { .North => "up", .South => "down" }`)).toThrow();
  });
});

// ==========================================================================
// Else Narrow Statement
// ==========================================================================

describe("Parser — else narrow statement", () => {
  it("parses basic else-narrow", () => {
    const stmt = firstStmt(`x := getValue() else { return }`);
    expect(stmt.kind).toBe("else-narrow-statement");
    if (stmt.kind === "else-narrow-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.subject.kind).toBe("call-expression");
      expect(stmt.elseBlock.kind).toBe("block");
      expect(stmt.type).toBeNull();
    }
  });

  it("parses typed else-narrow", () => {
    const stmt = firstStmt(`x: string := getValue() else { return }`);
    expect(stmt.kind).toBe("else-narrow-statement");
    if (stmt.kind === "else-narrow-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.type).not.toBeNull();
      expect(stmt.type!.kind).toBe("named-type");
      expect(stmt.subject.kind).toBe("call-expression");
      expect(stmt.elseBlock.kind).toBe("block");
    }
  });

  it("parses else-narrow with multi-statement block", () => {
    const stmt = firstStmt(`x := getValue() else {
      log("error")
      return 0
    }`);
    expect(stmt.kind).toBe("else-narrow-statement");
    if (stmt.kind === "else-narrow-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.elseBlock.statements.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("parses else-narrow with simple identifier subject", () => {
    const stmt = firstStmt(`x := maybeValue else { return }`);
    expect(stmt.kind).toBe("else-narrow-statement");
    if (stmt.kind === "else-narrow-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.subject.kind).toBe("identifier");
    }
  });
});

// ==========================================================================
// As expression in statement contexts
// ==========================================================================

describe("Parser — as expression in statements", () => {
  it("parses try with as expression", () => {
    const stmt = firstStmt(`try x := value as string`);
    expect(stmt.kind).toBe("try-statement");
    if (stmt.kind === "try-statement") {
      expect(stmt.binding.kind).toBe("immutable-binding");
      if (stmt.binding.kind === "immutable-binding") {
        expect(stmt.binding.value.kind).toBe("as-expression");
      }
    }
  });

  it("parses else-narrow with as expression subject", () => {
    const stmt = firstStmt(`x := value as string else { return }`);
    expect(stmt.kind).toBe("else-narrow-statement");
    if (stmt.kind === "else-narrow-statement") {
      expect(stmt.name).toBe("x");
      expect(stmt.subject.kind).toBe("as-expression");
    }
  });

  it("parses try! with as expression", () => {
    const expr = parseExpr("try! value as string");
    expect(expr.kind).toBe("unary-expression");
    if (expr.kind === "unary-expression") {
      expect(expr.operator).toBe("try!");
      expect(expr.operand.kind).toBe("as-expression");
    }
  });

  it("parses try? with as expression", () => {
    const expr = parseExpr("try? value as string");
    expect(expr.kind).toBe("unary-expression");
    if (expr.kind === "unary-expression") {
      expect(expr.operator).toBe("try?");
      expect(expr.operand.kind).toBe("as-expression");
    }
  });
});
