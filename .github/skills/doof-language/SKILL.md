---
name: doof-language
description: Write, read, and reason about Doof programming language code. Doof is a statically-typed, compiled language with TypeScript-like syntax that transpiles to C++. Use when writing .do files, designing Doof APIs, implementing Doof classes/functions, writing .test.do files, using assert or the doof test runner, handling errors with Result types, or working with Doof's module system, pattern matching, concurrency, or JSON serialization.
metadata:
    version: "1.4"
    languageVersion: "0.1"
---

# Doof Language

Doof is a statically-typed, compiled language with TypeScript-like syntax that transpiles to C++ with closed-world compilation. Files use the `.do` extension. Semicolons are optional and usually omitted.

Use this base file as the entry point. Load only the reference file that matches the task instead of carrying the whole language manual into context.

## Working Rules

- Prefer the focused reference files below over broad assumptions.
- When exact semantics matter, confirm them in `spec/*.md`.
- Keep code idiomatic: immutable by default, explicit types at boundaries, no JavaScript-style coercions.
- Use `Result` plus `case`, `try`, declaration-`else`, `as`, or `!` for fallible flows. Use `panic(...)` only for programmer errors.
- Plain `if` null checks do **not** narrow static types. Use explicit narrowing forms.
- Classes are nominal. Interfaces are structural.
- Global scope allows `const`, `readonly`, and `function`. Mutable bindings are local-only.
- Prefer `std/<name>` packages before inventing utility modules.

## Quick Syntax

```doof
function main(): void {
    println("Hello, Doof!")
}

count := 1
let total = 0
readonly config = load()
const VERSION = "0.1"

result := try! loadConfig()
value := source as string else { return "" }
```

Key reminders:

- `main()` may return `void` or `int`, and may optionally accept `args: string[]`.
- Named calls use `callee{ ... }` with no whitespace before `{`.
- `if` expressions use `then`: `if ready then start() else wait()`.
- `/` requires a floating operand. Use `\` for integer division.
- `Map<K, V>` literals use `{ key: value }`. `Set<T>` literals use `[a, b, c]`.

## Reference Map

Load the narrowest matching file for the task.

| Need | Reference |
| --- | --- |
| Core syntax, bindings, lambdas, control flow, operators, language differences | [references/core-language.md](./references/core-language.md) |
| Types, collections, enums, `JsonValue`, inference, nullability | [references/type-system.md](./references/type-system.md) |
| Classes, interfaces, construction, statics, destructors, `weak` references | [references/classes-and-memory.md](./references/classes-and-memory.md) |
| `Result`, `try`, `try!`, `try?`, declaration-`else`, `catch`, `as`, `panic` | [references/error-handling.md](./references/error-handling.md) |
| Imports, exports, package dependencies, `import class`, `import function` | [references/modules-and-interop.md](./references/modules-and-interop.md) |
| JSON serialization, generated metadata, schema/invoke behavior | [references/json-and-metadata.md](./references/json-and-metadata.md) |
| `isolated`, `async`, `Promise<T>`, `Actor<T>` | [references/concurrency.md](./references/concurrency.md) |
| Stdlib package index and package selection | [references/stdlib-overview.md](./references/stdlib-overview.md) |
| Assertions, test file structure, runner commands, mocks | [references/stdlib-assert-and-testing.md](./references/stdlib-assert-and-testing.md) |
| `std/blob`, `std/fs`, `std/http`, `std/json`, `std/path`, `std/stream` | [references/stdlib-data-and-io.md](./references/stdlib-data-and-io.md) |
| `std/crypto`, `std/os` | [references/stdlib-crypto-and-os.md](./references/stdlib-crypto-and-os.md) |
| `std/regex`, `std/time` | [references/stdlib-regex-and-time.md](./references/stdlib-regex-and-time.md) |

## Repo Anchors

- `spec/` is the authoritative language behavior reference.
- `samples/` shows complete Doof programs and package layouts.
- `src/*test.ts` captures checker, parser, emitter, and CLI edge cases.

## Practical Routing

- Writing a `.do` module from scratch: load [references/core-language.md](./references/core-language.md) and then whichever feature reference matches the code.
- Designing APIs with classes, interfaces, or metadata: load [references/classes-and-memory.md](./references/classes-and-memory.md) and [references/json-and-metadata.md](./references/json-and-metadata.md).
- Fixing type errors around unions, nullability, collections, or `JsonValue`: load [references/type-system.md](./references/type-system.md) and [references/error-handling.md](./references/error-handling.md).
- Working on imports, packages, or C++ bridge code: load [references/modules-and-interop.md](./references/modules-and-interop.md).
- Writing tests or mocks: load [references/stdlib-assert-and-testing.md](./references/stdlib-assert-and-testing.md).