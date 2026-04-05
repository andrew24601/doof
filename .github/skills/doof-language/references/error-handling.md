# Doof Error Handling Reference

## Overview

Doof has no exceptions. Two mechanisms:

- **Result types** — for expected, recoverable errors
- **Panic** — for unrecoverable programmer errors (bugs)

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

### Handling with Case

```doof
case result {
    s: Success => println(s.value),
    f: Failure => println(f.error)
}
```

### Direct Field Access Not Supported

```doof
result.value    // ❌ Error: must destructure with case
result.error    // ❌ Error
```

### Must-Use Rule

Result values cannot be silently discarded — ignoring a `Result` is a compile error.

## Result Propagation Operators

### `try` — Early Return on Failure (Statement-Level)

Unwraps `Success` or returns the `Failure` from the enclosing function. Only usable in functions returning `Result<T, E>`:

```doof
function loadConfig(): Result<Config, Error> {
    try content := readFile("config.json")    // string or early return
    try parsed := parseJSON(content)           // JSON or early return
    try config := validate(parsed)             // Config or early return
    return Success { value: config }
}
```

Supported binding forms:

```doof
try x := expr               // immutable binding
try x: Type := expr         // typed immutable binding
try const x = expr           // const declaration
try readonly x = expr        // readonly declaration
try let x = expr             // let declaration
try (a, b) := expr           // positional destructuring
try {name, age} := expr      // named destructuring
try x = expr                 // assignment to existing variable
```

### `try!` — Panic on Failure (Expression-Level)

```doof
config := try! loadConfig()   // Config (panics if Failure)
```

### `try?` — Convert to Nullable (Expression-Level)

```doof
config := try? loadConfig()   // Config | null (null on Failure)
```

### `??` — Null-Coalescing / Failure Fallback

```doof
config := loadConfig() ?? defaultConfig   // Config
// Right-to-left, lazy evaluation:
data := loadCache() ?? loadDisk() ?? compute()
```

### `??=` — Null/Failure-Coalescing Assignment

```doof
let cache: string | null = null
cache ??= loadFromDisk()       // assigns only if null
```

### Optional Chaining with Results

```doof
// foo(): Result<MyObj, E1>, MyObj.bar(): Result<int, E2>
result := foo()?.bar()         // Result<int | null, E1 | E2>
```

### Force Access (`!.`)

```doof
result!.field     // unwraps Success or panics, then accesses field
user!.name        // panics if user is null
```

## Catch Expression

Groups fallible operations and captures errors locally without propagating:

```doof
const err = catch {
    try a()
    try b()
}
// err: ErrorA | ErrorB | null

// With case for dispatch
case catch { try a(); try b() } {
    io: IOError => handleIO(io),
    ex: ParseError => handleParse(ex),
    _ => println("all good")
}
```

- `try` inside `catch` breaks out of the catch block instead of returning from the function
- `try!` and `try?` behave normally inside catch blocks
- The type is the union of all error types + `null`

## Panic

For unrecoverable programmer errors only:

```doof
if index < 0 || index >= array.length {
    panic("Index out of bounds: ${index}")
}
```

Immediately terminates the program with a stack trace.

## When to Use Each

| Mechanism | Use For |
|-----------|---------|
| `Result` + `case` | Detailed error handling, retry logic, fallbacks |
| `try` statement | Sequential error propagation in Result-returning functions |
| `try!` | When failure is unrecoverable (required config, initialization) |
| `try?` | When error details don't matter, convert to optional |
| `??` | Provide specific fallback value on null/Failure |
| `catch` | Capture errors locally without propagating |
| `panic` | Programmer errors / bugs (assertion failures, impossible states) |

## Resource Cleanup

No `finally` or `defer`. Resources cleaned up by deterministic destructors (reference counting). Destructors run on scope exit regardless of exit path.
