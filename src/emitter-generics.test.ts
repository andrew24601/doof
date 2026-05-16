/**
 * Emitter tests — generics: template declarations, type parameter
 * emission, generic class construction, generic function calls.
 */

import { describe, it, expect } from "vitest";
import { emit, emitMulti, emitSplit } from "./emitter-test-helpers.js";
import { emitType } from "./emitter-types.js";
import type { ResolvedType } from "./checker-types.js";

// ============================================================================
// Type mapping
// ============================================================================

describe("emitter — generic type mapping", () => {
  it("maps typevar to its name", () => {
    const t: ResolvedType = { kind: "typevar", name: "T" };
    expect(emitType(t)).toBe("T");
  });

  it("maps generic class type with typeArgs", () => {
    const t: ResolvedType = {
      kind: "class",
      symbol: {
        name: "Box",
        symbolKind: "class",
        module: "/main.do",
        exported: false,
        declaration: { kind: "class-declaration", name: "Box", typeParams: ["T"], fields: [], methods: [], description: undefined, exported: false, implements_: [], private_: false, span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } },
      },
      typeArgs: [{ kind: "primitive", name: "int" }],
    };
    expect(emitType(t)).toBe("std::shared_ptr<Box<int32_t>>");
  });
});

// ============================================================================
// Generic function declarations
// ============================================================================

