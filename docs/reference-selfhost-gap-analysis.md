# Reference and Self-Hosted Compiler Gap Analysis

Status date: 2026-07-17

## Purpose

This document compares the TypeScript reference implementation in `src/` with
the self-hosted implementation in `selfhost/`. It identifies the work still
required before the self-hosted compiler can replace the TypeScript compiler
for normal development, package builds, tests, and releases.

The comparison is about observable capability, not internal similarity. The
self-hosted compiler does not need to reproduce the TypeScript compiler's AST
shape or C++ representation when a different design has the same language and
tooling behaviour.

## Executive summary

The self-hosted compiler has crossed the bootstrap threshold: B5/B6 fixed-point
bootstrap, native compilation, test execution, coverage, and macOS/iOS package
flows are implemented. It is nevertheless not yet a drop-in replacement for
the TypeScript reference implementation.

The largest remaining gaps are:

1. **Package graph and build handoff:** declared local/remote dependencies,
   external dependency acquisition, Git/cache acquisition, pkg-config
   resolution, provenance, and `doof-build.json` are reference-only.
2. **Language surface:** `weak` references, generic constraints, catch
   expressions, yield-block bindings/reassignment, range
   patterns, and recorded mock functions/classes are not implemented as full
   self-hosted vertical slices.
3. **Reflection and JSON:** the self-host supports a useful automatic JSON
   subset, but not interface/alias dispatch, tuples and the complete reference
   serializability surface. Declaration descriptions, `.metadata`, schema
   generation, `.invoke`, `JsonSerializable`, and `Reflectable` are absent.
4. **CLI and target parity:** the self-host has no `run` command, target
   override, WebAssembly target, observer mode, class-lifecycle instrumentation,
   TypeScript-style external native flags, Windows/MSVC path, or incremental
   Reckon graph.
5. **Parity assurance:** bootstrap fixed-point comparison proves
   reproducibility of the supported slice, not equivalence with the reference
   implementation. There is no maintained differential corpus covering parse
   results, diagnostics, emitted behaviour, manifests, and CLI outcomes.

Recommendation: keep the TypeScript compiler as the release oracle until the
replacement gates near the end of this document pass. Close package acquisition
and semantic-source gaps before investing in convenience-only CLI parity.

## Scope and method

This audit used the following repository evidence:

- language and tooling contracts in `spec/` and `docs/cli.md`
- implementation ownership in `docs/source-file-structure.md`,
  `docs/type-checker-concepts.md`, and the C++ transpiler documents
- current bootstrap claims and release gates in
  `docs/selfhost-bootstrap-progress.md` and `scripts/release-gate.mjs`
- AST, semantic type, parser, checker, emitter, package, CLI, and test-runner
  source in both implementations
- focused tests in `src/*.test.ts` and `selfhost/*.test.do`

This is a static capability audit. It does not claim that every shared feature
has identical edge-case behaviour. That claim requires the differential gates
recommended below.

## What is already at parity or sufficiently covered

The following areas are not current replacement blockers:

- two-stage self-bootstrap and byte-for-byte B5/B6 generated-text stability
- lexing, parsing, module analysis, decorated-AST validation, and split C++
  emission for the compiler's own source slice
- classes, structs, interfaces, enums, nominal construction, imports,
  re-exports, namespaces, and native class/function imports used by the current
  compiler and maintained stdlib acceptance graph
- whole-program generic specialization for the supported constraint-free
  generic surface
- `Result`, declaration-`else`, `try`, checked `as`, nullable unions, tuples,
  destructuring, case expressions, loops, lambdas, and mutable closure captures
  used by the bootstrap graph
- actor construction/calls, async calls, promises, retirement, isolation
  inference, actor-boundary validation, and conservative use-after-retire checks
- demand-loaded local source graphs, explicit `--module` mappings, and
  `DOOF_STDLIB_ROOT` acquisition
