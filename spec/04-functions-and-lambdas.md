# Functions and Lambdas

## Overview

Doof treats functions as first-class values. `function <name>` declarations are syntactic sugar for `const` lambda declarations, providing a unified mental model where all callables follow the same rules for closures, scope, and typing.

---

## Function Declarations

### Expression Form

```javascript
function double(x: int): int => x * 2

function greet(name: string): void => print("Hello, " + name)
```

### Block Form

```javascript
function factorial(n: int): int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n - 1)
}
```

### Return Type Inference

The return type can be inferred from the body in unambiguous cases:

```javascript
function double(x: int) => x * 2  // Returns int (inferred)

// Ambiguous cases require annotation
function mixed(flag: bool): int | string {
    if flag {
        return 1
    }
    return "hello"
}
```

### Calling Functions

Function calls support both positional `()` and named `{}` argument forms.

```javascript
function clamp(value: int, min: int, max: int): int {
    if value < min { return min }
    if value > max { return max }
    return value
}

clamp(score, 0, 100)                    // positional
clamp{ value: score, min: 0, max: 100 } // named, order-independent
clamp{ min: 0, max: 100, value: score } // same call, different source order
```

Named calls are resolved by parameter name, so they work well when several parameters share the same type. They also support the same shorthand as named construction when a binding already has the target parameter name:

```javascript
value := score
clamp{ value, min: 0, max: 100 }      // shorthand for value: value
```

Omitting a named parameter is only valid when that parameter has a default value:

```javascript
function greet(name: string, punctuation: string = "!"): string => name + punctuation

greet{ name: "Ada" }                 // ok
greet{ punctuation: "?" }            // error: missing required parameter "name"
```

The `{` must immediately follow the callee token with no whitespace: `clamp{ ... }`, not `clamp { ... }`.

The same named-call form applies to methods and imported functions.

### Modifiers

Top-level and class-level function declarations accept modifiers that control visibility and concurrency behaviour.

| Modifier | Applies to | Effect |
|---|---|---|
| `export` | top-level | Makes the function importable by other modules |
| `private` | top-level, class method | Restricts the function to the defining source file |
| `isolated` | top-level, class method | Declares the function safe for concurrent execution |
| `static` | class method | Binds the function to the class rather than an instance |

#### `export`

```doof
export function add(a: int, b: int): int => a + b
```

#### `private`

A `private` function is **file-scoped** — it can only be called from within the same source file where it is defined. It cannot be exported or imported.

```doof
// Internal helper — not visible outside this file
private function hash(input: string): string {
    // ...
}

export function checkPassword(candidate: string, stored: string): bool {
    return hash(candidate) == stored   // ✅ same file
}
```

Attempting to export a private function is a compile error:

```doof
export private function helper(): void {}  // ❌ Error: cannot export a private declaration
```

`private` is also valid on class methods — see [Classes and Interfaces](07-classes-and-interfaces.md) for details.

---

## Lambda Expressions

Lambdas are anonymous function values with the same expression and block forms.

### Fully Explicit Form

```javascript
// Expression body
const double = (x: int): int => x * 2

// Block body
const triple = (x: int): int { return x * 3 }
```

### Inferred Return Type

```javascript
const double = (x: int) => x * 2

const compute = (x: int) => {
    const y = 3
    return x * y
}
```

### Inferred Parameter Types

When the lambda type is known from context, parameter types can be omitted, but **names must match the signature**:

```javascript
type Handler = (msg: string): void

let h1: Handler = (msg) => print(msg)          // ✅ Name matches
let h2: Handler = (message) => print(message)  // ❌ Error: name mismatch
```

### Full Type Inference (Parameterless Form)

When the complete function signature is known, the parameter list can be omitted entirely — parameter names are inherited from the signature:

```javascript
type Handler = (msg: string): void
let handler: Handler = => print(msg)  // msg from signature

type Transform = (x: int): int
let transform: Transform = => x * 2  // x from signature

type BinaryOp = (a: int, b: int): int
let add: BinaryOp = => a + b  // a and b from signature
```

### Flexible Parameter Specification

When explicitly naming parameters, you can specify **any subset in any order** — the names unambiguously bind to the signature:

```javascript
// map signature: (it: T, index: int): U
let nums = [1, 2, 3, 4, 5]

nums.map((it) => it * 2)             // Use first parameter only
nums.map((index) => index * 10)      // Use second parameter only
nums.map((it, index) => it + index)  // Both in order
nums.map((index, it) => it + index)  // Both reversed — names disambiguate
```

### Inline Usage

```javascript
const c = [1, 2, 3].map((item: int): int => item * 2)
```

### Enum Types in Function Signatures

