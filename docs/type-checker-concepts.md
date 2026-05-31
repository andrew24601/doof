# Type Checker Cross-Cutting Concepts

This document records semantic rules that intentionally span multiple type-checker modules. It complements [source-file-structure.md](./source-file-structure.md), which maps file ownership, and keeps multi-file checker behavior from drifting as the implementation grows.

Use the spec files for language semantics. Use this document when a checker rule has more than one owning surface and future changes need a shared maintenance anchor.

## Reading This Document

Each section should answer four questions:

- what rule crosses module boundaries
- which source files currently own parts of the rule
- what must stay aligned when the rule changes
- which tests or specs are the best validation anchors

If you discover another checker behavior that is easy to change in one file while forgetting another, add a section here in the same change that introduces or clarifies the rule.

## Decorated AST as the Checker Boundary

The checker decorates the AST in place rather than maintaining parallel lookup maps:

- expressions receive `resolvedType`
- identifiers receive `resolvedBinding`
- declarations and binding nodes receive resolved semantic types
- analyzer-resolved named types already carry `resolvedSymbol`

Primary modules:

- `src/checker.ts`
- `src/checker-expr.ts`
- `src/checker-stmt.ts`
- `src/checker-decl.ts`

Keep aligned:

- any new AST surface that needs emission must be decorated during checking
- `validateEmitReadyDeclarations()` should continue to catch unresolved emitted nodes after the main pass

Validation anchors:

- `src/checker-validation.test.ts`
- `src/checker-inference.test.ts`

## Collection Annotation and Hashability Rules

`Map`/`ReadonlyMap` and `Set`/`ReadonlySet` are checked in several contexts: variable declarations, fields, parameters, return types, aliases, interfaces, and same-site literal inference when type arguments are omitted.

Primary modules:

- `src/checker-collection-annotations.ts`
- `src/checker-declared-values.ts`
- `src/checker-diagnostics.ts`
- `src/checker-stmt.ts`
- `src/checker-decl.ts`
- `src/checker.ts`

Keep aligned:

- collection annotation arity rules and omitted-type-argument rules belong in `checker-collection-annotations.ts`
- unsupported hash-collection diagnostics should flow through the shared `reportUnsupportedHashCollectionConstraint()` helper so declared and inferred paths produce the same message
- if supported map-key or set-element types change, update the shared checker-type predicate, this document, and all affected checker tests together

Validation anchors:

- `src/checker-compat.test.ts`
- `src/checker-validation.test.ts`
- `spec/02-type-system.md`

## Generic JSON Constraints

`JsonSerializable` is a constraint-only intrinsic used to allow static JSON
intrinsics on type parameters. `T.fromJsonValue(...)` is accepted only while the
active type-parameter constraint stack records `T: JsonSerializable`; concrete
generic instantiation then validates the class argument and marks it for JSON
generation.

Primary modules:

- `src/checker-expr.ts`
- `src/checker-member.ts`
- `src/checker-decl.ts`
- `src/checker-types.ts`

Keep aligned:

- constraint resolution must preserve `JsonSerializable` as a marker rather than resolving it as a normal named type
- member lookup on `typevar` must match generic-call validation so unconstrained `T.fromJsonValue` is rejected and constrained instantiations mark concrete classes `needsJson`
- diagnostics and serializability checks should reuse the same field-level JSON helpers used by concrete class `.fromJsonValue()`
- classes with a dedicated static `constructor(...): Self` must fail
  `JsonSerializable` validation and direct `.toJsonObject()` / `.fromJsonValue()`
  access

Validation anchors:

- `src/checker-generics.test.ts`
- `src/emitter-generics.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/12-json-serialization.md`

## Declared Value and Default Resolution

Variable declarations, parameters, and class fields all resolve the same core pipeline when an annotation meets an initializer/default value:

1. validate the annotation and resolve the declared semantic type
2. infer the initializer/default under contextual typing
3. finalize omitted `Map`/`Set` type arguments from same-site literals
4. perform caller-specific assignability checks and AST decoration

Primary modules:

- `src/checker-declared-values.ts`
- `src/checker-stmt.ts`
- `src/checker-decl.ts`

Keep aligned:

- shared annotation resolution and initializer/default finalization belong in `checker-declared-values.ts`
- statement bindings, parameters, and fields should keep only their caller-specific policy locally: binding registration, default-value diagnostics, readonly checks, and diagnostic wording
- omitted collection type arguments must continue to use the same-site initializer/default as the semantic source across all three surfaces
- default-expression validation must stay aligned for parameters and fields; static class method calls are valid default expressions when the callee resolves through named class access

Validation anchors:

- `src/checker-compat.test.ts`
- `src/checker-validation.test.ts`
- `spec/02-type-system.md`

## Deep Readonly Semantics

Readonly behavior is intentionally two-stage:

1. declared readonly shapes are transformed with deep readonly semantics
2. the resulting type is validated to ensure every reachable field or collection component is actually immutable

Primary modules:

- `src/checker-readonly.ts`
- `src/checker-stmt.ts`
- `src/checker-decl.ts`

Keep aligned:

- declarations and fields that opt into readonly semantics must apply the same deep transform before validation
- new composite `ResolvedType` variants need both transformation and violation-walk handling
- assignability and member-mutation checks elsewhere in the checker should continue to respect the readonly shape produced here
- collection `buildReadonly()` is mutable-only and returns the readonly collection type by move-draining the source, leaving it empty; `cloneMutable()` works on mutable and readonly arrays, maps, and sets and returns a shallow mutable copy

Validation anchors:

- `src/checker-features.test.ts`
- `src/checker-validation.test.ts`
- `spec/02-type-system.md`

## Actor Boundary Safety

Actor method calls are the checker surface where values cross actor domains.
Call-expression inference detects `Actor<T>.method(...)` receivers and validates
the effective method signature after generic substitution. Boundary-safe values
must be deeply immutable, and `Actor<T>` references and `Promise<T>` values are
always rejected even when nested inside otherwise readonly shapes.
Actor-affine callback values may cross actor method boundaries, but their
parameter and return payload types are validated by the same boundary walk.
Validation intentionally happens at actor call sites rather than class
declaration time, because the same method may be an ordinary local method and
generic substitution can determine the concrete payload types that cross the
boundary.

Primary modules:

- `src/checker-expr.ts`
- `src/checker-actor-boundary.ts`
- `src/checker-readonly.ts`
- `src/checker-types.ts`

Keep aligned:

- actor method parameter and return validation should use the same boundary
  walk for sync and async actor calls
- the actor-boundary walk should stay stricter than deep readonly for
  `Actor<T>` and `Promise<T>`
- function values are actor-affine callbacks; validate their parameter and
  return payload types rather than rejecting the callback value itself
- same-binding actor use after `retire actor` is diagnosed in straight-line
  statement order as a conservative use-after-retire check

Validation anchors:

- `src/checker-features.test.ts`
- `spec/10-concurrency.md`

## Result Propagation and Binding Retyping

`Result<T, E>` behavior crosses expression inference, statement checking, and scope mutation:

- `try` validates the RHS and propagates error types
- successful bindings are retyped from `Result<T, E>` to `T`
- `catch` collects error types into nullable unions
- case arms over `Result` values receive wrapper bindings for `.value` and `.error`

Primary modules:

- `src/checker-result.ts`
- `src/checker-stmt.ts`
- `src/checker-expr.ts`

Keep aligned:

- any new binding form supported by `try` must be handled by both validation and retyping
- bare-expression `try`, destructuring `try`, `catch`, and result-pattern case arms should remain mutually consistent
- diagnostics for unused or misapplied `Result` values should stay aligned between statement and expression positions

Validation anchors:

- `src/checker-features.test.ts`
- `src/checker-inference.test.ts`
- `spec/08-errors-and-results.md`

## Maintaining This Document

Update this document when:

- a checker rule spans more than one source file
- a shared diagnostic, validation rule, or semantic transform changes
- a bug fix reveals that the same concept was encoded separately in multiple modules
- a new `ResolvedType` variant or AST form requires coordinated handling in several checker surfaces

When adding a new concept, prefer a short section with:

- the rule in one paragraph
- the current owning modules
- the “keep aligned” checklist
- the smallest useful validation anchors

The goal is not to duplicate the specs or exhaustively describe the checker. The goal is to make cross-file invariants discoverable before they drift.
