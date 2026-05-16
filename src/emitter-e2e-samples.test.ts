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

function createFsPackageWorkspace(appName: string, mainSource: string): string {
  const sampleDir = path.join(process.cwd(), "samples", "lib", "fs");
  const workspaceDir = path.join(ctx.tmpDir, appName);
  const appDir = path.join(workspaceDir, "app");
  const depsDir = path.join(workspaceDir, "deps", "fs");

  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.dirname(depsDir), { recursive: true });
  fs.cpSync(sampleDir, depsDir, { recursive: true });

  fs.writeFileSync(path.join(appDir, "doof.json"), JSON.stringify({
    name: appName,
    version: "0.1.0",
    dependencies: {
      fs: { path: "../deps/fs" },
    },
  }, null, 2));
  fs.writeFileSync(path.join(appDir, "main.do"), `${mainSource}\n`, "utf8");

  return path.join(appDir, "main.do");
}

function loadSolitaireLogicSample(overrides: Record<string, string> = {}): Record<string, string> {
  const sampleDir = path.join(process.cwd(), "samples", "solitaire");
  return {
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
          `import { SolitaireState, updateCardPositions } from "./game"`,
          `import { handleDragStart, handleDragMove, handleDragEnd } from "./input"`,
          ``,
          `function main(): void {`,
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
    );

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(["2", "0", "2", "0", "-1"].join("\n"));
  });
});

