# Async/Await

Doof supports asynchronous programming using the `async` and `await` keywords, similar to TypeScript and other modern languages. This allows you to write non-blocking code that looks and behaves like synchronous code.

## Async Functions

Functions can be marked with the `async` keyword to indicate they are intended for asynchronous execution. Unlike some other languages, **async functions in Doof return their direct result type, not a Future**.

```doof
async function fetchData(url: string): string {
    // Simulate network delay
    // ...
    return "Data from " + url;
}
```

When you mark a function as `async`:
1. The return type is the actual value type (e.g., `string`, `int`, `void`).
2. The function can be called synchronously like any other function.
3. To run it asynchronously, you must use the `async` keyword at the call site.

## Async Invocation

To execute a function asynchronously and get a `Future<T>`, use the `async` keyword before the function call.

```doof
// Returns Future<string>
let futureData = async fetchData("https://example.com");
```

This wraps the function execution in a task, submits it to the thread pool, and immediately returns a `Future`.

## Await Expressions

The `await` keyword is used to wait for a `Future` to complete and retrieve its result.

```doof
function processData(): void {
    println("Fetching data...");
    
    // Start async operation
    let future = async fetchData("https://example.com");
    
    // Wait for result
    let data = await future;
    
    println("Received: " + data);
}
```

When `await` is used:
1. It pauses the execution of the current function until the awaited `Future` completes.
2. It unwraps the `Future<T>` and returns the value of type `T`.
3. If the task hasn't started yet, the runtime may inline it on the current thread to prevent deadlocks.

## The Future<T> Type

`Future<T>` is a generic class that represents a value that may not be available yet. It is the return type of `async` expressions.

- `Future<int>`: An async operation that returns an integer.
- `Future<string>`: An async operation that returns a string.
- `Future<void>`: An async operation that returns no value.

## Example

```doof
async function add(a: int, b: int): int {
    return a + b;
}

function main(): void {
    println("Starting calculation...");
    
    // Start two async operations in parallel
    let future1 = async add(10, 20);
    let future2 = async add(5, 5);
    
    // Wait for results
    let result1 = await future1;
    let result2 = await future2;
    
    println("Result 1: " + result1);
    println("Result 2: " + result2);
    println("Total: " + (result1 + result2));
}
```

## C++ Mapping

Doof's async/await maps to a lightweight C++ runtime based on `std::future`, `std::thread`, and a thread pool.

- `async func(...)` -> Creates a `doof_runtime::Task`, submits it to `ThreadPool`, and returns `doof_runtime::Future<T>`.
- `await expr` -> Calls `expr.get()`, which blocks (or inlines) until the result is ready.
- The runtime manages a thread pool to execute async tasks efficiently.
