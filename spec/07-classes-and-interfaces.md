# Classes and Interfaces

## Classes

Classes define **nominal types** — two classes with identical structure are distinct types.

### Field Declarations

Each field declaration must provide either a type annotation or a default value so the field's type is known at compile time.

```javascript
class Point {
    x, y, z: float           // Multiple fields of same type
}

class User {
    readonly id: int          // Set once at construction
    name: string              // Mutable field
    email: string | null      // Nullable field
    role: string = "user"     // Field with default value
}
```

Field defaults are evaluated at construction time. They can use `@caller` to capture who constructed the instance:

```doof
class AssertionError {
    message: string
    source: SourceLocation = @caller
}

err := AssertionError { message: "boom" }
// err.source points at the construction site above
```

### Field Modifiers

| Modifier | Behaviour |
|----------|-----------|
| (none) | Mutable field |
| `readonly` | Set once at construction, cannot be reassigned |
| `const` | Compile-time constant, must match on initialisation |

### Const Fields

`const` fields enable discriminated unions and structural typing:

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

### Methods

```javascript
class Counter {
    count = 0
    
    increment(amount: int): void {
        count += amount
    }
    
    getCount(): int {
        return count
    }
}
```

### Stream Implementations

Classes can explicitly implement `Stream<T>`. A class satisfies `Stream<T>` when it exposes zero-argument `next(): bool` and `value(): T` methods. `value()` is only valid after a successful `next()` call.

```javascript
class Counter implements Stream<int> {
    current = 0
    end: int
    currentValue: int = 0

    next(): bool {
        if this.current < this.end {
            this.currentValue = this.current
            this.current = this.current + 1
            return true
        }
        return false
    }

    value(): int => this.currentValue
}
```

`for-of` can iterate over any `Stream<T>` value and binds each iteration variable as `T`.

### Static Members

Members declared with `static` belong to the class itself, not to instances. Static methods have no `this` binding and cannot access instance fields or methods. Static fields are shared class state and are not part of instance construction or other instance-shaped operations.

```javascript
class MathUtils {
    static version = "1.0"

    static max(a: int, b: int): int {
        return if a > b then a else b
    }
    
    static clamp(value: int, lo: int, hi: int): int {
        return MathUtils.max(lo, MathUtils.min(value, hi))
    }
    
    static min(a: int, b: int): int {
        return if a < b then a else b
    }
}

let result = MathUtils.max(10, 20)  // 20
let version = MathUtils.version     // "1.0"
```

Named class access uses `.`:

```javascript
let n = MathUtils.max(10, 20)
let v = MathUtils.version
```

#### Static Members and Instance State

```javascript
class Counter {
    count = 0
    
    increment(): void { count += 1; }
    
    static create(initial: int): Counter {
        return Counter { count: initial }
    }
    
    static badMethod(): void {
        count += 1  // ❌ Error: static method cannot access instance field
        increment() // ❌ Error: static method cannot call instance method
    }
}

let c = Counter.create(10)   // ✅ Called on the class
c.increment()                // ✅ Called on the instance
c.create(5)                  // ❌ Error: static method cannot be called on an instance
```

Instances must use `::` to access class statics:

```javascript
class Rectangle {
    width: int
    static kind = "rectangle"

    static describe(): string => "Rectangles"
}

rect := Rectangle { width: 10 }

rect.kind         // ❌ Error: static field cannot be accessed with `.`
rect.describe()   // ❌ Error: static method cannot be accessed with `.`
rect::kind        // ✅ "rectangle"
rect::describe()  // ✅ "Rectangles"
```

#### Static and Interfaces

Static members participate in structural interface matching only when the interface also declares them as static. Static interface methods are accessed through interface values with `::`.

```javascript
interface Countable {
    getCount(): int
    static zeroLabel(): string
}

class MyCounter {
    count = 0
    getCount(): int { return count; }
    static zero(): MyCounter { return MyCounter { count: 0 }; }
    static zeroLabel(): string { return "zero"; }
}

// MyCounter satisfies Countable, including its static contract
let c: Countable = MyCounter.zero()  // ✅
let label = c::zeroLabel()           // ✅
```

Interface static fields are reserved for future support and are not currently allowed.

---

## Visibility / Access Control

### The `private` Keyword

Doof uses **file-scoped** access control via the `private` keyword. A private declaration is only accessible from the **same source file** in which it is defined.

#### Private Class Fields

```doof
class User {
    private passwordHash: string
    name: string

    function checkPassword(input: string): bool {
        return hash(input) == passwordHash   // ✅ same file
    }
}
```

From another file:

```doof
import { User } from "./user"
const u = User { name: "Alice" }
const h = u.passwordHash   // ❌ Error: "passwordHash" is private
```

#### Private Methods

