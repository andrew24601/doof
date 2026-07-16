# Doof C++ Transpiler Architecture

This document describes the current Phase 4 compiler architecture: how the checked Doof program is turned into generated C++ source, headers, runtime support files, and build metadata.

For the repository map, see [source-file-structure.md](./source-file-structure.md). For concept-by-concept lowering details, see [cpp-transpilation-concepts.md](./cpp-transpilation-concepts.md).

## Scope and Inputs

The emitter runs after parsing, module analysis, and type checking.

- Parsing produces the AST in `src/ast.ts`
- Analysis resolves module symbols and decorates `NamedType` nodes
- Type checking decorates expressions, bindings, declarations, and type-bearing nodes with semantic information

The emitter relies on that decorated AST directly. It does not rebuild type tables during emission.

### Self-Hosted Pre-Emission Contract

The self-hosted compiler makes this boundary explicit in `selfhost/compiler.do`:
it checks the complete analyzed module graph, then runs
`validateCheckedTypes(...)` before calling the module emitter. The validator
walks declarations, annotations, bindings, patterns, and expressions,
including nested generic arguments. Any missing decoration or `UnknownType`
produces diagnostics and the compilation has no emission result.

The self-hosted emitter therefore consumes resolved types and checker-attached
declaration targets (`resolvedFunction`, `resolvedConstructor`,
`resolvedClass`, and `resolvedStaticOwner`). It does not scan declarations,
resolve raw type annotations, or recover from unknown types while rendering.
Construction lowering additionally panics if its constructed-type or dedicated
constructor attachment is absent, or if a non-defaulted field reaches emission
without a value; it never synthesizes plausible default-initialized C++ for
those checker invariant failures.
Module import planning remains an output-layout concern; semantic lookup and
validation belong entirely to analysis and checking.

## Self-Hosted Emitter Foundation

The self-hosted compiler is beginning its own C++ emitter under `selfhost/`.
It uses the TypeScript emitter as a source of tested behavior and architectural
clues, but its C++ representation policy is intentionally independent.

The initial slice is split into small modules:

- `selfhost/emitter-context.do` owns nominal declarations, current method-owner context, and per-module coverage instrumentation state
- `selfhost/emitter-monomorphize.do` owns whole-program fixed-point discovery of concrete Doof generic instantiations and native adapters
- `selfhost/emitter-types.do` owns resolved-type representation choices
- `selfhost/emitter-expr.do` owns decorated-AST dispatch and accepts expected-type context
- `selfhost/emitter-expr-utils.do` owns shared type decoration and nullable-promotion helpers
- `selfhost/emitter-expr-literals.do` owns literal, array, object, tuple, and string spelling
- `selfhost/emitter-expr-ops.do` owns assignment, operators, member access, and indexing
- `selfhost/emitter-expr-calls.do` owns calls, native constructors, and class construction
- `selfhost/emitter-expr-control.do` owns `if`, `case`, and dot-shorthand lowering
- `selfhost/emitter-expr-actor.do` owns actor construction, sync/async method calls, and retirement
- `selfhost/emitter-expr-lambda.do` owns closure capture discovery, escaping mutable boxing, and `doof::callback` construction
- `selfhost/emitter-stmt.do` owns block and control-flow layout
- `selfhost/emitter-decl.do` owns reusable function signatures and definitions
- `selfhost/json-semantics.do` owns shared checker/emitter eligibility for
  compiler-generated JSON methods
