/**
 * End-to-end C++ compilation tests (part 3).
 *
 * Covers: module splitting (.hpp/.cpp), extern class imports, namespace imports.
 */

import { describe as vitestDescribe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

// ============================================================================
// Tests: Module splitting (.hpp/.cpp)
// ============================================================================

describe("e2e — module splitting", () => {
  it("compiles a single module split into .hpp/.cpp", () => {
    const { success, error, codes } = ctx.compileOnlyProject(
      {
        "/main.do": `
          function main(): int {
            return 42
          }
        `,
      },
      "/main.do",
    );
    expect(success, `Compile error: ${error}\n${codes}`).toBe(true);
  });

  it("runs a single module split with exit code", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": `
          function main(): int {
            return 42
          }
        `,
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("runs a single module split with println output", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": `
          function main(): int {
            println("hello from split")
            return 0
          }
        `,
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello from split");
  });

  it("compiles multi-module with imported function", () => {
    const { success, error, codes } = ctx.compileOnlyProject(
      {
        "/main.do": [
          `import { add } from "./math"`,
          `function main(): int => add(20, 22)`,
        ].join("\n"),
        "/math.do": [
          `export function add(a: int, b: int): int => a + b`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(success, `Compile error: ${error}\n${codes}`).toBe(true);
  });

  it("runs multi-module with imported function", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { add } from "./math"`,
          `function main(): int => add(20, 22)`,
        ].join("\n"),
        "/math.do": [
          `export function add(a: int, b: int): int => a + b`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("runs multi-module with imported class", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { Point } from "./geom"`,
          `function main(): int {`,
          `  p := Point(10, 32)`,
          `  return p.x + p.y`,
          `}`,
        ].join("\n"),
        "/geom.do": [
          `export class Point {`,
          `  x, y: int`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("compiles multi-module with exported class and method", () => {
    const { success, error, codes } = ctx.compileOnlyProject(
      {
        "/main.do": [
          `import { Counter } from "./counter"`,
          `function main(): int {`,
          `  c := Counter(0)`,
          `  return c.value`,
          `}`,
        ].join("\n"),
        "/counter.do": [
          `export class Counter {`,
          `  value: int`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    expect(success, `Compile error: ${error}\n${codes}`).toBe(true);
  });

  it("non-exported function stays internal to module", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { doubleIt } from "./helpers"`,
          `function main(): int => doubleIt(21)`,
        ].join("\n"),
        "/helpers.do": [
          `function helper(x: int): int => x * 2`,
          `export function doubleIt(x: int): int => helper(x)`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(42);
  });

  it("runs multi-module with imported enum", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { Color } from "./colors"`,
          `function main(): int {`,
          `  c := Color.Green`,
          `  return 0`,
          `}`,
        ].join("\n"),
        "/colors.do": [
          `export enum Color { Red, Green, Blue }`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });

  it("runs multi-module with println across modules", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { greet } from "./greeter"`,
          `function main(): int {`,
          `  greet("world")`,
          `  return 0`,
          `}`,
        ].join("\n"),
        "/greeter.do": [
          `export function greet(name: string): void {`,
          `  println("hello " + name)`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
  });

  it("runs imported exported function with default parameter", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { greet } from "./greeter"`,
          `function main(): int {`,
          `  println(greet("world"))`,
          `  return 0`,
          `}`,
        ].join("\n"),
        "/greeter.do": [
          `export function greet(name: string, greeting: string = "hello"): string {`,
          `  return greeting + " " + name`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
  });

  it("runs imported exported function with named arguments", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import { clamp } from "./math"`,
          `function main(): int {`,
          `  return clamp{ min: 0, max: 100, value: 150 }`,
          `}`,
        ].join("\n"),
        "/math.do": [
          `export function clamp(value: int, min: int, max: int): int {`,
          `  if value < min { return min }`,
          `  if value > max { return max }`,
          `  return value`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(100);
  });
});

// ============================================================================
// Extern C++ class imports
// ============================================================================

describe("e2e — extern class imports", () => {
  it("compiles and runs extern class with inferred header", () => {
    // Write a real C++ header that the generated code can include
    const counterHeader = `
#pragma once
#include <cstdint>
struct Counter {
    int32_t value;
    Counter(int32_t value) : value(value) {}
    int32_t get() const { return value; }
    void increment() { value++; }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "Counter.hpp"), counterHeader);

    const result = ctx.compileAndRun(`
      import class Counter {
        value: int
        get(): int
        increment(): void
      }
      function main(): int {
        let c = Counter(0)
        c.increment()
        c.increment()
        c.increment()
        return c.get()
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(3);
  });

  it("compiles and runs extern class with explicit header", () => {
    const mathHeader = `
#pragma once
#include <cstdint>
#include <cmath>
struct Vec2 {
    float x;
    float y;
    Vec2(float x, float y) : x(x), y(y) {}
    float length() const { return std::sqrt(x * x + y * y); }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "math_lib.hpp"), mathHeader);

    const result = ctx.compileAndRun(`
      import class Vec2 from "math_lib.hpp" {
        x, y: float
        length(): float
      }
      function main(): int {
        v := Vec2(3.0, 4.0)
        if v.length() > 4.9 {
          return 5
        } else {
          return 0
        }
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(5);
  });

  it("compiles extern class with println output", () => {
    const greetHeader = `
#pragma once
#include <string>
struct Greeter {
    std::string name;
    Greeter(std::string name) : name(std::move(name)) {}
    std::string greet() const { return "Hello, " + name + "!"; }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "Greeter.hpp"), greetHeader);

    const result = ctx.compileAndRun(`
      import class Greeter {
        name: string
        greet(): string
      }
      function main(): int {
        g := Greeter("World")
        println(g.greet())
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("Hello, World!");
  });

  it("compiles extern class passed as function argument", () => {
    const pointHeader = `
#pragma once
#include <cstdint>
struct Point {
    int32_t x;
    int32_t y;
    Point(int32_t x, int32_t y) : x(x), y(y) {}
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "Point.hpp"), pointHeader);

    const result = ctx.compileAndRun(`
      import class Point {
        x, y: int
      }
      function sumCoords(p: Point): int => p.x + p.y
      function main(): int {
        p := Point(10, 20)
        return sumCoords(p)
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(30);
  });

  it("compiles namespaced extern class with as clause", () => {
    // Write a header with a namespaced class
    const nsHeader = `
#pragma once
#include <cstdint>
namespace math {
struct Calculator {
    int32_t base;
    Calculator(int32_t base) : base(base) {}
    int32_t add(int32_t x) const { return base + x; }
};
}
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "calculator.hpp"), nsHeader);

    const result = ctx.compileAndRun(`
      import class Calculator from "calculator.hpp" as math::Calculator {
        base: int
        add(x: int): int
      }
      function main(): int {
        c := Calculator(100)
        return c.add(42)
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(142);
  });

  it("compiles and runs extern class static method call", () => {
    const mathHeader = `
#pragma once
#include <cmath>
namespace native {
struct MathBridge {
    static float cos(float x) { return std::cos(x); }
};
}
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "math_bridge.hpp"), mathHeader);

    const result = ctx.compileAndRun(`
      import class MathBridge from "math_bridge.hpp" as native::MathBridge {
        static cos(x: float): float
      }
      function main(): int {
        if MathBridge.cos(0.0f) > 0.99f {
          return 1
        }
        return 0
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
  });

  it("compiles extern class direct construction through static create", () => {
    const readerHeader = `
#pragma once
#include <cstdint>
#include <memory>
#include <vector>

namespace native {
class BlobReader {
public:
    static std::shared_ptr<BlobReader> create(const std::shared_ptr<std::vector<uint8_t>>& data, int32_t offset) {
        return std::shared_ptr<BlobReader>(new BlobReader(data, offset));
    }

    uint8_t current() const {
        return (*data_)[offset_];
    }

    int32_t offset() const {
        return offset_;
    }

private:
    BlobReader(const std::shared_ptr<std::vector<uint8_t>>& data, int32_t offset)
        : data_(data), offset_(offset) {}

    std::shared_ptr<std::vector<uint8_t>> data_;
    int32_t offset_;
};
}
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "blob_reader.hpp"), readerHeader);

    const result = ctx.compileAndRun(`
      import class BlobReader from "blob_reader.hpp" as native::BlobReader {
        static create(data: readonly byte[], offset: int = 0): BlobReader
        current(): byte
        offset(): int
      }

      function main(): int {
        payload: readonly byte[] := [7, 9]
        first := BlobReader(payload)
        second := BlobReader { data: payload, offset: 1 }
        return int(first.current()) + int(second.current()) + second.offset()
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(17);
  });

  it("compiles extern class method returning imported enum type", () => {
    const nativeHeader = `
#pragma once
#include "types.hpp"
struct NativeSwitch {
    Mode mode;
    NativeSwitch(Mode mode) : mode(mode) {}
    Mode get() const { return mode; }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "native_switch.hpp"), nativeHeader);

    const result = ctx.compileAndRunProject(
      {
        "/main.do": `
          import { Mode } from "./types"
          import class NativeSwitch from "native_switch.hpp" {
            mode: Mode
            get(): Mode
          }
          function main(): int {
            s := NativeSwitch(Mode.On)
            return s.get().value
          }
        `,
        "/types.do": `
          export enum Mode { Off = 0, On = 1 }
        `,
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
  });

  it("compiles extern class returning Result<void, string>", () => {
    const workerHeader = `
#pragma once
#include <string>
struct Worker {
    std::string name;
    Worker(std::string name) : name(std::move(name)) {}
    doof::Result<void, std::string> run(bool fail) {
        if (fail) return doof::Result<void, std::string>::failure("bad");
        return doof::Result<void, std::string>::success();
    }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "worker.hpp"), workerHeader);

    const result = ctx.compileAndRun(`
      import class Worker from "worker.hpp" {
        name: string
        run(fail: bool): Result<void, string>
      }
      function main(): int {
        w := Worker("demo")
        const ok = w.run(false)
        case ok {
          _: Success => println("ok")
          f: Failure => println(f.error)
        }
        const bad = w.run(true)
        return case bad {
          _: Success => 0,
          f: Failure => {
            println(f.error)
            yield 1
          }
        }
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("ok\nbad");
  });

  it("compiles extern class returning Result<Map<string, JsonValue>, string>", () => {
    const rowsHeader = `
#pragma once
#include <string>
#include <unordered_map>
#include "doof_runtime.hpp"

struct NativeRows {
    static doof::Result<doof::JsonValue::Object, std::string> read() {
        auto row = std::make_shared<std::unordered_map<std::string, doof::JsonValue>>();
        (*row)["id"] = doof::JsonValue(static_cast<int64_t>(7));
        (*row)["title"] = doof::JsonValue("demo");
        return doof::Result<doof::JsonValue::Object, std::string>::success(row);
    }
};
`;
    fs.writeFileSync(path.join(ctx.tmpDir, "native_rows.hpp"), rowsHeader);

    const result = ctx.compileAndRun(`
      import class NativeRows from "native_rows.hpp" {
        static read(): Result<Map<string, JsonValue>, string>
      }

      function main(): int {
        result := NativeRows.read()
        return case result {
          s: Success => if JSON.stringify(s.value).contains("demo") then 0 else 2,
          _ => 1
        }
      }
    `);
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
  });
});

describe("e2e — namespace imports", () => {
  it("runs multi-module with namespace import", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import * as math from "./math"`,
          `function main(): int {`,
          `  return math.add(10, 20)`,
          `}`,
        ].join("\n"),
        "/math.do": [
          `export function add(a: int, b: int): int => a + b`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(30);
  });

  it("runs namespace import with println output", () => {
    const result = ctx.compileAndRunProject(
      {
        "/main.do": [
          `import * as greet from "./greet"`,
          `function main(): void {`,
          `  greet.hello()`,
          `}`,
        ].join("\n"),
        "/greet.do": [
          `export function hello(): void {`,
          `  println("Hello from namespace!")`,
          `}`,
        ].join("\n"),
      },
      "/main.do",
    );
    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.stdout.trim()).toBe("Hello from namespace!");
  });
});

describe("e2e — mixed native build inputs", () => {
  it("compiles and runs with a non-default include path and extra native source", () => {
    const includeDir = path.join(ctx.tmpDir, "native-include");
    const nativeDir = path.join(ctx.tmpDir, "native-src");
    fs.mkdirSync(includeDir, { recursive: true });
    fs.mkdirSync(nativeDir, { recursive: true });

    const header = `
#pragma once
#include <cstdint>

struct NativeCounter {
    explicit NativeCounter(int32_t start);
    int32_t increment();
    int32_t get() const;

private:
    int32_t value_;
};
`;
    fs.writeFileSync(path.join(includeDir, "native_counter.hpp"), header);

    const source = `
#include "native_counter.hpp"

NativeCounter::NativeCounter(int32_t start) : value_(start) {}

int32_t NativeCounter::increment() {
    value_ += 1;
    return value_;
}

int32_t NativeCounter::get() const {
    return value_;
}
`;
    const sourcePath = path.join(nativeDir, "native_counter.cpp");
    fs.writeFileSync(sourcePath, source);

    const result = ctx.compileAndRunProject(
      {
        "/main.do": `
          import class NativeCounter from "native_counter.hpp" {
            start: int
            increment(): int
            get(): int
          }

          function main(): int {
            counter := NativeCounter(39)
            counter.increment()
            counter.increment()
            return counter.get()
          }
        `,
      },
      "/main.do",
      {
        includePaths: [includeDir],
        sourceFiles: [sourcePath],
      },
    );

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(41);
  });

  it("compiles and runs the checked-in regex sample", () => {
    const result = ctx.compileAndRunManifestProject(path.resolve("samples/regex/main.do"));

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Email is valid: true");
    expect(result.stdout).toContain("First release date: 2026-03-30 at 25..35");
    expect(result.stdout).toContain("Date groups: 3 -> 2026-03-30");
    expect(result.stdout).toContain("Release warning present: true");
    expect(result.stdout).toContain("Normalized whitespace: Release notes need cleanup");
    expect(result.stdout).toContain("Replace first: ticket / DOOF-105");
  });
});
