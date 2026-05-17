# Doof to C++ Transpilation Concepts

This document explains how important Doof language concepts are currently lowered into C++. It complements [cpp-transpiler-architecture.md](./cpp-transpiler-architecture.md), which describes the emitter's structure, and [source-file-structure.md](./source-file-structure.md), which maps the repository.

Use the spec files for language semantics and these notes for implementation strategy.

## Reading This Document

Each section answers four questions:

- what the Doof concept is
- what broad C++ strategy the emitter uses
- which source files own that lowering
- which tests and specs are the best validation anchors

## Decorated AST as the Lowering Boundary

The most important implementation detail is shared across nearly every concept: lowering happens from the decorated AST, not from raw syntax.

- syntax lives in `src/ast.ts`
- semantic type information comes from `resolvedType`
- binding provenance comes from `resolvedBinding`
- named-type resolution comes from `resolvedSymbol`

When a transpilation bug appears, first verify whether the semantic decoration is already wrong before changing the emitter.

## Types and Runtime Shapes

### Primitive and Composite Types

Strategy:

- Doof primitives map to direct C++ value types such as `int32_t`, `int64_t`, `float`, `double`, `bool`, and `std::string`
- classes lower to `std::shared_ptr<T>`
- tuples lower to `std::tuple<...>`
- functions lower to `std::function<...>`
- arrays, maps, and sets lower to shared runtime container wrappers

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-defaults.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-advanced.test.ts`
- `spec/02-type-system.md`

### Nullability and Unions

Strategy:

- nullable shapes are lowered differently depending on runtime representation
- pointer-like nullability uses pointer/null forms when possible
- value-like nullable unions use optional or variant-style lowering
- broader unions use generated `std::variant` shapes and explicit extraction or coercion helpers

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-json-value.ts`
- `src/emitter-narrowing.ts`
- `src/emitter-expr-ops.ts`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/02-type-system.md`

## Functions, Lambdas, and Generic Calls

### Module Identity and Cross-Module References

Strategy:

- every generated Doof module lowers into a deterministic logical C++ namespace:
  project-local modules use their root-package-relative path, while dependency
  modules use `lib::<dependency-package-name>::...` from the dependency's
  `doof.json`
- cross-module calls, values, and type references use the canonical defining-module namespace rather than import aliases
- module-local declarations and references keep local C++ spellings within their owning namespace, so qualification marks a real module boundary rather than merely adding noise
- lossy namespace-component sanitisation is validated up front, so sibling
  source names such as `foo-bar` and `foo_bar` are rejected instead of being
  silently disambiguated with generated suffixes
- namespace-member lowering consumes checker decoration for the resolved exported symbol instead of re-resolving raw syntax during emission
- re-exported names lower directly to the original defining symbol; extern C++ symbols keep their native `cppName`
- native interop receives only scoped bridge aliases for the Doof types required by native headers; those aliases are an ABI aid, not a second generated module surface
- when an exported generated type is part of a native interop surface, its own
  header also exposes the concrete field dependencies native code may dereference
  directly; ordinary Doof-only headers still prefer forward declarations

Primary modules:

- `src/emitter-names.ts`
- `src/emitter-module.ts`
- `src/emitter-expr.ts`
- `src/checker-expr.ts`

Validation anchors:

- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `spec/11-modules.md`

### Functions and Methods

Strategy:

- function declarations lower to generated C++ functions or methods with resolved parameter and return types
- method placement depends on the owning declaration and module/header split
- default parameters and named-argument ordering are normalized during emission

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-module.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/04-functions-and-lambdas.md`

### Lambdas, Closures, Async, and Actors

Strategy:

- lambda lowering performs capture analysis before generating the C++ callable form
- capture analysis only includes bindings that are free in that lambda; lambda-local declarations and case-pattern bindings stay local to the generated callable
- every lambda establishes its own callable return context, so nested lambda returns do not inherit outer `Result<T, E>` wrapping rules
- mutable captured locals may need special boxing or indirection so closures stay valid after escape
- async and actor-related forms are lowered through the same lambda-focused emission surface rather than through a separate compiler phase

Primary modules:

- `src/emitter-expr-lambda.ts`
- `src/emitter-context.ts`

Validation anchors:

- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-features.test.ts`
- `spec/04-functions-and-lambdas.md`
- `spec/10-concurrency.md`

### Generic Specialization

Strategy:

- generic calls are lowered to concrete emitted helpers using monomorphized names keyed by the concrete type arguments
- emitted code threads substitutions through the shared emission context so downstream helpers see concrete types

Primary modules:

- `src/emitter-monomorphize.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-decl.ts`
- `src/emitter-module.ts`

Validation anchors:

- `src/emitter-generics.test.ts`
- `src/emitter-e2e-features.test.ts`
- `spec/02-type-system.md`

## Objects, Interfaces, and Enums

### Classes and Construction

Strategy:

- class values lower to shared pointer-managed objects
- constructor and field initialization order is emitted explicitly
- positional and named construction forms are normalized into the generated constructor call shape

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-defaults.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/07-classes-and-interfaces.md`

