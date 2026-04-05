# Doof Package System

Every compilable Doof project has a `doof.json` file at its root. The compiler discovers the project root by walking upward from the entry `.do` file.

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

## Native Build Metadata

Packages can declare native build inputs under `build.native`. These values propagate transitively through package dependencies and are merged into both the generated `CMakeLists.txt` and the emitted `doof-build.json` external build manifest:

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

## doof-build.json

`doof emit` writes a `doof-build.json` alongside the generated C++ files. This is the tool-agnostic external build handoff: it contains the resolved generated source list, propagated include paths, native source files, library paths, libraries, frameworks, defines, and flags.

External CMake or Xcode integrations should consume `doof-build.json` rather than re-implementing package resolution.
