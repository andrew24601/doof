# Self-Hosted Compiler Bootstrap Progress

Status date: 2026-07-12

This document tracks the concrete path from the self-hosted front end to a
compiler that can compile its own implementation. The TypeScript compiler is
the current bootstrap compiler; the self-hosted implementation must eventually
be able to replace it for the same source graph.

## Definition of self-hosting

The milestone is complete when all of the following are true:

1. A self-hosted driver accepts the compiler's `.do` source graph and entry module.
2. The self-hosted resolver, analyzer, and checker process that graph without the TypeScript implementation.
3. The self-hosted emitter produces C++ for every compiler module, including headers, source files, and runtime entrypoint.
4. The generated C++ compiles with the supported native toolchain and runs a compiler smoke test.
5. A second build using the generated compiler succeeds, establishing a two-stage bootstrap.

“The emitter has unit tests” is not counted as self-hosting.

## Current phase

The self-hosted lexer, AST, parser, resolver, analyzer, checker, rich-core
emitter, and a runnable compiler driver exist as Doof source modules. The first
generated compiler now compiles the complete self-hosted compiler source graph,
and the compiler it produces compiles that same graph again and runs a second
multi-file smoke program. The two-stage bootstrap is complete; interfaces and
other language-surface gaps remain outside the current self-host graph.

### Completed

- [x] Self-hosted lexer and lexer tests
- [x] Self-hosted AST model
- [x] Self-hosted parser and parser tests
- [x] Self-hosted resolver
- [x] Self-hosted analyzer and analyzer tests
- [x] Self-hosted checker and checker tests
- [x] Self-hosted parser can parse the compiler's resolver, semantic, analyzer, checker, emitter, and compiler source modules
- [x] Self-hosted `case` statement parsing for type-pattern and wildcard arms
- [x] Small emitter modules with separate type, expression, statement, declaration, header, and module responsibilities
- [x] Initial C++ lowering for primitives, arrays, tuples, operators, calls, bindings, returns, conditionals, and functions
- [x] Nominal class lowering with fields, methods, method field access, and named construction
- [x] Variant `case` lowering with type bindings and wildcard branches
- [x] Implicit method bindings in the self-hosted checker
- [x] Native Doof tests that compile and execute the initial emitter
- [x] Explicit header planning boundary that avoids exposing front-end AST unions in planner state
- [x] Self-hosted compiler orchestration that checks every analyzed module before project emission
- [x] TypeScript-bootstrap syntax compilation fixture for the complete self-host source graph
- [x] Self-hosted enum and type-alias representation, including enum member access
- [x] Self-hosted assignment and range/array loop lowering used by the front end
- [x] Self-hosted compiler checks and emits the complete 18-module source graph with zero diagnostics
- [x] Focused nullable-variant sample reaches clean `clang++ -std=c++17 -fsyntax-only` compilation
- [x] Focused nullable AST-construction sample reaches clean `clang++ -std=c++17 -fsyntax-only` compilation
- [x] Focused nullable `Expression`/`Statement` alias-assignment sample reaches clean native compilation
- [x] Self-hosted statement conditions avoid redundant outer parentheses in generated C++
- [x] Self-hosted parser slice (`semantic.do`, `ast.do`, `lexer.do`, `parser.do`) reaches clean native syntax compilation
- [x] Self-hosted analyzer slice (`semantic.do`, `ast.do`, `lexer.do`, `parser.do`, `resolver.do`, `analyzer.do`) reaches clean native syntax compilation
- [x] Self-hosted checker slice (`semantic.do`, `ast.do`, `lexer.do`, `parser.do`, `resolver.do`, `analyzer.do`, `checker-types.do`, `checker.do`) reaches clean native syntax compilation
- [x] Checker visits every `if` branch so emitter-required assignment targets are decorated in both `then` and `else` paths
- [x] Focused self-hosted `emitter-expr.do` slice reaches clean native syntax compilation
- [x] Focused self-hosted `emitter-stmt.do` slice reaches clean native syntax compilation
- [x] Focused self-hosted `emitter-decl.do` slice reaches clean native syntax compilation
- [x] Focused self-hosted `emitter-header.do` slice reaches clean native syntax compilation
- [x] Focused recursive AST-union construction sample reaches clean native syntax compilation
- [x] Focused lambda-body union conversion sample reaches clean native syntax compilation
- [x] Maintained B2 acceptance test syntax-compiles the complete self-hosted source graph
- [x] B3 module planner assigns stable namespaces and direct import header names
- [x] B3 split emitter qualifies direct, namespace, and re-exported symbols by defining module
- [x] B3 split emitter produces separate headers and sources for the complete 18-module graph
- [x] Self-hosted compiler driver accepts an entry file, explicit source graph, and output prefix
- [x] Linked self-hosted driver writes C++ header/source/runtime artifacts and reports diagnostics
- [x] B4 generated C++ artifact compiles and runs a multi-module smoke program
- [x] B5 generated compiler emits and links the complete self-hosted compiler graph, then runs a smoke program
- [x] B6 B5-produced compiler recompiles the same graph and its generated compiler runs a second smoke program

