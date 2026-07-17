# Error Handling

## Overview

Doof has no exceptions. Fallible code uses explicit values and local control-flow
constructs:

- `Result<T, E>` for expected, recoverable failures
- `panic(...)` for programmer errors and impossible states
- `catchPanic(...)` only at controlled boundaries that need to convert a panic
  into a `Result`

The core rule is simple: expected failures must appear in the type system.

---

## Result Types

`Success<T>` and `Failure<E>` are intrinsic types. `Result<T, E>` is exactly the
canonical union `Success<T> | Failure<E>`, so a Result value is always in one of
two states:

- success, carrying a payload of type `T`
- failure, carrying an error payload of type `E`

The arm types may be written explicitly and constructed without a surrounding
Result context. Both constructor spellings are equivalent:

```doof
ok: Success<int> := Success(42)
alsoOk: Success<int> := Success { value: 42 }
failed: Failure<string> := Failure("bad")
alsoFailed: Failure<string> := Failure { error: "bad" }
```

An arm is assignable to a compatible Result union. Explicitly spelling
`Success<T> | Failure<E>` has exactly the same behavior as `Result<T, E>`, and
the two arms may appear in either order.

`T` is the success payload type. `E` is the failure payload type. Either can be
a class, enum, primitive, collection, nullable type, or union:

```doof
Result<int, ParseError>
Result<Config, string>
Result<Data, IOError | NetworkError>
```

Use specific error types when callers need to branch on the cause. Use `string`
or another simple type when every failure is handled uniformly.

### Wrapping Values

`Success(...)` constructs `Success<T>` and `Failure(...)` constructs
`Failure<E>`. A surrounding Result type provides contextual payload typing when
available; otherwise the payload determines the standalone arm type.

```doof
function parseCount(text: string): Result<int, string> {
    if text == "" {
        return Failure("empty input")
    }

    return Success(42)
}
```

Named construction is also supported as an alternate spelling for the same
wrapping operation:

```doof
return Success { value: count }
return Failure { error: .InvalidFormat }
```

Either channel may be payloadless:

```doof
function save(): Result<void, string> {
    if !canWrite() {
        return Failure("disk full")
    }

    return Success()
}
```

`Success()` and `Success {}` are valid only for `Result<void, E>`, where the
success state carries no payload. `Success(value)` and
`Success { value: value }` are valid only for non-void success types.

Likewise, `Failure()` and `Failure {}` construct `Failure<void>`. That arm has
no `.error` member, cannot be captured by `else error` or a failure case binding,
and propagation or panic paths do not attempt to format an error payload.

### Built-in ParseError

Numeric parse helpers return `Result<T, ParseError>`:

```doof
enum ParseError {
    InvalidFormat,
    Overflow,
    Underflow,
    EmptyInput,
}

count := int.parse("123")      // Result<int, ParseError>
ratio := double.parse("3.14")  // Result<double, ParseError>
```

---

## Handling Results Explicitly

Use `case` when success and failure paths need different logic. A `Success`
pattern matches the success state and exposes the success payload as `.value`;
a `Failure` pattern matches the failure state and exposes the error payload as
`.error`.

```doof
case int.parse(input) {
    s: Success -> println("count=${s.value}")
    f: Failure -> println("invalid count: ${f.error.name}")
}
```

The `.value` and `.error` members exist only on the narrowed case-arm binding.
They are not fields on the `Result` value itself:

```doof
result: Result<int, string> := int.parse(input)

value := result.value  // Error: Result<int, string> has no field "value"
error := result.error  // Error: Result<int, string> has no field "error"
```

The type checker must first know which state is present.

### Result Values Must Be Used

A `Result` value cannot be silently discarded. Calling a `Result`-returning
function as a bare statement is a compile-time error unless the call has a local
failure handler.

```doof
function readText(path: string): Result<string, string> { ... }

readText("config.json")  // Error: Result value must be used
```

Valid ways to acknowledge the result include:

```doof
result := readText("config.json")
try text := readText("config.json")
text := try! readText("config.json")
text := try? readText("config.json")
text := readText("config.json") ?? "default"

readText("config.json") else error {
    println("read failed: ${error}")
}

return readText("config.json")

case readText("config.json") {
    s: Success -> println(s.value)
    f: Failure -> println(f.error)
}
```

The must-use rule prevents accidental loss of recoverable failures.

---

## Propagation and Unwrapping

