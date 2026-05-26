# Concurrency

## Overview

Doof's concurrency model is built around actor-owned mutable domains.

An `Actor<T>` is a concurrent domain containing one mutable `T`. The main thread
is the implicit root actor domain. Mutable state belongs to exactly one actor
domain at a time. Immutable values may be shared freely across actor domains.

Cross-domain mutable interaction happens only through actor method calls.

---

## Actors

Actors wrap classes:

```doof
class Counter {
    value: int

    increment(n: int): void {
        this.value = this.value + n
    }

    get(): int {
        return this.value
    }
}

const counter = Actor<Counter>(0)
```

Each actor processes method calls sequentially.

---

## Actor Calls

Actor calls are synchronous by default:

```doof
counter.increment(5)
const n = counter.get()
```

The caller blocks until the actor method completes.

Actor calls may be asynchronous:

```doof
const p = async counter.increment(10)
try! p.get()
```

`async actor.method(args)` returns `Promise<T>`, where `T` is the actor method's
return type.

`async` is valid only for actor method calls. Async blocks and worker-pool
function dispatch are not part of the core concurrency model:

```doof
async compute()   // error
async { 42 }      // error
```

Use a temporary actor for background work that needs a separate mutable domain.

---

## Actor Boundaries

Actor methods are actor boundaries. Values crossing an actor boundary must not
create shared mutable state.

Allowed:

- primitives;
- deeply immutable objects and collections.

Rejected:

- mutable objects and collections;
- `Actor<T>` references;
- `Promise<T>` values.

Actor references may be copied within the domain that owns them. They may not be
passed into another actor method.

---

## Retirement

`retire actor` stops an actor and returns its inner state:

```doof
const job = Actor<Job>()
const state: Job = retire job
```

The type transformation is:

```text
Actor<T> -> T
```

Retirement is queue ordered:

```doof
const p = async job.run()
const state = retire job
```

The actor observes:

```text
run
retire
```

Retirement behavior:

1. A retirement request is enqueued.
2. The actor enters the retiring state and stops accepting new calls.
3. Already queued calls continue in order.
4. When the retirement request is reached, the actor stops.
5. The actor's inner `T` is returned to the retiring domain.
6. Calls through aliases after retirement has been requested are logic errors
   and panic at runtime.

Failures from earlier async actor calls belong to their `Promise<T>` handles.
`retire` returns `T` and does not aggregate or rethrow earlier promise failures.

Actor references inside retired state remain live actor domains. Retirement moves
ordinary state, not actor domains.

There is no public `actor.stop()` lifecycle method. If an actor's inner class
defines a method named `stop`, `actor.stop()` is an ordinary actor method call,
not a lifecycle operation. Use `retire actor` to stop an actor domain.

---

## Promises

Promises represent asynchronous actor-call completion:

```doof
class Promise<T> {
    function get(): Result<T, string>
}
```

`get()` blocks until the queued actor method completes. Runtime failures are
reported as `Failure<string>`.

---

## Actor-Affine Callbacks

Function values are actor-affine callbacks. A callback belongs to the actor
domain in which it was created. Normal call syntax:

```doof
callback(args)
```

lowers to a checked local callback call. The explicit spelling is:

```doof
callback.call(args)
```

Local callback calls execute immediately and are valid only in the owning actor
domain. Calling a callback from another actor domain is a runtime logic error.

Callbacks can also be posted back to their owning actor domain:

```doof
promise := callback.post(args)
```

`post` enqueues the callback invocation on the owning actor and returns
`Promise<R>`, where `R` is the callback return type. A posted callback does not
run on the caller's stack. Posting a callback created in the root domain is a
runtime logic error because the root domain has no actor mailbox.

Function-typed parameters in native imports also lower to `doof::callback`; the
compiler does not assume whether bodiless C++ will call locally, store, or
schedule the callback.

Actor-affine callback values may cross actor method boundaries. Their parameter
and return payload types are still validated with the actor boundary rules,
because posted callback arguments and results cross actor domains.

---

## Isolated Functions

`isolated` remains a recognized function modifier as a compatibility and purity
marker. It does not authorize worker-pool dispatch or create a separate
concurrent execution domain. `async` does not run isolated functions on a worker
pool.

---

## Summary

- Actors are the only concurrent mutable execution domains.
- Actor calls are synchronous unless marked `async`.
- `async` is actor-call-only.
- `retire actor` drains accepted work and returns the actor state.
- Immutable values may cross domains.
- Mutable state crosses domains only by retiring its owning actor.