```doof
class Parser {
    source: string
    private function advance(): void { /* ... */ }
    function parse(): void { this.advance() }   // ✅ same file
}
```

From another file:

```doof
import { Parser } from "./parser"
const p = Parser { source: "hello" }
p.advance()   // ❌ Error: "advance" is private
```

#### Private Top-Level Functions and Classes

Top-level functions and classes can be marked `private` to make them file-local. They cannot be exported or imported.

```doof
private function helper(): int => 42         // file-local
private class InternalState { x: int }       // file-local

export function publicApi(): int => helper() // ✅ same file
```

```doof
export private function foo(): void {}  // ❌ Parse error: cannot export a private declaration
```

#### Construction Restrictions

Classes with private fields **that lack default values** cannot be constructed from outside their defining file, because the caller would need to supply values for fields it cannot see:

```doof
// lib.do
export class Config {
    private secret: string       // no default → blocks external construction
    name: string
}

export function makeConfig(name: string): Config {
    return Config { secret: "hidden", name: name }   // ✅ factory in same file
}
```

```doof
// main.do
import { Config, makeConfig } from "./lib"
const c1 = makeConfig("prod")                     // ✅ use factory
const c2 = Config { secret: "x", name: "test" }   // ❌ cannot construct
```

If all private fields have defaults, external construction is allowed (the private fields simply use their defaults):

```doof
export class Counter {
    private count: int = 0     // has default → external construction OK
    name: string
}
```

#### Rules Summary

| Declaration | `private` effect |
|---|---|
| Class field | Only accessible via member expression from the same file |
| Class method | Only callable from the same file |
| Top-level function | File-local; cannot be exported or imported |
| Top-level class | File-local; cannot be exported or imported |
| Interface member | **Not allowed** — interfaces are public contracts |

---

## The `this` Keyword

### Implicit `this` in Methods

Within instance methods, fields and other instance methods are accessed **implicitly** — no `this` prefix is required:

```javascript
class Player {
    name: string
    score = 0
    
    addPoints(points: int): void {
        score += points             // Implicit this — accesses this.score
        logScore()                  // Implicit this — calls this.logScore()
    }
    
    logScore(): void {
        print("${name}: ${score}")  // Implicit this for both fields
    }
}
```

### Explicit `this` for Disambiguation

`this` is available in all instance methods and **required** when a parameter or local variable shadows a field name:

```javascript
class Point {
    x, y: float
    
    // Parameter 'x' shadows field 'x' — this.x required
    setX(x: float): void {
        this.x = x           // ✅ Assigns parameter to field
    }
    
    // No shadowing — this. is optional
    offsetY(dy: float): void {
        y += dy              // ✅ Implicit this.y
        this.y += dy         // ✅ Also valid — explicit this
    }
}
```

Shadowing rules:

| Context | Resolution |
|---------|------------|
| No shadowing | `field` resolves to `this.field` implicitly |
| Parameter shadows field | `field` refers to the parameter; use `this.field` for the field |
| Local variable shadows field | `field` refers to the local; use `this.field` for the field |

### `this` as a Value

`this` refers to the current instance and can be used as a value — passed as an argument, returned, or stored:

```javascript
class Builder {
    value = 0
    
    // Fluent API: return this for chaining
    add(n: int): Builder {
        value += n
        return this
    }
    
    build(): int {
        return value
    }
}

let result = Builder().add(1).add(2).add(3).build()  // 6
```

### `this` in Lambdas

Lambdas capture `this` from their **lexical scope**, just like any other variable. There is no re-binding of `this` — lambdas defined inside a method always refer to the enclosing instance:

```javascript
class Processor {
    items: string[] = []
    
    addAll(newItems: string[]): void {
        // Lambda captures 'this' from the enclosing method
        newItems.forEach((item) => items.push(item))   // ✅ Implicit this.items
        newItems.forEach((item) => this.items.push(item)) // ✅ Explicit also works
    }
    
    getHandler(): (string): void {
        // Returned lambda still captures this
        return (item) => items.push(item)  // ✅ this.items from Processor
    }
}
```

### `this` in Static Methods

`this` is **not available** in static methods. Attempting to use it is a compile-time error:

```javascript
class Registry {
    entries: string[] = []
    
    static create(): Registry {
        this.entries = []   // ❌ Error: 'this' is not available in static methods
        return Registry()   // ✅ Construct a new instance instead
    }
}
```

### Summary

| Context | `this` available? | Implicit field access? |
|---------|-------------------|------------------------|
| Instance method | ✅ Yes | ✅ Yes |
| Lambda inside instance method | ✅ Yes (captured lexically) | ✅ Yes |
| Static method | ❌ No | ❌ No |
| Top-level function | ❌ No | N/A |

---

## Object Initialisation

Doof provides dual syntax options: **named field syntax** and **positional syntax**.

