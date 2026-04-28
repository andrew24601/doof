# Pattern Matching

## Case Expressions

Doof's `case` forms provide pattern matching with value matching, range matching, and type patterns with capture.

Expression-form `case` arms are separated by commas. Statement-form `case` arms are not comma-separated. Multiple patterns in a single arm use `|`. When an expression-form arm uses a block body, the block must produce its value with `yield`.

---

## Basic Value Matching

```javascript
let description = case value {
    0 -> "zero",
    1 -> "one",
    2 -> "two",
    _ -> "many"
}
```

### Multiple Values

```javascript
case status {
    200 | 201 | 204 -> "success"
    400 | 404 -> "client error"
    500 | 502 | 503 -> "server error"
    _ -> "unknown"
}
```

### String Matching

```javascript
case command {
    "start" -> startServer(),
    "stop" -> stopServer(),
    "restart" -> restartServer(),
    _ -> print("Unknown command")
}
```

---

## Enum Matching

Enum values can be matched directly. When the `case` subject is a known enum type, **dot-shorthand** can be used for variant names:

```javascript
enum Direction { North, South, East, West }

case direction {
    .North -> moveUp(),
    .South -> moveDown(),
    .East  -> moveRight(),
    .West  -> moveLeft()
}
```

Fully qualified names also work:

```javascript
case direction {
    Direction.North -> moveUp(),
    Direction.South -> moveDown(),
    Direction.East  -> moveRight(),
    Direction.West  -> moveLeft()
}
```

### Enum Matching with Integer Values

Integer-valued enums match by identity, not by raw value:

```javascript
enum HttpStatus {
    OK = 200,
    Created = 201,
    NoContent = 204,
    NotFound = 404,
    ServerError = 500
}

case status {
    .OK | .Created | .NoContent -> "success"
    .NotFound -> "not found",
    .ServerError -> "server error",
    _ -> "other"
}
```

### Enum Matching as Expression

```javascript
let label = case color {
    .Red   -> "danger",
    .Green -> "safe",
    .Blue  -> "info"
}
```

### Exhaustiveness

When all enum variants are covered, no `_` wildcard is needed. The compiler enforces exhaustive matching:

```javascript
// ✅ All variants covered — no wildcard needed
let message = case direction {
    .North -> "up",
    .South -> "down",
    .East  -> "right",
    .West  -> "left"
}

// ❌ Error: non-exhaustive — missing Direction.West
let message = case direction {
    .North -> "up",
    .South -> "down",
    .East  -> "right"
}
```

---

## Range Matching

```javascript
let category = case age {
    ..<18 -> "Minor",
    ..<65 -> "Adult",
    _ -> "Senior"
}

case score {
    90.. -> "A",
    80..<90 -> "B",
    70..<80 -> "C",
    60..<70 -> "D",
    ..<60 -> "F"
}

case day {
    1..5 -> "weekday",
    6..7 -> "weekend",
    _ -> "invalid"
}
```

### Range Syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| `a..b` | Inclusive range | `1..5` matches 1, 2, 3, 4, 5 |
| `a..<b` | Exclusive upper bound | `1..<5` matches 1, 2, 3, 4 |
| `n..` | Open-ended from n | `90..` matches 90 and above |
| `..<n` | Open-ended up to n (exclusive) | `..<18` matches 0 to 17 |

---

## Type Patterns with Capture

Type patterns create immutable bindings with narrowed types:

```javascript
class Success<T> {
    const kind = "Success"
    value: T
}

class Failure<E> {
    const kind = "Failure"
    error: E
}

type Result<T, E> = Success<T> | Failure<E>

let result: Result<int, string> = Success { value: 42 }

case result {
    s: Success -> print("Got: ${s.value}"),
    f: Failure -> print("Error: ${f.error}")
}

// Discard binding with _
case result {
    _: Success -> print("success"),
    _: Failure -> print("failed")
}
```

