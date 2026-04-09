# Operators

## Arithmetic Operators

Standard arithmetic operators with familiar precedence:

```javascript
a := 10 + 5    // Addition: 15
b := 10 - 5    // Subtraction: 5
c := 10 * 5    // Multiplication: 50
d := 10.0 / 5.0  // Division: 2.0 (/ requires at least one float/double operand)
e := 10 \ 3    // Integer division: 3 (truncates toward zero)
f := 10 % 3    // Modulo: 1 (integer operands only)
g := 2 ** 3    // Exponentiation: 8
```

### Division Operators

Doof has two division operators:

- **`/`** — floating-point division. **Cannot** be applied to two integer operands (compile error). At least one operand must be `float` or `double`, or use a numeric cast.
- **`\`** — integer division. **Requires** both operands to be integer types (`int` or `long`). Truncates toward zero.

```javascript
// Floating-point division (/ operator)
floatDiv := 7.0 / 2.0          // 3.5
mixed := float(7) / 2.0        // 3.5 (cast int to float)
precise := double(a) / double(b) // double division via casts

// Integer division (\ operator)
intDiv := 7 \ 2        // 3 (truncates toward zero)
negDiv := -7 \ 2       // -3
longDiv := 100L \ 3L   // 33L

// Compile errors:
7 / 2          // ❌ Error: "/" cannot be applied to two integer operands
7.0 \ 2.0      // ❌ Error: "\" requires integer operands
7.0 % 2.0      // ❌ Error: "%" requires integer operands
```

### Modulo Operator

The `%` operator requires both operands to be integer types (`int` or `long`):

```javascript
remainder := 10 % 3    // 1
negMod := -7 % 3       // -1 (C++ truncated division semantics)
```

### Numeric Casts

Numeric types can be explicitly cast using function-call syntax:

```javascript
x := 42
f := float(x)         // int → float
d := double(x)        // int → double
n := int(3.14)         // double → int (truncates: 3)
l := long(x)           // int → long

// Common pattern: dividing integers as floats
a := 7
b := 2
result := float(a) / float(b)  // 3.5
```

Numeric casts accept exactly one argument of a numeric type (`int`, `long`, `float`, `double`) and return the target type. Non-numeric arguments are a compile error.

### Unary Operators

```javascript
x := 5
neg := -x     // Negation: -5
pos := +x     // Unary plus: 5
```

### No Increment/Decrement

Doof does **not** have `++` or `--` operators:

```javascript
let x = 5
x++      // ❌ Error: no increment operator
x += 1   // ✅ Use compound assignment instead
```

**Rationale:** `++` and `--` have confusing prefix/postfix semantics and encourage imperative mutation. `x += 1` is equally concise and unambiguous.

---

## Comparison Operators

```javascript
a == b     // Equality (reference for objects)
a != b     // Inequality
a < b      // Less than
a <= b     // Less than or equal
a > b      // Greater than
a >= b     // Greater than or equal
```

### Reference vs Structural Equality

```javascript
class Point { x, y: int; }

p1 := Point { x: 1, y: 2 }
p2 := Point { x: 1, y: 2 }
p3 := p1

p1 == p2    // false  — reference equality (different objects)
p1 == p3   // true  — same reference
```

| Operator | Behaviour |
|----------|-----------|
| `==` | Reference identity — same object in memory |
| `!=` | Reference non-identity |

---

## Logical Operators

```javascript
a && b    // Logical AND
a || b    // Logical OR
!a        // Logical NOT
```

All logical operators require `bool` operands. Short-circuit evaluation applies:

```javascript
false && expensiveCall()  // expensiveCall() never executed
true || expensiveCall()   // expensiveCall() never executed

if list.length > 0 && list[0] == target {
    // ...
}
```

---

## Null-Coalescing and Optional Chaining

### Null-Coalescing (`??`)

Provides a fallback value when an expression is `null` or a `Failure`:

```javascript
// With nullable types
name: string | null := null
displayName := name ?? "Anonymous"  // "Anonymous"

