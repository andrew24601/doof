import { AppState, createApp, appNewGame, appAutoComplete, appUndo, appRedo } from "./app-state"
import { buildUIRenderPlan } from "cardgame/button"
import { computeUIMVP, computeWorldMVP } from "./camera"
import { NativeBoardgameEventKind } from "cardgame/types"
import { loadSharedCardAtlas, NativeBoardgameHost } from "cardgame/host-runtime"
import { loadPlayingCardLibrary } from "cardgame/content"
import { PI } from "cardgame/math"
import { buildWorldRenderPlan } from "./render"
import { HostInput, debugMoveX, debugMoveZ, debugZoomDirection, hostCancelInteraction, hostMouseDown, hostMouseMove, hostMouseUp, hostUpdate, initCamera, setDebugKeyState } from "./host"

function handleHostEvents(host: NativeBoardgameHost, input: HostInput, app: AppState, fovY: float, canNap: bool): bool {
  cameraMoveSpeed := 5.0f
  cameraZoomSpeed := 10.0f
  let needsRender = false
  events := host.pollEvents(canNap)
  for event of events {
    case event.kind() {
      .CloseRequested -> {}
      .RenderRequested -> {
        needsRender = true
      }
      .EscapeRequested -> {
        needsRender = hostCancelInteraction(input, app) || needsRender
      }
      .NewGameRequested -> {
        appNewGame(app, host.ticks())
        needsRender = true
      }
      .AutoCompleteRequested -> {
        appAutoComplete(app)
        needsRender = true
      }
      .UndoRequested -> {
        if appUndo(app) {
          needsRender = true
        }
      }
      .RedoRequested -> {
        if appRedo(app) {
          needsRender = true
        }
      }
      .MouseDown -> {
        needsRender = true
        hostMouseDown(input, app, event.x(), event.y(), host.dpiScale())
      }
      .MouseUp -> {
        needsRender = true
        result := hostMouseUp(
          input,
          app,
          event.x(),
          event.y(),
          float(host.windowWidth()),
          float(host.windowHeight()),
          fovY,
          host.dpiScale()
        )

        if result == 2 {
          appNewGame(app, host.ticks())
        }
      }
      .MouseMove -> {
        needsRender = true
        hostMouseMove(
          input,
          app,
          event.x(),
          event.y(),
          float(host.windowWidth()),
          float(host.windowHeight()),
          fovY,
          host.dpiScale()
        )
      }
      .MouseWheel -> {
      }
      .KeyDown -> {
        if setDebugKeyState(input, event.key(), true) {
          needsRender = true
        }
      }
      .KeyUp -> {
        if setDebugKeyState(input, event.key(), false) {
          needsRender = true
        }
      }
      _ -> {}
    }
  }

  return needsRender
}

function runSeahaven(): Result<void, string> {
  windowWidth := 1280
  windowHeight := 800
  frameDelayMs := 16

  try host := NativeBoardgameHost.create("Doof Seahaven Towers", windowWidth, windowHeight)
  try loadSharedCardAtlas(host, "samples/seahaven-towers/images/card_atlas.png")

  buttonTextureId := host.createSolidColorTexture(60, 60, 70, 255)
  whiteTextureId := host.createSolidColorTexture(255, 255, 255, 255)

  app := createApp(host.ticks())
  loadPlayingCardLibrary(app.cardLibrary)

  input := HostInput {}
  fovY := 65.0f * (PI / 180.0f)

  initialAspect := if float(host.pixelWidth()) > 0.0f && float(host.pixelHeight()) > 0.0f
    then float(host.pixelWidth()) / float(host.pixelHeight())
    else 1.0f
  initCamera(app, input, initialAspect, fovY)

  let canNap = false

  while host.isOpen() {
    inputNeedsRender := handleHostEvents(host, input, app, fovY, canNap)
    if !host.isOpen() {
      break
    }

    deltaTime := host.frameDeltaSeconds()
    needsRender := hostUpdate(input, app, deltaTime, host.pixelWidth(), host.pixelHeight(), fovY) || inputNeedsRender

    canNap = !needsRender

    worldPlan := buildWorldRenderPlan(app.state, app.cardLibrary)
    aspect := if float(host.pixelWidth()) > 0.0f && float(host.pixelHeight()) > 0.0f
      then float(host.pixelWidth()) / float(host.pixelHeight())
      else 1.0f
    worldMvp := computeWorldMVP(app.camera, aspect, fovY)
    uiPlan := buildUIRenderPlan(app.button, buttonTextureId, whiteTextureId)
    uiMvp := computeUIMVP(float(host.pixelWidth()), float(host.pixelHeight()))
    host.render(worldPlan, worldMvp, uiPlan, uiMvp)
  }

  host.close()
  return Success()
}

export function main(): int {
  result := runSeahaven()
  case result {
    s: Success -> {}
    f: Failure -> println(f.error)
  }

  return case result {
    s: Success -> 0,
    f: Failure -> 1
  }
}import {
  createGame,
  autoMoveAvailableToFoundation,
  renderState,
  listLegalMoves,
  checkWin
} from "./seahaven"

function printSuggestedMoves(moves: string[]): void {
  if moves.length == 0 {
    println("No immediate legal moves are available.")
    return
  }

  println("Immediate legal moves:")
  limit := if moves.length < 8 then moves.length else 8
  for i of 0..<limit {
    println(`  - ${moves[i]}`)
  }

  if moves.length > limit {
    println(`  ... plus ${moves.length - limit} more`)
  }
}

function main(): int {
  seed := 20260331
  state := createGame(seed)

  println("Seahaven Towers")
  println("================")
  println(`Seed: ${seed}`)
  println("")
  println("Rules: build down in suit on the tableau, use the four reserves as")
  println("single-card holding cells, supermove valid runs when space allows,")
  println("and move any card into an empty tableau column.")
  println("")
  println(renderState(state))
  println("")

  movedToFoundation := autoMoveAvailableToFoundation(state)
  if movedToFoundation > 0 {
    suffix := if movedToFoundation == 1 then "" else "s"
    println(`Auto-moved ${movedToFoundation} available foundation card${suffix}.`)
    println("")
    println(renderState(state))
    println("")
  }

  printSuggestedMoves(listLegalMoves(state))
  println("")
  println(`Solved: ${if checkWin(state) then "yes" else "no"}`)
  return 0
}