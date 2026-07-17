# Variables and Bindings

## Overview

Doof provides binding mechanisms with distinct semantics for deep immutability, shallow immutable bindings, and mutable bindings. The binding keyword also influences type inference for collections.

---

## Binding Keywords

| Syntax | Binding | Immutability | Scope |
|--------|---------|--------------|-------|
| `readonly` | Runtime constant | Deep immutable | Global or nested |
| `:=` | Immutable binding | Shallow (content mutable) | Global or nested |
| `let` | Mutable | Mutable | Nested only |
| `with` | Scoped immutable binding | Shallow (content mutable) | Block only |
| `const` | Deprecated immutable declaration | Legacy | Global or nested |

```javascript
readonly MAX_SIZE = 100             // Deep immutable module constant
readonly CONFIG = loadConfig()      // Runtime constant, deeply immutable
timestamp := getCurrentTime()       // Immutable binding, shallow
let counter = 0                     // Mutable binding
```

### Yield-Block Initializers with `<-`

Local `let` and local `readonly` declarations can use `<-` when the initializer needs imperative work before producing its final value:

```javascript
let x <- {
    if condition {
        yield 10
    }
    yield 5
}

readonly label <- {
    log("computing label")
    yield "ready"
}

readonly total: int <- {
    yield items.length
}
```

`yield` produces the value of the block. Every reachable path must `yield`, and the block cannot use outer-flow effects such as `return` or `try`.

The same syntax is also available for statement-only reassignment of an existing local variable:

```javascript
let count = 0
count <- {
    if shouldSkip {
        yield count
    }
    yield count + 1
}
```

`:=` does not support block initializers. `<-` must be followed by a block, and it is not available at module scope.

---

## `const` — Deprecated Legacy Syntax

`const` declarations are deprecated. The parser and checker still accept them temporarily and emit a warning. Use `readonly` for deeply immutable values, and use `:=` for immutable bindings with mutable interiors.

```javascript
readonly PI = 3.14159
readonly MAX_USERS = 1000
readonly GREETING = "Hello"

label := "immutable value with mutable interior"
```

**Rules:**
- Legacy `const` remains accepted temporarily with a warning
- New code should not use `const`
- Module-level `readonly` and `:=` literal values may still lower to compile-time C++ constants as an implementation detail

---

## `:=` — Immutable Bindings (Shallow)

The `:=` operator creates an immutable binding with **shallow immutability** — the binding cannot be reassigned, but its contents remain mutable:

```javascript
// Shallow immutability - binding is immutable, content is mutable
items := [1, 2, 3]        // int[] — mutable array
items.push(4)             // ✅ OK — array contents are mutable
items[0] = 99             // ✅ OK — array is mutable
items = [4, 5, 6]         // ❌ Error — binding is immutable

name := "Alice"           // string (primitives are immutable anyway)
point := Point(1, 2)      // Point
point = Point(3, 4)       // ❌ Error — binding is immutable
```

### Shallow vs Deep: Key Distinction

```javascript
// := is shallow - mutable content allowed
data := [1, 2, 3]              // int[]
data.push(4)                   // ✅ OK

// readonly binding is deep
readonly frozen = [1, 2, 3]    // readonly int[]
frozen.push(4)                 // ❌ Error

// readonly collection type is shallow at the element boundary
class Foo { x: int }
let view: readonly Foo[] = readonly [Foo { x: 1 }]
view[0].x = 2                  // ✅ OK
```

**Rationale:**
- `:=` provides binding immutability without deep type constraints
- Allows working with mutable data structures while preventing reassignment
- More flexible than `readonly` for cases where content mutability is needed

---

## `let` — Mutable Bindings

`let` creates a mutable binding. Type inference prefers mutable types:

```javascript
let counter = 0            // int
let buffer = [1, 2, 3]    // Array<int> — inferred mutable

counter += 1               // ✅ OK
buffer[0] = 99             // ✅ OK
buffer.push(4)             // ✅ OK
buffer = [5, 6]            // ✅ OK
```

`let` also accepts local yield-block initializers and statement-only yield-block reassignment:

```javascript
let current <- {
    yield loadInitialValue()
}

current <- {
    if current < 0 {
        yield 0
    }
    yield current + 1
}
```

### Explicit Type Overrides Inference

