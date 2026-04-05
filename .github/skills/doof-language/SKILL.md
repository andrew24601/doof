---
name: doof-language
description: Write, read, and reason about Doof programming language code. Doof is a statically-typed, compiled language with TypeScript-like syntax that transpiles to C++. Use when writing .do files, designing Doof APIs, implementing Doof classes/functions, writing .test.do files, using assert or the doof test runner, handling errors with Result types, or working with Doof's module system, pattern matching, concurrency, or JSON serialization.
metadata:
    version: "1.2"
    languageVersion: "0.1"
---

# Writing Doof Code

Doof is a statically-typed, compiled language with syntax inspired by TypeScript. It compiles to C++ via closed-world compilation. Files use the `.do` extension. Semicolons are optional and idiomatically omitted.

## Design Philosophy

1. **Safety first** — no data races, no null pointer exceptions, no unhandled errors
2. **Explicitness** — intent should be clear from the code
3. **Immutability by default** — mutable state is opt-in
4. **No exceptions** — error handling via `Result` types and `panic` for bugs

## Hello World

```doof
function main(): void {
    println("Hello, Doof!")
}
```

A module with a `main()` function is executable. `main()` can return `void` or `int`, and optionally accept `args: string[]`.

## Types

### Primitives

`int` (32-bit), `long` (64-bit), `float` (32-bit), `double` (64-bit), `string`, `char`, `bool`, `void`, `any`.

Integer literals default to `int`, decimal literals to `double`. Use `L` suffix for `long`, `f` for `float`. Contextual narrowing applies when the expected type is known:

```doof
x: float := 3.14        // narrowed to float from context
n: long := 42            // widened to long from context
```

### `any`

`any` is a closed-world dynamic carrier computed after whole-program analysis. It is meant for storage and transport across Doof code and C++ bridge boundaries, then narrowed before concrete use.

```doof
function sizeOf(value: any): int => case value {
    s: string => s.length,
    _ => 0
}
```

Rules:

- Concrete values can be assigned to `any`
- `any` does not implicitly assign back to concrete types
- Member access, indexing, and calls on raw `any` are rejected until narrowed
- `case` type patterns are the intended way to recover concrete types
- `any` is not supported as metadata input or success-payload JSON in v1
- Metadata-driven `.invoke(...)` uses `Result<string, any>` for failures: framework failures produce string payloads, and methods returning `Result<S, F>` surface raw `F` values on the failure branch

### `JSONValue`

`JSONValue` is an exact recursive JSON carrier:

```doof
payload: JSONValue := { name: "Ada", scores: [1, 2, 3] }
```

It accepts:

- `null`
- `bool`, `int`, `long`, `float`, `double`, `string`
- `JSONValue[]`
- `Map<string, JSONValue>`
- unions composed from those cases

Literals stay ergonomic through contextual typing, so `JSONValue := [1, 2, 3]` and `JSONValue := { ok: true }` work.

Pre-built typed collections do not implicitly convert. For example, `int[]` and `Map<string, int>` are not assignable to `JSONValue`; build `JSONValue[]` or `Map<string, JSONValue>` instead.

64-bit integers are preserved as `long` inside `JSONValue`, including values parsed from JSON that exceed `int` range.

Assignments from `JSONValue[]` and `Map<string, JSONValue>` into `JSONValue` preserve reference semantics for the underlying shared container.

### Nullability

No implicit null. Nullability is explicit via union types:

```doof
name: string | null := null     // explicitly nullable
value: int := null              // ❌ compile error
```

Null safety via narrowing:

```doof
if name != null {
    println(name.length)   // narrowed to string
}
```

### Union Types

```doof
type Value = int | string | bool
```

### Enums

```doof
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200, NotFound = 404 }
enum Color { Red = "RED", Green = "GREEN", Blue = "BLUE" }
```

Dot-shorthand when the type is known from context: `let d: Direction = .East`

Enums have `.name`, `.value` (if valued), `.values()`, `.fromName()`, `.fromValue()`.

