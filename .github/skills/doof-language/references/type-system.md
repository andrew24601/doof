# Doof Type System Reference

## Primitive Types

| Type | Description |
| --- | --- |
| `byte` | 8-bit unsigned integer |
| `int` | 32-bit integer; default integer literal type |
| `long` | 64-bit integer |
| `float` | 32-bit floating point |
| `double` | 64-bit floating point; default decimal literal type |
| `string` | text |
| `char` | UTF-8 character |
| `bool` | boolean |
| `void` | unit type |

### Numeric Literals and Conversions

```doof
a := 42
b := 42L
c := 3.14
d := 3.14f

x: float := 3.14
n: long := 42
count := 30_000
```

Rules:

- `int` widens to `long`.
- `float` widens to `double`.
- Contextual literal narrowing applies when the target type is known.
- Numeric separators may appear between digits only.

Explicit numeric casts use function-call syntax:

```doof
small := int(large)
ratio := double(count)
```

Checked numeric narrowing uses `as` rather than cast syntax.

### String Conversion and Parse Helpers

```doof
label := string(42)
ok := string(true)

parsed := int.parse("42")
big := long.parse("9007199254740991")
ratio := double.parse("3.14")
```

`string(...)` accepts primitive values. Numeric parse helpers return `Result<T, ParseError>`.

## Type Inference

Doof uses single-step, context-aware inference.

```doof
names := ["Alice", "Bob"]
process([1, 2, 3])

empty: int[] = []
maybeName: string | null := null
```

Binding kind affects inference:

```doof
items := [1, 2, 3]
let buffer = [1, 2, 3]
readonly frozen = [1, 2, 3]
data := readonly [1, 2, 3]
```

Return types may be inferred for unambiguous functions.

## Nullable Types

Nullability is explicit through unions.

```doof
name: string | null := null
value: int := null
```

The second line is a compile error.

Important rule: plain `if value != null` and `if value == null` do not change the static type. Use declaration-`else`, `case`, `as`, or postfix `!` for explicit narrowing.

```doof
if name != null {
    println(name!)
}

displayName := name ?? "Anonymous"
city := user?.address?.city
age := user!.age
```

## Union Types

```doof
type Value = int | string | bool
type Optional<T> = T | null
```

Discriminated unions usually use shared `const` fields.

```doof
class Success { const kind = "Success"; value: int }
class Failure { const kind = "Failure"; error: string }
type ParseResult = Success | Failure
```

## `JsonValue`

`JsonValue` is an exact recursive JSON carrier.

```doof
payload: JsonValue := { name: "Ada", scores: [1, 2, 3] }
```

Accepted shapes:

- `null`
- `bool`, `byte`, `int`, `long`, `float`, `double`, `string`
- `JsonValue[]`
- `Map<string, JsonValue>`
- unions composed from those cases

Rules:

- Contextual typing keeps literals ergonomic.
- Pre-built `int[]` or `Map<string, int>` values do not implicitly convert to `JsonValue`.
- `JsonObject` is a built-in alias for the exact object carrier type `Map<string, JsonValue>`.
- `long` values are preserved, including parsed JSON integers beyond `int` range.
- Object key insertion order is preserved for literals, formatting, and generated JSON methods.
- Assignments from `JsonValue[]` or `Map<string, JsonValue>` preserve shared-container reference semantics.

```doof
payload: JsonObject := { "name": "Ada" }
row: Map<string, JsonValue> := payload
```

## Enum Types

```doof
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200, NotFound = 404 }
enum Color { Red = "RED", Green = "GREEN", Blue = "BLUE" }
```

Features:

```doof
let d: Direction = .East
d.name
HttpStatus.OK.value
Direction.values()
Direction.fromName("North")
HttpStatus.fromValue(200)
```

Dot-shorthand works when the target type is known.

## Collections

### Arrays

`T[]` is an ordered, reference-counted collection.

```doof
numbers := [1, 2, 3]
names: string[] = ["Alice", "Bob"]
```

Common APIs:

| Member | Notes |
| --- | --- |
| `.length` | element count |
| `.push(value)` | mutable arrays only |
| `.pop()` | `Result<T, string>` |
| `.contains(value)` | membership test |
| `.indexOf(value)` | first match or `-1` |
| `.some(pred)` | any match |
| `.every(pred)` | all match |
| `.filter(pred)` | preserves mutability |
| `.map(mapper)` | preserves mutability |
| `.slice(start, end)` | shallow slice |
| `.buildReadonly()` | mutable array only |
| `.cloneMutable()` | shallow copy |

`readonly T[]` and `ReadonlyArray<T>` are readonly collection types. Mutable and readonly arrays are distinct and do not implicitly convert between each other.

### Tuples

```doof
pair: (int, string) = (1, "one")
(id, label) := pair
```

Tuples are fixed-length and positionally destructured.

### Maps

```doof
scores: Map<string, int> = { "Alice": 100, "Bob": 95 }
ids: Map<long, string> = { 1L: "one", 2L: "two" }
frozenScores: ReadonlyMap := { "Alice": 100 }
```

Supported key types are `string`, `int`, `long`, `char`, `bool`, and enums.

Rules:

- Insertion order is preserved.
- Replacing an existing key does not move it.
- Deleting and reinserting appends it to the end.
- Empty maps require a full annotation.
- Omitted `Map` or `ReadonlyMap` type arguments work only for same-site non-empty homogeneous literals.

Common APIs:

| Member | Return | Notes |
| --- | --- | --- |
| `.get(key)` | `Result<V, string>` | failure when missing |
| `.set(key, value)` | `void` | mutable maps only |
| `.has(key)` | `bool` | key test |
| `.delete(key)` | `void` | mutable maps only |
| `.keys()` | `K[]` | insertion order |
| `.values()` | `V[]` | insertion order |
| `.size` | `int` | entry count |

Index access reads and writes directly. `ReadonlyMap<K, V>` is the readonly variant.

### Sets

```doof
unique: Set<int> = [1, 2, 3, 2, 1]
palette: Set<Color> = [Color.Red, Color.Blue]
frozenIds: ReadonlySet := [1, 2, 3]
```

Supported element types are `string`, `int`, `long`, `char`, `bool`, and enums.

Rules:

- Insertion order is preserved.
- Duplicate inserts keep the first position.
- Empty literals require a full type annotation.
- Omitted `Set` or `ReadonlySet` type arguments work only for same-site non-empty homogeneous literals.

Common APIs: `.size`, `.has()`, `.add()`, `.delete()`, `.values()`.

`Set<T>` and `ReadonlySet<T>` are distinct collection types.

### Streams

`Stream<T>` is a pull-based iteration surface with `next(): T | null`.

```doof
class Counter implements Stream<int> {
    current = 0
    end: int

    next(): int | null {
        if current < end {
            value := current
            current = current + 1
            return value
        }
        return null
    }
}
```

`for value of someStream` works anywhere an iterable is expected.

## Class and Interface Type Identity

- Classes are nominal.
- Interfaces are structural.
- Interface types resolve against the closed world of matching classes at compile time.

```doof
interface Drawable { draw(canvas: Canvas): void }
```

Use classes for identity-rich domain types and interfaces for structural contracts.