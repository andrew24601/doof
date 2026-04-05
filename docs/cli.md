# Doof CLI Reference

The CLI transpiles Doof source files to C++, optionally compiles the generated project, and can run the resulting binary.

## Installation

Install into a project:

```bash
npm install --save-dev doof
```

Run with `npx`:

```bash
npx doof --help
```

Global install:

```bash
npm install --global doof
doof --help
```

Working on the compiler itself:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Usage

```text
doof <command> [options] <entry.do | path>
```

## Commands

| Command | Description |
| --- | --- |
| `emit <entry.do>` | Emit C++ source files to an output directory |
| `build <entry.do>` | Emit and compile to a native binary |
| `run <entry.do>` | Emit, compile, and run the program |
| `check <entry.do>` | Type-check only without writing C++ output |
| `test <path>` | Discover and run Doof tests from a file or directory |

### What Each Command Does

- `check` — runs parsing, module analysis, and type checking; no output written
- `emit` — runs the full compiler pipeline and writes generated C++ files plus `CMakeLists.txt`; native build flags are written into the generated build metadata
- `build` — emits the project and compiles it to a native executable in the output directory
- `run` — same as `build`, then executes the produced binary
- `test` — discovers exported test functions in `.test.do` files, builds a temporary test harness, compiles once, and runs each discovered test in its own process

`doof emit` writes:

- generated `.hpp` / `.cpp` files
- `doof_runtime.hpp`
- `CMakeLists.txt`
- `provenance.json`
- `doof-build.json`

`doof-build.json` is the tool-agnostic external build handoff. It contains the resolved generated source list, propagated include paths, propagated native source files, library paths, libraries, frameworks, defines, and flags. External CMake or Xcode integrations should consume this file instead of re-implementing package resolution.

## Options

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

## Requirements

- Node.js and npm
- A native C++ compiler for `build`, `run`, and `test`

On macOS and Linux, the CLI auto-detects `clang++`, `g++`, or `c++`. On Windows, it auto-detects Visual Studio's `cl.exe` and configures the required MSVC environment automatically when Visual Studio is installed with the C++ tools workload.

## Examples

Type-check a file:

```bash
npx doof check samples/hello.do
```

Emit C++ sources to a custom directory:

```bash
npx doof emit -o dist samples/fibonacci.do
```

Build a native binary:

```bash
npx doof build samples/hello.do
```

Run a program end to end:

```bash
npx doof run samples/hello.do
```

Use a specific compiler and standard:

```bash
npx doof build --compiler /usr/bin/clang++ --std c++20 samples/hello.do
```

On Windows, override auto-detection:

```powershell
npx doof build --compiler "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.40.33807\bin\Hostx64\x64\cl.exe" samples/hello.do
```

Build a program that depends on native headers and a system library:

```bash
npx doof build \
  --include-path ./vendor/include \
  --lib-path ./vendor/lib \
  --link-lib curl \
  samples/http.do
```

Emit with native build metadata embedded in `CMakeLists.txt`:

```bash
npx doof emit \
  --include-path ./native/include \
  --source ./native/bridge.cpp \
  --framework Foundation \
  samples/apple-intelligence/apple-intelligence.do
```

## Native C++ Interop

`import class` declarations in Doof describe the C++ surface the type checker and emitter should use. Build concerns stay at the CLI layer via the native build flags.

Use the native flags when your program needs:

- headers outside the generated output directory or default compiler search paths
- prebuilt libraries or custom library search directories
- Apple frameworks
- additional `.cpp` bridge files or precompiled object files
- preprocessor defines, compiler flags, or linker flags

`emit`, `build`, and `run` all accept these options. `emit` persists them into the generated `CMakeLists.txt`, while `build` and `run` also pass them directly to the compiler/linker.

These flags work well for simple bridge files and library integrations. For projects that need Objective-C++, Swift, app bundle packaging, or a larger native build graph, use `doof emit` plus CMake or your existing native build system. The [`samples/solitaire`](../samples/solitaire/) SDL/Metal host and [`samples/reminders-mcp`](../samples/reminders-mcp/) EventKit sample both take that approach.

## Samples with Native Dependencies

| Sample | Description |
| --- | --- |
| [`samples/sqlite/`](../samples/sqlite/) | Thin sqlite3 wrapper |
| [`samples/regex/`](../samples/regex/) | `std::regex` bridge with a Doof-first API |
| [`samples/http-client/`](../samples/http-client/) | libcurl bridge |
| [`samples/openai-responses/`](../samples/openai-responses/) | Metadata-driven OpenAI Responses API integration |
| [`samples/obj-viewer/`](../samples/obj-viewer/) | SDL3-backed wireframe OBJ viewer |
| [`samples/reminders-mcp/`](../samples/reminders-mcp/) | macOS EventKit-backed MCP server in an app bundle |
| [`samples/solitaire/`](../samples/solitaire/) | Full host-backed Klondike app |
| [`samples/seahaven-towers/`](../samples/seahaven-towers/) | Interactive Seahaven Towers app |
| [`samples/hello-package/`](../samples/hello-package/) | Remote package import example |
