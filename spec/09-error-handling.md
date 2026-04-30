# Error Handling

## Overview

Doof does not have exceptions. Instead, it uses two distinct mechanisms:

- **Result types** — for expected, recoverable errors
- **Panic** — for unrecoverable programmer errors (bugs)

---

## Result Types

Result types represent operations that can fail in expected ways:

```javascript
type Result<T, E> = Success<T> | Failure<E>

class Success<T> {
    const kind = "Success"
    value: T
}

class Failure<E> {
    const kind = "Failure"
    error: E
}
```

### Error Type Flexibility

The error type parameter `E` can be:
- A specific error class: `Result<int, ParseError>`
- A generic error type: `Result<Config, Error>`
- A union of error types: `Result<Data, IOError | NetworkError>`

When combining Results with different error types (e.g., via `?.`), the type system creates error unions:

```javascript
// foo(): Result<Obj, IOError>
// Obj.bar(): Result<int, ParseError>
result := foo()?.bar()  // Result<int | null, IOError | ParseError>
```

**Guidelines:**
- Use specific error types when callers need to distinguish between error cases
- Use generic `Error` for examples or when all errors are handled uniformly
- The type system automatically tracks and unions error types

### Builtin ParseError

Doof provides a builtin `ParseError` enum for numeric parsing helpers:

```javascript
enum ParseError { InvalidFormat, Overflow, Underflow, EmptyInput }
```

The builtin numeric parse APIs use this error type:

```javascript
let result = int.parse("123")  // Result<int, ParseError>
```

### Returning Results

```javascript
function parseCount(s: string): Result<int, ParseError> {
    return int.parse(s)
}
```

### Handling Results

Use `case` statements for exhaustive handling:

```javascript
let result = parseInt("123")
case result {
    s: Success -> print("Got: ${s.value}"),
    f: Failure -> print("Error: ${f.error.name}")
}

// As expression
let value = case parseInt("123") {
    s: Success -> s.value,
    f: Failure -> 0
}
```

### Direct Field Access (Not Supported)

Result values must be destructured before accessing their fields:

```javascript
result: Result<int, Error> := parseInt("123")

// ❌ Cannot access fields directly
let x = result.value   // Error: Result<int, Error> has no field 'value'
let e = result.error   // Error: Result<int, Error> has no field 'error'

// ✅ Must destructure with case
case result {
    s: Success -> print(s.value),
    f: Failure -> print(f.error)
}
```

**Rationale:** Result is a discriminated union. The type system cannot guarantee which variant (Success or Failure) is present without explicit pattern matching, so direct field access is disallowed.

### Result Values Must Be Used

A `Result` value **cannot be silently discarded**. If a function or method returns `Result<T, E>`, the caller must use that value in some form — ignoring it is a compile-time error:

```javascript
function readFile(path: string): Result<string, IOError> { ... }

// ❌ Error: Result value must be used
readFile("config.json")

// ✅ Capture in a variable
const result = readFile("config.json")

// ✅ Unwrap with try (early return on Failure)
try content := readFile("config.json")

// ✅ Unwrap with try! (panic on Failure)
content := try! readFile("config.json")

// ✅ Convert to optional with try?
content := try? readFile("config.json")

// ✅ Pass to another function
process(readFile("config.json"))

// ✅ Return from the current function
return readFile("config.json")

// ✅ Use in a case expression
case readFile("config.json") {
    s: Success -> s.value,
    f: Failure -> ""
}
```

**Rationale:** Silently dropping a `Result` means a `Failure` is ignored without acknowledgement. This is a common source of bugs in error handling — the language enforces that every potential failure is at least acknowledged at the call site.

---

## Result Propagation Operators

Doof provides three operators for working with Result types without explicit `case` matching:

### `try` — Early Return on Failure

The `try` statement unwraps a `Success` value or returns the `Failure` from the enclosing function. Unlike `try!` and `try?`, `try` is a **statement-level construct**, not an expression, because it performs early return (control flow):

```javascript
function loadConfig(): Result<Config, Error> {
    try content := readFile("config.json")   // string (or early return on Failure)
    try parsed := parseJSON(content)          // JSON (or early return)
    try config := validate(parsed)            // Config (or early return)
    return Success { value: config }
}
```

**Supported binding forms:**

```javascript
try x := expr             // immutable binding
try x: Type := expr       // typed immutable binding
try const x = expr        // const declaration
try readonly x = expr     // readonly declaration
try let x = expr          // let declaration
try (a, b) := expr        // positional destructuring
try [a, b] := expr        // array destructuring
try {name, age} := expr   // named destructuring
try x = expr              // assignment to existing variable
```

