# Doof Package System

Every compilable Doof project has a `doof.json` file at its root. The compiler discovers the project root by walking upward from the requested entry path, package directory, or current working directory.

## Minimal doof.json

```json
{
  "name": "hello-doof",
  "version": "0.1.0",
  "license": "MIT",
  "dependencies": {}
}
```

## Dependencies

### Local packages

Point at another Doof package directory using a relative path:

```json
{
  "dependencies": {
    "boardgame": {
      "path": "../lib/cardgame"
    }
  }
}
```

### Remote packages

Point at a git repository URL with a version string:

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

The compiler materializes remote packages into `~/.doof/packages/` by default. It clones a git tag matching the declared version or `v<version>`, so `"version": "0.1"` resolves the `v0.1` tag.

See [`samples/hello-package/`](../samples/hello-package/) for a working remote package example.

## Build Defaults

Packages can declare a default entrypoint and output directory for `doof emit`, `doof build`, `doof run`, and `doof check`:

```json
{
  "build": {
    "entry": "main.do",
    "buildDir": "build"
  }
}
```

If omitted, `build.entry` defaults to `main.do` and `build.buildDir` defaults to `build`. Both paths are resolved relative to the package root and must stay within that package.

That means all of these forms are equivalent for a conventional package:

```bash
doof build samples/solitaire
cd samples/solitaire && doof build
doof build samples/solitaire/main.do
```

`-o` still overrides `build.buildDir` for a single invocation.

## Build Targets

Packages can opt into target-specific build behavior under `build.target`. The first built-in target is `macos-app`, which tells `doof emit` to write bundle support files and target metadata for external native builds and tells `doof build` / `doof run` to produce a real `.app` bundle on macOS.

```json
{
  "build": {
    "target": "macos-app",
    "targetExecutableName": "DoofSolitaire",
    "macosApp": {
      "bundleId": "dev.doof.solitaire",
      "displayName": "Doof Solitaire",
      "version": "1.0",
      "icon": "./app-icon.svg",
      "resources": [
        { "from": "images/*", "to": "images" }
      ]
    },
    "native": {
      "frameworks": ["Cocoa", "Foundation"]
    }
  }
}
```

`build.targetExecutableName` remains the executable name for both CLI builds and emitted native projects. For `macos-app`, `build.macosApp.displayName` is UI metadata, while `build.targetExecutableName` controls the bundle executable name and the `.app` directory name.

`build.macosApp.resources[].to` is rooted under `Contents/Resources`.

If omitted, `macos-app` currently defaults to:

- `category`: `public.app-category.developer-tools`
- `minimumSystemVersion`: `11.0`

## Native Build Metadata

Packages can declare native build inputs under `build.native`. These values propagate transitively through package dependencies and are merged into the emitted `doof-build.json` external build manifest and the CLI's direct compiler/linker inputs:

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

Path entries under `build.native` are resolved relative to the declaring package root and must stay within that package. This keeps remote packages self-contained when they are materialized into `~/.doof/packages/`.

`build.native` continues to own compiler and linker concerns even for bundle targets. For example, Apple frameworks still belong in `build.native.frameworks`, not in `build.macosApp`.

Native build metadata can also be scoped to the current host platform:

```json
{
  "build": {
    "native": {
      "macos": {
        "includePaths": ["."],
        "sourceFiles": ["./native_host.mm"],
        "frameworks": ["Cocoa", "Metal"],
        "pkgConfigPackages": ["sdl3"]
      }
    }
  }
}
```

Currently supported platform keys are `macos`, `linux`, and `windows`. The CLI applies the fragment for the current host platform on top of the base `build.native` settings.

`build.native.pkgConfigPackages` lets the CLI resolve host-native include paths, library paths, link libraries, frameworks, and flags through `pkg-config` during `emit`, `build`, and `run`. This is useful for packages like SDL3 that are commonly installed through Homebrew, Linux package managers, or other native package systems.

## doof-build.json

`doof emit` writes a `doof-build.json` alongside the generated C++ files. This is the tool-agnostic external build handoff: it contains the resolved generated source list, propagated include paths, native source files, library paths, libraries, frameworks, defines, flags, and any resolved target metadata such as `build.target = "macos-app"`.

External CMake or Xcode integrations should consume `doof-build.json` rather than re-implementing package resolution.
