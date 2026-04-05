# Solitaire in Doof

A complete Klondike Solitaire implementation with **game logic, visual layer, camera projection, application state, and host input handling written in Doof**, the statically-typed language that compiles to C++. Only the SDL3/Metal rendering pipeline and type conversion remains in C++/Objective-C++.

The sample now consumes shared Doof support modules through its local [doof.json](/Users/andrew/develop/doof/samples/solitaire/doof.json) dependency on [samples/lib/cardgame](/Users/andrew/develop/doof/samples/lib/cardgame). The consumer modules import `boardgame/*` directly instead of routing through sample-local wrapper modules.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Doof Game Logic (transpiles to C++)        │
│                                             │
│  card.do      — Suit, Rank, PlayingCard     │
│  game.do      — SolitaireState, Pile, init  │
│  rules.do     — Move validation, animation  │
│  input.do     — Click/drag interaction      │
│  solitaire.do — Module re-exports           │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Doof Visual Layer (transpiles to C++)      │
│                                             │
│  sprite.do    — CardSprite, CardLibrary     │
│  vertex.do    — Vertex, quad generation     │
│  camera.do    — Camera state, projection    │
│  matrix.do    — Mat4 extern class (SIMD)    │
│  render.do    — Render ordering / plan      │
│  button.do    — GameButton, UI render plan  │
│  content.do   — Atlas config, texture paths │
│  math.do      — Standard math functions     │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  Doof Application State & Host Input        │
│                                             │
│  app-state.do — AppState, lifecycle funcs   │
│  host.do      — HostInput, event handlers   │
└──────────────┬──────────────────────────────┘
               │  #include generated headers
