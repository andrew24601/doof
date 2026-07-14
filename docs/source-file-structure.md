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
- `selfhost/` — Doof implementations of compiler front-end components and their Doof-native tests
- `observer-ui/` — editable HTML/CSS/JS assets embedded in observed `doof run --observe` builds
- `doof_observer_platform.h` — platform socket includes for observer-enabled runtime output
- `doof_observer_runtime.h` — observer server fragment with UI asset placeholders
- `doof_runtime.h` — standalone C++ source template for the generated `doof_runtime.hpp`
- `playground/` — browser-based playground app for trying the compiler interactively
  - `playground/src/stdlib-files.ts` — Vite-bundled stdlib source map for browser compilation
- `vscode-doof/` — VS Code extension sources

## Self-Hosted Compiler Work

- `selfhost/lexer.do` — performance-oriented lexer prototype; emits reserved value-array token structs with source spans, locations, and diagnostics
- `selfhost/lexer.test.do` — Doof-native lexer tests covering hot-path tokens, keywords, literals, interpolation, positions, large inputs, and diagnostics
- `selfhost/ast.do` — nominal self-hosted syntax-tree node classes, tagged with `kind` values and source spans
- `selfhost/parser.do` — self-hosted parser façade, token state, diagnostics, and public parse entry points
- `selfhost/parser-declarations.do` — self-hosted declaration, class, interface, enum, import, and export parsing
- `selfhost/parser-statements.do` — self-hosted statement, control-flow, try, destructuring, and case-pattern parsing
- `selfhost/parser-types.do` — self-hosted type annotation parsing
- `selfhost/parser-expressions.do` — self-hosted precedence-climbing expression, literal, lambda, and construction parsing
- `selfhost/parser.test.do` — Doof-native parser tests for literals, precedence, postfix expressions, declarations, collections, control flow, and spans
- `selfhost/semantic.do` — shared module symbols, semantic spans, resolved types, bindings, scopes, and diagnostics
- `selfhost/resolver.do` — deterministic relative and rooted bare-module resolution over in-memory sources or a demand-driven source loader
- `selfhost/resolver.test.do` — resolver tests for barrel probing, explicit mappings, and cached loader requests
- `selfhost/analyzer.do` — phased module symbol collection, import/re-export resolution, and named-type decoration
- `selfhost/analyzer.test.do` — analyzer tests for imports, re-exports, and resolved named types
- `selfhost/checker-types.do` — resolved-type construction, assignability, joins, and numeric rules
- `selfhost/checker.do` — lexical-scope checking, expression inference, calls, members, assignments, and definite returns
- `selfhost/checker.test.do` — checker tests for inference, mutability diagnostics, and return-path validation
- `selfhost/compiler.do` — self-hosted graph checking and split module emission orchestration
- `selfhost/cli.do` — command and option parsing for the self-hosted CLI (`build`, `emit`, `check`, project-directory entrypoints, and explicit `--module` mappings)
- `selfhost/project.do` — self-hosted `doof.json` project discovery and build entry/build-directory defaults used by the driver's demand-driven loader
- `selfhost/module-acquisition.do` — logical module-prefix to arbitrary package-folder acquisition mappings used by the self-hosted driver
- `selfhost/package-manifest.do` — normalized package identity and host-platform `build.native` manifest parsing
- `selfhost/emitter-project.do` — package-relative generated support files, native-copy paths, and output native-build planning
- `selfhost/native-build.do` — output-relative native path resolution and GCC-compatible compile/link argument planning
- `selfhost/driver.do` — native filesystem/JSON runtime boundary and generic project materialization for the self-hosted CLI
- `selfhost/compiler.test.do` — self-hosted compiler pipeline tests
- `selfhost/module-acquisition.test.do` — acquisition precedence, package ownership, and arbitrary-root tests
- `selfhost/package-manifest.test.do` — native manifest parsing, platform merge, validation, and real-stdlib tests
- `selfhost/emitter-project.test.do` — package-relative native planning, generated-header mirrors, and collision isolation tests
- `selfhost/project.test.do` — root project manifest and native-plan tests
- `selfhost/bootstrap.test.do` — maintained B3 native split-emission gate, B4/B5 compiler bootstrap, and B6 two-stage smoke tests
- `selfhost/samples/nullable-variant.do` — focused native-compilation fixture for nullable variant lowering
- `selfhost/samples/nullable-ast-construction.do` — focused fixture for avoiding duplicate nullable AST-variant promotion
- `selfhost/samples/nullable-alias-assignment.do` — focused fixture for nullable `Expression`/`Statement`-style alias assignment
- `selfhost/samples/recursive-ast-union.do` — focused fixture for recursive AST-style union construction
- `selfhost/samples/lambda-body-union.do` — focused fixture for `LambdaExpression` body union conversion
- `selfhost/samples/std-time-acquisition.do` — focused generated-driver fixture for implicit `std/time` acquisition
- `selfhost/emitter-context.do` — graph-wide declarations, module identity, imports, and current method-owner context for emission
- `selfhost/emitter-names.do` — stable generated module namespaces and artifact names
- `selfhost/emitter-monomorphize.do` — fixed-point discovery and stable naming of concrete functions, methods, classes, interfaces, and native adapters
- `selfhost/emitter-types.do` — self-hosted resolved-type to C++ type lowering
- `selfhost/emitter-expr.do` — self-hosted decorated-AST expression dispatcher
- `selfhost/emitter-expr-utils.do` — shared self-hosted expression type and promotion helpers
- `selfhost/emitter-expr-literals.do` — self-hosted literal, array, object, tuple, and string lowering
- `selfhost/emitter-expr-ops.do` — self-hosted assignment, operator, member, and index lowering
- `selfhost/emitter-expr-calls.do` — self-hosted call, constructor, and class construction lowering
- `selfhost/emitter-expr-control.do` — self-hosted conditional, case, and dot-shorthand lowering
- `selfhost/emitter-expr-lambda.do` — self-hosted lambda capture analysis, escaping mutable boxing, and actor-affine callback lowering
- `selfhost/emitter-stmt.do` — self-hosted block and control-flow lowering
- `selfhost/emitter-decl.do` — self-hosted function signatures, definitions, and value declarations
- `selfhost/emitter-header.do` — self-hosted header planning and header rendering boundary
- `selfhost/emitter-module.do` — self-hosted module planning, dependency includes, and split `.hpp` / `.cpp` orchestration
- `selfhost/emitter-project.do` — self-hosted generated support-file and native package output planning
- `selfhost/emitter.test.do` — native tests for the initial self-hosted emitter slice
- `src/selfhost-bootstrap.test.ts` — native-toolchain syntax compilation of the TypeScript-emitted self-host source graph

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
- `checker-control-flow.ts` — conservative normal-completion analysis for definite returns
- `checker-declared-values.ts` — shared declared-value/default resolution for bindings, parameters, and fields
- `checker-member.ts` — member access typing, built-ins, metadata, and field lookup
- `checker-result.ts` — `Result`, `catch`, and try-propagation helpers
- `checker-expr-ops.ts` — unary and binary operator typing helpers
- `checker-collection-annotations.ts` — collection annotation handling
- `checker-diagnostics.ts` — shared checker diagnostics that must stay consistent across modules
- `checker-readonly.ts` — readonly-specific validation helpers
- `checker-actor-boundary.ts` — actor-call boundary safety validation
- `checker-internal.ts` — shared checker contracts and built-ins
- `checker-test-helpers.ts` — shared checker fixtures

