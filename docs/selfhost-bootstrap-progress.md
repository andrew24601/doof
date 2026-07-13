# Self-Hosted Compiler Bootstrap Progress

Status date: 2026-07-13

This document tracks the path from the Doof implementation of the compiler to
a compiler that can rebuild itself. The TypeScript compiler remains the
bootstrap implementation; the self-hosted compiler is the long-term target.

## Definition of self-hosting

Self-hosting is complete when the self-hosted implementation can:

1. Accept the compiler's `.do` source graph and entry module.
2. Resolve, analyze, and check that graph without TypeScript.
3. Emit compilable C++ for the graph, including headers, sources, runtime, and
   the executable entry point.
4. Build and run the generated compiler.
5. Use that generated compiler to repeat the process successfully.

Unit tests alone do not establish self-hosting.

## Current status

The B6 two-stage bootstrap is complete. The self-hosted lexer, parser,
resolver, analyzer, checker, C++ emitter, compiler CLI/driver, native class
interop, and bootstrap tests are implemented in Doof. The generated compiler
can rebuild the complete self-hosted source graph and run a generated
multi-module program.

The bootstrap is complete for the current self-hosted language slice. The
self-hosted checker and emitter now include the intrinsic `JsonValue` carrier,
ordered JSON object/array lowering, native function-import syntax, and
generated `toJsonObject()` support. The generated CLI can now discover a
project root, read `doof.json`, apply `build.entry` and `build.buildDir`, and
load package-local `.do` sources. It is not yet feature-complete with the
TypeScript compiler; full `fromJsonValue()` validation/dispatch and automatic
stdlib dependency resolution remain planned.

### Verified recovery and current concerns

The 2026-07-13 recovery pass restored all maintained B3-B6 gates after the
expression emitter split and production stdlib expansion. It removed stale
module-count assumptions, enabled definite-return diagnostics (including
unconditional-loop handling), preserved contextual array element types across
class construction and function-call boundaries, and materialized the native
JSON/filesystem/path/blob support required by the generated compiler. The
TypeScript bootstrap inventory and the three self-hosted bootstrap acceptance
tests are green again.

The passing bootstrap is now guarded by an explicit front-end completeness
boundary. `selfhost/compiler.do` checks dependencies, validates the complete
decorated AST, and returns no emission when any `UnknownType` or missing
decoration is found, including nested generic arguments. The self-hosted
emitter consumes resolved types and checker-attached declaration targets without
performing semantic lookups or raw-annotation resolution. Generic class and
method parameters, generic stream members, and native `Result` methods are
covered by focused checker regressions; the production std/fs graph passes the
same gate and native end-to-end check.

Remaining architectural risks are:

- Native stdlib support is currently discovered from emitted logical module
  paths. The emitter should eventually return explicit required-support
  metadata instead of making the driver infer files from names.
- The self-hosted resolver now loads and caches only transitively reached
  sources through a loader callback. The CLI maps local, explicit external,
  and stdlib roots on demand; package identity and dependency-manifest
  semantics are not yet aligned with the TypeScript compiler.
- `selfhost/checker.do` remains large enough that new feature work should first
  extract focused checker modules matching the ownership boundaries used by the
  TypeScript implementation.

## Completed milestones

| ID | Milestone | Acceptance check | Status |
| --- | --- | --- | --- |
| B0 | Emitter core | Native emitter tests compile and pass | Complete |
| B1 | Nominal declarations | Emit and compile `selfhost/ast.do` and `selfhost/semantic.do` | Complete |
| B2 | Rich core lowering | Emit parser/checker modules with loops, methods, construction, and collections | Complete |
| B3 | Module graph | Emit split modules with stable namespaces, includes, forward declarations, and imports | Complete |
| B4 | Compiler driver | Generated compiler accepts source files and writes generated C++ | Complete |
| B4a | Minimal compiler CLI | Generated compiler exposes `emit` and `check` commands with a reusable option parser | Complete |
| B5 | First bootstrap | Generated compiler builds the self-hosted source graph and runs a smoke test | Complete |
| B6 | Two-stage bootstrap | The B5 compiler rebuilds the same graph and runs a second smoke test | Complete |

Completed language/emitter coverage includes nominal classes, named
construction, enums, aliases, nullable AST unions, branch-aware checking,
cross-module imports and re-exports, native C++ class imports, and focused
native C++ compilation tests.

### Self-hosted CLI and project specs

The generated driver currently supports source-graph checking and split C++
emission:

```sh
doof-selfhost check main.do --source math.do
doof-selfhost emit main.do -o build --source math.do
doof-selfhost check path/to/package
doof-selfhost emit path/to/package
```

