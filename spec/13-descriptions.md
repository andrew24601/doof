# 13 — Description Metadata

## Overview

Doof supports optional **description strings** on declarations. A description is a string literal placed immediately after the identifier name in a declaration. Descriptions are pure metadata — they have no runtime effect and are emitted as comments in the generated C++.

Descriptions are designed to support future features such as JSON Schema generation, OpenAPI/Swagger definitions, MCP tool descriptions, and LLM tool metadata.

## Syntax

An optional string literal may appear after the name in any of the following declarations:

```
class Name "description" { ... }
function name "description"(params): ReturnType { ... }
const name "description": Type = value
readonly name "description": Type = value
interface Name "description" { ... }
enum Name "description" { ... }
type Name "description" = Type
```

### Fields and Parameters

Field and parameter names may also carry descriptions:

```
class Example {
    // Single-name field
    rootPath "Path to root.": string

    // Multi-name field — each name gets its own description
    x "x-axis", y "y-axis", z "z-axis": float

    // Partial descriptions — only some names described
    width "Width in px", height: int

    // Method with described parameters
    create "Creates a resource."(
        name "The resource name.": string,
        path "Where to create it.": string
    ): bool { ... }
}

interface Tool {
    name "The tool name.": string
    execute "Run the tool."(input "Tool input.": string): string
}

enum Status "Current status." {
    Active "Currently active.",
    Inactive,
    Archived "No longer in use."
}
```

## Semantics

- Descriptions are **optional** on all supported declarations. Omitting a description has no effect.
- Descriptions are **compile-time metadata only** — they do not affect type checking, code generation semantics, or runtime behaviour.
- Descriptions are stored in the AST and available to tooling.
- In the generated C++, descriptions are emitted as `//` comments above the corresponding declaration.
- Parameter descriptions are emitted as `// @param name description` comments above the function.

## Supported Declaration Types

| Declaration | Description position |
|---|---|
| `class` | After class name, before `implements` or `{` |
| Class field | After each field name, before `,` or `:` |
| `function` | After function name, before `(` |
| Method (short form) | After method name, before `(` |
| Parameter | After parameter name, before `:` or `=` |
| `interface` | After interface name, before `{` |
| Interface field | After field name, before `:` |
| Interface method | After method name, before `(` |
| `enum` | After enum name, before `{` |
| Enum variant | After variant name, before `=` or `,` |
| `type` alias | After type name, before `<` or `=` |
| `const` | After const name, before `:` or `=` |
| `readonly` | After readonly name, before `:` or `=` |

## Not Supported

- `let` declarations (local variables, not part of external metadata)
- Immutable bindings (`:=`)
- Import/export specifiers

## C++ Emission

```doof
class DevAssistant "AI assistant for development workflows." {
    rootPath "Path to the project root.": string
    createProject "Creates a new project scaffold."(
        name "The name of the project.": string
    ): string {
        return name
    }
}
```

Generates:

```cpp
// AI assistant for development workflows.
struct DevAssistant : public std::enable_shared_from_this<DevAssistant> {
    // Path to the project root.
    std::string rootPath;

    // ...

    // Creates a new project scaffold.
    // @param name The name of the project.
    std::string createProject(std::string name) {
        return name;
    }
};
```

## Tool Metadata (`.metadata`)

Classes with descriptions can expose **structured tool metadata** for interoperability with OpenAPI, MCP, and LLM tool-calling systems. This is an on-demand feature — metadata is only generated when user code accesses `.metadata`.

### `ClassMetadata`

Accessing `ClassName.metadata` returns a `ClassMetadata` object with the following members:

| Member | Type | Description |
|---|---|---|
| `.name` | `string` | The class name |
| `.description` | `string` | The class description (empty string if none) |
| `.methods` | `MethodReflection[]` | Array of public, non-static method reflections |

```doof
class Calculator "A simple calculator." {
    add "Adds two numbers."(a "First number.": int, b "Second number.": int): int {
        return a + b
    }
}

const meta = Calculator.metadata
println(meta.name)          // "Calculator"
println(meta.description)   // "A simple calculator."
```

### `MethodReflection`

Each entry in `.methods` is a `MethodReflection` with:

| Member | Type | Description |
|---|---|---|
| `.name` | `string` | The method name |
| `.description` | `string` | The method description (empty string if none) |
| `.inputSchema` | `JsonValue` | JSON Schema (Draft 7) for the input parameters |
| `.outputSchema` | `JsonValue` | JSON Schema for the success return payload |
| `.invoke` | `(instance, params) → Result<JsonValue, JsonValue>` | Invoke the method with JSON params |

