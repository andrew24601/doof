# Concurrency redesign implementation plan

Status: completed implementation plan.

This document is the working implementation artifact for the Doof concurrency
redesign. Keep it updated as implementation progresses: when a task lands,
mark it complete; when implementation discovers a better boundary, update the
plan in the same change; when semantics change, update `spec/10-concurrency.md`,
`.github/skills/doof-language/references/concurrency.md`, and the relevant
transpiler docs before considering the task done.

## Target model

- Actors are the only concurrent mutable execution domains.
- The main thread is the implicit root actor domain.
- `Actor<T>` is both the actor reference and the actor domain. Do not introduce
  a separate public handle type or owner-domain wrapper.
- Mutable state is owned by exactly one actor domain at a time.
- Immutable values may cross actor boundaries freely.
- Actor calls are the only cross-domain mutable interaction.
- Actor calls are synchronous by default.
- `async` applies only to actor method calls and returns `Promise<T>`.
- `retire actor` drains already accepted work, stops the actor, and returns the
  actor's inner `T`.
- Actor references contained in retired state remain live actors with their own
  domains. Retirement moves ordinary state, not actor domains.
- Async actor-call failures are observed through their `Promise<T>` only; retire
  does not aggregate or rethrow earlier async failures.
- Doof function values lower to actor-affine callbacks rather than raw
  `std::function`.

## Implementation tasks

- [x] Write this implementation artifact and keep-progress instruction.
- [x] Add parser, checker, emitter, runtime, and tests for `retire actor`.
- [x] Restrict `async` to actor method calls in the checker.
- [x] Update actor runtime lifecycle checks so calls after retiring/retired panic
  instead of deadlocking.
- [x] Remove worker-pool `async` lowering and `doof::async_call` once all tests
  and samples are migrated.
- [x] Replace `actor.stop()` as the documented lifecycle API with `retire`.
- [x] Add actor-boundary validation for mutable values, `Actor<T>`, and
  `Promise<T>` in actor method parameters and returns.
- [x] Add static diagnostics for obvious same-binding use after retirement.
- [x] Replace emitted Doof function types with an actor-affine callback runtime
  type.
- [x] Add callback `.call`.
- [x] Add callback `.post`.
- [x] Update all concurrency docs, samples, and the Doof language skill.
- [x] Resolve final redesign policy questions for `isolated` and
  declaration-time actor-boundary validation.

## First implementation slice

The first slice establishes the new lifecycle and async semantics without
touching callback lowering:

- [x] Add `retire` as a keyword and prefix expression.
- [x] Infer `retire Actor<T>` as `T`; diagnose non-actor retirement.
- [x] Emit `retire actorExpr` as `actorExpr->retire()`.
- [x] Add `Actor<T>::retire()` to the runtime.
- [x] Reject `async { ... }` and `async functionCall(...)` in the checker.
- [x] Keep existing parser support for `async` blocks temporarily so old syntax can
  receive semantic diagnostics during migration.

## Test plan

- Parser:
  - lexes `retire`;
  - parses `retire worker` as a retire expression.
- Checker:
  - infers `retire Actor<Job>` as `Job`;
  - diagnoses `retire value` when value is not an actor;
  - infers `async actor.method()` as `Promise<T>`;
  - diagnoses `async compute()` and `async { ... }`.
- Emitter/runtime:
  - emits `->retire()`;
  - no longer emits or ships `doof::async_call`;
  - treats `actor.stop()` as an ordinary actor method when the inner class
    defines `stop`, not as actor lifecycle syntax;
  - runtime rejects calls after retirement is requested;
  - retirement drains queued calls before returning state.

## Completed second implementation slice

This slice removes the old worker-pool concurrency path and finishes the public
lifecycle migration:

- [x] Remove non-actor async fallback emission from `emitAsyncExpression`.
- [x] Remove the `doof::async_call` runtime helper.
- [x] Remove the special `Actor<T>.stop()` checker and emitter surface.
- [x] Migrate concurrency tests from `actor.stop()` to `retire actor`.
- [x] Update concurrency spec, Doof language skill, redesign notes, and
  transpiler plan documentation.

## Completed third implementation slice

This slice adds checker enforcement for actor-call boundary values:

- [x] Add `checker-actor-boundary.ts` as the shared actor-boundary safety walk.
- [x] Reject mutable class and collection types in actor method parameters.
- [x] Reject mutable class and collection types in actor method returns.
- [x] Reject `Actor<T>` references in actor method parameters and returns.
- [x] Reject `Promise<T>` values in actor method parameters and returns.
- [x] Keep deeply immutable object/collection parameters and returns allowed.
- [x] Cover sync and async actor method calls through the same call-expression
  validation path.

## Completed fourth implementation slice

This slice replaces Doof-visible `std::function` lowering with actor-affine
runtime callbacks:

- [x] Emit Doof function types as `doof::callback<R(Args...)>`.
- [x] Wrap emitted lambda expressions in `doof::callback`.
- [x] Lower first-class callback invocation to `.call(...)` while preserving
  ordinary function and method calls.
- [x] Add runtime active-actor tracking and mark actor mailbox tasks as running
  inside their actor domain.
- [x] Add checked local callback invocation.
- [x] Update runtime array callback helpers and `Result` callback helpers to use
  `.call(...)` rather than raw invocation.
- [x] Specialize callback argument target types for generic helper calls such as
  `Result.map`, `Result.andThen`, and `Result.orElse`, so named functions passed
  as callbacks lower with concrete `doof::callback` signatures.
- [x] Lower callback-valued class fields through `.call(...)`, including
  `this`-field calls in generic stream helper classes.
- [x] Keep function-typed extern imports on the actor-affine callback ABI; no
  `std::function` adaptation is emitted automatically for bodiless native C++.

## Completed fifth implementation slice

This slice finishes the actor-only callback and retirement safety surface:

- [x] Add `callback.post(...)`, returning `Promise<R>` and enqueueing callback
  work onto the owning actor domain.
- [x] Make root-domain callback posting a runtime logic error because the root
  domain has no actor mailbox.
- [x] Allow actor-affine callback values across actor method boundaries while
  validating callback parameter and return payload types with the same actor
  boundary walk.
- [x] Add a conservative checker diagnostic for later same-binding actor use
  after `retire actor`.
- [x] Align `Promise<void>.get()` with checker/spec typing as
  `Result<void, string>`.
- [x] Update callback-aware stdlib native surfaces that participate in e2e
  testing.

## Final policy decisions

- `isolated` remains a recognized compatibility and purity marker. It does not
  authorize worker-pool dispatch and has no concurrency authority.
- Actor-boundary validation remains a call-site rule. The checker validates the
  effective actor method signature after generic substitution, where it has the
  concrete parameter and return payload types that actually cross the boundary.
  Class declarations can still define ordinary methods whose signatures would be
  invalid only when invoked through `Actor<T>`.

No open redesign implementation items remain. Future refinements should be
tracked as new design work rather than as part of this migration.
