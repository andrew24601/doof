# Doof Transpiler Architecture

This document provides a detailed breakdown of the transpiler's source code structure and module responsibilities.

## High-Level Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Source    │────▶│    Parser    │────▶│  Validator   │────▶│   Codegen    │
│   (.do file) │     │    (AST)     │     │(Type Checked)│     │   (Output)   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

The transpiler follows a classic compiler pipeline:
1. **Lexing** - Convert source text to tokens
2. **Parsing** - Build Abstract Syntax Tree (AST)
3. **Validation** - Type checking and semantic analysis
4. **Code Generation** - Emit target language code (C++, JS, or VM bytecode)

---

## Source Directory (`src/`)

### Entry Points

| File | Description |
|------|-------------|
| `cli.ts` | Command-line interface. Handles argument parsing, file I/O, and orchestrates transpilation. Supports `--target` (cpp/js/vm), `--format`, `--run`, and other options. |
| `index.ts` | Library entry point for programmatic API usage. |
| `transpiler.ts` | Main `Transpiler` class that coordinates parsing, validation, and code generation. Supports single-file and multi-file compilation with dependency resolution. |

### Core Infrastructure

| File | Description |
|------|-------------|
| `types.ts` | Core type definitions for the entire transpiler: AST node types, type system nodes (`PrimitiveTypeNode`, `ArrayTypeNode`, `ClassTypeNode`, etc.), and validation context interfaces. |
| `codegen-interface.ts` | `ICodeGenerator` interface defining the contract for all code generators. Enables multiple target language support. |
| `namespace-mapper.ts` | Handles namespace resolution for imports and qualified type names. |
| `type-utils.ts` | Shared type manipulation utilities. |
| `logger.ts` | Logging infrastructure with configurable verbosity levels. |
| `formatter.ts` | Source code formatter for `.do` files. |
| `vm-glue-writer.ts` | Generates glue code for VM interop. |
| `fluent-interface-utils.ts` | Utilities for detecting and handling fluent interface patterns. |

---

## Parser (`src/parser/`)

The parser converts source text to an AST. It's split into focused modules for maintainability.

| File | Description |
|------|-------------|
| `lexer.ts` | Tokenizer that converts source text to a stream of tokens. Handles all lexical analysis including string interpolation, operators, and keywords. |
| `parser.ts` | Main `Parser` class orchestrating the parsing process. Manages token stream and error recovery. |
| `parser-declarations.ts` | Parses top-level declarations: classes, functions, enums, type aliases, extern declarations. |
| `parser-statements.ts` | Parses statements: if/while/for/switch, return, break/continue, blocks. |
| `parser-expression.ts` | Parses expressions: binary/unary ops, calls, member access, literals, lambdas. |
| `parser-types.ts` | Parses type annotations: primitives, arrays, maps, sets, unions, function types. |
| `parser-parameters.ts` | Parses function/method parameters and argument lists. |
| `parser-patterns.ts` | Parses destructuring patterns for variable declarations. |
| `parser-imports.ts` | Parses import/export declarations. |
| `parser-xml.ts` | Parses XML/JSX-like syntax for UI components. |
| `parser-markdown.ts` | Parses embedded markdown syntax. |
| `nested-function-desugar.ts` | Transforms nested functions into a form suitable for code generation. |

---

## Validation (`src/validation/`)

The validator performs type checking and semantic analysis. Produces a `ValidationContext` with type information for code generation.

### Core Validation

| File | Description |
|------|-------------|
| `validator.ts` | Main `Validator` class. Manages validation context, intrinsic registry, and coordinates all validation passes. |
| `statement-validator.ts` | Validates statements and program structure. |
| `expression-validator.ts` | Validates expressions and infers their types. |
| `declaration-validator.ts` | Validates declarations and builds symbol tables. |

### Specialized Validators

| File | Description |
|------|-------------|
| `binary-expression-validator.ts` | Type checking for binary operators (+, -, *, /, comparisons, etc.). |
| `call-expression-validator.ts` | Validates function/method calls, argument types, and overload resolution. |
| `lambda-validator.ts` | Validates lambda expressions, parameter types, and closure captures. |
| `lambda-capture-analyzer.ts` | Analyzes which variables lambdas capture and how (by value/reference). |
| `collection-validator.ts` | Validates array, map, and set operations. |
| `literals-validator.ts` | Validates literal expressions (numbers, strings, objects, arrays). |
| `member-access-validator.ts` | Validates property access and method calls on objects. |
| `null-safety-validator.ts` | Validates null-safety operators (`?.`, `??`, `!`). |
| `type-narrowing-validator.ts` | Handles type narrowing in conditionals and type guards. |
| `type-conversion-validator.ts` | Validates explicit and implicit type conversions. |
| `object-literal-validator.ts` | Validates object literal construction and property types. |
| `intrinsics-validator.ts` | Defines and validates built-in intrinsic functions (Math, Array methods, etc.). |
| `xml-call-validator.ts` | Validates XML/JSX-like syntax. |
| `async-validator.ts` | Validates async/await syntax. |
| `unary-conditional-validator.ts` | Validates unary operators and conditional expressions. |
| `special-expressions-validator.ts` | Handles special expression forms. |

