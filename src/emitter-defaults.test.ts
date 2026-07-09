/**
 * Emitter tests - default expression emission.
 *
 * These tests assert on generated module artefacts so defaults are covered at
 * the same boundary that C++ consumers see: header declarations and call-site
 * materialization in source files.
 */

import { describe, expect, it } from "vitest";
import type { ClassDeclaration, Expression, FunctionDeclaration, Statement } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { check } from "./checker-test-helpers.js";
import { canEmitDefaultExpressionInHeader, emitDefaultExpression } from "./emitter-defaults.js";
import { emitSplit } from "./emitter-test-helpers.js";

describe("emitter-defaults - header-safe defaults", () => {
  it("keeps class construction parameter defaults out of headers and materializes omitted calls", () => {
    const { hppCode, cppCode } = emitSplit(`
      export class Card {
        id: int
        label: string
      }

      export function value(card: Card = Card(7, "ace")): int => card.id

      export function run(): int {
        return value()
      }
    `);

    expect(hppCode).toContain("int32_t value(std::shared_ptr<::app::main_::Card> card);");
    expect(hppCode).not.toContain("value(std::shared_ptr<::app::main_::Card> card =");
    expect(cppCode).toContain('return value(std::make_shared<Card>(7, std::string("ace")));');
  });

  it("fills omitted class fields in contextual object-literal defaults at call sites", () => {
    const { hppCode, cppCode } = emitSplit(`
      export class CameraTuning {
        minPitch: float = 1.0f
        maxPitch: float = 2.0f
        minDepth: float = 3.0f
        maxDepth: float = 4.0f
      }

      export function maxDepth(tuning: CameraTuning = { minDepth: 30.0f }): float => tuning.maxDepth

      export function run(): float {
        return maxDepth()
      }
    `);

    expect(hppCode).toContain("float maxDepth(std::shared_ptr<::app::main_::CameraTuning> tuning);");
    expect(hppCode).not.toContain("maxDepth(std::shared_ptr<::app::main_::CameraTuning> tuning =");
    expect(cppCode).toContain("return maxDepth(std::make_shared<CameraTuning>(1.0f, 2.0f, 30.0f, 4.0f));");
  });

  it("keeps literal map defaults in headers", () => {
    const { hppCode, cppCode } = emitSplit(`
      export function lookup(values: Map<long, string> = { 1L: "one", 2L: "two" }): string {
        return values[1L]
      }
    `);

    expect(hppCode).toContain("std::shared_ptr<doof::ordered_map<int64_t, std::string>> values = std::make_shared<doof::ordered_map<int64_t, std::string>>");
    expect(hppCode).toContain('1LL, "one"');
    expect(hppCode).toContain('2LL, "two"');
    expect(cppCode).toContain("std::string lookup(std::shared_ptr<doof::ordered_map<int64_t, std::string>> values)");
    expect(cppCode).not.toContain("std::string lookup(std::shared_ptr<doof::ordered_map<int64_t, std::string>> values =");
  });
});

describe("emitter-defaults - static method defaults", () => {
  it("materializes named static method defaults with omitted method arguments", () => {
    const { hppCode, cppCode } = emitSplit(`
      export class Transform {
        x: int
        y: int

        static build(x: int, y: int = 9): Transform => Transform(x, y)
      }

      export function total(transform: Transform = Transform.build{ x: 4 }): int {
        return transform.x + transform.y
      }

      export function run(): int {
        return total()
      }
    `);

    expect(hppCode).toContain("int32_t total(std::shared_ptr<::app::main_::Transform> transform);");
    expect(hppCode).not.toContain("total(std::shared_ptr<::app::main_::Transform> transform =");
    expect(cppCode).toContain("return total(Transform::build(4, 9));");
  });
});

