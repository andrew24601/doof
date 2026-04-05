# Doof JSON Serialization and Metadata Reference

## JSON Serialization

Classes with all-serializable fields automatically get `.toJSON()` and `.fromJSON()`. Code is generated **on-demand** — only when these methods are actually called in code. Generation is transitive (nested classes are included).

### `.toJSON()` — Instance Method

Returns a JSON string representation.

```doof
class User {
    name: string
    age: int
    private email: string
}

println(User("Alice", 30, "a@b.com").toJSON())
// {"name":"Alice","age":30,"email":"alice@example.com"}
```

Rules:
- All fields serialized (including `private`, `readonly`, `const`)
- Serialization is deep / recursive
- Field order matches declaration order

### Serializable Types

| Doof Type | JSON |
|-----------|------|
| `int`, `long` | number |
| `float`, `double` | number |
| `string`, `char` | string |
| `bool` | boolean |
| `null` | null |
| Class instances | object (recursive) |
| `T[]` | array |
| `Tuple<T1, T2>` | array |
| Enums (opaque) | string (member name) |
| Enums (string) | string (value) |
| Enums (int) | number (value) |
| `T | null` | value or null |

**Not serializable:** function types, `weak` references, `Actor<T>`, `Promise<T>`, `Result<T,E>`, `void`.

### `.fromJSON()` — Static Method

```doof
const result = Point.fromJSON('{"x": 1.5, "y": 2.5}')  // Result<Point, string>
```

Rules:
- Fields without defaults are **required**
- Fields with defaults are **optional** (use default if absent)
- `const` fields are auto-filled; if present in JSON, value must match
- Extra JSON fields are silently ignored
- Type mismatches produce `Failure`
- Invalid JSON produces `Failure`

### Interface Deserialization

Requires a shared `const` discriminator field with distinct string values across all implementing classes:

```doof
interface Shape { area(): float }

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

Shape.fromJSON('{"kind": "circle", "radius": 5.0}')  // Result<Shape, string>
```

Compile error if implementing classes lack a shared const discriminator.

### Reserved Names

`toJSON` and `fromJSON` are reserved — user-defined methods with these names produce a compile error.

## Description Metadata

Optional description strings on declarations (pure metadata, no runtime effect):

```doof
class DevAssistant "AI assistant for development." {
    rootPath "Path to the project root.": string
    
    // Multi-name fields: each name gets its own description
    x "x-axis", y "y-axis", z "z-axis": float
    
    createProject "Creates a new project scaffold."(
        name "The name of the project.": string
    ): string => name
}
```

Supported on: `class`, fields, `function`, methods, parameters, `interface`, interface fields/methods, `enum`, enum variants, `type` alias, `const`, `readonly`.

Not supported on: `let`, `:=`, imports/exports.

## Tool Metadata (`.metadata`)

Classes with descriptions can expose structured metadata (generated on-demand):

```doof
const meta = Calculator.metadata

meta.name               // "Calculator"
meta.description        // "A simple calculator."
meta.methods            // MethodReflection[]
meta.methods[0].name            // "add"
meta.methods[0].description     // "Adds two numbers."
meta.methods[0].inputSchema     // JSON Schema Draft 7 string
meta.methods[0].outputSchema    // JSON Schema Draft 7 string
meta.methods[0].invoke(instance, '{"a": 1, "b": 2}')  // Result<string, string>
```

### JSON Schema Type Mappings

| Doof type | JSON Schema |
|-----------|-------------|
| `int`, `long` | `{ "type": "integer" }` |
| `float`, `double` | `{ "type": "number" }` |
| `string`, `char` | `{ "type": "string" }` |
| `bool` | `{ "type": "boolean" }` |
| `void` | `{ "type": "null" }` |
| `T[]` | `{ "type": "array", "items": { ... } }` |
| `(T, U)` | `{ "type": "array", "prefixItems": [...] }` |
| `T \| U` | `{ "anyOf": [...] }` |
| `enum E` | `{ "enum": ["A", "B", ...] }` |
| Class type | `{ "$ref": "#/$defs/ClassName" }` |
