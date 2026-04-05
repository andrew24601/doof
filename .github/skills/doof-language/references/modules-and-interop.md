# Doof Modules and Interop Reference

## Module System

ESM-style. Each `.do` file is a module. All imports/exports resolved at compile time.

### Exports

```doof
// Inline exports
export const PI = 3.14159
export class Vector { x, y: float }
export function add(a: int, b: int): int => a + b
export enum Direction { North, South, East, West }
export type MyResult<T> = MySuccess<T> | MyFailure

// Separate export
class Helper { /* ... */ }
export { Helper }

// Export with rename
export { InternalVector as Vector }
```

No default exports.

### Imports

```doof
import { Vector, add, PI } from "./math"
import { Vector as Vec3 } from "./math"
import * as math from "./math"
import type { Config } from "./types"       // type-only (erased at runtime)
```

### Re-exports

```doof
export { Vector } from "./math/linear"
export { InternalVector as Vector } from "./internal"
export * from "./math/linear"
export * as linear from "./math/linear"
```

### Module Paths

```doof
import { Helper } from "./helper"         // relative
import { Config } from "../config"        // parent dir
import { HttpClient } from "http"         // package
```

File extensions optional (`.do` inferred).

## Scope Rules

### Global Scope

Only `const`, `readonly`, and `function` allowed.

| Declaration | Hoists? |
|-------------|---------|
| `function` | Yes |
| `const` | Yes |
| `readonly` | No |
| `:=` / `let` | Not allowed globally |

### Nested Scope

Nothing hoists. Strict declaration order. Functions can self-reference for recursion.

## Entry Points

A module with `main()` is executable:

```doof
function main(): void { println("Hello!") }
function main(args: string[]): void { /* ... */ }
function main(): int { return 0 }
function main(args: string[]): int { /* ... */ }
```

`main()` must not be exported. Only one per module.

### Module Initialization

`const` and `readonly` at module scope execute during initialization, before `main()`. Imported modules initialize depth-first.

## Extern C++ Interop

Import external C++ classes:

```doof
// Header inferred as "Logger.hpp"
import class Logger {
    log(message: string): void
    setLevel(level: int): void
}

// Explicit header
import class HttpClient from "./vendor/http.hpp" {
    get(url: string): Result<string, int>
    post(url: string, body: string): Result<string, int>
}

// System include
import class Socket from "<sys/socket.h>" {
    connect(host: string, port: int): Result<void, int>
}

// C++ namespace mapping
import class HttpClient from "<httplib.h>" as httplib::Client {
    get(path: string): Result<string, int>
}
```

### Header Resolution

| Declaration | Generated `#include` |
|-------------|---------------------|
| `import class Foo { ... }` | `#include "Foo.hpp"` |
| `import class Foo from "lib.hpp" { ... }` | `#include "lib.hpp"` |
| `import class Foo from "<foo.h>" { ... }` | `#include <foo.h>` |

### Extern Class Rules

- Can declare fields and methods (typed contracts)
- Memory managed via `shared_ptr` (same as Doof classes)
- Construction works like Doof classes (positional or named)
- No method bodies, no inheritance
- Mismatches surface as C++ compile errors

### Recommended Interop Conventions

- Put shared enums, type aliases, and other small boundary types in a dedicated Doof module such as `types.do`
- Include the generated header from native C++ so both sides use the same definitions
- Prefer enum-typed extern methods like `kind(): EventKind` over raw `int` codes and follow-up mapping helpers
- Use `Native...` names for low-level bridge types and reserve unprefixed names for Doof-first wrappers or domain models
- Export raw extern declarations only from focused interop modules; prefer re-exporting them from a barrel rather than repeating declarations
- Prefer `import function` for narrow stateless bridges instead of introducing synthetic bridge classes

Example:

```doof
// types.do
export enum NativeBoardgameEventKind {
    Unknown = 0,
    CloseRequested = 1,
    RenderRequested = 2
}

// host-runtime.do
import { NativeBoardgameEventKind } from "./types"

export import class NativeBoardgameEvent from "./native_boardgame_host.hpp" {
    kind(): NativeBoardgameEventKind
}
```

```cpp
#include "types.hpp"

struct NativeBoardgameEvent {
    NativeBoardgameEventKind kind() const;
};
```

This keeps the boundary declarative and removes duplicate integer-to-enum conversion logic.

### Exporting Extern Declarations

`export import class` and `export import function` are supported. Prefer exporting them from a dedicated interop module and re-exporting through a barrel when that raw native surface is intentionally public.

## `as` Keyword Consistency

| Context | Syntax |
|---------|--------|
| Imports | `import { foo as bar } from "mod"` |
| Exports | `export { foo as bar }` |
| Destructuring | `{ foo as bar } := obj` |
| Extern class C++ name | `import class Foo from "h" as ns::Foo { ... }` |
