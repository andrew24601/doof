# Doof Classes and Memory Management Reference

## Class Declarations

```doof
class User {
    readonly id: int              // set once at construction
    name: string                  // mutable field
    email: string | null = null   // nullable with default
    role: string = "user"         // default value
    const version = 1             // compile-time constant field
    
    greet(): string => "Hi, ${name}"
    
    private internalHelper(): void { /* file-scoped */ }
    
    static create(name: string): User => User { id: nextId(), name: name }
}
```

### Field Modifiers

| Modifier | Behaviour |
|----------|-----------|
| (none) | Mutable field |
| `readonly` | Set once at construction, cannot be reassigned |
| `const` | Compile-time constant, enables discriminated unions |
| `private` | File-scoped access only |

### Object Construction

```doof
// Named fields (any order, can omit fields with defaults)
user := User { id: 1, name: "Alice" }

// Positional (declaration order, can omit trailing defaults)
user := User(1, "Alice")

// Name-value shorthand
readonly name = "Alice"
user := User { id: 1, name }    // shorthand for name: name

// Field spread
extended := ExtendedConfig { ...base, timeout: 30 }

// Nested with type elision
line := Line { start: { x: 0.0, y: 0.0 }, end: { x: 1.0, y: 1.0 } }
line := Line((0.0, 0.0), (1.0, 1.0))     // positional nested
```

### Const Fields in Construction

- **Nominal construction** (`ClassName { ... }`): const fields are auto-filled
- **Structural construction** (type-annotated `{ ... }`): const fields must be specified

```doof
let r1 = Success { value: 42 }           // kind auto-filled to "Success"
let r2: Result = { kind: "Success", value: 42 }  // kind must be specified
```

## Methods

```doof
class Counter {
    count = 0
    
    // Implicit this — no prefix needed
    increment(n: int): void { count += n }
    getCount(): int => count
    
    // Explicit this for disambiguation (parameter shadows field)
    reset(count: int): void { this.count = count }
    
    // Fluent API
    add(n: int): Counter { count += n; return this }
}
```

### Static Methods

```doof
class MathUtils {
    static max(a: int, b: int): int => if a > b then a else b
}
let m = MathUtils.max(10, 20)
```

- No `this` access in static methods
- Called on the class, not instances
- Not part of structural interface matching

### Private Members

`private` is file-scoped. Private fields without defaults block external construction:

```doof
class Config {
    private secret: string          // no default — blocks external construction
    name: string
}
// Must construct via factory in same file
export function makeConfig(name: string): Config {
    return Config { secret: "hidden", name: name }
}
```

## Interfaces (Structural)

```doof
interface Drawable {
    draw(canvas: Canvas): void
}

interface Positioned {
    readonly x: float
    readonly y: float
}
```

- Classes satisfy interfaces automatically if structure matches
- Optional `implements` clause for documentation and early validation
- At compile time, resolves to union of all matching classes (closed-world)
- Interface members cannot be `private`

## Memory Management

### Reference Counting

All class instances are reference-counted. When the last reference is released, the destructor runs immediately (deterministic, no GC).

### Destructors

```doof
class FileHandle {
    handle: int
    
    destructor {
        closeRawHandle(handle)
    }
}
```

- At most one destructor per class
- Cannot be called directly
- Runs on scope exit regardless of exit path
- Local variables destroyed in reverse declaration order

### Weak References

Break reference cycles with `weak`:

```doof
class TreeNode {
    children: TreeNode[] = []
    parent: weak TreeNode | null = null
}
```

- `weak` qualifies the entire type expression, not individual types
- Accessing a weak reference yields `Result<T, WeakReferenceError>`
- Use `?.` and `!.` for lightweight access

## Visibility Summary

| Declaration | `private` effect |
|---|---|
| Class field | Only accessible from same file |
| Class method | Only callable from same file |
| Top-level function | File-local, cannot be exported |
| Top-level class | File-local, cannot be exported |
| Interface member | Not allowed |

## Description Metadata

```doof
class Calculator "A simple calculator." {
    add "Adds two numbers."(a "First.": int, b "Second.": int): int => a + b
}

// Access metadata
const meta = Calculator.metadata
meta.name              // "Calculator"
meta.description       // "A simple calculator."
meta.methods[0].inputSchema   // JSON Schema string
meta.methods[0].invoke(instance, '{"a":1,"b":2}')  // Result<string, string>
```