describe("emitter-defaults - source-derived expression emission", () => {
  it("emits primitive literal defaults with C++ spelling", () => {
    const defaults = functionDefaults(`
      function sample(
        i: int = 7,
        l: long = 8L,
        f: float = 1.5f,
        d: double = 2.25,
        s: string = "a\\n\\\"b",
        c: char = '\\n',
        flag: bool = false
      ): int => i
    `, "sample");

    expect(emitDefaultExpression(defaults.get("i")!)).toBe("7");
    expect(emitDefaultExpression(defaults.get("l")!)).toBe("8LL");
    expect(emitDefaultExpression(defaults.get("f")!)).toBe("1.5f");
    expect(emitDefaultExpression(defaults.get("d")!)).toBe("2.25");
    expect(emitDefaultExpression(defaults.get("s")!)).toBe('"a\\n\\\"b"');
    expect(emitDefaultExpression(defaults.get("c")!)).toBe("U'\\n'");
    expect(emitDefaultExpression(defaults.get("flag")!)).toBe("false");
  });

  it("emits null, @caller, local identifiers, and imported identifiers", () => {
    const programDefaults = functionDefaults({
      "/config.do": `export const DEFAULT_NAME = "Ada"`,
      "/main.do": `
        import { DEFAULT_NAME } from "./config"

        const LOCAL_NAME = "Grace"

        function sample(
          localName: string = LOCAL_NAME,
          importedName: string = DEFAULT_NAME,
          maybeName: string | null = null,
          source: SourceLocation = @caller
        ): string => localName
      `,
    }, "sample");

    expect(emitDefaultExpression(programDefaults.get("localName")!)).toBe("LOCAL_NAME");
    expect(emitDefaultExpression(programDefaults.get("importedName")!)).toBe("::app::config::DEFAULT_NAME");
    expect(emitDefaultExpression(
      programDefaults.get("maybeName")!,
      functionDefaultTypes({
        "/config.do": `export const DEFAULT_NAME = "Ada"`,
        "/main.do": `
          import { DEFAULT_NAME } from "./config"

          const LOCAL_NAME = "Grace"

          function sample(
            localName: string = LOCAL_NAME,
            importedName: string = DEFAULT_NAME,
            maybeName: string | null = null,
            source: SourceLocation = @caller
          ): string => localName
        `,
      }, "sample").get("maybeName"),
    )).toBe("std::nullopt");
    expect(emitDefaultExpression(programDefaults.get("source")!)).toBe(
      'std::make_shared<doof::SourceLocation>(std::string("<module>"), 0, std::string("<module>"))',
    );
  });

  it("emits enum defaults from qualified, shorthand, and member forms", () => {
    const defaults = functionDefaults(`
      enum Suit { Spades, Hearts, Clubs }

      function sample(
        qualified: Suit = Suit.Hearts,
        shorthand: Suit = .Clubs
      ): Suit => qualified
    `, "sample");
    const memberExpr = expressionFromBinding(`
      enum Suit { Spades, Hearts, Clubs }

      function sample(value: Suit = Suit.Hearts): Suit => value
    `, "used", `
      used: Suit := Suit.Spades
    `);

    expect(emitDefaultExpression(defaults.get("qualified")!, undefined, "/main.do")).toBe("Suit::Hearts");
    expect(emitDefaultExpression(defaults.get("shorthand")!, undefined, "/main.do")).toBe("Suit::Clubs");
    expect(emitDefaultExpression(memberExpr, undefined, "/main.do")).toBe("Suit::Spades");
  });

  it("emits array, set, tuple, and map defaults from checked source", () => {
    const defaults = functionDefaults(`
      function sample(
        ints: int[] = [1, 2],
        emptyInts: int[] = [],
        names: Set<string> = ["Ada", "Grace"],
        emptyNames: Set<string> = [],
        pair: Tuple<int, string> = (3, "three"),
        lookup: Map<long, string> = { 1L: "one" },
        emptyLookup: Map<string, int> = {}
      ): int => ints[0]
    `, "sample");

    expect(emitDefaultExpression(defaults.get("ints")!)).toBe("std::make_shared<std::vector<int32_t>>(std::vector<int32_t>{1, 2})");
    expect(emitDefaultExpression(defaults.get("emptyInts")!)).toBe("std::make_shared<std::vector<int32_t>>()");
    expect(emitDefaultExpression(defaults.get("names")!)).toBe('std::make_shared<doof::ordered_set<std::string>>(doof::ordered_set<std::string>{"Ada", "Grace"})');
    expect(emitDefaultExpression(defaults.get("emptyNames")!)).toBe("std::make_shared<doof::ordered_set<std::string>>()");
    expect(emitDefaultExpression(defaults.get("pair")!)).toBe('std::make_tuple(3, "three")');
    expect(emitDefaultExpression(defaults.get("lookup")!)).toBe('std::make_shared<doof::ordered_map<int64_t, std::string>>(doof::ordered_map<int64_t, std::string>{{\n1LL, "one"}})');
    expect(emitDefaultExpression(defaults.get("emptyLookup")!)).toBe("std::make_shared<doof::ordered_map<std::string, int32_t>>()");
  });

  it("emits class defaults from tuple, call, positional construct, named construct, and object literals", () => {
    const defaults = functionDefaults(`
      class Point {
        x: int
        y: int = 2
        label: string = "p"
      }

      function sample(
        tuplePoint: Point = (1, 8),
        callPoint: Point = Point(3),
        namedPoint: Point = Point { y: 5, x: 6 },
        objectPoint: Point = { x: 7 }
      ): int => tuplePoint.x
    `, "sample");

    expect(emitDefaultExpression(defaults.get("tuplePoint")!, undefined, "/main.do")).toBe('std::make_shared<Point>(1, 8, "p")');
    expect(emitDefaultExpression(defaults.get("callPoint")!, undefined, "/main.do")).toBe('std::make_shared<Point>(3, 2, "p")');
    expect(emitDefaultExpression(defaults.get("namedPoint")!, undefined, "/main.do")).toBe('std::make_shared<Point>(6, 5, "p")');
    expect(emitDefaultExpression(defaults.get("objectPoint")!, undefined, "/main.do")).toBe('std::make_shared<Point>(7, 2, "p")');
  });

  it("emits static class member and method defaults from checked source", () => {
    const defaults = functionDefaults(`
      class Transform {
        readonly x: int
        readonly y: int = 2
        static readonly zero = Transform(0)
        static identity(x: int = 1, y: int = 9): Transform => Transform(x, y)
      }

      function sample(
        member: Transform = .zero,
        dotCall: Transform = .identity(3),
        namedCall: Transform = Transform.identity{ y: 4 }
      ): int => member.x
    `, "sample");

    expect(emitDefaultExpression(defaults.get("member")!, undefined, "/main.do")).toBe("Transform::zero");
    expect(emitDefaultExpression(defaults.get("dotCall")!, undefined, "/main.do")).toBe("Transform::identity(3, 9)");
    expect(emitDefaultExpression(defaults.get("namedCall")!, undefined, "/main.do")).toBe("Transform::identity(1, 4)");
  });

  it("tracks header eligibility through nested defaults", () => {
    const defaults = functionDefaults(`
      class Point { x: int y: int = 2 }
      enum Suit { Spades, Hearts }

      function sample(
        numbers: int[] = [1, -2],
        point: Point = Point(1),
        tuplePoint: Point = (1, 2),
        tupleValue: Tuple<int, int> = (1, 2),
        suit: Suit = .Hearts
      ): int => numbers[0]
    `, "sample");

    expect(canEmitDefaultExpressionInHeader(defaults.get("numbers")!)).toBe(true);
    expect(canEmitDefaultExpressionInHeader(defaults.get("point")!)).toBe(false);
    expect(canEmitDefaultExpressionInHeader(defaults.get("tuplePoint")!)).toBe(false);
    expect(canEmitDefaultExpressionInHeader(defaults.get("tupleValue")!)).toBe(true);
    expect(canEmitDefaultExpressionInHeader(defaults.get("suit")!)).toBe(true);
  });
});

