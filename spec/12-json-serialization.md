# 12. JSON Serialization

Doof provides built-in JSON serialization and deserialization for class instances. Classes with all-serializable fields are *eligible* for `.toJSON()` and `.fromJSON()` — no annotations or special syntax needed. JSON support code is **generated on-demand**: the compiler only emits serialization methods (and pulls in the JSON library dependency) when your code actually calls `.toJSON()` or `.fromJSON()`.

## Overview

```doof
class Point {
  x, y: float
}

const p = Point { x: 1.5, y: 2.5 }
const json = p.toJSON()              // '{"x":1.5,"y":2.5}'
const result = Point.fromJSON(json)  // Result<Point, string>
```

## On-Demand Generation

JSON methods are only generated for classes (and interfaces) where user code actually accesses `.toJSON()` or `.fromJSON()`. If a program never calls these methods, no JSON code is generated and the nlohmann/json C++ dependency is omitted entirely.

Generation is **transitive**: if class `A` has a field of type `B` and you call `A.toJSON()`, the compiler automatically generates JSON methods for `B` as well.

```doof
class Inner { value: int }
class Outer { inner: Inner }

// Calling toJSON() on Outer triggers JSON generation for both Outer and Inner
const json = Outer { inner: Inner { value: 42 } }.toJSON()
```

## Serialization — `.toJSON()`

Every class instance has a `.toJSON()` method that returns a `string` containing the JSON representation of the object.

```doof
class User {
  name: string
  age: int
  private email: string
}

const u = User { name: "Alice", age: 30, email: "alice@example.com" }
println(u.toJSON())
// {"name":"Alice","age":30,"email":"alice@example.com"}
```

### Rules

- **All fields are serialized**, including `private` and `readonly` fields. Field visibility does not affect serialization.
- **`const` fields are serialized** with their compile-time values.
- **Serialization is deep** — nested class instances, arrays of classes, etc. are serialized recursively.
- **Multi-name fields** (`x, y, z: float`) produce separate JSON keys for each name.
- **Field order** matches declaration order.

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
| `T[]` (arrays) | JSON array |
| `Tuple<T1, T2, ...>` | JSON array |
| Enums (opaque) | JSON string (member name) |
| Enums (string-valued) | JSON string (value) |
| Enums (int-valued) | JSON number (value) |
| `T \| null` | Value or `null` |

### Non-Serializable Types

The following types are **not JSON-serializable**. A compile-time error is produced if `.toJSON()` or `.fromJSON()` is used on a class containing these field types:

- Function types (`(int) → string`)
- `weak` references
- `Actor<T>`
- `Promise<T>`
- `Result<T, E>`
- `void`

```doof
class Bad {
  callback: (int) → void   // not serializable
}

const b = Bad { callback: (x) => println(x) }
b.toJSON()  // ❌ compile error: Field "callback" of type "(int) → void" is not JSON-serializable
```

## Deserialization — `.fromJSON()`

Every class has a `.fromJSON(json: string)` method accessible on the class name that returns `Result<ClassName, string>`.

```doof
const json = '{"x": 1.5, "y": 2.5}'
const result = Point.fromJSON(json)

case result {
  p: Success => println("Got point: \(p.value.x), \(p.value.y)")
  e: Failure => println("Parse error: \(e.error)")
}
```

### Required vs Optional Fields

Deserialization follows the **same rules as object construction**:

- Fields **without** a default initializer are **required** — they must be present in the JSON.
- Fields **with** a default initializer are **optional** — if absent from JSON, the default value is used.
- `const` fields are **auto-filled** — they don't need to be in the JSON. If present, their value must match the compile-time value (otherwise deserialization fails).