describe("emitter — generic function declarations", () => {
  it("emits template prefix for generic function", () => {
    const cpp = emit(`function identity<T>(x: T): T => x`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("T identity(T x)");
  });

  it("emits template prefix with multiple type params", () => {
    const cpp = emit(`function pair<A, B>(a: A, b: B): Tuple<A, B> => (a, b)`);
    expect(cpp).toContain("template<typename A, typename B>");
  });
});

// ============================================================================
// Generic class declarations
// ============================================================================

describe("emitter — generic class declarations", () => {
  it("emits template prefix for generic class", () => {
    const cpp = emit(`class Box<T> {
  value: T
}`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("struct __doof_private_main_Box");
  });

  it("emits template prefix with multiple type params on class", () => {
    const cpp = emit(`class Pair<A, B> {
  first: A
  second: B
}`);
    expect(cpp).toContain("template<typename A, typename B>");
  });
});

// ============================================================================
// Generic type alias declarations
// ============================================================================

describe("emitter — generic type alias declarations", () => {
  it("emits template prefix for generic type alias", () => {
    const cpp = emit(`type Container<T> = T[]`);
    expect(cpp).toContain("template<typename T>");
    expect(cpp).toContain("using Container");
  });
});

// ============================================================================
// Generic construction expressions
// ============================================================================

describe("emitter — generic construction", () => {
  it("emits explicit type args in construction", () => {
    const cpp = emit(`class Box<T> {
  value: T
}
const b = Box<int> { value: 42 }
`);
    expect(cpp).toContain("make_shared<__doof_private_main_Box<int32_t>>");
  });

  it("emits explicit type args for positional generic construction", () => {
    const cpp = emit(`class Box<T> {
  value: T
}
const b = Box<int>(42)
`);
    expect(cpp).toContain("make_shared<__doof_private_main_Box<int32_t>>(42)");
  });

  it("emits inferred type args for generic class call syntax", () => {
    const cpp = emit(`
class Counter implements Stream<int> {
  current: int
  endExclusive: int
  currentValue: int = 0

  next(): bool {
    if this.current < this.endExclusive {
      this.currentValue = this.current
      this.current = this.current + 1
      return true
    }
    return false
  }

  value(): int => this.currentValue
}

class Chain<T> implements Stream<T> {
  source: Stream<T>

  next(): bool => this.source.next()
  value(): T => this.source.value()
}

const chain = Chain(Counter(1, 4))
`);
    expect(cpp).toContain("make_shared<__doof_private_main_Chain<int32_t>>(__doof_stream_int{std::in_place_type<std::shared_ptr<__doof_private_main_Counter>>, std::make_shared<__doof_private_main_Counter>(1, 4)})");
    expect(cpp).not.toContain("__doof_stream_T");
  });

  it("emits contextual object literals with concrete generic class names", () => {
    const cpp = emit(`
class Counter implements Stream<int> {
  current: int
  endExclusive: int
  currentValue: int = 0

  next(): bool {
    if this.current < this.endExclusive {
      this.currentValue = this.current
      this.current = this.current + 1
      return true
    }
    return false
  }

  value(): int => this.currentValue
}

class Chain<T> implements Stream<T> {
  source: Stream<T>

  next(): bool => this.source.next()
  value(): T => this.source.value()
}

const base = Counter(1, 4)
const chain: Chain<int> = { source: base }
`);
    expect(cpp).toContain("make_shared<__doof_private_main_Chain<int32_t>>(__doof_stream_int{std::in_place_type<std::shared_ptr<__doof_private_main_Counter>>, base})");
    expect(cpp).not.toContain("__doof_stream_T");
  });

  it("emits inferred type args for imported generic class call syntax", () => {
    const cpp = emitMulti({
      "/stream.do": `
        export class Chain<T> implements Stream<T> {
          source: Stream<T>

          next(): bool => this.source.next()
          value(): T => this.source.value()
        }
      `,
      "/main.do": `
        import { Chain } from "./stream"

        class Counter implements Stream<int> {
          current: int
          endExclusive: int
          currentValue: int = 0

          next(): bool {
            if this.current < this.endExclusive {
              this.currentValue = this.current
              this.current = this.current + 1
              return true
            }
            return false
          }

          value(): int => this.currentValue
        }

        const chain = Chain(Counter(1, 4))
      `,
    }, "/main.do");

    expect(cpp).toContain("make_shared<Chain<int32_t>>(__doof_stream_int{std::in_place_type<std::shared_ptr<__doof_private_main_Counter>>, std::make_shared<__doof_private_main_Counter>(1, 4)})");
    expect(cpp).not.toContain("__doof_stream_T");
  });
});

// ============================================================================
// Module splitting for generics
// ============================================================================

describe("emitter — generic module splitting", () => {
  it("puts generic function body in header", () => {
    const result = emitSplit(`export function identity<T>(x: T): T => x`);
    // Generic function body must be in header since templates need definition at use-site
    expect(result.hppCode).toContain("template<typename T>");
    expect(result.hppCode).toContain("identity");
  });

  it("emits template forward declaration for generic class", () => {
    const result = emitSplit(`export class Box<T> {
  value: T
}`);
    expect(result.hppCode).toContain("template<typename T>");
    expect(result.hppCode).toContain("Box");
  });

  it("monomorphizes direct stream-sensitive generic function calls", () => {
    const result = emitSplit(`
      class Counter implements Stream<int> {
        current: int
        end: int
        currentValue: int = 0

        next(): bool {
          if this.current < this.end {
            this.currentValue = this.current
            this.current = this.current + 1
            return true
          }
          return false
        }

        value(): int => this.currentValue
      }

      export function collect<T>(items: Stream<T>): T[] {
        let values: T[] = []
        for item of items {
          values.push(item)
        }
        return values
      }

      const stream: Stream<int> = Counter(1, 4)
      const values = collect(stream)
    `);

    expect(result.hppCode).toContain("collect__int");
    expect(result.cppCode).toContain("std::shared_ptr<std::vector<int32_t>> collect__int(__doof_stream_int items)");
    expect(result.cppCode).toContain("collect__int(stream)");
    expect(result.hppCode).not.toContain("__doof_stream_T");
    expect(result.cppCode).not.toContain("__doof_stream_T");
  });

  it("monomorphizes transitive stream-sensitive generic helper chains", () => {
    const result = emitSplit(`
      class Counter implements Stream<int> {
        current: int
        end: int
        currentValue: int = 0

        next(): bool {
          if this.current < this.end {
            this.currentValue = this.current
            this.current = this.current + 1
            return true
          }
          return false
        }

        value(): int => this.currentValue
      }

      function collect<T>(items: Stream<T>): T[] {
        let values: T[] = []
        for item of items {
          values.push(item)
        }
        return values
      }

      export function collectViaHelper<T>(items: Stream<T>): T[] => collect(items)

      const stream: Stream<int> = Counter(1, 4)
      const values = collectViaHelper(stream)
    `);

    expect(result.hppCode).toContain("collect__int");
    expect(result.hppCode).toContain("collectViaHelper__int");
    expect(result.cppCode).toContain("return collect__int(items);");
    expect(result.cppCode).toContain("collectViaHelper__int(stream)");
    expect(result.hppCode).not.toContain("collect__T");
    expect(result.cppCode).not.toContain("collect__T");
  });

  it("specializes stream-sensitive generic classes for concrete Chain<int>", () => {
    const result = emitSplit(`
      class Counter implements Stream<int> {
        current: int
        end: int
        currentValue: int = 0

        next(): bool {
          if this.current < this.end {
            this.currentValue = this.current
            this.current = this.current + 1
            return true
          }
          return false
        }

        value(): int => this.currentValue
      }

      export class Chain<T> implements Stream<T> {
        source: Stream<T>

        next(): bool => this.source.next()
        value(): T => this.source.value()

        collect(): T[] {
          let values: T[] = []
          for item of this.source {
            values.push(item)
          }
          return values
        }
      }

      const stream: Stream<int> = Counter(1, 4)
      const chain = Chain<int> { source: stream }
      const values = chain.collect()
    `);

    expect(result.hppCode).toContain("template<>\nstruct Chain<int32_t>");
    expect(result.hppCode).toContain("__doof_stream_int source;");
    expect(result.hppCode).toContain("std::shared_ptr<std::vector<int32_t>> collect()");
    expect(result.cppCode).toContain("std::make_shared<Chain<int32_t>>(stream)");
    expect(result.hppCode).not.toContain("__doof_stream_T");
    expect(result.cppCode).not.toContain("__doof_stream_T");
  });

  it("targets a richer Chain<T> pipeline with filter map take and collect", () => {
    const result = emitSplit(`
      function isEven(value: int): bool => value % 2 == 0
      function decorate(value: int): string => string(value)

      class Counter implements Stream<int> {
        current: int
        endExclusive: int
        currentValue: int = 0

        next(): bool {
          if this.current < this.endExclusive {
            this.currentValue = this.current
            this.current = this.current + 1
            return true
          }
          return false
        }

        value(): int => this.currentValue
      }

      class FilteredStream<T> implements Stream<T> {
        source: Stream<T>
        pred: (value: T): bool
        currentValue: T | null = null

        next(): bool {
          while true {
            if !this.source.next() {
              return false
            }
            candidate := this.source.value()
            if this.pred(candidate) {
              this.currentValue = candidate
              return true
            }
          }
        }

        value(): T => this.currentValue!
      }

      class MappedStream<T, U> implements Stream<U> {
        source: Stream<T>
        transform: (value: T): U
        currentValue: U | null = null

        next(): bool {
          if !this.source.next() {
            return false
          }
          this.currentValue = this.transform(this.source.value())
          return true
        }

        value(): U => this.currentValue!
      }

      class TakeStream<T> implements Stream<T> {
        source: Stream<T>
        remaining: int
        currentValue: T | null = null

        next(): bool {
          if this.remaining <= 0 {
            return false
          }
          if !this.source.next() {
            return false
          }
          this.remaining = this.remaining - 1
          this.currentValue = this.source.value()
          return true
        }

        value(): T => this.currentValue!
      }

      export class Chain<T> implements Stream<T> {
        source: Stream<T>

        next(): bool => this.source.next()
        value(): T => this.source.value()

        filter(pred: (value: T): bool): Chain<T> => Chain<T> { source: FilteredStream<T> { source: this.source, pred } }
        map<U>(transform: (value: T): U): Chain<U> => Chain<U> { source: MappedStream<T, U> { source: this.source, transform } }
        take(count: int): Chain<T> => Chain<T> { source: TakeStream<T> { source: this.source, remaining: count } }

        collect(): T[] {
          let values: T[] = []
          for item of this.source {
            values.push(item)
          }
          return values
        }
      }

      const base: Stream<int> = Counter(1, 10)
      const chain = Chain<int> { source: base }
      const values = chain.filter(isEven).map(decorate).take(3).collect()
    `);

    expect(result.hppCode).toContain("template<>\nstruct Chain<int32_t>");
    expect(result.hppCode).toContain("template<>\nstruct Chain<std::string>");
    expect(result.hppCode).toContain("template<>\nstruct __doof_private_main_FilteredStream<int32_t>");
    expect(result.hppCode).toContain("template<>\nstruct __doof_private_main_MappedStream<int32_t, std::string>");
    expect(result.hppCode).toContain("template<>\nstruct __doof_private_main_TakeStream<std::string>");
    expect(result.cppCode).toContain("chain->filter(isEven)->map<std::string>(decorate)->take(3)->collect()");
    expect(result.hppCode).not.toContain("__doof_stream_T");
    expect(result.cppCode).not.toContain("__doof_stream_T");
  });
});