Numeric types also expose static parse helpers: `int.parse(s)`, `long.parse(s)`, `float.parse(s)`, `double.parse(s)` returning `Result<T, ParseError>`.

### Collections

**Arrays:** `T[]` — ordered, mutable-content, reference-counted.

```doof
numbers := [1, 2, 3]                 // int[]
names: string[] = ["Alice", "Bob"]
```

Methods: `.length`, `.push()`, `.pop()`, `.contains()`, `.slice(start, end)`, `.map()`, `.filter()`, `.reduce()`, `.forEach()`, `.sort()`, `.enumerate()`.

**Strings:** `string` — immutable text with built-in methods.

`string(value)` performs explicit, safe formatting for primitive values (`int`, `long`, `float`, `double`, `string`, `char`, `bool`).

```doof
s := "Hello, World!"
s.length              // 13
s.indexOf("World")    // 7
s.contains("World")   // true
s.startsWith("Hello") // true
s.endsWith("!")        // true
s.substring(0, 5)     // "Hello"
s.slice(7)            // "World!"
s.toUpperCase()       // "HELLO, WORLD!"
s.toLowerCase()       // "hello, world!"
s.trim()              // remove whitespace
s.split(", ")         // ["Hello", "World!"]
s.replace("Hello", "Hi")      // "Hi, World!"
s.replaceAll("l", "L")        // "HeLLo, WorLd!"
s.charAt(0)           // "H"
s.repeat(2)           // "Hello, World!Hello, World!"
```

**Tuples:** `(T, U, ...)` — fixed-length, heterogeneous, positionally destructured.

```doof
pair: (int, string) = (1, "one")
(id, label) := pair
```

**Maps:** `Map<K, V>` — hash-based key-value collection with O(1) average-case access.

```doof
// Bare annotation with same-site literal inference
scores: Map := { "Alice": 100, "Bob": 95 }

// String keys
scores: Map<string, int> = { "Alice": 100, "Bob": 95 }

// Integer keys
let m: Map<int, string> = { 1: "one", 2: "two" }

// Long keys
ids: Map<long, string> = { 1L: "one", 2L: "two" }

// Dot-shorthand enum keys (type inferred from Map<K, V>)
piles: Map<Suit, Pile> = { .Spades: Pile {}, .Hearts: Pile {}, .Diamonds: Pile {}, .Clubs: Pile {} }

// Explicit enum access also works in map initializers
labels: Map<Color, string> = { Color.Red: "Red", Color.Green: "Green" }

// Readonly variant supports the same omitted-argument inference rule
frozenScores: ReadonlyMap := { "Alice": 100 }
```

Supported map key types are `string`, `int`, `long`, `char`, `bool`, and enums. The same rule applies to declaration initializers, return-context literals, argument-context literals, parameter defaults, and field defaults.

When a `Map<long, V>` is expected, integer literals in the initializer are contextually widened, so `let m: Map<long, int> = { 1: 10, 2: 20 }` is valid.

`float`, `double`, tuples, class instances, and other non-supported key types are rejected by the checker with an explicit map-key diagnostic instead of falling through to generated C++ errors.

| Method | Return Type | Description |
|--------|------------|-------------|
| `.get(key)` | `V \| null` | Lookup (null if missing) |
| `.set(key, value)` | `void` | Insert or update |
| `.has(key)` | `bool` | Check key existence |
| `.delete(key)` | `void` | Remove entry |
| `.keys()` | `K[]` | All keys |
| `.values()` | `V[]` | All values |
| `.size` | `int` | Entry count |

Index access: `m[key]` reads/writes directly (auto-inserts on write). For-of iteration yields `(key, value)` pairs:

```doof
for key, value of scores {
    println("${key}: ${value}")
}
```

`ReadonlyMap<K, V>` is the immutable variant — no `.set()`, `.delete()`, or index writes.

Empty maps require a full type annotation: `let m: Map<int, string> = {}`

Omit `Map` / `ReadonlyMap` type arguments only when both are omitted together and the declaration/default has a same-site non-empty homogeneous literal. Partial annotations such as `Map<string>` are compile errors.