### Interfaces and Polymorphism

Strategy:

- interface lowering depends on the current closed-world module graph
- the emitter pre-computes implementing classes and uses generated interface alias types to support dispatch
- interface-related JSON and metadata surfaces build on the same implementation map

Primary modules:

- `src/emitter-module.ts`
- `src/emitter-decl.ts`
- `src/emitter-json.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `spec/07-classes-and-interfaces.md`

### Enums

Strategy:

- enums lower to dedicated C++ enum declarations and are carried through code generation as named enum values
- enum-aware operations are emitted as ordinary typed C++ expressions once semantic typing is resolved

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-ops.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/07-classes-and-interfaces.md`

## Expressions and Statements

### Expressions

Strategy:

- expression lowering is centralized in `src/emitter-expr.ts` and delegated by expression kind
- literals, operators, calls, control-flow expressions, and lambdas each have focused helper modules
- runtime coercion is introduced only when the semantic source and target shapes differ at runtime

Primary modules:

- `src/emitter-expr.ts`
- `src/emitter-expr-literals.ts`
- `src/emitter-expr-ops.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-expr-control.ts`
- `src/emitter-json-value.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/05-operators.md`
- `spec/06-control-flow.md`

### Statements and Control Flow

Strategy:

- statement lowering lives in `src/emitter-stmt.ts`
- blocks, bindings, loops, `if`, `break`, `continue`, try/catch statements, and loop follow-up behavior are emitted with explicit control-flow state in `EmitContext`
- expression-level and statement-level control flow stay separate, even when they model similar language concepts

Primary modules:

- `src/emitter-stmt.ts`
- `src/emitter-context.ts`
- `src/emitter-expr-control.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `src/emitter-e2e-combos.test.ts`
- `spec/06-control-flow.md`

## Errors, Results, and Narrowing

### `Result`, `try`, `catch`, and `as`

Strategy:

- `Result<T, E>` lowers to runtime support types rather than plain exceptions
- `try` and `catch` forms are emitted with explicit success/failure control flow
- `as`-narrowing becomes explicit runtime checks that either extract a narrowed value or return a failure result

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-stmt.ts`
- `src/emitter-expr-control.ts`
- `src/emitter-narrowing.ts`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/09-error-handling.md`

## Collections, Tuples, and Destructuring

Strategy:

- arrays, maps, sets, and tuples lower to runtime-backed C++ container or tuple shapes
- destructuring expands into explicit extraction and assignment code rather than a dedicated C++ destructuring feature
- collection behavior depends on both type lowering and statement or expression emission helpers

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-stmt.ts`
- `src/emitter-expr-ops.ts`

Validation anchors:

- `src/emitter-constructs.test.ts`
- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/03-variables-and-bindings.md`
- `spec/08-pattern-matching.md`

## Modules, Runtime, and Generated Project Shape

### Module Splitting and Project Output

Strategy:

- each Doof module is emitted as a generated header/source pair
- project emission also writes runtime and target-specific support files
- the emitted project layout is designed to be consumed by the CLI build pipeline rather than by a separate handwritten build integration layer

Primary modules:

- `src/emitter-module.ts`
- `src/emitter-runtime.ts`

Validation anchors:

- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `src/emitter-e2e-samples.test.ts`
- `spec/11-modules.md`

### JSON, Schema, Metadata, and Reflection

Strategy:

- serializable types get generated conversion helpers
- interface-level deserialization relies on the known set of implementations in the analyzed project
- metadata surfaces and `.invoke()` generation build on the same emitted type knowledge and JSON support

Primary modules:

- `src/emitter-json.ts`
- `src/emitter-json-value.ts`
- `src/emitter-schema.ts`
- `src/emitter-metadata.ts`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-schema.test.ts`
- `src/emitter-metadata.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/12-json-serialization.md`
- `spec/13-descriptions.md`

## Maintenance Rule

Update this document when the lowering strategy changes, not just when files move.

Good reasons to update it:

- a Doof construct starts lowering to a different C++ runtime shape
- a concept moves to a different owning emitter helper
- a new runtime support mechanism is introduced
- the best validation anchors for a concept change materially

If only the file layout changes, update [source-file-structure.md](./source-file-structure.md) instead. If the emitter flow changes but the concept strategy does not, update [cpp-transpiler-architecture.md](./cpp-transpiler-architecture.md).
