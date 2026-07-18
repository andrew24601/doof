# Reference and Self-Hosted Compiler Gap Analysis

Status date: 2026-07-18

## Purpose

This document compares the observable capability of the TypeScript reference
implementation in `src/` with the self-hosted implementation in `selfhost/`.
It tracks only the work that still matters before the self-hosted compiler can
replace the TypeScript compiler for normal development, package builds, tests,
and releases.

Equivalent behaviour is the target. The self-host does not need the same AST,
semantic types, C++ representation, or internal module boundaries as the
reference compiler.

## Executive summary

The self-hosted compiler is a working compiler and toolchain, not a bootstrap
prototype. It passes the B5/B6 fixed point, builds and runs native programs,
tests Doof packages with coverage, acquires manifest-declared external vendor
trees, and supports executable, macOS, iOS, and WebAssembly targets. Recent
work also closed the previously recorded gaps for weak references, range case
patterns, catch expressions, yield blocks, destructuring, direct reflection,
`Reflectable`, and `run`.

It is not yet a drop-in replacement. The remaining replacement blockers are:

1. **Doof package acquisition:** manifest-declared local and remote Doof
   dependencies, transitive version selection, cache acquisition, and remote
   stdlib fallback remain reference-only.
2. **External build contracts:** the self-host does not emit the reference
   `doof-build.json` or `provenance.json`.
3. **Language compatibility:** same-site inference for omitted `Map`/`Set` type
   arguments now covers value bindings, but parameter and field defaults are
   still missing.
4. **Parity assurance:** the release fixed point proves reproducibility of the
   self-hosted slice, not equivalence with the reference compiler. There is no
   maintained differential corpus for diagnostics, generated projects,
   manifests, or runtime outcomes.

The most efficient path is to make parity measurable, then complete Doof
package acquisition and external build handoff. JSON/reflection breadth,
recorded mocks, CLI convenience options, and incremental builds follow behind
those replacement gates.

## Scope and method

This audit uses the repository state at the status date, including:

- language contracts in `spec/` and tooling contracts in `docs/cli.md`,
  `docs/packages.md`, and `docs/testing.md`
- the TypeScript and Doof AST, analyzer, checker, emitter, package, CLI,
  build, test-runner, and platform-driver implementations
- focused tests in `src/*.test.ts` and `selfhost/*.test.do`
- `docs/selfhost-bootstrap-progress.md`,
  `docs/selfhost-module-acquisition-plan.md`, and
  `scripts/release-gate.mjs`

This is a static capability audit. A feature is counted as closed when the
self-host has a tested vertical slice through parsing, analysis/checking,
emission or tooling, and the relevant observable result. Static inspection
cannot establish identical edge-case behaviour; the differential gates below
are intended to do that.

## Capability baseline

The following areas are implemented well enough that they are not current
replacement gaps:

- B5/B6 two-stage bootstrap and byte-for-byte generated-text stability
- demand-loaded module graphs, relative imports, re-exports, namespaces,
  explicit `--module` mappings, and `DOOF_STDLIB_ROOT` acquisition
- classes, structs, interfaces, enums, aliases, native imports, general generic
  constraints, and whole-program monomorphization
- `Result`, declaration-`else`, `try`, checked `as`, nullable unions, tuples,
  arrays, maps, explicitly typed sets, destructuring, loops, lambdas, and
  escaping mutable captures used by the maintained source graph
- weak references across parser, checker, generic substitution, header
  planning, and `std::weak_ptr` lowering
- finite, half-open, lower-open, and upper-open range case patterns in case
  statements and expressions
- catch expressions and value-producing `<-` blocks, including nested error
  collection and mutable reassignment
- actors, promises, synchronous and asynchronous actor calls, retirement,
  isolation inference, boundary validation, and use-after-retire checks
- automatic JSON for the supported non-generic nominal subset, including
  primitives, `JsonValue`, enums, nested classes/structs, arrays, nullable
  members, defaults, and lenient primitive conversion
