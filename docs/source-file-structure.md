# Doof Source File Structure

This document is the live map of the repository's implementation surfaces. Use it when you need to find the owning file for a compiler change, or when you add, move, or split modules and need to update the project structure documentation.

For emitter-specific architecture and lowering rules, see [cpp-transpiler-architecture.md](./cpp-transpiler-architecture.md) and [cpp-transpilation-concepts.md](./cpp-transpilation-concepts.md).

## Top-Level Layout

- `src/` — compiler, CLI, native-build handoff, and test files
- `spec/` — language semantics; update these when user-facing Doof behavior changes
- `docs/` — contributor and user-facing reference docs
- `samples/` — example programs and larger package-style projects used as references and e2e coverage targets
- `stdlib/` — bundled standard library sources and support assets
- `scripts/` — helper build and packaging scripts for samples and app targets
- `playground/` — browser-based playground app for trying the compiler interactively
- `vscode-doof/` — VS Code extension sources

## `src/` by Concern

### Front-End Parsing and Syntax

- `ast.ts` — AST node types and typed-node decoration surface
- `lexer.ts` — tokenization
- `parser.ts` — parser entry point and syntax lowering into the AST
- `default-expression.ts` — shared default-expression helpers used by parsing and emission paths

Tests:

- `lexer.test.ts`
- `parser-expr.test.ts`
- `parser-decl.test.ts`
- `parser-stmt.test.ts`

### Module Analysis and Name Resolution

- `types.ts` — module-level symbol and import data structures
- `resolver.ts` — ESM-style path resolution and filesystem abstraction
- `analyzer.ts` — top-level symbol collection, import resolution, re-exports, and named-type resolution
- `analyzer-test-helpers.ts` — shared analyzer fixtures

Tests:

- `analyzer-basics.test.ts`
- `analyzer-advanced.test.ts`

### Type Checking and Semantic Decoration

- `checker-types.ts` — semantic type, binding, scope, and compatibility helpers
- `checker.ts` — type-checker orchestration and core expression dispatch
- `checker-expr.ts` — expression-focused inference helpers
- `checker-stmt.ts` — statement checking and block-level scope updates
- `checker-decl.ts` — functions, classes, and method checking
- `checker-member.ts` — member access typing, built-ins, metadata, and field lookup
- `checker-result.ts` — `Result`, `catch`, and try-propagation helpers
- `checker-expr-ops.ts` — unary and binary operator typing helpers
- `checker-collection-annotations.ts` — collection annotation handling
- `checker-readonly.ts` — readonly-specific validation helpers
- `checker-internal.ts` — shared checker contracts and built-ins
- `checker-test-helpers.ts` — shared checker fixtures

Tests:

- `checker-inference.test.ts`
- `checker-compat.test.ts`
- `checker-validation.test.ts`
- `checker-features.test.ts`
- `checker-generics.test.ts`

### C++ Emission Core

The emitter consumes the decorated AST produced by the analyzer and checker. The main owning files are:

- `emitter-module.ts` — project and module emission entry points, `.hpp` / `.cpp` splitting, generated support files, and build metadata wiring
- `emitter-context.ts` — `EmitContext`, the shared state threaded through emission helpers
- `emitter-types.ts` — `ResolvedType` to C++ type mapping
- `emitter-defaults.ts` — default-value emission helpers
- `emitter-monomorphize.ts` — generic specialization keys, naming, and substitution helpers

Expression emission is split by surface area:

- `emitter-expr.ts` — central expression dispatcher
- `emitter-expr-literals.ts` — literals, escaping, and identifier sanitization
- `emitter-expr-ops.ts` — operators, assignment, member access, and indexing
- `emitter-expr-calls.ts` — calls, constructors, and generic call lowering
- `emitter-expr-control.ts` — `if`, `case`, and `catch` expressions
- `emitter-expr-lambda.ts` — lambda capture analysis, closures, async, and actors
- `emitter-expr-utils.ts` — shared expression helpers

Statement and declaration emission are kept separate:

- `emitter-stmt.ts` — blocks, bindings, loops, try/catch, and statement-level control flow
- `emitter-decl.ts` — functions, classes, interfaces, enums, and type aliases

Feature-specific helpers:

- `emitter-narrowing.ts` — `as`-narrowing and narrowed-value extraction
- `emitter-json.ts` — JSON serialization and deserialization support generation
- `emitter-json-value.ts` — runtime `JsonValue` coercion helpers for lowering boundaries
- `emitter-schema.ts` — JSON Schema generation for metadata surfaces
- `emitter-metadata.ts` — `.metadata` fields and `.invoke()` generation
- `emitter-runtime.ts` — `doof_runtime.hpp` generation

### CLI, Build, and Packaging

- `cli-core.ts` — reusable CLI pipeline logic
- `cli.ts` — command-line entry wiring
- `bin.ts` — executable entrypoint
- `build-targets.ts` — resolved build target definitions
- `e2e-test-helpers.ts` — compiler-plus-native-build test helpers

Associated surfaces nearby include native target helpers such as `macos-app-support.ts`, `ios-app-support.ts`, `stdlib-constants.ts`, and the package/build-manifest modules imported by the CLI and emitter.

Tests:

- `bin.test.ts`
- `cli-core.test.ts`
- `cli.test.ts`

## Emitter Test Families

Emitter tests are organized by concept rather than implementation file. Start with the smallest owning concept before reading the implementation module.

- `emitter-basics.test.ts` — core types, declarations, variables, expressions, and basic control flow
- `emitter-constructs.test.ts` — destructuring, lambdas, defaults, and higher-level constructs
- `emitter-advanced.test.ts` — `Result`, JSON, nullability, collections, and advanced lowering cases
- `emitter-modules.test.ts` — module splitting, imports, namespace, and extern surfaces
- `emitter-schema.test.ts` — schema generation
- `emitter-metadata.test.ts` — metadata and invoke generation
- `emitter-generics.test.ts` — generic specialization and generic emission behavior
- `emitter-e2e-compile.test.ts` — end-to-end compile-and-run coverage for core features
- `emitter-e2e-features.test.ts` — feature-focused e2e coverage
- `emitter-e2e-modules.test.ts` — multi-module and extern e2e coverage
- `emitter-e2e-advanced.test.ts` — advanced runtime and control-flow e2e coverage
- `emitter-e2e-combos.test.ts` — cross-feature interactions and boundary combinations
- `emitter-e2e-samples.test.ts` — sample-project integration coverage

## Where To Look First

- New syntax or parse failure: `lexer.ts`, `parser.ts`, and the parser tests
- Import or symbol-resolution issue: `resolver.ts`, `analyzer.ts`, and analyzer tests
- Wrong inferred type or narrowing behavior: `checker.ts`, nearby `checker-*` helper, and checker tests for that feature
- Wrong generated C++ shape: `emitter-module.ts`, then the smallest relevant emitter helper and emitter concept tests
- Wrong generated runtime helper or metadata surface: `emitter-runtime.ts`, `emitter-json.ts`, `emitter-schema.ts`, or `emitter-metadata.ts`
- CLI or build-handoff issue: `cli-core.ts`, `cli.ts`, and `build-targets.ts`

## Keeping This Map Current

Update this document when:

- files are added, removed, renamed, or split across implementation families
- a responsibility moves from one owning file to another
- new emitter helper modules or test families are introduced
- a top-level folder becomes important for compiler work and should be discoverable here

Keep the descriptions short. This file is a routing map, not a full architecture narrative.