### `try` Statement

Statement-level `try` unwraps the success payload or propagates the failure from
the current function.

```doof
function loadConfig(path: string): Result<Config, string> {
    // readText(), parseJsonValue(), and Config.fromJsonValue() each return
    // Result<_, string>.
    try text := readText(path)
    try json := parseJsonValue(text)
    try config := Config.fromJsonValue(json)
    return Success(config)
}
```

Rules:

- `try` can only be used in a function that returns `Result<_, E>`.
- The tried expression must have type `Result<T, F>`.
- `F` must be assignable to the enclosing function's error type `E`.
- The binding receives the success payload type `T`, not `Result<T, F>`.
- `try` is a statement-level construct, not an expression.

Supported forms:

```doof
try step()                 // Result<void, E>; no value is bound
try value := expr          // immutable binding
try value: Type := expr    // typed immutable binding
try readonly value = expr  // readonly declaration
try let value = expr       // mutable declaration
try target = expr          // assignment to an existing variable
try (a, b) := expr         // positional destructuring
try [a, _, c] := expr      // array destructuring
try { name, age } := expr  // named destructuring
```

`Result<void, E>` can be used only with the bare `try expr` form. Binding a
void success value is rejected.

For array destructuring, the success type must be an array. The generated code
panics at runtime if the success array is shorter than the pattern.

### `try!` Expression

`try!` unwraps the success payload or panics on failure:

```doof
config := try! loadConfig("required.json")
```

It is an expression and can be used in any function. Use it only when failure
means the program cannot sensibly continue.

### `try?` Expression

`try?` converts `Result<T, E>` to `T | null`:

```doof
config := try? loadConfig("optional.json")
```

On success, the result is the success payload. On failure, the result is
`null`.

`try?` is rejected for `Result<void, E>` because there is no success payload to
return. Use bare `try`, `case`, or statement-`else` instead.

---

## Declaration-`else`

Declaration-`else` unwraps a nullable and/or `Result` expression with an
explicit bail-out path.

```doof
config := loadConfig(path) else error {
    return Failure("could not load config: ${error}")
}

name := maybeName() else {
    return Failure("missing name")
}
```

The binding after the `else` block is the happy-path type:

| Subject type | Binding type after `else` |
| --- | --- |
| `T | null` | `T` |
| `Result<T, E>` | `T` |
| `Result<T, E> | null` | `Result<T, E>` |
| `Result<T | null, E>` | `T | null` |

Rules:

- The subject must be nullable, a `Result`, or both.
- A declaration removes exactly one layer. A nullable Result first loses its
  outer null; a second declaration is required to unwrap the Result.
- If a binding is introduced and used after the `else`, the `else` block must
  exit the current scope with `return`, `break`, `continue`, or `panic(...)`.
- Without failure capture, the binding name has the original full type inside
  the `else` block.
- `else error { ... }` captures the error payload for non-null `Result<T, E>`
  subjects.
- Failure capture is not allowed for nullable-only subjects or
  `Result<T, E> | null` subjects because the unhappy path may be null.

```doof
text := readText(path) else error {
    return Failure("read failed: ${error}")
}

value := maybeResult() else {
    return Failure(case value {
        f: Failure -> f.error
        _ -> "missing value"
    })
}
```

The discard form has no post-block binding, so the handler may fall through:

```doof
_ := writeText(path, text) else error {
    println("write failed: ${error.message}")
}
```

---

## Statement-`else`

A `Result`-returning expression statement can attach `else` to handle failure
without binding the success value:

```doof
saveState() else error {
    println("save failed: ${error}")
}
```

Rules:

- The subject must be a non-null `Result<T, E>`.
- The captured name receives the error payload.
- The handler may fall through because no success-path binding must be made
  definitely available afterward.

This form satisfies the must-use rule for side-effecting fallible calls.

---

## Fallback and Force Operators

### `??`

`??` works with nullable values and `Result` values:

```doof
name := maybeName() ?? "anonymous"
config := loadConfig(path) ?? defaultConfig()
```

For `Result<T, E> ?? T`, the expression unwraps the success payload or evaluates
the fallback on failure. Evaluation is lazy and right-associative.

### `??=`

`??=` assigns only when the left-hand variable is null or a `Failure`:

```doof
let cached: string | null = null
cached ??= loadFromDisk()

let config: Result<Config, string> = loadCache()
config ??= loadDefaults()
```