function functionDefaults(
  source: string | Record<string, string>,
  functionName: string,
): Map<string, Expression> {
  return new Map(functionDefaultParams(source, functionName).flatMap((param) =>
    param.defaultValue ? [[param.name, param.defaultValue] as const] : []
  ));
}

function functionDefaultTypes(
  source: string | Record<string, string>,
  functionName: string,
): Map<string, ResolvedType> {
  return new Map(functionDefaultParams(source, functionName).flatMap((param) =>
    param.defaultValue && param.resolvedType ? [[param.name, param.resolvedType] as const] : []
  ));
}

function functionDefaultParams(
  source: string | Record<string, string>,
  functionName: string,
) {
  const program = checkedProgram(source);
  const fn = topLevelStatements(program.statements)
    .find((stmt): stmt is FunctionDeclaration => stmt.kind === "function-declaration" && stmt.name === functionName);
  if (!fn) throw new Error(`Function not found: ${functionName}`);
  return fn.params;
}

function expressionFromBinding(
  prefixSource: string,
  bindingName: string,
  bindingSource: string,
): Expression {
  const program = checkedProgram(`${prefixSource}\nfunction probe(): void {\n${bindingSource}\n}`);
  for (const stmt of topLevelStatements(program.statements)) {
    if (stmt.kind !== "function-declaration" || stmt.name !== "probe" || stmt.body.kind !== "block") continue;
    for (const bodyStmt of stmt.body.statements) {
      if ((bodyStmt.kind === "immutable-binding" || bodyStmt.kind === "let-declaration") && bodyStmt.name === bindingName) {
        return bodyStmt.value;
      }
    }
  }
  throw new Error(`Binding not found: ${bindingName}`);
}

function checkedProgram(source: string | Record<string, string>) {
  const files = typeof source === "string" ? { "/main.do": source } : source;
  const result = check(files, "/main.do");
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((diagnostic) => diagnostic.message).join("; "));
  }
  return result.program;
}

function topLevelStatements(statements: Statement[]): Statement[] {
  return statements.map((stmt) => stmt.kind === "export-declaration" ? stmt.declaration : stmt);
}
