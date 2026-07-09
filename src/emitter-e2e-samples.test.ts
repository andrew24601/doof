import { afterAll, beforeAll, describe as vitestDescribe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { E2EContext, hasNativeToolchain } from "./e2e-test-helpers.js";

const ctx = new E2EContext();
const describe = hasNativeToolchain() ? vitestDescribe : vitestDescribe.skip;
const describeSkipOnWindows = process.platform === "win32" ? vitestDescribe.skip : describe;

beforeAll(() => ctx.setup());
afterAll(() => ctx.cleanup());

function loadSharedBoardgamePackages(): Record<string, string> {
  const boardgameDir = path.join(process.cwd(), "samples", "lib", "cardgame");
  return {
    "/lib/cardgame/doof.json": fs.readFileSync(path.join(boardgameDir, "doof.json"), "utf8"),
    "/lib/cardgame/index.do": fs.readFileSync(path.join(boardgameDir, "index.do"), "utf8"),
    "/lib/cardgame/cards.do": fs.readFileSync(path.join(boardgameDir, "cards.do"), "utf8"),
    "/lib/cardgame/content.do": fs.readFileSync(path.join(boardgameDir, "content.do"), "utf8"),
    "/lib/cardgame/math.do": fs.readFileSync(path.join(boardgameDir, "math.do"), "utf8"),
    "/lib/cardgame/matrix.do": fs.readFileSync(path.join(boardgameDir, "matrix.do"), "utf8"),
    "/lib/cardgame/sprite.do": fs.readFileSync(path.join(boardgameDir, "sprite.do"), "utf8"),
    "/lib/cardgame/vertex.do": fs.readFileSync(path.join(boardgameDir, "vertex.do"), "utf8"),
  };
}

function loadSolitaireLogicSample(overrides: Record<string, string> = {}): Record<string, string> {
  const sampleDir = path.join(process.cwd(), "samples", "solitaire");
  const randomDir = path.join(process.cwd(), "../doof-stdlib", "random");
  return {
    "/__doof_stdlib__/std/random/index.do": fs.readFileSync(path.join(randomDir, "index.do"), "utf8"),
    "/solitaire/doof.json": fs.readFileSync(path.join(sampleDir, "doof.json"), "utf8"),
    "/solitaire/game.do": fs.readFileSync(path.join(sampleDir, "game.do"), "utf8"),
    "/solitaire/input.do": fs.readFileSync(path.join(sampleDir, "input.do"), "utf8"),
    "/solitaire/rules.do": fs.readFileSync(path.join(sampleDir, "rules.do"), "utf8"),
    ...loadSharedBoardgamePackages(),
    ...overrides,
  };
}

describe("e2e — solitaire sample logic", () => {
  it("allows dragging a card from foundation back to tableau", () => {
    const result = ctx.compileAndRunProject(
      loadSolitaireLogicSample({
        "/solitaire/main.do": [
          `import { Suit, Rank, PlayingCard, Card } from "cardgame/cards"`,
          `import { SolitaireState, shuffle, updateCardPositions } from "./game"`,
          `import { handleDragStart, handleDragMove, handleDragEnd } from "./input"`,
          ``,
          `function main(): void {`,
          `  deck := [0, 1, 2, 3]`,
          `  shuffle(deck)`,
          `  let seen0 = false`,
          `  let seen1 = false`,
          `  let seen2 = false`,
          `  let seen3 = false`,
          `  for card of deck {`,
          `    case card {`,
          `      0 -> { seen0 = true }`,
          `      1 -> { seen1 = true }`,
          `      2 -> { seen2 = true }`,
          `      3 -> { seen3 = true }`,
          `      _ -> { assert(false, "shuffle introduced an unknown card") }`,
          `    }`,
          `  }`,
          `  assert(deck.length == 4, "shuffle changed the deck length")`,
          `  assert(seen0 && seen1 && seen2 && seen3, "shuffle lost a card")`,
          ``,
          `  state := SolitaireState {}`,
          `  state.cardInfo = [`,
          `    PlayingCard { suit: .Hearts, rank: .Five },`,
          `    PlayingCard { suit: .Spades, rank: .Six }`,
          `  ]`,
          `  state.cards = [Card {}, Card {}]`,
          ``,
          `  foundation := state.foundation(1)`,
          `  foundation.x = -100.0f`,
          `  foundation.z = -50.0f`,
          `  foundation.cardIndices = [0]`,
          `  foundation.firstFaceUpIndex = 0`,
          ``,
          `  tableau := state.tableau(0)`,
          `  tableau.x = 0.0f`,
          `  tableau.z = 100.0f`,
          `  tableau.cardIndices = [1]`,
          `  tableau.firstFaceUpIndex = 0`,
          ``,
          `  updateCardPositions(state)`,
          ``,
          `  handleDragStart(state, foundation.x, foundation.z)`,
          `  println(string(state.selectedPileType))`,
          ``,
          `  handleDragMove(state, tableau.x, 130.0f)`,
          `  handleDragEnd(state, tableau.x, 130.0f)`,
          ``,
          `  println(string(foundation.cardIndices.length))`,
          `  println(string(tableau.cardIndices.length))`,
          `  println(string(tableau.topCardIndex()))`,
          `  println(string(state.selectedPileType))`,
          `}`,
        ].join("\n"),
      }),
      "/solitaire/main.do",
      { includePaths: [path.join(process.cwd(), "../doof-stdlib", "random")] },
    );

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(["2", "0", "2", "0", "-1"].join("\n"));
  });
});