┌──────────────▼──────────────────────────────┐
│  Native Boardgame Host                      │
│  native_boardgame_host.mm / TextureLoader   │
│  SDL3 window, texture loading, Metal render │
└─────────────────────────────────────────────┘
```

## What's in Doof vs C++

### Doof (game logic + visual layer + app state + host input) — ~2650 lines
- **Card types**: `Suit`, `Rank`, `PlayingCard`, `Card`
- **Pile management**: `Pile` class with add/remove/query
- **Game state**: `SolitaireState` with all 14 piles
- **Game initialization**: deck creation, shuffle, deal
- **Move validation**: `canPlaceOnTableau`, `canPlaceOnFoundation`
- **Game actions**: `dealFromStock`, `attemptAutoMove`
- **Animation state**: flip, deal, and move animations with easing
- **User interaction**: `handleClick`, `handleDragStart/Move/End`
- **Win detection**: `checkWin`
- **Sprites**: `CardSprite`, `CardDefinition`, `CardLibrary`, atlas helpers
- **Vertices**: `Vertex` class, static card quad generation
- **Flip vertices**: animated front/back card geometry with trig via `import function`
- **Camera**: state, bounding box computation, smooth damping, convergence tracking, ideal-frame computation, screen-to-world projection, MVP matrix computation
- **Render plan**: ordered card list, animation flags, placeholder specs
- **Static world draw prep**: sprite resolution and quad vertex generation for placeholders, static cards, and flip animations
- **UI buttons**: `GameButton` state, hit testing, interaction events, UI render plan
- **Button icon geometry**: refresh icon vertices and background quad generated in Doof
- **Matrix math**: `Mat4` extern class wrapping Apple SIMD `simd_float4x4` via `matrix_bridge.hpp` — perspective, lookAt, ortho, multiply, inverse, frame transforms, projection
- **Content**: atlas configuration, card library population, texture path lookup
- **Math functions**: `sin`, `cos`, `tan`, `sqrt`, `abs`, `floor`, `ceil`, `fmod`, `min`, `max`, `clamp` via `import function` from `<cmath>` / `<algorithm>`
- **Application state**: `AppState` class bundling game state, camera, card library, and button; lifecycle functions (`createApp`, `appNewGame`, `appUpdate`, `appClick`, `appDragStart/Move/End`, `appAutoComplete`, `appIsWon`)
- **Host input**: `HostInput` class with mouse/drag tracking and camera sync; event handlers (`hostMouseDown`, `hostMouseUp`, `hostMouseMove`, `hostUpdate`) managing drag detection, click-vs-drag threshold, auto-camera, change detection, and button layout

### C++ (shared native host runtime) — SDL host, texture loading, and Metal rendering
- **native_boardgame_host.mm**: SDL3 window lifecycle, native event collection, texture loading, and Metal rendering from `samples/lib/cardgame`
- **TextureLoader.mm / TextureRegistry.mm**: image loading and texture management

## Current Doof Limitations

The following C++ code cannot yet be ported to Doof due to missing language features:

| Limitation | Impact | Workaround |
|---|---|---|
| No matrix/vector types | MVP computation, ray casting | `import class` wrapping `simd_float4x4` |
| No Map/Dictionary type | CardLibrary uses linear search | O(n) lookup; fine for ~53 cards |
| No stable native bridge ABI yet | Handwritten host bridge drifts from emitted C++ API shape | Rewire bridge after emitter ABI settles |
| No fixed-size arrays | Tableau/foundation as individual fields | `tableau0..6`, `foundation0..3` |
| No struct/value types | Vertex, BoundingBox are heap-allocated | Acceptable cost for card game |

## Current Porting Status

- All game logic, visual layer, camera projection, application state management, and host input handling are implemented in Doof (~2650 lines across 15 modules).
- The `AppState` class in Doof owns all game objects; the C++ bridge has zero global state.
- The `HostInput` class manages mouse tracking, drag detection, per-frame camera sync, and debug camera key state entirely in Doof.
- `main.do` now owns the event loop and interprets `NativeBoardgameEvent` values directly.
- The shared native host runtime is responsible only for SDL/Metal integration, texture loading, and presenting already-prepared render plans.

## File Overview

| File | Lines | Purpose |
|---|---|---|
| **Game Logic** | | |
| [card.do](card.do) | ~65 | Card types, enums, deck creation |
| [game.do](game.do) | ~250 | Game state, initialization, positions |
| [rules.do](rules.do) | ~280 | Move validation, dealing, animations |
| [input.do](input.do) | ~275 | Click and drag interaction logic |
| **Visual Layer** | | |
| [sprite.do](sprite.do) | ~85 | CardSprite, CardDefinition, CardLibrary |
| [vertex.do](vertex.do) | ~70 | Vertex class, static card quad generation |
| [camera.do](camera.do) | ~380 | Camera state, bounds, damping, projection, MVP |
| [matrix.do](matrix.do) | ~17 | Mat4 extern class (simd_float4x4 wrapper) |
| [../lib/cardgame/matrix_bridge.hpp](../lib/cardgame/matrix_bridge.hpp) | ~85 | C++ Mat4 implementation |
| [render.do](render.do) | ~155 | Render ordering and plan generation |
| [button.do](button.do) | ~190 | GameButton state, interaction, UI render plan |
| [content.do](content.do) | ~70 | Atlas config, card library, texture paths |
| [math.do](math.do) | ~13 | Standard math functions via `import function` from `<cmath>` / `<algorithm>` |
| **Application State & Host Input** | | |
| [app-state.do](app-state.do) | ~75 | AppState class, lifecycle functions |
| [host.do](host.do) | ~180 | HostInput class, event handlers, per-frame update |
| **Entry Point** | | |
| [main.do](main.do) | ~150 | Doof-owned event loop and app entrypoint |
| [solitaire.do](solitaire.do) | ~103 | Module re-exports |
| **Shared Native Host** | | |
| [../lib/cardgame/native_boardgame_host.mm](../lib/cardgame/native_boardgame_host.mm) | ~350 | SDL3/Metal host runtime and native event collection |

## Building

Build the CLI once from the repository root before using the commands below:

```bash
npm install
npm run build
```

If `doof` is already on your `PATH`, you can replace `node dist/cli.js` with `doof` in the examples below.

### Standalone binary (CLI one-shot)

The executable entrypoint now lives in [main.do](main.do), which drives the shared native boardgame host from Doof.
The solitaire sample is designed to be used with the SDL3/Metal host.

### Transpile Doof sources

```bash
# Transpile the interactive sample entrypoint to C++
rm -rf build-solitaire
node dist/cli.js emit --include-path "$(pwd)" -o build-solitaire samples/solitaire/main.do
```

### SDL3 / Metal rendering status

The interactive sample now builds against the shared native boardgame package in [samples/lib/cardgame](/Users/andrew/develop/doof/samples/lib/cardgame), while keeping its own sample-local CMake entrypoint and atlas assets under [samples/solitaire](./README.md).

```bash
# Refresh emitted sample sources first
rm -rf build-solitaire
node dist/cli.js emit --include-path "$(pwd)" -o build-solitaire samples/solitaire/main.do

# Configure and build the sample-local SDL/Metal host
cmake -S samples/solitaire -B build-solitaire-sdl
cmake --build build-solitaire-sdl

# Launch the app bundle
open build-solitaire-sdl/DoofSolitaire.app
```

If you previously configured an older SDL sample build, remove `build-solitaire-sdl/` and re-run the two CMake commands above so you are not reusing a stale cache.

On macOS, the sample now builds as a real `.app` bundle with staged resources, a Dock/Finder icon, and bundle metadata owned by CMake.

## Game Rules (Klondike Solitaire)

- **Tableau**: 7 piles, alternating colors, descending rank. Kings on empty piles.
- **Foundation**: 4 piles (one per suit), ascending from Ace to King.
- **Stock**: Draw pile. Click to deal one card to waste. Recycles when empty.
- **Waste**: Top card is playable.
- **Win**: All 52 cards on the foundation piles.

## Controls

- **Click** a card to auto-move it to a foundation pile (if valid)
- **Click** the stock pile to deal a card
- **Drag** face-up cards between tableau piles or to foundations
- Sequences of face-up cards can be dragged together from tableau
- **Escape** cancels an in-progress drag or pressed UI interaction
- **Command+W** closes the window
- **Command+Q** quits the app

## macOS Notes

- Run [scripts/build-solitaire-macos.sh](/Users/andrew/develop/doof/scripts/build-solitaire-macos.sh) to emit sources, build the sample, and copy the finished bundle to `build/DoofSolitaire.app`.
- The helper build now reuses the CMake-produced app bundle instead of writing a separate `Info.plist`, so the icon and staged resources stay in sync.
