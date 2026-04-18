# Type System

## Overview

Doof features a strong, static type system with bidirectional type inference, structural interfaces, nominal classes, and deep immutability tracking. The type system emphasises explicitness where it matters while reducing boilerplate through intelligent inference.

---

## Primitive Types

| Type | Size | Description |
|------|------|-------------|
| `byte` | 8-bit | Unsigned byte (`0`-`255`) |
| `int` | 32-bit | Integer (default for integer literals) |
| `long` | 64-bit | Large integer |
| `float` | 32-bit | Single-precision floating point |
| `double` | 64-bit | Double-precision floating point (default for decimal literals) |
| `string` | — | Text |
| `char` | — | UTF-8 character |
| `bool` | — | Boolean (`true` / `false`) |
| `void` | — | Unit type (functions with no return value) |

### The `JsonValue` Type

Doof provides a built-in `JsonValue` carrier for JSON-compatible data:

```javascript
payload: JsonValue := { name: "Ada", scores: [1, 2, 3] }
```

`JsonValue` is an exact recursive carrier, not a general implicit conversion sink. Its shape is:

- `null`
- `bool`
- `byte`
- `int`
- `long`
- `float`
- `double`
- `string`
- `JsonValue[]`
- `Map<string, JsonValue>`
- unions composed from the cases above

This has two important consequences:

- JSON literals remain ergonomic through contextual typing, so `value: JsonValue := [1, 2, 3]` and `value: JsonValue := { answer: 42 }` are valid.
- Pre-built typed collections do not implicitly convert to `JsonValue`. For example, `int[]` and `Map<string, int>` are not assignable to `JsonValue`; use JsonValue-shaped collections instead.

64-bit integers are preserved as `long` inside `JsonValue`, including values parsed from JSON that do not fit in `int`.

When a `Map<string, JsonValue>` or `JsonValue[]` is assigned to `JsonValue`, the runtime preserves reference semantics for the underlying shared container rather than copying it.

### Numeric Literals

```javascript
let a = 42       // int (default for integer literals)
let b = 42L      // long (explicit suffix)
let c = 3.14     // double (default for decimal literals)
let d = 3.14f    // float (explicit suffix)

// Context can influence literal interpretation
let b: byte = 42    // Literal interpreted as byte
let x: long = 42    // Literal interpreted as long
let y: float = 3.14 // Literal interpreted as float
```

### Implicit Numeric Widening

Numeric types can be implicitly widened to larger types. Narrowing requires explicit conversion.

```javascript
let b: byte = 42
let i: int = b       // ✅ Implicit widening byte → int

let i: int = 42
let l: long = i      // ✅ Implicit widening int → long

let f: float = 3.14f
let d: double = f    // ✅ Implicit widening float → double

let l: long = 1000L
let i: int = l       // ❌ Error: potential data loss

let i: int = 255
let b: byte = i      // ❌ Error: potential data loss
```

**Rationale:** Widening is always safe (no precision/range loss), while narrowing can lose data and should be explicit.

### Explicit Numeric Casts

To convert between numeric types explicitly, use function-call syntax with the type name:

```javascript
let x: int = 42
let b: byte = byte(x)       // int → byte
let f: float = float(x)      // int → float (explicit cast)
let d: double = double(x)    // int → double
let n: int = int(3.14)       // double → int (truncates)
let l: long = long(x)        // int → long

// Useful for division: avoid "/" on two integers
a := 7
b := 2
result := float(a) / float(b)  // 3.5
```

Numeric casts accept exactly one numeric argument and return the target type. Casting to `byte` lowers to `uint8_t` in generated C++. Casting from a wider type to a narrower type (e.g., `double` → `int`) truncates the value.

### Safe String Conversion

To format primitive values as strings explicitly, use `string(...)` constructor syntax:

```javascript
let answer: string = string(42)
let ok: string = string(true)
let ratio: string = string(3.5)
```

`string(...)` accepts exactly one primitive argument of type `byte`, `int`, `long`, `float`, `double`, `string`, `char`, or `bool` and returns a `string`.

### Numeric Parse Methods

Numeric types expose a static `.parse()` method for fallible string parsing:

```javascript
let count: Result<int, ParseError> = int.parse("42")
let channel: Result<byte, ParseError> = byte.parse("255")
let total: Result<long, ParseError> = long.parse("9007199254740991")
let ratio: Result<double, ParseError> = double.parse("3.14159")
```

These methods return `Result<T, ParseError>` with the following builtin error cases:

```javascript
enum ParseError { InvalidFormat, Overflow, Underflow, EmptyInput }
```

Parsing is explicit and separate from numeric casts: `int("42")` is still invalid, while `int.parse("42")` returns `Success(42)`.

### String Properties and Methods