- `selfhost/emitter-json.do` owns automatic JSON method declarations and definitions
- `selfhost/emitter-header.do` owns header planning and rendering
- `selfhost/emitter-names.do` owns stable generated module namespaces and artifact names
- `selfhost/emitter-module.do` owns module-graph planning, stable coverage module IDs, and `.hpp` / `.cpp` orchestration
- executable wrappers establish the shared application domain and active actor scope before invoking `doof_main`
- `selfhost/emitter-project.do` owns package-relative native copies, generated-header mirrors, and output native-build paths
- `selfhost/native-build.do` resolves materialized native paths and owns GCC-compatible compile/link argument planning
- `selfhost/compiler.do` checks every analyzed module before invoking split module emission
- `selfhost/compiler.do` runs concrete-instantiation discovery after checking and before header planning, and reports bounded specialization traces when discovery does not converge
- the instantiation plan also records generic wrapper classes exposed directly in native signatures, keeping that explicitly permitted interop boundary template-based while all ordinary Doof generic declarations remain concrete
- `selfhost/driver.do` provides the self-hosted command-line and file boundary and writes generated C++ artifacts

The header planner stores rendered signatures and other small planning facts,
not AST unions. This keeps implementation-only front-end types from leaking
into generated C++ headers and leaves room for a future dependency planner.
The self-hosted module planner derives stable namespaces, package-relative
artifact names, and direct import and re-export header dependencies from
logical source paths. Owned `.hpp` / `.cpp` names begin with the manifest
package identity and never embed the host's absolute package root.
`emitModuleGraph(...)`
renders separate `.hpp` / `.cpp` pairs with local class forward declarations
and defining-module qualification for named, namespace, and re-exported
symbols. Module-independent lowering helpers live in `doof_runtime.hpp`;
generic variant promotion and subset narrowing avoid injecting helpers tied to
the self-host AST's concrete expression inventory into generated headers. The
type emitter qualifies nominal names from their resolved symbol's defining
module; it does not infer ownership from hard-coded type-name inventories. The
release gate compiles the complete self-hosted graph through the production
parallel native build path. When test coverage is enabled, the graph emitter
assigns IDs only to non-test, non-stdlib modules. Statement and expression-body
lowering records executable source lines while inserting
`doof::coverage::cov_mark(...)` calls. Graph emission returns those line
inventories alongside the split modules; the self-hosted test driver compiles
with `DOOF_COVERAGE`, aggregates isolated processes by source path, and renders
text, JSON, and HTML artifacts.
The current foundation covers a checked core of primitives, arrays, tuples,
operators, calls, bindings, returns, conditionals, functions, classes, named
construction, enum/type-alias declarations, assignments, range-based loops,
and variant `case` statements. Expected-type context is used at the emission
boundary for nullable multi-arm variant promotion, while the checker remains
responsible for decorating assignment targets. The self-hosted slice now also
discovers structural interface implementations, emits variant aliases, and
dispatches interface members with `std::visit`; imports and multi-module
dependency planning are covered by focused unit tests and the release gate. AST bodies are
promoted into `Expression | Block` fields through the runtime's generic
`variant_promote<Target>(...)` helper.

The self-hosted emitter also supports the existing `import class` native
interop surface. Native headers are emitted in generated headers, native class
definitions are not regenerated, native classes retain their C++ qualified
names and shared-pointer representation, and Doof-bodied native methods are
defined out of line after the generated module namespace. Bodyless methods are
checked as signatures only; a native class must declare any Doof-bodied method
and provide `shared_from_this()` support when its body returns bare `this`.

