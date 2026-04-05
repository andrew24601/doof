import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ModuleAnalyzer } from "./analyzer.js";
import { ModuleResolver } from "./resolver.js";
import { collectSemanticDiagnostics } from "./pipeline-diagnostics.js";
import { VirtualFS } from "./test-helpers.js";

function loadSqliteSample(overrides: Record<string, string> = {}): Record<string, string> {
  const sampleDir = path.join(process.cwd(), "samples", "sqlite");
  return {
    "/sqlite/main.do": fs.readFileSync(path.join(sampleDir, "main.do"), "utf8"),
    "/sqlite/sqlite.do": fs.readFileSync(path.join(sampleDir, "sqlite.do"), "utf8"),
    ...overrides,
  };
}

function analyze(files: Record<string, string>, entry: string) {
  const vfs = new VirtualFS(files);
  const resolver = new ModuleResolver(vfs);
  const analyzer = new ModuleAnalyzer(vfs, resolver);
  return analyzer.analyzeModule(entry);
}

describe("sqlite sample", () => {
  it("has no semantic diagnostics with materialized row helpers", () => {
    const result = analyze(loadSqliteSample(), "/sqlite/main.do");
    const diagnostics = collectSemanticDiagnostics(result);
    expect(diagnostics).toHaveLength(0);
  });

  it("supports high-level execute and queryAll consumers", () => {
    const result = analyze(
      loadSqliteSample({
        "/sqlite/main.do": [
          `import { SqliteError, execute, open, queryAll, readBool, readInt, readText } from "./sqlite"`,
          ``,
          `function demo(): Result<int, SqliteError> {`,
          `  try database := open(":memory:")`,
          `  try execute(database, "CREATE TABLE todos (id INTEGER, title TEXT, done INTEGER)")`,
          `  try execute(database, "INSERT INTO todos(id, title, done) VALUES (?, ?, ?)", [1, "Ship queryAll", true])`,
          `  try rows := queryAll(database, "SELECT id, title, done FROM todos")`,
          `  if rows.length == 0 {`,
          `    return Success { value: -1 }`,
          `  }`,
          ``,
          `  try id := readInt(rows[0], "id")`,
          `  try title := readText(rows[0], "title")`,
          `  try done := readBool(rows[0], "done")`,
          `  if title == "Ship queryAll" && done {`,
          `    return Success { value: id }`,
          `  }`,
          ``,
          `  return Success { value: -2 }`,
          `}`,
        ].join("\n"),
      }),
      "/sqlite/main.do",
    );

    const diagnostics = collectSemanticDiagnostics(result);
    expect(diagnostics).toHaveLength(0);
  });
});