# Doof Concurrency Reference

## Overview

Doof's concurrency model eliminates data races and deadlocks through compile-time enforcement. Core principles: isolation, deep immutability, and structured parallelism.

## Isolation

Functions used in concurrent contexts must be **isolated** — they cannot access mutable global state.

```doof
// Implicitly isolated (no mutable global access)
function sum(numbers: readonly int[]): int {
    let total = 0
    for n of numbers { total += n }
    return total
}

// Explicitly isolated (enforced by compiler)
isolated function processData(data: readonly int[]): int {
    return data.reduce(0, => acc + it)
}
```

### What Isolated Functions Can/Cannot Do

| Allowed | Not Allowed |
|---------|-------------|
| Access/mutate local variables | Access mutable globals |
| Access/mutate parameters | Call non-isolated functions |
| Access `readonly` globals | |
| Call other isolated functions | |
| Create and return new objects | |

## Workers: `async` Keyword

Run isolated functions on the system worker pool:

```doof
isolated function compute(n: int): int => n * n

let promise = async compute(42)

case promise.get() {
    s: Success -> println("Result: ${s.value}"),
    f: Failure -> println("Error: ${f.error}")
}

// Or shorthand
result := try! promise.get()
```

### Parameter Rules for Workers

- **Parameters** must be `readonly` (shared immutably with worker, zero-copy)
- **Returns** can be mutable (worker creates fresh values)

```doof
readonly data = [1, 2, 3]
let p = async processData(data)           // ✅ readonly parameter

let mutableData = [1, 2, 3]
let p2 = async processData(mutableData)   // ❌ not readonly
```

### Async Closures

```doof
readonly data = [1, 2, 3, 4, 5]

let promise = async {
    let sum = 0
    for x of data { sum += x * x }
    return sum
}
```

## Actors: `Actor<T>`

Actors wrap classes for safe stateful concurrency. Each actor processes method calls sequentially on its own thread.

```doof
class Counter {
    count = 0
    increment(amount: int): void { count += amount }
    getCount(): int => count
}

let counter = Actor<Counter>()

// Synchronous call (blocks until complete)
counter.increment(5)
let count = counter.getCount()     // 5

// Asynchronous call (returns Promise)
let p = async counter.increment(10)
try! p.get()
```

### Actor Method Requirements

- **Parameters** must be `readonly`
- **Returns** must be `readonly` (prevents mutable state escaping)

### Actor Hierarchy Rules

- Parent can hold references to children it creates
- Parent can call child methods
- Actors cannot be passed as parameters to other actors
- No circular actor references
- Workers can call actor methods (one-way dependency is safe)

### Lifecycle

```doof
let worker = Actor<Worker>()
worker.initialize(config)     // queued call
worker.doWork(data)           // queued after initialize
worker.stop()                 // waits for pending calls, then stops
```

## Promises

```doof
class Promise<T> {
    function get(): Result<T, Error>   // block until ready
}

let promise = async compute(42)
result := try! promise.get()           // int (panics on failure)
result := try? promise.get()           // int | null
```

## Parameter Passing Summary

| Type | To Worker (`async`) | To Actor Method |
|------|---------------------|-----------------|
| Primitives | ✅ Share | ✅ Share |
| `readonly` objects/arrays | ✅ Share | ✅ Share |
| Mutable objects/arrays | ❌ No | ❌ No |
| `Actor<T>` | ✅ Share (can call) | ❌ No |
| `Promise<T>` | ❌ No | ❌ No |

## Common Patterns

### Parallel Map-Reduce

```doof
readonly data = [1, 2, 3, 4, 5, 6, 7, 8]
let promises = data.map((x) => async compute(x))

let total = 0
for p of promises {
    total += try! p.get()
}
```

### Actor as Service

```doof
class Cache {
    data: Map<string, readonly Data> = {}
    get(key: readonly string): readonly Data | null => data.get(key).valueOr(null)
    set(key: readonly string, value: readonly Data): void { data.set(key, value) }
}

let cache = Actor<Cache>()
cache.set("key1", data1)
let value = cache.get("key1")
```