describeSkipOnWindows("e2e — fs package sample", () => {
  it("imports the package root as fs and performs core file operations", () => {
    const sandboxDir = path.join(ctx.tmpDir, "fs-package-sandbox");
    const seedDir = path.join(sandboxDir, "seed");
    const seedFile = path.join(seedDir, "seed.txt");
    const symlinkPath = path.join(sandboxDir, "seed-link");

    fs.rmSync(sandboxDir, { recursive: true, force: true });
    fs.mkdirSync(seedDir, { recursive: true });
    fs.writeFileSync(seedFile, "seed", "utf8");
    fs.symlinkSync(seedFile, symlinkPath);

    const entryPath = createFsPackageWorkspace(
      "fs-consumer",
      [
        `import { appendText, copy, DirEntry, EntryKind, exists, isDirectory, isFile, mkdir, readBytes, readDir, readText, remove, rename, writeBytes, writeText } from "fs"`,
        ``,
        `function findEntry(entries: DirEntry[], name: string): DirEntry | null {`,
        `  for entry of entries {`,
        `    if entry.name == name {`,
        `      return entry`,
        `    }`,
        `  }`,
        `  return null`,
        `}`,
        ``,
        `function main(): int {`,
        `  root := ${JSON.stringify(sandboxDir)}`,
        `  workspace := "${sandboxDir}/workspace"`,
        `  nested := "${sandboxDir}/workspace/nested"`,
        `  textPath := "${sandboxDir}/workspace/note.txt"`,
        `  copyPath := "${sandboxDir}/workspace/copy.txt"`,
        `  movedPath := "${sandboxDir}/workspace/moved.txt"`,
        `  bytesPath := "${sandboxDir}/workspace/data.bin"`,
        ``,
        `  assert(exists(root), "expected the sandbox root to exist")`,
        `  assert(!exists(workspace), "expected the workspace to start absent")`,
        `  try! mkdir(workspace)`,
        `  try! mkdir(nested)`,
        ``,
        `  assert(exists(workspace), "expected mkdir to create the workspace")`,
        `  assert(isDirectory(workspace), "expected the workspace to be a directory")`,
        `  assert(!isFile(workspace), "expected directories to not report as files")`,
        ``,
        `  try! writeText(textPath, "alpha")`,
        `  try! appendText(textPath, "-beta")`,
        `  assert(try! readText(textPath) == "alpha-beta", "expected appended text content")`,
        ``,
        `  try! copy(textPath, copyPath)`,
        `  try! rename(copyPath, movedPath)`,
        `  assert(!exists(copyPath), "expected rename to remove the old path")`,
        `  assert(exists(movedPath), "expected rename to create the new path")`,
        `  assert(isFile(movedPath), "expected renamed file to report as file")`,
        ``,
        `  try! writeBytes(bytesPath, [1, 2, 255])`,
        `  bytes := try! readBytes(bytesPath)`,
        `  assert(bytes.length == 3, "expected three bytes")`,
        `  assert(bytes[0] == 1, "expected the first byte value")`,
        `  assert(bytes[2] == 255, "expected the final byte value")`,
        ``,
        `  entries := try! readDir(root)`,
        `  seedLink := findEntry(entries, "seed-link")`,
        `  assert(seedLink != null, "expected readDir to include the symlink")`,
        `  assert(seedLink!.kind == EntryKind.Symlink, "expected symlink classification")`,
        ``,
        `  workspaceEntries := try! readDir(workspace)`,
        `  noteEntry := findEntry(workspaceEntries, "note.txt")`,
        `  assert(noteEntry != null, "expected readDir to include note.txt")`,
        `  assert(noteEntry!.kind == EntryKind.File, "expected note.txt to be a file")`,
        `  assert(noteEntry!.size == 10L, "expected note.txt size to reflect appended text")`,
        ``,
        `  nestedEntry := findEntry(workspaceEntries, "nested")`,
        `  assert(nestedEntry != null, "expected readDir to include nested directory")`,
        `  assert(nestedEntry!.kind == EntryKind.Directory, "expected nested to be a directory")`,
        ``,
        `  try! remove(movedPath)`,
        `  try! remove(textPath)`,
        `  try! remove(bytesPath)`,
        `  try! remove(nested)`,
        `  try! remove(workspace)`,
        `  try! remove("${symlinkPath}")`,
        `  try! remove("${seedFile}")`,
        `  try! remove("${seedDir}")`,
        ``,
        `  println("ok")`,
        `  return 0`,
        `}`,
      ].join("\n"),
    );

    const result = ctx.compileAndRunManifestProject(entryPath);

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });

  it("maps common native failures onto IoError values", () => {
    const sandboxDir = path.join(ctx.tmpDir, "fs-package-errors");
    const existingDir = path.join(sandboxDir, "existing-dir");
    const sourcePath = path.join(sandboxDir, "source.txt");
    const copiedPath = path.join(sandboxDir, "copied.txt");

    fs.rmSync(sandboxDir, { recursive: true, force: true });
    fs.mkdirSync(existingDir, { recursive: true });

    const entryPath = createFsPackageWorkspace(
      "fs-errors",
      [
        `import { copy, IoError, mkdir, readText, writeText } from "fs"`,
        ``,
        `function main(): int {`,
        `  case readText("${path.join(sandboxDir, "missing.txt")}") {`,
        `    s: Success -> assert(false, "expected missing file read to fail")`,
        `    f: Failure -> assert(f.error == IoError.NotFound, "expected NotFound for missing files")`,
        `  }`,
        ``,
        `  case mkdir("${existingDir}") {`,
        `    s: Success -> assert(false, "expected mkdir on an existing dir to fail")`,
        `    f: Failure -> assert(f.error == IoError.AlreadyExists, "expected AlreadyExists for mkdir")`,
        `  }`,
        ``,
        `  case readText("${existingDir}") {`,
        `    s: Success -> assert(false, "expected directory text reads to fail")`,
        `    f: Failure -> assert(f.error == IoError.IsDirectory, "expected IsDirectory when reading a directory")`,
        `  }`,
        ``,
        `  try! writeText("${sourcePath}", "copy-me")`,
        `  try! copy("${sourcePath}", "${copiedPath}")`,
        `  case copy("${sourcePath}", "${copiedPath}") {`,
        `    s: Success -> assert(false, "expected copy to reject existing destinations")`,
        `    f: Failure -> assert(f.error == IoError.AlreadyExists, "expected AlreadyExists for duplicate copy targets")`,
        `  }`,
        ``,
        `  println("ok")`,
        `  return 0`,
        `}`,
      ].join("\n"),
    );

    const result = ctx.compileAndRunManifestProject(entryPath);

    if (result.exitCode === -1) {
      expect.unreachable(`Compile error: ${result.stderr}`);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});
