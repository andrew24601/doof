# Seahaven Towers in Doof

An interactive Seahaven Towers sample with the game logic, drag/drop rules, camera framing, render planning, application state, and host input handling written in Doof. It uses the same shared SDL3/Metal boardgame host as the Klondike sample, with Seahaven-specific rules and layout on top.

The sample now depends on [samples/lib/cardgame](/Users/andrew/develop/doof/samples/lib/cardgame) through its local [doof.json](/Users/andrew/develop/doof/samples/seahaven-towers/doof.json), and the consumer modules import `boardgame/*` directly instead of going through sample-local wrapper modules.

## What's Included

- `seahaven.do` contains the Seahaven Towers state model, the deal, move validation, drag/drop handling, and text helpers used by tests.
- `seahaven-towers.do` is the interactive umbrella module, while `main.do` is the build entrypoint emitted into the host-backed app.
- `app-state.do`, `host.do`, `camera.do`, `render.do`, `button.do`, `sprite.do`, and `vertex.do` match the host-facing surface used by the shared boardgame host.
- `card.do` re-exports the shared playing-card primitives from `samples/lib/cardgame/cards.do`.
- `samples/lib/cardgame/` contains the shared SDL3/Metal native host, matrix bridge, and vendored native rendering engine used by both Solitaire and Seahaven Towers.
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

The interactive app also supports `Cmd+Z` for undo and `Cmd+Shift+Z` or `Cmd+Y` for redo on macOS.

## Build And Run

From the repository root:

```bash
npm run build
rm -rf build-seahaven-towers
node dist/cli.js emit --include-path "$(pwd)" -o build-seahaven-towers samples/seahaven-towers/main.do
cmake -S samples/seahaven-towers -B build-seahaven-towers-sdl
cmake --build build-seahaven-towers-sdl
```

On macOS, launch the bundle with:

```bash
open build-seahaven-towers-sdl/DoofSeahavenTowers.app
```

Or use the sample helper for the full emit + CMake flow:

```bash
samples/seahaven-towers/build.sh --run
```

## Run The Sample Tests

```bash
node dist/cli.js test samples/seahaven-towers
```

## Why This Sample Exists

The existing solitaire sample proves that a fairly complete Klondike implementation can live mostly in Doof. Seahaven Towers is a second interactive card-game sample with different move constraints, reserve-cell behavior, and column rules, while reusing the shared playing-card definitions and native boardgame host.