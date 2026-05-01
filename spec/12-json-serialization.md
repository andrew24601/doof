# 12. JSON Serialization

Doof provides built-in JSON serialization and deserialization for class instances. Classes with all-serializable fields are eligible for `.toJsonObject()` and `.fromJsonValue()` with no annotations or special syntax. JSON support code is generated on-demand: the compiler only emits serialization methods when your code actually uses these intrinsics.

## Overview

```doof
class Point {
  x, y: float
}

const p = Point { x: 1.5, y: 2.5 }
const json = p.toJsonObject()               // JsonObject
const result = Point.fromJsonValue(json)    // Result<Point, string>
```

When you need text rather than structured JSON, use the standard JSON helpers:

```doof
import { parseJsonValue, formatJsonValue } from "std/json"

const text = formatJsonValue(p.toJsonObject())
const parsed = parseJsonValue(text)         // Result<JsonValue, string>
```

`JsonValue` objects preserve insertion order for object keys. `formatJsonValue(...)` emits object members in that order, and generated `.toJsonObject()` methods emit class fields in declaration order.

## On-Demand Generation

JSON methods are only generated for classes and interfaces where user code actually accesses `.toJsonObject()` or `.fromJsonValue()`. If a program never calls these methods, no class JSON code is generated.

Generation is transitive: if class `A` has a field of type `B` and you call `A.toJsonObject()`, the compiler automatically generates JSON methods for `B` as well.

```doof
class Inner { value: int }
class Outer { inner: Inner }

const json = Outer { inner: Inner { value: 42 } }.toJsonObject()
```

## Serialization — `.toJsonObject()`

Every eligible class instance has a `.toJsonObject()` method that returns a `JsonObject` value. `JsonObject` is the intrinsic alias for `Map<string, JsonValue>`, so it can still be passed anywhere a `JsonValue` is expected.

```doof
class User {
  name: string
  age: int
  private email: string
}

const u = User { name: "Alice", age: 30, email: "alice@example.com" }
println(formatJsonValue(u.toJsonObject()))
// {"name":"Alice","age":30,"email":"alice@example.com"}
```

### Rules

- All fields are serialized, including `private` and `readonly` fields.
- `const` fields are serialized with their compile-time values.
- Serialization is deep: nested class instances, arrays of classes, and tuples are serialized recursively.
- Multi-name fields (`x, y, z: float`) produce separate JSON object keys.
- Field order follows declaration order.

### Serializable Field Types

| Doof Type | JSON Representation |
|-----------|-------------------|
| `int`, `long` | JSON number |
| `float`, `double` | JSON number |
| `string` | JSON string |
| `char` | JSON string (single character) |
| `bool` | JSON boolean |
| `null` | JSON `null` |
| Class instances | JSON object (recursive) |
| `T[]` | JSON array |
| `Tuple<T1, T2, ...>` | JSON array |
| Enums | JSON string (member name) |
| `T | null` | Value or `null` |
| `JsonValue` | Preserved as-is |

### Non-Serializable Types

The following types are not JSON-serializable. A compile-time error is produced if `.toJsonObject()` or `.fromJsonValue()` is used on a class containing these field types:

- Function types (`(int) → string`)
- `weak` references
- `Actor<T>`
- `Promise<T>`
- `Result<T, E>`
- `void`

```doof
class Bad {
  callback: (int) → void
}

const b = Bad { callback: (x) => println(x) }
b.toJsonObject()  // compile error
```

## Deserialization — `.fromJsonValue()`

Every eligible class has a `.fromJsonValue(json: JsonValue, lenient: bool = false)` method accessible on the class name that returns `Result<ClassName, string>`.

```doof
const result = Point.fromJsonValue({ x: 1.5, y: 2.5 })

case result {
  p: Success -> println("Got point: ${p.value.x}, ${p.value.y}")
  e: Failure -> println("Parse error: ${e.error}")
}
```

### Required vs Optional Fields

Deserialization follows the same rules as object construction:

- Fields without a default initializer are required.
- Fields with a default initializer are optional; the default is used when absent.
- `const` fields are auto-filled; if present in the JSON object, their value must match the compile-time value.

```doof
class Config {
  host: string
  port: int = 8080
  const version = "1.0"
}

Config.fromJsonValue({ host: "localhost" })
// Success: Config { host: "localhost", port: 8080, version: "1.0" }

Config.fromJsonValue({ port: 3000 })
// Failure: "Missing required field \"host\""

Config.fromJsonValue({ host: "localhost", version: "2.0" })
// Failure: "Field \"version\" must be \"1.0\" but got \"2.0\""
```

### Type Validation

Field values are checked during deserialization:

```doof
Point.fromJsonValue({ x: "not a number", y: 2.5 })
// Failure: "Field \"x\" expected number but got string"
```

### Unknown Fields