**Sets:** `Set<T>` — hash-based unique-value collection.

```doof
// Bare annotation with same-site literal inference
unique: Set := [1, 2, 3, 2, 1]

let unique: Set<int> = [1, 2, 3, 2, 1]
enum Color { Red, Blue }
let palette: Set<Color> = [Color.Red, Color.Blue, Color.Red]
let ids: Set<long> = [1, 2, 3]
frozenIds: ReadonlySet := [1, 2, 3]
unique.add(4)
present := unique.has(2)
values := unique.values()
count := unique.size
```

Supported set element types are `string`, `int`, `long`, `char`, `bool`, and enums. The same rule applies to declaration initializers, return-context literals, argument-context literals, parameter defaults, and field defaults.

When a `Set<long>` is expected, integer literals in the initializer are contextually widened, so `let ids: Set<long> = [1, 2, 3]` is valid.

`float`, `double`, tuples, class instances, and other non-supported element types are rejected by the checker with an explicit set-element diagnostic.

Methods: `.size`, `.has()`, `.add()`, `.delete()`, `.values()`.

`ReadonlySet<T>` is the immutable variant.

Omit `Set` / `ReadonlySet` type arguments only when the declaration/default has a same-site non-empty homogeneous literal. Empty literals still require a full annotation, and extra type arguments are compile errors.

## Variables and Bindings

| Keyword | Reassignable | Content Mutability | Scope |
|---------|-------------|-------------------|-------|
| `const` | No | N/A (compile-time) | Global or nested |
| `readonly` | No | Deep immutable | Global or nested |
| `:=` | No | Shallow (content mutable) | Nested only |
| `let` | Yes | Mutable | Nested only |

```doof
const MAX = 100                    // compile-time constant
readonly CONFIG = loadConfig()     // runtime, deeply immutable
items := [1, 2, 3]                 // immutable binding, mutable array
let counter = 0                    // fully mutable
```

**Global scope** allows only `const`, `readonly`, and `function` declarations. `const` and `function` hoist; `readonly` does not.

### `with` — Scoped Bindings

```doof
with connection := openDatabase() {
    query(connection, "SELECT 1")
}
// connection is out of scope
```

### Destructuring

```doof
// Positional
(x, y, z) := point
(left, _, right) := tuple

// Array
[a, b, c] := values
[head, _, tail] := values

// Named
{ name, email } := user

// Renaming
{ name as userName } := user

// Mutable
let (a, b) = point
let [x, y] = values

// Assignment to existing mutable bindings
let px = 0
let py = 0
(px, py) = point

let head = 0
let tail = 0
[head, _, tail] = values

let userName = ""
{ name as userName } = user
```

Array destructuring requires a `T[]` value. Each non-`_` binding gets type `T`, `_` discards a slot, and the program panics if the array has fewer elements than the pattern length.

Tuple and class positional destructuring also support `_` as a discard.

Destructuring assignment requires every non-`_` target to already exist in scope as a mutable binding with a compatible type. `try` supports the same forms, for example `try [head, tail] = load()`.

## Functions and Lambdas

```doof
// Expression body
function double(x: int): int => x * 2

// Block body
function factorial(n: int): int {
    if n <= 1 { return 1 }
    return n * factorial(n - 1)
}

// Return type inference works for unambiguous cases
function add(a: int, b: int) => a + b
```

### Calling Functions

```doof
function clamp(value: int, min: int, max: int): int {
    if value < min { return min }
    if value > max { return max }
    return value
}

clamp(score, 0, 100)
clamp{ value: score, min: 0, max: 100 }
clamp{ min: 0, max: 100, value: score }

value := score
clamp{ value, min: 0, max: 100 }   // shorthand for value: value
```

Named calls are matched by parameter name rather than source order. Any omitted parameter must have a default value in the declaration. The `{` must immediately follow the callee with no whitespace. The same syntax works for top-level functions, imported functions, and methods.

### Lambdas