### `ClassMetadata.invoke`

The metadata object itself also exposes an `.invoke` helper for name-based dispatch:

```doof
const meta = Calculator.metadata
const calc = Calculator { }
const result = meta.invoke(calc, "add", { a: 1, b: 2 })
if result.isSuccess() {
    println(result.value)  // 3
}
```

**Signature:** `(instance: ClassName, methodName: string, params: JsonValue) → Result<JsonValue, JsonValue>`

- `instance` — the object to call the method on
- `methodName` — the public instance method name to invoke
- `params` — a JSON object with parameter names as keys
- On **success**: returns the method's return value as `JsonValue`, or `null` for void methods
- On **failure**: returns a `JsonValue`. Framework failures such as invalid parameters or unknown method names return `{ code: 400, message: string }`. If the method itself returns `Result<S, JsonValue>`, then the `JsonValue` failure is passed through unchanged. For any other `Result<S, F>` failure type, invoke returns `{ code: 500, message: "An error occurred" }`.

### `.invoke`

Each method reflection has an `.invoke` member that dispatches a method call using `JsonValue` parameters, returning a `Result<JsonValue, JsonValue>`:

```doof
const meta = Calculator.metadata
const method = meta.methods[0]
const calc = Calculator { }
const result = method.invoke(calc, { a: 1, b: 2 })
if result.isSuccess() {
    println(result.value)  // 3
}
```

**Signature:** `(instance: ClassName, params: JsonValue) → Result<JsonValue, JsonValue>`

- `instance` — the object to call the method on
- `params` — a JSON object with parameter names as keys
- On **success**: returns the method's return value as `JsonValue`, or `null` for void methods
- On **failure**: returns a `JsonValue` using the same failure rules as `ClassMetadata.invoke`

### JSON Schema

The `inputSchema` and `outputSchema` strings contain JSON Schema Draft 7. Input schemas describe the method parameters as an object; output schemas describe the success return payload.

If a method returns `Result<S, F>`, then `outputSchema` describes `S`, not the `Result` wrapper. `Result<void, F>` uses `{ "type": "null" }`.

**Type mappings to JSON Schema:**

| Doof type | JSON Schema |
|---|---|
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

When a method parameter or return type references another class, that class's schema is lifted into a top-level `$defs` string on the metadata object (accessible via the internal `defs` field in the generated C++).

### Result Members

The `Result<JsonValue, JsonValue>` returned by `.invoke` supports:

| Member | Type | Description |
|---|---|---|
| `.value` | `JsonValue` | The success value (only valid when `isSuccess()` is true) |
| `.error` | `JsonValue` | The failure payload (only valid when `isFailure()` is true) |
| `.isSuccess()` | `bool` | Whether the invocation succeeded |
| `.isFailure()` | `bool` | Whether the invocation failed |
| `.map(fn)` | `Result<U, JsonValue>` | Transform the success payload |
| `.mapError(fn)` | `Result<JsonValue, U>` | Transform the failure payload |
| `.andThen(fn)` | `Result<U, JsonValue>` | Chain another Result-returning operation from success |
| `.orElse(fn)` | `Result<JsonValue \| U, U2>` | Recover from a failure with another Result-returning operation |
| `.unwrapOr(value)` | `JsonValue` | Return the success payload or a fallback |
| `.unwrapOrElse(fn)` | `JsonValue` | Return the success payload or compute a fallback from the error |
| `.ok()` | `JsonValue \| null` | Convert success to a nullable value |
| `.err()` | `JsonValue \| null` | Convert failure to a nullable value |

### Restrictions

- **Generic classes** cannot use `.metadata` (compile error)
- All public method parameters must be **JSON-serializable** (compile error otherwise)
- Public method return types must either be JSON-serializable, or be `Result<S, F>` where `S` is JSON-serializable (or `void`). Failure types do not need to be JSON-serializable; invoke only passes them through when `F` is exactly `JsonValue`.
- `"metadata"`, `"toJsonValue"`, and `"fromJsonValue"` are **reserved** — classes cannot define methods or fields with these names
- Private and static methods are excluded from metadata and invoke dispatch

### On-demand Generation

Metadata code is only generated when user code accesses `ClassName.metadata`. Classes referenced in method signatures automatically get JSON serialization support (`toJsonValue`/`fromJsonValue`) generated as well.

## Future Use

Description metadata is additionally designed to power:

- **OpenAPI / Swagger** — operation and parameter descriptions for API documentation
- **Code documentation** — automated doc generation from source
