# Control Flow

## If/Else Statements

### Basic Forms

```javascript
if condition {
    doSomething()
}

if temperature > 30 {
    print("Hot")
} else {
    print("Not hot")
}

if score >= 90 {
    print("A")
} else if score >= 80 {
    print("B")
} else if score >= 70 {
    print("C")
} else {
    print("F")
}
```

### If as Expression

`if` can be used as an expression when all branches return a value:

```javascript
grade := if score >= 90 then "A" 
         else if score >= 80 then "B"
         else if score >= 70 then "C"
         else "F"

abs := if x >= 0 then x else -x

print(if isLoggedIn then "Welcome back!" else "Please log in")
```

All branches must be present and return compatible types. The `then` keyword is required for expression form to distinguish it from statement form.

### Block Requirement

Blocks are required for statement forms:

```javascript
if x > 0 {
    print("positive")
} else {
    print("non-positive")
}
```

### Type Narrowing in If

```javascript
value: int | null := getValue()

if value != null {
    print(value * 2)  // value narrowed to int
}

if value == null {
    return
}
// value narrowed to int for rest of function
print(value * 2)
```

---

## While Loops

```javascript
let count = 0
while count < 10 {
    print(count)
    count += 1
}

// Infinite loop with break
let i = 0
while true {
    if i >= 10 {
        break
    }
    print(i)
    i += 1
}
```

---

## For Loops

### Traditional For Loop

```javascript
for let i = 0; i < 10; i += 1 {
    print(i)
}

// Multiple variables
for let i = 0, j = 10; i < j; i += 1, j -= 1 {
    print("${i}, ${j}")
}

// Reverse iteration
for let i = 9; i >= 0; i -= 1 {
    print(i)
}
```

### For-Of Loop

Iterates over the values of any iterable. Loop variables are **immutable** bindings (no keyword needed):

```javascript
names := ["Alice", "Bob", "Charlie"]

for name of names {
    print("Hello, ${name}!")
    // name = "other"  // ❌ Error: cannot reassign
}
```

Current iterable forms are arrays, maps, sets, ranges, and `Stream<T>` values. A stream yields one element at a time by calling `next()` until it returns `null`.

```javascript
class Counter implements Stream<int> {
    current: int
    end: int

    next(): int | null {
        if this.current < this.end {
            value := this.current
            this.current = this.current + 1
            return value
        }
        return null
    }
}

for value of Counter(0, 3) {
    print(value)
}
```

### For-Of with Maps

```javascript
scores: Map<string, int> := { "Alice": 95, "Bob": 87 }

// Destructured entries (MapEntry has key, value fields)
for key, value of scores {
    print("${key} scored ${value}")
}

// Keys or values only
for name of scores.keys() {
    print(name)
}
for score of scores.values() {
    print(score)
}
```

Map iteration follows insertion order. Updating an existing key keeps its current position; deleting and reinserting a key moves it to the end.

### For-Of with Sets

```javascript
unique: Set<int> := [1, 2, 3]
for n of unique {
    print(n)
}

```

Set iteration follows first-insertion order. Re-adding an existing value keeps its current position; deleting and adding it again moves it to the end.

---

## Range-Based For Loops

### Inclusive Range (`..`)

```javascript
for i of 1..5 {
    print(i)  // 1, 2, 3, 4, 5
}
```

### Exclusive Range (`..<`)

```javascript
for i of 0..<5 {
    print(i)  // 0, 1, 2, 3, 4
}

// Common pattern for array indices
items := ["a", "b", "c", "d"]
for i of 0..<items.length {
    print("${i}: ${items[i]}")
}
```

### Range with Step and Reverse

```javascript
for i of (0..<10).step(2) {
    print(i)   // 0, 2, 4, 6, 8
}
for i of (10..2).step(-2) {
    print(i)   // 10, 8, 6, 4, 2
}

for i of (0..<items.length).reversed() {
    print(items[i])  // Reverse iteration
}
```

### Practical Range Example

```javascript
// Process items in batches
items := loadItems()
readonly batchSize = 100

for start of (0..<items.length).step(batchSize) {
    end := min(start + batchSize, items.length)
    processBatch(items[start..<end])
}
```

---

## Break and Continue

### Basic

```javascript
for i of 0..<100 {
    if i == 10 {
        break     // Exits innermost loop
    }
    print(i)
}

for i of 0..<10 {
    if i % 2 == 0 {
        continue  // Skips to next iteration
    }
    print(i)
}
```

### Labeled Break and Continue

```javascript
outer: for y of 0..<height {
    for x of 0..<width {
        if grid[y][x] == target {
            print("Found at (${x}, ${y})")
            break outer  // Exits both loops
        }
    }
}

outer: for row of rows {
    for cell of row {
        if cell.isEmpty() {
            continue outer  // Skip to next row
        }
        process(cell)
    }
    markRowComplete(row)
}
```

---

## Loop Then Clause

The `then` clause executes when a loop completes normally, meaning control
leaves the loop without `break` or another non-local exit such as `return`:

```javascript
for item of items {
    if item == target {
        print("Found!")
        break
    }
} then {
    print("Not found")
}
```

This applies even when the loop body ran; natural completion still counts:

```javascript
while hasMoreData() {
    let data = readData()
    if data.isCorrupt() {
        print("Corrupt data found")
        break
    }
    process(data)
} then {
    print("All data processed successfully")
}
```

Traditional `for` loops support the same follow-up clause:

```javascript
for let i = 0; i < 3; i += 1 {
    print(i)
} then {
    print("loop completed")
}
```

---

## Early Return

```javascript
function findUser(id: int): User | null {
    if id < 0 {
        return null
    }

    for user of users {
        if user.id == id {
            return user
        }
    }

    return null
}
```

Return exits the entire function, not just the current block.

---

## Best Practices

### Prefer For-Of Over Traditional For

```javascript
// ✅ Preferred
for item of items {
    process(item)
}

// ❌ Avoid when index not needed
for let i = 0; i < items.length; i += 1 {
    process(items[i])
}
```

### Use Ranges for Numeric Iteration

```javascript
// ✅ Clear and concise
for i of 0..<10 {
    print(i)
}

// ❌ More verbose
for let i = 0; i < 10; i += 1 {
    print(i)
}
```

### Avoid Deep Nesting with Early Returns

```javascript
// ❌ Deep nesting
function process(data: Data | null): Result | null {
    if data != null {
        if data.isValid() {
            if data.hasPermission() {
                return compute(data)
            }
        }
    }
    return null
}

// ✅ Early returns flatten the code
function process(data: Data | null): Result | null {
    if data == null {
        return null
    }
    if !data.isValid() {
        return null
    }
    if !data.hasPermission() {
        return null
    }
    return compute(data)
}
```

---

## Summary

| Statement | Purpose |
|-----------|---------|
| `if`/`else` | Conditional execution (also usable as expression) |
| `while` | Loop while condition is true |
| `for init; cond; update` | Traditional counted loop |
| `for x of collection` | Iterate over values |
| `for i of a..b` | Iterate over inclusive range |
| `for i of a..<b` | Iterate over exclusive range |
| `break` / `break label` | Exit innermost or labeled loop |
| `continue` / `continue label` | Skip to next iteration |
| `loop ... else` | Execute else when loop completes without break |
| `return` | Exit function with value |
