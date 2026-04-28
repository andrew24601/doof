# Modules and Imports

## Overview

Doof uses an ESM-style module system with explicit imports and exports. Each file is a module with its own scope. All imports and exports are determined at compile time.

---

## Exports

### Named Exports

Export declarations directly:

```javascript
// math.do
export const PI = 3.14159
export const E = 2.71828

export class Vector {
    x, y, z: float
    magnitude(): float => sqrt(x*x + y*y + z*z)
}

export function add(a: int, b: int): int => a + b

export enum Direction { North, South, East, West }

export type Result<T> = Success<T> | Failure
```

Or export separately from declaration:

```javascript
class Helper { ... }
function publicFunction(): void { ... }
function privateFunction(): void { ... }

export { Helper, publicFunction }
```

### Export Renaming

```javascript
class InternalVector { ... }
function internalAdd(a: int, b: int): int => a + b

export { 
    InternalVector as Vector,
    internalAdd as add 
}
```

### No Default Exports

Doof omits default exports to encourage explicit naming:

```javascript
// ❌ Not supported
export default class Foo { }

// ✅ Use named exports
export class Foo { }
```

**Rationale:** Consistent import syntax, no naming confusion, better tooling support.

---

## Imports

### Named Imports

```javascript
import { Vector, add, PI } from "math"

let v = Vector { x: 1.0, y: 2.0, z: 3.0 }
let sum = add(1, 2)
```

### Import Renaming

```javascript
import { Vector as Vec3, add as addInts } from "math"
import { Vector as Vec2 } from "math2d"

let v3 = Vec3 { x: 1.0, y: 2.0, z: 3.0 }
let v2 = Vec2 { x: 1.0, y: 2.0 }
```

### Namespace Import

```javascript
import * as math from "math"

let v = math.Vector { x: 1.0, y: 2.0, z: 3.0 }
let sum = math.add(1, 2)
print(math.PI)
```

### Type-Only Import

Import only type information (erased at runtime):

```javascript
import type { User, Config } from "./types"

function process(user: User, config: Config): void { ... }

let u = User { ... }  // ❌ Error: User is a type-only import
```

Useful for avoiding circular import issues with values while still using types.

### Native Class Imports

Doof can import native C++ classes directly:

```javascript
export import class BlobReader from "blob_reader.hpp" as native::BlobReader {
    static create(data: readonly byte[], offset: int = 0): BlobReader
    current(): byte
}

payload: readonly byte[] := [7, 9]
first := BlobReader(payload)
second := BlobReader { data: payload, offset: 1 }
```

When an imported class declares a `static create(...): SameClass` method, direct construction routes through that factory. Positional construction follows the factory parameter order, named construction uses the factory parameter names, and omitted arguments use the Doof defaults declared on the imported signature.

---

## Module Paths

### Relative Paths

```javascript
import { Helper } from "./helper"       // Same directory
import { Config } from "../config"       // Parent directory
import { Database } from "./db/database" // Subdirectory
```

### Package Imports

```javascript
import { HttpClient } from "http"     // No path prefix
import { JsonParser } from "json"
import { Assert } from "std/assert"   // Compiler-provided standard module
```

The compiler may provide standard-library modules under the `std/` namespace. They use the same bare-specifier import syntax as other package-style imports.

Package-style imports are wired through the nearest `doof.json` above the entry module. The dependency key becomes the leading import segment, so this manifest:

```json
{
    "dependencies": {
        "hello-doof": {
            "url": "https://github.com/andrew24601/hello-doof",
            "version": "0.1"
        }
    }
}
```

allows imports such as:

```javascript
import { say } from "hello-doof/hello"
```

Remote dependencies are materialized into a shared `~/.doof/packages/` cache by default. Version strings resolve git tags matching either the exact version or a `v`-prefixed form, so `0.1` can resolve `v0.1`.

### File Extensions

Extensions are optional and inferred:

```javascript
import { Foo } from "./foo"      // Equivalent
import { Foo } from "./foo.do"   // Equivalent
```

---

## Re-exports

### Simple Re-export

```javascript
// index.do
export { Vector, Matrix } from "./math/linear"
export { sin, cos, tan } from "./math/trig"
export { PI, E } from "./math/constants"
```

### Re-export with Renaming

```javascript
export { InternalVector as Vector } from "./internal"
```

### Re-export All

```javascript
export * from "./math/linear"
export * from "./math/trig"
```

### Namespace Re-export

```javascript
export * as linear from "./math/linear"
export * as trig from "./math/trig"

// Usage:
// import { linear, trig } from "math"
// linear.Vector { ... }
```

---

## Module Organisation

### Barrel Files (`index.do`)

