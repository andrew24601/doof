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

The compiler materializes remote packages into `~/.doof/packages/` by default. Git dependencies are cached under a package coordinate plus resolved commit, for example `~/.doof/packages/andrew24601/hello-doof/<commit>/`, and each package cache root keeps a `versions.json` file that maps requested versions to cached commits. Version lookup still tries the declared tag first and then `v<version>`, so `"version": "0.1"` resolves the `v0.1` tag when needed, but later builds can reuse `versions.json` instead of resolving that tag again.

See [`samples/hello-package/`](../samples/hello-package/) for a working remote package example.

## Generated C++ namespaces

Generated C++ uses package-aware logical namespaces rather than filesystem-path
names. Modules live under the package's `name` from `doof.json`, followed by
their path relative to the package root. This namespace is the same whether the
package is compiled directly or imported as a dependency:

```text
package name "boardgame"
game/state.do  →  namespace boardgame::game::state
index.do       →  namespace boardgame::index
cards.do       →  namespace boardgame::cards
```

Namespace components are sanitised to legal C++ identifiers. If two sibling
paths would collapse to the same component after sanitisation, such as
`foo-bar.do` and `foo_bar.do`, compilation fails instead of generating ambiguous
C++ names. Components such as `main`, `std`, and `doof` that would collide with
or shadow generated/runtime C++ surfaces receive a trailing underscore.

## Local stdlib Override

When working on the standard library itself, set `DOOF_STDLIB_ROOT` to a checkout that contains package directories such as `assert/`, `fs/`, `path/`, `regex/`, and `stream/`.

```bash
export DOOF_STDLIB_ROOT=/Users/andrew/develop/doof-stdlib
```

With that override in place, `import { writeText } from "std/fs"` resolves against `/Users/andrew/develop/doof-stdlib/fs` instead of materializing `https://github.com/doof-lang/fs.git`. The same override also applies to implicit std package loading during `doof emit`, `doof build`, `doof run`, and `doof check`.

The local development override also affects `npm run sync:stdlib`: when `DOOF_STDLIB_ROOT` is set, the command refreshes this repository's ignored `stdlib/` mirror by copying from that local checkout instead of downloading GitHub archives.

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

Packages can opt into target-specific build behavior under `build.target`. The built-in targets are `macos-app` and `ios-app`. `macos-app` tells `doof emit` to write bundle support files and target metadata for external native builds and tells `doof build` / `doof run` to produce a real `.app` bundle on macOS. `ios-app` tells `doof emit` to write iOS bundle support files and tells `doof build` / `doof run` to build either for the iOS simulator or for a connected development device on macOS.

```json
{
  "name": "solitaire-sample",
  "version": "0.1.0",
  "target": "macos-app",
  "executable": "DoofSolitaire",
  "id": "dev.doof.solitaire",
  "title": "Doof Solitaire",
  "icon": "app-icon.png",
  "resources": ["images"],
  "build": {
    "macosApp": {
      "category": "public.app-category.games",
      "infoPlist": {
        "NSLocalNetworkUsageDescription": "Doof Solitaire uses the local network to find nearby players.",
        "NSBonjourServices": ["_doof-solitaire._tcp"]
      }
    },
    "native": {
      "frameworks": ["Cocoa", "Foundation"]
    }
  }
}
```

App-target metadata can be declared either as compact top-level fields or under `build`. The compact fields are:

- `target`: `macos-app` or `ios-app`
- `executable`: executable file name and `.app` directory name
- `id`: bundle identifier
- `title`: UI display name
- `icon`: optional PNG app icon
- `resources`: bundle resources, either strings such as `"images"` or explicit `{ "from": "...", "to": "..." }` objects

Root-level compact fields win when the same value is also declared under `build` or target-specific app metadata. If `executable` is omitted for an app target, it defaults to the package `name`. If `title` is omitted, it defaults to the package `name`. If `id` is omitted, it defaults to `dev.doof.<sanitized-package-name>`. App metadata `version` defaults to the package `version`, then `"1.0"`.