value: int | null := 0
result := value ?? 42  // 0 (not null, so left side used)

// With Result types
config := loadConfig() ?? defaultConfig  // Config (unwraps Success or uses fallback)
data := readFile("cache.txt") ?? ""      // string
```

**Type signatures:**
- `T | null ?? T` → `T` (unwraps nullable)
- `Result<T, E> ?? T` → `T` (unwraps Success or uses fallback on Failure)

**Associativity:** Right-to-left (ensures type correctness in chains)

**Lazy evaluation:** The right operand is **only evaluated if needed** (i.e., if left is `null` or `Failure`). This is crucial for performance and avoiding side effects:

```javascript
// expensiveComputation() only called if loadFromCache() fails
data := loadFromCache() ?? expensiveComputation()

// Chaining: right-to-left associativity with lazy evaluation
config := loadFromCache() ?? loadFromDisk() ?? fetchFromNetwork() ?? defaultConfig
// Groups as: loadFromCache() ?? (loadFromDisk() ?? (fetchFromNetwork() ?? defaultConfig))
// Evaluates loadFromCache() first; only if it fails, evaluates loadFromDisk(), and so on
// Each Result<T, E> ?? T → T, so types compose naturally
```

**Important:** `??` only checks for `null` and `Failure`, not falsiness. `||` requires `bool` operands.

### Null-Coalescing Assignment (`??=`)

Assigns a value only if the variable is currently `null` or `Failure`:

```javascript
// With nullable types
let cache: string | null = null
cache ??= loadFromDisk()  // Assigns result of loadFromDisk()
cache ??= loadFromDisk()  // No-op, cache already has value

let config: Config | null = getConfig()
config ??= defaultConfig  // Only assigns if getConfig() returned null
```

**With Result types:**

`??=` also works with variables holding `Result` types, assigning only if the current value is a `Failure`:

```javascript
let data: Result<string, Error> = readCache()
data ??= readFromDisk()     // Replaces data only if readCache() failed
data ??= fetchFromNetwork() // No-op if data is Success from previous line

// Common pattern: progressive fallback
let value: Result<Config, Error> = loadFromCache()
value ??= loadFromDisk()     // Try disk if cache failed
value ??= fetchDefault()     // Use default if both failed
```

**Type requirement:** The right-hand side must be assignable to the variable's type. For `Result<T, E>` variables, the RHS can be either `Result<T, E>` or a plain `T` (which gets wrapped in `Success`).

**Lazy evaluation:** Like `??`, the right operand is only evaluated if the assignment will occur.

### Optional Chaining (`?.`)

Safely access properties/methods on potentially null values:

```javascript
user: User | null := getUser()
city := user?.address?.city    // string | null
logger?.log("Hello")           // Only calls if logger is not null
```

**Interaction with Result types:**

When the `?.` operator is used with Result types, it propagates nulls but preserves the Result wrapper:

```javascript
// foo(): Result<MyObject, Error>
// MyObject.bar(): Result<int, Error>

result := foo()?.bar()  // Result<int | null, Error>
// If foo() is Success(obj), calls bar() on obj
// If foo() is Success(null), short-circuits to Success(null)
// If foo() is Failure(e), propagates Failure(e)

// If bar() returns a plain value (not Result):
// MyObject.getValue(): int
result := foo()?.getValue()  // Result<int | null, Error>

// Multiple error types are unioned:
// bar(): Result<int, Error2>
result := foo()?.bar()  // Result<int | null, Error | Error2>
```

The `?.` operator only checks for null and propagates it - it does not unwrap Result types.

### Combining `?.` and `??`

```javascript
// Nullable types
city := user?.address?.city ?? "Unknown"  // string (never null)

// Result types - unwrap and provide fallback
data := parseFile("config.json")?.data ?? []  // Returns [] if parse fails or data is null

// Can also use with try? for same effect
data := try? parseFile("config.json") ?? []   // Less clear: conflates null and Failure
data := parseFile("config.json") ?? { data: [] }  // Clearer: explicit about Failure handling
```

### Optional Indexing (`?[]`)

```javascript
items: string[] | null := getItems()
first := items?[0]  // string | null

