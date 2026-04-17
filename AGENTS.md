# Agent Guidelines for Doof Development

This document provides guidance for AI agents and developers working on the Doof language compiler and tooling.

## Core Principles

### 0. Greenfields — No Backward Compatibility

**This is a greenfields project.** There are no external consumers yet, so backward compatibility of internal APIs is not a concern. Prefer clarity of implementation over preserving old interfaces. If a cleaner design emerges, refactor freely — just keep all tests passing.

### 1. Test-Driven Development is Mandatory

**Every feature must have comprehensive unit tests.**

- Write tests *first* when possible, or immediately after implementation
- Aim for high coverage of both happy paths and error cases
- Use descriptive test names that document behavior: `"resolves renamed imports"` not `"test1"`
- Group related tests in `describe` blocks for clarity
- Tests serve as executable documentation — make them readable

**Example from this project:**
- Analyzer tests (2 files) — 68 tests covering module-level symbol analysis
- Parser tests (3 files) — 220 tests covering expression, declaration, and statement parsing
- Checker tests (5 files) — 337 tests covering type inference, compatibility, validation, and features
- Emitter unit tests (6 files) — 529 tests covering C++ code generation
- Emitter e2e tests (5 files) — 239 tests that compile and run generated C++
- Each test is focused on a single behavior

### 2. Keep Source Files Small and Focused

**Each file should have one clear responsibility.**

Ideal file size: 200-500 lines. If a file exceeds ~700 lines, consider refactoring.

**Current structure demonstrates this:**
- [types.ts](src/types.ts) (208 lines) — Module-level type analysis data structures
- [checker-types.ts](src/checker-types.ts) (~920 lines) — Expression-level type data structures, compatibility, assignability, and JSON serializability checks
- [resolver.ts](src/resolver.ts) (121 lines) — ESM path resolution only
- [analyzer.ts](src/analyzer.ts) (523 lines) — Module-level symbol and type analysis
- [checker.ts](src/checker.ts) (~891 lines) — Type-checker orchestrator, type annotation resolution, generic inference, and expression inference core
- [checker-internal.ts](src/checker-internal.ts) (~130 lines) — Shared checker host contract and built-in checker constants
- [checker-stmt.ts](src/checker-stmt.ts) (~440 lines) — Statement dispatch, block checking, bindings, loops, else-narrow, and try statement entry
- [checker-decl.ts](src/checker-decl.ts) (~280 lines) — Function, class, and method checking
- [checker-member.ts](src/checker-member.ts) (~480 lines) — Member lookup, built-in members, JSON/metadata access, and positional field extraction
- [checker-result.ts](src/checker-result.ts) (~200 lines) — Result arm scopes, catch expressions, try propagation, and binding retyping
- [checker-expr-ops.ts](src/checker-expr-ops.ts) (~180 lines) — Binary/unary operator typing and enum expectation helpers
- [ast.ts](src/ast.ts) (700 lines) — AST node definitions with `Typed` mixin for resolved types
- [emitter.ts](src/emitter.ts) (~260 lines) — C++ transpiler orchestrator
- [emitter-types.ts](src/emitter-types.ts) (~250 lines) — ResolvedType → C++ type string mapping
- [emitter-expr.ts](src/emitter-expr.ts) (~240 lines) — Expression emission dispatcher (delegates to sub-modules)
- [emitter-expr-literals.ts](src/emitter-expr-literals.ts) (~100 lines) — Literal formatting and identifier sanitisation
- [emitter-expr-ops.ts](src/emitter-expr-ops.ts) (~240 lines) — Binary, unary, assignment, member, index expressions
- [emitter-expr-calls.ts](src/emitter-expr-calls.ts) (~300 lines) — Call and construct expressions
- [emitter-expr-control.ts](src/emitter-expr-control.ts) (~250 lines) — If, case, and catch expressions
- [emitter-expr-lambda.ts](src/emitter-expr-lambda.ts) (~660 lines) — Lambda emission and capture analysis
- [emitter-expr-utils.ts](src/emitter-expr-utils.ts) (~50 lines) — Shared resolveTypeAnnotation helper
- [emitter-stmt.ts](src/emitter-stmt.ts) (~910 lines) — Statement dispatch, variable bindings, try/catch, control flow, else-narrow
- [emitter-decl.ts](src/emitter-decl.ts) (~410 lines) — Function, class, interface, enum, and type alias emission
- [emitter-json.ts](src/emitter-json.ts) (~395 lines) — JSON serialization/deserialization code generation
- [emitter-schema.ts](src/emitter-schema.ts) (~200 lines) — JSON Schema Draft 7 generation for class metadata
- [emitter-metadata.ts](src/emitter-metadata.ts) (~200 lines) — C++ emission for .metadata field and .invoke() method
- [emitter-runtime.ts](src/emitter-runtime.ts) (~350 lines) — doof_runtime.hpp generation
- [emitter-module.ts](src/emitter-module.ts) (~940 lines) — Module splitting (.hpp/.cpp), main() wrapper, project support files