```doof
const square = (x: int): int => x * 2

// Type inference from context
type Transform = (x: int): int
let t: Transform = (x) => x * 2

// Parameterless form — names inherited from signature
numbers.map(=> it * 2)
numbers.filter(=> it > 10)
numbers.reduce(0, => acc + it)
```

Standard collection method parameter names: `it` (element), `index`, `acc` (accumulator), `a`/`b` (comparator).

### Trailing Lambdas

A block `{ }` on the same line after `)` is a trailing lambda for statement-like, void-returning callbacks:

```doof
items.forEach() { print(it) }
withTransaction() {
    writeAuditLog(it)
}
```

Trailing lambdas are intentionally restricted:

- The target callback type must return `void`
- `return` is forbidden inside the trailing lambda body
- Chaining off a trailing lambda call is forbidden

Use an explicit lambda instead when you need a value-producing callback:

```doof
items.map(=> it * 2)
items.filter((it) => it > 10)
items.reduce(0, => acc + it)
```

Examples of rejected trailing forms:

```doof
items.map() { it * 2 }                  // ❌ non-void callback
items.forEach() { return }             // ❌ return inside trailing lambda
items.forEach() { print(it) }.count()  // ❌ chaining after trailing lambda
```

### Function Types

Parameter names are part of the type signature:

```doof
type Callback = (value: int, label: string): void
type Predicate<T> = (item: T): bool
```

### Modifiers

`export`, `private` (file-scoped), `isolated` (concurrency-safe), `static` (class field or method, interface static method).

## Classes

Classes are **nominal types** (structural identity does not satisfy nominal checks).

```doof
class User {
    readonly id: int
    name: string
    email: string | null = null
    
    greet(): string => "Hello, ${name}"
}

// Named construction
user := User { id: 1, name: "Alice" }

// Shorthand properties — { name } is equivalent to { name: name }
id := 1
name := "Alice"
user := User { id, name }

// Positional construction (declaration order)
user := User(1, "Alice")
```

### Key Features

- `readonly` fields: set once at construction
- `const` fields: compile-time constants, enable discriminated unions
- Implicit `this` in methods (explicit only for disambiguation)
- `static` fields/methods: belong to the class, no `this` in static methods
- `private` fields/methods: file-scoped access control
- `destructor { }` block: deterministic cleanup via reference counting

### Static Access

Use `.` when accessing statics through a named class or interface type, and `::` when accessing statics through an instance or interface value.

```doof
class Rectangle {
    width: int
    static kind = "rectangle"
    static describe(): string => "Rectangles"
}

rect := Rectangle { width: 10 }

Rectangle.kind       // OK
Rectangle.describe() // OK
rect::kind           // OK
rect::describe()     // OK
rect.kind            // Error
rect.describe()      // Error
```

### String Interpolation

```doof
message := "Hello, ${name}! Score: ${score * 2}"
multiline := `Line 1
Line 2: ${value}`
```

## Interfaces (Structural)

Interfaces define structural contracts. Classes satisfy them automatically if they have matching structure.

```doof
interface Drawable {
    draw(canvas: Canvas): void
}

// Circle satisfies Drawable automatically — no explicit `implements` needed
class Circle {
    x, y, radius: float
    draw(canvas: Canvas): void { /* ... */ }
}
```

At compile time, interface types resolve to concrete union types of all matching classes (closed-world).

Interfaces may also declare static methods. Those are checked structurally against class statics and are invoked from interface values with `::`.

```doof
interface Shape {
    area(): float
    static describe(): string
}

function label(shape: Shape): string => shape::describe()
```

## Control Flow

```doof
// If/else (also usable as expression with `then`)
grade := if score >= 90 then "A" else if score >= 80 then "B" else "C"

// For-of loop (immutable loop variable)
for item of items { println(item) }

// Range-based
for i of 0..<10 { println(i) }       // exclusive: 0..9
for i of 1..5 { println(i) }         // inclusive: 1..5

// For-of with index
for index, value of items.enumerate() { println("${index}: ${value}") }

// For-of over Map (yields key, value)
for suit, pile of foundations { println("${suit.name}: ${pile.cards.length}") }

// While loop
while condition { doWork() }

// Traditional for
for let i = 0; i < 10; i += 1 { println(i) }

// Loop else (runs when loop completes without break)
for item of items {
    if item == target { break }
} else {
    println("Not found")
}

// Labeled break/continue
outer: for row of rows {
    for cell of row {
        if cell.isEmpty() { continue outer }
    }
}
```