map: Map<string, int> | null := getScores()
score := map?["alice"]  // int | null
```

### Force Access (`!.`)

The `!.` operator provides non-optional access with **panic on failure**. It works with nullable types and Result types:

**With nullable types:**

```javascript
user: User | null := getUser()
name := user!.name  // string (panics if user is null)

// Equivalent to:
if user == null {
    panic("Attempted to access null value")
}
name := user.name
```

**With Result types:**

When accessing fields or calling methods on a `Result<T, E>`, the `!.` operator unwraps the Success value or panics on Failure:

```javascript
// loadUser(): Result<User, Error>
result := loadUser()
name := result!.name  // string (panics if result is Failure)

// Chaining
email := loadUser()!.getEmail()  // Panics if loadUser fails
```

This is equivalent to using `try!` followed by regular access:

```javascript
// These are equivalent:
name := result!.name
name := (try! result).name
```

**Note:** Weak references use Result semantics (see [Type System — Weak References](02-type-system.md)), so `!.` works with them as a consequence of working with Result types.

**When to use `!.`:**

```javascript
// ✅ When null/failure indicates a programming error
let config: Config | null = loadConfig()
port := config!.port  // Config should always exist here; panic if not

// ✅ When you need to fail fast on errors
data := loadCriticalData()!.parse()  // Panic if load fails

// ❌ For expected null/failure cases — use ?. or case/try instead
let optional: Result<Data, Error> = tryLoadData()
value := optional!.field  // Bad: failure might be expected; use case or try? instead
```

**Type signatures:**
- `(T | null)!.field` → `FieldType` (panics if null)
- `Result<T, E>!.method()` → `ReturnType` (panics if Failure)
- `Result<T, E>!.field` → `FieldType` (panics if Failure)

**Comparison with `?.`:**

| Operator | Null/Failure Behavior | Return Type |
|----------|----------------------|-------------|
| `?.` | Short-circuits, propagates null | `T \| null` or `Result<T \| null, E>` |
| `!.` | Panics immediately | `T` (never null/Failure) |

```javascript
user: User | null := getUser()

// Optional: safe, returns null if user is null
age1 := user?.age  // int | null

// Force: panics if user is null, always returns int
age2 := user!.age  // int (panics if user is null)

// With Result types
result: Result<User, Error> := loadUser()

// Optional: propagates Failure as Result
email1 := result?.getEmail()  // Result<string | null, Error>

// Force: unwraps or panics
email2 := result!.getEmail()  // string (panics if result is Failure)
```

---

## Bitwise Operators

```javascript
a & b     // Bitwise AND
a | b     // Bitwise OR
a ^ b     // Bitwise XOR
~a        // Bitwise NOT
a << 2    // Left shift
a >> 2    // Right shift (arithmetic)
a >>> 2   // Unsigned right shift
```

---

## Assignment Operators

### Compound Assignment

```javascript
let x = 10
x += 5    // x = x + 5
x -= 3    // x = x - 3
x *= 2    // x = x * 2
x /= 4    // x = x / 4
x %= 4    // x = x % 4
x **= 3   // x = x ** 3

// Bitwise compound assignment
x &= 0b111
x |= 0b100
x ^= 0b010
x <<= 2
x >>= 1
```

---

## Range Operators

Used for creating ranges in `for` loops and `case` statements:

```javascript
1..5      // Inclusive range: 1, 2, 3, 4, 5
1..<5     // Exclusive upper bound: 1, 2, 3, 4
10..      // Open-ended from 10 (in case statements)
..<10     // Open-ended up to 10 exclusive (in case statements)
```

---

## String Operators

```javascript
greeting := "Hello, " + "World!"  // Concatenation