**Type requirements:**
- `try` can only be used in functions that return `Result<T, E>`
- The expression must evaluate to a `Result<T, E>` type
- The error type `E` of the expression must be assignable to the error type of the enclosing function's return type
- The bound variable(s) receive type `T` (the success type), not `Result<T, E>`

For array destructuring, `T` itself must be an array type. `try [a, _, c] := expr` unwraps a `Result<U[], E>`, binds each non-discard name as `U`, and panics at runtime if the success array is shorter than the pattern.

### `try!` — Panic on Failure

The `try!` operator unwraps a `Success` value or panics if the Result is a `Failure`:

```javascript
config := try! loadConfig()  // Config (panics if loadConfig returns Failure)
data := try! readFile("required.txt")  // Panics with error message if file can't be read
```

Use `try!` when a failure indicates a programming error or unrecoverable condition.

### `try?` — Convert Failure to Null

The `try?` operator converts a `Result<T, E>` to `T | null`, returning `null` on `Failure`:

```javascript
config := try? loadConfig()  // Config | null (null if error)

if config != null {
    useConfig(config)  // config is narrowed to Config
}

// Common pattern: provide default value
config := try? loadConfig() ?? defaultConfig
```

`try?` requires a non-`void` success type. `Result<void, E>` has no success payload to convert to `null`; use `try` for propagation or `case` for branching instead.

### Interaction with Optional Chaining (`?.`)

The `?.` operator propagates nulls through chains. When used with Result types, it adds `null` to the Success value type:

```javascript
// foo(): Result<MyObject, Error>
// MyObject.bar(): Result<int, Error>

result := foo()?.bar()  // Result<int | null, Error>
// If foo() is Success(null), the chain short-circuits and result is Success(null)
// If foo() is Failure, result is that Failure
// Otherwise, bar() is called

// If bar() returns a plain value (not Result):
// MyObject.getValue(): int
result := foo()?.getValue()  // Result<int | null, Error>

// Combining try? with ?. for null-coalescing error handling
value := try? foo()?.bar()  // int | null
// Both Failure and null in the chain become null

// Multiple error types are unioned
// foo(): Result<Obj, E1>
// Obj.bar(): Result<int, E2>
result := foo()?.bar()  // Result<int | null, E1 | E2>
```

### Comparison of Error Handling Approaches

```javascript
// Explicit case matching (most control)
case readFile("data.txt") {
    s: Success -> processData(s.value),
    f: Failure -> handleError(f.error)
}

// Early return (clean sequential code) — try is a statement
function process(): Result<Output, Error> {
    try data := readFile("data.txt")
    return Success { value: transform(data) }
}

// Panic (unrecoverable errors) — try! is an expression
data := try! readFile("required-config.txt")

// Convert to optional (when error details don't matter) — try? is an expression
data := try? readFile("optional-cache.txt")
```

### Result Helper Methods

`Result<T, E>` also provides a small set of helper methods for common success/error transformations without a full `case` expression:

```javascript
function describeCount(input: Result<int, string>): Result<string, string> {
    return input.map((value: int): string => "count=" + string(value))
}

function recover(input: Result<int, string>): int {
    return input.unwrapOrElse((error: string): int => error.length)
}

function next(input: Result<int, string>): Result<string, string | bool> {
    return input.andThen((value: int): Result<string, bool> => Success("next=" + string(value)))
}
```

| Method | Signature | Description |
|---|---|---|
| `.map(fn)` | `(fn: (value: T): U) -> Result<U, E>` | Transform the success value and keep failures unchanged |
| `.mapError(fn)` | `(fn: (error: E): F) -> Result<T, F>` | Transform the failure value and keep successes unchanged |
| `.andThen(fn)` | `(fn: (value: T): Result<U, F>) -> Result<U, E \| F>` | Chain another fallible operation after a success |
| `.orElse(fn)` | `(fn: (error: E): Result<U, F>) -> Result<T \| U, F>` | Recover from a failure with another Result-producing operation |
| `.unwrapOr(value)` | `(value: T) -> T` | Return the success value or a fallback |
| `.unwrapOrElse(fn)` | `(fn: (error: E): T) -> T` | Return the success value or compute a fallback from the failure |
| `.ok()` | `() -> T \| null` | Convert success to a nullable value, discarding failures |
| `.err()` | `() -> E \| null` | Convert failure to a nullable value, discarding successes |

`map` is not available on `Result<void, E>` because there is no success payload to transform.

### Quick Reference