Strings support a `.length` property and the following built-in methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `.length` | `int` (property) | Number of bytes in the string |
| `.indexOf(s)` | `(string): int` | Position of first occurrence, or `-1` |
| `.contains(s)` | `(string): bool` | Whether the string contains the substring |
| `.startsWith(s)` | `(string): bool` | Whether the string starts with the prefix |
| `.endsWith(s)` | `(string): bool` | Whether the string ends with the suffix |
| `.substring(start, end)` | `(int, int): string` | Extract substring by start/end indices |
| `.slice(start)` | `(int): string` | Extract substring from start to end |
| `.trim()` | `(): string` | Remove leading/trailing whitespace |
| `.trimStart()` | `(): string` | Remove leading whitespace |
| `.trimEnd()` | `(): string` | Remove trailing whitespace |
| `.toUpperCase()` | `(): string` | Convert to uppercase |
| `.toLowerCase()` | `(): string` | Convert to lowercase |
| `.replace(search, repl)` | `(string, string): string` | Replace first occurrence |
| `.replaceAll(search, repl)` | `(string, string): string` | Replace all occurrences |
| `.split(delim)` | `(string): string[]` | Split into array of strings |
| `.charAt(index)` | `(int): string` | Character at index (as string) |
| `.repeat(count)` | `(int): string` | Repeat string N times |

```javascript
s := "Hello, World!"
s.length              // 13
s.indexOf("World")    // 7
s.contains("World")   // true
s.startsWith("Hello") // true
s.substring(0, 5)     // "Hello"
s.toUpperCase()       // "HELLO, WORLD!"
s.split(", ")         // ["Hello", "World!"]
"  hi  ".trim()       // "hi"
"abc".repeat(2)       // "abcabc"
"foo bar".replace("foo", "baz")  // "baz bar"
```

### Non-Null Assertion

The postfix `!` operator asserts that a nullable expression is non-null. It strips `null` from the type at compile time. At runtime, if the value is actually null, the program will panic.

```javascript
name: string | null := "Alice"
println(name!)                  // ✅ Asserts non-null, type is string
greet(name!)                    // ✅ Works in function argument position

node.next!.value                // ✅ Alternative: !. force-unwrap member access
```

---

## Type Inference

Doof uses **bidirectional type inference** — single-step, context-aware inference without aggressive propagation.

### Basic Inference Rules

```javascript
// ✅ Type inferred from initialiser
let x = 42                        // int
let y = 3.14                      // double
let names = ["Alice", "Bob"]      // string[]
let point = Point(1.0, 2.0)       // Point
scores: Map := { "Alice": 100 }   // Map<string, int>
unique: Set := [1, 2, 3]          // Set<int>

// ❌ Cannot infer from empty collections
let empty = []                    // Error: type cannot be inferred
let nums: int[] = []              // ✅ Explicit annotation required
m: Map := {}                      // Error: empty map needs full annotation
s: Set := []                      // Error: empty set needs full annotation

// ❌ Cannot infer from null
let x = null                      // Error: type cannot be inferred
let x: int | null = null          // ✅ Explicit annotation required
```

### Bidirectional Flow

Type information flows **both directions** in a single step:

```javascript
// Top-down: expected type known from context
function process(items: int[]): void { }
process([1, 2, 3])  // Literal infers int[] from parameter type

// Bottom-up: type known from expression
let nums = [1, 2, 3]  // int[] inferred from literal contents
process(nums)          // Type-checked against parameter

// Object initialisation
function draw(p: Point): void { }
draw({ x: 1.0, y: 2.0 })  // Object literal infers Point from parameter
draw((1.0, 2.0))            // Positional literal infers Point from parameter

let p: Point = { x: 1.0, y: 2.0 }  // ✅ Explicit annotation provides context
let q = { x: 1.0, y: 2.0 }         // ❌ Error: object literal needs contextual type information
```

Object literals do not infer an anonymous structural type on their own. They must be checked against a contextual target such as a variable annotation, parameter type, return type, array element type, or constructor field type.

### Contextual Numeric Narrowing

When an expected type is known from context, numeric literals are interpreted as that type even when the default would differ:

```javascript
class Point { x, y: float }

// Without context: 0.0 is double, 42 is int
let d = 0.0   // double
let i = 42    // int

// With context: literals narrow to the expected type
let p = Point(0.0, 0.0)        // 0.0 interpreted as float (from field type)
p := Point { x: 0.0, y: 0.0 }  // Same — float context from field type
x: float := 3.14               // 3.14 interpreted as float

// Integer literals also narrow contextually
n: long := 42                  // 42 interpreted as long
f: float := 1                  // 1 interpreted as float
```

**Rules:**
- Decimal literals (`0.0`, `3.14`) narrow from `double` → `float` when expected type is `float`
- Integer literals (`42`, `1`) widen to `long`, `float`, or `double` when expected
- This applies wherever an expected type flows: declarations, function arguments, return statements, array elements, constructor fields

### Transitive Contextual Typing

Expected types propagate through collection literals and method calls:

```javascript
class Point { x, y: float }

// Expected type flows into array elements
points: Point[] := [{ x: 1.0, y: 2.0 }, { x: 3.0, y: 4.0 }]

// Also works with positional syntax
points: Point[] := [(1.0, 2.0), (3.0, 4.0)]

// And through function arguments
function process(points: Point[]): void { }
process([{ x: 0.0, y: 0.0 }])  // Element inherits Point context

// And through array method calls like .push()
let verts: Point[] = []
verts.push({ x: 1.0, y: 2.0 })  // Inferred as Point construction
verts.push((3.0, 4.0))           // Also works with positional syntax

nums := [1, 2, 3, 4]
tail := nums.slice(1, 3)        // Returns int[]
hasTwo := nums.contains(2)      // true
```

### Binding-Sensitive Inference

Binding keywords influence type inference and mutability:

```javascript
// := provides shallow immutability - mutable collection type
items := [1, 2, 3]        // int[] (mutable array, immutable binding)
items.push(4)             // ✅ OK - array is mutable
items = [5, 6]            // ❌ Error - binding is immutable

// let prefers mutable types
let buffer = [1, 2, 3]    // int[]
buffer.push(4)            // ✅ OK
buffer = [5, 6]           // ✅ OK

// readonly provides deep immutability
readonly frozen = [1, 2, 3]       // readonly int[]
frozen.push(4)                    // ❌ Error - array is readonly
frozen = [5, 6]                   // ❌ Error - binding is immutable

// Explicit readonly modifier on collection literal
data := readonly [1, 2, 3]        // readonly int[]
data.push(4)                      // ❌ Error - array is readonly

// Explicit type overrides inference
explicit: int[] := [1, 2, 3]     // int[] (explicit overrides)
```

### Function Return Type Inference

```javascript
// Return type inferred from body (single-step)
function double(x: int) => x * 2  // Returns int

// Ambiguous cases require annotation
function ambiguous(flag: bool) {
    if flag {
        return 1
    }
    return "hello"
}  // ❌ Error: return type unclear

function clarified(flag: bool): int | string {
    if flag {
        return 1
    }
    return "hello"
}  // ✅ Explicit annotation
```

---

## Nullable Types

Doof has **no implicit null** — nullability is explicit via union types:

```javascript
let x: int = null        // ❌ Error: int is not nullable
let y: int | null = null  // ✅ Explicit nullable type
```

### Nullable vs Optional Fields

These concepts are orthogonal:

```javascript
class User {
    name: string                   // Required, non-null
    email: string | null           // Required, nullable
    nickname: string | null = null // Optional (has default), nullable
}

let u1 = User { name: "Alice", email: null }          // ✅ Must provide email
let u2 = User { name: "Bob", email: "bob@example.com" }  // ✅
let u3 = User { name: "Charlie" }                     // ❌ Error: email is required
let u4 = User { name: "Alice", email: null, nickname: "Ali" }  // ✅
```

### Null Safety

```javascript
function getLength(s: string | null): int {
    return s.length  // ❌ Error: s might be null
}

function safeLengthV1(s: string | null): int {
    if s == null {
        return 0
    }
    return s.length  // ✅ Type narrowed to string
}

function safeLengthV2(s: string | null): int {
    return if s == null then 0 else s.length  // ✅ Type narrowing in if-expression
}
```

---

## Union Types

Union types express "one of several types":

```javascript
type Value = int | string | bool
type Optional<T> = T | null

let x: int | string = 42
x = "hello"  // ✅ Valid reassignment within union
x = true     // ❌ Error: bool not in union
```

### Discriminated Unions

Use `const` fields to create discriminated unions:

```javascript
class Success {
    const kind = "Success"
    value: int
}

class Failure {
    const kind = "Failure"
    error: string
}

type Result = Success | Failure
```

---

## Enum Types

Enums define a **closed set of named values** — a type-safe alternative to magic numbers or string constants.

### Simple Enums

When no values are assigned, variants are opaque identifiers with no underlying representation exposed to the programmer:

```javascript
enum Color { Red, Green, Blue }

enum Direction {
    North,
    South,
    East,
    West
}
```

### Integer-Valued Enums

Enum variants can have explicit integer values. If a variant omits a value, it is implicitly the previous variant's value + 1. The first variant defaults to 0 if unspecified:

```javascript
enum Direction {
    North = 1,
    South = 2,
    East = 4,
    West = 8
}

enum HttpStatus {
    OK = 200,
    Created,        // 201
    Accepted,       // 202
    NoContent = 204
}
```

### String-Valued Enums

Enum variants can have explicit string values. **Every variant must have a value** — auto-increment does not apply to strings:

```javascript
enum Color { Red = "RED", Green = "GREEN", Blue = "BLUE" }

enum LogLevel {
    Debug = "DEBUG",
    Info = "INFO",
    Warn = "WARN",
    Error = "ERROR"
}
```

### Accessing Enum Values

```javascript
let dir = Direction.North       // Direction
let status = HttpStatus.OK      // HttpStatus
let level = LogLevel.Debug      // LogLevel
```

