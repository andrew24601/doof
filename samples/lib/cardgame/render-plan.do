import { RenderVertex } from "./vertex"

export class RenderDraw {
  textureId: int = -1
  vertices: RenderVertex[] = []
}

export class WorldRenderPlan {
  draws: RenderDraw[] = []
}