The split module emitter places the executable wrapper in the entry module. A
`main(args: string[]): int` entry receives process arguments through a generated
`std::vector<std::string>` bridge. The wrapper catches uncaught `doof::Panic`
values, writes a `panic: <message>` diagnostic to stderr, and aborts, matching
the TypeScript bootstrap emitter's process boundary. The self-hosted driver uses
`std/fs`, `std/path`, and `std/os` for file access, path discovery, environment
lookup, and child processes while it loads an explicit source-file graph, including
bare modules supplied with `--module <specifier> <path>`, invokes the
self-hosted compiler, and writes every module's header/source pair plus an
adjacent `doof_runtime.hpp` to the output directory. The root package declares
`doof_runtime.h` as an executable resource, so build and package place the
canonical template beside the self-hosted compiler. The driver loads it through
`std/fs` resource lookup, with `DOOF_RUNTIME_HEADER` retained as a development
override, so cleaning or relocating the compiler's build tree does not break
runtime emission. `DOOF_STDLIB_ROOT`
supplies a generic `/std` acquisition root; successful acquired-source loads
register their package once and parse normalized base plus host-platform
`build.native` metadata. `selfhost/emitter-project.do` combines those reached
package manifests with module emission, writes each generated module header at
one canonical flat path, emits package-relative forwarding headers for sibling
native includes, and rewrites copied include, source, and library paths for the
generated project. Source-relative quoted extern headers are likewise resolved
against the owning Doof module and rewritten to that package's materialized
output root before the flat generated header is rendered. The header planner derives native-namespace aliases from
resolved extern signatures, including nominal types reached through re-exports.
For a referenced type module, it also bridges that module's non-generic sibling
exports and its directly imported nominal dependencies; it does not recursively
export whole dependency modules into the native namespace.
The driver materializes that explicit result without
branching on package names. Reached manifest identity also configures the
canonical namespace planner before emission, so generated types match native
package headers. The `build` command then passes the materialized plan to
`selfhost/native-build.do`. That planner exposes one task per source with an
explicit source path, object output, compiler, and argument list, followed by a
separate link argument list. The driver distributes independent object tasks
across at most eight temporary compiler actors; each actor executes its batch
serially, and the driver waits for every batch before linking. These task
boundaries are also the intended seam for future incremental fingerprints and
discovered header dependencies. POSIX compiler launch uses `posix_spawnp`, so
launching from multiple actor threads does not cross the unsafe `fork()`
boundary of a multithreaded process. Bounded capture lives in `std/os`; the
driver applies its global diagnostic line budget after worker results return.
Native `.c` tasks use the C driver adjacent to the configured GCC-compatible
C++ driver (`clang`, `gcc`, or `cc`) and omit the generated-project C++ language
standard flag; generated and native C++ tasks retain the configured C++ driver.
For projects with more than one generated module, that plan first compiles
`doof_runtime.hpp` as a precompiled header with the same language, define,
include, optimization, and manifest compiler flags as generated C++ object
tasks. Generated headers keep the runtime as their first include: Clang
consumes an explicit `.pch`, while GCC discovers the adjacent `.gch`. Native C,
C++, and Objective-C++ tasks do not receive the explicit Clang PCH; in
particular, a `c++-header` PCH must not be loaded by a `.mm` translation unit.
Single-module builds skip the extra PCH step because its setup cost is unlikely
to amortize.
The bootstrap `package` command uses the same explicit plan beneath
`<buildDir>/release` and prepends the GCC-compatible `-O2` and `NDEBUG` release
defaults before manifest flags. Plain executables link directly into the root
package's configured `dist/` directory. A self-hosted `macos-app` build instead
assembles `Contents/MacOS`, generated `Info.plist` and `PkgInfo`, icons,
glob-expanded resources, and explicitly allowlisted dynamic libraries under
`Contents/Frameworks`. It rewrites embedded install names and dependencies to
bundle-relative `@rpath` references, rejects undeclared non-system dependencies,
then ad-hoc signs the runnable development bundle.
Release packaging signs nested code before the outer bundle using manifest or
CLI Developer ID/ad-hoc settings, verifies the result, and archives the `.app`
with `ditto` as `<executable>-<version>-macos.zip`.

`scripts/release-gate.mjs` owns native bootstrap and acceptance orchestration
outside the unit-test protocol. It builds the seed compiler with the TypeScript
CLI, uses that compiler for B5, uses B5 for B6, and compares the generated text
artifacts from B5 and B6 byte-for-byte. Every compiler build uses its production
parallel native planner. The gate then exercises the B6 `check`, `emit`,
`build`, `test`, and `package` commands against maintained packages covering
runtime behavior, native interop, stdlib acquisition, executable resources, and
optimized lowering. On macOS it also checks and builds `samples/http-client`
through the complete `std/http`/WebSocket graph; its deterministic localhost
runtime leg remains opt-in via `DOOF_HTTP_RUNTIME_TEST=1` for network-restricted
runners. The bootstrap runtime explicitly preserves both
`char` and `char32_t` string conversion because the self-hosted lexer indexes
source strings while compiling its own emitter and driver.

