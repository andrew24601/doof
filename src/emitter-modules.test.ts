/**
 * Emitter tests — modules: hpp/cpp split, non-exported symbols, main wrapper,
 * multi-module hpp includes, emitProject, function signature with defaults,
 * module init functions, namespace imports, extern class imports, concurrency.
 */

import { describe, it, expect } from "vitest";
import { emit, emitMulti, emitSplit, emitSplitMulti, emitProjectHelper } from "./emitter-test-helpers.js";

// ============================================================================
// Phase 7: Module Splitting (.hpp/.cpp)
// ============================================================================

describe("emitter-module — hpp/cpp split", () => {
  it("generates both hpp and cpp files", () => {
    const { hppCode, cppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(hppCode).toBeTruthy();
    expect(cppCode).toBeTruthy();
  });

  it("hpp has pragma once guard", () => {
    const { hppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(hppCode).toContain("#pragma once");
  });

  it("hpp has system includes", () => {
    const { hppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(hppCode).toContain("#include <cstdint>");
    expect(hppCode).toContain("#include <memory>");
    expect(hppCode).toContain("#include <string>");
  });

  it("hpp has function forward declaration", () => {
    const { hppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(hppCode).toContain("int32_t add(int32_t a, int32_t b);");
  });

  it("cpp includes own header", () => {
    const { cppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(cppCode).toContain('#include "main.hpp"');
  });

  it("cpp includes runtime header", () => {
    const { cppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(cppCode).toContain('#include "doof_runtime.hpp"');
  });

  it("cpp has function implementation", () => {
    const { cppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(cppCode).toContain("int32_t add(int32_t a, int32_t b)");
    expect(cppCode).toContain("return a + b");
  });

  it("always emits runtime JsonValue and stringification support", () => {
    const project = emitProjectHelper({
      "/main.do": `
        function main(): int {
          println("ok")
          return 0
        }
      `,
    }, "/main.do");

    expect(project.runtime).toContain("struct JsonValue");
    expect(project.runtime).toContain("append_stringified");
    expect(project.runtime).toContain("to_string(const JsonValue& value)");
    expect(project.runtime).not.toContain("struct Parser {");
    expect(project.runtime).not.toContain("struct JSON {");
  });

  it("emits macos-app support files", () => {
    const project = emitProjectHelper({
      "/main.do": `
        function main(): int {
          return 0
        }
      `,
    }, "/main.do", {
      outputBinaryName: "DoofSolitaire",
      buildTarget: {
        kind: "macos-app",
        config: {
          bundleId: "dev.doof.solitaire",
          displayName: "Doof Solitaire",
          version: "1.0",
          iconPath: "/app/app-icon.svg",
          resources: [{ fromPattern: "/app/images/*", destination: "images" }],
          category: "public.app-category.games",
          minimumSystemVersion: "11.0",
        },
      },
    });

    expect(project.supportFiles.map((file) => file.relativePath)).toEqual([
      "Info.plist",
      "generate-macos-icon.sh",
    ]);
    expect(project.supportFiles[0]?.content).toContain("dev.doof.solitaire");
    expect(project.supportFiles[1]?.content).toContain("qlmanage");
  });

  it("emits ios-app support files", () => {
    const project = emitProjectHelper({
      "/main.do": `
        function main(): int {
          return 0
        }
      `,
    }, "/main.do", {
      outputBinaryName: "DoofSolitaire",
      buildTarget: {
        kind: "ios-app",
        config: {
          bundleId: "dev.doof.solitaire",
          displayName: "Doof Solitaire",
          version: "1.0",
          iconPath: "/app/app-icon.svg",
          resources: [{ fromPattern: "/app/images/*", destination: "images" }],
          minimumDeploymentTarget: "16.0",
        },
      },
    });

    expect(project.supportFiles.map((file) => file.relativePath)).toEqual([
      "Assets.xcassets/AppIcon.appiconset/Contents.json",
      "Info.plist",
      "ios-main.mm",
    ]);
    expect(project.supportFiles[1]?.content).toContain("dev.doof.solitaire");
    expect(project.supportFiles[2]?.content).toContain("doof_entry_main");
  });

  it("hpp has struct definition for exported class", () => {
    const { hppCode } = emitSplit(`
      export class Point { x, y: float }
    `);
    expect(hppCode).toContain("struct Point");
    expect(hppCode).toContain("float x;");
    expect(hppCode).toContain("float y;");
  });

  it("hpp has interface variant alias", () => {
    const { hppCode } = emitSplit([
      `export class Circle {`,
      `  radius: float`,
      `  function area(): float => 3.14f * radius * radius`,
      `}`,
      `export interface Shape {`,
      `  area(): float`,
      `}`,
    ].join("\n"));
    expect(hppCode).toContain("using Shape = std::variant<std::shared_ptr<Circle>>;");
  });

  it("hpp has enum declaration", () => {
    const { hppCode } = emitSplit(`
      export enum Color { Red, Green, Blue }
    `);
    expect(hppCode).toContain("enum class Color");
    expect(hppCode).toContain("Red");
    expect(hppCode).toContain("Green");
    expect(hppCode).toContain("Blue");
  });

  it("hpp has type alias", () => {
    const { hppCode } = emitSplit(`
      export type ID = int
    `);
    expect(hppCode).toContain("using ID = int32_t;");
  });

  it("hpp has forward struct declarations before interface aliases", () => {
    const { hppCode } = emitSplit([
      `export class Circle {`,
      `  radius: float`,
      `  function area(): float => 3.14f * radius * radius`,
      `}`,
      `export class Rectangle {`,
      `  width, height: float`,
      `  function area(): float => width * height`,
      `}`,
      `export interface Shape {`,
      `  area(): float`,
      `}`,
    ].join("\n"));
    // Forward declarations should appear before the using alias
    const forwardPos = hppCode.indexOf("struct Circle;");
    const aliasPos = hppCode.indexOf("using Shape");
    expect(forwardPos).toBeGreaterThan(-1);
    expect(aliasPos).toBeGreaterThan(-1);
    expect(forwardPos).toBeLessThan(aliasPos);
  });

  it("throws when exported interface has no implementors", () => {
    expect(() => emitSplit(`
      export interface Shape {
        area(): float
      }
    `)).toThrow('Cannot emit interface "Shape" without implementing classes');
  });
});

describe("emitter-module — non-exported symbols", () => {
  it("puts non-exported functions in anonymous namespace", () => {
    const { cppCode } = emitSplit(`
      function helper(x: int): int => x * 2
      export function doubleIt(x: int): int => helper(x)
    `);
    expect(cppCode).toContain("namespace {");
    // Helper should be inside anonymous namespace
    const nsStart = cppCode.indexOf("namespace {");
    const nsEnd = cppCode.indexOf("} // anonymous namespace");
    const helperPos = cppCode.indexOf("int32_t helper(");
    expect(helperPos).toBeGreaterThan(nsStart);
    expect(helperPos).toBeLessThan(nsEnd);
  });

  it("exported functions are outside anonymous namespace", () => {
    const { cppCode } = emitSplit(`
      function helper(x: int): int => x * 2
      export function doubleIt(x: int): int => helper(x)
    `);
    const nsEnd = cppCode.indexOf("} // anonymous namespace");
    const doubleItPos = cppCode.lastIndexOf("int32_t doubleIt(");
    expect(doubleItPos).toBeGreaterThan(nsEnd);
  });

  it("non-exported variables in anonymous namespace", () => {
    const { cppCode } = emitSplit(`
      x := 42
      export function getX(): int => x
    `);
    expect(cppCode).toContain("namespace {");
    const nsStart = cppCode.indexOf("namespace {");
    const nsEnd = cppCode.indexOf("} // anonymous namespace");
    const varPos = cppCode.indexOf("const auto x =");
    expect(varPos).toBeGreaterThan(nsStart);
    expect(varPos).toBeLessThan(nsEnd);
  });
});

describe("emitter-module — mock call storage", () => {
  it("emits shared call storage and panic for non-exported bodyless mock functions", () => {
    const { hppCode, cppCode } = emitSplit(`
      mock function sendPayment(targetId: string, amount: int): bool

      function main(): int {
        sendPayment("acct-1", 7)
        return sendPayment.calls.length
      }
    `);

    expect(hppCode).toContain("struct __main_sendPayment_Call");
    expect(cppCode).toContain("std::shared_ptr<std::vector<__main_sendPayment_Call>> __main_sendPayment_calls = std::make_shared<std::vector<__main_sendPayment_Call>>();");
    expect(cppCode).toContain("__main_sendPayment_calls->push_back(__main_sendPayment_Call{targetId, amount});");
    expect(cppCode).toContain('doof::panic("Unexpected mock function invoked: sendPayment")');
    expect(cppCode).toContain("return (int32_t)__main_sendPayment_calls->size()");
  });

  it("emits extern shared storage for exported mock functions", () => {
    const result = emitProjectHelper(
      {
        "/main.do": `
          import { sendPayment } from "./payments"

          function main(): int {
            sendPayment("acct-1", 7)
            return sendPayment.calls.length
          }
        `,
        "/payments.do": `
          export mock function sendPayment(targetId: string, amount: int): bool => true
        `,
      },
      "/main.do",
    );

    const paymentsModule = result.modules.find((module) => module.modulePath === "/payments.do");
    const mainModule = result.modules.find((module) => module.modulePath === "/main.do");
    expect(paymentsModule?.hppCode).toContain("extern std::shared_ptr<std::vector<__payments_sendPayment_Call>> __payments_sendPayment_calls;");
    expect(paymentsModule?.cppCode).toContain("std::shared_ptr<std::vector<__payments_sendPayment_Call>> __payments_sendPayment_calls = std::make_shared<std::vector<__payments_sendPayment_Call>>();");
    expect(mainModule?.cppCode).toContain("return (int32_t)__payments_sendPayment_calls->size()");
  });

  it("emits per-instance shared storage for mock methods", () => {
    const { hppCode, cppCode } = emitSplit(`
      mock class PaymentGateway {
        sendPayment(targetId: string, amount: int): bool => true
      }

      function main(): int {
        let gateway = PaymentGateway()
        gateway.sendPayment("acct-1", 7)
        return gateway.sendPayment.calls[0].amount
      }
    `);

    expect(hppCode).toContain("std::shared_ptr<std::vector<__PaymentGateway_sendPayment_Call>> __sendPayment_calls = std::make_shared<std::vector<__PaymentGateway_sendPayment_Call>>();");
    expect(hppCode).toContain("this->__sendPayment_calls->push_back(__PaymentGateway_sendPayment_Call{targetId, amount});");
    expect(cppCode).toContain('return doof::array_at(gateway->__sendPayment_calls, 0, "main.do",');
  });
});

describe("emitter-module — main wrapper", () => {
  it("wraps main as doof_main with C++ main()", () => {
    const { cppCode } = emitSplit(`
      function main(): int {
        return 0
      }
    `);
    expect(cppCode).toContain("doof_main()");
    expect(cppCode).toContain("doof_entry_main");
    expect(cppCode).toContain("int main(int argc, char** argv)");
  });

  it("main wrapper returns doof_main result", () => {
    const { cppCode } = emitSplit(`
      function main(): int {
        return 42
      }
    `);
    expect(cppCode).toContain("return static_cast<int>(doof_main())");
  });

  it("main is not in hpp forward declarations", () => {
    const { hppCode } = emitSplit(`
      function main(): int {
        return 0
      }
    `);
    // main should not appear as a forward declaration
    expect(hppCode).not.toContain("int32_t main(");
  });

  it("emits an exported app entry wrapper for ios-app without native main()", () => {
    const project = emitProjectHelper({
      "/main.do": `
        function helper(): int => 7

        function main(): int {
          return helper()
        }
      `,
    }, "/main.do", {
      buildTarget: {
        kind: "ios-app",
        config: {
          bundleId: "dev.doof.demo",
          displayName: "Doof Demo",
          version: "1.0",
          iconPath: "/app/app-icon.svg",
          resources: [],
          minimumDeploymentTarget: "16.0",
        },
      },
    });

    const cppCode = project.modules[0]?.cppCode ?? "";
    expect(cppCode).toContain("doof_main()");
    expect(cppCode).toContain("extern \"C\" int doof_entry_main(int argc, char** argv)");
    expect(cppCode).toContain("return static_cast<int>(doof_main())");
    expect(cppCode).not.toContain("int main(int argc, char** argv)");
  });
});

describe("emitter-module — multi-module hpp includes", () => {
  it("hpp includes imported module headers", () => {
    const { hppCode } = emitSplitMulti(
      {
        "/main.do": `
          import { add } from "./math"
          export function double_(x: int): int => add(x, x)
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(hppCode).toContain('#include "math.hpp"');
  });
});

describe("emitter-module — emitProject", () => {
  it("produces modules, runtime, and no support files by default", () => {
    const result = emitProjectHelper(
      {
        "/main.do": `
          function main(): int => 0
        `,
      },
      "/main.do",
    );
    expect(result.modules).toHaveLength(1);
    expect(result.runtime).toContain("doof_runtime.hpp");
    expect(result.supportFiles).toEqual([]);
  });

  it("anchors imported sibling modules under the output directory", () => {
    const result = emitProjectHelper(
      {
        "/workspace/app/main.do": [
          `import { add } from "../shared/math"`,
          `function main(): int => add(1, 2)`,
        ].join("\n"),
        "/workspace/shared/math.do": `export function add(a: int, b: int): int => a + b`,
      },
      "/workspace/app/main.do",
    );

    expect(result.modules.map((mod) => mod.hppPath).sort()).toEqual([
      "main.hpp",
      "shared/math.hpp",
    ]);
    expect(result.modules.map((mod) => mod.cppPath).sort()).toEqual([
      "main.cpp",
      "shared/math.cpp",
    ]);

    const mainModule = result.modules.find((mod) => mod.modulePath === "/workspace/app/main.do");
    expect(mainModule?.hppCode).toContain('#include "shared/math.hpp"');
  });

  it("emits remote package modules under .packages output roots", () => {
    const result = emitProjectHelper(
      {
        "/workspace/app/main.do": [
          'import { readText } from "../.cache/packages/andrew24601/doof-fs/5497e5306fcb80d3a0014ca41cfb236096c3583f/index"',
          "function main(): int => 0",
        ].join("\n"),
        "/workspace/.cache/packages/andrew24601/doof-fs/5497e5306fcb80d3a0014ca41cfb236096c3583f/index.do": [
          'export { readText } from "./runtime"',
        ].join("\n"),
        "/workspace/.cache/packages/andrew24601/doof-fs/5497e5306fcb80d3a0014ca41cfb236096c3583f/runtime.do": [
          'export function readText(path: string): string => path',
        ].join("\n"),
      },
      "/workspace/app/main.do",
      {
        packageOutputPaths: {
          byRootDir: new Map([
            ["/workspace/app", ""],
            ["/workspace/.cache/packages/andrew24601/doof-fs/5497e5306fcb80d3a0014ca41cfb236096c3583f", ".packages/andrew24601/doof-fs"],
          ]),
        },
      },
    );

    expect(result.modules.map((mod) => mod.hppPath).sort()).toEqual([
      ".packages/andrew24601/doof-fs/index.hpp",
      ".packages/andrew24601/doof-fs/runtime.hpp",
      "main.hpp",
    ]);
    const mainModule = result.modules.find((mod) => mod.modulePath === "/workspace/app/main.do");
    expect(mainModule?.hppCode).toContain('#include ".packages/andrew24601/doof-fs/index.hpp"');
  });

  it("emits package extern headers as direct sibling includes", () => {
    const result = emitProjectHelper(
      {
        "/workspace/app/main.do": [
          `import { readText } from "../deps/fs/runtime"`,
          `function main(): int => 0`,
        ].join("\n"),
        "/workspace/deps/fs/runtime.do": [
          `import { IoError } from "./types"`,
          `export import function readText(path: string): Result<string, IoError> from "native_fs.hpp" as doof_fs::readText`,
        ].join("\n"),
        "/workspace/deps/fs/types.do": `export enum IoError { Other }`,
      },
      "/workspace/app/main.do",
      {
      },
    );

    const runtimeModule = result.modules.find((mod) => mod.modulePath === "/workspace/deps/fs/runtime.do");
    expect(runtimeModule?.hppCode).toContain('#include "native_fs.hpp"');
    expect(result.supportFiles).toEqual([]);
  });

  it("includes re-exported module headers in barrel modules", () => {
    const result = emitProjectHelper(
      {
        "/workspace/app/main.do": [
          `import { readText, IoError } from "../deps/fs"`,
          `function main(): int => 0`,
        ].join("\n"),
        "/workspace/deps/fs/index.do": [
          `export { readText } from "./runtime"`,
          `export { IoError } from "./types"`,
        ].join("\n"),
        "/workspace/deps/fs/runtime.do": [
          `import { IoError } from "./types"`,
          `export import function readText(path: string): Result<string, IoError> from "native_fs.hpp" as doof_fs::readText`,
        ].join("\n"),
        "/workspace/deps/fs/types.do": `export enum IoError { Other }`,
      },
      "/workspace/app/main.do",
      {
      },
    );

    const indexModule = result.modules.find((mod) => mod.modulePath === "/workspace/deps/fs/index.do");
    expect(indexModule?.hppCode).toContain('#include "deps/fs/runtime.hpp"');
    expect(indexModule?.hppCode).toContain('#include "deps/fs/types.hpp"');
  });

  it("hpp omits external JSON includes when no JSON is used", () => {
    const { hppCode } = emitSplit(`
      export class Point { x: int; y: int }
    `);
    expect(hppCode).toContain('#include "doof_runtime.hpp"');
  });

  it("hpp relies on doof runtime when JSON is used", () => {
    const { hppCode } = emitSplit(`
      export class Point { x: int; y: int }
      function test(p: Point): JsonValue => p.toJsonValue()
    `);
    expect(hppCode).toContain('#include "doof_runtime.hpp"');
  });
});

describe("emitter-module — function signature with defaults", () => {
  it("emits default parameter in hpp forward declaration", () => {
    const { hppCode } = emitSplit(`
      export function greet(name: string, greeting: string = "hello"): string => greeting
    `);
    expect(hppCode).toContain('std::string greet(std::string name, std::string greeting = "hello");');
  });

  it("omits default parameter in cpp definition", () => {
    const { cppCode } = emitSplit(`
      export function greet(name: string, greeting: string = "hello"): string => greeting
    `);
    expect(cppCode).toContain("std::string greet(std::string name, std::string greeting)");
    expect(cppCode).not.toContain('std::string greet(std::string name, std::string greeting = "hello")');
  });

  it("emits array default parameter in hpp forward declaration", () => {
    const { hppCode } = emitSplit(`
      export function first(values: int[] = [1, 2, 3]): int => values[0]
    `);
    expect(hppCode).toContain("std::shared_ptr<std::vector<int32_t>> values = std::make_shared<std::vector<int32_t>>(std::vector<int32_t>{1, 2, 3})");
  });

  it("emits Set default parameter in hpp forward declaration", () => {
    const { hppCode } = emitSplit(`
      export function dedupe(values: Set<int> = []): Set<int> => values
    `);
    expect(hppCode).toContain("std::shared_ptr<doof::ordered_set<int32_t>> values = std::make_shared<doof::ordered_set<int32_t>>()");
  });
});

describe("emitter-module — module init functions", () => {
  it("emits init function declaration in hpp for module with readonly globals", () => {
    const { hppCode } = emitSplit(`
      export readonly PI: float = 3.14159f
      export function area(r: float): float => PI * r * r
    `);
    expect(hppCode).toContain("void _init_main();");
  });

  it("does not emit init function for module without readonly globals", () => {
    const { hppCode } = emitSplit(`
      export function add(a: int, b: int): int => a + b
    `);
    expect(hppCode).not.toContain("_init_");
  });

  it("emits init function body in cpp with guard", () => {
    const { cppCode } = emitSplit(`
      export readonly PI: float = 3.14159f
      export function area(r: float): float => PI * r * r
    `);
    expect(cppCode).toContain("void _init_main()");
    expect(cppCode).toContain("static bool _initialized = false");
    expect(cppCode).toContain("if (_initialized) return");
    expect(cppCode).toContain("_initialized = true");
  });

  it("emits dependency init calls in init function", () => {
    const result = emitProjectHelper(
      {
        "/main.do": `
          import { PI } from "./constants"
          function main(): int => 0
        `,
        "/constants.do": `
          export readonly PI: float = 3.14159f
        `,
      },
      "/main.do",
    );
    // Main module calls _init_constants in its main()
    const mainMod = result.modules.find(m => m.modulePath === "/main.do")!;
    expect(mainMod.cppCode).toContain("_init_constants()");
  });

  it("init function initializes readonly globals", () => {
    const { cppCode } = emitSplit(`
      export readonly PI: float = 3.14159f
      export function area(r: float): float => PI * r * r
    `);
    expect(cppCode).toContain("void _init_main()");
    expect(cppCode).toContain("PI");
  });
});

// ============================================================================
// Namespace-qualified imports
// ============================================================================

describe("emitter — namespace imports", () => {
  it("emits renamed imported function calls using the source symbol name", () => {
    const cpp = emitMulti(
      {
        "/main.do": `
          import { add as sum } from "./math"
          function main(): void {
            sum(1, 2)
          }
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(cpp).toContain("add(1, 2)");
    expect(cpp).not.toContain("sum(1, 2)");
  });

  it("emits namespace function call as direct call", () => {
    const cpp = emitMulti(
      {
        "/main.do": `
          import * as math from "./math"
          function main(): void {
            math.add(1, 2)
          }
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    // Since symbols are at global scope, namespace prefix is stripped
    expect(cpp).toContain("add(1, 2)");
    expect(cpp).not.toContain("math.add");
    expect(cpp).not.toContain("math->add");
  });

  it("emits namespace constant access as direct identifier", () => {
    const cpp = emitMulti(
      {
        "/main.do": `
          import * as constants from "./constants"
          function main(): void {
            println(constants.PI)
          }
        `,
        "/constants.do": `
          export const PI = 3
        `,
      },
      "/main.do",
    );
    // PI is accessed directly (no namespace prefix)
    expect(cpp).toContain("PI");
    expect(cpp).not.toContain("constants.PI");
    expect(cpp).not.toContain("constants->PI");
  });

  it("includes namespace-imported module header in module split", () => {
    const { hppCode } = emitSplitMulti(
      {
        "/main.do": `
          import * as math from "./math"
          export function double_(x: int): int => math.add(x, x)
        `,
        "/math.do": `
          export function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );
    expect(hppCode).toContain('#include "math.hpp"');
  });

  it("wraps main(args) using the Doof array representation", () => {
    const { cppCode } = emitSplit(`
      function main(args: string[]): int {
        return args.length
      }
    `);
    expect(cppCode).toContain("auto args = std::make_shared<std::vector<std::string>>(argv, argv + argc);");
    expect(cppCode).toContain("return static_cast<int>(doof_main(args));");
  });
});

// ============================================================================
// Extern C++ class imports
// ============================================================================

describe("emitter — extern class imports", () => {
  it("emits #include with inferred header path", () => {
    const cpp = emit(`
      import class Logger {
        log(message: string): void
      }
    `);
    expect(cpp).toContain('#include "Logger.hpp"');
  });

  it("emits #include with explicit header path", () => {
    const cpp = emit(`
      import class HttpClient from "./vendor/http.hpp" {
        get(url: string): string
      }
    `);
    expect(cpp).toContain('#include "./vendor/http.hpp"');
  });

  it("emits angle-bracket include for system headers", () => {
    const cpp = emit(`
      import class Client from "<httplib.h>" as httplib::Client {
        get(path: string): string
      }
    `);
    expect(cpp).toContain('#include <httplib.h>');
  });

  it("does not emit struct definition for extern class", () => {
    const cpp = emit(`
      import class Logger {
        log(message: string): void
      }
    `);
    expect(cpp).not.toContain("struct Logger");
  });

  it("does not emit struct for extern class in module split hpp", () => {
    const { hppCode } = emitSplit(`
      import class Logger {
        log(message: string): void
      }
      export function greet(): void {
        println("hello")
      }
    `);
    expect(hppCode).toContain('#include "Logger.hpp"');
    expect(hppCode).not.toContain("struct Logger");
  });

  it("emits extern include in module split hpp", () => {
    const { hppCode } = emitSplit(`
      import class HttpClient from "./vendor/http.hpp" {
        get(url: string): string
      }
      export function fetch(): void {
        println("fetching")
      }
    `);
    expect(hppCode).toContain('#include "./vendor/http.hpp"');
  });

  it("uses cppName in shared_ptr type for namespaced extern class", () => {
    const cpp = emit(`
      import class Client from "<httplib.h>" as httplib::Client {
        get(path: string): string
      }
      function test(c: Client): void {
        c.get("/api")
      }
    `);
    expect(cpp).toContain("std::shared_ptr<httplib::Client>");
  });

  it("emits static extern class method call as C++ scope access", () => {
    const cpp = emit(`
      import class MathBridge from "math_bridge.hpp" as native::MathBridge {
        static cos(x: float): float
      }
      function test(x: float): float {
        return MathBridge.cos(x)
      }
    `);
    expect(cpp).toContain("return native::MathBridge::cos(x);");
  });

  it("emits extern class direct construction through static create", () => {
    const cpp = emit(`
      import class BlobReader from "blob.hpp" as native::BlobReader {
        static create(data: readonly byte[], endianness: int = 0): BlobReader
        length(): long
      }

      function make(payload: readonly byte[]): BlobReader {
        return BlobReader(payload)
      }

      function makeNamed(payload: readonly byte[]): BlobReader {
        return BlobReader { data: payload, endianness: 1 }
      }
    `);
    expect(cpp).toContain("return native::BlobReader::create(payload, 0);");
    expect(cpp).toContain("return native::BlobReader::create(payload, 1);");
  });

  it("emits #include for exported extern class", () => {
    const cpp = emit(`
      export import class Mat4 from "matrix_bridge.hpp" as ns::Mat4 {
        static perspective(fov: float, aspect: float): Mat4
        projectX(x: float, y: float, z: float): float
      }
    `);
    expect(cpp).toContain('#include "matrix_bridge.hpp"');
    expect(cpp).not.toContain("struct Mat4");
  });

  it("emits #include for exported extern class in module split hpp", () => {
    const { hppCode } = emitSplit(`
      export import class Mat4 from "matrix_bridge.hpp" as ns::Mat4 {
        static multiply(a: Mat4, b: Mat4): Mat4
      }
      export function test(a: Mat4, b: Mat4): Mat4 {
        return Mat4.multiply(a, b)
      }
    `);
    expect(hppCode).toContain('#include "matrix_bridge.hpp"');
    expect(hppCode).not.toContain("struct Mat4");
  });
});

// ============================================================================
// Imported function imports
// ============================================================================

describe("emitter — import function imports", () => {
  it("emits #include for import function with system header", () => {
    const cpp = emit(`
      import function cos(x: float): float from "<cmath>" as std::cos
      function test(x: float): float => cos(x)
    `);
    expect(cpp).toContain("#include <cmath>");
  });

  it("emits #include for import function with quoted header", () => {
    const cpp = emit(`
      import function helper(): int from "mylib.hpp"
      function test(): int => helper()
    `);
    expect(cpp).toContain('#include "mylib.hpp"');
  });

  it("uses cppName in call for namespaced import function", () => {
    const cpp = emit(`
      import function cos(x: float): float from "<cmath>" as std::cos
      function test(x: float): float => cos(x)
    `);
    expect(cpp).toContain("std::cos(x)");
    expect(cpp).not.toMatch(/[^:]cos\(x\)/);
  });

  it("uses original name when no cppName is specified", () => {
    const cpp = emit(`
      import function myHelper(n: int): int from "helpers.hpp"
      function test(): int => myHelper(42)
    `);
    expect(cpp).toContain("myHelper(42)");
  });

  it("does not emit a function body for import function", () => {
    const cpp = emit(`
      import function cos(x: float): float from "<cmath>" as std::cos
    `);
    expect(cpp).not.toContain("float cos(");
  });

  it("deduplicates includes from same header", () => {
    const cpp = emit(`
      import function foo(x: int): int from "<mymath.h>"
      import function bar(x: int): int from "<mymath.h>"
      function test(x: int): int => foo(x) + bar(x)
    `);
    const matches = cpp.match(/#include <mymath\.h>/g);
    expect(matches).toHaveLength(1);
  });

  it("emits import function include in module split hpp", () => {
    const { hppCode } = emitSplit(`
      import function cos(x: float): float from "<cmath>" as std::cos
      export function doMath(x: float): float => cos(x)
    `);
    expect(hppCode).toContain("#include <cmath>");
  });

  it("resolves cppName for imported import function", () => {
    const cpp = emitMulti(
      {
        "/math.do": `export import function sin(x: float): float from "<cmath>" as std::sin`,
        "/main.do": `
          import { sin } from "./math"
          function test(x: float): float => sin(x)
        `,
      },
      "/main.do",
    );
    expect(cpp).toContain("std::sin(x)");
  });
});

// ============================================================================
// Concurrency
// ============================================================================

describe("Concurrency", () => {
  it("emits Actor creation as make_shared", () => {
    const cpp = emit(`
      class Counter { count: int }
      const a = Actor<Counter>(0)
    `);
    expect(cpp).toContain("std::make_shared<doof::Actor<Counter>>(0)");
  });

  it("emits Actor type annotation as shared_ptr<doof::Actor<T>>", () => {
    const cpp = emit(`
      class Worker { value: int }
      function start(): Actor<Worker> {
        return Actor<Worker>(0)
      }
    `);
    expect(cpp).toContain("std::shared_ptr<doof::Actor<Worker>>");
  });

  it("emits async function call as doof::async_call", () => {
    const cpp = emit(`
      function compute(): int { return 42 }
      const p = async compute()
    `);
    expect(cpp).toContain("doof::async_call(");
    expect(cpp).toContain("compute()");
  });

  it("emits async block as doof::async_call with lambda", () => {
    const cpp = emit(`
      const p = async { 42 }
    `);
    expect(cpp).toContain("doof::async_call([=]()");
  });

  it("emits Promise<T> type annotation", () => {
    const cpp = emit(`
      function compute(): int { return 42 }
      function start(): Promise<int> {
        return async compute()
      }
    `);
    expect(cpp).toContain("doof::Promise<int32_t>");
  });

  it("emits actor sync method call via call_sync", () => {
    const cpp = emit(`
      class Counter {
        count: int
        increment(): void { }
      }
      function main(): void {
        const a = Actor<Counter>(0)
        a.increment()
      }
    `);
    expect(cpp).toContain("call_sync");
    expect(cpp).toContain("Counter& _self");
    expect(cpp).toContain("_self.increment()");
  });

  it("emits actor.stop() directly", () => {
    const cpp = emit(`
      class Worker { value: int }
      function main(): void {
        const w = Actor<Worker>(0)
        w.stop()
      }
    `);
    expect(cpp).toContain("->stop()");
  });

  it("emits async actor method call via call_async", () => {
    const cpp = emit(`
      class Calculator {
        value: int
        compute(): int { return 42 }
      }
      const c = Actor<Calculator>(0)
      const p = async c.compute()
    `);
    expect(cpp).toContain("call_async");
    expect(cpp).toContain("Calculator& _self");
  });

  it("emits isolated function without special C++ modifier", () => {
    const cpp = emit(`
      isolated function compute(x: int): int {
        return x * 2
      }
    `);
    // Isolated is a Doof concept — same C++ output as regular function
    expect(cpp).toContain("int32_t compute(int32_t x)");
  });

  it("emits isolated method in class without special C++ modifier", () => {
    const cpp = emit(`
      class Worker {
        value: int
        isolated function process(x: int): int {
          return x * 2
        }
      }
    `);
    // Isolated method emits as a regular method — no C++ equivalent
    expect(cpp).toContain("int32_t process(int32_t x) {");
  });

  it("emits mutating method without const qualifier", () => {
    const cpp = emit(`
      class Counter {
        value: int
        increment(): void {
          this.value = this.value + 1
        }
      }
    `);
    // Methods should NOT have const qualifier — mutating methods need to modify fields
    expect(cpp).toContain("void increment() {");
    // The increment() method itself should not be const (toJsonValue is const, which is fine)
    expect(cpp).not.toContain("void increment() const {");
  });
});