Evidence for the current emitter slice:

- `npm test`: 2243 TypeScript tests passing
- `npm run build`: passing
- `doof test selfhost/emitter.test.do`: 11 tests passing, including stable module names and import-header planning
- `doof test selfhost/checker.test.do`: 6 tests passing, including nested nullable assignments in both `then` and `else` branches
- `doof test selfhost/compiler.test.do`: 16 tests passing through the focused emitter-header slice, recursive AST-union construction, lambda-body union conversion, and a split re-exported three-module emission gate; native stderr dumps are capped at eight lines plus a truncation marker
- `doof test selfhost/analyzer.test.do`: 3 tests passing, including re-export resolution to the defining module
- `doof test selfhost/bootstrap.test.do`: four acceptance tests pass; the two-stage test links the B4 compiler, uses it to emit and link the complete 20-module graph, then uses the B5-produced compiler to emit and link that same graph again; both generated smoke programs exit with code `5`
- The focused emitter-stmt slice also passes native syntax compilation; its remaining vector-backed fields and optional statement fields now lower through the shared expression helpers.
- The checker native slice now passes after normalizing bare `ResolvedType` contextual arguments through a checker-owned nullable wrapper.
- The current compiler runner is 15 passing / 0 failing through the lambda-body union conversion gate.
- The parser-slice artifact now passes `clang++ -std=c++17 -fsyntax-only`; the runner remains useful as a compact four-module regression check.
- `src/selfhost-bootstrap.test.ts`: generated 18-module graph passes `clang++ -fsyntax-only`
- The full-graph acceptance test is deliberately separate from the focused compiler runner; the latter remains the active edit/test loop because full-graph diagnostics are too large to localize failures efficiently.
- The focused sample covers `Value`, `Value | null`, assignment into a nullable variant, and construction of a nullable variant field. Its generated C++ is compiled by the Doof test itself.
- The focused lambda sample imports the real AST model and covers both concrete expression and block bodies in `LambdaExpression`; its generated C++ is compiled by the Doof test itself.

### Not yet complete

- [ ] Interfaces and closed-world representation
- [x] Import/export emission and cross-module symbol references
- [x] Multi-module header dependency planning and forward declarations
- [x] Remaining expressions and statements used by the compiler sources
- [x] Runtime support and builtin mapping needed by the self-hosted compiler driver
- [x] Self-hosted compiler driver and command-line/file input surface
- [x] Two-stage bootstrap verification

## Bootstrap milestones

Each milestone must add focused tests and leave the previous milestone green.

| ID | Milestone | Acceptance check | Status |
| --- | --- | --- | --- |
| B0 | Emitter core | Native emitter tests compile and pass | Complete |
| B1 | Nominal declarations | Emit and compile `selfhost/ast.do` and `selfhost/semantic.do` as single modules | Complete |
| B1a | Project bootstrap artifact | Check an imported module graph and emit one monolithic C++ artifact | In progress |
| B2 | Rich core lowering | Emit the parser/checker source modules, including loops, methods, construction, and remaining collections | Complete |
| B3 | Module graph | Emit all self-hosted modules with stable names, includes, forward declarations, and imports | Complete |
| B4 | Compiler driver | Generated compiler accepts source files, resolves/checks them, and writes generated C++ | Complete |
| B5 | First bootstrap | Generated compiler compiles the self-hosted compiler source graph and runs a smoke test | Complete |
| B6 | Two-stage bootstrap | Compiler produced by B5 compiles the same source graph successfully | Complete |

