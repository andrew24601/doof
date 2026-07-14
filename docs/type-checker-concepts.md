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

## Definite Returns in Block Bodies

Block-bodied functions and methods with an explicitly declared non-`void`
return type must not complete normally. The checker performs conservative
normal-completion analysis after statement checking: every reachable branch
must return, panic, or be unable to complete normally. Bodyless native/imported
callables are signature declarations and are excluded from this check.

Primary modules:

- `src/checker-control-flow.ts`
- `src/checker-decl.ts`
- `src/checker-stmt.ts`

Keep aligned:

- `if` chains require an exiting `else` path; statement-level `case` requires a
  wildcard or known exhaustive Result-arm pattern before it can establish a
  definite return
- loops are fallthrough unless their condition is provably infinite and no
  reachable `break` escapes; `for-of` remains fallthrough because the iterable
  may be empty
- `panic(...)` is recognized only when the call resolves to the builtin, so a
  user-defined shadowing function does not suppress the diagnostic

Validation anchors:

- `src/checker-compat.test.ts`
- `spec/04-functions-and-lambdas.md`

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

## Generic JSON and Metadata Constraints

`JsonSerializable` is a constraint-only intrinsic used to allow static JSON
intrinsics on type parameters. `T.fromJsonValue(...)` is accepted only while the
active type-parameter constraint stack records `T: JsonSerializable`; concrete
generic instantiation then validates the class argument and marks it for JSON
generation.

`Reflectable` is the metadata counterpart. `T.metadata` is accepted only while
the active type-parameter constraint stack records `T: Reflectable`; concrete
generic instantiation then validates the class or struct argument, rejects
generic or dedicated-constructor owners, and marks it for both metadata and JSON
generation.

Primary modules:

- `src/checker-expr.ts`
- `src/checker-member.ts`
- `src/checker-decl.ts`
- `src/checker-types.ts`

Keep aligned:

- constraint resolution must preserve `JsonSerializable` and `Reflectable` as markers rather than resolving them as normal named types
- member lookup on `typevar` must match generic-call validation so unconstrained `T.fromJsonValue` / `T.metadata` are rejected and constrained instantiations mark concrete classes for generated helpers
- diagnostics and serializability checks should reuse the same field-level JSON helpers used by concrete class `.fromJsonValue()`
- classes with a dedicated static `constructor(...): Self` or
  `constructor(...): Result<Self, E>` must fail
  `JsonSerializable`, `Reflectable`, and direct `.toJsonObject()` /
  `.fromJsonValue()` access

Validation anchors:

- `src/checker-generics.test.ts`
- `src/emitter-generics.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/12-json-serialization.md`
- `spec/13-descriptions.md`

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

## Self-Hosted Checker Method and Union Rules

The self-hosted checker keeps class fields and methods in the same method
scope. An unqualified method call inside a class method resolves as an
implicit method binding, while an explicit receiver continues through normal
member lookup. Assignability must test exact type equality before distributing
over a union target; otherwise an identical union such as `Item | null` is
incorrectly rejected as a member-wise assignment.

Branch checking must visit every `then`, `else-if`, and `else` block even when
an earlier branch already establishes the normal-completion result. Completion
analysis may combine branch results after checking them; it must not use
short-circuit boolean evaluation that skips AST decoration in later branches.

Assignment checking must also decorate the assignment target expression itself,
including member and index targets. The emitter uses that target decoration to
select representation-level promotion when a non-null `ResolvedType` or AST
union value is assigned into a nullable AST field.

The self-hosted pipeline preserves `class` versus `struct` on
`ClassDeclaration` and its analyzed symbol. Both nominal kinds use `ClassType`
for member checking, but the symbol kind remains authoritative for downstream
reference-versus-value lowering. Struct symbols are predeclared like classes
and remain excluded from interface implementation discovery in v1.

Primary modules:

- `selfhost/checker.do`
- `selfhost/checker-types.do`
- `selfhost/analyzer.do`
- `selfhost/parser-declarations.do`

Validation anchors:

- `selfhost/checker.test.do`
- `selfhost/parser.test.do`
- `selfhost/emitter.test.do`

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

`Result<T, E>` resolves to the canonical union `Success<T> | Failure<E>`.
`getResultShape` is the single recognition boundary for Result-only operations;
all recursive type traversal, assignability, and readonly/actor checks otherwise
treat it as an ordinary union. Result behavior crosses expression inference,
statement checking, and scope mutation:

- `try` validates the RHS and propagates error types
- successful bindings are retyped from `Result<T, E>` to `T`
- `catch` collects error types into nullable unions
- case arms use ordinary union narrowing to `Success<T>` or `Failure<E>`; when
  an expression-form case yields both intrinsic arms, inference reconstructs
  the full canonical `Result<T, E>` union before emission rather than retaining
  only the first arm's type
- declaration-`else` handlers must exit only when a narrowed binding is introduced after the handler
- Result statement-`else` and `_ := result else ...` handlers mark the Result as handled without requiring scope exit
- the self-hosted checker follows the same scope split: the handler sees the
  original subject or failure payload, while only the narrowed binding is
  declared in the surrounding scope after a non-completing handler; calls to
  the builtin `panic` count as non-completing after identifier resolution

Primary modules:

- `src/checker-result.ts`
- `src/checker-stmt.ts`
- `src/checker-expr.ts`
- `selfhost/checker.do`

Keep aligned:

- any new binding form supported by `try` must be handled by both validation and retyping
- bare-expression `try`, destructuring `try`, `catch`, and result-pattern case arms should remain mutually consistent
- diagnostics for unused or misapplied `Result` values should stay aligned between statement and expression positions
- failure-capture syntax (`else error`) should bind the `Failure<E>.error` payload only for non-null Results with non-void `E`
- unresolved generic channels must not contextually erase a standalone arm's inferred payload type

Validation anchors:

- `src/checker-features.test.ts`
- `src/checker-inference.test.ts`
- `selfhost/checker.test.do`
- `spec/08-errors-and-results.md`

## Built-in Range Values

Finite `a..b` and `a..<b` expressions resolve to the builtin `Range` type, while
open-ended range forms remain `case` pattern syntax only. The checker should use
the `Range` type, not raw syntax shape, when deciding whether a `for of` source
is range-iterable; the loop binding type is always `int`. `Range` exposes
`lowerBound` and exclusive `upperBound` accessors. Descending ranges are
representable but iterate as empty ranges.

Primary modules:

- `src/parser.ts`
- `src/checker-expr-ops.ts`
- `src/checker-stmt.ts`
- `src/emitter-types.ts`

Validation anchors:

- `src/parser-expr.test.ts`
- `src/checker-features.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`

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