**When a module grows too large:**
1. Identify cohesive subsets of functionality
2. Extract to new files with clear boundaries
3. Update imports and exports
4. Ensure tests still pass

### 3. Simplicity Over Cleverness

**Prefer straightforward, readable code.**

- Avoid premature optimization
- Use clear variable names (`sourceModule` not `sm`)
- Favor explicit over implicit
- Comment non-obvious design decisions, not obvious code
- Use TypeScript's type system to make invalid states unrepresentable

**Examples of simplicity:**
```typescript
// Good: Clear intent
if (BUILTIN_TYPE_NAMES.has(name)) return;

// Avoid: Clever but obscure
if (~[...builtins].indexOf(name)) return;
```

**Organize by phases when appropriate:**
```typescript
// analyzer.ts uses a clear 4-phase structure:
// Phase 1: Collect symbols
// Phase 2: Resolve imports  
// Phase 3: Re-exports
// Phase 4: Resolve NamedTypes
```

### 4. Interfaces Over Implementation

**Abstract external dependencies behind interfaces.**

This enables:
- Easy testing with mocks/fakes
- Swappable implementations
- Clear contracts

**Example:**
```typescript
// resolver.ts defines FileSystem interface
export interface FileSystem {
  readFile(absolutePath: string): string | null;
  fileExists(absolutePath: string): boolean;
}

// Tests use VirtualFS implementation
class VirtualFS implements FileSystem { ... }
```

### 5. Comprehensive Error Handling

**Every failure mode should be tested and produce helpful diagnostics.**

- Collect diagnostics rather than throwing immediately when possible
- Include source location (span) in error messages
- Test error cases explicitly
- Provide actionable error messages

**Example from analyzer.ts:**
```typescript
table.diagnostics.push({
  severity: "error",
  message: `Module "${importDecl.source}" does not export "${sourceName}"`,
  span: spec.span,
  module: table.path,
});
```

## Project Structure Conventions

### File Organization

