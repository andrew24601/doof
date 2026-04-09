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
});