### Shorthand Enum References

When the target type is known from context, enum variants can be referenced with **dot-shorthand** — a leading `.` without the enum name:

```javascript
let c: Direction = .East          // Direction.East
let level: LogLevel = .Warn       // LogLevel.Warn

function move(dir: Direction): void { ... }
move(.North)                      // Direction.North

function getLevel(): LogLevel {
    return .Info                   // LogLevel.Info
}
```

Shorthand works anywhere the compiler can infer the enum type from context:
- Variable declarations with explicit type annotations
- Function arguments with typed parameters
- Return statements in functions with explicit return types
- Case arms matching on an enum value

```javascript
// Shorthand in case expressions
case direction {
    .North => moveUp(),
    .South => moveDown(),
    .East  => moveRight(),
    .West  => moveLeft()
}

// Equivalent to:
case direction {
    Direction.North => moveUp(),
    Direction.South => moveDown(),
    Direction.East  => moveRight(),
    Direction.West  => moveLeft()
}
```

### Enum Properties

All enums have a `.name` property returning the variant's declared name as a string:

```javascript
let d = Direction.North
print(d.name)  // "North"
```

Integer-valued and string-valued enums additionally have a `.value` property:

```javascript
let s = HttpStatus.OK
print(s.name)   // "OK"
print(s.value)  // 200

let l = LogLevel.Debug
print(l.name)   // "Debug"
print(l.value)  // "DEBUG"
```

### Enum Utility Methods

```javascript
// Get all variants
Direction.values()   // readonly Direction[] — all variants in declaration order

// Convert from name
Direction.fromName("North")   // Direction | null

// Convert from value (integer or string enums only)
HttpStatus.fromValue(200)     // HttpStatus | null
LogLevel.fromValue("DEBUG")   // LogLevel | null
```

### Enum Equality and Comparison

Enum values support equality comparison. Integer-valued enums also support ordering:

```javascript
let a = Direction.North
let b = Direction.North
a == b  // true
a != Direction.South  // true

// Integer enums support ordering
HttpStatus.OK < HttpStatus.NoContent  // true (200 < 204)
```

### Enums as Union Discriminators

Enum values can be used as `const` field values to discriminate unions, providing a type-safe alternative to string-based `const kind` fields:

```javascript
enum ShapeKind { Circle, Rectangle, Triangle }

class CircleShape {
    const kind = ShapeKind.Circle
    radius: float
}

class RectangleShape {
    const kind = ShapeKind.Rectangle
    width, height: float
}

class TriangleShape {
    const kind = ShapeKind.Triangle
    a, b, c: float
}

type Shape = CircleShape | RectangleShape | TriangleShape

// Structural construction using enum discriminator
let s: Shape = { kind: .Circle, radius: 5.0 }  // Constructs CircleShape
```

This provides stronger type safety than string-based discrimination — misspelled variant names are compile-time errors rather than silent bugs.

### Enums vs Discriminated Unions

Use **enums** for a fixed set of named values without associated data:

```javascript
enum Status { Active, Inactive, Suspended }
```

Use **discriminated unions** when variants carry different data:

```javascript
class TextMessage {
    const kind = "Text"
    content: string
}

class ImageMessage {
    const kind = "Image"
    url: string
    width, height: int
}

type Message = TextMessage | ImageMessage
```

---

## Class Types (Nominal)

Classes define **nominal types** — two classes with identical structure are distinct types:

```javascript
class Point {
    readonly x: float
    readonly y: float
}

class Vector {
    readonly x: float
    readonly y: float
}

let p: Point = Vector { x: 1.0, y: 2.0 }  // ❌ Error: type mismatch
let p: Point = Point { x: 1.0, y: 2.0 }   // ✅ OK
```

---

## Interface Types (Structural)

Interfaces define **structural contracts**. In Doof's closed-world compilation model, interfaces are automatically satisfied by any class with matching structure.

### Automatic Structural Matching

```javascript
interface Thing2D {
    readonly x: float
    readonly y: float
}

class Point {
    readonly x: float
    readonly y: float
}

class Vector {
    readonly x: float
    readonly y: float
}

// At compile time, Thing2D resolves to: Point | Vector | ...any other matching classes
function distance(a: Thing2D, b: Thing2D): float {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

let p = Point { x: 1.0, y: 2.0 }
let v = Vector { x: 3.0, y: 4.0 }
distance(p, v)  // ✅ Both structurally compatible
```

### Optional Explicit Implementation

Classes can optionally declare interface implementation for validation:

```javascript
class Point implements Thing2D {
    readonly x: float
    readonly y: float
}

class BadPoint implements Thing2D {  // ❌ Compile error
    x: float  // Error: field must be readonly to match interface
    readonly y: float
}
```

### Type Construction with Interfaces