- explicit native compile/link plans with bounded parallel object compilation
- test discovery, filtering/listing, per-test processes, `mock import`, and line
  coverage reports
- executable, macOS app, and iOS app build/package flows covered by the release
  fixtures, except for the limitations listed below

Some reference AST nodes are deliberately represented differently in the
self-host and are not gaps by themselves. For example, tuple annotations are
resolved from the intrinsic `Tuple<...>` named type, namespace/static accesses
share `MemberExpression`, non-null assertion is represented as postfix unary
`!`, and contextual map/object literals share one syntax node.

## Gap matrix

Priority meanings:

- **P0:** blocks credible replacement of the reference compiler
- **P1:** required for broad language/tooling compatibility
- **P2:** important operational or developer-experience parity

| Area | Confirmed gap | Evidence | Priority | Recommended acceptance check |
| --- | --- | --- | --- | --- |
| Package dependencies | The self-host manifest model has no declared local/remote dependency graph, version selection, transitive acquisition, or remote cache provider. | `src/package-manifest.ts` models `dependencies`, remote selections, cache state, and package provenance; `selfhost/package-manifest.do` models the root/reached package identity and native plan only. M5 in `docs/selfhost-module-acquisition-plan.md` is pending. | P0 | The self-host builds a root package with a local dependency, two compatible transitive remote dependencies, and a cache hit without `--module` or `DOOF_STDLIB_ROOT`; conflicting selections produce a deterministic diagnostic. |
| External dependencies | Archive/Git acquisition, integrity/ref pinning, setup commands, per-target sentinels, and target interpolation are implemented; external-dependency provenance is not yet emitted. | `selfhost/external-dependency.do` materializes vendors for root and reached packages, while self-host `provenance.json` remains part of the build-handoff gap. | P1 | Compare reference/self-host materialization and provenance for the same archive and Git fixtures. |
| Build handoff and provenance | Self-host `emit` writes generated/native files but not the reference `doof-build.json` schema or `provenance.json`. | `src/cli-core.ts` owns schema-versioned handoff/provenance; no corresponding self-host type or writer exists. | P0 | The same package emitted by both compilers produces normalized equivalent handoff and provenance documents, ignoring explicitly documented ordering/representation differences. |
| pkg-config | Package metadata is preserved, but self-host build exits with an unsupported error when `pkgConfigPackages` is non-empty. | `selfhost/driver.do`; deferred item in `docs/selfhost-module-acquisition-plan.md`. | P1 | Build a native fixture whose include/link flags come only from pkg-config; cover missing executable and missing package diagnostics. |
| Generic constraints | The self-host parser consumes a type-parameter constraint after `:` but stores only parameter names, so constraint semantics are discarded. `JsonSerializable` and `Reflectable` do not exist in the self-host semantic type model. | `parseTypeParameterNames()` in `selfhost/parser-declarations.do`; reference constraint handling in `src/checker-decl.ts`, `src/checker-expr.ts`, and `src/checker-member.ts`. | P0 | Preserve constraints in the AST and semantic model; accept valid constrained calls, reject invalid type arguments, and validate decorated concrete instantiations before emission. |
| Weak references | `weak T` is tokenized but not parsed, checked, or emitted by the self-host. | `TokenType.Weak` exists in `selfhost/lexer.do`, but `selfhost/parser-types.do` has no weak branch and `selfhost/semantic.do` has no weak resolved type. | P0 | Port weak-reference checker and native lifecycle tests, including nullable weak fields, `?.`, `!.`, destruction, and invalid weak targets. |
| Catch expressions | The `catch` token exists, but the reference `CatchExpression` AST/checker/emitter flow has no self-host equivalent. `catchPanic` is a separate builtin and does not close this gap. | `CatchExpression` in `src/ast.ts` and reference checker/emitter modules; no self-host AST node or parser path. | P1 | Port nested catch-expression, error-union aggregation, scoping, prohibited-return, and native behaviour tests. |
| Yield-block bindings | Reference `<-` value-producing block initialization/reassignment is not parsed as a self-host AST form. Self-host `yield` currently serves block case-expression arms. | Reference `YieldBlockExpression` and `YieldBlockAssignmentStatement`; self-host lexer has `LeftArrow` but its AST has neither node. | P1 | Port local initialization, reassignment, inferred/declared type, every-path-yield, global rejection, and native execution tests. |
| Range patterns | Finite range values work in the self-host, but open-ended and range `case` patterns have no dedicated representation/lowering. | Reference `RangePattern`; self-host `CasePattern` contains only type, wildcard, and value patterns. | P1 | Differential tests for `a..b`, `a..<b`, `a..`, `..<b`, exhaustiveness interaction, and invalid non-numeric bounds. |
| Recorded mocks | `mock import` works, but `mock function`, `mock class`, and typed `.calls` storage/checking/emission are absent. | Explicit limitation in `docs/testing.md`; no mock callable/class fields in the self-host AST. | P1 | Run the reference mock-function/class examples unchanged under the self-host runner, including bodyless panic and per-instance call logs. |
| Test timeouts | `DOOF_TEST_TIMEOUT_MS` is reference-runner-only. | Explicit limitation in `docs/testing.md`; self-host process wrapper has no timed execution option. | P2 | A hanging test is terminated, reported as a timeout, and does not prevent remaining isolated tests from running. |
| Declaration descriptions | The self-host discards a class description string and does not retain descriptions for functions, parameters, fields, interfaces, enums, aliases, or bindings. | Comment and token skip in `selfhost/parser-declarations.do`; description fields throughout `src/ast.ts`. | P1 | Parse and retain every form in `spec/13-descriptions.md`, emit comments, and feed the same data into metadata/schema generation. |
| Metadata/schema/invoke | `.metadata`, schema generation, method reflection, JSON invocation, and `Reflectable` are reference-only. | `src/emitter-schema.ts`, `src/emitter-metadata.ts`, and reference checker member types have no self-host equivalents. | P1 | Port the metadata/schema test families, then add native calls through class, struct, interface, generic `Reflectable`, and failure-returning methods. |
| JSON completeness | The self-host supports primitives, `JsonValue`, enums, nested non-generic classes/structs, arrays, nullable members, defaults, and lenient primitive conversion. It lacks the complete reference surface, notably tuple conversion and interface/union/type-alias deserialization dispatch; generic JSON constraints depend on the missing constraint model. | Eligibility/lowering in `selfhost/json-semantics.do` and `selfhost/emitter-json.do` versus dispatcher/tuple paths in `src/emitter-json.ts`. | P1 | A shared JSON corpus covers strict/lenient conversion, tuples, nested collections, nullable values, aliases, interfaces with discriminators, recursive values, error paths, and `JsonSerializable` generic calls. |
| CLI command/options | Self-host supports `build`, `package`, `emit`, `check`, and `test`, but not `run`; it also lacks `--target`, native include/library/object/define/flag overrides, `--std`, verbose/version, metrics instrumentation, and observer mode. | `docs/cli.md` versus `selfhost/cli.do`. | P2, except `run` is P1 | Use one table-driven CLI option contract for both implementations and differential tests for parsing, precedence over manifests, output paths, and exit codes. |
| WebAssembly | No self-host `wasm` target, Emscripten planning, `doof_wasm.cpp`, or JSON C ABI export wrappers exist. | Reference target in `src/build-targets.ts`, `src/cli-core.ts`, and `src/emitter-module.ts`; self-host target parsing accepts app targets only. | P1 if wasm remains supported | Build the maintained wasm fixture and compare exported names plus JSON call behaviour from a minimal host. |
| Incremental builds | Self-host recompiles planned objects; task boundaries exist but have no fingerprints or discovered header dependencies. | Future seam documented in `selfhost/native-build.do`; reference uses a Reckon state graph. | P2 | A no-change rebuild executes no compile/link commands; source, header, flag, compiler, runtime, and native-input changes invalidate only the required tasks. |
| Platform/toolchain coverage | Self-host planning is GCC-compatible and uses `.o`; it has no MSVC discovery/environment path. iOS explicitly rejects embedded-library bundling. | `selfhost/native-build.do`, `selfhost/driver.do`, and `selfhost/ios-app-driver.do`; reference toolchain/embedded-library support in `src/cli-core.ts` and packaging modules. | P1 for claimed supported platforms | Run equivalent Windows native and iOS embedded-library fixtures, or narrow the documented support contract until implemented. |
| Runtime/support ownership | The reference composes the checked-in runtime and optional observer assets; the self-host copies a packaged runtime resource. Required support is not described by one shared, versioned contract. | `src/emitter-runtime.ts`/`src/runtime-assets.ts` versus `selfhost/driver.do`/`selfhost/emitter-project.do`. | P1 | Introduce a versioned support-artifact plan and parity-test hashes/content for every feature combination without package-name conditionals. |
| Diagnostic parity | Both compilers produce structured diagnostics, but there is no systematic comparison of diagnostic category, location, message, and recovery count. | Differential diagnostic checks are still a next step in `docs/selfhost-bootstrap-progress.md`. | P0 | A checked-in invalid-program corpus compares normalized diagnostics and asserts that neither compiler emits after unresolved/unknown semantic state. |
| Differential coverage | Self-host unit/component and release fixtures cover the supported slice, while the much broader reference test corpus is not replayed against both compilers. | Separate `src/*.test.ts` and `selfhost/*.test.do` families; B5/B6 compares self-host output only. | P0 | Add a manifest-driven parity corpus executed by both pipelines, with explicit expected-equal, expected-different, and intentionally-unsupported classifications. |

