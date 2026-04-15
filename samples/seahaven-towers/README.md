# Seahaven Towers in Doof

An interactive Seahaven Towers sample with the game logic, drag/drop rules, camera framing, render planning, application state, and host input handling written in Doof. It uses the same shared native boardgame host as the Klondike sample, with Seahaven-specific rules and layout on top.

The sample now depends on [samples/lib/cardgame](/Users/andrew/develop/doof/samples/lib/cardgame) through its local [doof.json](/Users/andrew/develop/doof/samples/seahaven-towers/doof.json), and the consumer modules import `boardgame/*` directly instead of going through sample-local wrapper modules.

## What's Included

- `seahaven.do` contains the Seahaven Towers state model, the deal, move validation, drag/drop handling, and text helpers used by tests.
- `seahaven-towers.do` is the interactive umbrella module, while `main.do` is the build entrypoint emitted into the host-backed app.
- `app-state.do`, `host.do`, `camera.do`, `render.do`, `button.do`, `sprite.do`, and `vertex.do` match the host-facing surface used by the shared boardgame host.
- `card.do` re-exports the shared playing-card primitives from `samples/lib/cardgame/cards.do`.
- `samples/lib/cardgame/` contains the shared native host, matrix bridge, and platform-specific rendering support used by both Solitaire and Seahaven Towers.
- `seahaven.test.do` covers the core Seahaven rules.

## Rules Modeled

- 52 cards, no redeal.
- 10 tableau columns with 5 cards each.
- 4 reserve cells; the first 2 start filled with one card each.
- Foundations build up by suit from Ace to King.
- Tableau columns build down in suit.
- Valid same-suit descending tableau runs can move together when the empty reserves and empty tableau columns provide enough intermediate space.
- Any card can move to an empty tableau column.
- Any available card can move into an empty reserve cell.

The interactive app supports `Cmd+Z` / `Cmd+Shift+Z` / `Cmd+Y` on macOS and `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` on Windows.

## Build And Run

From the repository root:

```bash
npm run build
rm -rf samples/seahaven-towers/build
node dist/cli.js build samples/seahaven-towers
```

On macOS, launch the bundle with:

```bash
open samples/seahaven-towers/build/DoofSeahavenTowers.app
```

On Windows PowerShell, install the prerequisites once:

```powershell
winget install --id Kitware.CMake --source winget
winget install --id Microsoft.VisualStudio.2022.BuildTools --source winget
# In the Visual Studio installer, include the "Desktop development with C++" workload.

git clone https://github.com/microsoft/vcpkg $HOME\vcpkg
& $HOME\vcpkg\bootstrap-vcpkg.bat
& $HOME\vcpkg\vcpkg install sdl3:x64-windows
$env:VCPKG_ROOT = "$HOME\vcpkg"
```

Then build and run with:

```powershell
npm run build
if (Test-Path samples/seahaven-towers/build) { Remove-Item samples/seahaven-towers/build -Recurse -Force }
node dist/cli.js emit samples/seahaven-towers
cmake -S samples/seahaven-towers -B build-seahaven-towers-sdl -DCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
cmake --build build-seahaven-towers-sdl --config Release
& .\build-seahaven-towers-sdl\Release\DoofSeahavenTowers.exe
```

Or use the sample helper for the full build flow:

```bash
samples/seahaven-towers/build.sh --run
```

On Windows, use the PowerShell helper instead:

```powershell
.\scripts\build-seahaven-towers-windows.ps1 -Run
```

The sample CMake config only needs SDL3 and the generated Doof sources.

On macOS, the app bundle identity, plist metadata, icon path, staged resources, shared host sources, and SDL3 discovery now come from manifest-driven build metadata rooted in [samples/seahaven-towers/doof.json](samples/seahaven-towers/doof.json) and [samples/lib/cardgame/doof.json](samples/lib/cardgame/doof.json). The direct `doof build` path now produces the `.app` bundle without CMake.

If you are not already in a Developer PowerShell session, pass `-VcVarsPath "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"` to [scripts/build-seahaven-towers-windows.ps1](/Users/andrew/develop/doof/scripts/build-seahaven-towers-windows.ps1).

## Run The Sample Tests

```bash
node dist/cli.js test samples/seahaven-towers
```

## Why This Sample Exists

The existing solitaire sample proves that a fairly complete Klondike implementation can live mostly in Doof. Seahaven Towers is a second interactive card-game sample with different move constraints, reserve-cell behavior, and column rules, while reusing the shared playing-card definitions and native boardgame host.