```javascript
// Type Definition
type Result<T, E> = Success<T> | Failure<E>

// Creating Results
return Success { value: data }
return Failure { error: ParseError { message: "Invalid" } }

// try statement (early return — statement-level)
try value := expr        // T (or early return Failure<E>)
try const value = expr   // T (or early return Failure<E>)
try let value = expr     // T (or early return Failure<E>)
try (a, b) := expr       // destructured T (or early return)
try {a, b} := expr       // destructured T (or early return)

// try! and try? (expression-level)
value := try! expr       // T (or panic)
value := try? expr       // T | null (Failure → null)
value := expr ?? fallback// T (unwraps Success or uses fallback on Failure)

// Optional Chaining
result?.method()          // Result<T | null, E> (null propagates in success type)
try? result?.method()     // T | null (errors and null both → null)

// Null-Coalescing with Result
config := loadConfig() ?? defaultConfig           // Config (unwraps or uses fallback)
data := loadCache() ?? loadDisk() ?? compute()    // Right-to-left: loadCache() ?? (loadDisk() ?? compute())

// Manual Destructuring
case result {
    s: Success -> s.value,
    f: Failure -> f.error
}

// Helper Methods
mapped := result.map((value: T): U => transform(value))
mappedError := result.mapError((error: E): F => rewrite(error))
chained := result.andThen((value: T): Result<U, F> => next(value))
recovered := result.orElse((error: E): Result<U, F> => recover(error))
value := result.unwrapOr(fallback)
value2 := result.unwrapOrElse((error: E): T => fallbackFrom(error))
maybeValue := result.ok()
maybeError := result.err()

// Error Type Unions
// If foo(): Result<A, E1> and bar(): Result<B, E2>
result := foo()?.bar()   // Result<B, E1 | E2>
```

---

## Type Narrowing with `as`

The `as` operator performs checked runtime type narrowing/conversion. For plain values it returns `Result<T, string>`. For `Result<V, F>` sources it narrows the success channel and returns `Result<T, F | string>`:

```javascript
value: int | string := "hello"
r := value as string       // Result<string, string>

input: Result<int | string, bool> := Success("hello")
next := input as string    // Result<string, bool | string>

numeric: int | string := 42
wide := numeric as long    // Result<long, string>
```

This integrates naturally with all Result handling patterns:

```javascript
// Propagate failure (in Result-returning function):
function extractName(data: int | string): Result<string, string> {
    try name := data as string
    return Success { value: name }
}

// Else-narrow:
s := value as string else { return "default" }

// Panic on failure:
s := try! value as string

// Pattern match:
const len = case value as string {
    ok: Success -> ok.value.length,
    _: Failure -> 0
}
```