```javascript
// Mutable binding, but readonly contents
let frozen: ReadonlyArray<int> = [1, 2, 3]
frozen[0] = 99            // ❌ Error: readonly array
frozen = [4, 5, 6]        // ✅ OK: binding is mutable
```

**Rationale:**
- Clear modern convention: `let` signals mutability
- Visually distinct from `:=`
- No historical baggage from JavaScript's `var`

---

## `readonly` — Deep Immutability

`readonly` provides **deep immutability** across all scopes:

### Global Scope

`readonly` is permitted at global scope for runtime-computed immutable values:

```javascript
readonly MAX_SIZE = 100                 // Module constant
readonly CONFIG = loadConfig()          // Runtime-computed, deeply immutable
readonly PRIMES = readonly [2, 3, 5, 7] // Deeply immutable array

// CONFIG is computed at runtime but immutable thereafter
```

### Local Scope

```javascript
readonly data = [1, 2, 3]    // readonly int[] - deeply immutable
data.push(4)                  // ❌ Error: readonly array
data = [5, 6]                 // ❌ Error: immutable binding

Deep immutability here means the entire reachable value must be immutable. Collection-typed readonly fields and bindings are therefore treated as readonly collections even if the annotation omits the collection-level `readonly`.
```

Local `readonly` declarations may also use `<-` blocks when the final value is produced with `yield`:

```javascript
readonly configName <- {
    yield "main"
}
```

### Class Fields

`readonly` marks class fields that are set once at construction and never reassigned:

```javascript
class Entity {
    readonly id: int                        // Set once, never changes
    readonly tags: string[]                 // Treated as readonly string[]
    name: string                            // Mutable field
}

let e = Entity { id: 123, tags: ["new"], name: "Widget" }
e.id = 456              // ❌ Error: readonly field
e.tags.push("old")      // ❌ Error: readonly array
e.name = "Gadget"       // ✅ OK
```

### Collection Initializer Modifier

`readonly` can modify collection literals to create readonly collections:

```javascript
// Explicit readonly modifier
items := readonly [1, 2, 3]           // readonly int[]
let data = readonly ["a", "b"]        // readonly string[]

// Without modifier - mutable collection
buffer := [1, 2, 3]                   // int[] (mutable)

// Comparison
readonly x = [1, 2]          // readonly int[] (deep readonly binding)
y := readonly [1, 2]         // readonly int[] (readonly collection only)
z := [1, 2]                  // int[] (mutable content, immutable binding)
```

---

## Scope and Hoisting Rules

### Global Scope

- **Allowed: `readonly`, `:=`, deprecated `const`, and `function` declarations**
- `function` declarations **hoist** (available anywhere in file)
- `readonly` and `:=` do **not** hoist (strict declaration order)
- `<-` yield-block initializers are **not** allowed at global scope
- No `let` at global scope

```javascript
// ✅ Valid — module constants
readonly PI = 3.14159
readonly MAX_USERS = 1000

// ✅ Valid — runtime-computed readonly
readonly CONFIG = loadConfig()        // Runtime initialization
readonly PRIMES = readonly [2, 3, 5]

// ✅ Valid — shallow immutable module binding
config := loadConfig()                // Binding is immutable; value interior may be mutable

// ✅ Valid — functions hoist
bar(5)  // Works — functions hoist
function greet(name: string): void => print("Hello, " + name)
function bar(x: int): int => x * 12

// ❌ Invalid at global scope
let counter = 0            // Error: let not allowed globally
readonly value <- { yield 1 } // Error: <- blocks are local-only

// ❌ Hoisting error for readonly and :=
let x = CONFIG             // Error: CONFIG used before declaration
readonly CONFIG = load()   // readonly doesn't hoist
```

### Nested (Local) Scope

- `readonly`, `:=`, and `let` bindings are available
- Deprecated `const` remains accepted temporarily with a warning
- **Nothing hoists** — strict declaration order
- Re-declaring the same binding name in the **same local scope** is a compile-time error
- Nested scopes may still shadow an outer binding with a new local binding
- Functions can reference themselves for recursion

