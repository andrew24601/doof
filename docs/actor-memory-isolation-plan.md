# Actor memory isolation implementation plan

## Status

Implementation plan for restoring the compile-time ownership invariant across
the seed and self-hosted compilers. Keep this file aligned with the spec and
mark acceptance items complete as they land.

## Invariant

Every mutable value belongs to one actor domain. The main/root domain is an
actor domain too. Code executing in one domain must not obtain a direct
reference to mutable state owned by another domain.

The compiler enforces that invariant through two related checks:

1. Values entering or leaving an actor boundary are deeply immutable.
2. Code dispatched to an actor is isolated from mutable module/static state.

Actor-affine callbacks remain the explicit exception for callable values. They
carry their owning domain and may execute locally only in that domain or be
posted back to it.

## Isolation effect

A function or method is inferred isolated when all of the following hold:

- it does not access a reassignable module/static binding;
- it does not access a module/static binding whose value has mutable interior;
- it calls only functions or methods that are themselves inferred isolated;
- any native/bodyless function it calls declares `isolated` as an explicit
  contract.

Isolation does not prohibit mutation through `this`, parameters, local
bindings, or values created locally. Those references already belong to the
current domain.

`isolated` is an enforced promise. An explicitly isolated declaration that is
not inferred isolated is a compile-time error. Recursive call groups are
isolated when no member has a direct violation or reaches a non-isolated call.

An ordinary class method may remain non-isolated for local use. Calling that
method through `Actor<T>` is rejected. This keeps actor-boundary validation at
the concrete call site while still checking transitive effects.

## Actor construction

`Actor<T>(...)` creates a new domain, so each supplied constructor argument must
be actor-boundary-safe. Mutable arguments are rejected even when the binding is
not reassignable because Doof does not currently have uniqueness or move types.

Defaults and constructor factories used by actor creation must be isolated so
they cannot capture mutable module/static state into the new actor. Fresh
mutable values created entirely by the construction path remain valid actor
state.

## Interface soundness

A readonly interface field may only be implemented by a readonly field.
Actor-boundary analysis of an interface must also be sound for every concrete
closed-world implementation. A mutable implementation must never cross by
being widened to a readonly interface type.

## Diagnostics

Diagnostics should identify:

- the actor call or explicit `isolated` declaration being rejected;
- the mutable module/static binding or non-isolated callee responsible;
- the mutable constructor payload or unsound interface implementation.

## Acceptance checklist

- [x] Seed checker infers isolation transitively and enforces explicit
  `isolated` declarations.
- [x] Seed checker requires actor-call targets to be inferred isolated.
- [x] Seed checker validates actor-construction arguments and construction
  paths.
- [x] Seed checker preserves readonly interface fields through conformance and
  boundary analysis.
- [x] Self-hosted checker implements the same rules and diagnostics.
- [x] Seed and self-hosted tests cover direct, transitive, imported, recursive,
  constructor, default, interface, and valid actor-local mutation cases.
- [x] Concurrency spec, language skill, and checker architecture docs describe
  the implemented behavior.
- [x] TypeScript build and full seed/self-hosted test suites pass.
