# Self-Hosted Module Acquisition Plan

Status date: 2026-07-14

This plan tracks the self-hosted compiler work needed for implicit `std/*`
imports and manifest-driven native build inputs. `DOOF_STDLIB_ROOT` remains a
required configuration for stdlib discovery during the current phase. The
acquisition boundary must nevertheless accept arbitrary logical-module to disk
folder mappings so a Git/cache provider can supply individual packages later.

## Invariants

- Source code imports `std/<package>` without declaring or registering it in
  the consuming `doof.json`.
- `DOOF_STDLIB_ROOT` is currently the source of stdlib package folders; it is
  an override/provider input, not resolver policy.
- Resolution probes both a direct `.do` module and an `index.do` barrel.
- Imports and re-exports load only their transitively reached source graph.
- Explicit `--module` mappings continue to override acquired package roots.
- A more-specific acquired prefix wins, allowing `/std/time` to come from a
  cache folder while other `/std/*` packages still come from the configured
  stdlib root.
- Native build metadata comes from every reached package's `doof.json`, not
  from emitted filename heuristics.
- Native paths remain package-relative until output/build planning resolves
  them, preventing collisions between packages.

## Milestones

### M1 — Generic acquisition boundary

Status: complete

- Add a focused module that maps logical module prefixes to arbitrary disk
  roots using deterministic longest-prefix matching.
- Route `DOOF_STDLIB_ROOT` through that abstraction.
- Keep explicit local and `--module` mappings ahead of acquired roots.
- Cover umbrella roots, package-specific overrides, boundary matching, barrel
  paths, and manifest paths with unit tests.

Acceptance:

- `/std/time/index.do` can map through `/std` or a more-specific `/std/time`
  acquisition without resolver changes.
- `std/*` still fails clearly when `DOOF_STDLIB_ROOT` is absent.

Completed in the initial slice:

- `selfhost/module-acquisition.do` provides longest-prefix disk-root mapping.
- The driver now represents `DOOF_STDLIB_ROOT` as a `/std` acquisition instead
  of embedding stdlib path rules in `driverSourceDiskPath()`.
- Seven focused tests cover umbrella mapping, package-specific overrides,
  segment boundaries, missing acquisitions, and manifest paths.

### M2 — Reached-package ownership and manifests

Status: complete

- Record which acquisition owns each loaded source.
- Read that package's `doof.json` once when its first source is reached.
- Parse base and host-platform `build.native` fragments.
- Normalize and deduplicate `includePaths`, `sourceFiles`, `libraryPaths`,
  `extraCopyPaths`, `linkLibraries`, `frameworks`, `pkgConfigPackages`,
  `defines`, `compilerFlags`, and `linkerFlags`.
- Parse the root project through the same manifest model.

Acceptance:

- Importing `std/time` discovers `doof_time.cpp` and `doof_time.hpp`.
- Importing `std/path` on macOS discovers `CoreFoundation`.
- An unused std package contributes no native inputs.

Completed:

- Successful acquired-source loads are mapped back to a package-specific
  logical prefix and disk root; local and explicit `--module` sources do not
  claim acquired-package ownership.
- Each reached acquired package is deduplicated before its `doof.json` is read.
- Root and acquired manifests share `PackageManifest` / `NativeBuildPlan`.
- Base and host-platform native fragments normalize all filesystem paths and
  merge all ten supported native input collections with stable deduplication.
- The canonical runtime reports `macos`, `linux`, or `windows` for manifest
  platform selection.
- Generated-driver acceptance checks import `std/time` through
  `DOOF_STDLIB_ROOT`; real `std/time` and `std/path` manifests verify native
  source/header and framework discovery.

### M3 — Explicit project/native emission plan

Status: complete

- Add native/support requirements to the project emission result instead of
  inferring them from emitted logical module names.
- Replace `materializeStdlibSupport()` and its package-name conditionals.
- Copy native assets under stable package-relative output paths and emit the
  corresponding include/source/library paths.
- Remove the self-host-specific `types.hpp` synthesis once generated/native
  header ownership is aligned.

Acceptance:

- No std package name appears in generic driver support-copy logic.
- Two packages may contain the same native filename without collision.

Completed:

- `selfhost/emitter-project.do` now returns modules, generated support files,
  manifest-declared native copies, and rewritten output-relative native build
  paths as one explicit project emission result.
- Reached packages are materialized beneath stable logical package roots; the
  collision test covers two packages that both ship `native.cpp` and
  `native.hpp`.
- The generic driver recursively copies declared files/directories and no
  longer contains stdlib package-name conditionals.