```javascript
function outer() {
    helper(5)  // ❌ Error: used before declaration
    
    readonly LIMIT = 100
    config := load()
    let counter = 0
    
    function helper(x: int): int => x * 2
    
    helper(5)  // ✅ Works
    
    // Recursion works — name available in own body
    function factorial(n: int): int => 
        if n == 0 then 1 else n * factorial(n - 1)
}

function scopes() {
    value := 1
    value := 2      // ❌ Error: already declared in this scope

    if true {
        value := 3  // ✅ Allowed: nested scope shadows outer binding
    }
}
```

### Hoisting Summary

| Context | Declaration Type | Hoists? |
|---------|-----------------|---------|
| Global | `function` | ✅ Yes |
| Global | `readonly` | ❌ No |
| Global | `:=` | ❌ No |
| Global | `let` | ❌ Not allowed |
| Nested | `function` | ❌ No |
| Nested | `readonly` | ❌ No |
| Nested | `:=` | ❌ No |
| Nested | `let` | ❌ No |
| Any | Lambda | ❌ No |

### Design Rationale

**Why deprecate `const` declarations?**
1. `readonly` communicates the user-facing immutability guarantee directly
2. Literal-valued `readonly` module declarations can still be optimized by the emitter
3. `:=` is clearer for shallow immutable bindings
4. Removing `const` avoids a second spelling for immutable values

**Why not hoist `readonly` or `:=`?**
1. Runtime initialization requires strict declaration order
2. Prevents initialization order issues
3. Consistent with local scope semantics

**Why not allow `let` globally?**
1. `let` would introduce reassignable global state — use classes or modules for stateful patterns
2. Module-level `:=` covers immutable references to values with mutable interiors
3. Simpler mental model — module bindings are not reassignable

**Why not hoist nested declarations?**
1. Prevents access to uninitialized variables
2. Simpler mental model — only top-level `function` declarations are special
3. Clear syntactic rules, no complex analysis needed

---

## `with` — Scoped Bindings

The `with` statement introduces one or more immutable bindings that are scoped to an attached block. The bindings are not visible outside the block.

### Syntax

```javascript
with <name> [:Type] := <expression> [, ...] {
    // name is in scope here
}
// name is NOT in scope here
```

### Single Binding

```javascript
with connection := openDatabase() {
    query(connection, "SELECT * FROM users")
    update(connection, "UPDATE stats SET visits = visits + 1")
}
// connection is out of scope — no accidental use after the block
```

### Multiple Bindings

Multiple bindings are separated by commas. They are evaluated left-to-right, and later bindings can reference earlier ones:

```javascript
with x := computeX(), y := computeY(x) {
    println("Result: ${x + y}")
}
```

### Optional Type Annotations

Type annotations can be provided for any binding:

```javascript
with total: double := prices.reduce(0.0, (a, b) => a + b) {
    println("Total: ${total}")
}
```

### Nesting

`with` blocks can be nested:

```javascript
with config := loadConfig() {
    with db := openDatabase(config.dbUrl) {
        migrate(db)
        seed(db)
    }
}
```

### Semantics

- All bindings are **immutable** (`:=` semantics — shallow immutability)
- Bindings are scoped to the block — not visible before or after
- Bindings are evaluated **left-to-right**; later bindings may reference earlier ones
- The block body creates an additional nested scope (as with `if`, `for`, etc.)

### Design Rationale

**Why `with` instead of a bare block with `:=`?**
1. Communicates intent — "these bindings exist for this block only"
2. Prevents accidental use of temporary bindings after they're needed
3. Useful for resource-like patterns where scope should be explicit

> **Note:** Bare block statements (`{ ... }` at statement level) are not allowed in Doof. Use `with` for scoped bindings.

---

## Destructuring

Destructuring mirrors initialisation — both positional and named forms are supported.

### Positional Destructuring

Extracts fields in declaration order:

```javascript
class Point {
    x, y, z: float
}

point := Point (1.0, 2.0, 3.0)

// Immutable bindings
(x, y, z) := point
print(x)  // 1.0

// Partial — trailing fields can be omitted
(x, y) := point

// Mutable bindings
let (a, b, c) = point
a = 5.0  // ✅ OK

// Assignment to existing mutable bindings
let px = 0.0
let py = 0.0
(px, py) = point
```

**Rules:**
- Fields extracted in declaration order
- Can omit trailing fields
- Cannot skip intermediate fields (use named destructuring for that)
- `_` discards positions without creating bindings
- `:=` = immutable binding; `let` = mutable binding
- `(x, y) = value` assigns into existing mutable bindings

