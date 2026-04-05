export enum NativeBoardgameEventKind {
  Unknown = 0,
  CloseRequested = 1,
  RenderRequested = 2,
  EscapeRequested = 3,
  NewGameRequested = 4,
  AutoCompleteRequested = 5,
  UndoRequested = 6,
  RedoRequested = 7,
  ToggleAutoCameraRequested = 8,
  MouseDown = 9,
  MouseUp = 10,
  MouseMove = 11,
  MouseWheel = 12,
  KeyDown = 13,
  KeyUp = 14,
}

export enum NativeBoardgameKey {
  Unknown = 0,
  W = 1,
  A = 2,
  S = 3,
  D = 4,
  Q = 5,
  E = 6,
}