Enums are first-class types and can be used in function parameters and return types. When calling such functions, dot-shorthand is available for enum arguments:

```javascript
enum Direction { North, South, East, West }

function opposite(dir: Direction): Direction => case dir {
    .North -> .South,
    .South -> .North,
    .East  -> .West,
    .West  -> .East
}

let result = opposite(.North)  // Direction.South
```

---

## Standard Library Conventions

Built-in collection methods use consistent, brief parameter names:

```javascript
// Array method signatures:
map:         (it: T, index: int): U
filter:      (it: T, index: int): bool
forEach:     (it: T, index: int): void
find:        (it: T, index: int): bool
some:        (it: T, index: int): bool
every:       (it: T, index: int): bool
reduce:      (acc: U, it: T, index: int): U
reduceRight: (acc: U, it: T, index: int): U
sort:        (a: T, b: T): int
```

### Practical Usage

```javascript
let numbers = [10, 20, 30, 40, 50]

// Parameterless form — inherits names from signature
numbers.map(=> it * 2)                    // [20, 40, 60, 80, 100]
numbers.filter(=> it > 25)                // [30, 40, 50]
numbers.reduce(=> acc + it)               // 150

// Using multiple parameters
numbers.map(=> it * index)                // [0, 20, 60, 120, 200]
numbers.filter(=> index % 2 == 0)        // [10, 30, 50]

// Chaining
numbers
    .filter(=> it % 2 == 0)
    .map(=> it * it)
    .reduce(0, => acc + it)

// Named parameters when clarity helps
let users = getUsers()
users.filter((user) => user.age >= 18)
     .map((user) => user.name)
```

### Trailing Lambdas

When calling a function, a trailing block `{ body }` after the closing `)` is parsed as an additional parameterless lambda argument. The opening `{` must be on the **same line** as the closing `)`. Trailing lambdas are intentionally scoped to read as control-structure-like statement blocks (e.g. `forEach`, `withTransaction`, `withLock`):

```javascript
// Void callback — trailing lambda form
items.forEach() { print(it) }

// Multi-statement trailing lambda
items.forEach() {
    const label = "Item: " + it.name
    print(label)
}

// Trailing lambda appended after existing positional args
forEachWithInit([1, 2, 3], 0) { print(it) }
```

**Restrictions:**

Trailing lambdas have three compile-time restrictions that keep them unambiguous and statement-like:

1. **Void-only:** The target callback parameter must return `void`. If the expected lambda type has a non-void return type, the trailing form is rejected — use an explicit lambda instead:

```javascript
// OK — void callback
items.forEach() { print(it) }

// ERROR — non-void callback; use explicit lambda
items.map() { it * 2 }           // ✗ compile error
items.map(=> it * 2)             // ✓ explicit parameterless lambda
items.map((it) => it * 2)        // ✓ explicit lambda with params
```

2. **No return statements:** `return` is forbidden inside trailing lambda bodies, whether bare or with a value:

```javascript
// ERROR — return inside trailing lambda
items.forEach() { return }       // ✗ compile error

// OK — return inside a regular lambda nested within
items.forEach() {
    const fn = (x: int): int => { return x + 1 }
    print(fn(it))
}
```

3. **No chaining:** Method or property chaining off a trailing lambda call is forbidden:

```javascript
// ERROR — chaining after trailing lambda
items.filter() { print(it) }.map(=> it * 2)  // ✗ compile error

// OK — use explicit lambdas for chaining
items.filter((it) => it > 0).map(=> it * 2)
```

**Semantics:**
- The trailing block is a **parameterless** lambda — parameter names are inherited from the callback type signature (same as `=> expr`).
- The trailing lambda is appended as the **last positional argument** to the call.
- Parentheses `()` are always required before the trailing block.
- The opening `{` must be on the **same line** as the closing `)` to avoid ambiguity with destructuring and other `{`-starting constructs on the following line:

```javascript
// Trailing lambda — `{` on same line as `)`
items.forEach() { print(it) }

// NOT a trailing lambda — `{` on next line starts a new statement
items.forEach()
{ x, y } := point
```

---

## Function Types

Function types include parameter names as part of the type signature:

```javascript
type Callback = (value: int, description: string): void
type Predicate<T> = (item: T): bool
type Transform = (input: int): int
type BinaryOp = (left: int, right: int): int
```

---

## Functions as `const` Sugar

`function <name>` declarations are syntactic sugar for `const` lambda declarations:

```javascript
// These are equivalent:
function bar(x: int): int => x * 12
const bar = (x: int): int => x * 12
```

This means:
- Functions follow the same scoping rules as `const`
- Global functions hoist; nested functions do not
- Functions are immutable bindings — cannot be reassigned
- Functions close over their lexical scope like any lambda