Extra object fields that do not correspond to class fields are ignored:

```doof
Point.fromJsonValue({ x: 1.0, y: 2.0, z: 3.0 })
// Success: Point { x: 1.0, y: 2.0 }
```

### Non-Object Inputs

`.fromJsonValue()` expects a JSON object. Passing a non-object `JsonValue` fails:

```doof
Point.fromJsonValue("not an object")
// Failure: "Expected JSON object"
```

If your input starts as text, import `parseJsonValue` from `std/json` and handle that result separately.

### Lenient Mode

Passing `true` for the optional `lenient` parameter enables a limited set of scalar coercions during deserialization while keeping the default strict behaviour unchanged.

```doof
class Todo {
  title: string
  done: bool
}

Todo.fromJsonValue({ title: null, done: 1 }, true)
// Success: Todo { title: "", done: true }
```

When `lenient` is `true`:

- Required `string` fields accept `null` as `""`.
- `string` fields also accept booleans and numbers via stringification.
- `bool` fields accept booleans, numbers (`0` => `false`, non-zero => `true`), and strings `"true"`, `"false"`, `"1"`, and `"0"`.
- Numeric fields accept booleans as `1` or `0`.

Lenient mode does not relax structural requirements: objects must still be objects, arrays must still be arrays, required fields must still be present unless they have defaults, and unsupported coercions still fail.

## Interface Deserialization

Interfaces can be deserialized using a shared `const` discriminator field. All implementing classes must share a `const` field with the same name and distinct string values.

```doof
interface Shape {
  area(): float
}

class Circle implements Shape {
  const kind = "circle"
  radius: float

  function area(): float => 3.14159 * radius * radius
}

class Rect implements Shape {
  const kind = "rect"
  width, height: float

  function area(): float => width * height
}

const result = Shape.fromJsonValue({ kind: "circle", radius: 5.0 })
```

### Discriminator Requirements

- All implementing classes must share a `const` field with the same name, such as `kind`.
- Each implementing class must use a distinct string discriminator value.
- If these requirements are not met, using `.fromJsonValue()` on the interface is a compile-time error.

```doof
interface Animal {}

class Dog implements Animal {
  name: string
}

class Cat implements Animal {
  name: string
}

Animal.fromJsonValue({})
// compile error: implementing classes must share a const string discriminator
```

### Unknown Discriminator Values

```doof
Shape.fromJsonValue({ kind: "triangle", base: 3.0 })
// Failure: "Unknown kind: \"triangle\""
```

## Named Union Alias Deserialization

Named union aliases over classes can also be deserialized when they follow the same discriminator rule as interfaces.

```doof
class Circle {
  const kind = "circle"
  radius: double
}

class Rect {
  const kind = "rect"
  width, height: double
}

type Shape = Circle | Rect

const result = Shape.fromJsonValue({ kind: "circle", radius: 5.0 })
```

### Alias Requirements

- `.fromJsonValue()` is available only on named type aliases, not on bare union expressions.
- The alias must resolve to a union of classes.
- All member classes must be JSON-serializable.
- All member classes must share a `const` string discriminator field with distinct values, the same as interface deserialization.

If these requirements are not met, using `.fromJsonValue()` on the alias is a compile-time error.

## Nested Serialization

Serialization and deserialization are fully recursive:

```doof
class Line {
  start, end: Point
}

const line = Line {
  start: Point { x: 0.0, y: 0.0 },
  end: Point { x: 1.0, y: 1.0 }
}

const json = line.toJsonObject()
const restored = Line.fromJsonValue(json)
```

## Arrays and Tuples

```doof
class Polygon {
  vertices: Point[]
}

const poly = Polygon {
  vertices: [Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }, Point { x: 0.0, y: 1.0 }]
}

println(formatJsonValue(poly.toJsonObject()))
// {"vertices":[{"x":0.0,"y":0.0},{"x":1.0,"y":0.0},{"x":0.0,"y":1.0}]}
```

Tuples serialize as JSON arrays:

```doof
class Pair {
  value: Tuple<string, int>
}

println(formatJsonValue(Pair { value: ("hello", 42) }.toJsonObject()))
// {"value":["hello",42]}
```

## Enums

```doof
enum Color { Red, Green, Blue }

class Pixel {
  x, y: int
  color: Color
}

println(formatJsonValue(Pixel { x: 10, y: 20, color: Color.Green }.toJsonObject()))
// {"x":10,"y":20,"color":"Green"}
```

Examples in this chapter that call `formatJsonValue(...)` assume:

```doof
import { formatJsonValue } from "std/json"
```

## Reserved Method Names

`toJsonObject` and `fromJsonValue` are reserved intrinsic method names. User-defined methods with these names on classes produce a compile-time error:

```doof
class Foo {
  x: int

  function toJsonObject(): JsonObject {
    return { "x": 1 }
  }
}
```
