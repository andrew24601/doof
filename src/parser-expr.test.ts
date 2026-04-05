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

function parseExprInInitializer(source: string): Expression {
  const program = parse(`const _value = ${source}`);
  const stmt = program.statements[0];
  if (stmt.kind === "const-declaration") return stmt.value;
  throw new Error(`Expected const declaration, got ${stmt.kind}`);
}

function firstStmt(source: string): Statement {
  return parse(source).statements[0];
}

// ==========================================================================
// Literals
// ==========================================================================

describe("Parser — literals", () => {
  it("parses integer literals", () => {
    const expr = parseExpr("42");
    expect(expr.kind).toBe("int-literal");
    if (expr.kind === "int-literal") {
      expect(expr.value).toBe(42);
    }
  });

  it("parses long literals", () => {
    const expr = parseExpr("42L");
    expect(expr.kind).toBe("long-literal");
    if (expr.kind === "long-literal") {
      expect(expr.value).toBe(42n);
    }
  });

  it("parses float literals", () => {
    const expr = parseExpr("3.14f");
    expect(expr.kind).toBe("float-literal");
    if (expr.kind === "float-literal") {
      expect(expr.value).toBeCloseTo(3.14);
    }
  });

  it("parses double literals", () => {
    const expr = parseExpr("3.14");
    expect(expr.kind).toBe("double-literal");
    if (expr.kind === "double-literal") {
      expect(expr.value).toBeCloseTo(3.14);
    }
  });

  it("parses string literals", () => {
    const expr = parseExpr('"hello"');
    expect(expr.kind).toBe("string-literal");
    if (expr.kind === "string-literal") {
      expect(expr.value).toBe("hello");
    }
  });

  it("parses double-quoted interpolation", () => {
    const expr = parseExpr('"Hello, ${name}!"');
    expect(expr.kind).toBe("string-literal");
    if (expr.kind === "string-literal") {
      expect(expr.parts).toHaveLength(3);
      expect(expr.parts[0]).toBe("Hello, ");
      expect(typeof expr.parts[1]).toBe("object");
      expect(expr.parts[2]).toBe("!");
    }
  });

  it("parses char literals", () => {
    const expr = parseExpr("'a'");
    expect(expr.kind).toBe("char-literal");
    if (expr.kind === "char-literal") {
      expect(expr.value).toBe("a");
    }
  });

  it("parses boolean literals", () => {
    expect(parseExpr("true")).toMatchObject({ kind: "bool-literal", value: true });
    expect(parseExpr("false")).toMatchObject({ kind: "bool-literal", value: false });
  });

  it("parses null literal", () => {
    expect(parseExpr("null")).toMatchObject({ kind: "null-literal" });
  });

  it("parses this", () => {
    expect(parseExpr("this")).toMatchObject({ kind: "this-expression" });
  });
});

// ==========================================================================
// Arithmetic
// ==========================================================================

describe("Parser — arithmetic expressions", () => {
  it("parses addition", () => {
    const expr = parseExpr("1 + 2");
    expect(expr.kind).toBe("binary-expression");
    if (expr.kind === "binary-expression") {
      expect(expr.operator).toBe("+");
      expect(expr.left).toMatchObject({ kind: "int-literal", value: 1 });
      expect(expr.right).toMatchObject({ kind: "int-literal", value: 2 });
    }
  });

  it("respects operator precedence", () => {
    const expr = parseExpr("1 + 2 * 3");
    expect(expr.kind).toBe("binary-expression");
    if (expr.kind === "binary-expression") {
      expect(expr.operator).toBe("+");
      expect(expr.right).toMatchObject({
        kind: "binary-expression",
        operator: "*",
      });
    }
  });

  it("parses exponentiation (right-to-left)", () => {
    const expr = parseExpr("2 ** 3 ** 4");
    expect(expr.kind).toBe("binary-expression");
    if (expr.kind === "binary-expression") {
      expect(expr.operator).toBe("**");
      expect(expr.right).toMatchObject({
        kind: "binary-expression",
        operator: "**",
      });
    }
  });

  it("parses unary negation", () => {
    const expr = parseExpr("-x");
    expect(expr.kind).toBe("unary-expression");
    if (expr.kind === "unary-expression") {
      expect(expr.operator).toBe("-");
      expect(expr.prefix).toBe(true);
      expect(expr.operand).toMatchObject({ kind: "identifier", name: "x" });
    }
  });

  it("parses logical not", () => {
    const expr = parseExpr("!flag");
    expect(expr).toMatchObject({
      kind: "unary-expression",
      operator: "!",
      prefix: true,
    });
  });
});