**Note:** This example uses the generic `Result<T, E>` type from [09-error-handling.md](09-error-handling.md).

### Nested Access with Capture

Capture patterns solve the path-tracking problem for nested fields:

```javascript
class Container<T, E> {
    result: Result<T, E>
}

readonly container = Container { result: Success { value: 42 } }

case container.result {
    s: Success -> print(s.value),    // 's' is immutable Success<T>
    f: Failure -> print(f.error)     // 'f' is immutable Failure<E>
}
```

### Combining Patterns

```javascript
case response.status {
    200 -> "OK",
    404 -> "Not Found",
    s: int -> "Status: ${s}"  // Captures other status codes
}
```

---

## Multi-Statement Blocks

```javascript
case response {
let value = case response {
    s: Success -> {
        readonly doubled = s.value * 2
        print("Success: ${doubled}")
        yield doubled
    },
    f: Failure -> {
        logError(f.error)
        yield 0
    }
}
```

---

## Expression Usage

Case statements are expressions and can be used anywhere:

```javascript
// Variable assignment
let result = case value {
    0 -> "zero",
    1 -> "one",
    _ -> "other"
}

// Function return
function classify(n: int): string => case n {
    ..<0 -> "negative",
    0 -> "zero",
    1.. -> "positive"
}

// Inline
print(case status { 200 -> "OK", _ -> "Error" })
```

---

## Restrictions on Case Expressions

When `case` is used in a **value position** (i.e. as an expression — assigned to a
variable, returned directly, passed as an argument, etc.) each arm must evaluate
to a value.  Using `return` inside such an arm is a **compile error**.

```javascript
// ❌ Error: 'return' cannot be used inside a case-expression arm
function main(): int {
    const x = case tryOp() {
        s: Success -> s.value,
        f: Failure -> { return 1 }   // ← compile error
    }
    return x
}
```

The restriction exists because the compiler emits case expressions as C++
immediately-invoked lambdas; a `return` inside the lambda would return from the
lambda rather than from the enclosing function, silently producing the wrong
behaviour.

When `case` is used as a **statement** (not assigned to anything), arms may
contain `return` freely:

```javascript
// ✅ Fine: case at statement level
function main(): int {
    case tryOp() {
        s: Success -> {
            println(s.value)
            return 0
        },
        f: Failure -> {
            println("error!")
            return 1    // returns from main()
        }
    }
    return 0
}
```

Similarly, `try` statements (which desugar to `return` on failure) are also
forbidden inside case-expression arms.  `try?` and `try!` are fine because they
desugar to a default value or a panic respectively, not a `return`.

If you need early exit from inside a case expression, either:
- Move the `case` to statement level, or
- Use `try?` or `try!` inside the arm (but not `try`).

---

## Design Decisions

### No Destructuring in Case Arms

Case keeps it simple — pattern checks types/values, you access fields normally:

```javascript
// ✅ Clean and explicit
case point {
    p: Point -> {
        readonly x = p.x
        readonly y = p.y
        print("Point at (${x}, ${y})")
    }
}

// ❌ Not supported
case point {
    Point { x, y } => print("Point at (${x}, ${y})")
}
```

### No Guards/When Clauses

Complex conditional logic should use `if` statements or ranges:

```javascript
// ✅ Use ranges
case value {
    11..99 -> "in range",
    _ -> "out of range"
}

// ✅ Extract complex conditions
readonly isValid = value > 10 && value < 100 && value % 2 == 0
case isValid {
    true -> "valid",
    false -> "invalid"
}
```

---

## Else-Narrow Statement

The `else` narrow form provides a compact "unwrap or bail" pattern for Result and nullable types. It evaluates an expression, runs the `else` block (which must exit scope) when the value is null or a `Failure`, and binds the narrowed happy-path result to a new variable after the block.

### Syntax

```javascript
name := expression else {
    // name has the full original type here
    ... must exit (return / break / continue) ...
}
// name is available here with the narrowed type
```

