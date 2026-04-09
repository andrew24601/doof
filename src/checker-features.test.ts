import { describe, it, expect } from "vitest";
import type {
  FunctionDeclaration, ConstDeclaration,
} from "./ast.js";
import {
  typeToString,
  isAssignableTo,
  typesEqual,
  type ResolvedType,
  ANY_TYPE,
  JSON_VALUE_TYPE,
  INT_TYPE,
  LONG_TYPE,
  FLOAT_TYPE,
  DOUBLE_TYPE,
  STRING_TYPE,
  BOOL_TYPE,
  NULL_TYPE,
  VOID_TYPE,
} from "./checker-types.js";
import { collectExprs, check, findId, findTypes } from "./checker-test-helpers.js";

// ============================================================================
// Namespace imports
// ============================================================================

describe("checker — namespace imports", () => {
  it("resolves namespace import identifier as namespace type", () => {
    const { diagnostics } = check(
      {
        "/main.do": `
          import * as math from "./math"
          const result = math.add(1, 2)
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("resolves namespace member access to correct type", () => {
    const { program, diagnostics } = check(
      {
        "/main.do": `
          import * as math from "./math"
          const result = math.add(1, 2)
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(diagnostics).toHaveLength(0);
    // result should have type int
    const constDecl = program.statements[1] as ConstDeclaration;
    expect(constDecl.resolvedType).toBeDefined();
    expect(typeToString(constDecl.resolvedType!)).toBe("int");
  });

  it("resolves namespace class access", () => {
    // Note: using namespace-qualified types in annotations (geo.Point)
    // requires parser support for dotted type paths — not yet implemented.
    // This test verifies namespace access in expressions.
    const { diagnostics } = check(
      {
        "/main.do": `
          import * as geo from "./geo"
          const PI = geo.PI
        `,
        "/geo.do": `
          export const PI: double = 3.14159
        `,
      },
      "/main.do",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("rejects using a namespace import as a value", () => {
    const { diagnostics } = check(
      {
        "/main.do": `
          import * as math from "./math"
          const alias = math
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Namespace import \"math\" cannot be used as a value");
  });

  it("rejects missing namespace members directly", () => {
    const { diagnostics } = check(
      {
        "/main.do": `
          import * as math from "./math"
          const result = math.subtract
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("has no exported member \"subtract\""))).toBe(true);
  });
});

// ============================================================================
// Concurrency
// ============================================================================

describe("Concurrency", () => {
  it("infers Actor type from Actor<T> creation", () => {
    const cr = check(
      {
        "/main.do": `
          class Counter { count: int }
          const a = Actor<Counter>(0)
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const actors = findTypes(cr, (t) => t.kind === "actor");
    expect(actors.length).toBeGreaterThanOrEqual(1);
    const actor = actors[0] as { kind: "actor"; innerClass: { kind: "class"; symbol: { name: string } } };
    expect(actor.innerClass.symbol.name).toBe("Counter");
  });

  it("infers Promise type from async expression", () => {
    const cr = check(
      {
        "/main.do": `
          function compute(): int { return 42 }
          const p = async compute()
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const promises = findTypes(cr, (t) => t.kind === "promise");
    expect(promises.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves Actor<T> type annotation", () => {
    const cr = check(
      {
        "/main.do": `
          class Worker { value: int }
          function start(): Actor<Worker> {
            return Actor<Worker>(0)
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("resolves Promise<T> type annotation", () => {
    const cr = check(
      {
        "/main.do": `
          function compute(): int { return 42 }
          function fetchData(): Promise<int> {
            return async compute()
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("infers async block as Promise type", () => {
    const cr = check(
      {
        "/main.do": `
          const p = async { 42 }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const promises = findTypes(cr, (t) => t.kind === "promise");
    expect(promises.length).toBeGreaterThanOrEqual(1);
  });

  it("allows isolated function declaration", () => {
    const cr = check(
      {
        "/main.do": `
          isolated function compute(x: int): int {
            return x * 2
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });
});

describe("checker — for-of ranges", () => {
  it("infers loop bindings from range expressions", () => {
    const { program, diagnostics } = check(
      {
        "/main.do": `
          function sum(): int {
            let total = 0
            for i of 0..<4 {
              total = total + i
            }
            return total
          }
        `,
      },
      "/main.do",
    );

    expect(diagnostics).toHaveLength(0);

    const fn = program.statements[0] as FunctionDeclaration;
    const forStmt = fn.body.kind === "block"
      ? fn.body.statements[1]
      : null;
    expect(forStmt?.kind).toBe("for-of-statement");
    if (forStmt?.kind === "for-of-statement") {
      expect(typeToString(forStmt.iterable.resolvedType!)).toBe("int");
      const ids = collectExprs(program)
        .filter((expr): expr is import("./ast.js").Identifier => expr.kind === "identifier" && expr.name === "i");
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(typeToString(id.resolvedType!)).toBe("int");
      }
    }
  });
});

// ============================================================================
// Result<T, E> type integration
// ============================================================================

describe("Result<T, E> type integration", () => {
  it("resolves Result<int, string> annotation to result type", () => {
    const cr = check(
      { "/main.do": `function f(x: int): Result<int, string> { return x }` },
      "/main.do",
    );
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    expect(fnDecl.resolvedType).toBeDefined();
    expect(fnDecl.resolvedType!.kind).toBe("function");
    if (fnDecl.resolvedType!.kind === "function") {
      expect(fnDecl.resolvedType!.returnType.kind).toBe("result");
      if (fnDecl.resolvedType!.returnType.kind === "result") {
        expect(fnDecl.resolvedType!.returnType.successType).toEqual(INT_TYPE);
        expect(fnDecl.resolvedType!.returnType.errorType).toEqual(STRING_TYPE);
      }
    }
  });

  it("resolves Result<void, string> annotation to result type", () => {
    const cr = check(
      { "/main.do": `function f(): Result<void, string> { return Success() }` },
      "/main.do",
    );
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    expect(fnDecl.resolvedType).toBeDefined();
    expect(fnDecl.resolvedType!.kind).toBe("function");
    if (fnDecl.resolvedType!.kind === "function") {
      expect(fnDecl.resolvedType!.returnType.kind).toBe("result");
      if (fnDecl.resolvedType!.returnType.kind === "result") {
        expect(fnDecl.resolvedType!.returnType.successType).toEqual(VOID_TYPE);
        expect(fnDecl.resolvedType!.returnType.errorType).toEqual(STRING_TYPE);
      }
    }
  });

  it("resolves Result with class error type", () => {
    const cr = check(
      {
        "/main.do": `
          class MyError { message: string }
          function f(): Result<int, MyError> { return 0 }
        `,
      },
      "/main.do",
    );
    const fnDecl = cr.program.statements[1] as FunctionDeclaration;
    expect(fnDecl.resolvedType).toBeDefined();
    if (fnDecl.resolvedType!.kind === "function") {
      const ret = fnDecl.resolvedType!.returnType;
      expect(ret.kind).toBe("result");
      if (ret.kind === "result") {
        expect(ret.successType).toEqual(INT_TYPE);
        expect(ret.errorType.kind).toBe("class");
      }
    }
  });

  it("infers try unwraps Result<T, E> to T", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return 0 }
          function f(): Result<int, string> {
            try x := getVal()
            return x
          }
        `,
      },
      "/main.do",
    );
    // The try statement should retype the binding to int, not Result<int, string>
    const fnDecl = cr.program.statements[1] as FunctionDeclaration;
    const body = fnDecl.body;
    if (body.kind === "block") {
      const tryStmt = body.statements[0];
      expect(tryStmt.kind).toBe("try-statement");
      if (tryStmt.kind === "try-statement" && tryStmt.binding.kind === "immutable-binding") {
        expect(tryStmt.binding.resolvedType).toBeDefined();
        expect(tryStmt.binding.resolvedType!.kind).toBe("primitive");
        expect((tryStmt.binding.resolvedType! as any).name).toBe("int");
      }
    }
  });

  it("infers try! unwraps Result<T, E> to T", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return 0 }
          function f(): void {
            x := try! getVal()
          }
        `,
      },
      "/main.do",
    );
    const exprs = collectExprs(cr.program);
    const tryExpr = exprs.find(e => e.kind === "unary-expression" && (e as any).operator === "try!");
    expect(tryExpr).toBeDefined();
    expect(tryExpr!.resolvedType!.kind).toBe("primitive");
    expect((tryExpr!.resolvedType! as any).name).toBe("int");
  });

  it("infers try? converts Result<T, E> to T | null", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return 0 }
          function f(): void {
            x := try? getVal()
          }
        `,
      },
      "/main.do",
    );
    const exprs = collectExprs(cr.program);
    const tryExpr = exprs.find(e => e.kind === "unary-expression" && (e as any).operator === "try?");
    expect(tryExpr).toBeDefined();
    expect(tryExpr!.resolvedType!.kind).toBe("union");
    if (tryExpr!.resolvedType!.kind === "union") {
      const types = tryExpr!.resolvedType!.types;
      expect(types).toHaveLength(2);
      expect(types[0]).toEqual(INT_TYPE);
      expect(types[1]).toEqual(NULL_TYPE);
    }
  });

  it("reports error when try is applied to non-Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): int { return 42 }
          function f(): Result<int, string> {
            try x := getVal()
            return x
          }
        `,
      },
      "/main.do",
    );
    const tryDiag = cr.diagnostics.find(d => d.message.includes("can only be applied to a Result type"));
    expect(tryDiag).toBeDefined();
  });

  it("reports error when try! is applied to non-Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): int { return 42 }
          function f(): void {
            x := try! getVal()
          }
        `,
      },
      "/main.do",
    );
    const tryDiag = cr.diagnostics.find(d => d.message.includes("can only be applied to a Result type"));
    expect(tryDiag).toBeDefined();
  });

  it("reports error when try is used in non-Result-returning function", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return 0 }
          function f(): int {
            try x := getVal()
            return x
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics.length).toBeGreaterThanOrEqual(1);
    const tryDiag = cr.diagnostics.find(d => d.message.includes("function that returns Result"));
    expect(tryDiag).toBeDefined();
  });

  it("allows try in a Result-returning function without diagnostics", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> => 0
          function f(): Result<int, string> {
            try x := getVal()
            return x
          }
        `,
      },
      "/main.do",
    );
    // Filter out diagnostics about type mismatches from the literal 0 return
    const tryDiags = cr.diagnostics.filter(d => d.message.includes("try") || d.message.includes("Result"));
    // There should be no try-specific errors
    expect(tryDiags.filter(d => d.message.includes("can only") || d.message.includes("enclosing function"))).toHaveLength(0);
  });

  it("allows try! in any function without enclosing-return-type error", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> => 0
          function f(): void {
            x := try! getVal()
          }
        `,
      },
      "/main.do",
    );
    // Filter out diagnostics about type mismatches from the literal 0 return in getVal
    const tryDiags = cr.diagnostics.filter(d => d.message.includes("can only") || d.message.includes("enclosing function"));
    expect(tryDiags).toHaveLength(0);
  });

  it("typeToString formats Result type correctly", () => {
    const resultType = { kind: "result" as const, successType: INT_TYPE, errorType: STRING_TYPE };
    expect(typeToString(resultType)).toBe("Result<int, string>");
  });

  it("typesEqual checks Result types", () => {
    const a = { kind: "result" as const, successType: INT_TYPE, errorType: STRING_TYPE };
    const b = { kind: "result" as const, successType: INT_TYPE, errorType: STRING_TYPE };
    const c = { kind: "result" as const, successType: FLOAT_TYPE, errorType: STRING_TYPE };
    expect(typesEqual(a, b)).toBe(true);
    expect(typesEqual(a, c)).toBe(false);
  });

  it("isAssignableTo handles Result compatibility", () => {
    const a = { kind: "result" as const, successType: INT_TYPE, errorType: STRING_TYPE };
    const b = { kind: "result" as const, successType: INT_TYPE, errorType: STRING_TYPE };
    expect(isAssignableTo(a, b)).toBe(true);
    // int→long widening in success type
    const c = { kind: "result" as const, successType: LONG_TYPE, errorType: STRING_TYPE };
    expect(isAssignableTo(a, c)).toBe(true);
  });

  it("Promise.get() infers Result<T, string> return type", () => {
    const cr = check(
      {
        "/main.do": `
          isolated function square(x: int): int { return x * x }
          function f(): void {
            const p = async square(7)
            const r = try! p.get()
          }
        `,
      },
      "/main.do",
    );
    // try! should work because p.get() returns Result<int, string>
    expect(cr.diagnostics).toHaveLength(0);
    // r should be int (unwrapped from Result)
    const exprs = collectExprs(cr.program);
    const tryExpr = exprs.find(e => e.kind === "unary-expression" && (e as any).operator === "try!");
    expect(tryExpr).toBeDefined();
    expect(tryExpr!.resolvedType!.kind).toBe("primitive");
    expect((tryExpr!.resolvedType! as any).name).toBe("int");
  });

  it("infers Success { value: expr } as Result<T, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Success { value: 42 }
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    const body = fnDecl.body;
    if (body.kind === "block") {
      const ret = body.statements[0];
      if (ret.kind === "return-statement" && ret.value) {
        expect(ret.value.resolvedType).toBeDefined();
        expect(ret.value.resolvedType!.kind).toBe("result");
        if (ret.value.resolvedType!.kind === "result") {
          expect(ret.value.resolvedType!.successType).toEqual(INT_TYPE);
          expect(ret.value.resolvedType!.errorType).toEqual(STRING_TYPE);
        }
      }
    }
  });

  it("infers Failure { error: expr } as Result<T, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Failure { error: "something went wrong" }
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    const body = fnDecl.body;
    if (body.kind === "block") {
      const ret = body.statements[0];
      if (ret.kind === "return-statement" && ret.value) {
        expect(ret.value.resolvedType).toBeDefined();
        expect(ret.value.resolvedType!.kind).toBe("result");
        if (ret.value.resolvedType!.kind === "result") {
          expect(ret.value.resolvedType!.successType).toEqual(INT_TYPE);
          expect(ret.value.resolvedType!.errorType).toEqual(STRING_TYPE);
        }
      }
    }
  });

  it("reports error when Success is missing value field", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Success { notvalue: 42 }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes('Success requires a "value" field'));
    expect(diag).toBeDefined();
  });

  it("reports error when Failure is missing error field", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Failure { noterror: "bad" }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes('Failure requires an "error" field'));
    expect(diag).toBeDefined();
  });

  it("infers positional Success(value) as Result<T, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Success(42)
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    const body = fnDecl.body;
    if (body.kind === "block") {
      const ret = body.statements[0];
      if (ret.kind === "return-statement" && ret.value) {
        expect(ret.value.resolvedType).toBeDefined();
        expect(ret.value.resolvedType!.kind).toBe("result");
        if (ret.value.resolvedType!.kind === "result") {
          expect(ret.value.resolvedType!.successType).toEqual(INT_TYPE);
          expect(ret.value.resolvedType!.errorType).toEqual(STRING_TYPE);
        }
      }
    }
  });

  it("allows positional Success() with annotated Result<void, string> binding", () => {
    const cr = check(
      {
        "/main.do": `
          const value: Result<void, string> = Success()
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows named Success {} with annotated Result<void, string> binding", () => {
    const cr = check(
      {
        "/main.do": `
          const value: Result<void, string> = Success {}
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("reports error when Success() is used for non-void Result", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Success()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Success() requires exactly 1 argument"));
    expect(diag).toBeDefined();
  });

  it("reports error when Success(value) is used for Result<void, string>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<void, string> {
            return Success(1)
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("must not take an argument"));
    expect(diag).toBeDefined();
  });

  it("allows bare try statement on Result<void, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function step(): Result<void, string> { return Success() }
          function f(): Result<int, string> {
            try step()
            return Success(1)
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("reports error when try binds a Result<void, E> success value", () => {
    const cr = check(
      {
        "/main.do": `
          function step(): Result<void, string> { return Success() }
          function f(): Result<int, string> {
            try x := step()
            return Success(1)
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("cannot bind a value"));
    expect(diag).toBeDefined();
  });

  it("reports error when accessing value on Result<void, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(r: Result<void, string>): void {
            r.value
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes('Property "value" is not available on type "Result<void, E>"'));
    expect(diag).toBeDefined();
  });

  it("reports error when try? is applied to Result<void, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(r: Result<void, string>): void {
            try? r
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes('"try?" is not supported on Result<void, E>'));
    expect(diag).toBeDefined();
  });

  it("infers positional Failure(error) as Result<T, E>", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Failure("something went wrong")
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
    const fnDecl = cr.program.statements[0] as FunctionDeclaration;
    const body = fnDecl.body;
    if (body.kind === "block") {
      const ret = body.statements[0];
      if (ret.kind === "return-statement" && ret.value) {
        expect(ret.value.resolvedType).toBeDefined();
        expect(ret.value.resolvedType!.kind).toBe("result");
        if (ret.value.resolvedType!.kind === "result") {
          expect(ret.value.resolvedType!.successType).toEqual(INT_TYPE);
          expect(ret.value.resolvedType!.errorType).toEqual(STRING_TYPE);
        }
      }
    }
  });

  it("allows positional Success(value) with annotated Result binding", () => {
    const cr = check(
      {
        "/main.do": `
          const value: Result<int, string> = Success(42)
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows positional Failure(error) with annotated Result binding", () => {
    const cr = check(
      {
        "/main.do": `
          const value: Result<int, string> = Failure("bad")
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("errors on positional Success(value) without contextual Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function f() => Success(42)
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Success requires contextual Result type"));
    expect(diag).toBeDefined();
  });

  it("errors on positional Failure(error) without contextual Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function f() => Failure("bad")
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Failure requires contextual Result type"));
    expect(diag).toBeDefined();
  });

  it("errors on Success construct without contextual Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function f() => Success { value: 42 }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Success requires contextual Result type"));
    expect(diag).toBeDefined();
  });

  it("errors on Failure construct without contextual Result type", () => {
    const cr = check(
      {
        "/main.do": `
          function f() => Failure { error: "bad" }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Failure requires contextual Result type"));
    expect(diag).toBeDefined();
  });

  it("reports error for positional Success with wrong arg count", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> {
            return Success(1, 2)
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Success() requires exactly 1 argument"));
    expect(diag).toBeDefined();
  });

  it("binds Success/Failure variants in case expression on Result", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success { value: 42 } }
          function f(): int {
            const r = getVal()
            return case r {
              s: Success => s.value,
              f: Failure => 0
            }
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("infers s.value type inside Success arm of case on Result", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success { value: 42 } }
          function f(): int {
            const r = getVal()
            return case r {
              s: Success => s.value,
              _: Failure => -1
            }
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("binds primitive union type patterns in case expressions", () => {
    const cr = check(
      {
        "/main.do": `
          type SqliteValue = int | bool | string
          function describe(value: SqliteValue): string {
            return case value {
              text: string => text,
              flag: bool => if flag then "true" else "false",
              count: int => string(count)
            }
          }
        `,
      },
      "/main.do",
    );

    const textRefs = findId(cr, "text");
    const flagRefs = findId(cr, "flag");
    const countRefs = findId(cr, "count");

    expect(textRefs.some((ref) => typeToString(ref.type) === "string")).toBe(true);
    expect(flagRefs.some((ref) => typeToString(ref.type) === "bool")).toBe(true);
    expect(countRefs.some((ref) => typeToString(ref.type) === "int")).toBe(true);
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("binds primitive capture patterns on non-union case subjects", () => {
    const cr = check(
      {
        "/main.do": `
          function describe(status: int): string {
            return case status {
              200 => "ok",
              other: int => string(other)
            }
          }
        `,
      },
      "/main.do",
    );

    const otherRefs = findId(cr, "other");
    expect(otherRefs.some((ref) => typeToString(ref.type) === "int")).toBe(true);
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("typeToString formats Success/Failure wrapper types", () => {
    const successWrapper = { kind: "success-wrapper" as const, valueType: INT_TYPE };
    expect(typeToString(successWrapper)).toBe("Success<int>");
    const failureWrapper = { kind: "failure-wrapper" as const, errorType: STRING_TYPE };
    expect(typeToString(failureWrapper)).toBe("Failure<string>");
  });

  // ---------------------------------------------------------------------------
  // Unused Result<T, E> value diagnostics (must-use)
  // ---------------------------------------------------------------------------

  it("reports error when Result-returning function call is used as bare expression statement", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): void {
            getVal()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeDefined();
  });

  it("no error when Result is captured in a variable", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): void {
            const r = getVal()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is unwrapped with try", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): Result<int, string> {
            try x := getVal()
            return x
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is unwrapped with try!", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): void {
            x := try! getVal()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is unwrapped with try?", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): void {
            x := try? getVal()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is used as argument to another function", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function consume(r: Result<int, string>): void { }
          function f(): void {
            consume(getVal())
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is returned directly", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): Result<int, string> {
            return getVal()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when Result is used in case expression", () => {
    const cr = check(
      {
        "/main.do": `
          function getVal(): Result<int, string> { return Success(42) }
          function f(): int {
            const r = getVal()
            return case r {
              s: Success => s.value,
              _: Failure => -1
            }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("reports error when Result-returning method call is used as bare statement", () => {
    const cr = check(
      {
        "/main.do": `
          class Repo {
            function save(): Result<int, string> { return Success(1) }
          }
          function f(): void {
            const r = Repo {}
            r.save()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeDefined();
  });

  it("no error when void-returning function call is used as bare statement", () => {
    const cr = check(
      {
        "/main.do": `
          function doStuff(): void { }
          function f(): void {
            doStuff()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  it("no error when non-Result-returning function call is used as bare statement", () => {
    const cr = check(
      {
        "/main.do": `
          function getInt(): int { return 42 }
          function f(): void {
            getInt()
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(d => d.message.includes("Result value must be used"));
    expect(diag).toBeUndefined();
  });

  // ==========================================================================
  // return inside case-expression arms (IIFE escape bug)
  // ==========================================================================

  it("reports error for return inside case-expression Result arm", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> { return Success { value: 1 } }
          function main(): int {
            const x = case f() {
              s: Success => s.value,
              f: Failure => { return 1 }
            }
            return x
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("return") && d.message.includes("case-expression"),
    );
    expect(diag).toBeDefined();
  });

  it("reports error for return inside case-expression value arm", () => {
    const cr = check(
      {
        "/main.do": `
          function main(): int {
            let n = 2
            const x = case n {
              1 => "one",
              _ => { return -1 }
            }
            return 0
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("return") && d.message.includes("case-expression"),
    );
    expect(diag).toBeDefined();
  });

  it("reports error for bare return inside case-expression arm", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> { return Success { value: 1 } }
          function main(): void {
            const x = case f() {
              s: Success => s.value,
              f: Failure => { return }
            }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("return") && d.message.includes("case-expression"),
    );
    expect(diag).toBeDefined();
  });

  it("allows return after a case-expression", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> { return Success { value: 42 } }
          function main(): int {
            const x = case f() {
              s: Success => s.value,
              _: Failure => 0
            }
            return x
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("case-expression"),
    );
    expect(diag).toBeUndefined();
  });

  it("allows return inside a lambda inside a case-expression arm", () => {
    const cr = check(
      {
        "/main.do": `
          function f(): Result<int, string> { return Success { value: 42 } }
          function main(): int {
            const x = case f() {
              s: Success => {
                const fn = (): int => { return s.value }
                yield fn()
              },
              _: Failure => 0
            }
            return x
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("return") && d.message.includes("case-expression"),
    );
    expect(diag).toBeUndefined();
  });

  it("reports error for try inside case-expression arm", () => {
    const cr = check(
      {
        "/main.do": `
          function g(): Result<int, string> { return Success { value: 1 } }
          function f(): Result<int, string> {
            const x = case g() {
              s: Success => {
                try const y = g()
                yield s.value + y
              },
              _: Failure => 0
            }
            return Success { value: x }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("try") && d.message.includes("case-expression"),
    );
    expect(diag).toBeDefined();
  });

  it("allows return inside statement-level case arms", () => {
    const cr = check(
      {
        "/main.do": `
          function main(): int {
            case 1 {
              1 => { return 7 }
              _ => { return 0 }
            }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("return") && d.message.includes("case-expression"),
    );
    expect(diag).toBeUndefined();
  });

  it("allows try inside statement-level case arms", () => {
    const cr = check(
      {
        "/main.do": `
          function read(): Result<int, string> { return Success { value: 42 } }
          function main(): Result<int, string> {
            case 1 {
              1 => {
                try value := read()
                return Success { value }
              }
              _ => { return Success { value: 0 } }
            }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("try") && d.message.includes("case-expression"),
    );
    expect(diag).toBeUndefined();
  });

  it("allows continue and break inside statement-level case arms", () => {
    const cr = check(
      {
        "/main.do": `
          function main(): int {
            let i = 0
            while true {
              case i {
                0 => {
                  i = i + 1
                  continue
                }
                _ => { break }
              }
            }
            return i
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows yield inside block case-expression arms", () => {
    const cr = check(
      {
        "/main.do": `
          function describe(n: int): string {
            return case n {
              0 => {
                yield "zero"
              },
              _ => {
                if n < 0 {
                  yield "negative"
                }
                yield "positive"
              }
            }
          }
        `,
      },
      "/main.do",
    );
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("reports error for yield outside case-expression arms", () => {
    const cr = check(
      {
        "/main.do": `
          function main(): int {
            yield 1
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find((d) => d.message.includes("yield") && d.message.includes("case-expression"));
    expect(diag).toBeDefined();
  });

  it("reports error when a block case-expression arm does not yield on every path", () => {
    const cr = check(
      {
        "/main.do": `
          function describe(n: int): string {
            return case n {
              0 => {
                println("zero")
              },
              _ => "other"
            }
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find((d) => d.message.includes("must yield a value on every path"));
    expect(diag).toBeDefined();
  });

  it("accepts else-narrow blocks that exit via statement-level case", () => {
    const cr = check(
      {
        "/main.do": `
          function maybeValue(): int | null { return null }
          function main(): int {
            value := maybeValue() else {
              case 0 {
                _ => { return 1 }
              }
            }
            return value
          }
        `,
      },
      "/main.do",
    );
    const diag = cr.diagnostics.find(
      (d) => d.message.includes("Else-narrow block must exit scope"),
    );
    expect(diag).toBeUndefined();
  });

  // ==========================================================================
  // Catch expression
  // ==========================================================================

  describe("catch expression", () => {
    it("infers catch with single error type as E | null", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            function readFile(): Result<string, IOError> {
              return Success { value: "hello" }
            }
            function main(): void {
              const err = catch {
                try x := readFile()
              }
            }
          `,
        },
        "/main.do",
      );
      expect(cr.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
      const fnDecl = cr.program.statements[2] as FunctionDeclaration;
      const body = fnDecl.body;
      if (body.kind === "block") {
        const constDecl = body.statements[0];
        expect(constDecl.kind).toBe("const-declaration");
        if (constDecl.kind === "const-declaration") {
          const t = constDecl.resolvedType;
          expect(t).toBeDefined();
          expect(t!.kind).toBe("union");
          if (t!.kind === "union") {
            expect(t!.types).toHaveLength(2);
            expect(t!.types[0].kind).toBe("class");
            expect(t!.types[1].kind).toBe("null");
          }
        }
      }
    });

    it("infers catch with multiple error types as E1 | E2 | null", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            class ParseError { message: string }
            function readFile(): Result<string, IOError> {
              return Success { value: "data" }
            }
            function parse(s: string): Result<int, ParseError> {
              return Success { value: 42 }
            }
            function main(): void {
              const err = catch {
                try content := readFile()
                try parsed := parse(content)
              }
            }
          `,
        },
        "/main.do",
      );
      expect(cr.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
      const fnDecl = cr.program.statements[4] as FunctionDeclaration;
      const body = fnDecl.body;
      if (body.kind === "block") {
        const constDecl = body.statements[0];
        expect(constDecl.kind).toBe("const-declaration");
        if (constDecl.kind === "const-declaration") {
          const t = constDecl.resolvedType;
          expect(t).toBeDefined();
          expect(t!.kind).toBe("union");
          if (t!.kind === "union") {
            expect(t!.types).toHaveLength(3);
            expect(t!.types[0].kind).toBe("class");
            expect(t!.types[1].kind).toBe("class");
            expect(t!.types[2].kind).toBe("null");
          }
        }
      }
    });

    it("deduplicates error types in catch", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            function a(): Result<string, IOError> {
              return Success { value: "a" }
            }
            function b(): Result<string, IOError> {
              return Success { value: "b" }
            }
            function main(): void {
              const err = catch {
                try x := a()
                try y := b()
              }
            }
          `,
        },
        "/main.do",
      );
      expect(cr.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
      const fnDecl = cr.program.statements[3] as FunctionDeclaration;
      const body = fnDecl.body;
      if (body.kind === "block") {
        const constDecl = body.statements[0];
        if (constDecl.kind === "const-declaration") {
          const t = constDecl.resolvedType;
          expect(t!.kind).toBe("union");
          if (t!.kind === "union") {
            // Should be IOError | null (deduplicated), not IOError | IOError | null
            expect(t!.types).toHaveLength(2);
          }
        }
      }
    });

    it("warns on catch with no try statements", () => {
      const cr = check(
        {
          "/main.do": `
            function main(): void {
              const err = catch {
                const x = 1
              }
            }
          `,
        },
        "/main.do",
      );
      const warning = cr.diagnostics.find(
        (d) => d.severity === "warning" && d.message.includes("no 'try' statements"),
      );
      expect(warning).toBeDefined();
    });

    it("allows try inside catch without requiring function to return Result", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            function readFile(): Result<string, IOError> {
              return Success { value: "hello" }
            }
            function main(): void {
              const err = catch {
                try content := readFile()
              }
            }
          `,
        },
        "/main.do",
      );
      // No error about "try can only be used in a function that returns Result"
      const errors = cr.diagnostics.filter(d => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("retypes try bindings inside catch to success type", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            function readFile(): Result<string, IOError> {
              return Success { value: "hello" }
            }
            function main(): void {
              const err = catch {
                try content := readFile()
                println(content)
              }
            }
          `,
        },
        "/main.do",
      );
      expect(cr.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
      const fnDecl = cr.program.statements[2] as FunctionDeclaration;
      const body = fnDecl.body;
      if (body.kind === "block") {
        const constDecl = body.statements[0];
        if (constDecl.kind === "const-declaration" && constDecl.value.kind === "catch-expression") {
          const catchBody = constDecl.value.body;
          const tryStmt = catchBody[0];
          if (tryStmt.kind === "try-statement" && tryStmt.binding.kind === "immutable-binding") {
            // Should be retyped to string, not Result<string, IOError>
            expect(tryStmt.binding.resolvedType?.kind).toBe("primitive");
            expect((tryStmt.binding.resolvedType as any)?.name).toBe("string");
          }
        }
      }
    });

    it("supports nested catch expressions with independent error capture", () => {
      const cr = check(
        {
          "/main.do": `
            class IOError { message: string }
            class ParseError { message: string }
            function readFile(): Result<string, IOError> {
              return Success { value: "data" }
            }
            function parse(s: string): Result<int, ParseError> {
              return Success { value: 42 }
            }
            function main(): void {
              const outer = catch {
                const inner = catch {
                  try content := readFile()
                }
                try parsed := parse("test")
              }
            }
          `,
        },
        "/main.do",
      );
      expect(cr.diagnostics.filter(d => d.severity === "error")).toHaveLength(0);
      const fnDecl = cr.program.statements[4] as FunctionDeclaration;
      const body = fnDecl.body;
      if (body.kind === "block") {
        const outerDecl = body.statements[0];
        if (outerDecl.kind === "const-declaration") {
          // outer captures ParseError only (inner captures IOError)
          const t = outerDecl.resolvedType;
          expect(t!.kind).toBe("union");
          if (t!.kind === "union") {
            expect(t!.types).toHaveLength(2);
            expect(t!.types[1].kind).toBe("null");
          }
        }
      }
    });
  });
});

// ============================================================================
// Private access control
// ============================================================================

describe("Private access control", () => {
  it("allows same-file access to private field", () => {
    const info = check({
      "/main.do": `
        class Foo {
          private secret: int
          function getSecret(): int { return secret }
        }
        const f = Foo { secret: 42 }
        const s = f.secret
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on cross-file access to private field", () => {
    const info = check({
      "/lib.do": `
        export class Foo {
          private secret: int
          name: string
        }
      `,
      "/main.do": `
        import { Foo } from "./lib"
        const f = Foo { secret: 42, name: "hi" }
        const s = f.secret
      `,
    }, "/main.do");
    expect(info.diagnostics.some(d => d.message.includes('"secret" is private'))).toBe(true);
  });

  it("errors on cross-file access to private method", () => {
    const info = check({
      "/lib.do": `
        export class Foo {
          name: string
          private function internal(): int { return 0 }
        }
      `,
      "/main.do": `
        import { Foo } from "./lib"
        const f = Foo { name: "hi" }
        const x = f.internal()
      `,
    }, "/main.do");
    expect(info.diagnostics.some(d => d.message.includes('"internal" is private'))).toBe(true);
  });

  it("allows same-file access to private method", () => {
    const info = check({
      "/main.do": `
        class Foo {
          x: int
          private function internal(): int { return x }
          function pub(): int { return this.internal() }
        }
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on cross-file construction with private fields lacking defaults", () => {
    const info = check({
      "/lib.do": `
        export class Foo {
          private secret: int
          name: string
        }
      `,
      "/main.do": `
        import { Foo } from "./lib"
        const f = Foo { secret: 42, name: "hi" }
      `,
    }, "/main.do");
    expect(info.diagnostics.some(d => d.message.includes("cannot be constructed from outside"))).toBe(true);
  });

  it("allows cross-file construction when private fields have defaults", () => {
    const info = check({
      "/lib.do": `
        export class Foo {
          private secret: int = 0
          name: string
        }
      `,
      "/main.do": `
        import { Foo } from "./lib"
        const f = Foo { name: "hi" }
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows same-file construction with private fields lacking defaults", () => {
    const info = check({
      "/main.do": `
        class Foo {
          private secret: int
          name: string
        }
        const f = Foo { secret: 42, name: "hi" }
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("private field accessible via implicit this in same-file method", () => {
    const info = check({
      "/main.do": `
        class Foo {
          private secret: int
          function getSecret(): int { return secret }
        }
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors when importing private class", () => {
    const info = check({
      "/lib.do": `
        private class Internal {
          x: int
        }
      `,
      "/main.do": `
        import { Internal } from "./lib"
      `,
    }, "/main.do");
    expect(info.result.diagnostics.some(d => d.message.includes('does not export "Internal"'))).toBe(true);
  });

  it("errors when importing private function", () => {
    const info = check({
      "/lib.do": `
        private function helper(): int { return 0 }
      `,
      "/main.do": `
        import { helper } from "./lib"
      `,
    }, "/main.do");
    expect(info.result.diagnostics.some(d => d.message.includes('does not export "helper"'))).toBe(true);
  });

  it("allows public member access from other file", () => {
    const info = check({
      "/lib.do": `
        export class Foo {
          name: string
          function greet(): string { return name }
        }
      `,
      "/main.do": `
        import { Foo } from "./lib"
        const f = Foo { name: "hi" }
        const n = f.name
        const g = f.greet()
      `,
    }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on non-existent method on class", () => {
    const info = check({
      "/main.do": `
        class Point {
          x, y: float
          function display(): string => \`(\${x}, \${y})\`
        }
        function main(): int {
          a := Point { x: 1.0, y: 2.0 }
          println(a.gisplay())
          return 0
        }
      `,
    }, "/main.do");
    expect(info.diagnostics.some((d) =>
      d.message.includes('does not exist on type "Point"')
    )).toBe(true);
  });

  it("errors on non-existent field on class", () => {
    const info = check({
      "/main.do": `
        class Point {
          x, y: float
        }
        function main(): int {
          a := Point { x: 1.0, y: 2.0 }
          const z = a.z
          return 0
        }
      `,
    }, "/main.do");
    expect(info.diagnostics.some((d) =>
      d.message.includes('does not exist on type "Point"')
    )).toBe(true);
  });

  it("errors on non-existent method on interface", () => {
    const info = check({
      "/main.do": `
        interface Shape { area(): float }
        function printArea(s: Shape): float => s.perimeter()
      `,
    }, "/main.do");
    expect(info.diagnostics.some((d) =>
      d.message.includes('does not exist on type "Shape"')
    )).toBe(true);
  });
});

// ============================================================================
// JSON serialization — toJsonValue / fromJsonValue
// ============================================================================

describe("JSON serialization — toJsonValue", () => {
  it("resolves toJsonValue() to () → JsonValue on class instances", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      const p = Point { x: 1.0, y: 2.0 }
      const json = p.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmts = info.program.statements;
    const jsonDecl = stmts[2] as ConstDeclaration;
    expect(jsonDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
  });

  it("errors for non-serializable field (function type)", () => {
    const info = check({ "/main.do": `
      class Bad {
        callback: (x: int): void
      }
      const b = Bad { callback: (x: int) => { } }
      const json = b.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not JSON-serializable"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("callback"))).toBe(true);
  });

  it("errors for non-serializable field (weak reference)", () => {
    const info = check({ "/main.do": `
      class Node {
        weak parent: Node
      }
    ` }, "/main.do");
    // No error until toJsonValue is actually used — the type is only checked on access
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows toJsonValue on class with all serializable fields", () => {
    const info = check({ "/main.do": `
      class Config {
        host: string
        port: int
        debug: bool
      }
      const c = Config { host: "localhost", port: 8080, debug: false }
      const json = c.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows toJsonValue on class with nested class fields", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      class Line { start, end_: Point }
      const l = Line { start: Point { x: 0.0, y: 0.0 }, end_: Point { x: 1.0, y: 1.0 } }
      const json = l.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows toJsonValue on class with array fields", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      class Polygon {
        vertices: Point[]
      }
      const p = Polygon { vertices: [Point { x: 0.0, y: 0.0 }] }
      const json = p.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows toJsonValue on class with enum fields", () => {
    const info = check({ "/main.do": `
      enum Color { Red, Green, Blue }
      class Pixel {
        x, y: int
        color: Color
      }
      const p = Pixel { x: 0, y: 0, color: Color.Red }
      const json = p.toJsonValue()
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });
});

describe("JSON serialization — fromJsonValue", () => {
  it("resolves fromJsonValue() to (JsonValue) → Result<T, string> on class name", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      const result = Point.fromJsonValue({})
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmts = info.program.statements;
    const resultDecl = stmts[1] as ConstDeclaration;
    const rt = resultDecl.resolvedType;
    expect(rt?.kind).toBe("result");
    if (rt?.kind === "result") {
      expect(rt.successType.kind).toBe("class");
      expect(rt.errorType).toEqual(STRING_TYPE);
    }
  });

  it("errors for non-serializable field on fromJsonValue", () => {
    const info = check({ "/main.do": `
      class Bad {
        callback: (x: int): void
      }
      const result = Bad.fromJsonValue({})
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not JSON-serializable"))).toBe(true);
  });
});

describe("JSON serialization — interface fromJsonValue", () => {
  it("resolves fromJsonValue on interface with shared discriminator", () => {
    const info = check({ "/main.do": `
      interface Shape {
        area(): double
      }
      class Circle implements Shape {
        const kind = "circle"
        radius: double
        function area(): double => 3.14 * radius * radius
      }
      class Rect implements Shape {
        const kind = "rect"
        width, height: double
        function area(): double => width * height
      }
      const r = Shape.fromJsonValue({})
    ` }, "/main.do");
    expect(info.diagnostics.map(d => d.message)).toEqual([]);
    const stmts = info.program.statements;
    const resultDecl = stmts[3] as ConstDeclaration;
    const rt = resultDecl.resolvedType;
    expect(rt?.kind).toBe("result");
    if (rt?.kind === "result") {
      expect(rt.successType.kind).toBe("interface");
      expect(rt.errorType).toEqual(STRING_TYPE);
    }
  });

  it("errors when interface implementors lack shared discriminator", () => {
    const info = check({ "/main.do": `
      interface Animal {}
      class Dog implements Animal {
        name: string
      }
      class Cat implements Animal {
        name: string
      }
      const r = Animal.fromJsonValue({})
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("must share a const string field"))).toBe(true);
  });

  it("errors when no implementing classes found", () => {
    const info = check({ "/main.do": `
      interface Empty {
        foo(): int
      }
      const r = Empty.fromJsonValue({})
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("no implementing classes found"))).toBe(true);
  });
});

describe("Interface emission constraints", () => {
  it("errors when interface has no implementing classes", () => {
    const info = check({ "/main.do": `
      interface Shape {
        area(): float
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("Cannot emit interface \"Shape\" without implementing classes"))).toBe(true);
  });

  it("does not error when interface has an implementing class", () => {
    const info = check({ "/main.do": `
      interface Shape {
        area(): float
      }
      class Circle implements Shape {
        radius: float
        function area(): float => 3.14 * radius * radius
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("Cannot emit interface \"Shape\" without implementing classes"))).toBe(false);
  });
});

describe("JSON serialization — reserved method names", () => {
  it("errors when user defines toJsonValue method on a class", () => {
    const info = check({ "/main.do": `
      class Foo {
        x: int
        function toJsonValue(): JsonValue => null
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("reserved intrinsic method"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("toJsonValue"))).toBe(true);
  });

  it("errors when user defines fromJsonValue method on a class", () => {
    const info = check({ "/main.do": `
      class Foo {
        x: int
        function fromJsonValue(value: JsonValue): string => "nope"
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("reserved intrinsic method"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("fromJsonValue"))).toBe(true);
  });

  it("errors when user defines metadata method on a class", () => {
    const info = check({ "/main.do": `
      class Foo {
        x: int
        function metadata(): string => "custom"
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("reserved intrinsic method"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("metadata"))).toBe(true);
  });

  it("allows user-defined invoke method on a class", () => {
    const info = check({ "/main.do": `
      class Foo {
        x: int
        function invoke(s: string): string => s
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Metadata / invoke for tool interop
// ============================================================================

describe("Metadata — .metadata access", () => {
  it("resolves MyClass.metadata to ClassMetaType", () => {
    const info = check({ "/main.do": `
      class Tool "A tool." {
        name: string
        function run "Runs the tool."(input: string): string => input
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmts = info.program.statements;
    const mDecl = stmts[1] as ConstDeclaration;
    expect(mDecl.resolvedType).toBeDefined();
    expect(mDecl.resolvedType!.kind).toBe("class-metadata");
  });

  it("sets needsMetadata flag on class declaration", () => {
    const info = check({ "/main.do": `
      class Tool {
        name: string
        function run(input: string): string => input
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const classDecl = info.program.statements[0] as any;
    expect(classDecl.needsMetadata).toBe(true);
    expect(classDecl.needsJson).toBe(true);
  });

  it("resolves instance-qualified metadata access", () => {
    const info = check({ "/main.do": `
      class Tool {
        function run(input: string): string => input
      }
      function getName(tool: Tool): string => tool::metadata.name
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("resolves interface-value-qualified metadata access", () => {
    const info = check({ "/main.do": `
      interface NamedTool {
        static describe(): string
      }
      class Tool implements NamedTool {
        function run(input: string): string => input
        static describe(): string => "tool"
      }
      function getName(tool: NamedTool): string => tool::metadata.name
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors on generic class", () => {
    const info = check({ "/main.do": `
      class Box<T> {
        value: T
      }
      const m = Box.metadata
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not available on generic"))).toBe(true);
  });

  it("errors when method param is not JSON-serializable", () => {
    const info = check({ "/main.do": `
      class Bad {
        function run(cb: (x: int): void): string => "ok"
      }
      const m = Bad.metadata
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not JSON-serializable"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("cb"))).toBe(true);
  });

  it("errors when method return type is not JSON-serializable", () => {
    const info = check({ "/main.do": `
      class Bad {
        function run(input: string): (x: int): void => (x: int) => { }
      }
      const m = Bad.metadata
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not JSON-serializable"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("run"))).toBe(true);
  });

  it("allows Result-returning methods with JSON success and non-JsonValue failure", () => {
    const info = check({ "/main.do": `
      class Tool {
        function run(input: string): Result<string, int> => Success(input)
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("errors when Result success type is not JSON-serializable", () => {
    const info = check({ "/main.do": `
      class Bad {
        function run(): Result<Promise<int>, string> => Failure("bad")
      }
      const m = Bad.metadata
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("Success type"))).toBe(true);
    expect(info.diagnostics.some((d) => d.message.includes("run"))).toBe(true);
  });

  it("allows Result failure types that are not JsonValue", () => {
    const info = check({ "/main.do": `
      class ToolError {
        message: string
      }
      class Tool {
        function run(): Result<string, ToolError> => Success("ok")
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows void return methods", () => {
    const info = check({ "/main.do": `
      class Tool {
        function doSomething(input: string): void { }
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("skips private and static methods in serializability check", () => {
    const info = check({ "/main.do": `
      class Tool {
        function run(input: string): string => input
        private function helper(cb: (x: int): void): void { }
        static function create(): Tool => Tool { }
      }
      const m = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });
});

describe("Metadata — .methods[i].invoke access", () => {
  it("resolves method reflection invoke to Result-returning function", () => {
    const info = check({ "/main.do": `
      class Tool {
        name: string
        function run(input: string): string => input
      }
      const meta = Tool.metadata
      const methods = meta.methods
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmts = info.program.statements;
    const methodsDecl = stmts[2] as ConstDeclaration;
    expect(methodsDecl.resolvedType).toBeDefined();
    expect(methodsDecl.resolvedType!.kind).toBe("array");
    const arrType = methodsDecl.resolvedType as any;
    expect(arrType.elementType.kind).toBe("method-reflection");
  });

  it("resolves class metadata invoke to Result-returning function", () => {
    const info = check({ "/main.do": `
      class Tool {
        function run(input: string): string => input
      }
      const meta = Tool.metadata
      const tool = Tool { }
      const result = meta.invoke(tool, "run", { input: "ok" })
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmts = info.program.statements;
    const resultDecl = stmts[3] as ConstDeclaration;
    expect(resultDecl.resolvedType).toEqual({
      kind: "result",
      successType: JSON_VALUE_TYPE,
      errorType: JSON_VALUE_TYPE,
    });
  });

  it("sets needsMetadata and needsJson flags via metadata access", () => {
    const info = check({ "/main.do": `
      class Tool {
        function run(input: string): string => input
      }
      const meta = Tool.metadata
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const classDecl = info.program.statements[0] as any;
    expect(classDecl.needsMetadata).toBe(true);
    expect(classDecl.needsJson).toBe(true);
  });

  it("errors on generic class metadata", () => {
    const info = check({ "/main.do": `
      class Box<T> {
        value: T
      }
      const m = Box.metadata
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("not available on generic"))).toBe(true);
  });
});

// ============================================================================
// With statement scoping
// ============================================================================

describe("With statement", () => {
  it("bindings are in scope inside the block", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x := 42 {
          return x
        }
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const ids = findId(info, "x");
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids[0].type).toEqual(INT_TYPE);
  });

  it("infers types for with bindings", () => {
    const info = check({ "/main.do": `
      function test(): string {
        with greeting := "hello" {
          return greeting
        }
        return ""
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const ids = findId(info, "greeting");
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids[0].type).toEqual(STRING_TYPE);
  });

  it("supports multiple bindings", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x := 10, y := 20 {
          return x + y
        }
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const xs = findId(info, "x");
    const ys = findId(info, "y");
    expect(xs.length).toBeGreaterThanOrEqual(1);
    expect(ys.length).toBeGreaterThanOrEqual(1);
    expect(xs[0].type).toEqual(INT_TYPE);
    expect(ys[0].type).toEqual(INT_TYPE);
  });

  it("later bindings can reference earlier ones", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x := 10, y := x + 5 {
          return y
        }
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const ys = findId(info, "y");
    expect(ys.length).toBeGreaterThanOrEqual(1);
    expect(ys[0].type).toEqual(INT_TYPE);
  });

  it("supports typed bindings", () => {
    const info = check({ "/main.do": `
      function test(): double {
        with x: double := 3.14 {
          return x
        }
        return 0.0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const xs = findId(info, "x");
    expect(xs.length).toBeGreaterThanOrEqual(1);
    expect(xs[0].type).toEqual(DOUBLE_TYPE);
  });

  it("errors on type annotation mismatch", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x: string := 42 {
          return 0
        }
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics.some((d) => d.message.includes("not assignable"))).toBe(true);
  });

  it("bindings are immutable", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x := 42 {
          return x
        }
        return 0
      }
    ` }, "/main.do");
    const xs = findId(info, "x");
    expect(xs.length).toBeGreaterThanOrEqual(1);
    expect(xs[0].mutable).toBe(false);
    expect(xs[0].kind).toBe("immutable-binding");
  });

  it("nested with statements work correctly", () => {
    const info = check({ "/main.do": `
      function test(): int {
        with x := 10 {
          with y := x + 20 {
            return y
          }
        }
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Constructor validation
// ============================================================================

describe("checker — constructor validation", () => {
  it("validates positional constructor arg count — too few", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point(0.0)
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 2 constructor argument(s) but got 1");
  });

  it("validates positional constructor arg count — too many", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point(1.0, 2.0, 3.0)
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 2 constructor argument(s) but got 3");
  });

  it("validates call-expression constructor arg count — too few", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point(0.0)
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 2 constructor argument(s) but got 1");
  });

  it("validates call-expression constructor arg count — too many", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point(1.0, 2.0, 3.0)
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 2 constructor argument(s) but got 3");
  });

  it("validates constructor arg types", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point("hello", "world")
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(2);
    expect(info.diagnostics[0].message).toContain("not assignable to field");
  });

  it("allows trailing defaults to be omitted", () => {
    const info = check({ "/main.do": `
      class Config {
        host: string
        port: int = 8080
        timeout: int = 30
      }
      a := Config("localhost")
      b := Config("localhost", 9000)
      c := Config("localhost", 9000, 5)
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects omitting required fields by position", () => {
    const info = check({ "/main.do": `
      class Config {
        host: string
        port: int = 8080
        timeout: int = 30
      }
      a := Config()
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 1-3 constructor argument(s) but got 0");
  });

  it("excludes const fields from positional constructor params", () => {
    const info = check({ "/main.do": `
      class Success {
        const kind = "Success"
        value: int
      }
      a := Success { value: 42 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows positional construction for a user-defined Success class", () => {
    const info = check({ "/main.do": `
      class Success {
        value: int
      }
      a := Success(42)
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("validates named construction — missing required field", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point { x: 1.0 }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain('Missing required field "y"');
  });

  it("validates named construction — unknown field", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point { x: 1.0, y: 2.0, z: 3.0 }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain('does not have a field "z"');
  });

  it("validates named construction — field type mismatch", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point { x: "hello", y: 2.0 }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("not assignable to type");
  });

  it("allows correct named construction", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point { x: 1.0, y: 2.0 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("allows numeric literal narrowing in constructor args", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a := Point(0.0, 0.0)
      b := Point { x: 0.0, y: 0.0 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Contextual typing
// ============================================================================

describe("checker — contextual typing", () => {
  it("infers object literal as class when expected type is class (immutable binding)", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point := { x: 0.0, y: 0.0 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmt = info.program.statements[1] as any;
    expect(stmt.resolvedType?.kind).toBe("class");
    // The object literal's resolved type should also be class
    expect(stmt.value.resolvedType?.kind).toBe("class");
  });

  it("infers tuple literal as class when expected type is class (immutable binding)", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point := (0.0, 0.0)
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const stmt = info.program.statements[1] as any;
    expect(stmt.resolvedType?.kind).toBe("class");
    expect(stmt.value.resolvedType?.kind).toBe("class");
  });

  it("infers object literal as class when expected type is class (let)", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      let a: Point = { x: 0.0, y: 0.0 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers tuple literal as class when expected type is class (let)", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      let a: Point = (0.0, 0.0)
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers class type transitively through array literal", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point[] := [{ x: 0.0, y: 0.0 }]
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers class type transitively through array with tuples", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point[] := [(0.0, 0.0)]
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers empty array with declared element type", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point[] := []
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("contextual typing flows through function args", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function draw(p: Point): void { }
      draw({ x: 1.0, y: 2.0 })
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("contextual typing flows through function args — tuple", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function draw(p: Point): void { }
      draw((1.0, 2.0))
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("contextual typing flows through return statements", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function origin(): Point => { x: 0.0, y: 0.0 }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("contextual typing reports errors for structural construction", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point := { x: 1.0 }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain('Missing required field "y"');
  });

  it("contextual typing validates tuple constructor arg count", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point := (1.0, 2.0, 3.0)
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("expects 2 constructor argument(s) but got 3");
  });

  it("contextual typing validates object literal field types", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      a: Point := { x: "hello", y: 2.0 }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBe(1);
    expect(info.diagnostics[0].message).toContain("not assignable to type");
  });

  it("shorthand property resolves identifier type for class construction", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        y := 2.0f
        p: Point := { x, y }
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("shorthand property reports error for undefined identifier", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): void {
        p: Point := { x, y }
      }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain("Undefined identifier");
  });

  it("shorthand property validates type compatibility", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): void {
        x := "hello"
        y := 2.0
        p: Point := { x, y }
      }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain("not assignable to type");
  });

  it("shorthand property works with named construct expression", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        y := 2.0f
        p := Point { x, y }
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("mixed shorthand and explicit properties work", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): void {
        x := 1.0f
        p: Point := { x, y: 2.0 }
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects object literals without contextual type information", () => {
    const info = check({ "/main.do": `
      function main(): void {
        a := { foo: 12 }
      }
    ` }, "/main.do");
    expect(info.diagnostics.some((d) => d.message.includes("Object literal requires contextual type information"))).toBe(true);
  });

  it("contextual typing flows through array .push() for object literals", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): int {
        let pts: Point[] = []
        pts.push({ x: 1.0, y: 2.0 })
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    // The object literal should resolve to the Point class type
    const exprs = collectExprs(info.program);
    const objLit = exprs.find(e => e.kind === "object-literal");
    expect(objLit?.resolvedType?.kind).toBe("class");
  });

  it("contextual typing flows through array .push() for tuple literals", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): int {
        let pts: Point[] = []
        pts.push((1.0, 2.0))
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("array .push() reports type errors for mismatched object literal fields", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): int {
        let pts: Point[] = []
        pts.push({ x: "hello", y: 2.0 })
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain("not assignable to type");
  });

  it("array .push() reports missing field errors", () => {
    const info = check({ "/main.do": `
      class Point { x, y: float }
      function main(): int {
        let pts: Point[] = []
        pts.push({ x: 1.0 })
        return 0
      }
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThan(0);
    expect(info.diagnostics[0].message).toContain('Missing required field "y"');
  });

  it("reports ambiguous object literal for class union without discriminator", () => {
    const source = [
      'class Box {',
      '  const kind = "box"',
      '  width: float',
      '  height: float',
      '  color: string',
      '}',
      '',
      'class Toy {',
      '  const kind = "toy"',
      '  color: string',
      '}',
      '',
      'type Thing = Box | Toy',
      '',
      'function main(): int {',
      '  t: Thing := { color: "red" }',
      '  return 0',
      '}',
    ].join("\n");

    const info = check({ "/main.do": source }, "/main.do");
    expect(info.diagnostics).toHaveLength(1);
    expect(info.diagnostics[0].message).toContain('Object literal is ambiguous for union type "Box | Toy"');
    expect(info.diagnostics[0].message).toContain('add "kind" to disambiguate');
    expect(info.diagnostics[0].span.start.line).toBe(16);
  });
});

// ============================================================================
// Lambda contextual typing — parameterless, name matching, flexible params
// ============================================================================

describe("Lambda contextual typing", () => {
  it("parameterless lambda inherits params from expected function type", () => {
    const info = check({ "/main.do": `
      type Handler = (msg: string): void
      let handler: Handler = => print(msg)
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("parameterless lambda with two params from expected type", () => {
    const info = check({ "/main.do": `
      type BinaryOp = (a: int, b: int): int
      let add: BinaryOp = => a + b
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const fns = findTypes(info, (t) => t.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
    const fn = fns.find((t) => t.kind === "function" && t.params.length === 2);
    expect(fn).toBeDefined();
    if (fn?.kind === "function") {
      expect(fn.params[0].name).toBe("a");
      expect(fn.params[1].name).toBe("b");
      expect(typeToString(fn.params[0].type)).toBe("int");
      expect(typeToString(fn.params[1].type)).toBe("int");
    }
  });

  it("parameterless lambda works as callback argument", () => {
    const info = check({ "/main.do": `
      class Rectangle {
        width, height: float
        function sayIt(callback: (width: float, height: float): void) {
          callback(width, height)
        }
      }
      const rect = Rectangle { width: 3.0, height: 4.0 }
      rect.sayIt(=> print("done"))
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("parameterless lambda binds params from callback signature", () => {
    const info = check({ "/main.do": `
      function invoke(callback: (width: float, height: float): void) {
        callback(1.0, 2.0)
      }
      invoke(=> print("done"))
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers param types from expected function type (untyped params)", () => {
    const info = check({ "/main.do": `
      type Transform = (x: int): int
      let t: Transform = (x) => x * 2
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("rejects lambda param names that don't match expected signature", () => {
    const info = check({ "/main.do": `
      function invoke(callback: (width: float, height: float): void) {
        callback(1.0, 2.0)
      }
      invoke((heightf, width) => print("done"))
    ` }, "/main.do");
    expect(info.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(info.diagnostics[0].message).toContain("heightf");
    expect(info.diagnostics[0].message).toContain("does not match");
  });

  it("accepts lambda params matching expected signature names", () => {
    const info = check({ "/main.do": `
      function invoke(callback: (width: float, height: float): void) {
        callback(1.0, 2.0)
      }
      invoke((width, height) => print("done"))
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("infers types for name-matched lambda params", () => {
    const info = check({ "/main.do": `
      type BinaryOp = (a: int, b: int): int
      let op: BinaryOp = (a, b) => a + b
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
    const fns = findTypes(info, (t) => t.kind === "function");
    const fn = fns.find((t) => t.kind === "function" && t.params.length === 2);
    expect(fn).toBeDefined();
    if (fn?.kind === "function") {
      expect(typeToString(fn.params[0].type)).toBe("int");
      expect(typeToString(fn.params[1].type)).toBe("int");
    }
  });

  it("accepts subset of params from expected signature", () => {
    const info = check({ "/main.do": `
      type Callback = (a: int, b: int, c: int): int
      let fn: Callback = (a) => a * 2
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("does not require param name matching when types are explicit", () => {
    const info = check({ "/main.do": `
      type Callback = (a: int, b: int): int
      let fn: Callback = (x: int, y: int): int => x + y
    ` }, "/main.do");
    expect(info.diagnostics).toHaveLength(0);
  });

  it("omitted subset params do not shadow outer-scope names", () => {
    // 'b' exists in outer scope; lambda only names 'a'.
    // The omitted 'b' param should get a synthetic name — outer 'b' must remain accessible.
    const info = check({ "/main.do": `
      type Callback = (a: int, b: int): int
      const b = 99
      let fn: Callback = (a) => a + b
    ` }, "/main.do");
    // 'b' in the body should resolve to the outer const, not a lambda parameter
    expect(info.diagnostics).toHaveLength(0);
    const bBindings = findId(info, "b");
    expect(bBindings.length).toBeGreaterThanOrEqual(1);
    expect(bBindings.every((bind) => bind.kind === "const")).toBe(true);
  });
});

// ============================================================================
// Trailing lambdas
// ============================================================================

describe("checker — trailing lambdas", () => {
  it("allows trailing lambda with void callback", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) { print(it) }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows trailing lambda with void callback and multiple params", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int, index: int): void
      function forEachIndexed(arr: int[], fn: Action): void { }
      function f(): void {
        forEachIndexed([1, 2, 3]) { print(it) }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows trailing lambda with multi-statement void block", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) {
          const label = "Item: " + it
          print(label)
        }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("allows trailing lambda appended as last positional arg", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEachWithInit(arr: int[], init: int, fn: Action): void { }
      function f(): void {
        forEachWithInit([1, 2, 3], 0) { print(it) }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("rejects trailing lambda with non-void callback", () => {
    const cr = check({ "/main.do": `
      type MapFn = (it: int): int
      function myMap(arr: int[], fn: MapFn): int[] { return arr }
      function f(): void {
        myMap([1, 2, 3]) { it * 2 }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("void");
    expect(cr.diagnostics[0].message).toContain("explicit lambda");
  });

  it("rejects return statement inside trailing lambda body", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) { return }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("'return' cannot be used inside a trailing lambda");
  });

  it("rejects return with value inside trailing lambda body", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) { return 42 }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("'return' cannot be used inside a trailing lambda");
  });

  it("allows return inside a regular lambda nested in trailing lambda", () => {
    const cr = check({ "/main.do": `
      type Action = (it: int): void
      function forEach(arr: int[], fn: Action): void { }
      function f(): void {
        forEach([1, 2, 3]) {
          const fn = (x: int): int => { return x + 1 }
          print(fn(it))
        }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Map<K, V> type support
// ============================================================================

describe("checker — Map type", () => {
  it("resolves Map<K, V> type annotation", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
  });

  it("infers map literal type from entries", () => {
    const cr = check({ "/main.do": `
      m := { ["hello"]: 42 }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
    if (mapLit?.resolvedType?.kind === "map") {
      expect(mapLit.resolvedType.keyType.kind).toBe("primitive");
      expect(mapLit.resolvedType.valueType.kind).toBe("primitive");
    }
  });

  it("resolves Map member .size as int", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
      x := m.size
      print(x)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const bindings = findId(cr, "x");
    expect(bindings[0]?.type.kind).toBe("primitive");
  });

  it("resolves Map .get() return type as nullable value", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
      x := m.get("a")
      print(x)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const bindings = findId(cr, "x");
    expect(bindings[0]?.type.kind).toBe("union");
  });

  it("resolves Map .has() return type as bool", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
      x := m.has("a")
      print(x)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const bindings = findId(cr, "x");
    expect(bindings[0]?.type.kind).toBe("primitive");
    if (bindings[0]?.type.kind === "primitive") {
      expect(bindings[0].type.name).toBe("bool");
    }
  });

  it("resolves Map .keys() as array of key type", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
      k := m.keys()
      print(k)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const bindings = findId(cr, "k");
    expect(bindings[0]?.type.kind).toBe("array");
  });

  it("resolves Map .values() as array of value type", () => {
    const cr = check({ "/main.do": `
      let m: Map<string, int> = { "a": 1 }
      v := m.values()
      print(v)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const bindings = findId(cr, "v");
    expect(bindings[0]?.type.kind).toBe("array");
  });

  it("parses dot-shorthand map literal keys", () => {
    const cr = check({ "/main.do": `
      enum Color { Red, Green, Blue }
      let m: Map<Color, int> = {
        .Red: 1,
        .Green: 2,
        .Blue: 3
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("accepts explicit enum-access map literal keys in initializers", () => {
    const cr = check({ "/main.do": `
      enum Color { Red, Green, Blue }
      let m: Map<Color, string> = {
        Color.Red: "red",
        Color.Green: "green"
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("checks Map type assignability", () => {
    expect(isAssignableTo(
      { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE },
      { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE },
    )).toBe(true);
  });

  it("typeToString formats Map type correctly", () => {
    expect(typeToString({ kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE })).toBe("Map<string, int>");
  });

  it("typeToString formats ReadonlyMap type correctly", () => {
    expect(typeToString({ kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE, readonly_: true })).toBe("ReadonlyMap<string, int>");
  });

  it("typeToString formats Set type correctly", () => {
    expect(typeToString({ kind: "set", elementType: STRING_TYPE })).toBe("Set<string>");
  });

  it("typeToString formats ReadonlySet type correctly", () => {
    expect(typeToString({ kind: "set", elementType: INT_TYPE, readonly_: true })).toBe("ReadonlySet<int>");
  });

  it("typesEqual compares Map types correctly", () => {
    expect(typesEqual(
      { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE },
      { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE },
    )).toBe(true);
    expect(typesEqual(
      { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE },
      { kind: "map", keyType: STRING_TYPE, valueType: BOOL_TYPE },
    )).toBe(false);
  });

  it("resolves empty {} as Map when expected type is Map", () => {
    const cr = check({ "/main.do": `
      let m: Map<int, string> = {}
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const objLit = exprs.find(e => e.kind === "object-literal");
    expect(objLit?.resolvedType?.kind).toBe("map");
    if (objLit?.resolvedType?.kind === "map") {
      expect(objLit.resolvedType.keyType.kind).toBe("primitive");
      expect(objLit.resolvedType.valueType.kind).toBe("primitive");
    }
  });

  it("infers Map type from bare integer literal keys", () => {
    const cr = check({ "/main.do": `
      let m: Map<int, string> = { 1: "one", 2: "two" }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
  });

  it("infers Map<long, string> type from bare long literal keys", () => {
    const cr = check({ "/main.do": `
      let m: Map<long, string> = { 1L: "one", 2L: "two" }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
    if (mapLit?.resolvedType?.kind === "map") {
      expect(mapLit.resolvedType.keyType).toEqual({ kind: "primitive", name: "long" });
    }
  });

  it("widens inferred map literal key type from int to long", () => {
    const cr = check({ "/main.do": `
      m := { 1: "one", 2L: "two" }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
    if (mapLit?.resolvedType?.kind === "map") {
      expect(mapLit.resolvedType.keyType).toEqual({ kind: "primitive", name: "long" });
    }
  });

  it("infers Map type from return type context", () => {
    const cr = check({ "/main.do": `
      function getMap(): Map<int, string> {
        return { 1: "one", 2: "two" }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
    if (mapLit?.resolvedType?.kind === "map") {
      expect(mapLit.resolvedType.keyType).toEqual({ kind: "primitive", name: "int" });
      expect(mapLit.resolvedType.valueType).toEqual({ kind: "primitive", name: "string" });
    }
  });

  it("infers Map type from parameter context", () => {
    const cr = check({ "/main.do": `
      function takeMap(m: Map<int, string>): void {
        print(m)
      }
      takeMap({ 1: "one" })
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("accepts long-keyed maps in return and parameter contexts", () => {
    const cr = check({ "/main.do": `
      function getMap(): Map<long, string> {
        return { 1L: "one", 2L: "two" }
      }

      function takeMap(m: Map<long, string>): void {
        print(m)
      }

      takeMap({ 3L: "three" })
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("contextually widens int literal map keys to long", () => {
    const cr = check({ "/main.do": `
      let m: Map<long, int> = { 1: 10, 2: 20 }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const mapLit = exprs.find(e => e.kind === "map-literal");
    expect(mapLit?.resolvedType?.kind).toBe("map");
    if (mapLit?.resolvedType?.kind === "map") {
      expect(mapLit.resolvedType.keyType).toEqual({ kind: "primitive", name: "long" });
    }
  });

  it("infers bare Map type arguments from a non-empty homogeneous literal", () => {
    const cr = check({ "/main.do": `
      m: Map := { "Alice": 100, "Bob": 95 }
      print(m)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    expect(findId(cr, "m")[0]?.type).toEqual({
      kind: "map",
      keyType: { kind: "primitive", name: "string" },
      valueType: { kind: "primitive", name: "int" },
      readonly_: false,
    });
  });

  it("infers bare ReadonlyMap type arguments from a non-empty homogeneous literal", () => {
    const cr = check({ "/main.do": `
      m: ReadonlyMap := { "Alice": 100, "Bob": 95 }
      print(m)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    expect(findId(cr, "m")[0]?.type).toEqual({
      kind: "map",
      keyType: { kind: "primitive", name: "string" },
      valueType: { kind: "primitive", name: "int" },
      readonly_: true,
    });
  });

  it("rejects bare Map annotation with an empty literal", () => {
    const cr = check({ "/main.do": `
      m: Map := {}
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Map type arguments from an empty map literal"))).toBe(true);
  });

  it("rejects partial Map annotations", () => {
    const cr = check({ "/main.do": `
      m: Map<string> := { "a": 1 }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Map requires either 0 or 2 type arguments"))).toBe(true);
  });

  it("rejects bare Map inference from heterogeneous values", () => {
    const cr = check({ "/main.do": `
      m: Map := { "a": 1, "b": "two" }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Map value type from heterogeneous map values"))).toBe(true);
  });

  it("rejects omitted Map type arguments outside same-site literal contexts", () => {
    const cr = check({ "/main.do": `
      function getMap(): Map {
        return { "a": 1 }
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Map are only supported with a same-site non-empty map literal"))).toBe(true);
  });

  it("rejects omitted Map type arguments in type aliases", () => {
    const cr = check({ "/main.do": `
      type Scores = Map
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Map are only supported with a same-site non-empty map literal"))).toBe(true);
  });

  it("rejects float Map key annotations", () => {
    const cr = check({ "/main.do": `
      let m: Map<float, int> = {}
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "float" is not supported'))).toBe(true);
  });

  it("rejects double Map key annotations", () => {
    const cr = check({ "/main.do": `
      function getMap(): Map<double, int> {
        return {}
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "double" is not supported'))).toBe(true);
  });

  it("rejects tuple Map key annotations", () => {
    const cr = check({ "/main.do": `
      let m: Map<Tuple<int, string>, int> = {}
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "Tuple<int, string>" is not supported'))).toBe(true);
  });

  it("rejects class Map key annotations", () => {
    const cr = check({ "/main.do": `
      class Point { x: int }
      let m: Map<Point, int> = {}
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "Point" is not supported'))).toBe(true);
  });

  it("rejects unsupported map keys in type aliases", () => {
    const cr = check({ "/main.do": `
      type BadLookup = Map<float, int>
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "float" is not supported'))).toBe(true);
  });

  it("rejects unsupported map keys in interfaces", () => {
    const cr = check({ "/main.do": `
      interface Lookup {
        values: Map<float, int>
        get(key: string): Map<double, int>
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "float" is not supported'))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes('Map key type "double" is not supported'))).toBe(true);
  });

  it("rejects float map literal keys without contextual type", () => {
    const cr = check({ "/main.do": `
      m := { 1.5f: "one point five" }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map literal key has type "float" which is not supported'))).toBe(true);
  });

  it("rejects double map literal keys without contextual type", () => {
    const cr = check({ "/main.do": `
      m := { 1.5: "one point five" }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map literal key has type "double" which is not supported'))).toBe(true);
  });

  it("rejects tuple map literal keys without contextual type", () => {
    const cr = check({ "/main.do": `
      m := { [(1, "one")]: 1 }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map literal key has type "Tuple<int, string>" which is not supported'))).toBe(true);
  });

  it("rejects class map literal keys without contextual type", () => {
    const cr = check({ "/main.do": `
      class Point { x: int }
      m := { [Point { x: 1 }]: 1 }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map literal key has type "Point" which is not supported'))).toBe(true);
  });

  it("rejects incompatible mixed map literal key types", () => {
    const cr = check({ "/main.do": `
      m := { 1: "one", "two": "two" }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Map literal key type "string" is not compatible with inferred key type "int"'))).toBe(true);
  });

  it("resolves Set type from array literal context", () => {
    const cr = check({ "/main.do": `
      let unique: Set<int> = [1, 2, 3, 2, 1]
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const arrayLit = exprs.find((expr) => expr.kind === "array-literal");
    expect(arrayLit?.resolvedType?.kind).toBe("set");
    if (arrayLit?.resolvedType?.kind === "set") {
      expect(arrayLit.resolvedType.elementType).toEqual({ kind: "primitive", name: "int" });
    }
  });

  it("accepts class field Set defaults from empty array syntax", () => {
    const cr = check({ "/main.do": `
      class Point {
        x, y: float
      }
      class Rectangle {
        origin: Point
        width, height: float
        colours: Set<int> = []
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("accepts enum Set initializers with explicit enum access", () => {
    const cr = check({ "/main.do": `
      enum Color { Red, Blue }
      let palette: Set<Color> = [Color.Red, Color.Blue, Color.Red]
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const arrayLit = exprs.find((expr) => expr.kind === "array-literal");
    expect(arrayLit?.resolvedType?.kind).toBe("set");
    if (arrayLit?.resolvedType?.kind === "set") {
      expect(arrayLit.resolvedType.elementType.kind).toBe("enum");
    }
  });

  it("contextually widens int literal Set elements to long", () => {
    const cr = check({ "/main.do": `
      let ids: Set<long> = [1, 2, 3]
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program);
    const arrayLit = exprs.find((expr) => expr.kind === "array-literal");
    expect(arrayLit?.resolvedType).toEqual({
      kind: "set",
      elementType: { kind: "primitive", name: "long" },
      readonly_: false,
    });
  });

  it("infers bare Set element type from a non-empty homogeneous literal", () => {
    const cr = check({ "/main.do": `
      unique: Set := [1, 2, 3]
      print(unique)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    expect(findId(cr, "unique")[0]?.type).toEqual({
      kind: "set",
      elementType: { kind: "primitive", name: "int" },
      readonly_: false,
    });
  });

  it("infers bare ReadonlySet element type from a non-empty homogeneous literal", () => {
    const cr = check({ "/main.do": `
      unique: ReadonlySet := [1, 2, 3]
      print(unique)
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    expect(findId(cr, "unique")[0]?.type).toEqual({
      kind: "set",
      elementType: { kind: "primitive", name: "int" },
      readonly_: true,
    });
  });

  it("rejects bare Set annotation with an empty literal", () => {
    const cr = check({ "/main.do": `
      unique: Set := []
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Set element type from an empty set literal"))).toBe(true);
  });

  it("rejects extra Set type arguments", () => {
    const cr = check({ "/main.do": `
      unique: Set<int, string> := [1, 2, 3]
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Set requires either 0 or 1 type arguments"))).toBe(true);
  });

  it("rejects bare Set inference from heterogeneous elements", () => {
    const cr = check({ "/main.do": `
      unique: Set := [1, "two"]
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Cannot infer Set element type from heterogeneous set elements"))).toBe(true);
  });

  it("rejects omitted Set type arguments outside same-site literal contexts", () => {
    const cr = check({ "/main.do": `
      function values(): Set {
        return [1, 2, 3]
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Set are only supported with a same-site non-empty set literal"))).toBe(true);
  });

  it("rejects omitted Set type arguments in interfaces", () => {
    const cr = check({ "/main.do": `
      interface Palette {
        values: Set
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes("Omitted type arguments for Set are only supported with a same-site non-empty set literal"))).toBe(true);
  });

  it("rejects float Set element annotations", () => {
    const cr = check({ "/main.do": `
      let values: Set<float> = []
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "float" is not supported'))).toBe(true);
  });

  it("rejects double Set element annotations", () => {
    const cr = check({ "/main.do": `
      function values(): Set<double> {
        return []
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "double" is not supported'))).toBe(true);
  });

  it("rejects tuple Set element annotations", () => {
    const cr = check({ "/main.do": `
      let values: Set<Tuple<int, string> > = []
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "Tuple<int, string>" is not supported'))).toBe(true);
  });

  it("rejects class Set element annotations", () => {
    const cr = check({ "/main.do": `
      class Point { x: int }
      let values: Set<Point> = []
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "Point" is not supported'))).toBe(true);
  });

  it("rejects unsupported Set elements in type aliases", () => {
    const cr = check({ "/main.do": `
      type BadUnique = Set<float>
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "float" is not supported'))).toBe(true);
  });

  it("rejects unsupported Set elements in interfaces", () => {
    const cr = check({ "/main.do": `
      interface Palette {
        colors: Set<float>
        values(): Set<double>
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "float" is not supported'))).toBe(true);
    expect(cr.diagnostics.some((d) => d.message.includes('Set element type "double" is not supported'))).toBe(true);
  });
});

// ============================================================================
// String intrinsic methods
// ============================================================================

describe("checker — string methods", () => {
  it("string.indexOf returns int", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello world"
        pos := s.indexOf("world")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find(e => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "indexOf");
    expect(call?.resolvedType).toEqual({ kind: "primitive", name: "int" });
  });

  it("string.contains returns bool", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello"
        b := s.contains("ell")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find(e => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "contains");
    expect(call?.resolvedType).toEqual({ kind: "primitive", name: "bool" });
  });

  it("string.startsWith returns bool", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        b := "hello".startsWith("hel")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.endsWith returns bool", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        b := "hello".endsWith("lo")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.substring returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello world".substring(0, 5)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find(e => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "substring");
    expect(call?.resolvedType).toEqual({ kind: "primitive", name: "string" });
  });

  it("string.slice returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello world".slice(6)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.trim returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "  hello  ".trim()
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.trimStart and trimEnd return string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        a := "  hello  ".trimStart()
        b := "  hello  ".trimEnd()
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.toUpperCase and toLowerCase return string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        u := "hello".toUpperCase()
        l := "HELLO".toLowerCase()
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.replace returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello world".replace("world", "doof")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.replaceAll returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "aabaa".replaceAll("a", "x")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.split returns string[]", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        parts := "a,b,c".split(",")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find(e => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "split");
    expect(call?.resolvedType?.kind).toBe("array");
    if (call?.resolvedType?.kind === "array") {
      expect(call.resolvedType.elementType).toEqual({ kind: "primitive", name: "string" });
    }
  });

  it("string.charAt returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        c := "hello".charAt(0)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string.repeat returns string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "ha".repeat(3)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("string() converts primitive values to string", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        a := string(42)
        b := string(true)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const calls = exprs.filter((e) => e.kind === "call-expression" && e.callee.kind === "identifier" && e.callee.name === "string");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.resolvedType).toEqual({ kind: "primitive", name: "string" });
    }
  });

  it("string() converts primitive unions to string", () => {
    const cr = check({ "/main.do": `
      function test(value: int | float, maybe: int | null): void {
        a := string(value)
        b := string(maybe)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const calls = exprs.filter((e) => e.kind === "call-expression" && e.callee.kind === "identifier" && e.callee.name === "string");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.resolvedType).toEqual({ kind: "primitive", name: "string" });
    }
  });

  it("rejects string() for non-primitive operands", () => {
    const cr = check({ "/main.do": `
      class Box { value: int }
      function test(box: Box): string {
        return string(box)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("string() requires a primitive, null, or union of string-convertible members");
  });

  it("int.parse returns Result<int, ParseError>", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := int.parse("42")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "parse");
    expect(call?.resolvedType).toEqual({
      kind: "result",
      successType: { kind: "primitive", name: "int" },
      errorType: { kind: "enum", symbol: expect.objectContaining({ name: "ParseError", module: "<builtin>" }) },
    });
  });

  it("contextually narrows integer literals to byte and byte[]", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value: byte = 42
        data: byte[] = [1, 2, 255]
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const array = exprs.find((e) => e.kind === "array-literal");
    expect(array?.resolvedType).toEqual({
      kind: "array",
      elementType: { kind: "primitive", name: "byte" },
      readonly_: false,
    });
    if (array?.kind === "array-literal") {
      for (const element of array.elements) {
        expect(element.resolvedType).toEqual({ kind: "primitive", name: "byte" });
      }
    }
  });

  it("byte.parse returns Result<byte, ParseError>", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := byte.parse("255")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "parse");
    expect(call?.resolvedType).toEqual({
      kind: "result",
      successType: { kind: "primitive", name: "byte" },
      errorType: { kind: "enum", symbol: expect.objectContaining({ name: "ParseError", module: "<builtin>" }) },
    });
  });

  it("rejects using a builtin namespace as a value", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := int
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("Builtin namespace \"int\" cannot be used as a value");
  });

  it("rejects invalid builtin namespace members directly", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := string.parse("42")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("Builtin namespace \"string\" has no member \"parse\"");
  });

  it("JSON.parse returns Result<JsonValue, string>", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := JSON.parse("{\\"ok\\":true}")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "parse" && e.callee.object.resolvedType?.kind === "builtin-namespace" && e.callee.object.resolvedType.name === "JSON");
    expect(call?.resolvedType).toEqual({
      kind: "result",
      successType: JSON_VALUE_TYPE,
      errorType: STRING_TYPE,
    });
  });

  it("JSON.stringify returns string", () => {
    const cr = check({ "/main.do": `
      function test(value: JsonValue): void {
        text := JSON.stringify(value)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "stringify");
    expect(call?.resolvedType).toEqual(STRING_TYPE);
  });

  it("rejects using JSON builtin namespace as a value", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value := JSON
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(1);
    expect(cr.diagnostics[0].message).toContain("Builtin namespace \"JSON\" cannot be used as a value");
  });

  it("accepts direct JsonValue construction with primitives and nested literals", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        a: JsonValue := 5
        b: JsonValue := 5L
        c: JsonValue := [1, 2, 3]
        d: JsonValue := { name: "Bob", age: 23, favouriteColours: ["red", "green", "blue"] }
        e: JsonValue := [1, true, "radish", null, [5.2, a, b, c, d]]
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const fn = cr.program!.statements[0] as FunctionDeclaration;
    const stmts = fn.body.kind === "block" ? fn.body.statements : [];
    const aDecl = stmts[0] as ConstDeclaration;
    const bDecl = stmts[1] as ConstDeclaration;
    const cDecl = stmts[2] as ConstDeclaration;
    const dDecl = stmts[3] as ConstDeclaration;
    const eDecl = stmts[4] as ConstDeclaration;
    expect(aDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
    expect(bDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
    expect(cDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
    expect(dDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
    expect(eDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
  });

  it("accepts exact-shape JsonValue collection assignments", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        entry: JsonValue := 4
        values: JsonValue[] := [entry]
        items: Map<string, JsonValue> := { "red": entry }
        fromArray: JsonValue := values
        fromMap: JsonValue := items
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const fn = cr.program!.statements[0] as FunctionDeclaration;
    const stmts = fn.body.kind === "block" ? fn.body.statements : [];
    const fromArrayDecl = stmts[3] as ConstDeclaration;
    const fromMapDecl = stmts[4] as ConstDeclaration;
    expect(fromArrayDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
    expect(fromMapDecl.resolvedType).toEqual(JSON_VALUE_TYPE);
  });

  it("rejects non-JsonValue collections in JsonValue positions", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        ints: int[] := [1, 2, 3]
        counts: Map<string, int> := { "red": 1 }
        a: JsonValue := ints
        b: JsonValue := counts
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(2);
    expect(cr.diagnostics[0].message).toContain('Type "int[]" is not assignable to type "JsonValue"');
    expect(cr.diagnostics[1].message).toContain('Type "Map<string, int>" is not assignable to type "JsonValue"');
  });

  it("accepts long values in JsonValue positions", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        value: JsonValue := 5L
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("array.contains returns bool", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        nums := [1, 2, 3]
        hasTwo := nums.contains(2)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "contains");
    expect(call?.resolvedType).toEqual({ kind: "primitive", name: "bool" });
  });

  it("array.slice returns array of same element type", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        nums := [1, 2, 3, 4]
        mid := nums.slice(1, 3)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const call = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "slice");
    expect(call?.resolvedType).toEqual({ kind: "array", elementType: { kind: "primitive", name: "int" }, readonly_: false });
  });

  it("set members expose size, has, add, delete, and values", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        let unique: Set<int> = [1, 2, 3]
        count := unique.size
        hasTwo := unique.has(2)
        unique.add(4)
        unique.delete(1)
        values := unique.values()
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const sizeExpr = exprs.find((e) => e.kind === "member-expression" && e.property === "size");
    expect(sizeExpr?.resolvedType).toEqual({ kind: "primitive", name: "int" });
    const hasCall = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "has");
    expect(hasCall?.resolvedType).toEqual({ kind: "primitive", name: "bool" });
    const valuesCall = exprs.find((e) => e.kind === "call-expression" && e.callee.kind === "member-expression" && e.callee.property === "values");
    expect(valuesCall?.resolvedType).toEqual({ kind: "array", elementType: { kind: "primitive", name: "int" }, readonly_: false });
  });

  it("rejects mutating methods on ReadonlyMap", () => {
    const cr = check({ "/main.do": `
      function test(m: ReadonlyMap<string, int>): void {
        m.set("x", 1)
        m.delete("x")
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(2);
    expect(cr.diagnostics[0].message).toContain('Method "set" is not available on readonly map');
    expect(cr.diagnostics[1].message).toContain('Method "delete" is not available on readonly map');
  });

  it("rejects mutating methods on ReadonlySet", () => {
    const cr = check({ "/main.do": `
      function test(s: ReadonlySet<int>): void {
        s.add(1)
        s.delete(1)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(2);
    expect(cr.diagnostics[0].message).toContain('Method "add" is not available on readonly set');
    expect(cr.diagnostics[1].message).toContain('Method "delete" is not available on readonly set');
  });
});

// ============================================================================
// Non-null assertion expression
// ============================================================================

describe("checker — non-null assertion", () => {
  it("strips null from nullable type with postfix !", () => {
    const cr = check({ "/main.do": `
      function test(s: string | null): void {
        println(s!)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const nna = exprs.find(e => e.kind === "non-null-assertion");
    expect(nna?.resolvedType).toEqual({ kind: "primitive", name: "string" });
  });

  it("works in function call argument position", () => {
    const cr = check({ "/main.do": `
      function greet(name: string): void {
        println("Hello " + name)
      }
      function test(name: string | null): void {
        greet(name!)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("preserves type when expression is not nullable", () => {
    const cr = check({ "/main.do": `
      function test(): void {
        s := "hello"
        println(s!)
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const exprs = collectExprs(cr.program!);
    const nna = exprs.find(e => e.kind === "non-null-assertion");
    expect(nna?.resolvedType).toEqual({ kind: "primitive", name: "string" });
  });
});

// ============================================================================
// Null narrowing in if-statement
// ============================================================================

describe("checker — null narrowing", () => {
  it("narrows nullable type in if != null body", () => {
    const cr = check({ "/main.do": `
      function test(s: string | null): int {
        if s != null {
          return s.length
        }
        return 0
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows nullable type in else body for == null", () => {
    const cr = check({ "/main.do": `
      function test(s: string | null): int {
        if s == null {
          return 0
        } else {
          return s.length
        }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows nullable class type in if != null body", () => {
    const cr = check({ "/main.do": `
      class Item { name: string }
      function test(item: Item | null): string {
        if item != null {
          return item.name
        }
        return ""
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// any
// ============================================================================

describe("checker — any", () => {
  it("allows assigning concrete values to any", () => {
    const cr = check({ "/main.do": `
      function box(x: int): any => x
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("rejects assigning any to a concrete type", () => {
    const cr = check({ "/main.do": `
      function test(x: any): int {
        y: int := x
        return y
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Type "any" is not assignable to type "int"'))).toBe(true);
  });

  it("rejects member access on raw any", () => {
    const cr = check({ "/main.do": `
      function test(x: any): int => x.length
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Property "length" is not available on type "any"'))).toBe(true);
  });

  it("rejects indexing raw any", () => {
    const cr = check({ "/main.do": `
      function test(x: any): any => x[0]
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Cannot index value of type "any"'))).toBe(true);
  });

  it("rejects calling raw any", () => {
    const cr = check({ "/main.do": `
      function test(f: any): any => f()
    ` }, "/main.do");
    expect(cr.diagnostics.some((d) => d.message.includes('Cannot call value of type "any"'))).toBe(true);
  });

  it("narrows any inside case type pattern", () => {
    const cr = check({ "/main.do": `
      function test(x: any): int => case x {
        s: string => s.length,
        _ => 0
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// Else-narrow statement
// ============================================================================

describe("checker — else-narrow statement", () => {
  it("narrows nullable type by removing null", () => {
    const cr = check({ "/main.do": `
      function getValue(): string | null => "hello"
      function test(): int {
        x := getValue() else { return 0 }
        return x.length
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows Result type to success type", () => {
    const cr = check({ "/main.do": `
      class Config { name: string }
      class AppError { message: string }
      function loadConfig(): Result<Config, AppError> => Success { value: Config { name: "app" } }
      function test(): string {
        x := loadConfig() else { return "" }
        return x.name
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows Result | null to success type", () => {
    const cr = check({ "/main.do": `
      class Config { name: string }
      class AppError { message: string }
      function loadConfig(): Result<Config, AppError> | null => null
      function test(): string {
        x := loadConfig() else { return "" }
        return x.name
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows Result with nullable success type (deep null removal)", () => {
    const cr = check({ "/main.do": `
      class Config { name: string }
      class AppError { message: string }
      function loadConfig(): Result<Config | null, AppError> => Success { value: null }
      function test(): string {
        x := loadConfig() else { return "" }
        return x.name
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("errors on non-applicable type (plain int)", () => {
    const cr = check({ "/main.do": `
      function getValue(): int => 42
      function test(): int {
        x := getValue() else { return 0 }
        return x
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some(d => d.message.includes("Result or nullable"))).toBe(true);
  });

  it("errors on non-applicable union (Circle | Rect)", () => {
    const cr = check({ "/main.do": `
      class Circle { radius: double }
      class Rect { width: double }
      type Shape = Circle | Rect
      function getShape(): Shape => Circle { radius: 5.0 }
      function test(): double {
        x := getShape() else { return 0.0 }
        return 0.0
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some(d => d.message.includes("Result or nullable"))).toBe(true);
  });

  it("errors when else block does not exit scope", () => {
    const cr = check({ "/main.do": `
      function getValue(): string | null => null
      function test(): int {
        x := getValue() else { println("oops") }
        return 0
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some(d => d.message.includes("must exit scope"))).toBe(true);
  });

  it("allows full type access inside else block", () => {
    const cr = check({ "/main.do": `
      class Config { name: string }
      class AppError { message: string }
      function loadConfig(): Result<Config, AppError> => Success { value: Config { name: "app" } }
      function test(): string {
        x := loadConfig() else {
          return case x {
            _: Success => "unexpected",
            f: Failure => f.error.message
          }
        }
        return x.name
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("accepts else block with break in a loop", () => {
    const cr = check({ "/main.do": `
      function getValue(): string | null => null
      function test(): void {
        while true {
          x := getValue() else { break }
          println(x)
        }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("accepts else block with continue in a loop", () => {
    const cr = check({ "/main.do": `
      function getValue(): string | null => null
      function test(): void {
        while true {
          x := getValue() else { continue }
          println(x)
        }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// As expression — type narrowing
// ============================================================================

describe("checker — as expression", () => {
  it("narrows any to concrete type yielding Result<T, string>", () => {
    const cr = check({ "/main.do": `
      function test(x: any): void {
        r := x as string
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
    const types = findTypes(cr, t => t.kind === "result");
    expect(types.length).toBeGreaterThan(0);
    const rt = types[0] as { kind: "result"; successType: ResolvedType; errorType: ResolvedType };
    expect(rt.successType).toEqual({ kind: "primitive", name: "string" });
    expect(rt.errorType).toEqual({ kind: "primitive", name: "string" });
  });

  it("narrows union member yielding Result<T, string>", () => {
    const cr = check({ "/main.do": `
      function test(x: int | string): void {
        r := x as string
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows nullable to non-null yielding Result<T, string>", () => {
    const cr = check({ "/main.do": `
      function test(x: string | null): void {
        r := x as string
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("identity narrowing (T as T) is valid", () => {
    const cr = check({ "/main.do": `
      function test(x: string): void {
        r := x as string
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("errors when source is not narrowable to target", () => {
    const cr = check({ "/main.do": `
      function test(x: int): void {
        r := x as string
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some(d => d.message.includes('Cannot narrow'))).toBe(true);
  });

  it("errors when target is not a member of the union", () => {
    const cr = check({ "/main.do": `
      function test(x: int | string): void {
        r := x as bool
      }
    ` }, "/main.do");
    expect(cr.diagnostics.some(d => d.message.includes('Cannot narrow'))).toBe(true);
  });

  it("works with try binding to unwrap Result", () => {
    const cr = check({ "/main.do": `
      function test(x: any): Result<string, string> {
        try s := x as string
        return Success { value: s }
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("works with else-narrow to unwrap Result", () => {
    const cr = check({ "/main.do": `
      function test(x: any): string {
        s := x as string else { return "" }
        return s
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("works with try! to panic-unwrap", () => {
    const cr = check({ "/main.do": `
      function test(x: any): string {
        s := try! x as string
        return s
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });

  it("narrows interface to implementing class", () => {
    const cr = check({ "/main.do": `
      interface Shape {
        area(): double
      }
      class Circle implements Shape {
        radius: double
        function area(): double => 3.14 * radius * radius
      }
      function test(s: Shape): void {
        r := s as Circle
      }
    ` }, "/main.do");
    expect(cr.diagnostics).toHaveLength(0);
  });
});