`--source` is repeatable for explicit source files used by relative imports. A
bare/external import can be provided explicitly with `--module <specifier>
<path>`:

```sh
doof-selfhost check main.do --module hello-doof/math vendor/math.do
```

This maps the logical import `hello-doof/math` to the supplied source file.
When `DOOF_STDLIB_ROOT` is set, the loader maps requested `std/<package>/`
modules to `<DOOF_STDLIB_ROOT>/<package>/` on demand. Package imports use
`index.do` as their barrel when present; explicit `--module` mappings take
precedence.

The self-hosted front end now parses and emits the source constructs used by
`std/json` (try bindings, Result case arms, declaration-else, and Success/
Failure construction). Focused gates compile the real `std/json/index.do` and
syntax-check generated code against `native_json.hpp`; the duplicate manifest
parser has been removed from both runtimes. The project and driver modules now
use the `std/fs`-shaped `readText` / `writeText` surface. The self-hosted
checker now analyzes, type-checks, and emits the production `std/fs`,
`std/path`, `std/stream`, and `std/blob` source slice, including its `Stream<T>`
and generic declarations. The bootstrap still supplies a focused `std/time`
fixture, and general-purpose generic specialization remains incomplete beyond
the instantiations exercised by this graph. `DOOF_STDLIB_ROOT` provides JSON
and filesystem native-support discovery without reintroducing private JSON or
file-I/O implementations.
When the entry is a package directory, the driver walks upward to `doof.json`,
uses `build.entry` (defaulting to `main.do`) and `build.buildDir` (defaulting to
`build`), and loads only package-local `.do` files reached by imports. `-o`
still overrides the output directory. Emission writes one `<module>.hpp` /
`<module>.cpp` pair per source module plus `doof_runtime.hpp`. The runtime is
copied verbatim from the canonical `doof_runtime.h` used to build the compiler;
`DOOF_RUNTIME_HEADER` can override that asset path when a compiler binary is
relocated. Package identity, dependency manifests, and remote stdlib fallback
remain future CLI layers.

## Verification

The maintained verification gates are:

- `npm run build`
- `npm test` — 2243 TypeScript tests passing
- `doof test selfhost/compiler.test.do` — focused compiler/emitter tests,
  including real `std/json` source and native-support gates
- `DOOF_TEST_TIMEOUT_MS=120000 doof test selfhost/bootstrap.test.do` — three B3–B6 acceptance tests,
  including the two-stage bootstrap
- `src/selfhost-bootstrap.test.ts` — TypeScript-bootstrap native compilation
  of the self-hosted source graph

Focused self-host tests should remain small and should compile generated C++
when the behavior depends on C++ representation. The full bootstrap remains a
periodic integration check rather than the primary edit loop.

## Next steps

Work through these in order, keeping all existing gates green after each step:

1. **Extend semantic completeness.** Expand explicit type-parameter substitution
   and graph-wide validation across the remaining language surface, keeping any
   unresolved or unknown type as a pre-emission diagnostic rather than an
   emitter recovery case.
2. **Unify runtime and support planning.** Give runtime generation one owner,
   make the emitter report required native/support artifacts explicitly, and
   add parity tests between TypeScript and self-hosted generated support.
3. **Split the checker.** Extract statement, declaration, control-flow, member,
   Result, and generic responsibilities before expanding the supported language
   surface further.
4. **Complete JSON deserialization parity.** Add self-hosted `fromJsonValue()`
   field validation, lenient conversion, interface/union dispatch, and native
   `std/json` support-file materialization.
5. **Complete package-aware module loading.** Resolve package identity and
   dependency manifests, then align generated namespaces with the TypeScript
   compiler's package-relative rules.
6. **Close remaining native interop gaps.** Validate native build handoff
   behavior against representative headers, libraries, and exported interop
   modules.
7. **Expand source-graph coverage.** Maintain a parser/analyzer/checker/emitter/
   runtime parity matrix, then add each missing feature as a tested vertical
   slice with diagnostics and native behavior checks.
8. **Strengthen parity and release confidence.** Add repeatable differential
   checks for diagnostics and generated artifacts, then make the two-stage
   bootstrap a required pre-release gate.

## Design constraints

- Keep parser, analyzer, checker, and emitter responsibilities separate.
- Keep emitter files focused and split modules before they become difficult to
  test or review.
- Treat decorated AST nodes as the emitter's semantic input.
- Prefer generated-C++ compilation tests over string-only assertions for new
  lowering behavior.
- Use the TypeScript compiler for behavioral reference, not as a requirement
  to copy every C++ representation choice.
- DO NOT DO HEURISTIC PATCHING. Correctness is more important than quick gains.