### Analysis & Transformation

| File | Description |
|------|-------------|
| `definite-assignment.ts` | Ensures variables are assigned before use. |
| `desugar.ts` | Transforms high-level constructs into simpler forms (e.g., interfaces to structural types). |
| `pattern-desugar.ts` | Transforms destructuring patterns. |
| `narrowing-utils.ts` | Utilities for type narrowing analysis. |
| `scope-tracker-helpers.ts` | Helpers for tracking variable scopes. |
| `type-substitution.ts` | Handles generic type parameter substitution. |
| `structural.ts` | Structural type comparison and compatibility. |
| `validate-iter.ts` | Validates iterator protocols. |
| `validate-markdown-table.ts` | Validates markdown table syntax. |

---

## Code Generation (`src/codegen/`)

Code generators implement `ICodeGenerator` to emit target language code.

### Generator Entry Points

| File | Description |
|------|-------------|
| `cppgen.ts` | `CppGenerator` - Orchestrates C++ code generation. Produces header (.h) and source (.cpp) files. |
| `jsgen.ts` | `JsGenerator` - Generates JavaScript with source maps. |
| `vmgen.ts` | `VMGenerator` - Generates VM bytecode (.vmbc JSON format). |
| `vm-glue-generator.ts` | Generates glue code for VM/native interop. |

### Shared Utilities (`src/codegen/shared/`)

| File | Description |
|------|-------------|
| `numeric-literal-utils.ts` | Handles numeric literal formatting across targets. |
| `static-method-utils.ts` | Utilities for static method handling. |
| `type-coercion.ts` | Common type coercion logic. |

### C++ Backend (`src/codegen/cpp/`)

| File | Description |
|------|-------------|
| `cpp-type-codegen.ts` | Generates C++ type representations (shared_ptr, vector, map, etc.). |
| `cpp-expression-codegen.ts` | Main expression code generation dispatcher. |
| `cpp-statement-codegen.ts` | Statement code generation (if, while, for, switch, etc.). |
| `cpp-class-decl-codegen.ts` | Class declaration generation including JSON serialization. |
| `cpp-function-decl-codegen.ts` | Function and method declaration generation. |
| `cpp-enum-decl-codegen.ts` | Enum declaration generation. |
| `cpp-type-alias-codegen.ts` | Type alias (using) generation. |
| `cpp-code-organization.ts` | Header/source organization, forward declarations, namespace wrapping. |
| `cpp-utility-functions.ts` | Helper functions for C++ code generation. |

#### C++ Expression Generators (`src/codegen/cpp/expressions/`)

| File | Description |
|------|-------------|
| `binary-unary-generators.ts` | Binary and unary operator code generation. |
| `literal-identifier-generators.ts` | Literals and identifiers. |
| `method-call-generators.ts` | Method and function call generation. |
| `object-array-generators.ts` | Object and array literal generation. |
| `type-conversion-generators.ts` | Type cast and conversion generation. |
| `lambda-control-flow-generators.ts` | Lambda and control flow expressions. |
| `utility-special-generators.ts` | Special and utility expressions. |
| `chain-flattener.ts` | Flattens optional chaining for C++ output. |

### JavaScript Backend (`src/codegen/js/`)

| File | Description |
|------|-------------|
| `js-expression-codegen.ts` | JavaScript expression generation. |
| `js-statement-codegen.ts` | JavaScript statement generation. |
| `expressions/js-type-conversion-generators.ts` | JS type conversion handling. |

### VM Backend (`src/codegen/vm/`)