// Prefer string interpolation
name := "Alice"
msg := "Hello, ${name}!"
```

---

## Type Narrowing Operator (`as`)

The `as` operator performs runtime type narrowing, yielding `Result<T, string>`:

```javascript
value: int | string := "hello"
r := value as string   // Result<string, string>
```

### Supported Narrowing

| Source Type      | Target Type    | Runtime Check                          |
|-----------------|----------------|----------------------------------------|
| `T \| null`     | `T`            | Null check                            |
| `U1 \| U2`      | `Ui`           | `std::holds_alternative<Ui>` variant check |
| Interface       | Class          | `std::holds_alternative<Class>` variant check |
| `T`             | `T`            | Identity — always succeeds            |

### Result Handling

Since `as` returns `Result<T, string>`, use standard Result patterns:

```javascript
// With try (in Result-returning function):
try s := value as string

// With else-narrow:
s := value as string else { return defaultValue }

// With try! (panic on failure):
s := try! value as string

// Pattern match:
case value as string {
  ok: Success => println(ok.value),
  err: Failure => println(err.error)
}
```

### Precedence

`as` binds tighter than unary prefix operators (`try`, `try!`, `try?`, `!`, `-`) but looser than postfix operators (`.`, `()`, `[]`):

```javascript
try! value as string        // try! (value as string)
obj.method() as Foo         // (obj.method()) as Foo
```

### Invalid Narrowing

The compiler rejects narrowing that has no runtime path to success:

```javascript
x: int := 42
r := x as string    // ❌ Error: Cannot narrow "int" to "string"
```

---

## Result Propagation Operators

Doof provides three prefix operators for working with `Result<T, E>` types:

### `try` — Propagate Failures

Unwraps a `Success` value or returns the `Failure` from the enclosing function:

```javascript
function loadConfig(): Result<Config, Error> {
    content := try readFile("config.json")   // Returns Failure early if error
    parsed := try parseJSON(content)
    config := try validate(parsed)
    return Success { value: config }
}
```

Can only be used inside functions returning `Result<T, E>`.

### `try!` — Panic on Failure

Unwraps a `Success` value or panics:

```javascript
config := try! loadConfig()  // Config (panics if loadConfig fails)
```

### `try?` — Convert to Optional

Converts `Result<T, E>` to `T | null`:

```javascript
config := try? loadConfig()  // Config | null (null on Failure)
value := try? foo()?.bar()   // Combines with optional chaining
```

See [09-error-handling.md](09-error-handling.md) for detailed semantics.

---

## Operator Precedence

From highest to lowest:

| Precedence | Operators | Associativity |
|------------|-----------|---------------|
| 1 | `()` `[]` `.` `?.` `!.` `?[]` | Left to right |
| 2 | `as` | Left to right |
| 3 | `!` `~` `-` (unary) `+` (unary) `try` `try!` `try?` | Right to left |
| 4 | `**` | Right to left |
| 5 | `*` `/` `%` | Left to right |
| 6 | `+` `-` | Left to right |
| 7 | `<<` `>>` `>>>` | Left to right |
| 8 | `<` `<=` `>` `>=` | Left to right |
| 9 | `==` `!=` | Left to right |
| 10 | `&` | Left to right |
| 11 | `^` | Left to right |
| 12 | `\|` | Left to right |
| 13 | `&&` | Left to right |
| 14 | `\|\|` | Left to right |
| 15 | `??` | Right to left |
| 16 | `??=` `:=` `=` `+=` `-=` etc. | Right to left |

**Note:** The `try` operators have prefix unary precedence, which means they bind tightly to the expression immediately following them. Postfix operators like `.` and `()` and `?.` bind more tightly, so `try foo().bar()` means `try (foo().bar())`.

**Best Practice:** Use parentheses for clarity when mixing operators.

---

## No Operator Overloading

Doof does **not** support user-defined operator overloading:

```javascript
class Vector {
    x, y: float
    
    // ✅ Use methods instead
    add(other: Vector): Vector {
        return Vector { x: x + other.x, y: y + other.y }
    }
}

v3 := v1 + v2       // ❌ Error
v3 := v1.add(v2)    // ✅ OK
```

**Rationale:** Operator overloading can make code harder to reason about. Method calls are explicit about what operation occurs and avoid precedence/associativity surprises.
