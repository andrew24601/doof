# Numerics and Conversions

## Division operator

Standard `/` division:
- Result type follows operands/target context
- Assigning to integer targets truncates toward zero

Examples:
```doof
let a: int = 7; let b: int = 2;
let c = a / b;        // c: double = 3.5 (inferred)
let d: int = a / b;   // d: int = 3
let e = 7 / 2;        // e: double = 3.5
let f: int = 7 / 2;   // f: int = 3

let x: double = 7.5;
let y: double = 2.1;
let z = x / y;        // z: double
let w: int = x / y;   // w: int = 3 (truncated)
```

## Reverse type inference (target-driven)

The type of the assignment target influences code generation for:
- Variable assignment
- Function/method parameter passing
- Object/struct field initialization
- Return statements

The transpiler casts to the target type as needed (e.g., C++ `static_cast<int>(...)`).

```doof
let x: int = 3.7;   // casts to int

function takesInt(val: int) { /* ... */ }
takesInt(5 / 2);    // casts argument to int

struct S { n: int; }
let s = S { n: 2.9 }; // casts field to int

function getInt(): int { return 7 / 2; }
```

## C++ backend consistency

Division semantics match C++17. Truncation toward zero is used consistently for integer targets.

---

## Canonical type conversion functions

Explicit, fail-fast conversion helpers. Not constructors.

### int(x)
- Accepts: int, float, double, string, bool
- float/double → int: truncates toward zero
- string → int: parses decimal; panics if invalid
- bool → int: true → 1, false → 0

### float(x) / double(x)
- Accepts: float, double, int, string, bool
- string → float/double: parses; panics if invalid
- bool → 1.0 / 0.0

### string(x)
- Accepts: string, int, float, double, bool, enum, class instance
- enum → label (e.g., "ADD")
- class instance → JSON representation

### bool(x)
- Accepts: bool, int, float, double, string
- Numeric zero → false; non-zero → true
- string: only "true", "false", "1", "0" (case-sensitive). Panics otherwise

Error handling: all conversions panic on invalid input; no implicit coercions.

---

## Enum conversions and shorthand

Enums can be int- or string-backed. All enums transpile to C++ integer enums; backing values are preserved for conversion/validation.

### string(enumValue)
- Returns the enum label (e.g., "ADD"). Never the backing value

### enumType(value)
- Accepts only the enum's backing value (int or string)
- Passing the label is a runtime error
- Panics if no matching backing value

```doof
enum Operation { ADD = "add", SUBTRACT = "subtract", MULTIPLY = "multiply" }
let op = Operation("add"); // OK
let op2 = Operation("ADD"); // Error
string(op) == "ADD";       // true

enum Status { OK = 1, ERROR = 2 }
let st = Status(1);         // OK
let st2 = Status("OK");    // Error
string(st) == "OK";         // true
```

### Enum shorthand syntax

When the enum type is known from context, use `.LABEL`:

```doof
enum Status { ACTIVE, INACTIVE, PENDING }

let statusSet: Set<Status> = { .ACTIVE, .INACTIVE };
let statusMap: Map<Status, string> = { .ACTIVE: "Running", .INACTIVE: "Stopped" };

struct Task { name: string; status: Status; }
let task: Task = Task { name: "Important", status: .ACTIVE };

let currentStatus: Status;
currentStatus = .PENDING;
```
