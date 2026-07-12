# Self-Hosted Compiler Bootstrap Progress

Status date: 2026-07-12

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
resolver, analyzer, checker, C++ emitter, compiler driver, native class
interop, and bootstrap tests are implemented in Doof. The generated compiler
can rebuild the complete self-hosted source graph and run a generated
multi-module program.

The bootstrap is complete for the current self-hosted language slice. It is
not yet feature-complete with the TypeScript compiler; interfaces and other
language features outside the compiler's current source graph remain planned.

## Completed milestones

| ID | Milestone | Acceptance check | Status |
| --- | --- | --- | --- |
| B0 | Emitter core | Native emitter tests compile and pass | Complete |
| B1 | Nominal declarations | Emit and compile `selfhost/ast.do` and `selfhost/semantic.do` | Complete |
| B1a | Project bootstrap artifact | Check an imported graph and emit a monolithic C++ artifact | Complete |
| B2 | Rich core lowering | Emit parser/checker modules with loops, methods, construction, and collections | Complete |
| B3 | Module graph | Emit split modules with stable namespaces, includes, forward declarations, and imports | Complete |
| B4 | Compiler driver | Generated compiler accepts source files and writes generated C++ | Complete |
| B5 | First bootstrap | Generated compiler builds the self-hosted source graph and runs a smoke test | Complete |
| B6 | Two-stage bootstrap | The B5 compiler rebuilds the same graph and runs a second smoke test | Complete |

Completed language/emitter coverage includes nominal classes, named
construction, enums, aliases, nullable AST unions, branch-aware checking,
cross-module imports and re-exports, native C++ class imports, and focused
native C++ compilation tests.

## Verification

The maintained verification gates are:

- `npm run build`
- `npm test` — 2243 TypeScript tests passing
- `doof test selfhost/compiler.test.do` — 17 focused compiler/emitter tests
- `doof test selfhost/bootstrap.test.do` — four B2–B6 acceptance tests,
  including the two-stage bootstrap
- `src/selfhost-bootstrap.test.ts` — TypeScript-bootstrap native compilation
  of the self-hosted source graph

Focused self-host tests should remain small and should compile generated C++
when the behavior depends on C++ representation. The full bootstrap remains a
periodic integration check rather than the primary edit loop.

## Next steps

Work through these in order, keeping all existing gates green after each step:

1. **Implement interfaces.** Add self-hosted interface checking, closed-world
   implementation discovery, generated variant aliases, member dispatch, and
   JSON/metadata-compatible behavior where applicable.
2. **Make split emission the primary self-hosted path.** Move the driver and
   bootstrap acceptance path from monolithic `emitProject` output to the
   already-tested split module graph, then retain monolithic emission only as a
   compatibility/bootstrap fixture.
3. **Close native interop gaps.** Add self-hosted `import function` support and
   validate native build handoff behavior against representative headers,
   libraries, and exported interop modules.
4. **Expand source-graph coverage.** Compare the self-hosted and TypeScript
   compiler feature surfaces, then add the next missing parser/checker/emitter
   slice with a focused fixture and a native compilation test.
5. **Strengthen parity and release confidence.** Add repeatable differential
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