## Recently closed gaps

Explicitly typed `Set<T>` and `ReadonlySet<T>` are now implemented as a
self-hosted vertical slice: dedicated semantic representation, primitive/enum element
validation, invariant mutable/readonly assignability, actor-boundary traversal,
generic substitution and monomorphization, ordered-set C++ lowering, and the
`has`/`add`/`delete`/`values`/`buildReadonly`/`cloneMutable` surface. The release
runtime fixture covers mutation, deduplication, freezing, copying, iteration,
and size. The B6 compiler also checks the production regex `types.do` and
`runtime.do` graph that exposes `ReadonlySet<RegexFlag>`.

Omitted collection type arguments remain a shared collection-inference gap:
unlike the reference, the self-host still requires explicit type arguments for
both `Map`/`ReadonlyMap` and `Set`/`ReadonlySet`.

## Important documentation drift

Current code is ahead of parts of `docs/selfhost-bootstrap-progress.md`:

- self-host `fromJsonValue()` now accepts the lenient argument
- nested classes, enums, arrays, and nullable arrays/classes are present in the
  JSON eligibility and emitter code
- the checker has already been split into focused statement, expression, call,
  literal, resolution, symbol, generic, interface, validation, actor-boundary,
  isolation, and lifecycle modules

The progress document still describes the older primitive-only JSON slice and
lists checker splitting as future work. Update it from this gap ledger rather
than continuing to maintain independent free-form next-step lists.