// ==========================================================================
// Comparisons & Logical
// ==========================================================================

describe("Parser — comparison and logical expressions", () => {
  it("parses equality", () => {
    const expr = parseExpr("a == b");
    expect(expr).toMatchObject({ kind: "binary-expression", operator: "==" });
  });

  it("parses logical and", () => {
    const expr = parseExpr("a && b");
    expect(expr).toMatchObject({ kind: "binary-expression", operator: "&&" });
  });

  it("parses logical or", () => {
    const expr = parseExpr("a || b");
    expect(expr).toMatchObject({ kind: "binary-expression", operator: "||" });
  });

  it("parses null coalescing", () => {
    const expr = parseExpr("a ?? b");
    expect(expr).toMatchObject({ kind: "binary-expression", operator: "??" });
  });
});

// ==========================================================================
// Member Access & Calls
// ==========================================================================

describe("Parser — member access and calls", () => {
  it("parses member access", () => {
    const expr = parseExpr("a.b");
    expect(expr).toMatchObject({
      kind: "member-expression",
      property: "b",
      optional: false,
      force: false,
    });
  });

  it("parses optional chaining", () => {
    const expr = parseExpr("a?.b");
    expect(expr).toMatchObject({
      kind: "member-expression",
      property: "b",
      optional: true,
    });
  });

  it("parses force access", () => {
    const expr = parseExpr("a!.b");
    expect(expr).toMatchObject({
      kind: "member-expression",
      property: "b",
      force: true,
    });
  });

  it("parses qualified static access", () => {
    const expr = parseExpr("rect::kind");
    expect(expr).toMatchObject({
      kind: "qualified-member-expression",
      property: "kind",
    });
  });

  it("parses function calls", () => {
    const expr = parseExpr("foo(1, 2)");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.callee).toMatchObject({ kind: "identifier", name: "foo" });
      expect(expr.args).toHaveLength(2);
    }
  });

  it("parses method calls", () => {
    const expr = parseExpr("obj.method(x)");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.callee).toMatchObject({
        kind: "member-expression",
        property: "method",
      });
    }
  });

  it("parses index access", () => {
    const expr = parseExpr("arr[0]");
    expect(expr).toMatchObject({
      kind: "index-expression",
      optional: false,
    });
  });

  it("parses optional index access", () => {
    const expr = parseExpr("arr?[0]");
    expect(expr).toMatchObject({
      kind: "index-expression",
      optional: true,
    });
  });

  it("parses chained member access", () => {
    const expr = parseExpr("a.b.c");
    expect(expr.kind).toBe("member-expression");
    if (expr.kind === "member-expression") {
      expect(expr.property).toBe("c");
      expect(expr.object).toMatchObject({
        kind: "member-expression",
        property: "b",
      });
    }
  });

  it("parses qualified access followed by call", () => {
    const expr = parseExpr("shape::doIt()");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.callee).toMatchObject({
        kind: "qualified-member-expression",
        property: "doIt",
      });
    }
  });
});

// ==========================================================================
// Array & Object Literals
// ==========================================================================

describe("Parser — collection literals", () => {
  it("parses array literal", () => {
    const expr = parseExpr("[1, 2, 3]");
    expect(expr.kind).toBe("array-literal");
    if (expr.kind === "array-literal") {
      expect(expr.elements).toHaveLength(3);
      expect(expr.readonly_).toBe(false);
    }
  });

  it("parses readonly array literal", () => {
    const stmt = firstStmt("x := readonly [1, 2, 3]");
    if (stmt.kind === "immutable-binding") {
      expect(stmt.value.kind).toBe("array-literal");
      if (stmt.value.kind === "array-literal") {
        expect(stmt.value.readonly_).toBe(true);
      }
    }
  });

  it("parses empty array", () => {
    const expr = parseExpr("[]");
    expect(expr).toMatchObject({ kind: "array-literal", elements: [] });
  });

  it("parses tuple literal", () => {
    const expr = parseExpr("(1, 2, 3)");
    expect(expr.kind).toBe("tuple-literal");
    if (expr.kind === "tuple-literal") {
      expect(expr.elements).toHaveLength(3);
    }
  });

  it("parses parenthesized expression", () => {
    const expr = parseExpr("(42)");
    expect(expr).toMatchObject({ kind: "int-literal", value: 42 });
  });
});

