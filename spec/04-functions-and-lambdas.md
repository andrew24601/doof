# Functions and Lambdas

## Overview

Doof treats functions as first-class values. Use `function <name>` for named callables and `:=` for local lambda bindings.

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

Block-bodied functions with a non-`void` return type must not fall through to
their closing brace. Every reachable path must return a value, call `panic(...)`,
or otherwise be unable to complete normally (for example, an unconditional
`while true` loop). A missing `else`, a loop that can `break`, or a `case`
without a wildcard or known exhaustive Result-arm pattern does not establish a
return on every path.

```javascript
function choose(flag: bool): int {
    if flag {
        return 1
    }
    // ❌ Error: the function can reach the closing brace without returning
}
```

`void` functions may fall through normally. Expression-bodied functions are
already value-producing and are checked against their declared or inferred
return type as usual.

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

Default parameter expressions may call static class methods, which makes factory
defaults reusable across functions and class `constructor` methods. When the
parameter type is a class, a leading-dot shorthand may access a static field or
static method on that class:

```doof
class Transform {
    x: int
    static identity(): Transform => Transform(0)
}

function spawn(transform: Transform = Transform.identity()): Transform => transform
function spawnDefault(transform: Transform = .identity()): Transform => transform
```

The `{` must immediately follow the callee token with no whitespace: `clamp{ ... }`, not `clamp { ... }`.

The same named-call form applies to methods and imported functions.

### `SourceLocation` and `@caller`

Doof provides a built-in `SourceLocation` class and a special `@caller` default-expression intrinsic for call-site attribution.

```doof
function debug(message: string, source: SourceLocation = @caller): void {
    println(source.fileName + ":" + string(source.line) + ":" + source.functionName)
}
```

`SourceLocation` is always in scope and has this shape:

```doof
class SourceLocation {
    readonly fileName: string
    readonly line: int
    readonly functionName: string = "<module>"
}
```

Rules:

- `@caller` is only valid as a default value for a parameter or a class field.
- It evaluates at the call or construction site, not where the function or class was declared.
- Callers can override it explicitly by passing a `SourceLocation` argument.
- `fileName` uses the module import-path form: no `.do` extension, `index.do` barrels collapse to the directory path.
- `functionName` is `"<module>"` at module scope, the function name for free functions, and `ClassName.methodName` for methods.

This makes wrapper APIs straightforward:

```doof
function assert(condition: bool, message: string, source: SourceLocation = @caller): void {
    if !condition {
        panic("Assertion failed at " + source.fileName + ":" + string(source.line) + ": " + message)
    }
}

function assertEqual<T>(left: T, right: T, message: string, source: SourceLocation = @caller): void {
    assert(left == right, message, source)
}
```

### Modifiers

Top-level and class-level function declarations accept modifiers that control visibility and concurrency behaviour.

| Modifier | Applies to | Effect |
|---|---|---|
| `export` | top-level | Makes the function importable by other modules |
| `private` | top-level, class method | Restricts the function to the defining source file |
| `isolated` | top-level, class method | Declares the function safe for concurrent execution |
| `static` | class method | Binds the function to the class rather than an instance |

`isolated` is checked transitively. Isolated code may mutate `this`, parameters,
locals, and freshly created values, but it cannot access mutable module/static
state or call non-isolated code. Ordinary declarations are also inferred
isolated when they satisfy these rules; the modifier makes the guarantee an
explicit compile-time contract.

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
double := (x: int): int => x * 2

// Block body
triple := (x: int): int { return x * 3 }
```

### Inferred Return Type

```javascript
double := (x: int) => x * 2

compute := (x: int) => {
    y := 3
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

### Closure Capture Lifetime

Lambdas capture immutable outer bindings by value. A mutable `let` binding
captured by a lambda remains shared mutable state even when the lambda escapes
the declaring function; reads and writes through all closures observe the same
binding. Mutable locals that are not captured retain ordinary local lifetime.

Function values remain actor-affine callbacks regardless of their capture set.
Capture lifetime does not bypass the owning-actor checks described in
[Concurrency](10-concurrency.md#actor-affine-callbacks).

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
c := [1, 2, 3].map((item: int): int => item * 2)
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

When a function call is used as a complete expression statement, a trailing block `{ body }` after the closing `)` is parsed as an additional parameterless lambda argument. The opening `{` must be on the **same line** as the closing `)`. Trailing lambdas are intentionally scoped to read as control-structure-like statement blocks (e.g. `forEach`, `withTransaction`, `withLock`):

```javascript
// Void callback — trailing lambda form
items.forEach() { print(it) }

// Multi-statement trailing lambda
items.forEach() {
    label := "Item: " + it.name
    print(label)
}

// Trailing lambda appended after existing positional args
forEachWithInit([1, 2, 3], 0) { print(it) }
```

Trailing lambdas are statement syntax, not general expression syntax. They are only valid as the final part of an expression statement:

```javascript
// OK — complete expression statement
items.forEach() { print(it) }

// ERROR — trailing lambda in a binding initializer
logged := withTransaction() { writeAuditLog(it) }

// ERROR — trailing lambda in an assignment RHS
handler = withLock() { refresh() }

// OK — use explicit lambdas in expression positions
logged := withTransaction(=> writeAuditLog(it))
handler = withLock((): void => { refresh() })
```

**Restrictions:**

Trailing lambdas have compile-time restrictions that keep them unambiguous and statement-like:

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
    fn := (x: int): int => { return x + 1 }
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
- The call plus trailing lambda must form a complete expression statement; bindings, assignments, returns, arguments, and other expression contexts require an explicit lambda.
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

## Named Functions and Lambda Bindings

Named functions and local lambda bindings share the same function type model:

```javascript
function bar(x: int): int => x * 12
barLambda := (x: int): int => x * 12
```

This means:
- Global functions hoist; nested functions do not
- Function declarations and `:=` lambda bindings are immutable — they cannot be reassigned
- Functions close over their lexical scope like any lambda

First-class function values are actor-affine callbacks. Normal Doof call syntax
still invokes them:

```javascript
function apply(f: (x: int): int, x: int): int => f(x)
```

The explicit local form is also available:

```javascript
function apply(f: (x: int): int, x: int): int => f.call(x)
```

`f.call(...)` executes immediately and is valid only in the callback's owning
actor domain. `f.post(...)` enqueues the invocation on the owning actor and
returns `Promise<R>`, where `R` is the callback return type. Function-typed
parameters in native imports also lower to `doof::callback`; native C++ must
integrate with that callback type and choose the appropriate execution mode
explicitly.
