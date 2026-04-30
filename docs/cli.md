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
doof <command> [options] [entry.do | package-dir]
```

## Commands

| Command | Description |
| --- | --- |
| `emit [path]` | Emit C++ source files to an output directory |
| `build [path]` | Emit and compile to a native binary |
| `run [path]` | Emit, compile, and run the program |
| `check [path]` | Type-check only without writing C++ output |
| `test <path>` | Discover and run Doof tests from a file or directory |

### What Each Command Does

- `check` — runs parsing, module analysis, and type checking; no output written
- `emit` — runs the full compiler pipeline and writes generated C++ files plus build metadata; native build flags and target metadata are written into `doof-build.json`
- `build` — emits the project and compiles it; for `build.target = "macos-app"`, this produces a `.app` bundle on macOS instead of stopping at a plain executable; for `build.target = "ios-app"`, it produces an iOS `.app` for either the simulator or a connected development device on macOS
- `run` — same as `build`, then executes the produced binary; for `macos-app`, it runs the binary inside the `.app` bundle; for `ios-app`, it installs and launches the app on the booted simulator or a connected development device depending on `--ios-destination`
- `test` — discovers exported test functions in `.test.do` files, builds a temporary harness per test file, compiles each test module separately, and runs each discovered test in its own process

### Line Coverage

Pass `--coverage` to `doof test` to enable line coverage collection for non-test Doof source files (`.do` files that are not `.test.do` and are not stdlib modules).

```sh
doof test ./my-package --coverage
doof test ./my-package --coverage --coverage-output build/coverage/report.json
```

After all tests complete, a text summary is printed:

```
Coverage summary:
  src/calc.do: 24/30 lines (80.0%)
  src/math.do: 10/10 lines (100.0%)