// ==========================================================================
// If Expression
// ==========================================================================

describe("Parser — if expression", () => {
  it("parses if-then-else expression", () => {
    const stmt = firstStmt("result := if x > 0 then x else -x");
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      const expr = stmt.value;
      expect(expr.kind).toBe("if-expression");
      if (expr.kind === "if-expression") {
        expect(expr.condition).toMatchObject({ kind: "binary-expression", operator: ">" });
        expect(expr.then).toMatchObject({ kind: "identifier", name: "x" });
      }
    }
  });
});

// ==========================================================================
// Case Expression
// ==========================================================================

describe("Parser — case expression", () => {
  it("parses basic case with values", () => {
    const expr = parseExprInInitializer(`case x {
      0 => "zero",
      1 => "one",
      _ => "other"
    }`);
    expect(expr.kind).toBe("case-expression");
    if (expr.kind === "case-expression") {
      expect(expr.arms).toHaveLength(3);
      expect(expr.arms[0].patterns[0]).toMatchObject({ kind: "value-pattern" });
      expect(expr.arms[2].patterns[0]).toMatchObject({ kind: "wildcard-pattern" });
    }
  });

  it("parses case with type patterns", () => {
    const expr = parseExprInInitializer(`case result {
      s: Success => s,
      f: Failure => f
    }`);
    expect(expr.kind).toBe("case-expression");
    if (expr.kind === "case-expression") {
      expect(expr.arms).toHaveLength(2);
      expect(expr.arms[0].patterns[0]).toMatchObject({
        kind: "type-pattern",
        name: "s",
      });
    }
  });

  it("parses case with range patterns", () => {
    const expr = parseExprInInitializer(`case age {
      ..<18 => "minor",
      18..64 => "adult",
      65.. => "senior"
    }`);
    expect(expr.kind).toBe("case-expression");
    if (expr.kind === "case-expression") {
      expect(expr.arms).toHaveLength(3);
      expect(expr.arms[0].patterns[0]).toMatchObject({
        kind: "range-pattern",
        start: null,
        inclusive: false,
      });
      expect(expr.arms[1].patterns[0]).toMatchObject({
        kind: "range-pattern",
        inclusive: true,
      });
      expect(expr.arms[2].patterns[0]).toMatchObject({
        kind: "range-pattern",
        end: null,
        inclusive: true,
      });
    }
  });

  it("parses case with dot shorthand", () => {
    const expr = parseExprInInitializer(`case dir {
      .North => "up",
      .South => "down"
    }`);
    expect(expr.kind).toBe("case-expression");
    if (expr.kind === "case-expression") {
      expect(expr.arms[0].patterns[0]).toMatchObject({
        kind: "value-pattern",
      });
      const val = expr.arms[0].patterns[0];
      if (val.kind === "value-pattern") {
        expect(val.value).toMatchObject({ kind: "dot-shorthand", name: "North" });
      }
    }
  });

  it("parses grouped patterns with | and block yields", () => {
    const expr = parseExprInInitializer(`case status {
      200 | 201 => "success",
      _ => {
        yield "other"
      },
    }`);
    expect(expr.kind).toBe("case-expression");
    if (expr.kind === "case-expression") {
      expect(expr.arms[0].patterns).toHaveLength(2);
      expect(expr.arms[1].body.kind).toBe("block");
      if (expr.arms[1].body.kind === "block") {
        expect(expr.arms[1].body.statements[0]).toMatchObject({ kind: "yield-statement" });
      }
    }
  });

  it("requires commas between case expression arms", () => {
    expect(() => parseExprInInitializer(`case x {
      0 => "zero"
      1 => "one"
    }`)).toThrow();
  });

  it("rejects comma-separated grouped patterns in case expressions", () => {
    expect(() => parseExprInInitializer(`case status {
      200, 201 => "success",
      _ => "other"
    }`)).toThrow();
  });
});

// ==========================================================================
// Lambda Expressions
// ==========================================================================