- direct non-generic class/struct `.metadata`, JSON Schema, method reflection,
  name-based `.invoke`, and generic access through `T: Reflectable`
- checksum/ref-pinned external archive and Git dependency acquisition for root
  and reached packages, including setup commands and target-specific sentinels
- `emit`, `check`, `build`, `run`, `package`, and `test`
- native executable, macOS app, iOS simulator/device, and WebAssembly library
  planning and generation covered by the maintained fixtures
- recursive test discovery, filtering/listing, process isolation,
  `mock import`, and line coverage reports

Different representations are not gaps by themselves. Examples include tuple
annotations resolved through intrinsic `Tuple<...>`, namespace/static access
sharing member-expression machinery, postfix `!` represented as a unary node,
and map/object literals sharing a syntax node under contextual typing.

## Current gap matrix

Priority meanings:

- **P0:** blocks credible replacement of the reference compiler
- **P1:** required for broad language, package, or target compatibility
- **P2:** operational or developer-experience parity

| Area | Current gap and evidence | Priority | Acceptance check |
| --- | --- | --- | --- |
| Doof package dependencies | `selfhost/package-manifest.do` models root/reached identities, native inputs, and external vendor dependencies, but not the reference manifest's declared local/remote Doof dependency graph. M5 in `docs/selfhost-module-acquisition-plan.md` remains pending. | P0 | Build a root package with a local dependency and compatible transitive remote dependencies without `--module` or `DOOF_STDLIB_ROOT`; verify cache hit/miss behaviour and deterministic conflict diagnostics. |
| Remote stdlib/package acquisition | The acquisition boundary accepts arbitrary logical-prefix mappings, but the driver has no Git/cache provider or normal remote stdlib fallback. `DOOF_STDLIB_ROOT` is still required for implicit `std/*` discovery. | P0 | The same package builds from a clean cache, a warm cache, and an explicit local stdlib override, with identical selected package identities. |
| Build handoff and provenance | Self-host `emit` materializes generated and native inputs but does not write the schema-versioned `doof-build.json` or `provenance.json` produced by `src/cli-core.ts`. External vendor acquisition therefore also lacks emitted provenance. | P0 | Normalize and compare both documents for local, remote, external-native, resource, macOS, iOS, and wasm fixtures. External build consumers must accept either compiler's output unchanged. |
| Collection type inference | Omitted `Map`, `ReadonlyMap`, `Set`, and `ReadonlySet` type arguments are not inferred from same-site non-empty homogeneous literals in the self-host. | P1 | Port the specification examples and negative cases for empty, heterogeneous, non-literal, and type-only positions. |
| JSON breadth | The self-host automatic JSON eligibility/lowering lacks tuples, interface discriminator dispatch, and general non-null union dispatch. Map support is limited to serialization of `Map<string, JsonValue>`. `JsonSerializable` generic access exists, but it inherits this narrower concrete eligibility surface. | P1 | Run a shared JSON corpus for tuples, nested collections, interfaces, aliases resolving to dispatchable types, recursive values, nullable values, strict/lenient conversion, defaults, and path-preserving failures. |
| Interface reflection | Direct nominal metadata and `T: Reflectable` are implemented. The reference can resolve `.metadata` through a closed-world interface to its implementing class metadata; the self-host interface member path has no corresponding metadata branch. | P1 | Access metadata and invoke methods through interfaces with one and multiple implementors; compare the resulting metadata union, validation failures, and dispatch behaviour. |
| Recorded mocks | `mock import` works, but `mock function`, `mock class`, bodyless mock panic behaviour, and typed per-call `.calls` storage are absent from the self-host AST/checker/emitter. | P1 | Run the examples in `docs/testing.md` unchanged, including exported mocks, per-instance call logs, argument field typing, and rejected generic/static forms. |
| Test and run timeouts | The self-host process boundary has no equivalent of `DOOF_TEST_TIMEOUT_MS`; it also does not implement the reference `DOOF_RUN_TIMEOUT_MS` termination behaviour. | P2 | Terminate hanging tests/programs, report a stable timeout diagnostic, preserve the requested exit behaviour, and continue with remaining isolated tests. |
| CLI option parity | Core commands, target override, signing options, coverage, and program-argument forwarding exist. Missing reference options include C++ standard and native input overrides, metrics lifecycle instrumentation, observer mode, verbose output, and version reporting. | P2 | Drive both parsers from a shared option table and compare option precedence, manifest merging, output paths, diagnostics, and exit codes. |
| Incremental native builds | Self-host compilation has explicit object tasks and bounded parallelism but no fingerprints, persisted task graph, or discovered header dependencies. A no-change build recompiles. | P2 | A no-change build runs no compile/link commands; source, header, flags, compiler, runtime, native inputs, and target changes invalidate only affected tasks. |
| Windows/MSVC | The self-host native planner is GCC-compatible and object naming assumes `.o`; it has no Visual Studio discovery/environment setup equivalent to the reference CLI. | P1 for Windows support | Run the same native/package fixtures under MSVC, or explicitly exclude Windows from the initial replacement support contract. |
| iOS embedded libraries | `selfhost/ios-app-driver.do` explicitly rejects embedded-library bundling, while the reference packaging path supports declared dylibs/frameworks. | P1 for iOS package parity | Package and run a device fixture with an embedded framework and dylib, including Mach-O rewriting, signing order, verification, and IPA contents. |
| Runtime/support contract | The self-host now reports manifest-owned support files through an explicit project plan and consumes a packaged canonical runtime. The two compilers still do not share a versioned contract that proves the same runtime/support artifacts are selected for each feature/target combination. | P1 | Introduce a versioned support-artifact plan and compare normalized paths plus content hashes across compilers for native, observer, stdlib-native, app, and wasm fixtures. |
| Diagnostic parity | Both implementations collect structured diagnostics, but there is no systematic comparison of category, severity, span, message, recovery count, or the point at which emission is suppressed. | P0 | A checked-in invalid-program corpus compares normalized diagnostics and asserts that neither compiler emits after unresolved types, decorations, constraints, or dispatch targets. |
| Differential coverage | TypeScript tests, self-host tests, and B5/B6 bootstrap gates exercise different corpora. Fixed-point equality does not compare the self-host against the reference compiler. | P0 | Add a manifest-driven corpus with `equal`, `intentional-difference`, and `unsupported-selfhost` classifications at parse, check, emit, manifest, native runtime, and CLI boundaries. Publish counts in the release gate. |

