# Doof Core Language Reference

## Design Philosophy

1. Safety first: no data races, no implicit null, no unhandled recoverable errors.
2. Explicitness: intent should be visible in the code.
3. Immutability by default: mutation is opt-in.
4. No exceptions: expected failures use `Result`; unrecoverable bugs use `panic(...)`.

## Hello World and Entry Points

```doof
function main(): void {
    println("Hello, Doof!")
}
```

A module with a `main()` function is executable. Valid signatures are:

```doof
function main(): void
function main(): int
function main(args: string[]): void
function main(args: string[]): int
```

`main()` must not be exported.

## Variables and Bindings

| Form | Reassignable | Notes |
| --- | --- | --- |
| `const` | no | compile-time constant; allowed globally or locally |
| `readonly` | no | deeply immutable value; allowed globally or locally |
| `:=` | no | immutable binding, value may still have mutable interior |
| `let` | yes | mutable local binding |

```doof
const MAX = 100
readonly config = loadConfig()
items := [1, 2, 3]
let total = 0
```

Global scope allows only `const`, `readonly`, and `function`. `const` and `function` hoist. `readonly` does not.

### `with` Scoped Bindings

```doof
with connection := openDatabase() {
    query(connection, "SELECT 1")
}
```

### Destructuring

```doof
(x, y) := point
[head, _, tail] := values
{ name, email } := user
{ name as userName } := user

let px = 0
let py = 0
(px, py) = point
```

Rules:

- Tuple destructuring is positional.
- Array destructuring requires a `T[]` value and panics if the array is shorter than the pattern.
- `_` discards a value.
- Destructuring assignment requires existing mutable targets with compatible types.

## Functions and Lambdas

```doof
function double(x: int): int => x * 2

function factorial(n: int): int {
    if n <= 1 { return 1 }
    return n * factorial(n - 1)
}

function add(a: int, b: int) => a + b
```

Return type inference works when the body is unambiguous.

### Calling Functions

```doof
function clamp(value: int, min: int, max: int): int {
    if value < min { return min }
    if value > max { return max }
    return value
}

clamp(score, 0, 100)
clamp{ value: score, min: 0, max: 100 }
clamp{ min: 0, max: 100, value: score }

value := score
clamp{ value, min: 0, max: 100 }
```

Named calls match parameters by name. Any omitted parameter must have a default. The `{` must immediately follow the callee.

`SourceLocation` is a builtin class for source attribution. Use `@caller` only in parameter or field defaults when you want the call or construction site:

```doof
function info(message: string, source: SourceLocation = @caller): void {
    println(source.fileName + ":" + string(source.line))
}

class SourceLocation {
    readonly fileName: string
    readonly line: int
    readonly functionName: string = "<module>"
}

class Failure {
    message: string
    source: SourceLocation = @caller
}
```

### Lambdas

```doof
const square = (x: int): int => x * 2

type Transform = (x: int): int
transform: Transform := (x) => x * 2

numbers.map(=> it * 2)
numbers.filter(=> it > 10)
numbers.reduce(0, => acc + it)
```

Collection shorthand parameter names are:

- `it` for the current element
- `index` for an index argument
- `acc` for reducers
- `a` and `b` for comparators

### Trailing Lambdas

A same-line block after `)` becomes a trailing lambda for statement-like callbacks:

```doof
items.forEach() { print(it) }
withTransaction() {
    writeAuditLog(it)
}
```

Restrictions:

- The callback type must return `void`.
- `return` is forbidden inside the trailing lambda body.
- Chaining from a trailing-lambda call is forbidden.

Use an explicit lambda for value-producing callbacks.

### Function Types and Modifiers

```doof
type Callback = (value: int, label: string): void
type Predicate<T> = (item: T): bool
```

Parameter names are part of the function type.

Common modifiers:

- `export`
- `private` for file-scoped visibility
- `isolated` for concurrency-safe functions
- `static` for class fields and methods

## Yielding Blocks As Values

Value-producing blocks work in `case` expression arms and in local declarations or reassignment via `<-`:

```doof
let score <- {
    if cached {
        yield 10
    }
    yield 5
}

score <- {
    yield score + 1
}
```

Rules:

- `<-` must be followed by a block.
- Every reachable path must `yield`.
- `yield` is only valid inside these value-producing blocks.
- `return` and statement-level `try` are rejected inside the block.
- `:=` does not support `<-` block initializers.

## Control Flow

```doof
grade := if score >= 90 then "A" else if score >= 80 then "B" else "C"

for item of items { println(item) }
for i of 0..<10 { println(i) }
for i of 1..5 { println(i) }

for suit, pile of foundations {
    println("${suit.name}: ${pile.cards.length}")
}

while condition { doWork() }
for let i = 0; i < 10; i += 1 { println(i) }
```

Other supported forms:

- `loop then` blocks for natural completion
- labeled `break` and `continue`
- `if` expressions with `then`

Plain `if value != null` checks help control flow but do not narrow the static type. Use explicit narrowing tools when you need a non-null or narrowed binding.

## Pattern Matching

```doof
result := case status {
    200 | 201 => "success",
    404 => "not found",
    500..599 => "server error",
    _ => "unknown"
}

case shape {
    c: Circle => println("radius: ${c.radius}"),
    r: Rect => println("area: ${r.width * r.height}")
}

case direction {
    .North => moveUp(),
    .South => moveDown(),
    .East => moveRight(),
    .West => moveLeft()
}
```

Rules:

- `case` matches values, ranges, and types.
- Expression-form arms are comma-separated.
- Statement-form arms are newline-separated, not comma-separated.
- Multiple patterns for one arm use `|`.
- No destructuring or guard clauses in `case` arms.
- `return` and statement-level `try` are forbidden inside `case` expression arms.

## Operators

- Arithmetic: `+`, `-`, `*`, `/`, `\\`, `%`, `**`
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`
- Logical: `&&`, `||`, `!`
- Null helpers: `??`, `?.`, `?[]`
- Force access: postfix `!`, `!.`, `try!`, `try?`
- Checked narrowing: `as`

Notes:

- `/` requires at least one `float` or `double` operand.
- `\\` is integer division.
- `%` is integer-only.
- Numeric casts use call syntax such as `int(x)` or `double(x)`.
- There is no operator overloading.

## String Interpolation

```doof
message := "Hello, ${name}! Score: ${score * 2}"

multiline := `Line 1
Line 2: ${value}`
```

## Common Patterns

### Discriminated Unions

```doof
class TextMsg { const kind = "text"; content: string }
class ImageMsg { const kind = "image"; url: string; width, height: int }
type Message = TextMsg | ImageMsg
```

### Builder or Fluent APIs

```doof
class Builder {
    value = 0
    add(n: int): Builder { value += n; return this }
    build(): int => value
}
```

### Result Pipelines

```doof
function process(): Result<Output, Error> {
    try input := readFile("data.txt")
    try parsed := parse(input)
    try validated := validate(parsed)
    return Success { value: transform(validated) }
}
```

## Key Differences from TypeScript and JavaScript

- No `var`, no `undefined`
- `:=` is the default immutable local binding; `const` is compile-time only
- `let` is mutable
- No exceptions; use `Result` and `panic`
- No implicit coercion
- `==` on objects is reference equality
- No `async` or `await`; `async` returns `Promise<T>` and `.get()` blocks
- `if` expressions require `then`
- `/` is not integer division
- `Map<K, V>` and `Set<T>` use literal syntax rather than constructor APIs