## Pattern Matching

`case` expressions match values, ranges, and types:

```doof
// Value matching
result := case status {
    200 | 201 => "success",
    404 => "not found",
    500..599 => "server error",
    _ => "unknown"
}

// Type matching with capture
case shape {
    c: Circle => println("radius: ${c.radius}"),
    r: Rect => println("area: ${r.width * r.height}")
}

// Enum matching (dot-shorthand)
case direction {
    .North => moveUp(),
    .South => moveDown(),
    .East => moveRight(),
    .West => moveLeft()
}

// Range matching
category := case age {
    ..<18 => "minor",
    18..64 => "adult",
    65.. => "senior"
}
```

Exhaustive enum matching requires no wildcard `_`. No destructuring or guards in case arms.

Expression-form `case` arms are comma-separated. Statement-form `case` arms are not comma-separated. Multiple patterns in one arm use `|`.

**Restriction:** `return` and `try` statements are forbidden inside case *expression* arms. Use `yield value` inside block expression arms, or use case at statement level for early returns.

### Else-Narrow Statement

`name := expr else { ... }` unwraps Result and nullable types. The else block runs when the value is null or a Failure and must exit scope:

```doof
// Narrow nullable
x := getValue() else { return 0 }
// x is non-null here

// Narrow Result to success type
config := loadConfig() else { return "" }
// config is Config here (unwrapped from Result)

// Result | null — both stripped
config := loadConfig() else { return "" }
// config is Config here

// Full type accessible inside else block
x := loadConfig() else {
    // x has type Result<Config, AppError> here
    return case x {
        _: Success => "unexpected",
        f: Failure => f.error.message
    }
}
// x is Config here
```

Only applies to Result and/or nullable types. Plain unions and non-nullable types are compile errors.

## Error Handling

No exceptions. Two mechanisms: `Result<T, E>` for recoverable errors, `panic` for bugs.

```doof
// Returning errors
function parseInt(s: string): Result<int, string> {
    if invalid { return Failure { error: "bad input" } }
    return Success { value: parsed }
}

// Handling with case
case parseInt("42") {
    s: Success => println(s.value),
    f: Failure => println(f.error)
}

// try — early return on failure (statement-level, enclosing fn must return Result)
function loadConfig(): Result<Config, Error> {
    try content := readFile("config.json")
    try parsed := parseJSON(content)
    return Success { value: parsed }
}

function pickEnds(): Result<int, string> {
    try [first, _, last] := loadNumbers()
    return Success(first + last)
}

// try! — unwrap or panic (expression-level)
config := try! loadConfig()

// try? — convert to nullable (expression-level)
config := try? loadConfig()    // Config | null

// Result<void, E> uses zero-argument Success and statement-level try
function flush(): Result<void, string> {
    if failed { return Failure { error: "io" } }
    return Success()
}

function save(): Result<int, string> {
    try flush()
    return Success { value: 1 }
}

// ?? — fallback on null or failure
config := loadConfig() ?? defaultConfig
```

`try?` requires a non-`void` success type. Use `try` or `case` with `Result<void, E>`.

Result values **must be used** — silently discarding a `Result` is a compile error.

### Type Narrowing with `as`

The `as` operator performs runtime type narrowing, yielding `Result<T, string>`:

```doof
// Narrow from any
x: any := "hello"
try s := x as string          // s is string (in Result-returning fn)
s := try! x as string         // panics on failure
s := x as string else { return "" }  // else-narrow

// Narrow from union
x: int | string := "hello"
r := x as string              // Result<string, string>

// Narrow nullable
x: string | null := "hello"
r := x as string              // Result<string, string>

// Narrow interface to class
s: Shape := Circle { radius: 5.0 }
r := s as Circle              // Result<Circle, string>
```

