# Concurrency redesign: actor-owned mutable domains

Status: working design note. Most examples use current Doof syntax. The
`retire actor` lifecycle form is now implemented in the compiler.

This design treats **actors as the only concurrent mutable execution domain**.
The main thread is an implicit actor. Immutable values may be freely shared
between domains, while mutable state is confined to exactly one actor domain at
a time.

The core idea:

> Mutable state lives inside actors. Immutable values can cross domains freely.
> Cross-domain mutable interaction happens only through actor calls.

This intentionally differs from the old worker-pool design: there are no
free-floating worker tasks in the core model. Background mutable work is
represented as an actor, usually a temporary one.

---

## 1. Actor domains

Every program begins in an implicit root actor, usually the main actor.

```doof
cache := Actor<Cache>()
cache.put("x", 1)
```

Creating an actor creates a new mutable domain. The actor owns its internal
mutable state and processes method calls sequentially.

```doof
class Counter {
    value = 0

    increment(n: int): void {
        value += n
    }

    get(): int {
        return value
    }
}
```

Actor methods may mutate actor-owned state. Calls into an actor are serialized
by that actor.

---

## 2. Synchronous by default

Actor calls are synchronous by default.

```doof
counter := Actor<Counter>()

counter.increment(5)
counter.increment(3)

n := counter.get()
```

The caller blocks until the actor method completes. This preserves ordinary
sequential reasoning.

Asynchronous calls remain available when the caller wants to continue
immediately:

```doof
p := async counter.increment(10)
```

`async` means the actor call is enqueued and a `Promise<T>` handle is returned.

---

## 3. No separate worker-task model

There are no special worker functions or worker pools in the core model.

Instead of a worker task, use a temporary actor:

```doof
class Computation {
    readonly input: readonly int[]
    result: Result<int, string> | null = null

    run(): void {
        result = compute(input)
    }
}

job := Actor<Computation>(input)

p := async job.run()

finished := retire job
result := finished.result
```

This makes background computation just another actor use case.

If the task needs mutable state, that state belongs to the temporary actor. If
it only reads immutable data, that data can be freely shared.

`async job.run()` returns a `Promise<void>` for void actor methods. Retirement
does not observe earlier async failures; callers observe them through the
promise handles they keep.

---

## 4. Immutable values are freely shareable

Immutable collections and immutable values may be passed between actor domains
without copying or moving.

```doof
class JobConfig {
    readonly retries: int
    readonly timeoutSeconds: int
}

readonly config = JobConfig { retries: 3, timeoutSeconds: 30 }

worker := Actor<Job>(config)
```

Because the value is immutable, sharing it across actors does not create a
mutable memory intersection.

Mutable values cannot be shared directly between actors. They remain inside
their owning actor domain.

---

## 5. Actor references are domain-confined

Actor references may be freely copied within the owning actor's domain.

```doof
child := Actor<Job>()
alias := child

child.run()
alias.status()
```

Both references point to the same actor.

However, actor references may not be passed into another actor.

```doof
cache := Actor<Cache>()
worker := Actor<Worker>()

worker.setCache(cache) // illegal
```

This preserves a tree of actor ownership rather than an arbitrary graph of
actor references.

Conceptually:

```text
Main
|- Cache
|- Worker
|  `- ChildOfWorker
`- Logger
```

The main actor may hold references to `Cache`, `Worker`, and `Logger`.
`Worker` may hold references to actors it created. But `Worker` cannot be
handed a reference to `Cache`.

Open design point: the current concurrency spec allows workers to receive
`Actor<T>` references and call actors. Removing workers makes that rule
irrelevant, but the replacement rule should still say whether non-actor
concurrent contexts can ever hold actor references.

---

## 6. Retirement

The public actor lifecycle API is `retire actor`, which drains accepted work,
stops the actor, and returns its owned state. The old `actor.stop()` lifecycle
surface has been removed from the language model; an actor method named `stop`
is now just an ordinary call to the actor's inner class.

