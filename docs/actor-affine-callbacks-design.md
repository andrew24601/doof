# Execution Model Addendum: Actor-Aware Native Callbacks

## Status

Draft design addition.

This document assumes the actor-only concurrency model is already in place. It focuses only on the runtime execution model needed to preserve actor-domain guarantees when Doof is lowered to C++.

---

## Problem

Doof code may contain callbacks or closure-like callable values. When transpiling to C++, the natural representation is `std::function`.

However, a raw `std::function` does not know which actor domain it belongs to.

That creates a safety hole:

```cpp
std::function<void()> f = ...;

std::thread([f] {
  f(); // may execute actor-local captured state from the wrong thread
});
```

If the callback captures mutable state owned by an actor, invoking it from the wrong native context violates Doof’s actor-domain model.

Therefore, Doof callbacks must not lower directly to raw `std::function`.

---

## Core rule

A Doof callback is actor-affine.

> A callback belongs to the actor domain in which it was created.

It may execute only inside that actor domain, or be explicitly posted back to that actor’s mailbox.

A callback is therefore not just executable code. It is:

```text
function body
+ captured environment
+ owning actor reference
```

---

## Runtime representation

Doof callbacks lower to an actor-aware runtime type, conceptually:

```cpp
doof::callback<R(Args...)>
```

A callback stores:

```text
the callable body
the captured environment
a reference to the owning actor
```

The owning actor reference may be weak, so callbacks do not accidentally keep retired actors alive.

The exact implementation is runtime-defined, but the semantic requirement is that the callback always knows which actor owns its captured environment.

---

## Active actor tracking

The runtime maintains the currently active actor for each native thread.

Conceptually:

```cpp
thread_local ActorRef active_actor;
```

Whenever an actor begins processing a message, the runtime sets the active actor for that thread. When the message completes, the previous active actor is restored.

This gives the runtime enough information to determine whether a callback is being invoked from its owning actor domain.

---

## Callback execution modes

A callback supports two explicit execution modes:

```cpp
cb.call(args...)
cb.post(args...)
```

There must not be an operation that silently chooses between local execution and posting.

---

## Local callback invocation

A local call executes the callback immediately on the current stack.

```cpp
cb.call(args...)
```

This is valid only when:

```text
active_actor == cb.owner
```

If the active actor does not match the callback’s owner, the runtime panics.

This prevents native code from accidentally invoking actor-local code from the wrong thread or actor domain.

Example:

```cpp
cb.call(event); // checked local invocation
```

If called from the wrong actor:

```text
panic: callback invoked outside owning actor domain
```

A local call is appropriate when native code is known to invoke the callback synchronously while already inside the correct actor domain.

---

## Posted callback invocation

A posted call enqueues the callback invocation onto the owning actor.

```cpp
cb.post(args...)
```

The callback does not execute on the caller’s stack. It is scheduled as work for the owning actor and later runs inside that actor domain.

This is appropriate when native code may invoke the callback:

```text
later
from another thread
from an unknown actor domain
from a foreign event loop
```

Posting returns a promise handle:

```cpp
auto p = cb.post(args...);
```

For `void` callbacks, posting returns `doof::Promise<void>`.

---

## No implicit conversion to `std::function`

A `doof::callback` must not implicitly convert to `std::function`.

Implicit conversion would erase actor-domain metadata and make unsafe native invocation too easy.

Interop with native APIs must use callback-aware signatures. A bodyless native
import that declares a function-typed parameter still lowers that parameter to
`doof::callback`; the emitter must not guess whether native code will invoke the
callback locally, store it, or schedule it.

---

## Native interop adapters

For native APIs that synchronously invoke the callback on the current stack,
accept `doof::callback` and call:

```cpp
cb.call(args...)
```

This checks that the active actor is the callback’s owner.

For native APIs that store the callback, invoke it later, or invoke it from a
foreign thread, accept `doof::callback` and call:

```cpp
cb.post(args...)
```

This schedules the callback back onto the owning actor and returns a
`doof::Promise<R>`.

The native boundary receives the same callback object either way. It selects the
execution mode explicitly by choosing `.call(...)` or `.post(...)`.

---

## Callback lifecycle

If the owning actor is running, the callback may be called locally from that actor or posted to that actor.

If the owning actor is retiring or retired:

```text
cb.call(...)
cb.post(...)
```

fail according to the same general rules as calls to retiring or retired actors.

The preferred default is to treat explicit invocation of a callback owned by a retired actor as a logic error.

```text
panic: callback owner is retired
```

A non-throwing or fallible variant may be added later for native integration
points that need to report retirement without panicking.

This can return `false` if the owner is no longer accepting work.

---

## Relationship to actor methods

A callback should be understood as:

> An anonymous method of the actor that created it.

Like an actor method, it may execute only inside its owning actor domain.

From outside that domain, it must be posted.

This keeps the callback model aligned with the actor model:

```text
actor.method(args)      = named actor work
callback.call(args)     = anonymous actor-local work
callback.post(args)     = enqueue anonymous actor work
```

---

## Design constraints

The execution model must preserve these constraints:

1. Callback captures do not become shared mutable state.
2. Native C++ cannot accidentally execute a callback from the wrong actor domain.
3. Callback execution mode is explicit.
4. Raw `std::function` does not erase actor-domain ownership.
5. Posting a callback is an explicit actor hop.
6. Local callback invocation is checked against the active actor.

---

## Summary

Doof callbacks lower to actor-aware runtime callbacks rather than raw `std::function`.

A callback carries its owning actor. It can be executed in exactly two ways:

```cpp
cb.call(args...) // immediate, requires active actor == owner
cb.post(args...) // enqueue onto owning actor
```

Native interop must choose one of these modes explicitly through adapters.

This preserves Doof’s actor-domain guarantees even after lowering to C++, while still allowing integration with native callback-based APIs.
