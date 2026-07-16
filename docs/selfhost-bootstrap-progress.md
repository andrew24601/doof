# Self-Hosted Compiler Bootstrap Progress

Status date: 2026-07-15

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
resolver, analyzer, checker, C++ emitter, compiler CLI/driver, and native class
interop are implemented in Doof. Bootstrap is verified by the dedicated release
gate rather than by subverting the unit-test runner. The generated compiler can
rebuild the complete self-hosted source graph and run generated programs.

The bootstrap is complete for the current self-hosted language slice. The
self-hosted checker and emitter now include the intrinsic `JsonValue` carrier,
ordered JSON object/array lowering, native function-import syntax, and
generated `toJsonObject()` support. Non-generic classes and structs whose
instance fields are primitives, `JsonValue`, or nullable primitives now also
receive strict `fromJsonValue()` generation with required-field checks,
defaults, field-specific type failures, and value/reference-correct `Result`
payloads. The optional lenient argument remains outside this strict slice.
Array and string `contains` / `indexOf`
calls now use the canonical runtime helpers, and declaration-`else` supports
typed bindings, failure capture, nullable narrowing, discard handlers, and
handler-exit validation. Escaping lambdas now preserve mutable
captures through shared heap boxes while retaining actor-affine
`doof::callback` wrappers. The generated CLI can now discover a
project root, read `doof.json`, apply `build.entry` and `build.buildDir`, and
load package-local `.do` sources. Acquired `std/*` packages now register their
identity and normalized host-platform `build.native` inputs on first use. It is
not yet feature-complete with the TypeScript compiler; full `fromJsonValue()`
validation/dispatch and remote stdlib acquisition remain planned.

### Verified recovery and current concerns

The 2026-07-13 recovery pass restored the self-hosting path after the
expression emitter split and production stdlib expansion. It removed stale
module-count assumptions, enabled definite-return diagnostics (including
unconditional-loop handling), preserved contextual array element types across
class construction and function-call boundaries, and materialized the native
JSON/filesystem/path/blob support required by the generated compiler. The
complete source graph and native acceptance scenarios are green again.

The passing bootstrap is now guarded by an explicit front-end completeness
boundary. `selfhost/compiler.do` checks dependencies, validates the complete
decorated AST, and returns no emission when any `UnknownType` or missing
decoration is found, including nested generic arguments. The self-hosted
emitter consumes resolved types and checker-attached declaration targets without
performing semantic lookups or raw-annotation resolution. Generic class and
method parameters, generic stream members, and native `Result` methods are
covered by focused checker regressions; the production std/fs graph passes the
same gate and native end-to-end check.

The completeness walk includes `with` binding types, both sides of checked
`as` narrowing, and class-construction type, class, and dedicated-constructor
attachments. Constructor factory bodies retain their intentional
direct-allocation exception while all external construction sites must identify
the factory target.

The 2026-07-14 macOS HTTP pass added readonly array literals, explicit generic
positional and named calls, generic native declarations, tuple substitution and
destructuring, and header-visible C++ templates. The generated driver now
checks and builds the complete `std/http` barrel used by
`samples/http-client`, including WebSocket, event, time, blob, stream, and JSON
dependencies. Native type aliases are derived from resolved extern signatures,
including re-exported types, and package-relative generated headers are
forwarding wrappers to one canonical header rather than duplicate definitions.
The macOS manifest selects the Objective-C++ backend and Foundation without
curl or pkg-config inputs. A deterministic localhost runtime binary is always
built; execution is enabled with `DOOF_HTTP_RUNTIME_TEST=1` on hosts that permit
loopback sockets.

The self-hosted native build now compiles generated and manifest-owned sources
to explicit object tasks distributed across at most eight temporary actors,
then links only after every batch succeeds. Each actor runs its assigned tasks
serially, bounding native process concurrency. The plan records source and object paths so
incremental fingerprints and discovered header dependencies can be added at
the task boundary later. Clang's generated C++ PCH is attached only to generated
`.cpp` tasks, fixing the macOS HTTP build where the Objective-C++ frontend
rejected a `c++-header` PCH. The runtime process helper uses `posix_spawnp` on
POSIX hosts so actor-threaded compiler launches are safe.

Release self-bootstrap also retains computed `for-of` iterable owners in named
C++ temporaries. Previously the self-hosted emitter dereferenced a temporary
`shared_ptr` directly in a range-for; `-O2` could destroy the owner before
iteration, skip every compile batch, and proceed to a link containing only
missing object paths. The release gate gives each run unique seed, B5, and B6
output directories so stale objects cannot mask missing compile execution.

The release gate follows those same discovery boundaries. The TypeScript CLI
builds the seed through its production parallel graph, and the B5 and B6
compilers rebuild the driver through the generated `build` command with
`DOOF_STDLIB_ROOT` acquisition and manifest-owned native inputs. B5 and B6
generated text artifacts must match byte-for-byte.

Remaining architectural risks are:

- Reached stdlib manifests produce an explicit normalized native plan, and the
  project emitter materializes its support files without package-name branches.
- The self-hosted resolver now loads and caches only transitively reached
  sources through a loader callback. The CLI maps local and explicit external
  sources plus acquired logical-prefix roots on demand; `DOOF_STDLIB_ROOT`
  currently supplies the `/std` acquisition. Reached package identity and
  native manifest semantics are tracked, while declared package dependencies
  and remote acquisition are not yet aligned with the TypeScript compiler;
  progress is tracked in
  [selfhost-module-acquisition-plan.md](selfhost-module-acquisition-plan.md).
- Actor boundary and lifecycle validation now live in focused checker modules;
  further checker feature work should continue extracting similarly cohesive
  ownership boundaries from `selfhost/checker.do`.

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

