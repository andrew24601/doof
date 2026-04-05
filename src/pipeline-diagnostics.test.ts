import { describe, expect, it } from "vitest";
import { ModuleAnalyzer } from "./analyzer.js";
import { ModuleResolver } from "./resolver.js";
import { collectSemanticDiagnostics, throwIfErrorDiagnostics } from "./pipeline-diagnostics.js";
import { VirtualFS } from "./test-helpers.js";

function analyze(files: Record<string, string>, entry: string) {
  const fs = new VirtualFS(files);
  const resolver = new ModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(fs, resolver);
  return analyzer.analyzeModule(entry);
}

describe("pipeline diagnostics", () => {
  it("collects checker diagnostics across the pipeline", () => {
    const result = analyze(
      {
        "/main.do": `
          interface Shape {
            area(): float
          }
        `,
      },
      "/main.do",
    );

    const diagnostics = collectSemanticDiagnostics(result);
    expect(diagnostics.some((d) => d.message.includes("Cannot emit interface \"Shape\" without implementing classes"))).toBe(true);
  });

  it("throws formatted semantic errors before emission", () => {
    const result = analyze(
      {
        "/main.do": `
          interface Shape {
            area(): float
          }
        `,
      },
      "/main.do",
    );

    const diagnostics = collectSemanticDiagnostics(result);
    expect(() => throwIfErrorDiagnostics(diagnostics)).toThrow("Cannot emit interface \"Shape\" without implementing classes");
  });

  it("does not throw when semantic diagnostics are warning-only or empty", () => {
    const result = analyze(
      {
        "/main.do": `
          function add(a: int, b: int): int => a + b
        `,
      },
      "/main.do",
    );

    const diagnostics = collectSemanticDiagnostics(result);
    expect(() => throwIfErrorDiagnostics(diagnostics)).not.toThrow();
  });
});