## Design constraints

- Keep emitter files focused; split by ownership before a file approaches the repository's 500-line guidance.
- Keep header planning separate from expression and statement lowering.
- Use the TypeScript emitter for behavioral clues and regression cases, not as a requirement to copy every C++ representation decision.
- Prefer generated-C++ compilation tests over string-only assertions once a slice can produce a complete module.
- Treat checked AST decorations as inputs, but allow expected-type context where the AST decoration is intentionally optional.

## Incremental emitter workflow

The complete self-hosted source graph is useful for discovering the next class
of failures, but it is deliberately not the active edit/test loop. Keep the
loop below small enough that one native compiler failure identifies one emitter
boundary:

1. Add or edit one fixture under `selfhost/samples/` that demonstrates exactly
   one missing C++ lowering shape. Keep the fixture independent of the
   compiler's own AST unless the AST shape is the subject of the sample.
2. Add a test in `selfhost/compiler.test.do` that reads the fixture, runs the
   self-hosted `compile` pipeline, writes a uniquely named focused header and
   source artifact under `/tmp`, plus minimal `doof_runtime.hpp`, then invokes
   `clang++ -std=c++17 -fsyntax-only` on that artifact.
3. Fix the smallest responsible checker/emitter boundary. Preserve the
   fixture as a regression test and keep the generated C++ diagnostic local.
4. Only after the focused fixture is green, use the full source graph as a
   periodic diagnostic probe or run the maintained B2 acceptance test. Do not
   restore full-graph artifact writing to `selfhost/compiler.test.do`.

`testCompilesSelfhostParserSlice` is a compact four-module native compile
runner. It writes `/tmp/doof-selfhost-parser.hpp`,
`/tmp/doof-selfhost-parser.cpp`, `/tmp/doof_runtime.hpp`, and the native exit
status to `/tmp/doof-selfhost-parser.exit`. Keep it as a diagnostic boundary
for the front end even though the current native result is now exit `0`.

`testCompilesSelfhostAnalyzerSlice` extends the same gate through
`resolver.do` and `analyzer.do`; its native result is currently exit `0`.
`testCompilesSelfhostCheckerSlice` extends through
`checker-types.do` and `checker.do`, writing `/tmp/doof-selfhost-checker.hpp`,
`/tmp/doof-selfhost-checker.cpp`, and `/tmp/doof-selfhost-checker.exit`. The
checker artifact now passes native syntax compilation. The gate covers nullable
AST-decoration fields, nullable `ResolvedType` conversions, the monolithic
helper namespace, and imported AST type aliases.

The current reference fixture is
`selfhost/samples/nullable-variant.do`. It establishes the expected pattern
for converting a non-null `std::variant` into a nullable variant with an
explicit `std::monostate` arm. The corresponding checker/emitter boundary is:
the checker decorates assignment targets and expression types, while the
emitter only applies the representation-level variant promotion required by
those decorations. Branch traversal must visit every `if` arm; completion
analysis must not short-circuit semantic checking.

## Next slice

The B6 two-stage bootstrap gate is complete. The next work is outside the driver
boundary:

1. Add closed-world interface representation and implementation dispatch.
2. Extend the self-hosted graph toward the remaining language surface.
3. Keep B2 through B6 gates green while extending the compiler.

The maintained B2 acceptance test reaches the compiler and emitter modules,
reports zero analyzer/checker diagnostics, and reaches clean
`clang++ -std=c++17 -fsyntax-only` compilation. The B4 acceptance test links
and runs the first generated compiler. The B5 acceptance test then uses that
compiler to emit and link the full self-hosted compiler source graph and
verifies a generated two-module program returns `5`. The B6 acceptance path
feeds that compiler's output back through the same graph and repeats the
compile/link/smoke cycle successfully.

The expression emitter now consumes checker decorations directly for expression
types instead of searching the current emitter context for declaration fields or
function return types. C++-specific nullable promotion and AST helper accessors
remain emitter responsibilities; semantic type lookup belongs to the checker.

Do not start final module-ABI work until B1 has a complete compile check; the
first bootstrap artifact may still use the intentionally monolithic namespace.