Cross-cutting checker semantics are documented in [type-checker-concepts.md](./type-checker-concepts.md).

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
- `emitter-names.ts` — canonical generated module namespaces and cross-module symbol reference names
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
- `emitter-runtime.ts` — `doof_runtime.hpp` generation and observer feature composition
- `runtime-assets.ts` — Node/browser loading and observer asset composition for the standalone C++ templates
- `observer-assets.ts` — Node-side loader for observer UI assets embedded into generated runtime support

The self-hosted emitter is developed separately under `selfhost/`. Its first
slice intentionally has a smaller scope than the TypeScript emitter and keeps
header planning isolated from source, declaration, expression, and statement
rendering. Extend the self-hosted modules in those ownership boundaries before
adding logic to `emitter-module.do`.

### CLI, Build, and Packaging

- `cli-core.ts` — reusable CLI pipeline logic, Reckon-backed incremental build graph, and native compile/link planning
- `cli.ts` — command-line entry wiring
- `bin.ts` — executable entrypoint
- `build-targets.ts` — resolved build target definitions
- `app-info-plist.ts` — shared app `Info.plist` value types, managed-key validation, and plist rendering
- `resource-patterns.ts` — shared resource glob expansion and resolved resource shape for app bundles and executable artifacts
- `package-artifacts.ts` — release compiler defaults, artifact naming, and plain executable staging
- `package-command.ts` — release pipeline orchestration and target-specific artifact dispatch
- `apple-embedded-libraries.ts` — explicit Apple dylib/framework resolution, bundle copying, Mach-O rewriting, and dependency validation
- `macos-package.ts` — Developer ID/ad-hoc signing, sandbox entitlements, verification, and zip creation
- `ios-package.ts` — Ad Hoc profile validation, distribution signing, verification, and IPA creation
- `e2e-test-helpers.ts` — compiler-plus-native-build test helpers

Associated surfaces nearby include native target helpers such as `macos-app-support.ts`, `ios-app-support.ts`, `stdlib-constants.ts`, the bundled `std/json` module definition in `stdlib.ts`, and the package/build-manifest modules imported by the CLI and emitter.

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
- CLI or build-handoff issue: `cli-core.ts`, `cli.ts`, `build-targets.ts`, and `resource-patterns.ts` for resource copying

## Keeping This Map Current

Update this document when:

- files are added, removed, renamed, or split across implementation families
- a responsibility moves from one owning file to another
- new emitter helper modules or test families are introduced
- a top-level folder becomes important for compiler work and should be discoverable here

Keep the descriptions short. This file is a routing map, not a full architecture narrative.