## Recommended delivery plan

### R0 — Make parity measurable

Do this before broad feature implementation.

1. Add `test/parity/manifest.json` (or equivalent) with small source/package
   fixtures and one of three expectations: `equal`, `intentional-difference`,
   or `unsupported-selfhost`.
2. Compare normalized results at five boundaries: parse success/spans,
   diagnostics, checked semantic summary, generated-project manifest, and
   native stdout/stderr/exit status.
3. Start with the overlapping bootstrap slice so the harness is green on day
   one, then convert every gap row above into a failing fixture before its
   implementation.
4. Publish parity counts in `npm run test:release`; do not use raw TypeScript
   versus Doof test counts as a coverage metric because their test granularity
   differs.

Exit criterion: every maintained fixture has an explicit classification and
new reference language/CLI features cannot land without a parity classification.

### R1 — Close semantic source-compatibility blockers

Implement vertical slices rather than parser-only acceptance:

1. preserve and validate generic constraints
2. add `weak` references
3. add catch expressions, yield-block bindings, and range patterns

Each slice must include AST, parser, analyzer where relevant, checker,
emit-readiness validation, emitter/runtime, spec confirmation, negative
diagnostics, and native execution. Do not silently accept syntax while dropping
semantics; the current discarded generic constraints are the pattern to remove.

