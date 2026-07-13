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
Module import planning remains an output-layout concern; semantic lookup and
validation belong entirely to analysis and checking.

## Self-Hosted Emitter Foundation

The self-hosted compiler is beginning its own C++ emitter under `selfhost/`.
It uses the TypeScript emitter as a source of tested behavior and architectural
clues, but its C++ representation policy is intentionally independent.

The initial slice is split into small modules:

- `selfhost/emitter-context.do` owns nominal declarations and current method-owner context
- `selfhost/emitter-types.do` owns resolved-type representation choices
- `selfhost/emitter-expr.do` owns decorated-AST dispatch and accepts expected-type context
- `selfhost/emitter-expr-utils.do` owns shared type decoration and nullable-promotion helpers
- `selfhost/emitter-expr-literals.do` owns literal, array, object, tuple, and string spelling
- `selfhost/emitter-expr-ops.do` owns assignment, operators, member access, and indexing
- `selfhost/emitter-expr-calls.do` owns calls, native constructors, and class construction
- `selfhost/emitter-expr-control.do` owns `if`, `case`, and dot-shorthand lowering
- `selfhost/emitter-stmt.do` owns block and control-flow layout
- `selfhost/emitter-decl.do` owns reusable function signatures and definitions
- `selfhost/emitter-header.do` owns header planning and rendering
- `selfhost/emitter-names.do` owns stable generated module namespaces and artifact names
- `selfhost/emitter-module.do` owns module-graph planning and `.hpp` / `.cpp` orchestration
- `selfhost/compiler.do` checks every analyzed module before invoking split module emission
- `selfhost/driver.do` provides the B4/B5/B6 command-line and file boundary and writes generated C++ artifacts

The header planner stores rendered signatures and other small planning facts,
not AST unions. This keeps implementation-only front-end types from leaking
into generated C++ headers and leaves room for a future dependency planner.
The self-hosted module planner derives stable namespaces and direct import and
re-export header dependencies from logical source paths. `emitModuleGraph(...)`
renders separate `.hpp` / `.cpp` pairs with guarded shared helpers, local class
forward declarations, and defining-module qualification for named, namespace,
and re-exported symbols. The maintained B3 acceptance test compiles all 18
self-hosted modules as separate translation units.
The current foundation covers a checked core of primitives, arrays, tuples,
operators, calls, bindings, returns, conditionals, functions, classes, named
construction, enum/type-alias declarations, assignments, range-based loops,
and variant `case` statements. Expected-type context is used at the emission
boundary for nullable multi-arm variant promotion, while the checker remains
responsible for decorating assignment targets. The self-hosted slice now also
discovers structural interface implementations, emits variant aliases, and
dispatches interface members with `std::visit`; imports and multi-module
dependency planning are covered by the completed B3 graph gate. The header planner also emits `with_block` overloads for both existing
expression variants and concrete expression nodes when promoting AST bodies to
`Expression | Block` fields.

The self-hosted emitter also supports the existing `import class` native
interop surface. Native headers are emitted in generated headers, native class
definitions are not regenerated, native classes retain their C++ qualified
names and shared-pointer representation, and Doof-bodied native methods are
defined out of line after the generated module namespace. Bodyless methods are
checked as signatures only; a native class must declare any Doof-bodied method
and provide `shared_from_this()` support when its body returns bare `this`.

The split module emitter places the executable wrapper in the entry module. A
`main(args: string[]): int` entry receives process arguments through a generated
`std::vector<std::string>` bridge. The B4 driver exposes file contents through
the `std/fs`-shaped `readText` / `writeText` surface and retains only native
path/discovery helpers while it loads an explicit source-file graph, including
bare modules supplied with `--module <specifier> <path>`, invokes the
self-hosted compiler, and writes every module's header/source pair plus an
adjacent `doof_runtime.hpp` to the output directory. It copies that file from
the canonical runtime header used to build the compiler, with
`DOOF_RUNTIME_HEADER` available as a relocation override, so the TypeScript and
self-hosted compilers share one runtime implementation. Package manifests and
automatic `std/*` discovery remain outside this bootstrap slice.

`src/selfhost-bootstrap.test.ts` compiles the TypeScript bootstrap emitter's
17-module self-host source graph with the native C++ toolchain. The
`selfhost/bootstrap.test.do` B3 test provides the corresponding self-hosted
split translation-unit check, while its B4 test links and runs
the generated driver and then compiles and runs the generated target program.
Its B5 test feeds the complete driver-inclusive graph back through that
generated compiler, links the resulting compiler, and verifies another
generated target program. The B6 path feeds that generated compiler's output
back through the same graph, links the next compiler, and verifies a second
target program. The bootstrap runtime explicitly preserves both
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