```doof
job := Actor<Job>()

job.run()

state: Job := retire job
```

Retirement transforms:

```text
Actor<T> -> T
```

After retirement, the actor's mutable state is no longer concurrent. It becomes
an ordinary value in the owning domain.

### Retirement as a queued request

`retire actor` is treated as an enqueued request to the actor.

```doof
step1 := async job.step1()
step2 := async job.step2()

state := retire job
```

The actor observes the queue as:

```text
step1
step2
retire
```

The actor retires exactly when it reaches the `retire` request in its queue.

Open design point: if `step1` or `step2` fails, the design needs an explicit
rule for whether `retire job` returns a `Result<Job, string>`, panics, or returns
the state while the individual `Promise` retains the failure.

### Retirement semantics

When `retire actor` is evaluated:

1. a retirement request is enqueued onto the actor;
2. the actor enters the `retiring` state;
3. further calls through any alias to that actor are rejected;
4. the actor continues processing already-enqueued calls in order;
5. when the retirement request is reached, the actor stops;
6. the actor's inner `T` is returned to the retiring domain;
7. all aliases to that actor become retired references.

Example:

```doof
job := Actor<Job>()
alias := job

step := async job.step1()

state := retire job

alias.step2() // panic: actor retired
```

This is not a threaded race. Since actor references cannot leave the owning
domain, all references are used from a single sequential domain. Calling a
retiring or retired actor is a logic error, like using a closed file handle.

---

## 7. Async calls and retirement

Asynchronous calls are still actor calls.

```doof
p := async actor.doWork()
```

If the call has already been accepted before retirement is requested, it appears
before the retirement request in the actor queue:

```doof
p := async actor.doWork()
state := retire actor
```

Queue:

```text
doWork
retire
```

So `doWork` completes before the actor retires.

If a call is attempted after retirement has been requested:

```doof
state := retire actor
actor.doWork()
```

the call panics because the actor is already retiring or retired.

The same rule applies to synchronous and asynchronous calls:

> Once retirement has been requested, no new actor calls are accepted.

---

## 8. Timers and scheduled tasks

Timers and scheduled tasks are intentionally left for future design.

The current concurrency model should not commit to their exact syntax or
semantics yet.

The only provisional constraint is:

> Timers and schedules must not introduce shared mutable state or closure
> capture that violates actor-domain isolation.

A future design should preserve the same core invariant: mutable work happens
inside actor domains, and cross-domain effects occur through explicit actor
calls.

---

## 9. Design questions to settle

This redesign is strongest once these choices are made explicit:

- Does `async` remain valid for blocks and isolated functions, or only for actor
  method calls?
- If an already-enqueued async actor call fails, is that failure observed only
  through its `Promise<T>`, or can `retire actor` surface it?
- What happens when an actor that owns child actors is retired? The design
  should require children to be retired first, recursively retire them, or
  define an explicit stop behavior.
- Is using an alias after `retire actor` always a runtime panic, or should the
  checker reject obvious same-scope uses after retirement?
- Is `retire actor` fallible? If so, prefer spelling it as a `Result<T, string>`
  producer so existing `try`, `try!`, and `try?` flows work.

---

## 10. Design invariant

The central invariant is:

> Mutable state is owned by exactly one actor domain. Actor calls are the only
> way to interact across mutable domains. Immutable values may be freely shared.
> Actor references may be copied only within their owning domain and may not be
> passed into other actors.

This gives Doof a compact concurrency model:

- no shared mutable memory between actors;
- no closure capture across concurrency boundaries;
- no separate worker-task abstraction;
- actor calls are synchronous by default;
- asynchronous calls are explicit;
- retirement is queue-ordered and defines the actor's exact end-of-life;
- misuse after retirement is a logic error, not a data race.

In short:

> Everything mutable is an actor. Everything cross-domain is an actor call.
> Everything retired becomes ordinary state again.
