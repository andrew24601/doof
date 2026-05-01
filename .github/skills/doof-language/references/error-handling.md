# Doof Error Handling Reference

## Overview

Doof has no exceptions.

- Use `Result<T, E>` for expected, recoverable failures.
- Use `panic(...)` for unrecoverable programmer errors.

## Result Types

```doof
type Result<T, E> = Success<T> | Failure<E>

class Success<T> { const kind = "Success"; value: T }
class Failure<E> { const kind = "Failure"; error: E }
```

### Returning Results

```doof
function parseInt(s: string): Result<int, string> {
    if invalid {
        return Failure { error: "Invalid number" }
    }
    return Success { value: parsed }
}
```

### Handling with `case`

```doof
case result {
    s: Success => println(s.value),
    f: Failure => println(f.error)
}
```

Direct field access such as `result.value` or `result.error` is rejected.

### Must-Use Rule

Result values cannot be silently discarded. Ignoring a `Result` is a compile error.

## Propagation and Unwrapping

### `try` Statement

Statement-level `try` unwraps `Success` or returns the `Failure` from the enclosing function. It only works inside functions that themselves return `Result<..., ...>`.

```doof
function loadConfig(): Result<Config, Error> {
    try content := readFile("config.json")
    try parsed := parseJSON(content)
    try config := validate(parsed)
    return Success { value: config }
}
```

Supported binding forms include declarations, typed declarations, destructuring, and assignment:

```doof
try x := expr
try x: Type := expr
try const x = expr
try readonly x = expr
try let x = expr
try (a, b) := expr
try { name, age } := expr
try x = expr
```

### `try!`

Expression-level unwrap-or-panic:

```doof
config := try! loadConfig()
```

### `try?`

Expression-level convert-to-null:

```doof
config := try? loadConfig()
```

`try?` requires a non-`void` success type.

### `??` and `??=`

```doof
config := loadConfig() ?? defaultConfig

let cache: string | null = null
cache ??= loadFromDisk()
```

`??` works on nullable and `Result` sources. Evaluation is right-associative and lazy.

### Force Access

```doof
result!.field
user!.name
```

`!` unwraps nullable values or `Result` values and panics on the unhappy path.

## Declaration-`else`

Declaration-`else` provides an unwrap-or-bail pattern for nullable and `Result` values.

```doof
config := loadConfig() else { return "" }
name := maybeName else { panic("missing name") }
```

Rules:

- The `else` block must exit the current scope via `return`, `break`, `continue`, or `panic(...)`.
- Inside the `else` block, the binding has the original full type.
- After the block, the binding has the narrowed happy-path type.
- It applies only to nullable and/or `Result` types.

```doof
x := loadConfig() else {
    return case x {
        _: Success => "unexpected",
        f: Failure => f.error.message
    }
}
```

## Checked Narrowing with `as`

`as` performs checked runtime narrowing or conversion.

```doof
x: int | string := "hello"
s := x as string

payload: JsonValue := { ok: true }
obj := payload as readonly Map<string, JsonValue>

numeric: int | string := 42
wide := numeric as long
```

Behavior:

- For plain values, `as` yields `Result<T, string>`.
- For `Result<V, F>` sources, it narrows the success channel and yields `Result<T, F | string>`.
- Supported sources include unions, nullable types, interfaces, exact numeric conversions, `JsonValue`, and `Result` values wrapping those forms.
- Numeric `as` is checked. It fails when the runtime value cannot be represented exactly in the target type.

Useful combinations:

```doof
try s := x as string
s := try! x as string
s := x as string else { return "" }
```

## Optional Chaining Across Results

```doof
result := foo()?.bar()
```

When `foo()` returns `Result<MyObj, E1>` and `bar()` returns `Result<int, E2>`, the final type is `Result<int | null, E1 | E2>`.

## Catch Expressions

`catch` captures fallible work locally instead of propagating it.

```doof
const err = catch {
    try a()
    try b()
}
```

The resulting type is the union of all captured error types plus `null`.

Inside `catch`:

- statement-level `try` exits the `catch` block, not the outer function
- `try!` and `try?` keep their usual behavior

## Panic

```doof
if index < 0 || index >= array.length {
    panic("Index out of bounds: ${index}")
}
```

Use panic for impossible states, assertion failures, or other programmer bugs.

## When to Use What

| Mechanism | Use For |
| --- | --- |
| `Result` + `case` | detailed error handling and branching |
| statement-level `try` | sequential propagation in `Result`-returning functions |
| `try!` | required success or crash |
| `try?` | convert failure to nullable when details do not matter |
| declaration-`else` | unwrap-or-bail control flow |
| `??` | specific fallback value |
| `catch` | local error capture without propagation |
| `panic` | programmer errors |

## Resource Cleanup

There is no `finally` or `defer`. Cleanup relies on deterministic destructors and reference counting.