```javascript
interface Positioned {
    readonly x: float
    readonly y: float
}

// ❌ Ambiguous — multiple classes match
let p: Positioned = { x: 1.0, y: 2.0 }  // Error: multiple candidates

// ✅ Must use explicit constructor
let p: Positioned = Point { x: 1.0, y: 2.0 }
let v: Positioned = Vector { x: 1.0, y: 2.0 }
```

### Const Fields Enable Disambiguation

```javascript
type Result = Success | Failure

// ✅ Const field disambiguates which type to construct
let r1: Result = { kind: "Success", value: 42 }   // Constructs Success
let r2: Result = { kind: "Failure", error: "timeout" }  // Constructs Failure

// ❌ Invalid const value
let r3: Result = { kind: "Unknown", value: 42 }   // Error: no matching type
```

**Single Candidate Rule:** Type inference from literals succeeds only if exactly one type matches both the const field value(s) and the complete structure.

---

## Generic Types

Doof provides **built-in generic collection types**. User-defined generic types are planned for a future version.

| Type | Shorthand | Description |
|------|-----------|-------------|
| `Array<T>` | `T[]` | Mutable array |
| `ReadonlyArray<T>` | `readonly T[]` | Immutable array |
| `Map<K, V>` | — | Mutable key-value map |
| `ReadonlyMap<K, V>` | — | Immutable map |
| `Set<T>` | — | Mutable set |
| `ReadonlySet<T>` | — | Immutable set |
| `Tuple<T1, T2, ...>` | — | Fixed-size heterogeneous tuple |

```javascript
let nums: int[] = [1, 2, 3]
let matrix: int[][] = [[1, 2], [3, 4]]

readonly immutable: readonly string[] = ["a", "b", "c"]
immutable[0] = "x"  // ❌ Error: readonly array

let scores: Map<string, int> = { "Alice": 100, "Bob": 95 }
let unique: Set<int> = [1, 2, 3, 2, 1]  // Contains {1, 2, 3}
```

When a declaration or default value uses `Map`, `ReadonlyMap`, `Set`, or `ReadonlySet` **without type arguments**, the checker may infer the missing type arguments only from a **same-site non-empty homogeneous literal**.

```javascript
scores: Map := { "Alice": 100, "Bob": 95 }        // Map<string, int>
readonlyScores: ReadonlyMap := { "Alice": 100 }    // ReadonlyMap<string, int>
unique: Set := [1, 2, 3]                             // Set<int>
frozen: ReadonlySet := [1, 2, 3]                     // ReadonlySet<int>
```

This inference does **not** apply outside same-site literal contexts. Return types, interface fields, type aliases, and other type-only positions must use full type arguments.

### Map Type

`Map<K, V>` is an intrinsic generic type for key-value mappings. Maps are backed by hash tables and provide O(1) average-case access.

#### Map Literal Syntax

Maps use `{ key: value }` literal syntax within `{ }`. Empty braces `{}` produce an empty map when the target type is `Map<K, V>`.

When the annotation omits type arguments entirely, non-empty homogeneous literals can supply both type arguments:

```javascript
scores: Map := { "Alice": 100, "Bob": 95 }        // Map<string, int>
scores: ReadonlyMap := { "Alice": 100 }            // ReadonlyMap<string, int>
scores: readonly Map<string, int> = { "Alice": 100 } // Same as ReadonlyMap<string, int>
scores: Map<string, int> = { "Alice": 100 }        // Also valid
```

Both map type arguments must be omitted together. Partial annotations such as `Map<string>` and `ReadonlyMap<string>` are compile errors.

Supported key types are `string`, `int`, `long`, `char`, `bool`, and enum types. In practice, the common supported forms are string keys, integer keys, long keys, and enum keys.

```javascript
// Integer keys
let m: Map<int, string> = { 1: "one", 2: "two" }

// Long keys
let ids: Map<long, string> = { 1L: "one", 2L: "two" }

// String keys
let scores: Map<string, int> = { "Alice": 100, "Bob": 95 }

// Dot-shorthand syntax (enum keys with type inference)
enum Suit { Spades, Hearts, Diamonds, Clubs }
let piles: Map<Suit, int> = { .Spades: 0, .Hearts: 0, .Diamonds: 0, .Clubs: 0 }

// Explicit enum access also works in map initializers
enum Color { Red, Green, Blue }
let labels: Map<Color, string> = { Color.Red: "Red", Color.Green: "Green" }

// Empty map
let empty: Map<int, string> = {}
m: Map := {}                     // Error: cannot infer K and V from an empty map
```

The same key restrictions apply in all map initialization contexts, including declaration initializers, return-context literals, argument-context literals, parameter defaults, and field defaults.

Bare map inference is limited to same-site literals on declarations and defaults. For example, `function getMap(): Map { ... }` is rejected because there is no same-site literal attached to the return type annotation.

Integer literals are contextually widened when a `long` key type is expected, so this is valid:

```javascript
let counts: Map<long, int> = { 1: 10, 2: 20 }
```

Floating-point keys are rejected even though they parse, to avoid surprising hash/equality behavior around exact comparison and `NaN` values.