```
mylib/
├── index.do          # Public API
├── internal/
│   ├── parser.do
│   └── validator.do
└── types.do
```

```javascript
// mylib/index.do
export { Parser } from "./internal/parser"
export { Validator } from "./internal/validator"
export { Config, Options } from "./types"
```

```javascript
// Consumer code
import { Parser, Config } from "mylib"
```

### Visibility

Items not exported are module-private:

```javascript
const INTERNAL_PRECISION = 1e-10  // Private

function internalHelper(): void { ... }  // Private

export function calculate(): float {
    internalHelper()  // ✅ Can use internally
    return result
}
```

---

## Circular Imports

Doof handles circular imports cleanly because module-level declarations (`const` and `readonly`) are immutable and functions hoist at global scope:

```javascript
// a.do
import { B } from "./b"
export class A {
    b: B | null = null
}

// b.do
import { A } from "./a"
export class B {
    a: A | null = null
}
```

`const` declarations are compile-time constants and hoist. `readonly` declarations are runtime-computed but follow strict declaration order. Functions hoist. No mutable state exists at module scope, preventing initialization order issues.

---

## Entry Points and Executable Modules

### The `main()` Function

A module becomes **executable** by defining a `main()` function:

```javascript
function main(): void {
    print("Hello, Doof!")
}
```

The `main()` function serves as the program's entry point and must have one of the following signatures:

```javascript
// No arguments
function main(): void { ... }

// With command-line arguments
function main(args: string[]): void { ... }

// With return code
function main(): int { ... }
function main(args: string[]): int { ... }
```

**Return value:**
- `void` — Program exits with code 0
- `int` — Program exits with the returned code

### Executable vs. Library Modules

The presence of a `main()` function distinguishes executable modules from library modules:

```javascript
// app.do — Executable module
import { processData } from "./lib"

function main(): void {
    data := processData()
    print("Result: ${data}")
}
```

```javascript
// lib.do — Library module (no main)
export function processData(): string {
    return "processed"
}
```

**Key rules:**
- A module with `main()` is executable
- A module without `main()` is a library
- The `main()` function **must not be exported**
- Only one `main()` function can exist per module

### Compilation Model

When compiling a Doof program, you specify the executable module:

```bash
doofc app.do           # Compile app.do as entry point
doofc src/main.do      # Compile src/main.do as entry point
```

The compiler:
1. Identifies the specified file as the entry point
2. Traverses all imports transitively
3. Includes all reachable modules in the compilation
4. Performs closed-world optimization

**Example project structure:**

```
myapp/
├── main.do          # Executable (has main())
├── config.do        # Library (imported by main.do)
├── utils.do         # Library (imported by config.do)
└── test.do          # Executable (has main(), separate entry point)
```

```bash
doofc main.do          # Compiles main.do + config.do + utils.do
doofc test.do          # Compiles test.do + any of its imports
```

### Multiple Entry Points

A project can have multiple executable modules:

```javascript
// server.do
import { startServer } from "./http"

function main(): void {
    startServer()
}
```

```javascript
// migrate.do
import { runMigrations } from "./database"

function main(): void {
    runMigrations()
}
```

Each is compiled separately:

```bash
doofc server.do        # Build server executable
doofc migrate.do       # Build migration executable
```

### Testing Conventions

Doof's current unit-testing story is CLI-driven rather than syntax-driven.

The `doof test` command treats test modules as ordinary library modules plus a generated temporary entry point.

Current conventions:

- Test files should use the `*.test.do` suffix
- Test functions should be exported top-level functions
- Test function names should start with `test`
- Test functions must have zero parameters and return `void`

Example:

```javascript
// math.test.do
export function testAdd(): void {
    assert(1 + 1 == 2, "expected addition to work")
}

export function testMul(): void {
    assert(3 * 4 == 12, "expected multiplication to work")
}
```

Run a single file:

```bash
doof test math.test.do
```

Run a directory tree:

```bash
doof test src
```

List discovered tests without running them:

```bash
doof test --list src
```

Filter discovered tests by id:

```bash
doof test --filter math src
```

Each discovered test is assigned an id of the form `<relative-path>::<functionName>`, for example `math.test.do::testAdd`.

This is a build-time discovery convention. It is not runtime reflection, and it does not change how ordinary modules are imported or executed.

### Module-Level Initialization

Code at module scope executes during module initialization, **before** `main()` runs:

```javascript
import { loadConfig } from "./config"

// Executes during initialization
readonly config = loadConfig()
print("Config loaded")

function main(): void {
    // Executes after all modules are initialized
    print("Starting app with config: ${config.name}")
}
```

**Initialization order:**
1. All imported modules are initialized depth-first
2. Module-level `const` and `readonly` bindings are evaluated in declaration order
3. Once all modules are initialized, `main()` is invoked

