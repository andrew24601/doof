# Doof Classes and Memory Management Reference

## Class Declarations

```doof
class User {
    readonly id: int
    name: string
    email: string | null = null
    role: string = "user"
    const version = 1

    greet(): string => "Hi, ${name}"

    private internalHelper(): void { }

    static create(name: string): User => User { id: nextId(), name: name }
}
```

Each field needs either a type annotation or a default so the compiler can determine its type.

### Field Modifiers

| Modifier | Behavior |
| --- | --- |
| none | mutable field |
| `readonly` | set once at construction |
| `const` | compile-time constant |
| `private` | file-scoped visibility |

## Construction

```doof
user := User { id: 1, name: "Alice" }
user := User(1, "Alice")

readonly name = "Alice"
user := User { id: 1, name }

extended := ExtendedConfig { ...base, timeout: 30 }
line := Line { start: { x: 0.0, y: 0.0 }, end: { x: 1.0, y: 1.0 } }
```

Rules:

- Named construction may omit fields that have defaults.
- Positional construction follows declaration order and may omit trailing defaults.
- Name-value shorthand such as `{ name }` expands to `{ name: name }`.
- Spread fields work in named construction.

### Const Fields in Construction

Nominal construction auto-fills `const` fields, while structural construction requires them explicitly.

```doof
result1 := Success { value: 42 }
result2: Result = { kind: "Success", value: 42 }
```

## Methods and `this`

```doof
class Counter {
    count = 0

    increment(n: int): void { count += n }
    getCount(): int => count
    reset(count: int): void { this.count = count }
    add(n: int): Counter { count += n; return this }
}
```

- Instance methods get implicit `this` access.
- Use `this.` only for disambiguation.
- Fluent APIs commonly return `this`.

## Static Members

```doof
class Rectangle {
    width: int
    static kind = "rectangle"
    static describe(): string => "Rectangles"
}

rect := Rectangle { width: 10 }

Rectangle.kind
Rectangle.describe()
rect::kind
rect::describe()
```

Rules:

- Static methods cannot access instance state.
- Access statics with `.` through a named class or interface type.
- Access statics with `::` through an instance or interface value.
- `rect.kind` and `rect.describe()` are invalid for statics.

## Private Members

`private` is file-scoped.

```doof
class Config {
    private secret: string
    name: string
}

export function makeConfig(name: string): Config {
    return Config { secret: "hidden", name: name }
}
```

Private fields without defaults block external construction.

## Interfaces

```doof
interface Drawable {
    draw(canvas: Canvas): void
}

interface Shape {
    area(): float
    static describe(): string
}
```

Rules:

- Interfaces are structural.
- Classes satisfy them automatically when structure matches.
- `implements` is optional and mainly useful for documentation and early validation.
- Interface statics are checked structurally against class statics and are invoked from interface values with `::`.
- Interface members cannot be `private`.

## Memory Management

### Reference Counting

Class instances are reference-counted. When the last strong reference disappears, the destructor runs immediately.

### Destructors

```doof
class FileHandle {
    handle: int

    destructor {
        closeRawHandle(handle)
    }
}
```

Rules:

- At most one destructor per class.
- Destructors cannot be called directly.
- They run on scope exit regardless of exit path.
- Locals are destroyed in reverse declaration order.

### Weak References

```doof
class TreeNode {
    children: TreeNode[] = []
    parent: weak TreeNode | null = null
}
```

- Use `weak` to break reference cycles.
- `weak` qualifies the whole type expression.
- Accessing a weak reference yields `Result<T, WeakReferenceError>`.

## Description Metadata

```doof
class Calculator "A simple calculator." {
    add "Adds two numbers."(a "First.": int, b "Second.": int): int => a + b
}

meta := Calculator.metadata
```

See [json-and-metadata.md](./json-and-metadata.md) for generated metadata, schemas, and `.invoke(...)` behavior.