### Named Field Syntax

```javascript
let p = Point { x: 1.0, y: 2.0, z: 3.0 }
let p: Point = { x: 1.0, y: 2.0, z: 3.0 }  // Type-annotated literal
```

- Self-documenting — field names make intent clear
- Order-independent — fields can be specified in any order
- Can omit fields with defaults

### Positional Syntax

```javascript
let p = Point (1.0, 2.0, 3.0)
let p: Point = (1.0, 2.0, 3.0)  // Type-annotated tuple-like literal
```

- Concise — minimal syntax overhead
- Natural for mathematical types
- Fields map in declaration order

### Default Values

```javascript
class Config {
    host: string
    port: int = 8080
    timeout: int = 30
}

// Named — can omit any field with a default
let c1 = Config { host: "localhost" }
let c2 = Config { host: "localhost", timeout: 5 }

// Positional — follows declaration order, can omit trailing defaults
let c3 = Config ("localhost")
let c4 = Config ("localhost", 9000)
let c5 = Config ("localhost", 9000, 5)
```

Positional syntax cannot skip intermediate fields — use named syntax for that.

### Constructor Validation

The compiler validates constructor arguments at compile time:

**Argument count:**
```javascript
class Point { x, y: float }

Point(1.0)              // ❌ Error: expected 2 arguments, got 1
Point(1.0, 2.0, 3.0)   // ❌ Error: expected 2 arguments, got 3
Point(1.0, 2.0)         // ✅ OK

// With defaults, a range of counts is accepted
class Config { host: string; port: int = 8080 }
Config()                // ❌ Error: expected 1-2 arguments, got 0
Config("localhost")     // ✅ OK (port uses default)
Config("localhost", 80) // ✅ OK
```

**Argument types:**
```javascript
class Point { x, y: float }

Point("hello", "world")  // ❌ Error: string is not assignable to float
Point(1.0, 2.0)          // ✅ OK (contextually narrowed from double to float)
```

**Named field validation:**
```javascript
class Point { x, y: float }

Point { z: 1.0 }              // ❌ Error: unknown field "z"
Point { x: 1.0 }              // ❌ Error: missing required field "y"
Point { x: 1.0, y: "hello" }  // ❌ Error: string is not assignable to float
Point { x: 1.0, y: 2.0 }      // ✅ OK
```

### Const Fields in Initialisation

**Nominal construction** — const fields are auto-filled:

```javascript
let r1 = Success { value: 42 }     // kind auto-filled to "Success"
let r2 = Success(42)               // Positional — kind auto-filled
```

**Structural construction** — const fields must be specified:

```javascript
let r1: Result = { kind: "Success", value: 42 }
let r2: Result = ("Success", 42)
```

### Nested Initialisation

```javascript
class Line { start: Point; end: Point; }

// Explicit types
let line = Line { start: Point { x: 0.0, y: 0.0 }, end: Point { x: 1.0, y: 1.0 } }

// Type elision — type inferred from context
let line = Line { start: { x: 0.0, y: 0.0 }, end: { x: 1.0, y: 1.0 } }

// Positional with type elision
let line = Line ((0.0, 0.0), (1.0, 1.0))
```

### Name-Value Shorthand

```javascript
readonly name = "Bob"
readonly age = 25

let p = Person { name, age }  // Equivalent to { name: name, age: age }

// Also works with contextual typing and mixed styles
p2: Person := { name, age: 30 }
```

Works with named construction, contextual object literals, and can be mixed with explicit field values.

### Field Spread

```javascript
readonly base = BaseConfig { host: "localhost" }
let extended = ExtendedConfig { 
    ...base,           // Spreads matching fields
    timeout: 30, 
    retries: 3 
}

// Can override spread fields
let extended2 = ExtendedConfig {
    ...base,
    port: 9000,        // Overrides the spread value
    timeout: 30,
    retries: 3
}
```

Spread sources must be type-compatible — the compiler verifies field types match.

---

## Interfaces (Structural)

Interfaces define structural contracts. In Doof's closed-world model, interfaces are automatically satisfied by any class with matching structure.

```javascript
interface Drawable {
    draw(canvas: Canvas): void
}

interface Positioned {
    readonly x: float
    readonly y: float
}
```

### Automatic Matching

```javascript
class Circle {
    readonly x: float
    readonly y: float
    radius: float
    
    draw(canvas: Canvas): void { ... }
}

// Circle automatically satisfies both Drawable and Positioned
function render(d: Drawable): void { d.draw(canvas); }
render(Circle { x: 0.0, y: 0.0, radius: 5.0 })  // ✅ OK
```

At compile time, interface types resolve to concrete union types of all matching classes.

### Optional Explicit Implementation

