import { AppState, createApp, appNewGame, appAutoComplete } from "./app-state"
import { buildUIRenderPlan } from "cardgame/button"
import { computeUIMVP, computeWorldMVP } from "./camera"
import { NativeBoardgameEventKind } from "cardgame/types"
import { loadSharedCardAtlas, NativeBoardgameHost } from "cardgame/host-runtime"
import { loadPlayingCardLibrary } from "cardgame/content"
import { PI } from "cardgame/math"
import { buildWorldRenderPlan } from "./render"
import { HostInput, debugMoveX, debugMoveZ, debugZoomDirection, hostCancelInteraction, hostMouseDown, hostMouseMove, hostMouseUp, hostUpdate, initCamera, setDebugKeyState } from "./host"

function handleHostEvents(host: NativeBoardgameHost, input: HostInput, app: AppState, fovY: float): bool {
  cameraMoveSpeed := 5.0f
  cameraZoomSpeed := 10.0f
  let needsRender = false
  events := host.pollEvents()
  for event of events {
    case event.kind() {
      .CloseRequested => {}
      .RenderRequested => {
        needsRender = true
      }
      .EscapeRequested => {
        needsRender = hostCancelInteraction(input, app) || needsRender
      }
      .NewGameRequested => {
        appNewGame(app, host.ticks())
        needsRender = true
      }
      .AutoCompleteRequested => {
        appAutoComplete(app)
        needsRender = true
      }
      .MouseDown => {
        needsRender = true
        hostMouseDown(input, app, event.x(), event.y(), host.dpiScale())
      }
      .MouseUp => {
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
      .MouseMove => {
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
      .MouseWheel => {
      }
      .KeyDown => {
        if setDebugKeyState(input, event.key(), true) {
          needsRender = true
        }
      }
      .KeyUp => {
        if setDebugKeyState(input, event.key(), false) {
          needsRender = true
        }
      }
      _ => {}
    }
  }

  return needsRender
}

function runSolitaire(): Result<void, string> {
  windowWidth := 1280
  windowHeight := 800
  frameDelayMs := 16

  try host := NativeBoardgameHost.create("Doof Solitaire", windowWidth, windowHeight)
  try loadSharedCardAtlas(host, "samples/solitaire/images/card_atlas.png")

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

  while host.isOpen() {
    inputNeedsRender := handleHostEvents(host, input, app, fovY)
    if !host.isOpen() {
      break
    }
    deltaTime := host.frameDeltaSeconds()
    needsRender := hostUpdate(input, app, deltaTime, host.pixelWidth(), host.pixelHeight(), fovY) || inputNeedsRender

    if !needsRender {
      host.delay(frameDelayMs)
      continue
    }

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
  result := runSolitaire()
  case result {
    s: Success => {}
    f: Failure => println(f.error)
  }

  return case result {
    s: Success => 0,
    f: Failure => 1
  }
}