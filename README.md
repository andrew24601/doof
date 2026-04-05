# Doof

Doof is a statically typed programming language that transpiles to C++. The current repository contains the compiler, CLI, language specification, samples, and a small playground.

The language is designed around a few core ideas:

- static typing with inference where it stays predictable
- immutable-by-default programming
- explicit nullability via union types
- `Result`-based error handling instead of exceptions
- pattern matching, modules, classes, interfaces, and concurrency features
- closed-world compilation so the compiler can analyze the whole program before emitting C++

## Very Brief Language Overview

Doof syntax is intentionally close to JavaScript and TypeScript, but the semantics are stricter. Types are checked ahead of time, mutation is opt-in, and common footguns like implicit null are avoided.

Example:

```javascript
function main(): int {
  println("Hello, Doof!")
  return 0
}
```

Some notable language traits:

- `const`, `readonly`, and `let` make mutability explicit
- `T | null` represents nullable values
- `Result<T, E>` integrates with `try`, `try!`, `try?`, and `??`
- `case` expressions support pattern matching and type narrowing
- modules use static `import` and `export`

For the full language reference, see the files under `spec/`.

## Repository Contents

- `src/`: compiler, checker, emitter, CLI, and tests
- `samples/`: small example Doof programs
- `spec/`: language specification
- `playground/`: browser playground
- `build/` and `build-apple/`: generated C++ output examples

## Getting Started

Each compilable Doof project now has a `doof.json` file at its root. The compiler discovers the project root by walking upward from the entry `.do` file.

Minimal example:

```json
{
  "name": "hello-doof",
  "version": "0.1.0",
  "license": "MIT",
  "dependencies": {}
}
```

Local package dependencies point at another Doof package directory:

```json
{
  "dependencies": {
    "boardgame": {
      "path": "../lib/cardgame"
    }
  }
}
```

Remote package dependencies point at a git repository URL plus a version string:

```json
{
  "dependencies": {
    "hello-doof": {
      "url": "https://github.com/andrew24601/hello-doof",
      "version": "0.1"
    }
  }
}
```

The compiler materializes remote packages into `~/.doof/packages/` by default. It currently clones a git tag matching either the declared version or `v<version>`, so `"version": "0.1"` resolves a `v0.1` tag.

Packages can also declare native build inputs under `build.native`. These values propagate transitively through package dependencies and are merged into both generated `CMakeLists.txt` output and the emitted external build manifest:

```json
{
  "build": {
    "targetExecutableName": "demo-app",
    "native": {
      "includePaths": ["./native/include"],
      "sourceFiles": ["./native/bridge.cpp"],
      "libraryPaths": ["./native/lib"],
      "linkLibraries": ["curl"],
      "frameworks": ["Foundation"],
      "defines": ["USE_DEMO=1"],
      "compilerFlags": ["-O2"],
      "linkerFlags": ["-pthread"]
    }
  }
}
```

For v1, package-native path entries are resolved relative to the declaring package root and must stay within that package. This keeps remote packages self-contained when they are materialized into `~/.doof/packages/`.

Requirements:

- Node.js
- npm
- a native C++ compiler if you want to use `doof build`, `doof run`, or `doof test`

On macOS and Linux, the CLI auto-detects `clang++`, `g++`, or `c++`.

On Windows, the CLI auto-detects Visual Studio's `cl.exe` and configures the required MSVC environment automatically when Visual Studio is installed with the C++ tools workload.

Install the CLI into a project:

```bash
npm install --save-dev doof
```

Run it with `npx`:

```bash
npx doof --help
```

If you prefer a global install:

```bash
npm install --global doof
doof --help
```

If you are working on the compiler repository itself, build the local CLI:

```bash
npm install
npm run build
```

Run the CLI directly from the built output:

```bash
node dist/cli.js --help
```

You can also use the package bin after linking or installing the package in a Node environment:

```bash
doof --help
```

## CLI