```javascript
let bad: Map<float, int> = {}          // Error
let alsoBad = { 1.5: "value" }       // Error
```

Tuple, class-instance, and other non-scalar key types are also rejected.

```javascript
let badTuple: Map<Tuple<int, string>, int> = {}  // Error

class Point { x: int }
let badPoint: Map<Point, int> = {}               // Error
```

### Set Type

`Set<T>` is an intrinsic generic type for unique values. When a `Set<T>` is expected, array literal syntax initializes the set and duplicate values are coalesced by the runtime representation.

```javascript
let unique: Set<int> = [1, 2, 3, 2, 1]
let empty: Set<string> = []
enum Color { Red, Blue }
let palette: Set<Color> = [Color.Red, Color.Blue, Color.Red]
let ids: Set<long> = [1, 2, 3]  // int literals widen to long in Set<long> context
unique: Set := [1, 2, 3]        // Set<int>
frozen: ReadonlySet := [1, 2, 3] // ReadonlySet<int>
frozen2: readonly Set<int> = [1, 2, 3] // Same as ReadonlySet<int>
```

When the annotation omits type arguments entirely, the checker may infer `T` only from a same-site non-empty homogeneous literal. Empty literals still require a full annotation:

```javascript
unique: Set := [1, 2, 3]          // Set<int>
frozen: ReadonlySet := [1, 2, 3]  // ReadonlySet<int>
unique: Set<int> = [1, 2, 3]      // Also valid
empty: Set := []                  // Error
```

Extra type arguments such as `Set<int, string>` or `ReadonlySet<int, string>` are compile errors.

Supported set element types are `string`, `int`, `long`, `char`, `bool`, and enums. The same rule applies to declaration initializers, return-context literals, argument-context literals, parameter defaults, and field defaults.

`float`, `double`, tuples, class instances, and other non-supported element types are rejected by the checker with an explicit set-element diagnostic.

#### Set Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `.size` | `int` | Number of entries |
| `.has(value)` | `bool` | Check if value exists |
| `.add(value)` | `void` | Insert value |
| `.delete(value)` | `void` | Remove value |
| `.values()` | `T[]` | Array of all values |

```javascript
let unique: Set<int> = [1, 2, 3]
unique.add(4)
print(unique.has(2))
unique.delete(1)
print(unique.size)
```

#### Map Methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `.size` | `int` | Number of entries |
| `.get(key)` | `V \| null` | Retrieve value or null |
| `.set(key, value)` | `void` | Insert or update entry |
| `.has(key)` | `bool` | Check if key exists |
| `.delete(key)` | `void` | Remove entry by key |
| `.keys()` | `K[]` | Array of all keys |
| `.values()` | `V[]` | Array of all values |

```javascript
let m: Map<string, int> = { "a": 1, "b": 2 }
m.set("c", 3)
print(m.get("a"))     // 1
print(m.has("d"))     // false
print(m.size)         // 3
m.delete("b")

for (key, value) of m {
  print("${key} = ${value}")
}
```

#### Map Index Access

Maps support bracket-based index access, which is equivalent to direct key lookup:

```javascript
let m: Map<string, int> = { "a": 1 }
x := m["a"]   // returns 1
m["b"] = 2    // inserts new entry
```

### Tuple Type

`Tuple` is an intrinsic parameterised type that accepts a varying number of type parameters, providing lightweight ad-hoc grouping without defining a class.

A `Tuple<T1, T2, ..., Tn>` is equivalent to a class with fields `_1: T1`, `_2: T2`, ..., `_n: Tn`. All standard class construction and destructuring rules apply.

```javascript
// Explicit type
let pair: Tuple<int, string> = (1, "hello")
let vec: Tuple<float, float, float> = (1.0, 2.0, 3.0)

// Type inference from positional literal (when no named type matches)
coords := (3.14, 2.71)           // Tuple<double, double>
mixed := (42, "hello", true)     // Tuple<int, string, bool>

// Field access via _1, _2, etc.
print(pair._1)   // 1
print(pair._2)   // "hello"
print(vec._3)    // 3.0
```

#### Tuple Construction

Tuples use positional literal syntax — the same `(value, ...)` form used for class positional construction:

```javascript
// When target type is known, constructs that type
let p: Point = (1.0, 2.0)                  // Constructs Point (not a Tuple)
let t: Tuple<float, float> = (1.0, 2.0)    // Constructs Tuple

// When target type is unknown, infers Tuple
result := (200, "OK")                      // Tuple<int, string>
```

#### Tuple Destructuring

Tuples support positional destructuring, just like classes:

```javascript
function divmod(a: int, b: int): Tuple<int, int> {
    return (a / b, a % b)
}

(quotient, remainder) := divmod(17, 5)

// Mutable bindings
let (q, r) = divmod(17, 5)
q = 0  // ✅ OK

// Partial destructuring — trailing fields can be omitted
function getRecord(): Tuple<int, string, bool> {
    return (1, "Alice", true)
}

(id, name) := getRecord()  // Ignores third field
```