## Primary Entry Points

The current emitter entry surface is `src/emitter-module.ts`.

- `emitModuleSplit(...)` emits one Doof module as a `.hpp` / `.cpp` pair
- `emitProject(...)` emits the full TypeScript project output, including split module files, runtime, and support files

Those entry points coordinate the rest of the emitter and are the place to start when the generated project shape is wrong.

## Core Architecture

### 1. Shared Context

`src/emitter-context.ts` defines `EmitContext`, the shared state threaded through statement, declaration, and expression emission.

It carries:

- the current module and all analyzed modules
- header and source output buffers
- indentation and temp-name counters
- interface implementation maps used for closed-world dispatch
- current function return information for `Result` and control-flow emission
- loop and catch-expression state
- generic substitution and monomorphized-name state

If a new lowering rule needs shared mutable emission state, it usually belongs here.

### 2. Dispatcher Pattern

Emission is split by AST surface, not by language feature list.

- `src/emitter-stmt.ts` owns statement dispatch and block emission
- `src/emitter-decl.ts` owns declarations such as functions, classes, interfaces, enums, and aliases
- `src/emitter-expr.ts` owns expression dispatch and delegates to smaller helpers

This keeps the top-level dispatchers readable while letting feature-specific logic live in focused files.

The expression dispatcher delegates to:

- `src/emitter-expr-literals.ts`
- `src/emitter-expr-ops.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-expr-control.ts`
- `src/emitter-expr-lambda.ts`
- `src/emitter-expr-utils.ts`

### 3. Type Lowering

`src/emitter-types.ts` maps semantic `ResolvedType` values to C++ type strings.

Important design choices:

- primitives map to fixed-width or direct C++ primitives
- class instances lower to `std::shared_ptr<T>`
- interfaces lower to generated alias types used for variant-based dispatch
- arrays, maps, and sets lower to shared pointer-backed runtime containers
- tuples lower to `std::tuple`
- Doof-visible function values lower to actor-affine `doof::callback<R(Args...)>`
  values, including function-typed parameters in bodiless extern declarations;
  runtime internals may still use `std::function`, and callback posting returns
  `doof::Promise<R>`
- intrinsic `Success`/`Failure` arms, `Promise`, actors, actor retirement, and metadata surfaces lower to runtime support types; `Result` itself follows ordinary union/variant lowering

This file is the owning abstraction when a semantic Doof type needs a different C++ representation.

### 4. Generic Specialization

`src/emitter-monomorphize.ts` holds the generic-specialization naming and substitution helpers used during emission.

The current design:

- builds stable instantiation keys from module path, function name, and concrete type arguments
- resolves emitted concrete helper names for generic call sites
- threads concrete substitutions through `EmitContext`

`src/emitter-module.ts`, `src/emitter-stmt.ts`, `src/emitter-decl.ts`, and `src/emitter-expr-calls.ts` consume these helpers when emitting concrete clones.

### 5. Module Splitting and Project Output

`src/emitter-module.ts` is responsible for turning one logical Doof module graph into generated output files.

It owns:

- relative generated path naming
- `.hpp` / `.cpp` splitting
- include and forward-declaration strategy
- interface implementation maps
- emitted function, class, and alias placement
- `main()` wrapper generation where appropriate
- project-level support-file emission for native targets and bundled stdlib assets

Current placement rules that matter for declaration-order bugs:

- header emission first builds a small `HeaderPlan` so include lists,
  cross-module forward declarations, stream aliases, declarations, prototypes,
  extern variables, and init declarations are chosen before rendering
- every generated Doof module owns a deterministic logical C++ namespace:
  packaged modules live under their package `doof.json` name followed by their
  path relative to that package root, so the namespace is stable whether the
  package is compiled directly or as a dependency; names are validated during emission
  planning so cross-module references can stay readable without absolute paths
  or trailing collision hashes, while native extern symbols keep their declared
  C++ names
