# Doof Modules and Interop Reference

## Module System

ESM-style. Each `.do` file is a module. All imports/exports resolved at compile time.

### Exports

```doof
// Inline exports
export readonly PI = 3.14159
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

Remote package entries use exact `{ url, ref, commit }` coordinates. `ref` is descriptive; the compiler verifies the immutable commit. Root-only `resolutions` may select an exact winner for canonical-URL conflicts, and optional root policy allowlists constrain transitive origins and native link inputs. Local path dependencies and `DOOF_STDLIB_ROOT` are explicit mutable overrides accepted by every command, including `package`, and are recorded as mutable provenance.

## Scope Rules

### Global Scope

Only `readonly`, deprecated `const`, and `function` declarations are allowed. Prefer `readonly` for module constants; `const` remains accepted temporarily with a warning.

| Declaration | Hoists? |
|-------------|---------|
| `function` | Yes |
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

Module-scope `readonly` values initialize before `main()`. Imported modules initialize depth-first.

### WebAssembly Library Exports

With `build.target = "wasm"` or `--target wasm`, exported top-level functions in the entry module become host-callable C ABI exports named `doof_export_<functionName>`. The host passes a UTF-8 JSON object string with parameters by name and receives an allocated UTF-8 JSON envelope string. Call the exported `doof_free` after reading the result. Generic exports and types outside the supported JSON ABI are rejected.

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

Generated C++ namespaces for packaged Doof modules come from the package
`doof.json` name plus the module path relative to that package root. A package
named `hello-doof` emits `main.do` as `hello_doof::main` whether compiled
directly or as a dependency.

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
- Method signatures without bodies are implemented by native C++
- Method signatures with Doof block or arrow bodies emit out-of-line C++ member definitions
- Native headers must declare Doof-bodied methods; missing declarations surface as C++ compiler errors
- Bare `this` in a Doof-bodied imported method requires the native class to inherit from `std::enable_shared_from_this<Class>`
- Function-typed parameters lower to `doof::callback<R(Args...)>`; native code must choose local call or posting behavior explicitly
- No inheritance
- Mismatches surface as C++ compile errors

```doof
import class NativeEvent from "./native_event.hpp" as native::Event {
    kind(): int
    text(): string

    label(): string {
        return string(this.kind()) + ":" + this.text()
    }
}
```

### Recommended Interop Conventions

- Put shared enums, type aliases, and other small boundary types in a dedicated Doof module such as `types.do`
- Include the generated header from native C++ so both sides use the same definitions
- Prefer enum-typed extern methods like `kind(): EventKind` over raw `int` codes and follow-up mapping helpers
- Use `Native...` names for low-level bridge types and reserve unprefixed names for Doof-first wrappers or domain models
- Export raw extern declarations only from focused interop modules; prefer re-exporting them from a barrel rather than repeating declarations
- Prefer `import function` for narrow stateless bridges instead of introducing synthetic bridge classes
- Use `import isolated function` for a bodyless native free function whose implementation does not access mutable shared state; actor-dispatched code may only call it with this explicit contract.
- Mark bodyless native class methods `isolated` only when their implementation does not access mutable shared state; the contract is required for calls from actor-dispatched code.

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

`export import class`, `export import function`, and `export import isolated function`
are supported. Prefer exporting them from a dedicated interop module and
re-exporting through a barrel when that raw native surface is intentionally
public.

For `import function`, function-typed parameters also lower to
`doof::callback<R(Args...)>`. The compiler does not erase them to
`std::function` automatically.

## `as` Keyword Consistency

| Context | Syntax |
|---------|--------|
| Imports | `import { foo as bar } from "mod"` |
| Exports | `export { foo as bar }` |
| Destructuring | `{ foo as bar } := obj` |
| Extern class C++ name | `import class Foo from "h" as ns::Foo { ... }` |