| File | Description |
|------|-------------|
| `register-allocator.ts` | Register allocation for VM bytecode. |
| `vmgen-emit.ts` | Bytecode emission utilities. |
| `vmgen-expression-codegen.ts` | Expression bytecode generation. |
| `vmgen-statement-codegen.ts` | Statement bytecode generation. |
| `vmgen-literal-codegen.ts` | Literal value bytecode generation. |
| `vmgen-binary-codegen.ts` | Binary operator bytecode. |
| `vmgen-call-codegen.ts` | Function call bytecode. |
| `vmgen-lambda-codegen.ts` | Lambda/closure bytecode. |
| `vmgen-capture-utils.ts` | Capture analysis for closures. |
| `vmgen-conditional-codegen.ts` | Conditional/branching bytecode. |
| `vmgen-object-codegen.ts` | Object construction bytecode. |
| `vmgen-array-intrinsics.ts` | Array method intrinsics. |
| `vmgen-iter.ts` | Iterator protocol bytecode. |
| `vmgen-class-utils.ts` | Class-related bytecode utilities. |
| `vmgen-type-utils.ts` | Type utilities for VM codegen. |

---

## Project Infrastructure (`src/project/`)

Multi-file compilation support.

| File | Description |
|------|-------------|
| `dependency-resolver.ts` | Resolves import dependencies and determines compilation order. |
| `extern-metadata.ts` | Collects metadata from extern declarations for interop. |
| `generic-instantiator.ts` | Instantiates generic types and functions. |
| `monomorphizer.ts` | Monomorphizes generic code for targets that don't support generics (C++, VM). |

---

## Formatter (`src/formatter/`)

Source code formatter for `.do` files.

| File | Description |
|------|-------------|
| `index.ts` | Formatter entry point. |
| `options.ts` | Formatting configuration options. |
| `printer.ts` | Core printing logic with indentation handling. |
| `expression-formatter.ts` | Expression formatting. |
| `statement-formatter.ts` | Statement formatting. |
| `type-formatter.ts` | Type annotation formatting. |

---

## Test Directory (`test/`)

Tests use vitest. Organized by feature area.

| Directory/Pattern | Description |
|-------------------|-------------|
| `*.spec.ts` | Unit tests for specific features. |
| `codegen/` | Code generation tests. |
| `parser/` | Parser tests. |
| `validation/` | Validation tests. |
| `desugar/` | Desugaring transformation tests. |
| `language/` | Language feature tests. |
| `helpers/` | Test utilities and helpers. |
| `util.ts` | Shared test utilities. |

---

## Integration Tests (`integration/`)

End-to-end tests that compile and execute generated code.

| File/Directory | Description |
|----------------|-------------|
| `run-tests.ts` | Integration test runner. |
| `test-utils.ts` | Integration test utilities. |
| `test-data/` | Source files for integration tests. |
| `expected/` | Expected output files. |
| `generated/` | Generated output (gitignored). |
| `vm-tests/` | VM-specific integration tests. |

---

## VM Runtime (`vm/`)

C++ implementation of the VM that executes `.vmbc` bytecode.

| Directory | Description |
|-----------|-------------|
| `src/` | VM source code. |
| `include/` | VM headers. |
| `tests/` | VM unit tests. |
| `vm/` | Additional VM modules. |
| `scripts/` | Build scripts. |
| `build/` | CMake build output. |

Build with CMake (see README.md for details).

---

## Other Directories

| Directory | Description |
|-----------|-------------|
| `docs/` | Documentation (syntax.md, lambdas.md, etc.). |
| `enhancements/` | TODO.md and feature planning documents. |
| `temp/` | Temporary files for development/testing. |
| `build/` | C++ build artifacts (from transpiled code). |
| `dist/` | npm build output (transpiler JS). |
| `vscode-extension/` | VS Code extension for doof syntax. |
| `unity/` | Unity integration. |
| `ios/` | iOS integration. |

---

## Data Flow

### Single File Compilation

```
1. cli.ts parses command line arguments
2. Transpiler.transpile(source) is called
3. Lexer tokenizes source text
4. Parser builds AST (Program)
5. Validator type-checks and produces ValidationContext
6. CodeGenerator (cpp/js/vm) emits output
7. cli.ts writes output files
```

### Multi-File Compilation

```
1. cli.ts identifies input files
2. Transpiler.transpileMultiFile(files) is called
3. dependency-resolver.ts determines compilation order
4. Each file is parsed and validated with shared GlobalValidationContext
5. monomorphizer.ts instantiates generics
6. CodeGenerator emits output for each file
7. cli.ts writes output files
```

---

## Key Design Patterns

1. **Visitor Pattern** - Validators and generators traverse AST nodes using switch statements on `node.kind`.

2. **Strategy Pattern** - `ICodeGenerator` interface allows pluggable code generators.

3. **Context Objects** - `ValidationContext` and `GlobalValidationContext` carry state through the compilation pipeline.

4. **Modular Decomposition** - Large concerns (parser, validator, codegen) are split into focused files to maintain manageable file sizes.

5. **Fail Fast** - Prefer explicit errors over fallback behavior to catch issues early.