- code emitted *inside* a module namespace keeps local spellings for module-owned
  symbols, reserving canonical qualification for cross-module references
- when handwritten native headers need Doof-defined types, the header planner
  emits narrow compatibility aliases inside the native C++ namespace (or the
  global native surface when the extern declaration is global) instead of
  reintroducing global aliases for generated Doof modules
- generated headers whose exported types participate in native interop include
  the concrete field-type dependencies that native code may inspect, while
  ordinary Doof-only headers keep pointer-shaped dependencies forward-declared
- module headers include only re-exported module surfaces and imported
  non-class definitions that the emitted header needs complete; ordinary
  implementation dependencies are included from the generated `.cpp`
- generated `.cpp` files add concrete class-definition includes only for
  member-access object types that their implementation actually dereferences,
  keeping nested imported field access valid without pulling in every transitive
  dependency
- ordinary class declarations are emitted in `.hpp` with method prototypes, while their out-of-line definitions live in the module `.cpp`
- Doof-bodied methods declared on extern `import class` surfaces are emitted as
  out-of-line definitions for the native C++ class after the generated module
  namespace, with a local using directive so those bodies can call generated
  Doof helpers without changing the native class ABI
- imported classes referenced through pointer-shaped header surfaces are
  forward-declared before module includes so circular `.hpp` dependencies can
  still use `std::shared_ptr<T>` fields and constructor parameters
- the self-hosted header planner completes primitive-only local structs before
  generated module includes and keeps imported static default calls out of
  headers; call sites materialize those defaults so value-type cycles do not
  require either side to use an incomplete definition
- ordinary private implementation classes that are not part of the header API
  are emitted in the module `.cpp` inside an unnamed namespace; their class
  declarations come before private function prototypes, and their method
  definitions come after those prototypes
- classes that participate in interface aliases, `Stream<T>` aliases, union
  type aliases, exported APIs, or generic/template surfaces remain header-visible
  so aliases and generated dispatch code refer to the same canonical namespaced C++ type
- private Doof classes that remain header-visible use deterministic names
  derived from the logical emitted package/module namespace, such as
  `__doof_private_pkg_mod_Helper`; generated names do not embed absolute
  source filesystem paths
- extern classes always keep their native C++ name from the included header
- private top-level functions and variables in `.cpp` use `static` internal linkage rather than anonymous-namespace wrapping so out-of-line class methods can call them
- the `.cpp` emits forward declarations for private helper functions before their definitions so private helper chains can reference later helpers in the same module
- stream aliases and stream dispatch helpers stay header-visible because call sites need the alias plus the generated `next()`/`value()` dispatch surfaces during normal expression emission

If the generated project layout changes, update this document and the tests in `src/emitter-modules.test.ts` and `src/emitter-e2e-modules.test.ts`.

### 6. Runtime and Feature Support

Some features require dedicated support generation beyond ordinary statement or expression emission.

- `doof_runtime.h` is the checked-in C++ source template for generated `doof_runtime.hpp`; `doof_observer_platform.h` and `doof_observer_runtime.h` hold the optional observer support; `src/emitter-runtime.ts` composes them
- Host services belong to `std/*`, and representation-known trivial operations
  lower directly in the emitters. The runtime retains only shared language
  semantics such as checked collections, variants, callbacks, concurrency,
  reflection, and JSON carriers.
- `src/emitter-json.ts` generates JSON serialization and deserialization helpers
- `src/emitter-json-value.ts` handles runtime coercion around `JsonValue`
- The self-hosted emitter follows the same ordered-map representation:
  intrinsic `JsonValue` lowers to the runtime carrier, JSON object literals
  lower to `doof::ordered_map<std::string, doof::JsonValue>`, and generated
  `toJsonObject()` methods preserve declaration order.