`build.targetExecutableName` remains accepted as the legacy spelling for `executable`. For `macos-app`, `title` / `build.macosApp.displayName` is UI metadata, while `executable` / `build.targetExecutableName` controls the bundle executable name and the `.app` directory name.

Built-in app target icons are optional. When provided, they must be PNG files; SVG icon conversion is not part of the Doof build pipeline. When omitted, Doof emits a buildable bundle without Doof-managed app icon metadata or generated icon assets.

Packages may declare both `build.macosApp` and `build.iosApp` metadata in the same manifest. The active target still comes from `target` / `build.target`, but you can override that per invocation with `doof build --target ios-app ...` or `doof emit --target macos-app ...`.

For string resources, `"images"` is shorthand for `{ "from": "images/*", "to": "images" }`.

`resources[].to` and `build.macosApp.resources[].to` are rooted under `Contents/Resources`.

For `ios-app`, `resources[].to` and `build.iosApp.resources[].to` are rooted under the app bundle itself. This is useful when the Doof program expects assets at a stable relative path such as `samples/solitaire/images/card_atlas.png`.

`build.macosApp.infoPlist` and `build.iosApp.infoPlist` add app-declared keys to the generated `Info.plist`. Values may be strings, numbers, booleans, arrays, or nested objects. Doof-managed bundle keys such as `CFBundleIdentifier`, `CFBundleExecutable`, and `MinimumOSVersion` cannot be overridden through `infoPlist`.

If omitted, `macos-app` currently defaults to:

- `category`: `public.app-category.developer-tools`
- `minimumSystemVersion`: `11.0`

If omitted, `ios-app` currently defaults to:

- `minimumDeploymentTarget`: `16.0`

## Native Build Metadata

Packages can declare native build inputs under `build.native`. These values propagate transitively through package dependencies and are merged into the emitted `doof-build.json` external build manifest and the CLI's direct compiler/linker inputs:

```json
{
  "build": {
    "targetExecutableName": "demo-app",
    "native": {
      "includePaths": ["native/include"],
      "sourceFiles": ["native/bridge.cpp"],
      "extraCopyPaths": ["templates", "native/config.json"],
      "libraryPaths": ["native/lib"],
      "linkLibraries": ["curl"],
      "frameworks": ["Foundation"],
      "defines": ["USE_DEMO=1"],
      "compilerFlags": ["-O2"],
      "linkerFlags": ["-pthread"]
    }
  }
}
```

Path entries under `build.native` are resolved relative to the declaring package root and must stay within that package. This keeps remote packages self-contained when they are materialized into `~/.doof/packages/<owner>/<repo>/<commit>/`.

Canonical style is to omit the leading `./` for package-local paths. These fields treat bare values such as `native/include`, `native/bridge.cpp`, `native/lib`, `templates`, `main.do`, or `app-icon.png` as package-root-relative. Leading `./` is accepted, but it is just extra noise in `doof.json` and the docs prefer the shorter package-relative form.

For real filesystem builds, Doof now copies package-native inputs into the emitted output tree and compiles against those copied paths instead of the original package cache/source tree. The default copied set is:

- Every directory listed in `build.native.includePaths`
- Every file listed in `build.native.sourceFiles`
- Any additional files or directories listed in `build.native.extraCopyPaths`

This copied output is authoritative for compilation and for `doof-build.json`. Remote package output now lands under the emitted `.packages/<owner>/<repo>/` subtree, and copied native files land alongside the generated Doof headers there. That means package-native code can use ordinary sibling or relative includes such as `#include "types.hpp"` or `#include "detail/helpers.hpp"` without depending on wrapper headers.

Best practice is to keep these fields narrow and intentional:

- Use `sourceFiles` for native `.c`, `.cc`, `.cpp`, or `.mm` translation units that should be compiled.
- Use `extraCopyPaths` for package-local headers or resources that need to exist in the emitted output but are not meant to define a compiler include root.
- Use `includePaths` only for directories that are intentionally part of the compiler's include search path.

Concrete guidance:

- Appropriate `includePaths` example: a package stores public native headers under `native/include/fs/` and a bridge file includes them as `#include "fs/client.hpp"`. In that case, set `"includePaths": ["native/include"]` because `native/include` is a real include root.
- Appropriate `extraCopyPaths` example: a package has a single sibling header `native_fs.hpp` next to generated Doof headers and the code includes it with `#include "native_fs.hpp"` or other relative includes. In that case, copy that file with `"extraCopyPaths": ["native_fs.hpp"]` instead of adding the whole package root to `includePaths`.

The `fs` sample follows the second pattern: it copies `native_fs.hpp` into the emitted package tree via `extraCopyPaths` and relies on local relative includes inside that copied tree rather than adding the package root as a global include root.

`build.native` continues to own compiler and linker concerns even for bundle targets. For example, Apple frameworks still belong in `build.native.frameworks`, not in `build.macosApp`.

Native build metadata can also be scoped to the current host platform:

```json
{
  "build": {
    "native": {
      "sourceFiles": ["native/shared_host.mm"],
      "frameworks": ["Foundation", "ImageIO"],
      "macos": {
        "includePaths": ["native/include"],
        "frameworks": ["Cocoa", "Metal"],
        "pkgConfigPackages": ["sdl3"]
      }
    }
  }
}
```

Currently supported platform keys are `macos`, `linux`, and `windows`. The CLI applies the fragment for the current host platform on top of the base `build.native` settings. Put shared native sources, frameworks, include paths, and flags in the base `build.native` fragment, then keep platform fragments to the values that truly differ.

When the effective target is `ios-app` on macOS, the CLI also recognizes `build.native.iosSimulator` and `build.native.iosDevice`. The selected fragment depends on `--ios-destination`, which lets a package keep separate simulator and device bridge settings in one manifest.

`build.native.pkgConfigPackages` lets the CLI resolve host-native include paths, library paths, link libraries, frameworks, and flags through `pkg-config` during `emit`, `build`, and `run`. This is useful for packages like SDL3 that are commonly installed through Homebrew, Linux package managers, or other native package systems.

## External Dependencies

Packages may declare top-level `externalDependencies` to acquire vendored source trees before native build metadata is resolved. Archive dependencies are downloaded, checksum-verified, extracted into `destination`, and marked with `.doof-external.json`; git dependencies are cloned at the pinned commit and marked the same way.

External dependency `commands` run after source acquisition for the active native target. They use these substitutions in `program`, `args`, `env`, and `workingDirectory`: `${packageRoot}`, `${destination}`, `${jobs}`, `${nativeTarget}`, `${sdkPath}`, `${targetTriple}`, and `${configureHost}`.

Use a single command list for the dependency. If the underlying native library needs different configure flags or environment variables per platform, keep that branching in a script owned by the package and pass the target substitutions into it:

```json
{
  "externalDependencies": {
    "curl": {
      "kind": "archive",
      "url": "https://example.com/curl.tar.xz",
      "sha256": "...",
      "destination": "vendor/curl",
      "commands": [
        {
          "program": "sh",
          "args": [
            "${packageRoot}/build-curl.sh",
            "${destination}",
            "${nativeTarget}",
            "${configureHost}",
            "${targetTriple}",
            "${sdkPath}",
            "${jobs}"
          ]
        }
      ]
    }
  }
}
```

Each active target writes a separate `.doof-external-native-<target>.json` marker keyed by the command configuration and target substitutions, so a static library built for one target never satisfies another target's build. Keep link selection in `build.native` fragments: `includePaths`, `libraryPaths`, `frameworks`, flags, and link libraries stay target-scoped there.

## doof-build.json

`doof emit` writes a `doof-build.json` alongside the generated C++ files. This is the tool-agnostic external build handoff: it contains the resolved generated source list, propagated include paths, native source files, library paths, libraries, frameworks, defines, flags, and any resolved target metadata such as `build.target = "macos-app"` or `build.target = "ios-app"`.

External CMake or Xcode integrations should consume `doof-build.json` rather than re-implementing package resolution.