```
src/
  ast.ts                        # AST node type definitions
  lexer.ts                      # Tokenization
  lexer.test.ts                 # Lexer tests
  parser.ts                     # Parser implementation
  parser-expr.test.ts           # Parser tests: expressions
  parser-decl.test.ts           # Parser tests: declarations
  parser-stmt.test.ts           # Parser tests: statements & advanced
  types.ts                      # Module-level analysis data structures
  checker-types.ts              # Expression-level type data structures
  resolver.ts                   # Module path resolution
  analyzer.ts                   # Module-level symbol analysis
  analyzer-test-helpers.ts      # Shared analyzer test utilities
  analyzer-basics.test.ts       # Analyzer tests: symbols, imports, re-exports
  analyzer-advanced.test.ts     # Analyzer tests: AST decoration, extern, private
  checker.ts                    # Type-checker orchestrator + expression inference core
  checker-internal.ts           # Shared checker host contract and built-ins
  checker-stmt.ts               # Statement-level checking
  checker-decl.ts               # Function/class/method checking
  checker-member.ts             # Member lookup and built-in member typing
  checker-result.ts             # Result/catch/try propagation helpers
  checker-expr-ops.ts           # Binary and unary operator typing helpers
  checker-test-helpers.ts       # Shared checker test utilities
  checker-inference.test.ts     # Checker tests: type inference & scope
  checker-compat.test.ts        # Checker tests: type compatibility & validation
  checker-validation.test.ts    # Checker tests: assignment, null, AST decoration
  checker-features.test.ts      # Checker tests: Result, concurrency, JSON, with
  emitter.ts                    # C++ transpiler orchestrator
  emitter-types.ts              # ResolvedType → C++ type mapping
  macos-app-support.ts          # Browser-safe macOS app support file generation helpers
  stdlib-constants.ts           # Browser-safe stdlib constants shared by emitters and loaders
  emitter-expr.ts               # Expression emission dispatcher
  emitter-expr-literals.ts      # Literal formatting and identifier sanitisation
  emitter-expr-ops.ts           # Binary, unary, assignment, member, index expressions
  emitter-expr-calls.ts         # Call and construct expressions
  emitter-expr-control.ts       # If, case, and catch expressions
  emitter-expr-lambda.ts        # Lambda emission and capture analysis
  emitter-expr-utils.ts         # Shared resolveTypeAnnotation helper
  emitter-context.ts            # Shared EmitContext type
  emitter-stmt.ts               # Statement dispatch, variable bindings, control flow
  emitter-decl.ts               # Function, class, interface, enum, type alias emission
  emitter-json.ts               # JSON serialization/deserialization code generation
  emitter-schema.ts             # JSON Schema Draft 7 generation for class metadata
  emitter-metadata.ts           # C++ emission for .metadata field and .invoke() method
  emitter-runtime.ts            # doof_runtime.hpp generation
  emitter-module.ts             # Module splitting (.hpp/.cpp), main() wrapper, project support files
  emitter-test-helpers.ts       # Shared emitter test utilities
  emitter-basics.test.ts        # Emitter tests: primitives, declarations, control flow
  emitter-constructs.test.ts    # Emitter tests: destructuring, lambdas, patterns
  emitter-modules.test.ts       # Emitter tests: module system, namespace, extern
  emitter-schema.test.ts        # Emitter tests: JSON Schema generation
  emitter-metadata.test.ts      # Emitter tests: metadata field and invoke method
  emitter-advanced.test.ts      # Emitter tests: Result, JSON, null, private
  e2e-test-helpers.ts           # E2E test utilities (compile & run C++)
  emitter-e2e-compile.test.ts   # E2E tests: compilation & basic run
  emitter-e2e-features.test.ts  # E2E tests: destructuring, closures, recursion
  emitter-e2e-modules.test.ts   # E2E tests: module splitting, extern, namespace
  emitter-e2e-advanced.test.ts  # E2E tests: concurrency, try/catch, JSON, else-narrow
  emitter-e2e-combos.test.ts    # E2E tests: feature combinations & boundaries
  test-helpers.ts               # Shared test utilities (VirtualFS)
  index.ts                      # Public API exports
```

**Rules:**
- Test files live next to implementation files, split by concern: `foo-basics.test.ts`, `foo-advanced.test.ts`
- Shared test helpers go in `*-test-helpers.ts` files
- Keep [index.ts](src/index.ts) minimal — just re-exports
- Use `.js` extensions in imports (ESM requirement)

### Naming Conventions

- **Types/Interfaces:** PascalCase (`ModuleSymbol`, `TypeAnnotation`)
- **Functions/Variables:** camelCase (`parseStatement`, `currentToken`)
- **Constants:** SCREAMING_SNAKE_CASE for true constants (`BUILTIN_TYPE_NAMES`)
- **Private methods:** Prefix with `private`, use camelCase (`private resolveImports`)

### Import Organization

Group imports logically:
```typescript
// 1. Node built-ins
import * as nodePath from "node:path";

// 2. Project files
import { parse } from "./parser.js";
import type { Program, Statement } from "./ast.js";
import { BUILTIN_TYPE_NAMES } from "./types.js";
```

## Adding New Features

### Checklist for New Features

- [ ] Design the data structures in a dedicated types file if substantial
- [ ] Implement in a focused source file (< 500 lines if possible)
- [ ] Write comprehensive unit tests (aim for 80%+ coverage)
- [ ] Test error cases and edge cases
- [ ] Add JSDoc comments for public APIs
- [ ] Export from [index.ts](src/index.ts) if part of public API
- [ ] **Update the relevant `spec/` file** to document language behaviour
- [ ] **Update [.github/skills/doof-language/SKILL.md](.github/skills/doof-language/SKILL.md)** when Doof syntax, semantics, or examples change
- [ ] Run full test suite: `npm test`
- [ ] Check for TypeScript errors: `npm run build`
- [ ] Update this document if adding architectural patterns