### Named Destructuring

Extracts specific fields by name:

```javascript
class User {
    id: int
    name: string
    email: string
    age: int
}

user := User { id: 1, name: "Alice", email: "alice@example.com", age: 30 }

// Extract specific fields — immutable bindings
{ name, email } := user
print(name)   // "Alice"

// Order doesn't matter
{ age, id } := user

// Mutable bindings
let { name, age } = user

// Assignment to existing mutable bindings
let userName = ""
let userAge = 0
{ name as userName, age as userAge } = user
```

### Renaming with `as`

```javascript
{ name as userName, email as userEmail } := user
print(userName)   // "Alice"

// Mix renamed and direct bindings
{ id, name as displayName } := user
```

**Rationale:** The `as` keyword provides consistent renaming across Doof — imports, exports, and destructuring all use the same syntax.

### Tuple Destructuring

Tuples destructure with the same positional syntax as classes:

```javascript
function getStats(): Tuple<int, float, string> {
    return (42, 3.14, "hello")
}

// Immutable bindings
(count, average, label) := getStats()

// Mutable bindings
let (count, average, label) = getStats()

// Assignment to existing mutable bindings
let total = 0
let tag = ""
(total, _, tag) = getStats()

// Partial — trailing fields can be omitted
(count, average) := getStats()  // Ignores third field

// Discard an intermediate tuple position
(count, _, label) := getStats()

// Field access without destructuring
stats := getStats()
print(stats._1)  // 42
print(stats._2)  // 3.14
```

For tuples and classes, `_` discards a position without creating a binding.

### Array Destructuring

Arrays destructure with square brackets and bind the array element type:

```javascript
values := [10, 20, 30]

// Immutable bindings
[first, second, third] := values

// Mutable bindings
let [a, b, c] = values

// Discard positions you do not need
[head, _, tail] := values

// Assignment to existing mutable bindings
let first = 0
let third = 0
[first, _, third] = values
```

**Rules:**
- The right-hand side must have type `T[]`
- Every non-discard binding receives type `T`
- `_` discards a position and does not create a binding
- The array must have at least as many elements as the pattern length
- If the array is too short, destructuring panics at runtime
- Rest patterns and optional bindings are not supported
- `[a, b] = values` assigns into existing mutable bindings

### Destructuring Assignment

Destructuring patterns can also assign into bindings that already exist:

```javascript
let x = 0
let y = 0
(x, y) = point

let first = 0
let last = 0
[first, _, last] = values

let userName = ""
{ name as userName } = user
```

**Rules:**
- Every non-`_` target must already exist in scope
- Every non-`_` target must be mutable (`let`)
- The extracted field or element type must be assignable to the target binding type
- Destructuring assignment uses the same positional, array, and named shape rules as destructuring declarations
- `try` also supports destructuring assignment, for example `try [a, b] = load()`

### Function Parameters

Destructuring patterns are not currently accepted directly in function
parameters. Accept the value as an ordinary parameter and destructure it at the
start of the function body:

```javascript
function magnitude(point: Point): float {
    (x, y, z) := point
    return sqrt(x*x + y*y + z*z)
}

function greet(user: User): string {
    { name, age } := user
    return "Hello ${name}, you are ${age}"
}
```

### Destructuring Summary

| Operation | Positional | Named |
|-----------|-----------|-------|
| **Initialise** | `Point(1.0, 2.0, 3.0)` | `Point { x: 1.0, y: 2.0, z: 3.0 }` |
| **Destructure (immutable)** | `(x, y, z) := point` | `{ x, y, z } := point` |
| **Destructure (mutable)** | `let (x, y, z) = point` | `let { x, y, z } = point` |
| **Destructure (assignment)** | `(x, y, z) = point` | `{ x, y, z } = point` |
| **Destructure (for-of)** | `for x, y, z of points` | N/A |
| **Destructure (tuple)** | `(a, b) := tuple` | N/A |
| **Destructure (array)** | `[a, b, c] := values` | N/A |
| **Destructure (array assignment)** | `[a, b, c] = values` | N/A |
| **Field Order** | Declaration order | Any order |
| **Partial** | Trailing only | Any subset |