The self-hosted front end accepts explicit typed lambdas, including return
annotations such as `(path: string): SourceFile | null => ...`. Its compiler
boundary converts parser failures into structured diagnostics, and the test
runner renders root test-file parse errors with the path, line, column, source
line, and caret. Built-in `SourceLocation`, `@caller`, `assert`, and
`catchPanic` are available to self-hosted standard-library graphs; generic
methods on non-generic classes lower as inline C++ member templates.

Completed language/emitter coverage includes nominal classes, named
construction, enums, aliases, nullable AST unions, branch-aware checking,
actor construction, synchronous and asynchronous actor calls, promises,
retirement, actor-call boundary safety, and conservative use-after-retire checks,
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
doof-selfhost build path/to/package
doof-selfhost package path/to/package
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
Failure construction). Declaration-`else` preserves the full subject or
captured failure payload inside its handler and exposes only the narrowed value
after a handler that cannot complete normally; `_ := ... else` remains a
non-binding acknowledgement form. Focused gates compile the real
`std/json/index.do` and
syntax-check generated code against `native_json.hpp`; the duplicate manifest
parser has been removed from both runtimes. The project and driver modules now
use `std/fs`, `std/path`, and `std/os` for host services. Process spawning uses
the standard library's thread-safe POSIX boundary with bounded capture, so the
parallel compiler actors no longer require private runtime command helpers. The self-hosted
checker now analyzes, type-checks, and emits the production `std/fs`,
`std/path`, `std/os`, `std/stream`, and `std/blob` source slice, including its `Stream<T>`
and generic declarations. Doof-defined generics are now discovered to a
whole-program fixed point and emitted as ordinary concrete C++ declarations;
concrete generic interfaces, including `Stream<int>` and `Stream<string>`,
receive independent closed-world variants. Generic native imports emit
module-owned concrete adapters that rely on C++ overload resolution or template
deduction. The bootstrap still supplies a focused `std/time` fixture.
`DOOF_STDLIB_ROOT` provides JSON
and filesystem native-support discovery without reintroducing private JSON or
file-I/O implementations.
When the entry is a package directory, the driver walks upward to `doof.json`,
uses `build.entry` (defaulting to `main.do`) and `build.buildDir` (defaulting to
`build`), and loads only package-local `.do` files reached by imports. `-o`
still overrides the output directory. Emission writes one `<module>.hpp` /
`<module>.cpp` pair per source module plus `doof_runtime.hpp`. The root manifest
packages canonical `doof_runtime.h` beside the compiler, and the driver reads it
through the standard executable-resource directory; `DOOF_RUNTIME_HEADER`
remains a development override. Self-hosted build/package parsing and
materialization also preserve root-package executable resources. Reached
acquired-package manifests now register normalized native
build inputs. The project emitter materializes those inputs and the self-hosted
`build` command compiles generated plus native sources with package-stable
namespaces, including host frameworks and root-project settings. It now parses
compact and nested `macos-app` metadata and assembles an ad-hoc-signed `.app`
with generated plist metadata, icons, app resources, and explicit embedded
dynamic libraries whose Mach-O references are rewritten and validated. The self-hosted
`package` command materializes its independent release graph under
`<buildDir>/release`, prepends `-O2` and `NDEBUG` before package compiler flags,
and either links a plain executable into `dist/` or signs, verifies, and zips a
macOS app using manifest/CLI release settings. With `package`, `-o` overrides
the build-state root; `--distdir` or `build.package.distDir` selects the artifact
directory. Declared
package dependencies, pkg-config resolution, and remote stdlib fallback remain
future CLI layers.

The runnable driver also implements `test` with the TypeScript runner's static
test convention: recursive `*.test.do` discovery (stopping at nested package
manifests), exported `test*` signature validation, case-insensitive filtering,
listing, a separate generated harness/build per test file, and isolated process
execution per test. Each harness uses the existing native compile planner, so
multi-module test graphs build the runtime PCH once and compile translation
units across the bounded worker batches. Root-scoped `mock import` rewriting
matches the TypeScript analyzer using exact source-module and dependency specifiers.
Recorded mock functions/classes, coverage collection, captured child output,
and configurable test timeouts remain follow-up work.

## Verification

The maintained verification gates are:

- `npm run build`
- `npm test` — 2244 TypeScript tests passing
- `npm run test:selfhost` — focused Doof-native unit and component tests
- `npm run test:selfhost:coverage` — the same suite with Doof line coverage
- `npm run test:release` — seed/B5/B6 bootstrap, fixed-point comparison, and
  portable plus platform-specific native acceptance fixtures

Focused self-host tests remain deterministic and do not invoke toolchains or
subprocesses. Native representation and runtime behavior belong to the release
gate, which is a periodic pre-release check rather than the primary edit loop.

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
4. **Complete JSON deserialization parity.** Extend the strict primitive
   class/struct slice with nested values and collections, then add lenient
   conversion, interface/union dispatch, and native `std/json` support-file
   materialization.
5. **Complete package-aware module loading.** Resolve package identity and
   dependency manifests, then align generated namespaces with the TypeScript
   compiler's package-relative rules.
6. **Close remaining native interop gaps.** Validate native build handoff
   behavior against representative headers, libraries, and exported interop
   modules.
7. **Expand source-graph coverage.** Maintain a parser/analyzer/checker/emitter/
   runtime parity matrix, then add each missing feature as a tested vertical
   slice with diagnostics and native behavior checks.
8. **Strengthen parity and release confidence.** Extend the release gate's
   fixed-point comparison with repeatable differential checks for diagnostics.

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