Supported sources: `any`, unions, nullable types, interfaces. Invalid narrowing is a compile error.

### Catch Expression

Groups fallible operations and captures errors locally:

```doof
const err = catch {
    try a()
    try b()
}
// err: ErrorTypeA | ErrorTypeB | null
```

## Operators

- Arithmetic: `+`, `-`, `*`, `/` (float/double only), `\` (integer division), `%` (integer only), `**` (no `++`/`--`, use `+= 1`)
- Division: `/` requires at least one float/double operand (compile error on two integers). `\` requires both operands to be integer types. Use numeric casts (`float(x)`) to convert.
- Numeric casts: `int(x)`, `long(x)`, `float(x)`, `double(x)` — cast between numeric types using function-call syntax
- Comparison: `==` (reference equality for objects), `!=`, `<`, `<=`, `>`, `>=`
- Logical: `&&`, `||`, `!` (require `bool` operands)
- Null: `??` (null-coalescing), `?.` (optional chaining), `?[]` (optional indexing)
- Force: `!` (non-null assertion), `!.` (unwrap or panic), `try!`/`try?`
- Narrowing: `as` — runtime type narrowing yielding `Result<T, string>` (e.g. `x as string`)
- No operator overloading — use methods instead

## Modules

ESM-style imports/exports. Each file is a module.

```doof
// Exporting
export class Vector { x, y: float }
export function add(a: int, b: int): int => a + b

// Importing
import { Vector, add } from "./math"
import { Vector as Vec3 } from "./math"
import * as math from "./math"
import type { Config } from "./types"    // type-only import

// Re-exporting
export { Vector } from "./math"
export * from "./utils"
export * as math from "./math"
```

No default exports. File extensions optional (`.do` inferred).

Package imports are configured by the nearest `doof.json`. The dependency key is the first import path segment:

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

```doof
import { say } from "hello-doof/hello"
```

Remote dependencies are cached under `~/.doof/packages/` by default. The declared version matches either an exact git tag or a `v`-prefixed tag, so `0.1` can resolve `v0.1`.

## Testing

Doof's current unit-testing story is CLI-driven.

Use these conventions when writing tests:

- Put tests in `*.test.do` files
- Export top-level functions whose names start with `test`
- Test functions must take no parameters
- Test functions must return `void`
- Use `assert(condition, message)` for the primitive assertion
- Import `Assert` from `std/assert` for richer assertion helpers such as `equal`, `notEqual`, `isTrue`, `isFalse`, and `fail`

Example:

```doof
// math.test.do
import { add } from "./math"
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(add(1, 2), 3)
}

export function testAddNegative(): void {
    Assert.equal(add(5, -2), 3, "expected add(5, -2) to equal 3")
}
```

Run tests with the CLI:

```bash
doof test math.test.do
doof test src
doof test --list src
doof test --filter math src
```

Discovery is static rather than reflective. The runner discovers exported test functions at build time, generates a temporary harness, compiles once, and runs each test in its own process.

Practical implications:

- A failed `assert(...)` panics and fails the current test only
- One failing test does not stop later tests from running
- `--filter` matches discovered ids of the form `<relative-path>::<functionName>`
- Helper functions that are not themselves tests should stay unexported or should not use the `test` prefix

Prefer simple assertions in the MVP. If you need reusable setup, keep it in ordinary library helpers and call them from exported test functions.

### Extern C++ Interop

```doof
// Extern class — wraps a C++ class
import class HttpClient from "<httplib.h>" as httplib::Client {
    get(path: string): Result<string, int>
}

// Import function — imports a standalone C/C++ function
import function sin(x: float): float from "<cmath>" as std::sin
import function cos(x: float): float from "<cmath>" as std::cos