- Generated headers are mirrored beside each package's native assets, replacing
  the hand-written root `types.hpp` synthesis with package-owned `types.hpp`
  headers such as `std/fs/types.hpp`.

### M4 — Native build handoff

Status: complete

- Add a self-hosted build command or a machine-readable build plan consumed by
  the native compiler driver.
- Compile registered native sources and apply platform frameworks, libraries,
  include paths, defines, and flags.
- Add end-to-end projects for `std/time` and one platform-native package.

Acceptance:

- A project using `std/time` builds and runs without manual native arguments.
- Root-project and transitive-package native inputs are both incorporated.

Completed:

- `selfhost/native-build.do` resolves the explicit project plan into one
  GCC-compatible compile/link invocation, including generated and registered
  native sources, include/library paths, libraries, frameworks, defines, and
  compiler/linker flags.
- The self-hosted `build` command selects `--compiler`, `CXX`, or `c++`, runs
  the compiler without shell interpolation, and writes the executable beneath
  the configured build directory.
- Reached package identity now drives self-hosted generated namespaces, keeping
  native ABI names stable when a package is compiled as a dependency.
- Generated-driver acceptance projects build and run real `std/time` together
  with a root native source/define, and a focused macOS package that requires
  `CoreFoundation`.

Intentionally deferred:

- `pkgConfigPackages` are preserved in the native plan, but the self-hosted
  build command reports them as unsupported until a pkg-config provider is
  added. Direct paths, libraries, frameworks, defines, and flags are supported.

### M5 — Git/cache acquisition provider

Status: pending

- Introduce a provider that resolves a requested package name/version to a
  cached folder and returns a package-specific acquisition mapping.
- Preserve `DOOF_STDLIB_ROOT` as an explicit local override.
- Add cache-hit, cache-miss, unavailable-package, and version-selection tests.

Acceptance:

- Resolver, analyzer, and emitter code are unchanged when switching between a
  local-root provider and a Git/cache provider.

## Verification gates

- `doof test selfhost/module-acquisition.test.do`
- `doof test selfhost/compiler.test.do`
- `DOOF_TEST_TIMEOUT_MS=240000 doof test selfhost/bootstrap.test.do`
- `npm run build`
- `npm test`

Update milestone statuses and record any intentionally deferred acceptance
checks in this file as implementation progresses.

## Progress log

### 2026-07-14 — M1 completed

- Added the generic acquisition mapping and routed `DOOF_STDLIB_ROOT` through
  it while retaining the environment variable as a requirement.
- Added the acquisition module to self-hosted driver bootstrap inventories.
- Verified the focused acquisition tests, the self-hosted driver type-check,
  the focused generated-driver bootstrap test, `npm run build`, and
  `git diff --check`.

### 2026-07-14 — M2 completed

- Added reached-package ownership and one-time manifest registration to the
  demand-driven source loader.
- Added normalized native manifest parsing, platform overlays, root-project
  native metadata, and stable plan merging.
- Added focused acquisition, manifest, project, real-stdlib, and generated
  driver acceptance coverage.

### 2026-07-14 — M3 completed

- Added explicit project emission planning for package support files, native
  copies, and output-relative include/source/library paths.
- Replaced `materializeStdlibSupport()` with generic recursive project
  materialization driven only by the emission result.
- Added focused collision/header-mirroring tests and a generated-driver
  acceptance check for materialized `std/time` native inputs.
- Verified the M3 unit tests, B4 generated-driver acceptance, `npm run build`,
  `npm test` (2,243 tests), and `git diff --check`.

### 2026-07-14 — deferred self-host gate failures resolved

- Updated the compiler and parser slice inventories for the extracted
  `emitter-expr-lambda.do` dependency and the expression/statement emitter
  strongly connected component.
- Consolidated nullable-variant promotion in `emitExpression`, retained a
  focused shorthand-property path for nodes without an expression, and removed
  obsolete return-name/state special cases that double-wrapped generated values.
- Made nested nullable-alias detection recursive and linked generated stdlib
  dependency modules into both bootstrap stages.
- Verified the focused emitter slices, nullable fixtures, complete self-host
  source graph, and B5/B6 two-stage bootstrap gate.

### 2026-07-14 — M4 completed

- Added the self-hosted native compile planner and `build` command with direct
  process execution and explicit compiler selection.
- Unified module, type, expression, and declaration qualification on
  package-stable namespace ownership supplied by reached manifests.
- Added focused planner, CLI, and namespace tests plus generated-driver builds
  for root/transitive `std/time` inputs and a platform-framework package.
- Raised the full bootstrap test timeout to 240 seconds because B5/B6 now
  rebuild the additional package-namespace and native-build handoff modules.