The CLI transpiles Doof source files to C++, optionally compiles the generated project, and can run the resulting binary.

### Usage

```text
doof <command> [options] <entry.do | path>
```

### Commands

| Command | Description |
| --- | --- |
| `emit <entry.do>` | Emit C++ source files to an output directory |
| `build <entry.do>` | Emit and compile to a native binary |
| `run <entry.do>` | Emit, compile, and run the program |
| `check <entry.do>` | Type-check only without writing C++ output |
| `test <path>` | Discover and run Doof tests from a file or directory |

### Options

| Option | Description |
| --- | --- |
| `-o, --outdir <dir>` | Output directory. Default: `./build` |
| `--compiler <path>` | C++ compiler to use. Default: auto-detect `clang++`/`g++`/`c++`, or Visual Studio `cl.exe` on Windows |
| `--std <standard>` | C++ standard. Default: `c++17` |
| `--include-path <dir>` | Additional header search path. Repeatable |
| `--lib-path <dir>` | Additional library search path. Repeatable |
| `--link-lib <name>` | Link a native library by name. Repeatable |
| `--framework <name>` | Link an Apple framework by name. Repeatable |
| `--source <path>` | Compile and link an additional native source file. Repeatable |
| `--object <path>` | Link an additional native object file. Repeatable |
| `--define <name[=value]>` | Add a preprocessor definition. Repeatable |
| `--cxxflag <flag>` | Add an extra compiler flag. Repeatable |
| `--ldflag <flag>` | Add an extra linker flag. Repeatable |
| `--filter <text>` | Run only tests whose discovered id contains the text |
| `--list` | List discovered tests without compiling or running them |
| `-v, --verbose` | Print detailed progress information |
| `-h, --help` | Show help |
| `--version` | Show CLI version |

### Examples

Type-check a file:

```bash
npx doof check samples/hello.do
```

Those sample commands work from this repository because it includes a root `doof.json`. In your own projects, place `doof.json` at the project root before running the CLI.

Emit C++ sources into a custom directory:

```bash
npx doof emit -o dist samples/fibonacci.do
```

`doof emit` writes:

- generated `.hpp` / `.cpp` files
- `doof_runtime.hpp`
- `CMakeLists.txt`
- `provenance.json`
- `doof-build.json`

`doof-build.json` is the tool-agnostic external build handoff. It contains the resolved generated source list, propagated include paths, propagated native source files, library paths, libraries, frameworks, defines, and flags. External CMake or Xcode integration should consume this file instead of re-implementing package resolution.

Build a native binary:

```bash
npx doof build samples/hello.do
```

Run a program end to end:

```bash
npx doof run samples/hello.do
```

List discovered tests:

```bash
npx doof test --list samples
```

Run all tests under a directory:

```bash
npx doof test samples
```

Run only matching tests:

```bash
npx doof test --filter fibonacci samples
```

Use a specific compiler and standard:

```bash
npx doof build --compiler /usr/bin/clang++ --std c++20 samples/hello.do
```

On Windows, you can also point directly at `cl.exe` if you want to override auto-detection:

```powershell
npx doof build --compiler "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.40.33807\bin\Hostx64\x64\cl.exe" samples/hello.do
```

Build a Doof program that depends on native headers and a system library:

```bash
npx doof build \
  --include-path ./vendor/include \
  --lib-path ./vendor/lib \
  --link-lib curl \
  samples/http.do
```

For checked-in native-backed examples, see `samples/sqlite/` for a thin sqlite3 wrapper, `samples/regex/` for a small `std::regex` bridge with a Doof-first API, `samples/http-client/` for a small libcurl bridge, `samples/openai-responses/` for a metadata-driven OpenAI Responses API integration, `samples/obj-viewer/` for an SDL3-backed wireframe OBJ viewer with Doof-side parsing and projection, and `samples/reminders-mcp/` for a macOS EventKit-backed MCP server packaged inside an app bundle. For card-game examples, see `samples/solitaire/` for the full host-backed Klondike app and `samples/seahaven-towers/` for a full interactive Seahaven Towers app built on the shared boardgame host.