Overall: 34/40 lines (85.0%)
Coverage report written to build/coverage/doof-test-coverage.json
Coverage HTML report written to build/coverage/doof-test-coverage.html
```

The JSON report (`doof-test-coverage.json` by default, or the path given to `--coverage-output`) has the shape:

```json
{
  "timestamp": "2025-06-01T12:00:00.000Z",
  "totals": { "covered": 34, "total": 40, "percent": 85.0 },
  "files": [
    {
      "path": "src/calc.do",
      "covered": 24,
      "total": 30,
      "percent": 80.0,
      "hitLines": [1, 3, 5, ...],
      "missedLines": [7, 9, ...]
    }
  ]
}
```

An HTML summary report is also written next to the JSON file. By default that is `build/coverage/doof-test-coverage.html`; if you pass `--coverage-output path/to/report.json`, the HTML sibling becomes `path/to/report.html`.

The HTML summary links to separate per-file HTML pages in a sibling directory (for example `build/coverage/doof-test-coverage_files/`). Each file page shows the Doof source with line highlighting for:

- covered executable lines
- missed executable lines
- non-instrumented lines

Coverage is **line-level** and counts executable statements only (declarations, imports, and block nodes are excluded). Imported C++ code and the test files themselves are not included.

`doof emit` writes:

- generated `.hpp` / `.cpp` files
- `doof_runtime.hpp`
- `provenance.json`
- `doof-build.json`

Remote package outputs are written into the emitted `.packages/<owner>/<repo>/` subtree instead of mirroring the cache path from `~/.doof/packages/`.

When `DOOF_STDLIB_ROOT` is set, std imports such as `std/fs` resolve from that local checkout root instead of fetching the compiler's default GitHub-backed std packages. For example, `DOOF_STDLIB_ROOT=/Users/andrew/develop/doof-stdlib` makes `std/fs` resolve from `/Users/andrew/develop/doof-stdlib/fs`.

For `build.target = "macos-app"`, `doof emit` also writes bundle support files such as `Info.plist` and the icon-generation helper script used by external native build integrations. For `build.target = "ios-app"`, it writes the iOS `Info.plist`, a generated UIKit entry shell, and an app-icon asset catalog scaffold.

`doof-build.json` is the tool-agnostic external build handoff. It contains the resolved generated source list, propagated include paths, propagated native source files, library paths, libraries, frameworks, defines, and flags. External CMake or Xcode integrations should consume this file instead of re-implementing package resolution.

`provenance.json` records the finalized remote dependency graph using resolved git metadata:

```json
{
  "dependencies": [
    {
      "kind": "git",
      "url": "https://github.com/andrew24601/doof-fs",
      "version": "0.1",
      "commit": "5497e5306fcb80d3a0014ca41cfb236096c3583f",
      "referencedFrom": ["."]
    }
  ]
}
```

Root package references appear as `"."` in `referencedFrom`. Transitive remote references use the referencer package URL.

When a manifest declares `build.target = "macos-app"` or `build.target = "ios-app"`, the emitted handoff also includes resolved bundle metadata, icon input, and resource mappings.

For `emit`, `build`, `run`, and `check`, the path is optional when the current working directory is already inside a Doof package. The CLI will walk upward to the nearest `doof.json`, default the entrypoint to `build.entry` or `main.do`, and default the output directory to `build.buildDir` or `build/`. Passing a package directory such as `samples/solitaire` uses that package's manifest the same way. `-o` still overrides the manifest/default output directory.

## Options

| Option | Description |
| --- | --- |
| `-o, --outdir <dir>` | Output directory. Default: the package `build/` directory or `build.buildDir` from `doof.json` |
| `--compiler <path>` | C++ compiler to use. Default: auto-detect `clang++`/`g++`/`c++`, or Visual Studio `cl.exe` on Windows |
| `--target <kind>` | Override the manifest build target for this invocation. Supported values: `macos-app`, `ios-app` |
| `--ios-destination <kind>` | iOS destination for `ios-app`. Supported values: `simulator`, `device`. Default: `simulator` |
| `--ios-device <id>` | Connected iOS device identifier or name for `ios-app` runs when `--ios-destination device` is used |
| `--ios-sign-identity <name>` | Code signing identity for `ios-app` device builds |
| `--ios-provisioning-profile <path>` | Provisioning profile for `ios-app` device builds |
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
| `--coverage` | Collect line coverage for non-test Doof source files |
| `--coverage-output <path>` | Write coverage JSON report to `<path>` (default: `build/coverage/doof-test-coverage.json`) |
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

Build a macOS app bundle from manifest metadata:

```bash
npx doof build samples/solitaire
```

Build an iOS simulator app bundle by overriding the package target:

```bash
npx doof build --target ios-app samples/solitaire
```

Build, sign, install, and launch on a connected development device:

```bash
npx doof run \
  --target ios-app \
  --ios-destination device \
  --ios-device 00008110-001234560E91801E \
  --ios-sign-identity "Apple Development: Jane Doe (TEAMID)" \
  --ios-provisioning-profile ~/Library/MobileDevice/Provisioning\ Profiles/profile.mobileprovision \
  samples/solitaire
```

Build the current package from inside its directory:

```bash
cd samples/solitaire
npx doof build
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

Emit with native build metadata captured in `doof-build.json`:

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

Package manifests can also declare `build.native.pkgConfigPackages` or platform-specific native fragments such as `build.native.macos`. The CLI resolves those manifest-driven native inputs before emission and direct compilation, so `doof build` can pick up system-installed libraries like SDL3 without a separate CMake step.

`emit`, `build`, and `run` all accept these options. `emit` records them in `doof-build.json`, while `build` and `run` also pass them directly to the compiler/linker.

These flags work well for simple bridge files and library integrations. The built-in `macos-app` target now covers the basic `.app` bundle case, including `Info.plist`, icon generation, frameworks, and resource copying. The built-in `ios-app` target now covers both simulator builds and connected development-device installs on macOS by generating a UIKit host shell, compiling against either the `iphonesimulator` or `iphoneos` SDK, signing with a provisioning profile for device builds, and installing through `simctl` or `devicectl` when you use `doof run`. For projects that need Objective-C++, Swift, App Store distribution signing, or a larger native build graph, use `doof emit` plus Xcode or your existing native build system.

`build.target = "macos-app"` and `build.target = "ios-app"` are currently limited to macOS for `doof build` and `doof run`, because bundle assembly, Apple SDK resolution, signing, and Apple device tooling rely on macOS tools such as `xcrun`, `simctl`, `devicectl`, `codesign`, `security`, `qlmanage`, `sips`, and `iconutil`.

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