// Exported imported functions can be imported by other Doof modules
export import function abs(x: double): double from "<cmath>" as std::abs
```

Prefer these conventions when designing interop boundaries:

- Put shared enums and other small boundary types in a dedicated Doof module such as `types.do`
- Have native C++ include the generated header from that module instead of duplicating constants locally
- Type extern methods directly with those Doof enums, for example `kind(): NativeBoardgameEventKind`, instead of returning `int` codes and decoding them later in Doof
- Keep `Native...` declarations thin and use Doof wrappers only when the native API cannot expose the ergonomic type directly
- Prefer `import function` for pure free-function bridges instead of creating placeholder classes

Example:

```doof
// types.do
export enum Mode { Off = 0, On = 1 }

// bridge.do
import { Mode } from "./types"

import class NativeSwitch from "./native_switch.hpp" {
    mode: Mode
    get(): Mode
}
```

```cpp
#include "types.hpp"

struct NativeSwitch {
    Mode mode;
    Mode get() const { return mode; }
};
```

## JSON Serialization

Classes with all-serializable fields get `.toJSON()` and `.fromJSON()` automatically (generated on-demand):

```doof
class Point { x, y: float }

json := Point(1.5, 2.5).toJSON()            // '{"x":1.5,"y":2.5}'
result := Point.fromJSON(json)               // Result<Point, string>
```

Interface deserialization uses shared `const` discriminator fields. See [references/json-and-metadata.md](references/json-and-metadata.md) for details.

## Concurrency

See [references/concurrency.md](references/concurrency.md) for the full concurrency model.

Key concepts:
- **`isolated` functions** — cannot access mutable global state, safe for workers
- **`async` keyword** — runs isolated functions on the worker pool, returns `Promise<T>`
- **`Actor<T>`** — wraps a class for safe stateful concurrency (sequential message processing)
- **`readonly` parameters required** across concurrency boundaries (zero-copy sharing)

```doof
isolated function compute(data: readonly int[]): int {
    return data.reduce(0, => acc + it)
}

promise := async compute(readonly [1, 2, 3])
result := try! promise.get()
```

## Description Metadata

Optional description strings on declarations for tooling/metadata:

```doof
class Calculator "A simple calculator." {
    add "Adds two numbers."(a "First.": int, b "Second.": int): int => a + b
}
```

Access generated metadata with `ClassName.metadata`. Each entry in `.methods` carries schema strings plus `.invoke(instance, params)`. The metadata object itself also supports name-based dispatch with `.invoke(instance, methodName, params)` returning `Result<string, any>`. For methods declared as `Result<S, F>`, invoke serializes `S` on success, surfaces raw `F` on failure, and keeps `outputSchema` focused on `S`.

## Memory Management

Reference counting with deterministic destructors. Use `weak` references to break cycles. See [references/classes-and-memory.md](references/classes-and-memory.md).

## Common Patterns

### Discriminated Unions

```doof
class TextMsg { const kind = "text"; content: string }
class ImageMsg { const kind = "image"; url: string; width, height: int }
type Message = TextMsg | ImageMsg
```

### Builder / Fluent API

```doof
class Builder {
    value = 0
    add(n: int): Builder { value += n; return this }
    build(): int => value
}
result := Builder().add(1).add(2).build()
```

### Error Propagation Pipeline

```doof
function process(): Result<Output, Error> {
    try input := readFile("data.txt")
    try parsed := parse(input)
    try validated := validate(parsed)
    return Success { value: transform(validated) }
}
```

## Key Differences from TypeScript/JavaScript

- No `var`, no `undefined`
- `:=` for immutable binding (not `const` — that's compile-time only)
- `let` is mutable (like JS `let`)
- No exceptions — `Result` types + `panic`
- `==` is reference equality for objects (not structural)
- No `async`/`await` — `async` returns `Promise`, `.get()` blocks
- No implicit coercion
- Blocks required for `if`/`for`/`while` bodies (statement form)
- `if` expression uses `then` keyword: `if x then a else b`
- No `this` prefix needed in methods (implicit)
- String interpolation: `${}` (like JS template literals)
- `/` cannot be used on two integers — use `\` for integer division or cast with `float()`
- `%` is integer-only — use `int()`, `long()`, `float()`, `double()` for numeric casts
- `Map<K, V>` uses literal syntax `{ key: value }` — no `new Map()` constructor