### Error Handling in `main()`

The `main()` function can use `try!/try?` for error handling:

```javascript
import { readFile } from "io"
import type { Config } from "./types"

function main(): void {
    // Panic if file read fails (acceptable for entry point)
    config := try! loadConfig("config.json")
    print("Loaded: ${config.name}")
}

function loadConfig(path: string): Result<Config, Error> {
    content := try readFile(path)
    return parseConfig(content)
}
```

Or return an exit code based on results:

```javascript
function main(): int {
    result := processData()
    case result {
        Success { value } => {
            print("Success: ${value}")
            return 0
        },
        Failure { error } => {
            print("Error: ${error}")
            return 1
        }
    }
}
```

---

## `as` Keyword Consistency

The `as` keyword provides consistent renaming across the language:

| Context | Syntax |
|---------|--------|
| Imports | `import { foo as bar } from "mod"` |
| Exports | `export { foo as bar }` |
| Destructuring | `{ foo as bar } := obj` |
| Extern class C++ name | `import class Foo from "header" as ns::Foo { ... }` |
| Imported function C++ name | `import function foo() from "header" as ns::foo` |

---

## Extern C++ Class Imports

Doof can import external C++ classes to enable interop with existing C++ libraries. An `import class` declaration describes the shape of a C++ class so that Doof code can use it with full type checking.

### Basic Syntax

```javascript
// Import a C++ class — header inferred as "Logger.hpp"
import class Logger {
    log(message: string): void
    setLevel(level: int): void
}

// Import from a specific header
import class HttpClient from "./vendor/http.hpp" {
    get(url: string): Result<string, int>
    post(url: string, body: string): Result<string, int>
}
```

The body declares the fields and methods that Doof code may access. This serves as a **structural contract** — the Doof compiler type-checks usage against it, and any mismatch with the actual C++ class surfaces as a C++ compilation error.

Extern methods may also be declared `static`, which emits a direct `ClassName::method(...)` call instead of an instance call:

```javascript
import class MathBridge from "./math_bridge.hpp" as native::MathBridge {
    static cos(x: float): float
    static sin(x: float): float
}

function wave(t: float): float => MathBridge.sin(t)
```

### Header Resolution

| Declaration | Generated `#include` |
|-------------|---------------------|
| `import class Foo { ... }` | `#include "Foo.hpp"` |
| `import class Foo from "./lib/foo.hpp" { ... }` | `#include "./lib/foo.hpp"` |
| `import class Foo from "<foo.h>" { ... }` | `#include <foo.h>` |

Angle-bracket paths (`<...>`) produce system-style includes.

### Memory Management

Extern classes behave exactly like regular Doof classes — they're heap-allocated and reference-counted using `std::shared_ptr`:

```javascript
import class Database from "./db.hpp" {
    query(sql: string): Result<Array<string>, string>
    close(): void
}

function main(): void {
    db := Database("localhost", 5432)   // shared_ptr<Database>
    result := try! db.query("SELECT 1")
}
```

This ensures consistent memory management across Doof and C++ code — all class instances use the same reference-counting mechanism, preventing ownership issues at the boundary.

### C++ Namespace Mapping

When the C++ class lives in a namespace, use `as` to provide the fully-qualified C++ name:

```javascript
import class HttpClient from "<httplib.h>" as httplib::Client {
    get(path: string): Result<string, int>
}
```

Doof code uses `HttpClient`; the transpiler emits `httplib::Client` in C++.

### Interop Conventions

Prefer a Doof-first boundary when designing interop modules:

- Put enums, type aliases, and other small shared boundary types in a focused module such as `types.do`
- Import those Doof types into your interop module instead of re-declaring raw integer or string codes there
- Include the generated header from native C++ so both sides share the same enum/type definitions
- Prefer typed extern signatures such as `kind(): EventKind` over `kindCode(): int` plus manual mapping helpers in Doof
- Keep low-level bindings in `Native...` declarations and reserve wrapper classes/functions for cases where the native API cannot expose the desired Doof shape directly
- Prefer `import function` for stateless free functions rather than creating artificial bridge classes

Example:

```javascript
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
// native_boardgame_host.hpp
#include "lib/cardgame/types.hpp"

class NativeBoardgameEvent {
public:
    NativeBoardgameEventKind kind() const;
};
```

This avoids duplicate conversion tables and keeps the Doof and C++ views of the boundary in sync.

### Fields

Extern classes can declare fields:

```javascript
import class Point from "./geometry.hpp" {
    x, y: float
}

function main(): void {
    p := Point(1.0, 2.0)
    println(p.x)  // Doof auto-dereferences shared_ptr for field access
}
```