## Gaps closed since the previous audit

The previous version of this document was written before several self-hosted
vertical slices landed. These are no longer backlog items:

- `weak T` parsing, checking, substitution, validation, header planning, and
  C++ lowering
- all specified range-pattern shapes in case statements and expressions
- catch expressions and value-producing `<-` declaration/reassignment blocks
- positional, array, and named destructuring declarations/assignments,
  including `try` success payloads
- declaration descriptions and direct class/struct metadata, schema, method
  reflection, and invocation
- preservation and use of the compiler-known `Reflectable` constraint
- full generic constraint annotations, including ordinary named and union
  constraints, with enforcement for explicit and inferred function/class
  arguments and concrete interface/type-alias instantiations
- WebAssembly target planning, C ABI wrapper generation, native support
  materialization, and the maintained Node-hosted acceptance sample
- external archive/Git vendor acquisition with checksum/ref validation,
  interpolation, setup commands, and cache sentinels
- pkg-config resolution into structured include paths, library paths, link
  libraries, frameworks, defines, and compiler/linker flags, with actionable
  executable and package lookup failures
- `run` for native programs and Apple app targets, including program arguments,
  iOS device selection, provisioning resolution, installation, and launch

Direct nominal reflection does not close the interface-qualified reflection
row.

## Recommended delivery plan