For `Result<T, E>` variables, the right-hand side may be either a compatible
`Result<T, E>` or a plain `T`, which is wrapped as a success Result.

### `!` and `!.`

Postfix `!` unwraps nullable values and `Result` success values, panicking on
null or `Failure`:

```doof
user := maybeUser()!
config := loadConfig(path)!
```

Force member access `!.` combines unwrap-or-panic with a field or method access:

```doof
email := loadUser(id)!.email
response := connection!.send(request)
```

Applying `!` or `!.` to a value that is neither nullable nor a `Result` is a
compile-time error.

---

## Optional Chaining Across Results

`?.` checks for null and propagates null through the success channel. It does
not unwrap `Result`.

```doof
// findUser(): Result<User, LookupError>
// User.profile(): Result<Profile, ProfileError>

profile := findUser(id)?.profile()
// Result<Profile | null, LookupError | ProfileError>
```

If the left side is `Failure`, the failure is preserved. If the success value is
null, the chain short-circuits as a success containing null. If a later call
also returns `Result`, the error types are unioned.

For a plain member on the success value:

```doof
// findUser(): Result<User, LookupError>
name := findUser(id)?.name  // Result<string | null, LookupError>
```

Use `try?` if both failures and nulls should collapse to `null`:

```doof
profile := try? findUser(id)?.profile()  // Profile | null
```

---

## Result Helper Methods

`Result<T, E>` provides helper methods for common transformations:

```doof
function describe(input: Result<int, string>): Result<string, string> {
    return input.map((value: int): string => "count=" + string(value))
}

function recover(input: Result<int, string>): int {
    return input.unwrapOrElse((error: string): int => error.length)
}

function next(input: Result<int, string>): Result<string, string | bool> {
    return input.andThen((value: int): Result<string, bool> => Success("next=" + string(value)))
}
```

| Method | Result |
| --- | --- |
| `.map(fn)` | Transform the success payload from `T` to `U` and keep failures unchanged |
| `.mapError(fn)` | Transform the error payload from `E` to `F` and keep successes unchanged |
| `.andThen(fn)` | Chain a fallible operation after success: `Result<U, E | F>` |
| `.orElse(fn)` | Recover from failure with another `Result`: `Result<T | U, F>` |
| `.unwrapOr(value)` | Return the success value or a fallback value |
| `.unwrapOrElse(fn)` | Return the success value or compute a fallback from the error |
| `.ok()` | Convert success to `T | null`, discarding failures |
| `.err()` | Convert failure to `E | null`, discarding successes |
| `.isSuccess()` | Return `true` when the Result is in the success state |
| `.isFailure()` | Return `true` when the Result is in the failure state |

`map` is not available on `Result<void, E>` because there is no success payload
to transform. `andThen` receives a zero-argument callback for `Success<void>`.
For `Failure<void>`, `.err()` is absent and `mapError`, `orElse`, and
`unwrapOrElse` receive zero-argument callbacks.

---

## Checked Narrowing with `as`

`as` performs checked runtime narrowing or conversion and returns a `Result`.

```doof
value: int | string := "hello"
narrowed := value as string       // Result<string, string>

input: Result<int | string, bool> := Success("hello")
next := input as string           // Result<string, bool | string>

numeric: int | string := 42
wide := numeric as long           // Result<long, string>
```

Rules:

- For plain values, `expr as T` returns `Result<T, string>`.
- For `Result<V, F>` sources, it narrows the success channel and returns
  `Result<T, F | string>`.
- Supported sources include unions, nullable types, interfaces to implementing
  classes, numeric primitives and numeric union members, exact `JsonValue`
  carrier members, and `Result` values wrapping those forms.
- Numeric narrowing is checked at runtime and fails when the value cannot be
  represented exactly in the target type.

Because `as` returns `Result`, all standard Result patterns apply:

```doof
try name := value as string
name := try! value as string
name := (value as string) ?? "default"

case value as string {
    s: Success -> s.value.length
    _: Failure -> 0
}
```