For a remote package example, see `samples/hello-package/`, which imports `hello-doof/hello` from the tagged GitHub package.

Emit a project with native build metadata in the generated `CMakeLists.txt`:

```bash
npx doof emit \
  --include-path ./native/include \
  --source ./native/bridge.cpp \
  --framework Foundation \
  samples/apple-intelligence/apple-intelligence.do
```

### What Each Command Does

- `check` runs parsing, module analysis, and type checking
- `emit` runs the full compiler pipeline and writes generated C++ files plus `CMakeLists.txt`; native build flags are written into the generated build metadata
- `build` emits the project and compiles it to a native executable in the output directory, including any additional include paths, libraries, frameworks, native sources, objects, defines, and extra flags
- `run` does the same as `build` and then executes the produced binary
- `test` discovers exported test functions in `.test.do` files, builds a temporary test harness, compiles once with the same native compiler detection used by `build`, and runs each discovered test in its own process

## Testing

Doof tests are currently a CLI convention rather than a separate language feature.

Use these conventions in the current MVP:

- Put test files in `*.test.do`
- Export top-level test functions whose names start with `test`
- Test functions must take no parameters
- Test functions must return `void`
- Use `assert(condition, message)` for test failures
- Import `Assert` from `std/assert` for richer assertions

Example:

```javascript
// math.test.do
import { Assert } from "std/assert"

export function testAdd(): void {
  Assert.equal(1 + 1, 2)
}

export function testSubtract(): void {
  Assert.equal(10 - 3, 7, "expected subtraction to work")
}
```

Run the file directly:

```bash
npx doof test math.test.do
```

Run a whole tree:

```bash
npx doof test src
```

The discovered test id format is `<relative-path>::<functionName>`. `--filter` matches against that full id.

A failing `assert(...)` panics and fails the current test. The test runner executes each test in a separate process, so one failure does not stop later tests from running.

The compiler also provides a `std/assert` module with an `Assert` class. The initial surface includes `Assert.equal(...)`, `Assert.notEqual(...)`, `Assert.isTrue(...)`, `Assert.isFalse(...)`, and `Assert.fail(...)`.

### Mixed Doof and Native C++ Builds

Doof `import class` declarations describe the C++ surface area the type checker and emitter should use, but build concerns still live at the CLI layer.

Use the native build flags when your program needs any of the following:

- headers outside the generated output directory or default compiler search paths
- prebuilt libraries or custom library search directories
- Apple frameworks
- additional `.cpp` bridge files or precompiled object files
- preprocessor defines, compiler flags, or linker flags

`emit`, `build`, and `run` all accept the native build options. `emit` persists them into the generated `CMakeLists.txt`, while `build` and `run` also pass them directly to the compiler/linker invocation.

These native build flags work best for simple bridge files and library integrations. If a project needs Objective-C++, Swift, app bundle packaging, asset staging, or a larger native build graph, prefer `doof emit` plus CMake or your existing native build system. The checked-in `samples/solitaire` SDL/Metal host and `samples/reminders-mcp` EventKit sample both fall into that category today.

For complex multi-language projects, `doof emit` is still the most flexible path: generate the C++ output and integrate it into your existing CMake or native build system.

## Development

Build the TypeScript sources:

```bash
npm run build
```

Run the test suite:

```bash
npm test
```

Run one sample through the checker:

```bash
node dist/cli.js check samples/hello.do
```

## Specification

Start with these specification files:

- `spec/01-overview.md`
- `spec/02-type-system.md`
- `spec/03-variables-and-bindings.md`
- `spec/04-functions-and-lambdas.md`
- `spec/11-modules.md`

## Status

This repository is an active compiler project. The CLI and language surface are evolving, so the source in `src/` and the documents in `spec/` are the authoritative references.