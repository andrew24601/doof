import { describe, expect, it } from "vitest";
import { compileDoof } from "./playground-compiler.js";

describe("playground compiler", () => {
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
});