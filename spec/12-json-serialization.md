# 12. JSON Serialization

Doof provides built-in JSON serialization and deserialization for class and struct instances. Nominal objects with all-serializable fields and no dedicated `constructor` method are eligible for `.toJsonObject()` and `.fromJsonValue()` with no annotations or special syntax. JSON support code is generated on-demand: the compiler only emits serialization methods when your code actually uses these intrinsics.

## Overview

```doof
class Point {
  x, y: float
}

p := Point { x: 1.5, y: 2.5 }
json := p.toJsonObject()               // JsonObject
result := Point.fromJsonValue(json)    // Result<Point, string>
```

Structs use the same source-level JSON API and return `Result<StructName, string>` from `.fromJsonValue()`, but the generated C++ stores and returns direct values rather than `shared_ptr` objects.

When you need text rather than structured JSON, use the standard JSON helpers:

```doof
import { parseJsonValue, formatJsonValue } from "std/json"

text := formatJsonValue(p.toJsonObject())
parsed := parseJsonValue(text)         // Result<JsonValue, string>
```

`JsonValue` objects preserve insertion order for object keys. `formatJsonValue(...)` emits object members in that order, and generated `.toJsonObject()` methods emit class or struct fields in declaration order.

## On-Demand Generation

JSON methods are only generated for classes, structs, and supported interfaces where user code actually accesses `.toJsonObject()` or `.fromJsonValue()`. If a program never calls these methods, no nominal-object JSON code is generated.

Generation is transitive: if nominal object `A` has a field of type `B` and you call `A.toJsonObject()`, the compiler automatically generates JSON methods for `B` as well.

```doof
class Inner { value: int }
class Outer { inner: Inner }

json := Outer { inner: Inner { value: 42 } }.toJsonObject()
```

## Serialization — `.toJsonObject()`

Every eligible class or struct instance has a `.toJsonObject()` method that returns a `JsonObject` value. `JsonObject` is the intrinsic alias for `Map<string, JsonValue>`, so it can still be passed anywhere a `JsonValue` is expected.

```doof
class User {
  name: string
  age: int
  private email: string
}

u := User { name: "Alice", age: 30, email: "alice@example.com" }
println(formatJsonValue(u.toJsonObject()))
// {"name":"Alice","age":30,"email":"alice@example.com"}
```

### Rules

- All fields are serialized, including `private` and `readonly` fields.
- Literal-valued fields are serialized with their compile-time values.
- Serialization is deep: nested class/struct instances, arrays of serializable nominal objects, and tuples are serialized recursively.
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
| Class or struct instances | JSON object (recursive) |
| `T[]` | JSON array |
| `Tuple<T1, T2, ...>` | JSON array |
| `Map<string, T>` | JSON object when `T` is serializable |
| Enums | JSON string (member name) |
| `T | null` | Value or `null` |
| `JsonValue` | Preserved as-is |

### Non-Serializable Types

The following types are not JSON-serializable. A compile-time error is produced if `.toJsonObject()` or `.fromJsonValue()` is used on a class or struct containing these field types:

- Function types (`(int) → string`)
- `weak` references
- `Actor<T>`
- `Promise<T>`
- `Result<T, E>`
- `void`
- Classes or structs with a dedicated static `constructor(...): Self` or
  `constructor(...): Result<Self, E>` method

```doof
class Bad {
  callback: (int) → void
}

b := Bad { callback: (x) => println(x) }
b.toJsonObject()  // compile error
```

Nominal objects with a dedicated `constructor` method are excluded because custom
construction usually encodes invariants that the automatic field-by-field JSON
deserializer cannot safely recreate.

## Deserialization — `.fromJsonValue()`

Every eligible class or struct has a `.fromJsonValue(json: JsonValue, lenient: bool = false)` method accessible on the type name that returns `Result<TypeName, string>`.

```doof
result := Point.fromJsonValue({ x: 1.5, y: 2.5 })

case result {
  p: Success -> println("Got point: ${p.value.x}, ${p.value.y}")
  e: Failure -> println("Parse error: ${e.error}")
}
```

Generic functions can call `.fromJsonValue()` on a type parameter only when that
parameter has the compiler-known `JsonSerializable` constraint:

```doof
function decode<T: JsonSerializable>(json: JsonValue): Result<T, string> {
  return T.fromJsonValue(json)
}

payload: JsonValue := { name: "Ada" }
user := decode<User>{ json: payload }
```

`JsonSerializable` is a constraint-only intrinsic. It is not a normal value type,
and each concrete type argument must be a class or struct whose fields are JSON-serializable.
The concrete nominal-object JSON methods are still generated on demand when the generic is
instantiated.

### Required vs Optional Fields

Deserialization follows the same rules as object construction:

- Fields without a default initializer are required.
- Fields with a default initializer are optional; the default is used when absent.
- Literal-valued fields are auto-filled; if present in the JSON object, their value must match the compile-time value.

```doof
class Config {
  host: string
  port: int = 8080
  version: "1.0"
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

Interfaces can be deserialized using a shared literal-valued discriminator field. All implementing classes must share a literal-valued field with the same name and distinct string values.

```doof
interface Shape {
  area(): float
}

class Circle implements Shape {
  kind: "circle"
  radius: float

  function area(): float => 3.14159 * radius * radius
}

class Rect implements Shape {
  kind: "rect"
  width, height: float

  function area(): float => width * height
}

result := Shape.fromJsonValue({ kind: "circle", radius: 5.0 })
```

### Discriminator Requirements

- All implementing classes must share a literal-valued field with the same name, such as `kind`.
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
// compile error: implementing classes must share a literal string discriminator
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
  kind: "circle"
  radius: double
}

class Rect {
  kind: "rect"
  width, height: double
}

type Shape = Circle | Rect

result := Shape.fromJsonValue({ kind: "circle", radius: 5.0 })
```

### Alias Requirements

- `.fromJsonValue()` is available only on named type aliases, not on bare union expressions.
- The alias must resolve to a union of classes.
- All member classes must be JSON-serializable.
- All member classes must share a literal string discriminator field with distinct values, the same as interface deserialization.

If these requirements are not met, using `.fromJsonValue()` on the alias is a compile-time error.

## Nested Serialization

Serialization and deserialization are fully recursive:

```doof
class Line {
  start, end: Point
}

line := Line {
  start: Point { x: 0.0, y: 0.0 },
  end: Point { x: 1.0, y: 1.0 }
}

json := line.toJsonObject()
restored := Line.fromJsonValue(json)
```

## Arrays and Tuples

```doof
class Polygon {
  vertices: Point[]
}

poly := Polygon {
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

String-keyed maps serialize as JSON objects and recursively convert their values:

```doof
class Scores {
  values: Map<string, int>
}

scores := Scores.fromJsonValue({ values: { alice: 10, bob: 12 } })
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
