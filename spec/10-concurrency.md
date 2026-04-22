# Concurrency

## Overview

Doof's concurrency model is built around **isolation**, **immutability**, and **structured parallelism**. The design eliminates data races and deadlocks through compile-time enforcement.

### Core Principles

1. **Isolated functions** — functions that don't access mutable shared state
2. **Deep immutability** — `readonly` values are safe to share across threads
3. **Actor model** — stateful concurrent entities with sequential message processing
4. **Worker pool** — parallel computation via `async` keyword
5. **No shared mutable state** — ever

---

## Isolation

Functions used in concurrent contexts (actors, workers) must be **isolated** — they cannot access mutable global state.

### Automatic Isolation Checking

The compiler automatically tracks which functions are isolated:

```javascript
// Implicitly isolated — no mutable global access
function sum(numbers: readonly int[]): int {
    let total = 0
    for  n of numbers { total += n; }
    return total
}

let promise = async sum([1, 2, 3, 4, 5])  // ✅ Compiler verifies isolation

// Not isolated — accesses mutable global
let counter = 0
function increment(): void {
    counter += 1
}

async increment()  // ❌ Error: function is not isolated
```

### Explicit `isolated` Keyword

Optional but **enforced** when present:

```javascript
isolated function processData(data: readonly int[]): int {
    return data.reduce((sum, x) => sum + x, 0)
}  // ✅ OK

let globalCounter = 0
isolated function badFunction(): void {
    globalCounter += 1  // ❌ Error: isolated function cannot access mutable global
}
```

### Isolation Rules

Isolated functions can:

| Allowed | Not Allowed |
|---------|-------------|
| ✅ Access/mutate local variables | ❌ Access mutable globals |
| ✅ Access/mutate parameters | ❌ Call non-isolated functions |
| ✅ Access `readonly` globals | |
| ✅ Call other isolated functions | |
| ✅ Create and return new objects | |

```javascript
readonly PI = 3.14159

isolated function circleArea(radius: float): float {
    return PI * radius * radius  // ✅ OK: readonly global
}

let cache: Map<string, int> = {}
isolated function lookup(key: string): Result<int, string> {
    return cache.get(key)  // ❌ Error: accesses mutable global
}
```

---

## Actors: `Actor<T>`

Actors wrap classes for safe stateful concurrency. Each actor runs on its own thread, processing method calls sequentially.

### Creating Actors

```javascript
class Counter {
    count = 0
    
    increment(amount: int): void { count += amount; }
    decrement(amount: int): void { count -= amount; }
    getCount(): int { return count; }
}

let counter = Actor<Counter>()
```

### Calling Actor Methods

Calls can be **synchronous** (implicit wait) or **asynchronous** (returns Promise):

```javascript
// Synchronous — blocks until complete
counter.increment(5)
counter.increment(3)
let count = counter.getCount()
print(count)  // 8

// Asynchronous — returns Promise
let p1 = async counter.increment(10)
let p2 = async counter.increment(20)
p1.get()
p2.get()
```

**Mental model:** `async` keyword = Promise return.

### Actor Method Requirements

**Parameters:** Must be `readonly` (primitives or `readonly` types)

```javascript
class Processor {
    process(data: readonly int[]): int {
        return data.sum()  // ✅ OK: readonly parameter
    }
    
    processMut(data: int[]): int {
        return data.sum()  // ❌ Error: parameter must be readonly
    }
}
```

**Returns:** Must be `readonly` (prevents mutable state from escaping)

```javascript
class Database {
    records: Record[] = []
    
    getRecords(): readonly Record[] {
        return records  // ✅ OK: returns readonly
    }
    
    getRecordsMut(): Record[] {
        return records  // ❌ Error: return must be readonly
    }
}
```

### Actor Lifecycle

```javascript
let worker = Actor<Worker>()   // Constructor runs on actor thread
worker.initialize(config)      // Queued call
worker.doWork(data)            // Queued after initialize
worker.shutdown()
worker.stop()                  // Waits for pending calls, then stops
```

---

## Actor Hierarchies

Actors form strict hierarchies — **actors cannot be passed to other actors**.

```javascript
class Parent {
    children: Actor<Child>[] = []
    
    spawnChildren(count: int): void {
        for i of 0..<count {
            children.push(Actor<Child>(i))  // ✅ Parent holds children
        }
    }
}

class Child {
    setParent(p: Actor<Parent>): void {
        // ❌ Error: Actor<T> cannot be a parameter type
    }
}
```

**Rules:**
- ✅ Parent can hold references to children it creates
- ✅ Parent can call child methods
- ❌ Actors cannot be passed as parameters
- ❌ No circular actor references

**Benefit:** Strict hierarchy prevents deadlocks by construction.

---

## Workers: `async` Keyword

The `async` keyword runs functions on the system worker pool for parallel computation.

### Basic Usage

```javascript
isolated function expensiveComputation(n: int): int {
    // ... complex calculation ...
    return result
}

let promise = async expensiveComputation(1000)

case promise.get() {
    s: Success => print("Result: ${s.value}"),
    f: Failure => print("Failed: ${f.error}")
}
```

### Parameter and Return Rules

**Parameters:** Must be `readonly` (shared immutably with worker)