```javascript
class Circle implements Drawable, Positioned {
    readonly x: float
    readonly y: float
    radius: float
    
    draw(canvas: Canvas): void { ... }
}
```

Benefits: early error detection, documents intent, validates refactoring compatibility.

---

## String Interpolation

Doof uses `${}` syntax for string interpolation:

```javascript
let name = "Alice"
let age = 30
let message = "Hello, ${name}! You are ${age} years old."

// Any expression can be interpolated
let calc = "Sum: ${x + y}"
let formatted = "Pi: ${pi.toFixed(2)}"
```

### Multi-line Strings

```javascript
let report = `
    User Report:
    Name: ${name}
    Age: ${age}
    Status: ${if age >= 18 then "Adult" else "Minor"}
`
```

**No format specifiers** — formatting is delegated to methods:

```javascript
// ✅ Use methods
let hex = "Color: ${255.toHex()}"
let padded = "Value: ${num.toString().padStart(5, '0')}"

// ❌ No special syntax
let hex = "Color: ${255:x}"  // Not supported
```

---

## Complete Initialisation Example

```javascript
class Point { x, y, z: float; }
class Color { r, g, b: float; a: float = 1.0; }
class Vertex { position: Point; color: Color; }

// Various styles
let v1 = Vertex {
    position: Point { x: 1.0, y: 2.0, z: 3.0 },
    color: Color { r: 1.0, g: 0.0, b: 0.0 }
}

let v2 = Vertex (Point (1.0, 2.0, 3.0), Color (1.0, 0.0, 0.0))

let v3 = Vertex {
    position: { x: 1.0, y: 2.0, z: 3.0 },
    color: { r: 1.0, g: 0.0, b: 0.0 }
}

let v4 = Vertex ((1.0, 2.0, 3.0), (1.0, 0.0, 0.0))
```

All forms are type-safe and validated at compile time.

---

## Memory Management

Doof uses **reference counting** for memory management with **deterministic destructors**. When an object's reference count reaches zero, its destructor runs immediately and predictably. This provides RAII-style resource cleanup without a garbage collector.

### Destructors

Classes can define a `destructor` block that runs deterministically when the last reference is released:

```javascript
class FileHandle {
    handle: int
    
    destructor {
        closeRawHandle(handle)  // Deterministic cleanup
    }
}

function processFile(path: string): Result<Data, IOError> {
    file := try openFile(path)
    content := try file.read()
    return { value: parse(content) }
    // file's destructor runs here — last reference goes out of scope
}
```

**Destructor rules:**

- The `destructor` block is syntactically distinct from regular methods — it has no parameters, no return type, and no name
- Cannot be called directly — it runs automatically when the reference count drops to zero
- Runs regardless of how the function exits (normal return, early return, or error propagation)
- Can access instance fields (implicit `this`)
- A class may have at most one destructor

### Deterministic Cleanup

Because Doof uses reference counting (not garbage collection), destruction is predictable:

```javascript
function transferData(): Result<void, IOError> {
    src := try openFile("input.dat")
    dst := try openFile("output.dat")
    
    data := try src.read()
    try dst.write(data)
    
    return Success()
    // dst's destructor runs first (last declared, first destroyed)
    // src's destructor runs second
}
```

Local variables are destroyed in reverse declaration order when they go out of scope. This applies to all exit paths — normal return, early `try` return, or scope exit.

### Weak References

To break reference cycles (the primary downside of reference counting), Doof provides a `weak` qualifier. A `weak` reference does not contribute to the reference count.

`weak` applies to the **entire type expression** — it qualifies the reference, not the type:

```javascript
class TreeNode {
    children: TreeNode[] = []
    parent: weak TreeNode | null = null  // Weak reference to parent
}

class Observer {
    target: weak Widget | Panel  // weak (Widget | Panel), not (weak Widget | weak Panel)
}
```

**Semantics:**
- A `weak` reference does not prevent the referenced object from being destroyed
- Accessing a `weak` reference yields `Result<T, WeakReferenceError>` — the referent may have been collected
- `weak` qualifies the binding, not the type — `weak Foo | Bar` means a weak reference to a value of type `Foo | Bar`
- Use `?.` and `!.` operators for lightweight access (same syntax as Result/null handling)

```javascript
// Preventing cycles in a graph
class Node {
    edges: Node[] = []            // Strong — keeps neighbours alive
    backEdge: weak Node | null    // Weak — doesn't prevent cleanup
}

// Observer pattern — observers shouldn't keep subjects alive
class EventEmitter {
    listeners: weak EventListener[] = []
    
    notify(event: Event): void {
        for listener of listeners {
            listener?.handleEvent(event)  // Skip if collected
        }
    }
}
```

Destructors and weak references work together: destructors provide deterministic cleanup, and weak references prevent the reference cycles that would otherwise leak memory under reference counting.