#### Tuples as Return Types

Tuples are particularly useful for functions that return multiple values:

```javascript
function minMax(items: int[]): Tuple<int, int> {
    let min = items[0]
    let max = items[0]
    for item of items {
        if item < min { min = item; }
        if item > max { max = item; }
    }
    return (min, max)
}

(lo, hi) := minMax([3, 1, 4, 1, 5, 9])
print(lo)  // 1
print(hi)  // 9
```

#### Design Notes

- `Tuple` is an **intrinsic type** — it cannot be redefined or extended by user code
- The number of type parameters is variable (variadic) — `Tuple<A>`, `Tuple<A, B>`, `Tuple<A, B, C>`, etc. are all valid
- Tuples are **nominal** — `Tuple<int, int>` is not structurally compatible with a class that has two `int` fields
- When a positional literal `(v1, v2, ...)` has no contextual type expectation from a named class, it infers as a `Tuple`

### Type Aliases

```javascript
type UserId = int
type Callback = (value: int): void
type StringMap = Map<string, string>
type Result<T> = Success<T> | Failure
type Pair<A, B> = Tuple<A, B>         // Alias for common tuple arities
```

---

## Function Types

Functions are first-class values with explicit type signatures **including parameter names**:

```javascript
type Callback = (value: int, description: string): void
type Predicate<T> = (item: T): bool
type Transform = (input: int): int
type BinaryOp = (left: int, right: int): int
```

Parameter names are part of the function type — they define the contract for how the function should be called.

---

## Deep Readonly / Mutability

**Readonly is transitive** — it applies to the entire object graph, not just the immediate binding.

### Shallow Collection Readonly vs Deep Readonly Bindings

Doof distinguishes between collection-level readonly types and deep immutability on `readonly` bindings and fields:

```javascript
// := : Shallow immutability (immutable binding, mutable content)
data := [1, 2, 3]              // int[] - binding immutable, content mutable
data.push(4)                   // ✅ OK - array is mutable
data = [5, 6]                  // ❌ Error - binding is immutable

// readonly binding: deep immutability
readonly frozen = [1, 2, 3]    // readonly int[] - binding is deep readonly
frozen.push(4)                 // ❌ Error - array is readonly
frozen = [5, 6]                // ❌ Error - binding is immutable

// Collection modifier / type: readonly collection only
data := readonly [1, 2, 3]     // readonly int[] - readonly collection surface

class MutablePoint {
    x: float
    y: float
}

points: readonly MutablePoint[] = readonly [MutablePoint { x: 1.0, y: 2.0 }]  // ✅ OK
points[0].x = 2.0      // ✅ OK - element objects can still be mutable
points.push(MutablePoint { x: 3.0, y: 4.0 })  // ❌ Error - readonly array
```

### Deep Readonly Compatibility Rules

When `readonly` appears on a binding or class field, the referenced value must be deeply immutable. A type is deeply readonly-compatible if:

1. **Primitives** — `int`, `long`, `float`, `double`, `string`, `bool` — always readonly-compatible
2. **Classes** — all fields must be `readonly`
3. **Arrays** — are treated as `readonly T[]`, and `T` must itself be deeply readonly-compatible
4. **Collections** — are treated as `ReadonlyMap<K, V>` / `ReadonlySet<T>`, and nested types must be deeply readonly-compatible
5. **Unions** — all variants must be readonly-compatible
6. **Functions** — always readonly-compatible (immutable references)

Readonly collection annotations are shallow at the collection boundary: they stop collection mutation, but they do not require element or value types to be deeply immutable. Collection mutability is still part of the type, so `int[]` is not assignable to `readonly int[]`, `ReadonlyArray<int>`, `ReadonlyMap<K, V>`, or `ReadonlySet<T>`, and the reverse conversions are also rejected.

The parser also accepts `readonly Array<T>`, `readonly Map<K, V>`, and `readonly Set<T>` as equivalents of `ReadonlyArray<T>`, `ReadonlyMap<K, V>`, and `ReadonlySet<T>`. Other uses of `readonly` in type position are parse errors.

### Readonly Classes

```javascript
// Readonly-compatible class
class ImmutablePoint {
    readonly x: float
    readonly y: float
}

// Not readonly-compatible
class MutablePoint {
    x: float
    y: float
}

readonly p1 = ImmutablePoint { x: 1.0, y: 2.0 }  // ✅ OK
readonly p2 = MutablePoint { x: 1.0, y: 2.0 }    // ❌ Error: class has mutable fields
```

### Nested Readonly Constraints

Readonly classes must contain only readonly-compatible types:

```javascript
class Container {
    readonly items: int[]           // ✅ OK - implied as readonly int[]
    readonly count: int             // ✅ OK
}

class BadContainer {
    readonly data: MutablePoint  // ❌ Error: readonly field can't hold mutable type
}

class BadPoints {
    readonly items: MutablePoint[]  // ❌ Error: elements are mutable
}
```

