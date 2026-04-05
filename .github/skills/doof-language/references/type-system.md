# Doof Type System Reference

## Primitive Types

| Type | Size | Description |
|------|------|-------------|
| `int` | 32-bit | Integer (default for integer literals) |
| `long` | 64-bit | Large integer |
| `float` | 32-bit | Single-precision floating point |
| `double` | 64-bit | Double-precision floating point (default for decimal literals) |
| `string` | — | Text |
| `char` | — | UTF-8 character |
| `bool` | — | Boolean (`true` / `false`) |
| `void` | — | Unit type |

### Numeric Literals and Suffixes

```doof
let a = 42       // int
let b = 42L      // long (L suffix)
let c = 3.14     // double
let d = 3.14f    // float (f suffix)
```

### Implicit Widening

`int` → `long`, `float` → `double`. Narrowing requires explicit conversion.

### Contextual Numeric Narrowing

When an expected type is known, literals narrow to that type:

```doof
class Point { x, y: float }
let p = Point(0.0, 0.0)      // 0.0 narrowed to float
n: long := 42                 // 42 widened to long
```

This applies in declarations, function arguments, return statements, array elements, and constructor fields.

## Type Inference

Bidirectional type inference — single-step, context-aware.

```doof
// Bottom-up: inferred from expression
let x = 42                       // int
let names = ["Alice", "Bob"]     // string[]

// Top-down: type flows from context
function process(items: int[]): void { }
process([1, 2, 3])               // literal infers int[] from parameter

// Empty collections and null require annotation
let empty: int[] = []
let x: int | null = null
```

### Binding-Sensitive Inference

```doof
items := [1, 2, 3]               // int[] (mutable array, immutable binding)
readonly frozen = [1, 2, 3]      // readonly int[] (deep immutability)
let buffer = [1, 2, 3]           // int[] (fully mutable)
data := readonly [1, 2, 3]       // readonly int[] (explicit modifier)
```

### Function Return Type Inference

Return type can be omitted for unambiguous single-return-type bodies.

## Nullable Types

No implicit null. Nullability is explicit via union types:

```doof
let x: int = null               // ❌ Error
let y: int | null = null         // ✅ Explicit nullable
```

### Nullable vs Optional Fields

```doof
class User {
    name: string                   // Required, non-null
    email: string | null           // Required, nullable (must provide, can be null)
    nickname: string | null = null // Optional (has default), nullable
}
```

### Null Safety via Narrowing

```doof
if value != null {
    // value narrowed to non-null type
}

// Null-coalescing
displayName := name ?? "Anonymous"

// Optional chaining
city := user?.address?.city    // string | null

// Force access (panics on null)
age := user!.age               // panics if user is null
```

## Union Types

```doof
type Value = int | string | bool
type Optional<T> = T | null
```

### Discriminated Unions

Use `const` fields for safe discrimination:

```doof
class Success { const kind = "Success"; value: int }
class Failure { const kind = "Failure"; error: string }
type Result = Success | Failure
```

## Enum Types

### Simple Enums (opaque identifiers)

```doof
enum Direction { North, South, East, West }
```

### Integer-Valued Enums

```doof
enum HttpStatus { OK = 200, Created, Accepted, NoContent = 204 }
// Created = 201, Accepted = 202 (auto-increment)
```

### String-Valued Enums

```doof
enum LogLevel { Debug = "DEBUG", Info = "INFO", Warn = "WARN", Error = "ERROR" }
// Every variant must have a value — no auto-increment for strings
```

### Enum Features

```doof
let d = Direction.North
d.name                        // "North"
HttpStatus.OK.value           // 200
Direction.values()            // readonly Direction[]
Direction.fromName("North")   // Direction | null
HttpStatus.fromValue(200)     // HttpStatus | null
```

### Dot-Shorthand

When the target type is known from context:

```doof
let c: Direction = .East
move(.North)
case direction { .North => moveUp(), .South => moveDown(), ... }
```

### Enums as Union Discriminators

```doof
enum ShapeKind { Circle, Rectangle }

class CircleShape { const kind = ShapeKind.Circle; radius: float }
class RectangleShape { const kind = ShapeKind.Rectangle; width, height: float }
type Shape = CircleShape | RectangleShape

let s: Shape = { kind: .Circle, radius: 5.0 }  // structural construction
```

## Class Types (Nominal)

Two classes with identical structure are distinct types. Use interfaces for structural matching.

## Interface Types (Structural)

Interfaces are automatically satisfied by any class with matching structure. At compile time, they resolve to concrete union types of all matching classes (closed-world compilation).

```doof
interface Drawable { draw(canvas: Canvas): void }
// Any class with a matching draw() method satisfies Drawable
```

Optional explicit `implements` clause for documentation and early error detection.
