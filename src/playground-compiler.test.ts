import { describe, expect, it } from "vitest";
import { compileDoof } from "./playground-compiler.js";

describe("playground compiler", () => {
  it("compiles imports from a browser-provided stdlib", () => {
    const result = compileDoof(
      `import { add } from "std/math"

      function main() {
        println(add(2, 3))
      }`,
      {
        stdlibFiles: new Map([
          ["math/index.do", "export function add(a: int, b: int): int => a + b"],
        ]),
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain("add(2, 3)");
    expect(result.cpp).toContain('#include "__doof_stdlib__/std/math/index.hpp"');
  });

  it("emits entry-module C++ using the module emitter", () => {
    const result = compileDoof(`
      function main() {
        println("Hello world")
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain('#include "main.hpp"');
    expect(result.cpp).toContain("void doof_main()");
    expect(result.cpp).toContain("int main(int argc, char** argv)");
  });

  it("anchors parse diagnostics at the parser error location", () => {
    const result = compileDoof(`class Foo {
  readonly x: int[]
}

class Bar {
  readonly a: int
}

function test(a: readonly Foo[]) {
  println(a.length)
}

function main() {
  x := readonlt [1, 2]
  readonly f = Foo(x)
  readonly b = Bar(0)
  let a = readonly [Foo([1])]
  test(a)
  println("Hello world")
}`);

    expect(result.cpp).toBe("");
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      message: "Expected RightBracket but got Comma (',')",
      startLine: 13,
      startColumn: 18,
      endLine: 13,
      endColumn: 19,
    });
  });

  it("compiles shorthand Result.andThen() lambdas in an unannotated main", () => {
    const result = compileDoof(`
      function main() {
        println(int.parse("10").andThen(=> Success { value: it + 4 }))
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain("std::variant<doof::Success<int32_t>, doof::Failure<doof::ParseError>>");
    expect(result.cpp).not.toContain(", G>");
  });

  it("compiles shorthand Result.orElse() lambdas in an unannotated main", () => {
    const result = compileDoof(`
      function main() {
        println(int.parse("doof").orElse(=> Success { value: 0 }))
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain("std::variant<doof::Success<int32_t>, doof::Failure<doof::ParseError>>");
    expect(result.cpp).not.toContain(", U>");
  });

  it("compiles shorthand Result.orElse() failure lambdas in an unannotated main", () => {
    const result = compileDoof(`
      function main() {
        println(int.parse("doof").orElse(=> Failure { error: 0 }))
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain("std::variant<doof::Success<int32_t>, doof::Failure<int32_t>>");
    expect(result.cpp).not.toContain(", U>");
  });

  it("compiles postfix ! unwrap-or-panic on Result", () => {
    const result = compileDoof(`
      function main() {
        println(int.parse("12")! + 2)
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.cpp).toContain('doof::panic_at("main.do", 3, "! failed: " + doof::to_string(');
    expect(result.cpp).toContain("+ 2");
  });

  it("reports an error for postfix ! on non-nullable non-Result values", () => {
    const result = compileDoof(`
      function main() {
        s := "hello"
        println(s!)
      }
    `);

    expect(result.cpp).toBe("");
    expect(result.diagnostics.some((d) => d.message.includes('Postfix "!" can only be applied to a nullable or Result type'))).toBe(true);
  });
});
