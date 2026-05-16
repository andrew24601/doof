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

Validation anchors:

- `src/checker-features.test.ts`
- `src/checker-validation.test.ts`
- `spec/02-type-system.md`

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