Exit criterion: the language rows above have no `unsupported-selfhost` parity
fixtures other than an explicitly approved language deprecation.

### R2 — Complete package and native-build portability

1. implement local dependency graph loading first
2. add Git/cache resolution with deterministic version/commit selection
3. add external archive/Git dependency acquisition and provenance
4. resolve pkg-config into the explicit native plan
5. emit the versioned `doof-build.json` and `provenance.json` contracts
6. add Windows/MSVC or formally remove it from the self-host replacement scope

Keep acquisition outside the resolver: providers should return logical-prefix
to disk-root mappings, preserving the boundary already established by
`selfhost/module-acquisition.do`.

Exit criterion: representative local, remote, external-native, stdlib, and
platform packages build without self-host-only flags or environment variables.

### R3 — Complete JSON, reflection, and testing semantics

1. retain descriptions across all declarations
2. finish JSON tuples, nested collections, aliases, interface/union dispatch,
   recursive values, and path-preserving failures
3. implement `JsonSerializable` and `Reflectable` on the R1 constraint model
4. port schema, `.metadata`, and `.invoke`
5. add recorded mock functions/classes and timed test execution

Exit criterion: the reference metadata, schema, JSON, and mock examples compile
and run unchanged with equivalent observable results.

### R4 — Close user-facing CLI and target gaps

Recommended order:

1. `run` with program arguments
2. missing native option overrides and target precedence
3. WebAssembly, if it remains a supported product target
4. incremental fingerprints/header dependencies
5. metrics lifecycle instrumentation and observer assets
6. remaining iOS embedded-library and target-specific gaps

Exit criterion: the documented CLI command/option table is shared or generated
from one contract, and every supported command has differential parsing and
end-to-end fixtures.

### R5 — Replacement and retirement gate

Switch the default compiler only when all of the following are true:

- B5/B6 fixed point and all existing native release fixtures remain green
- no P0 gap remains
- every P1 gap is complete or explicitly removed from the public contract
- the parity corpus contains no unexplained difference
- the self-host builds and tests the production stdlib/package set without
  `--module` or mandatory `DOOF_STDLIB_ROOT`
- build handoff/provenance consumers accept self-host output
- clean and incremental builds pass on every claimed host platform
- a release-candidate cycle uses the self-host compiler by default with the
  TypeScript compiler retained only as a comparison oracle

After one successful release cycle, freeze the TypeScript implementation to
critical parity fixes, then remove it in a separate change. Avoid maintaining
two independently evolving language definitions.

## Ongoing maintenance rules

- Treat `spec/` and the documented CLI/manifest contracts as the compatibility
  target; treat TypeScript implementation details as evidence, not a design
  mandate.
- Add every newly discovered gap to the matrix with an owner, priority, and
  executable acceptance check.
- Update `docs/selfhost-bootstrap-progress.md` by linking to this ledger and
  reporting milestone status, not by duplicating the detailed backlog.
- Require generated-C++ compilation/runtime tests for representation changes.
- Keep the hard self-host emit-readiness boundary: unresolved types,
  decorations, constraints, or dispatch targets must stop emission.
- Do not count a feature as complete when only syntax is accepted or when the
  emitter recovers with a guessed C++ value.