### Bindings vs Fields vs Values

```javascript
class Container {
    readonly items: int[]           // field surface is treated as readonly int[]
    count: int                      // mutable field
}

// Immutable binding (shallow) to object with mixed mutability
c1 := Container { items: [1, 2, 3], count: 3 }
c1.items = [4, 5]       // ❌ Error: readonly field
c1.items.push(4)        // ❌ Error: readonly array
c1.count = 4            // ✅ OK: mutable field
c1 = Container { ... }  // ❌ Error: immutable binding (:=)

// Mutable binding with same object
let c2 = Container { items: [1, 2, 3], count: 3 }
c2.count = 4            // ✅ OK: mutable field
c2 = Container { ... }  // ✅ OK: mutable binding

// Deep readonly binding makes everything readonly
readonly c3 = Container { items: [1, 2, 3], count: 3 }
c3.count = 4            // ❌ Error: readonly binding
c3 = Container { ... }  // ❌ Error: can't reassign readonly
```

---

## Weak References

Doof uses reference counting for memory management (see [Classes and Interfaces](07-classes-and-interfaces.md)). To break reference cycles, Doof provides a `weak` qualifier that creates references which do not contribute to the reference count.

### Syntax

`weak` is a **reference qualifier**, not a type modifier. It applies to the entire type expression:

```javascript
class TreeNode {
    children: TreeNode[] = []
    parent: weak TreeNode | null = null  // weak reference to (TreeNode | null)
}
```

In union types, `weak` qualifies the whole reference — `weak Foo | Bar` means a weak reference to a value of type `Foo | Bar`, not `(weak Foo) | Bar`:

```javascript
class Observer {
    target: weak Widget | Panel  // weak (Widget | Panel)
}
```

### Access Semantics

Because a weak-referenced object may have been destroyed, accessing a `weak` reference yields `Result<T, WeakReferenceError>`. The standard `?.` and `!.` operators provide lightweight access:

```javascript
class Node {
    backEdge: weak Node | null
    
    visitParent(): void {
        backEdge?.visit()   // No-op if reference was cleared
        backEdge!.visit()   // Panic if reference was cleared
    }
}
```

### Weak Reference Rules

| Aspect | Behaviour |
|--------|-----------|
| Reference count | Does not contribute |
| Access type | `Result<T, WeakReferenceError>` |
| Cleared when | Referent's count reaches zero |
| Use with `?.` | Propagates WeakReferenceError on cleared reference |
| Use with `!.` | Panics if cleared |
| Scope | Fields, local variables |

---

## Type Narrowing

Doof performs flow-sensitive type narrowing based on control flow.

### Null Checks

```javascript
function process(value: int | null): void {
    if value != null {
        print(value * 2)  // value narrowed to int
    }
}

// Early return pattern
function getLength(s: string | null): int {
    if s == null {
        return 0
    }
    return s.length  // s narrowed to string
}
```

### Narrowing Invalidation

```javascript
let x: int | null = getValue()
if x != null {
    print(x * 2)  // ✅ Narrowed to int
    x = null       // Assignment invalidates narrowing
    print(x * 2)  // ❌ Error: x is int | null
}
```

### Narrowing Scope Rules

| Context | Narrowed? | Rationale |
|---------|-----------|-----------|
| Local variables / parameters | ✅ After checks | Invalidated by assignments |
| Immutable bindings (`:=`) | ✅ Always safe | Cannot be reassigned (shallow) |
| Deep readonly bindings | ✅ Always safe | Cannot be reassigned or mutated |
| Object fields via `readonly` binding | ✅ Safe | Binding can't change |
| Object fields via `:=` binding | ✅ Safe | Binding can't change (shallow) |
| Object fields via `let` binding | ❌ Not narrowed | Value could change; use `case` with capture |

### Discriminated Union Narrowing

For discriminated unions, use `case` statements with type capture:

```javascript
type Result = Success | Failure

// ✅ Use case for type narrowing
function handle(r: Result): void {
    case r {
        s: Success => print(s.value),
        f: Failure => print(f.error)
    }
}

// ❌ If statements don't narrow discriminated unions
function handle(r: Result): void {
    if r.kind == "Success" {
        print(r.value)  // Error: r is still Result type
    }
}
```

**Simple rule:** "If checks for null narrow. For type discrimination across unions and enums, use `case`."

---

## Summary

| Feature | Approach |
|---------|----------|
| Type identity | Nominal (classes), Structural (interfaces) |
| Nullability | Explicit via `T \| null` |
| Enums | Named value sets with optional int/string values |
| Inference | Bidirectional, single-step |
| Immutability | Deep/transitive readonly |
| Generics | Built-in collections and Tuple (user-defined planned) |
| Function types | Named parameters in signatures |
| Type narrowing | Flow-sensitive for null; `case` for unions and enums |
| Weak references | `weak T` — non-owning reference, access yields Result |
| Widening | Implicit for safe numeric conversions |
