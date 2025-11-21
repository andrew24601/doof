# Expressions and Control Flow

Supported statements:
- `if`, `else if`, `else`
- `while`, `do ... while`
- `break`, `continue`, `return`
- `for` statements:
  - Classic: `for (let i = 0; i < n; i++) { ... }`
    - For-of arrays/sets: `for (readonly x of collection) { ... }`
    - For-of maps: `for (readonly (key, value) of collection) { ... }`
    - For-of ranges: `for (readonly x of 1..10)` (inclusive), `for (readonly x of 0..<10)` (exclusive upper bound)

Examples:

```doof
for (let i = 0; i < 10; i++) {
    println(i);
}

for (readonly name of names) {
    println(name);
}

for (readonly (key, value) of ages) {
    println(key + ": " + value);
}

for (readonly x of 1..5) { println(x); }
for (readonly x of 0..<5) { println(x); }
```

## Ternary operator

`condition ? consequent : alternate`

- Lower precedence than most operators, higher than assignment
- Right-associative: `a ? b : c ? d : e` is `a ? b : (c ? d : e)`
- Consequent and alternate must be type-compatible
- Generates C++ ternary: `(cond ? a : b)`

## Modern switch

- Multiple matches per branch (comma-separated)
- Range matches `start..end` (inclusive) or `start..<end` (exclusive upper)
- No `break`; no fallthrough

```doof
switch (value) {
    case 1, 2:
        println("One or two");
    case 3:
        println("Three");
    case 4..10:
        println("Four through ten");
    case 11..<20:
        println("Eleven up to but not including twenty");
    default:
        println("Other");
}
```