### Applicable Types

Else-narrow works only on **Result** and/or **nullable** types. Plain unions (e.g., `Circle | Rect`) and non-nullable primitives produce a compile error.

| Expression type | Narrowed type |
|---|---|
| `string \| null` | `string` |
| `Result<Config, Error>` | `Config` |
| `Result<Config, Error> \| null` | `Config` |
| `Result<Config \| null, Error>` | `Config` (deep null removal) |
| `int` | ❌ compile error |
| `Circle \| Rect` | ❌ compile error |

### Nullable Type Narrowing

```javascript
function getValue(): string | null => "hello"
function test(): int {
    x := getValue() else { return 0 }
    // x is string here (null removed)
    return x.length
}
```

### Result Type Narrowing

```javascript
class Config { name: string }
class AppError { message: string }
function loadConfig(): Result<Config, AppError> => Success { value: Config { name: "app" } }

function test(): string {
    x := loadConfig() else { return "" }
    // x is Config here (Result unwrapped to success type)
    return x.name
}
```

### Result | null Narrowing

When the expression is both nullable and a Result, both are stripped:

```javascript
function loadConfig(): Result<Config, AppError> | null => null

function test(): string {
    x := loadConfig() else { return "" }
    // x is Config here (null removed, Result unwrapped)
    return x.name
}
```

### Deep Null Removal

When the Result's success type is nullable, null is stripped from the success type too:

```javascript
function loadConfig(): Result<Config | null, AppError> => Success { value: null }

function test(): string {
    x := loadConfig() else { return "" }
    // x is Config here (null removed from inside the success type)
    return x.name
}
```

### Accessing the Full Type in the Else Block

Inside the else block, `name` has the **full original type** (before narrowing). This allows inspecting the failure state:

```javascript
function loadConfig(): Result<Config, AppError> => Failure { error: AppError { message: "not found" } }

function test(): string {
    x := loadConfig() else {
        // x has type Result<Config, AppError> here
        return case x {
            _: Success -> "unexpected",
            f: Failure -> f.error.message
        }
    }
    // x is Config here
    return x.name
}
```

### With Type Annotations

An explicit type annotation is supported:

```javascript
x: string := getValue() else { return 0 }
```

### In Loops

Else-narrow works with `break` and `continue` in loop contexts:

```javascript
function getValue(): string | null => null
function process(): void {
    while true {
        x := getValue() else { break }
        println(x)
    }
}
```

### Rules

1. **Else block must exit scope**: The block must end with `return`, `break`, or `continue`. Non-exiting blocks are a compile-time error.
2. **Binding is immutable**: The narrowed variable is an immutable binding (`:=`).
3. **Result and/or nullable only**: The expression must have a Result or nullable type. Other types produce a compile error.
4. **Full type inside else**: The variable has the full, un-narrowed type inside the else block.

---

## Complete Example

```javascript
class Point { x, y: float; }
class Line { start, end: Point; }
type Shape = Point | Line

function describe(shape: Shape): string => case shape {
    p: Point -> "Point at (${p.x}, ${p.y})",
    l: Line -> "Line from (${l.start.x}, ${l.start.y}) to (${l.end.x}, ${l.end.y})"
}

function categorize(age: int): string => case age {
    ..<0 -> "invalid",
    ..<18 -> "minor",
    18..64 -> "adult",
    65.. -> "senior"
}

function handleResponse(r: Response): void => case r.status {
    200 | 201 | 204 -> print("Success: ${r.body}"),
    404 -> print("Not found"),
    500..599 -> print("Server error"),
    _ -> print("Unexpected status: ${r.status}")
}

enum Suit { Hearts, Diamonds, Clubs, Spades }

function suitColor(suit: Suit): string => case suit {
    .Hearts | .Diamonds -> "red",
    .Clubs | .Spades -> "black"
}
```