Supported narrowing sources: unions (`A | B`), nullable types (`T | null`), interfaces (to implementing classes), numeric primitives and numeric union members when the runtime value can be converted exactly to the target numeric type, `JsonValue` exact carrier members, and `Result<V, F>` when `V` is one of those same narrowable source forms. See [05-operators.md](05-operators.md#type-narrowing-operator-as) for the full support matrix.

---

## Catch Expression — Local Error Capture

The `catch` expression groups fallible operations and captures any error locally, without propagating it to the enclosing function. Inside a `catch` block, `try` statements break out of the block (instead of returning from the enclosing function) and the error becomes the value of the `catch` expression. If the block completes without error, the value is `null`.

### Basic Usage

```javascript
const err = catch {
    try a()
    try b()
}
// err: IOError | null (if both a() and b() return Result<_, IOError>)
```

The inferred type of `err` is the **union of all error types** from `try` statements inside the block, plus `null`:

```javascript
// a(): Result<void, IOError>
// b(): Result<void, ParseError>
const err = catch {
    try a()
    try b()
}
// err: IOError | ParseError | null
```

### With Case Expression

A `catch` expression can be used as the subject of a `case` expression to dispatch on the captured error type:

```javascript
case catch { try a(); try b() } {
    io: IOError -> handleIO(io),
    ex: ParseError -> handleParse(ex),
    _ -> print("all good")
}
```

The wildcard arm handles the `null` case (no error).

### Type Inference Rules

- The type of a `catch` expression is the deduplicated union of all error types from `try` statements in the body, plus `null`
- Single error type: `E | null`
- Multiple error types: `E1 | E2 | ... | null`
- If the body contains no `try` statements, a warning diagnostic is emitted

### Interaction with `return`

- **Binding form** (`const err = catch { ... }`): `return` inside the body returns from the **enclosing function**, because the block is emitted at statement level
- **Expression form** (`case catch { ... } { ... }`): `return` inside the body is **banned**, same as inside `case` expression arms, because the block is wrapped in an IIFE for evaluation

### Nesting

`catch` blocks can be nested. Each block captures errors independently:

```javascript
const outer = catch {
    const inner = catch {
        try a()   // captured by inner
    }
    try b()       // captured by outer
}
```

### Interaction with `try` Variants

Only the `try` **statement** (early-return form) is redirected inside a `catch` block. `try!` and `try?` are expressions and behave normally (panic or convert to null, respectively).

---

## Panic

Panic is for unrecoverable errors that indicate bugs — conditions that should never occur in correct code.

```javascript
function getElement<T>(array: T[], index: int): T {
    if index < 0 || index >= array.length {
        panic("Index out of bounds: ${index}")
    }
    return array[index]
}
```

**Panic behaviour:**
- Immediately terminates the program
- For source-originated panics, prefixes the message with the Doof source filename and line, for example `main.do:3: ...`
- Prints stack trace and panic message
- Should **only** be used for programmer errors, not expected runtime conditions

### Assertions

```javascript
function assert(condition: bool, message: string): void {
    if !condition {
        panic("Assertion failed: ${message}")
    }
}
```

`assert(...)` is the standard assertion primitive for Doof tests.

For richer test assertions, import `Assert` from the compiler-provided `std/assert` module:

```javascript
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(1 + 1, 2)
    Assert.notEqual(1 + 1, 3)
}
```

`Assert` is a library surface layered on top of the primitive `assert(...)`. These helpers are imported explicitly; they are not additional global built-ins. The initial surface includes `equal`, `notEqual`, `isTrue`, `isFalse`, and `fail`.

Typical usage:

```javascript
export function testAdd(): void {
    assert(1 + 1 == 2, "expected 1 + 1 to equal 2")
}
```

When an assertion fails, it panics immediately. In normal programs that aborts execution. In `doof test`, each test runs in its own process, so a failed assertion marks that test as failed without preventing the rest of the suite from running.

Use assertions for:

- test expectations
- internal invariants that indicate a bug when violated

Do not use assertions for:

- expected runtime failures that should be modeled as `Result<T, E>`
- user input validation that should produce recoverable diagnostics

---

## When to Use Each

| Mechanism | Use For | Examples |
|-----------|---------|----------|
| **Result + `case`** | When you need to handle errors differently | Retry logic, fallbacks, detailed error reporting |
| **`try` statement** | Sequential error propagation in Result-returning functions | Validation pipelines, chained operations |
| **Result + `try!`** | When failure indicates unrecoverable state | Required config files, initialization |
| **Result + `try?`** | When error details don't matter, convert to optional | Optional features, cached data |
| **Result + `??`** | Provide specific fallback value on Failure | Configuration with defaults, fallback chains |
| **`else` narrow** | Unwrap Result or nullable with custom bail-out logic | Guard clauses, early-return patterns |
| **Panic** | Programmer errors (bugs) | Array bounds violations, assertion failures |

```javascript
// ✅ Expected failures use Result
function readFile(path: string): Result<string, IOError> { ... }
function parseJSON(s: string): Result<JSON, ParseError> { ... }

// ✅ Use case for detailed error handling
case readFile("data.txt") {
    s: Success -> processData(s.value),
    f: Failure -> {
        logError(f.error)
        useDefaultData()
    }
}

// ✅ Use try for sequential operations
function loadConfig(): Result<Config, Error> {
    try content := readFile("config.json")
    try parsed := parseJSON(content)
    return Success { value: validate(parsed) }
}

// ✅ Use try! when failure is unrecoverable
config := try! loadConfig()

// ✅ Use try? when you don't care about error details
cachedData := try? loadCache() ?? computeFresh()

// ✅ Use ?? directly with Result for clearer fallback intent
config := loadConfig() ?? defaultConfig

// ✅ Programmer errors panic
function divide(a: int, b: int): int {
    if b == 0 {
        panic("Division by zero")
    }
    return a / b
}
```

---

## Resource Cleanup

Doof does not have `finally` blocks or `defer` statements. Instead, resource cleanup is handled by **deterministic destructors** — when an object's reference count reaches zero, its destructor runs immediately. This guarantees cleanup regardless of exit path (normal return, early `try` return, or panic).

See [Classes and Interfaces — Memory Management](07-classes-and-interfaces.md) for destructor syntax and weak reference details.

```javascript
function transferData(): Result<void, IOError> {
    try src := openFile("input.dat")
    try dst := openFile("output.dat")
    
    try data := src.read()
    try dst.write(data)
    
    return Success()
    // dst and src destructors run automatically on scope exit
}
```

---

## Design Rationale

**Why no exceptions?**

1. **Explicit error handling** — Result types make error cases visible in function signatures
2. **Exhaustiveness checking** — `case` statements ensure all outcomes are handled
3. **No hidden control flow** — no invisible throws/catches to track
4. **Clear separation** — Result for recoverable errors, panic for bugs