Field declarations follow the same syntax as Doof class fields. The transpiler handles `shared_ptr` dereferencing transparently.

### Construction

Construction works like native Doof classes — positional or named:

```javascript
import class Rect from "./shapes.hpp" {
    x, y, width, height: float
}

r1 := Rect(0.0, 0.0, 100.0, 50.0)             // positional
r2 := Rect { x: 0.0, y: 0.0, width: 100.0, height: 50.0 }  // named
```

The transpiler emits the appropriate C++ constructor call. The extern C++ class must have a constructor with matching parameters.

### Limitations

- **No method bodies** — extern classes only declare signatures
- **Prefer focused exports** — `export import class` is supported, but raw native bindings should usually live in dedicated interop modules or behind higher-level Doof APIs rather than being scattered across a package surface
- **No inheritance** — extern classes cannot extend Doof classes or vice versa
- **Trust-based** — Doof type-checks against the declared shape, but cannot verify the actual C++ class matches; mismatches produce C++ compiler errors
- **No destructor declaration** — the C++ class's destructor runs automatically via RAII (value types) or `shared_ptr` ref-counting (`ref` types)

### Practical Example — Wrapping a C++ Library

```javascript
// sqlite.do
import class NativeSqliteDatabase from "./native_sqlite.hpp" {
    static open(path: string): Result<NativeSqliteDatabase, string>
    exec(sql: string): Result<NativeExecResult, string>
    prepare(sql: string): Result<NativeSqliteStatement, string>
    close(): Result<int, string>
}

import class NativeSqliteStatement from "./native_sqlite.hpp" {
    bindText(index: int, value: string): Result<int, string>
    bindInt(index: int, value: int): Result<int, string>
    step(): Result<bool, string>
    columnText(name: string): Result<string | null, string>
}

class Database {
    native: NativeSqliteDatabase
}

function openDb(path: string): Result<Database, string> {
    return case NativeSqliteDatabase.open(path) {
        s: Success -> Success { value: Database { native: s.value } },
        f: Failure -> Failure { error: f.error }
    }
}
```

---

## Extern C++ Function Imports

Doof can import standalone C/C++ functions using `import function` declarations. This is useful for calling existing C standard library functions or other C++ free functions without wrapping them in a class.

### Basic Syntax

```javascript
// Import a C++ function — no header (assume it's available)
import function myHelper(n: int): int

// Import from a specific header
import function cos(x: float): float from "<cmath>"

// Import with a C++ qualified name
import function cos(x: float): float from "<cmath>" as std::cos
```

The declaration specifies the function's name, parameters, return type, and optionally the header to include and the C++ qualified name to use at call sites.

### Header Resolution

| Declaration | Generated `#include` |
|-------------|---------------------|
| `import function foo(): int` | *(none)* |
| `import function foo(): int from "helpers.hpp"` | `#include "helpers.hpp"` |
| `import function foo(): int from "<cstdlib>"` | `#include <cstdlib>` |

### C++ Name Mapping

When the C++ function lives in a namespace, use `as` to provide the fully-qualified name:

```javascript
import function sin(x: float): float from "<cmath>" as std::sin
import function cos(x: float): float from "<cmath>" as std::cos

function wave(t: float): float => sin(t) + cos(t)
```

Doof code uses `sin` and `cos`; the transpiler emits `std::sin` and `std::cos` in C++.

### Exporting Imported Functions

Imported functions can be exported and imported by other Doof modules:

```javascript
// math.do
export import function sin(x: float): float from "<cmath>" as std::sin
export import function cos(x: float): float from "<cmath>" as std::cos

// main.do
import { sin, cos } from "./math"
function test(x: float): float => sin(x) + cos(x)
```

When an imported function is re-exported through another module, the transpiler still emits the correct C++ qualified name at the call site.

---

## Summary

| Syntax | Description |
|--------|-------------|
| `export { A, B }` | Named exports |
| `export { A as B }` | Export with rename |
| `export * from "mod"` | Re-export all |
| `export * as ns from "mod"` | Re-export as namespace |
| `import { A, B } from "mod"` | Named imports |
| `import { A as B } from "mod"` | Import with rename |
| `import * as ns from "mod"` | Namespace import |
| `import type { A } from "mod"` | Type-only import |
| `import class Foo { ... }` | Extern C++ class (ref-counted) |
| `import class Foo from "h" { ... }` | Extern class with explicit header |
| `import class Foo from "h" as ns::F { ... }` | Extern class with C++ name |
| `import function foo(): T` | Imported C++ function |
| `import function foo(): T from "h"` | Imported function with header |
| `import function foo(): T from "h" as ns::f` | Imported function with C++ name |