describe("Parser — lambda expressions", () => {
  it("parses typed lambda", () => {
    const expr = parseExpr("(x: int): int => x * 2");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params).toHaveLength(1);
      expect(expr.params[0].name).toBe("x");
      expect(expr.parameterless).toBe(false);
    }
  });

  it("parses any in lambda annotations", () => {
    const expr = parseExpr("(x: any): any => x");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params[0].type).toMatchObject({ kind: "named-type", name: "any" });
      expect(expr.returnType).toMatchObject({ kind: "named-type", name: "any" });
    }
  });

  it("parses untyped lambda", () => {
    const expr = parseExpr("(x) => x * 2");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params).toHaveLength(1);
      expect(expr.params[0].name).toBe("x");
      expect(expr.params[0].type).toBeNull();
    }
  });

  it("parses parameterless lambda", () => {
    const expr = parseExpr("=> x * 2");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params).toHaveLength(0);
      expect(expr.parameterless).toBe(true);
    }
  });

  it("parses zero-param lambda", () => {
    const expr = parseExpr("() => 42");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params).toHaveLength(0);
      expect(expr.parameterless).toBe(false);
    }
  });

  it("parses multi-param lambda", () => {
    const expr = parseExpr("(a: int, b: int) => a + b");
    expect(expr.kind).toBe("lambda-expression");
    if (expr.kind === "lambda-expression") {
      expect(expr.params).toHaveLength(2);
    }
  });
});

// ==========================================================================
// Trailing Lambdas
// ==========================================================================

describe("Parser — trailing lambdas", () => {
  it("parses trailing lambda after call", () => {
    const expr = parseExpr("items.map() { it * 2 }");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.args).toHaveLength(1);
      const lambda = expr.args[0].value;
      expect(lambda.kind).toBe("lambda-expression");
      if (lambda.kind === "lambda-expression") {
        expect(lambda.parameterless).toBe(true);
        expect(lambda.trailing).toBe(true);
        expect(lambda.body.kind).toBe("block");
      }
    }
  });

  it("does not allow chaining after trailing lambda", () => {
    // Chaining off a trailing lambda is forbidden — the trailing lambda
    // terminates the postfix chain, so `.filter()` starts a new statement.
    const expr = parseExpr("items.map() { it * 2 }");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.args).toHaveLength(1);
      const lambda = expr.args[0].value;
      expect(lambda.kind).toBe("lambda-expression");
      if (lambda.kind === "lambda-expression") {
        expect(lambda.trailing).toBe(true);
      }
      // Verify the callee is just `items.map`, not chained further
      expect(expr.callee.kind).toBe("member-expression");
      if (expr.callee.kind === "member-expression") {
        expect(expr.callee.property).toBe("map");
      }
    }
  });

  it("parses trailing lambda with existing positional args", () => {
    const expr = parseExpr("reduce(0) { acc + it }");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      expect(expr.args).toHaveLength(2);
      expect(expr.args[0].value.kind).toBe("int-literal");
      expect(expr.args[1].value.kind).toBe("lambda-expression");
      const lambda = expr.args[1].value;
      if (lambda.kind === "lambda-expression") {
        expect(lambda.trailing).toBe(true);
      }
    }
  });

  it("parses trailing lambda with multi-statement block", () => {
    const expr = parseExpr(`items.forEach() { print(it)\n process(it) }`);
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      const lambda = expr.args[0].value;
      if (lambda.kind === "lambda-expression" && lambda.body.kind === "block") {
        expect(lambda.body.statements).toHaveLength(2);
      }
    }
  });

  it("does not parse trailing lambda on non-call expression", () => {
    // Member access followed by block — not a trailing lambda
    // Since bare blocks are banned, this should throw a parse error
    expect(() => parseExpr("x.y\n{ }")).toThrow();
  });

  it("does not consume trailing lambda when brace is on next line", () => {
    // `{` on a new line is NOT consumed as a trailing lambda
    const program = parse(`
      function f(): void {
        const p = Point(10, 20)
        { x, y } := p
      }
    `);
    const fn = program.statements[0];
    if (fn.kind === "function-declaration" && fn.body.kind === "block") {
      expect(fn.body.statements).toHaveLength(2);
      expect(fn.body.statements[0].kind).toBe("const-declaration");
      expect(fn.body.statements[1].kind).toBe("named-destructuring");
    }
  });

  it("parses trailing lambda in binding RHS", () => {
    const stmt = firstStmt("doubled := items.map() { it * 2 }");
    expect(stmt.kind).toBe("immutable-binding");
    if (stmt.kind === "immutable-binding") {
      expect(stmt.name).toBe("doubled");
      const call = stmt.value;
      expect(call.kind).toBe("call-expression");
      if (call.kind === "call-expression") {
        expect(call.args).toHaveLength(1);
        const lambda = call.args[0].value;
        expect(lambda.kind).toBe("lambda-expression");
        if (lambda.kind === "lambda-expression") {
          expect(lambda.trailing).toBe(true);
        }
      }
    }
  });

  it("parses trailing lambda in assignment RHS", () => {
    const stmt = firstStmt("result = items.filter() { it > 0 }");
    expect(stmt.kind).toBe("expression-statement");
    if (stmt.kind === "expression-statement") {
      const assign = stmt.expression;
      expect(assign.kind).toBe("assignment-expression");
      if (assign.kind === "assignment-expression") {
        const call = assign.value;
        expect(call.kind).toBe("call-expression");
        if (call.kind === "call-expression") {
          expect(call.args).toHaveLength(1);
          const lambda = call.args[0].value;
          expect(lambda.kind).toBe("lambda-expression");
          if (lambda.kind === "lambda-expression") {
            expect(lambda.trailing).toBe(true);
          }
        }
      }
    }
  });

  it("regular lambdas have trailing: false", () => {
    const expr = parseExpr("items.map(=> it * 2)");
    expect(expr.kind).toBe("call-expression");
    if (expr.kind === "call-expression") {
      const lambda = expr.args[0].value;
      if (lambda.kind === "lambda-expression") {
        expect(lambda.trailing).toBe(false);
      }
    }
  });

  it("parses bare block as error", () => {
    expect(() => parse("{ x := 10 }")).toThrow(/bare block/i);
  });

  it("parses empty-brace construction", () => {
    const expr = parseExpr("Repo {}");
    expect(expr.kind).toBe("construct-expression");
  });
});