See [05-operators.md](05-operators.md#type-narrowing-operator-as) for the full
operator matrix.

---

## Catch Expressions

`catch` captures failures from statement-level `try` inside a block instead of
propagating them from the enclosing function.

```doof
err := catch {
    try readHeader()
    try readBody()
}
```

If every `try` in the block succeeds, the `catch` expression evaluates to
`null`. If a `try` sees a `Failure`, the block stops immediately and evaluates
to that failure payload.

The type is the union of all captured error types plus `null`:

```doof
// readHeader(): Result<void, IOError>
// parseHeader(): Result<Header, ParseError>

err := catch {
    try readHeader()
    try header := parseHeader()
}
// IOError | ParseError | null
```

Rules:

- Only statement-level `try` is redirected by `catch`.
- `try!` still panics on failure.
- `try?` still converts failure to `null`.
- Nested `catch` blocks capture independently.
- A `catch` body with no `try` statements produces a warning.
- In binding form, `return` inside the body returns from the enclosing function.
- In expression form, such as `case catch { ... } { ... }`, `return` in the
  body is rejected for the same reason it is rejected in `case` expression arms.

`catch` is useful when a sequence of fallible operations should be attempted
locally and the caller only needs to know whether any step failed:

```doof
case catch {
    try connect()
    try sendPing()
} {
    error: NetworkError -> println(error.message)
    _ -> println("ready")
}
```

---

## Panic

`panic(message)` terminates normal execution immediately. Use it for programmer
errors, internal invariants, and states that should be impossible in correct
code.

```doof
function getElement<T>(items: T[], index: int): T {
    if index < 0 || index >= items.length {
        panic("index out of bounds: ${index}")
    }

    return items[index]
}
```

Source-originated panics include source location information in generated
programs. Panics should not be used for expected failures such as invalid user
input, missing files, parse errors, or network failures. Model those as
`Result<T, E>`.

### Assertions

The primitive assertion helper is:

```doof
function assert(condition: bool, message: string): void
```

An assertion failure panics. Use assertions for tests and internal invariants,
not recoverable runtime failures.

The `std/assert` module provides richer test helpers:

```doof
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(1 + 1, 2)
    Assert.notEqual(1 + 1, 3)
}
```

These helpers are library APIs, not additional global built-ins.

### `catchPanic`

`catchPanic<T>(f: () => T): Result<T, string>` runs a parameterless callback and
converts a panic from that callback into a failure Result with a string error
payload.

```doof
result := catchPanic(=> {
    initializePlugin()
    return "ready"
})
```

If the callback completes normally, `catchPanic` returns a success Result with
the callback's return value. For a void callback, it returns
`Result<void, string>`.

Use `catchPanic` sparingly at process, plugin, host, or test boundaries. It is
not a general exception system.

---

## Runtime Metrics

Doof provides process-local runtime counters for lightweight instrumentation:

```doof
function metricsIncrement(name: string, value: long): void
function metricsSnapshotPrometheus(): string
```

Counters are keyed by their full metric identity string, including any
Prometheus labels. Increments and snapshots are thread-safe.
`metricsSnapshotPrometheus()` returns sorted Prometheus text lines in the form
`name value`.

---

## When to Use Each Mechanism

| Mechanism | Use for |
| --- | --- |
| `Result` + `case` | Detailed branching by success or failure |
| statement-level `try` | Sequential propagation in a `Result`-returning function |
| `try!` or `!` | Required success where failure is unrecoverable |
| `try?` or `.ok()` | Converting failure to nullable when details do not matter |
| `??` | Supplying a fallback value |
| declaration-`else` | Guard-style unwrap-or-bail control flow |
| statement-`else` | Handling a side-effecting `Result` without a success binding |
| `catch` | Capturing local fallible work without returning early |
| `panic` / `assert` | Programmer errors and impossible states |
| `catchPanic` | Converting panics to `Result` at controlled boundaries |

There is no `finally` or `defer`. Cleanup relies on deterministic destructors
and reference-counted ownership.

## Quick Reference

```doof
// Constructing
return Success(value)
return Success { value: value }
return Success()              // only Result<void, E>
return Failure(error)
return Failure { error: error }

// Explicit handling
case result {
    s: Success -> s.value
    f: Failure -> fallback(f.error)
}

// Propagation and conversion
try value := fallible()
try stepReturningVoid()
value := try! fallible()
maybe := try? fallible()
value := fallible() ?? fallback

// Local handlers
value := fallible() else error { return Failure(error) }
fallibleSideEffect() else error { println(error) }
err := catch { try a(); try b() }

// Helpers
mapped := result.map((value: T): U => transform(value))
chained := result.andThen((value: T): Result<U, F> => next(value))
value := result.unwrapOr(fallback)
maybeValue := result.ok()
maybeError := result.err()
```
