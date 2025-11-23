# Async Support Specification

## 1. Overview
This document outlines the design for adding asynchronous programming support to Doof. The goal is to enable non-blocking operations via `async`/`await` syntax and `Future<T>` types, mapping to a custom C++ thread pool runtime with task inlining to prevent starvation.

## 2. Core Concepts

### 2.1. The `Future<T>` Type
`Future<T>` is a generic class representing a value of type `T` that will be available in the future.

**Interface:**
```doof
class Future<T> {
    // Returns true if the result is available
    isReady(): boolean;

    // Blocks until result is available, then returns it.
    get(): T;
    
    // Blocks until result is available.
    wait(): void;
}
```

### 2.2. The `async` Keyword
Used to invoke a function asynchronously.
Syntax: `async functionName(args...)`

**Semantics:**
1.  Creates a `Task<R>` wrapping the function call.
2.  Submits the task to the global `doof_runtime::ThreadPool`.
3.  Returns a `Future<R>` immediately, holding a shared reference to the task.

### 2.3. The `await` Keyword
Used to suspend execution until a Future is resolved.
Syntax: `await futureExpression`

**Semantics:**
1.  `futureExpression` must evaluate to `Future<T>`.
2.  Calls `.get()` on the future.
3.  **Task Inlining**: If the task has not started yet, the current thread executes it immediately to prevent deadlock.
4.  If the task is already running on another thread, blocks until completion.
5.  Unwraps and returns the value `T`.

## 3. Safety & Isolation Rules

To ensure thread safety without complex locking mechanisms, Doof enforces strict isolation rules for async calls.

### 3.1. Immutable Types
Data passed across thread boundaries must be immutable.
*   **Primitives**: `int`, `bool`, `float`, `string` are immutable.
*   **Classes**: A class is immutable if all its fields are `readonly` (doof has deep readonly semantics).

### 3.2. Isolated Functions
A function is **Isolated** if it guarantees no dependencies on global mutable state.

**Rules for Isolated Functions:**
1.  Must not access mutable global variables.
2.  Must not access mutable static class members.
3.  Must only call other **Isolated** functions.
4.  *May* instantiate and use mutable objects locally.

### 3.3. Async Invocation Rules
To invoke `async foo(args...)`:
1.  `foo` must be an **Isolated Function**.
2.  All `args` must be of **Immutable Types**.
3.  The return type of `foo` must be an **Immutable Type**.

This ensures that the background thread operates on a completely detached graph of objects.

## 4. Syntax Changes

### 4.1. Grammar
```ebnf
expression
    : ...
    | async_expression
    | await_expression
    ;

async_expression
    : 'async' function_call
    ;

await_expression
    : 'await' expression
    ;
```

## 5. C++ Code Generation

### 5.1. Mapping
*   `Future<T>` -> `doof_runtime::Future<T>`
*   `async func(...)` -> `doof_runtime::ThreadPool::submit(...)`
*   `await fut` -> `fut.get()` (which handles inlining)

### 5.2. Example
**Doof:**
```doof
function heavyCalc(val: int): int {
    return val * 2;
}

func main() {
    f = async heavyCalc(10);
    res = await f;
}
```

**Generated C++:**
```cpp
#include "doof_runtime.h"

int heavyCalc(int val) {
    return val * 2;
}

void main() {
    // 1. Create Task & Submit
    auto task = std::make_shared<doof_runtime::Task<int>>([]() { return heavyCalc(10); });
    doof_runtime::ThreadPool::instance().submit(task);
    
    // 2. Create Future
    doof_runtime::Future<int> f(task);
    
    // 3. Await (calls .get() which attempts inlining)
    int res = f.get();
}
```

## 6. Runtime Strategy: Thread Pool & Task Inlining

To avoid the resource exhaustion of `std::async` (which spawns a new thread per call) and the deadlock risks of a naive thread pool (where all threads block waiting for a queued task), Doof will implement a custom **Work-Stealing / Task-Inlining Runtime**.

### 6.1. The Starvation Problem
In a fixed-size thread pool (e.g., 4 threads), if 4 tasks start running and each performs a blocking `await` on a 5th task that is still in the queue, the system deadlocks. The workers are waiting for the queued task, but the queued task cannot start because no workers are free.

### 6.2. The Solution: Task Inlining
When `await future` is called, the runtime performs the following check:
1.  **Is the result ready?** Return immediately.
2.  **Is the task currently running on another thread?** Block and wait (standard behavior).
3.  **Is the task still in the queue?**
    *   **Remove** the task from the queue (or mark it as "claimed").
    *   **Execute** the task immediately on the *current* thread.
    *   Return the result.

This ensures that the dependency graph is always traversed. If Thread A waits for Task B, and Task B is queued, Thread A becomes the worker for Task B.

### 6.3. Future Enhancements (Await All)
Since `Task` handles are shared (`std::shared_ptr`), a future `await_all` mechanism can simply iterate through a list of futures and inline any that are pending.

## 7. Implementation Plan

### Phase 1: Runtime Library (C++)
1.  Implement `doof_runtime::TaskBase` and `doof_runtime::Task<T>`.
2.  Implement `doof_runtime::ThreadPool` with a fixed number of workers (e.g., `std::thread::hardware_concurrency()`).
3.  Implement `doof_runtime::Future<T>` with the `.get()` method performing task inlining.
4.  Add these to `doof_runtime.h` / `doof_runtime.cpp`.

### Phase 2: AST & Parser
1.  Add `AsyncExpression` and `AwaitExpression` to AST.
2.  Update parser to handle `async` and `await` keywords.

### Phase 3: Semantic Analysis
1.  Implement `isImmutable(Type)` check.
2.  Implement `isIsolated(FunctionSymbol)` check.
3.  Validate `async` callsites (Target isolated, Args immutable, Return immutable).
4.  Validate `await` callsites (Operand is `Future<T>`).

### Phase 4: Code Generation
1.  Implement C++ generation for `async` (emit `ThreadPool::submit`).
2.  Implement C++ generation for `await` (emit `.get()`).
3.  Ensure `doof_runtime.h` is included.

### Phase 5: Standard Library
1.  Define `Future` built-in type symbol in the compiler.

## 8. Future Enhancements (Out of Scope)
*   `Promise` type for manual future resolution.
*   Async methods (requires object isolation/actor model).
*   Non-blocking `await` (coroutines/continuations) - currently `await` is blocking.

