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

  it("surfaces ambiguous union object literals before emission", () => {
    const source = [
      'class Box {',
      '  const kind = "box"',
      '  width: float',
      '  height: float',
      '  color: string',
      '}',
      '',
      'class Toy {',
      '  const kind = "toy"',
      '  color: string',
      '}',
      '',
      'type Thing = Box | Toy',
      '',
      'function main(): int {',
      '  t: Thing := { color: "red" }',
      '  return 0',
      '}',
    ].join("\n");

    const result = analyze({ "/main.do": source }, "/main.do");
    const diagnostics = collectSemanticDiagnostics(result);
    const diagnostic = diagnostics.find((entry) => entry.message.includes('Object literal is ambiguous for union type "Box | Toy"'));

    expect(diagnostic).toBeTruthy();
    expect(diagnostic?.span.start.line).toBe(16);
    expect(() => throwIfErrorDiagnostics(diagnostics)).toThrow('/main.do:16:');
    expect(() => throwIfErrorDiagnostics(diagnostics)).toThrow('Object literal is ambiguous for union type "Box | Toy"');
  });
});