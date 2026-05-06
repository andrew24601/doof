# Doof C++ Transpiler Architecture

This document describes the current Phase 4 compiler architecture: how the checked Doof program is turned into generated C++ source, headers, runtime support files, and build metadata.

For the repository map, see [source-file-structure.md](./source-file-structure.md). For concept-by-concept lowering details, see [cpp-transpilation-concepts.md](./cpp-transpilation-concepts.md).

## Scope and Inputs

The emitter runs after parsing, module analysis, and type checking.

- Parsing produces the AST in `src/ast.ts`
- Analysis resolves module symbols and decorates `NamedType` nodes
- Type checking decorates expressions, bindings, declarations, and type-bearing nodes with semantic information

The emitter relies on that decorated AST directly. It does not rebuild type tables during emission.

## Primary Entry Points

The current emitter entry surface is `src/emitter-module.ts`.

- `emitModuleSplit(...)` emits one Doof module as a `.hpp` / `.cpp` pair
- `emitProject(...)` emits the full project output, including runtime and support files

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
- functions lower to `std::function`
- `Result`, `Promise`, actors, and metadata surfaces lower to runtime support types

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

- ordinary class declarations are emitted in `.hpp` with method prototypes, while their out-of-line definitions live in the module `.cpp`
- private top-level functions and variables in `.cpp` use `static` internal linkage rather than anonymous-namespace wrapping so out-of-line class methods can call them
- the `.cpp` emits forward declarations for private helper functions before their definitions so private helper chains can reference later helpers in the same module
- stream aliases and stream dispatch helpers stay header-visible because call sites need the alias plus the generated `next()`/`value()` dispatch surfaces during normal expression emission

If the generated project layout changes, update this document and the tests in `src/emitter-modules.test.ts` and `src/emitter-e2e-modules.test.ts`.

### 6. Runtime and Feature Support

Some features require dedicated support generation beyond ordinary statement or expression emission.

- `src/emitter-runtime.ts` generates `doof_runtime.hpp`
- `src/emitter-json.ts` generates JSON serialization and deserialization helpers
- `src/emitter-json-value.ts` handles runtime coercion around `JsonValue`
- `src/emitter-schema.ts` generates JSON Schema fragments for metadata surfaces
- `src/emitter-metadata.ts` generates `.metadata` and `.invoke()` support
- `src/emitter-narrowing.ts` handles `as`-narrowing and extraction from narrowed values

These modules are the owning surface when a feature requires both language lowering and runtime interop support.

## End-to-End Flow

At a high level, emission follows this sequence:

1. Take the analyzed and type-checked module graph.
2. Pre-compute any project-wide emission data, such as interface implementation maps and generic instantiations.
3. Emit each module into header and source buffers using a shared `EmitContext`.
4. Generate runtime and feature support files required by the emitted program.
5. Return generated source plus the native-build handoff information consumed by the CLI.

The CLI surfaces described in `docs/cli.md` then write those files and optionally invoke a native compiler.

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