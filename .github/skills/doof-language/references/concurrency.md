# Doof Concurrency Reference

## Overview

Doof concurrency is actor-owned. An `Actor<T>` is a concurrent mutable domain
containing one mutable `T`. The main thread is the implicit root actor domain.

Core rules:

- Mutable state belongs to exactly one actor domain at a time.
- Immutable values may cross actor boundaries freely.
- Cross-domain mutable interaction happens through actor method calls.
- Actor method calls are synchronous by default.
- `async` is valid only for actor method calls.
- `retire actor` drains accepted work, stops the actor, and returns the inner
  state.

## Actors

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
counter.increment(5)
const now = counter.get()
```

Each actor processes one method call at a time. A caller that does not use
`async` blocks until the method completes.

## Async Actor Calls

`async` enqueues an actor method call and returns `Promise<T>`:

```doof
const worker = Actor<Counter>(0)
const p = async worker.increment(10)
try! p.get()
```

`async` blocks and worker-pool function dispatch are not part of the actor-only
model:

```doof
async compute()   // error: not an actor method call
async { 42 }      // error: async blocks are not supported
```

Use a temporary actor for background mutable work.

`isolated` remains a recognized compatibility and purity marker, but it does
not create worker-pool execution and does not make non-actor calls eligible for
`async`.

## Retirement

`retire actor` enqueues a retirement request after already accepted work:

```doof
const job = Actor<Counter>(0)
const p = async job.increment(10)
try! p.get()

const state: Counter = retire job
```

Retirement behavior:

1. The actor stops accepting new calls.
2. Already queued calls continue in order.
3. The actor stops when the retirement request reaches the front of the queue.
4. The inner `T` is returned to the retiring domain.
5. Later calls through aliases panic because the actor is retiring or retired.

Failures from earlier async actor calls are observed through their
`Promise<T>`. `retire` returns the inner state and does not aggregate prior
promise failures.

Actor references inside the returned state remain live actors with their own
domains. Retirement moves ordinary state, not actor domains.

There is no public `actor.stop()` lifecycle method. If the actor's inner class
defines `stop`, `actor.stop()` is an ordinary actor method call. Use
`retire actor` for lifecycle shutdown.

## Promises

```doof
class Promise<T> {
    function get(): Result<T, string>
}
```

`Promise<T>` is currently produced by async actor calls. `get()` blocks until the
queued actor method completes and reports thrown runtime failures as
`Result<T, string>`.

## Actor Boundary Summary

| Type | To actor method |
|------|-----------------|
| Primitives | Allowed |
| Immutable objects/collections | Allowed |
| Mutable objects/collections | Rejected |
| `Actor<T>` | Rejected |
| `Promise<T>` | Rejected |

Actor references may be copied inside the domain that owns them. They may not be
passed into another actor method.

## Actor-Affine Callbacks

Function values lower to actor-affine callbacks. A callback belongs to the actor
domain where it was created. Normal call syntax invokes the callback locally:

```doof
function apply(f: (x: int): int, x: int): int => f(x)
```

The explicit local form is:

```doof
function apply(f: (x: int): int, x: int): int => f.call(x)
```

Local callback calls are checked by the runtime and must execute inside the
owning actor domain. Use `callback.post(args)` to enqueue callback work back
onto the owning actor; it returns `Promise<R>` for callback return type `R`.
Root-domain callbacks post to the root application mailbox. The host decides
which thread drains that mailbox, which preserves UI runtime thread affinity.

Actor-affine callback values may cross actor method boundaries, but their
parameter and return payload types must also be boundary-safe. Function-typed
parameters in native imports lower to `doof::callback`; native C++ must choose
local call or posting behavior explicitly instead of receiving an erased
`std::function`.

## Common Pattern: Temporary Actor

```doof
class Computation {
    input: int

    run(): int {
        return this.input * this.input
    }
}

const job = Actor<Computation>(42)
const p = async job.run()
const answer = try! p.get()
retire job
```