### R0 — Make parity measurable

1. Add a small manifest-driven parity corpus with `equal`,
   `intentional-difference`, and `unsupported-selfhost` classifications.
2. Compare normalized results at six boundaries: parse/spans, diagnostics,
   checked semantic summaries, emitted project files, build/provenance
   manifests, and native stdout/stderr/exit status.
3. Seed it with the overlapping bootstrap and release-fixture slice so it is
   green immediately, then add a failing fixture before closing each row.
4. Publish classified totals from the release gate. Raw TypeScript and Doof
   test counts are not comparable coverage measures.

Exit criterion: every maintained fixture has an explicit classification, and
new reference language or CLI behaviour cannot land without one.

### R1 — Complete package resolution and build handoff

1. Load manifest-declared local Doof dependencies.
2. Add deterministic Git/cache acquisition and transitive version selection,
   including remote stdlib fallback.
3. Emit `provenance.json` for Doof and external vendor dependencies.
4. Emit the versioned `doof-build.json` contract from the self-host project
   plan.
5. Preserve resolved pkg-config inputs in that same explicit build handoff.

Keep acquisition outside the resolver: providers should continue returning
logical-prefix-to-disk-root mappings through `module-acquisition.do`.

Exit criterion: representative local, remote, external-native, resource, and
stdlib packages build without self-host-only mappings or environment variables,
and external build tools consume the emitted handoff unchanged.

### R2 — Close remaining source-compatibility gaps

1. Add omitted collection type-argument inference.
2. Complete tuple, interface, collection, and union JSON behaviour.
3. Add interface-qualified metadata dispatch.
4. Implement recorded mock functions/classes and timed process execution.

Each language slice must include parser, analyzer where relevant, checker,
emit-readiness validation, emitter/runtime, negative diagnostics, and native
execution. Syntax acceptance without preserved semantics is not completion.

Exit criterion: the corresponding specification and documentation examples run
unchanged under both compilers, with no unapproved unsupported parity fixture.

### R3 — Close platform and operational gaps

1. Decide and enforce the initial Windows support contract; implement MSVC if
   Windows remains in scope.
2. Add iOS embedded-library packaging.
3. Share and version the runtime/support-artifact plan.
4. Add incremental fingerprints and discovered header dependencies.
5. Add remaining native CLI overrides, metrics instrumentation, observer mode,
   verbosity, version, and timeout behaviour.

Exit criterion: clean and incremental builds pass on every claimed host/target,
and the documented CLI matrix has differential parser and end-to-end coverage.

### R4 — Replacement and retirement gate

Switch the default compiler only when:

- B5/B6 and every maintained native/platform release fixture remain green
- no P0 row remains
- every P1 row is complete or explicitly removed from the supported contract
- the parity corpus contains no unexplained difference
- production stdlib/packages build without mandatory `--module` mappings or
  `DOOF_STDLIB_ROOT`
- external build consumers accept self-host `doof-build.json` and provenance
- clean builds pass on every claimed platform, with incremental behaviour
  either complete or explicitly deferred as non-blocking
- one release-candidate cycle uses the self-host by default while the
  TypeScript compiler remains a comparison oracle

After a successful release cycle, freeze the TypeScript implementation to
critical parity fixes and remove it in a separate change. Do not continue two
independently evolving language definitions.

## Maintenance rules

- Treat `spec/` plus documented CLI/package contracts as authoritative;
  TypeScript implementation details are evidence, not a design mandate.
- Add newly discovered gaps with a priority and executable acceptance check.
- Keep detailed backlog in this ledger; the bootstrap progress document should
  summarize milestones and link here rather than duplicate free-form lists.
- Require generated-C++ compile/runtime coverage for representation changes.
- Keep the hard self-host emit-readiness boundary: unresolved types,
  decorations, constraints, or dispatch targets must stop emission.
- Do not count syntax-only support or emitter recovery with a guessed value as
  feature completion.