```doof
class Config {
  host: string                // required
  port: int = 8080            // optional, defaults to 8080
  const version = "1.0"       // auto-filled, validated if present
}

// Minimal JSON — only required fields
Config.fromJSON('{"host": "localhost"}')
// → Success: Config { host: "localhost", port: 8080, version: "1.0" }

// Full JSON — all fields provided
Config.fromJSON('{"host": "localhost", "port": 3000, "version": "1.0"}')
// → Success: Config { host: "localhost", port: 3000, version: "1.0" }

// Missing required field
Config.fromJSON('{"port": 3000}')
// → Failure: "Missing required field \"host\""

// Wrong const value
Config.fromJSON('{"host": "localhost", "version": "2.0"}')
// → Failure: "Field \"version\" must be \"1.0\" but got \"2.0\""
```

### Type Validation

Field values are type-checked during deserialization:

```doof
Point.fromJSON('{"x": "not a number", "y": 2.5}')
// → Failure: "Field \"x\" expected number but got string"
```

### Unknown Fields

Extra fields in the JSON that don't correspond to class fields are **silently ignored**:

```doof
Point.fromJSON('{"x": 1.0, "y": 2.0, "z": 3.0}')
// → Success: Point { x: 1.0, y: 2.0 } — "z" is ignored
```

### Invalid JSON

Malformed JSON strings produce a failure:

```doof
Point.fromJSON("not json at all")
// → Failure: "Invalid JSON: ..."
```

## Interface Deserialization (Union Types)

Interfaces and union types can be deserialized using a **shared `const` discriminator field**. All implementing classes must share a `const` field with the same name but distinct string values.

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

// Deserialize using the interface name
const result = Shape.fromJSON('{"kind": "circle", "radius": 5.0}')
// → Success: Circle { radius: 5.0 }

const result2 = Shape.fromJSON('{"kind": "rect", "width": 3.0, "height": 4.0}')
// → Success: Rect { width: 3.0, height: 4.0 }
```

### Discriminator Requirements

- All classes implementing the interface must share a `const` field with the **same name** (e.g., `kind`).
- Each class must have a **distinct string value** for the discriminator field.
- If these requirements aren't met, using `.fromJSON()` on the interface produces a compile error.

```doof
interface Animal {}

class Dog implements Animal {
  name: string
  // no discriminator!
}

class Cat implements Animal {
  name: string
  // no discriminator!
}

Animal.fromJSON('...')
// ❌ compile error: Cannot deserialize interface "Animal": all implementing classes
// must share a const string field with distinct values (e.g., const kind = "dog")
```

### Unknown Discriminator Values

If the discriminator value doesn't match any known implementing class:

```doof
Shape.fromJSON('{"kind": "triangle", "base": 3.0}')
// → Failure: "Unknown Shape variant: \"triangle\""
```

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

const json = line.toJSON()
// {"start":{"x":0.0,"y":0.0},"end":{"x":1.0,"y":1.0}}

const restored = Line.fromJSON(json)  // Result<Line, string>
```

## Arrays and Tuples

```doof
class Polygon {
  vertices: Point[]
}

const poly = Polygon {
  vertices: [Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 0.0 }, Point { x: 0.0, y: 1.0 }]
}

poly.toJSON()
// {"vertices":[{"x":0.0,"y":0.0},{"x":1.0,"y":0.0},{"x":0.0,"y":1.0}]}
```

Tuples serialize as JSON arrays:

```doof
class Pair {
  value: Tuple<string, int>
}

Pair { value: ("hello", 42) }.toJSON()
// {"value":["hello",42]}
```

## Enums

```doof
enum Color { Red, Green, Blue }

class Pixel {
  x, y: int
  color: Color
}

Pixel { x: 10, y: 20, color: Color.Green }.toJSON()
// {"x":10,"y":20,"color":"Green"}
```

## Reserved Method Names

`toJSON` and `fromJSON` are reserved intrinsic method names. User-defined methods with these names on classes produce a compile error:

```doof
class Foo {
  x: int

  function toJSON(): string {  // ❌ compile error: "toJSON" is a reserved intrinsic method
    return "custom"
  }
}
```