```javascript
readonly data = [1, 2, 3, 4, 5]
let p = async processData(data)           // ✅ OK: readonly

let mutableData = [1, 2, 3]
let p2 = async processData(mutableData)   // ❌ Error: not readonly
```

**Returns:** Can be mutable (worker creates it fresh — no sharing concern)

```javascript
isolated function createArray(size: int): int[] {
    let arr: int[] = []
    for i of 0..<size { arr.push(i); }
    return arr  // ✅ OK: mutable return from worker is fine
}
```

### Multiple Parallel Tasks

```javascript
isolated function square(x: int): int => x * x

let promises = [
    async square(1),
    async square(2),
    async square(3),
    async square(4)
]

// Explicit error handling
let results: int[] = []
for p of promises {
    case p.get() {
        s: Success => results.push(s.value),
        f: Failure => panic("Worker failed")
    }
}
print(results)  // [1, 4, 9, 16]

// Or use try! for cleaner code when failures are unrecoverable
let results2: int[] = []
for p of promises {
    results2.push(try! p.get())
}
```

### Async Closures

```javascript
readonly data = [1, 2, 3, 4, 5]

let promise = async {
    let sum = 0
    for x of data { sum += x * x; }
    return sum
}
```

### Workers Calling Actors

Workers can call actor methods (one-way dependency is safe):

```javascript
let logger = Actor<Logger>()

isolated function computeWithLogging(n: int, logger: Actor<Logger>): int {
    logger.log("Starting computation for ${n}")
    let result = expensiveComputation(n)
    logger.log("Completed")
    return result
}

let promise = async computeWithLogging(1000, logger)  // ✅ Safe
```

**Safe because:** Worker → Actor is one-way. Workers have no identity that actors could call back to.

---

## Promises

Promises represent the result of asynchronous computation.

### Promise API

```javascript
class Promise<T> {
    function get(): Result<T, Error>   // Block until ready
}
```

### Usage

```javascript
let promise = async compute(42)

// Blocking wait with explicit handling
case promise.get() {
    s: Success => print("Result: ${s.value}"),
    f: Failure => print("Error: ${f.error}")
}

// Or panic if failure is unrecoverable
result := try! promise.get()  // int (panics on Failure)

// Or convert to optional
result := try? promise.get()  // int | null
```

---

## Parameter Passing Rules

| Type | To Worker (`async`) | To Actor Method |
|------|---------------------|-----------------|
| Primitives (`int`, `float`, `bool`, `string`) | ✅ Share | ✅ Share |
| `readonly` objects/arrays | ✅ Share | ✅ Share |
| Mutable objects/arrays | ❌ No | ❌ No |
| `Actor<T>` | ✅ Share (can call) | ❌ No |
| `Promise<T>` | ❌ No | ❌ No |

**Key insight:** Deep immutability (`readonly`) means no copying needed — safe to share memory.

---

## Common Patterns

### Parallel Map-Reduce

```javascript
readonly data = [1, 2, 3, 4, 5, 6, 7, 8]

// Map: spawn workers
let promises = data.map((x) => async compute(x))

// Reduce: collect results
let total = 0
for p of promises {
    case p.get() {
        s: Success => total += s.value,
        f: Failure => panic("failed")
    }
}
```

### Actor as Service

```javascript
class Cache {
    data: Map<string, readonly Data> = {}
    
    get(key: readonly string): readonly Data | null {
        return try? data.get(key)
    }
    
    set(key: readonly string, value: readonly Data): void {
        data.set(key, value)
    }
}

let cache = Actor<Cache>()
cache.set("key1", data1)
let value = cache.get("key1")
```

### Pipeline with Actors

```javascript
let stage1 = Actor<Stage1>()
let stage2 = Actor<Stage2>()
let stage3 = Actor<Stage3>()

readonly input = [1, 2, 3, 4, 5, 6, 7, 8]
let result1 = stage1.process(input)
let result2 = stage2.process(result1)
let result3 = stage3.process(result2)
```

---

## Design Rationale

| Decision | Problem | Solution | Benefit |
|----------|---------|----------|---------|
| Isolation | Shared mutable state causes data races | Functions can't access mutable shared state | Compiler-enforced thread safety |
| `readonly` parameters | Passing mutable data allows sharing | Only `readonly` values cross boundaries | Zero-copy sharing, no data races |
| `Actor<T>` wrapper | Special actor syntax complicates language | Actors are generic wrappers around classes | Classes stay classes; clear distinction |
| Implicit `get()` | Always requiring async/await is verbose | Actor calls without `async` implicitly wait | Synchronous-looking code for simple cases |
| No actor passing | Circular references cause deadlocks | Strict parent-child hierarchy | Deadlock-free by construction |
| Worker → Actor | Workers need services (logging, caching) | One-way dependency is safe | No deadlock risk |
| No channels | Channels can cause deadlocks | Use actor methods and promises | Simpler, deadlock-free, type-safe |

---

## Summary

Doof's concurrency model provides:

- **Safety** — no data races, no deadlocks (compiler-enforced)
- **Simplicity** — direct method calls, not message passing
- **Performance** — deep immutability enables zero-copy sharing
- **Clarity** — `async` = Promise, isolation is explicit
- **Structure** — hierarchical actors, system worker pool