// ==========================================================================
// As expression (type narrowing)
// ==========================================================================

describe("Parser — as expression", () => {
  it("parses simple as expression", () => {
    const expr = parseExpr("x as string");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      expect(expr.expression.kind).toBe("identifier");
      expect(expr.targetType.kind).toBe("named-type");
      if (expr.targetType.kind === "named-type") {
        expect(expr.targetType.name).toBe("string");
      }
    }
  });

  it("parses as with array target type", () => {
    const expr = parseExpr("x as Foo[]");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      expect(expr.targetType.kind).toBe("array-type");
    }
  });

  it("binds looser than member access and calls", () => {
    const expr = parseExpr("obj.something().somethingElse() as Foo");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      // The left side should be the full call chain
      expect(expr.expression.kind).toBe("call-expression");
    }
  });

  it("binds tighter than null-coalescing", () => {
    const expr = parseExprInInitializer("x as string ?? fallback");
    expect(expr.kind).toBe("binary-expression");
    if (expr.kind === "binary-expression") {
      expect(expr.operator).toBe("??");
      expect(expr.left.kind).toBe("as-expression");
      expect(expr.right.kind).toBe("identifier");
    }
  });

  it("binds tighter than logical OR", () => {
    const expr = parseExpr("a || b as bool");
    // as binds tighter than ||, so this is a || (b as bool)
    expect(expr.kind).toBe("binary-expression");
    if (expr.kind === "binary-expression") {
      expect(expr.operator).toBe("||");
      expect(expr.right.kind).toBe("as-expression");
    }
  });

  it("chains left-to-right (a as T as U)", () => {
    const expr = parseExpr("x as string as int");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      expect(expr.expression.kind).toBe("as-expression");
      if (expr.expression.kind === "as-expression") {
        expect(expr.expression.expression.kind).toBe("identifier");
      }
    }
  });

  it("works with index expression on left", () => {
    const expr = parseExpr("arr[0] as string");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      expect(expr.expression.kind).toBe("index-expression");
    }
  });

  it("works with generic target type", () => {
    const expr = parseExpr("x as Map<string, int>");
    expect(expr.kind).toBe("as-expression");
    if (expr.kind === "as-expression") {
      expect(expr.targetType.kind).toBe("named-type");
      if (expr.targetType.kind === "named-type") {
        expect(expr.targetType.name).toBe("Map");
        expect(expr.targetType.typeArgs).toHaveLength(2);
      }
    }
  });
});