### When Adding Language Features

1. **Update AST** ([ast.ts](src/ast.ts))
   - Add new node types to appropriate sections
   - Include `span: SourceSpan` for all nodes
   
2. **Update Lexer** if adding new tokens ([lexer.ts](src/lexer.ts))
   - Add token type to `TokenType` enum
   - Update tokenization logic
   - Add lexer tests
   
3. **Update Parser** ([parser.ts](src/parser.ts))
   - Add parsing logic for new constructs
   - Add parser tests with multiple examples
   
4. **Update Analyzer** for module-level types ([analyzer.ts](src/analyzer.ts))
   - Extend symbol collection if needed
   - Extend NamedType resolution if needed
   - Add analyzer tests

5. **Update Type Checker** for expression-level types ([checker.ts](src/checker.ts))
   - Extend expression type inference if needed
   - Update scope building for new binding forms
   - Add checker tests

## Testing Guidelines

### Test Structure

Use the AAA pattern (Arrange, Act, Assert):

```typescript
it("resolves renamed imports", () => {
  // Arrange
  const result = analyze({
    "/main.do": `import { Vector as Vec3 } from "./math"`,
    "/math.do": `export class Vector { x, y, z: float }`,
  }, "/main.do");

  // Act
  const table = result.modules.get("/main.do")!;

  // Assert
  expect(table.imports[0].localName).toBe("Vec3");
  expect(table.imports[0].sourceName).toBe("Vector");
});
```

### Test Coverage Priorities

1. **Happy path** — Feature works as designed
2. **Boundary cases** — Empty input, single item, maximum size
3. **Error cases** — Invalid input, missing dependencies, malformed data
4. **Integration** — Multiple features interacting correctly

### Helper Functions

Create test helpers to reduce boilerplate:

```typescript
function analyze(files: Record<string, string>, entry: string) {
  const fs = new VirtualFS(files);
  const analyzer = new ModuleAnalyzer(fs);
  return analyzer.analyzeModule(entry);
}
```

## Common Patterns

### Phase-Based Processing

Complex operations should be broken into clear phases:

```typescript
class Analyzer {
  analyze() {
    this.phase1_collectSymbols();
    this.phase2_resolveImports();
    this.phase3_resolveTypes();
  }
}
```

### Visitor Pattern

For AST traversal, use explicit recursion with switch on node kind:

```typescript
private walkNode(node: Node) {
  switch (node.kind) {
    case "class-declaration":
      this.handleClass(node);
      break;
    case "function-declaration":
      this.handleFunction(node);
      break;
    // ...
  }
}
```

### Diagnostic Collection

Collect errors rather than throwing exceptions when multiple issues may exist:

```typescript
interface Context {
  diagnostics: Diagnostic[];
}

function validate(node: Node, ctx: Context) {
  if (hasError1) ctx.diagnostics.push({ ... });
  if (hasError2) ctx.diagnostics.push({ ... });
}
```

## Performance Considerations

- **Defer optimization** until profiling shows a bottleneck
- **Use Maps/Sets** for O(1) lookups over arrays
- **Cache expensive computations** when safe
- **Avoid deep recursion** for user-controlled input
- **Use early returns** to avoid unnecessary work

## Documentation

### Code Comments

- Document *why*, not *what* (code shows what)
- Add file-level JSDoc explaining module purpose
- Add JSDoc to public APIs
- Mark TODOs with context: `// TODO(username): explain why`

### Commit Messages

- Use conventional commits: `feat:`, `fix:`, `test:`, `refactor:`
- First line: concise summary (50 chars)
- Body: explain *why* and *what*, not *how*

## Questions?

When uncertain about design decisions:

1. **Look for existing patterns** in the codebase
2. **Prioritize simplicity** — the simplest working solution is often best
3. **Write the test first** — it clarifies requirements
4. **Keep files small** — if you can split it, do
5. **When in doubt, ask** — leave a TODO comment explaining the uncertainty

## Compiler Architecture

### Analysis Pipeline

The Doof compiler uses a multi-phase analysis pipeline:

**Phase 1 — Lexing & Parsing** ([lexer.ts](src/lexer.ts), [parser.ts](src/parser.ts))
- Tokenize source into a stream of tokens
- Parse tokens into an AST ([ast.ts](src/ast.ts))
- Each node includes a `SourceSpan` for error reporting

**Phase 2 — Module-Level Analysis** ([analyzer.ts](src/analyzer.ts))
- Collect top-level symbols (classes, functions, etc.) into module symbol tables
- Resolve ESM-style imports transitively across modules
- Process re-exports (`export { } from`, `export *`)
- Resolve `NamedType` references in type annotations to their declarations
- **Decorate `NamedType` AST nodes** with `resolvedSymbol` pointing to the resolved declaration
- Output: `AnalysisResult` with `modules` map and `diagnostics`

**Phase 3 — Expression-Level Type Checking** ([checker.ts](src/checker.ts), [checker-stmt.ts](src/checker-stmt.ts), [checker-decl.ts](src/checker-decl.ts), [checker-member.ts](src/checker-member.ts), [checker-result.ts](src/checker-result.ts), [checker-expr-ops.ts](src/checker-expr-ops.ts))
- Build nested scopes for functions, methods, blocks
- Infer types for all expressions (literals, binary ops, calls, member access, etc.)
- Track provenance for every identifier reference (const/let/parameter/import/field)
- Apply type widening rules (int→long, float→double)
- Handle implicit `this` in methods, parameter shadowing
- **Decorate AST nodes** directly with resolved type information:
  - Every `Expression` gets `resolvedType: ResolvedType`
  - `Identifier` nodes get `resolvedBinding: Binding` for provenance
  - Variable declarations, parameters, class fields get `resolvedType`
  - Function/method declarations get `resolvedType` as their full function type
- Output: `ModuleTypeInfo` with `diagnostics`

**Data Flow:**
```
Source Code
    ↓
  Lexer → Tokens
    ↓
  Parser → AST (Program)
    ↓
  Analyzer → AnalysisResult (module symbols, import graph, NamedType resolutions)
             NamedType nodes decorated with resolvedSymbol
    ↓
  TypeChecker → ModuleTypeInfo (diagnostics)
                AST nodes decorated with resolvedType and resolvedBinding
    ↓
  Emitter → C++ source code (.cpp files)
            Walks decorated AST, emits equivalent C++
```

**Phase 4 — C++ Emission** ([emitter.ts](src/emitter.ts), [emitter-types.ts](src/emitter-types.ts), [emitter-expr.ts](src/emitter-expr.ts), [emitter-stmt.ts](src/emitter-stmt.ts), [emitter-decl.ts](src/emitter-decl.ts), [emitter-json.ts](src/emitter-json.ts), [emitter-schema.ts](src/emitter-schema.ts), [emitter-metadata.ts](src/emitter-metadata.ts))
- Map Doof types to C++ types (int→int32_t, classes→shared_ptr, interfaces→variant, etc.)
- Walk decorated AST nodes and emit equivalent C++ source text
- Pre-compute interface→implementing-classes map for closed-world variant dispatch
- Auto-generate `toJSON()`/`fromJSON()` methods for classes with all-serializable fields using the runtime `JsonValue` parser/stringifier
- Generate interface-level `fromJSON` dispatchers using shared const discriminator fields
- On-demand `_metadata` (JSON Schema) and `invoke()` (JSON dispatch) for tool interop ([emitter-schema.ts](src/emitter-schema.ts), [emitter-metadata.ts](src/emitter-metadata.ts))
- Generate `doof_runtime.hpp` support header ([emitter-runtime.ts](src/emitter-runtime.ts))
- Output: split C++ modules plus generated runtime/support files for the CLI pipeline

### Decorated AST Pattern

After analysis and type-checking, the AST is **decorated in-place** with resolved
type information. This eliminates the need to replicate type analysis during
compilation — all information is directly on the nodes:

```typescript
// All expressions extend the Typed mixin (resolvedType?: ResolvedType)
const binExpr = stmt.value as BinaryExpression;
binExpr.resolvedType;       // "string" — the result type
binExpr.left.resolvedType;  // "string" — left operand type
binExpr.right.resolvedType; // "int" — right operand type

// Identifiers also carry their binding resolution
const ident = expr as Identifier;
ident.resolvedBinding;      // { kind: "const", type: ..., mutable: false, ... }

// NamedType nodes carry their resolved symbol
const namedType = param.type as NamedType;
namedType.resolvedSymbol;   // { symbolKind: "class", name: "Vector", ... }

// Declarations carry their resolved types
const fn = stmt as FunctionDeclaration;
fn.resolvedType;            // { kind: "function", params: [...], returnType: ... }
fn.params[0].resolvedType;  // parameter's resolved type
```

**Key decorated AST nodes:**
- `Expression` (all subtypes) → `resolvedType?: ResolvedType`
- `Identifier` → `resolvedBinding?: Binding`
- `NamedType` → `resolvedSymbol?: ModuleSymbol`
- `Parameter`, `ClassField`, `InterfaceField`, `InterfaceMethod` → `resolvedType?: ResolvedType`
- `FunctionDeclaration`, `ConstDeclaration`, `ReadonlyDeclaration`, `ImmutableBinding`, `LetDeclaration` → `resolvedType?: ResolvedType`

All type information is accessed directly from the decorated AST nodes. There are
no separate lookup maps — the AST is the single source of truth after analysis.

### Separation of Concerns

**Module-level vs Expression-level:**
- **[analyzer.ts](src/analyzer.ts)** operates at module granularity — it knows about exports, imports, and top-level declarations
- **[checker.ts](src/checker.ts)** owns type-checker orchestration, generic resolution, and the core expression dispatcher
- **[checker-stmt.ts](src/checker-stmt.ts)** and **[checker-decl.ts](src/checker-decl.ts)** own statement/declaration checking, while **[checker-member.ts](src/checker-member.ts)** and **[checker-result.ts](src/checker-result.ts)** isolate specialized typing rules
- This separation keeps each phase focused and testable

**Type representations:**
- **[types.ts](src/types.ts)** — `ModuleSymbol`, `ModuleSymbolTable`, `ResolvedImport`
- **[checker-types.ts](src/checker-types.ts)** — `ResolvedType`, `Binding`, `Scope`, `ModuleTypeInfo`
- **[ast.ts](src/ast.ts)** — `Typed` mixin provides `resolvedType?: ResolvedType` to all typed AST nodes
- AST `TypeAnnotation` nodes are syntactic; `ResolvedType` values are semantic
- After type checking, AST nodes carry their semantic types directly via `resolvedType`

---

## Keeping This Document Updated

**This document is a living guide.** When you make significant changes to the codebase, update AGENTS.md:

### When to Update

- **Adding new files** — Update the file organization section with the new module's purpose and line count range
- **Adding new architectural patterns** — Document the pattern in the "Common Patterns" section with an example
- **Changing the analysis pipeline** — Update the "Compiler Architecture" section to reflect new phases or data flows
- **Updating test counts** — Keep the test count examples current when adding/removing test suites
- **Introducing new conventions** — Add to the appropriate section (naming, imports, etc.)
- **Adding, removing, or restricting language features** — Update the relevant `spec/` file to keep language behaviour documented
- **Changing user-facing Doof language behaviour** — Update [.github/skills/doof-language/SKILL.md](.github/skills/doof-language/SKILL.md) so examples and guidance match the compiler

### How to Update

1. **Edit in place** — Modify the relevant sections directly
2. **Keep examples current** — Update code snippets if APIs change
3. **Maintain consistency** — Match the existing tone and structure
4. **Be concise** — This is a reference guide, not a tutorial
5. **Keep the skill aligned** — If AGENTS.md or `spec/` changes language behaviour, update [.github/skills/doof-language/SKILL.md](.github/skills/doof-language/SKILL.md) in the same change
6. **Test your updates** — Ensure file paths and line counts are accurate

### What NOT to Include

- Implementation details that change frequently
- Step-by-step tutorials (those belong in separate docs)
- Exhaustive API documentation (use JSDoc in source files)
- Personal preferences (stick to project-wide conventions)

**Remember:** This document serves future agents and developers. Keep it accurate, concise, and actionable.

---

**Remember:** Code is read far more often than it's written. Optimize for future maintainers (including your future self and other agents).
