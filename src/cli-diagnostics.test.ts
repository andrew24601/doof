import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "./cli-core.js";

describe("CLI diagnostics", () => {
  it("formats source spans without shifting lexer coordinates", () => {
    expect(formatDiagnostic({
      severity: "error",
      message: "Wrong argument type",
      module: "game/tests/ui.test.do",
      span: {
        start: { line: 48, column: 67, offset: 1234 },
        end: { line: 48, column: 72, offset: 1239 },
      },
    })).toBe("game/tests/ui.test.do:48:67: error: Wrong argument type");
  });
});