- `src/emitter-schema.ts` generates JSON Schema fragments for metadata surfaces
- `src/emitter-metadata.ts` generates `.metadata` and `.invoke()` support
- `src/emitter-narrowing.ts` handles `as`-narrowing and extraction from narrowed values
- WebAssembly library targets are coordinated by `src/emitter-module.ts`: they
  pull in the bundled `std/json` package support, emit `doof_wasm.cpp`, and
  expose entry-module exported functions through JSON-string C ABI wrappers

These modules are the owning surface when a feature requires both language lowering and runtime interop support.

## End-to-End Flow

At a high level, emission follows this sequence:

1. Take the analyzed and type-checked module graph.
2. Pre-compute any project-wide emission data, such as interface implementation maps and generic instantiations.
3. Emit each module into header and source buffers using a shared `EmitContext`.
4. Generate runtime and feature support files required by the emitted program.
5. Return generated source plus the native-build handoff information consumed by the CLI.

The CLI surfaces described in `docs/cli.md` then write those files and optionally invoke a native compiler. `doof build` and `doof run` materialize debug-profile files through Reckon under `<buildDir>/debug`; `doof package` uses an independent release graph under `<buildDir>/release` and stages its final artifact in `dist/`. Each profile keeps task state in `.reckon/state.json`, compiles generated/native sources to `.doof-objects/`, and links from those object files. Apple app assembly runs after linking: it copies app-declared `embeddedLibraries`, rewrites Mach-O IDs and dependencies to bundle-relative `@rpath` references, and validates that no undeclared non-system dependency remains. Packaging then signs nested code before signing and verifying the outer macOS or iOS device bundle. For `ios-app`, bundle assembly also compiles the emitted app-icon catalog with `actool` for the selected destination and merges the resulting icon keys into the bundled `Info.plist`; the source `.xcassets` directory is not copied into the app. For `wasm`, the CLI uses `em++`, applies size-oriented Emscripten defaults, links with standalone wasm flags, exports `malloc`, `free`, `doof_free`, and generated `doof_export_*` wrappers, and leaves JavaScript instantiation to the consumer.

## Design Constraints

### Decorated AST, Not Reanalysis

The emitter assumes the checker has already made semantic decisions. It reads `resolvedType`, `resolvedBinding`, and related decorations from the AST rather than performing a second semantic pass.

### Closed-World Interface Dispatch

The current emitter pre-computes interface implementation sets across the analyzed program and uses that information during emission. That makes interface lowering efficient and explicit, but it also means emission assumes a closed set of implementing classes for the compiled project.

### Focused Helper Modules

Large emitter features are split into focused helpers instead of growing the central dispatch files without bound. When emission logic starts spanning unrelated features, the preferred direction is to extract a new helper module and update the structure docs.

## Validation Anchors

Use the smallest matching emitter test family first.

- `src/emitter-basics.test.ts` for primitives, declarations, and simple control flow
- `src/emitter-constructs.test.ts` for destructuring, lambdas, defaults, and richer lowering cases
- `src/emitter-advanced.test.ts` for `Result`, JSON, nullability, and collections
- `src/emitter-modules.test.ts` for header/source layout and multi-module behavior
- `src/emitter-generics.test.ts` for generic specialization behavior

Then use end-to-end tests when the question is about generated program behavior rather than code shape:

- `src/emitter-e2e-compile.test.ts`
- `src/emitter-e2e-features.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `src/emitter-e2e-combos.test.ts`
- `src/emitter-e2e-samples.test.ts`

## When To Update This Document

Update this file when:

- the emitter entry points move or change responsibilities
- `EmitContext` gains new architectural roles
- module splitting, runtime generation, or build-handoff structure changes
- a large new emitter helper module is introduced or an old one is removed
- the generic specialization strategy changes

Keep detailed, concept-level lowering rules in [cpp-transpilation-concepts.md](./cpp-transpilation-concepts.md). Keep the repository routing map in [source-file-structure.md](./source-file-structure.md).
