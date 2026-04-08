/**
 * Emitter tests — structured metadata and per-method invoke generation.
 *
 * Tests C++ code generation for structured doof::ClassMetadata with
 * per-method invoke lambdas returning doof::Result<doof::JSONValue, any>.
 */

import { describe, it, expect } from "vitest";
import { emit } from "./emitter-test-helpers.js";

// ============================================================================
// Structured metadata emission
// ============================================================================

describe("emitter — structured metadata", () => {
  it("emits static ClassMetadata field when class uses .metadata", () => {
    const cpp = emit(`
      class Tool "A tool." {
        name: string
        function run "Runs it."(input "The input.": string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("static const doof::ClassMetadata<Tool> _metadata;");
    expect(cpp).toContain("inline const doof::ClassMetadata<Tool> Tool::_metadata = {");
    expect(cpp).toContain('"Tool"');
    expect(cpp).toContain('"A tool."');
    expect(cpp).toContain("doof::MethodReflection<Tool>");
    expect(cpp).toContain('"run"');
    expect(cpp).toContain('"Runs it."');
  });

  it("includes method descriptions in metadata", () => {
    const cpp = emit(`
      class Tool {
        function run "Runs the tool."(input: string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain('"Runs the tool."');
  });

  it("includes schema strings for methods", () => {
    const cpp = emit(`
      class Tool {
        function run(input "The input.": string): string => input
      }
      const m = Tool.metadata
    `);
    // inputSchema and outputSchema are embedded JSON constants parsed to JSONValue
    expect(cpp).toContain("_doof_schema_");
    expect(cpp).toContain('"input"');
  });

  it("includes int64 schema format for long metadata surfaces", () => {
    const cpp = emit(`
      class Tool {
        function run(limit: long): long => limit
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain('"format":"int64"');
  });

  it("excludes private methods from metadata", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
        private function helper(): void { }
      }
      const m = Tool.metadata
    `);
    expect(cpp).not.toMatch(/"helper"/);
  });

  it("excludes static methods from metadata", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
        static function create(): Tool => Tool { }
      }
      const m = Tool.metadata
    `);
    expect(cpp).not.toMatch(/"create"/);
  });

  it("generates per-method invoke lambda returning Result", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("doof::Result<doof::JSONValue, doof::Any>");
    expect(cpp).toContain("_instance->run(");
    expect(cpp).toContain("::success(");
  });

  it("invoke lambda returns failure on invalid JSON", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("::failure(");
    expect(cpp).toContain("Invalid JSON params");
    expect(cpp).toContain("doof::Any{std::string(\"Invalid JSON params: expected object\")}");
  });

  it("void return methods produce success(\"null\")", () => {
    const cpp = emit(`
      class Tool {
        function doStuff(): void { }
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("::success(doof::JSONValue(nullptr))");
  });

  it("unwraps Result-returning methods into invoke success or any failure", () => {
    const cpp = emit(`
      class ToolError {
        message: string
      }
      class Tool {
        function run(input: string): Result<string, ToolError> => Failure(ToolError { message: input })
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("if (_result.isFailure()) {");
    expect(cpp).toContain("doof::Result<doof::JSONValue, doof::Any>::failure(doof::Any{_result.error()})");
    expect(cpp).toContain("auto _success = _result.value();");
    expect(cpp).toContain('"type":"string"');
  });

  it("treats Result<void, E> success as JSON null", () => {
    const cpp = emit(`
      class Tool {
        function reset(): Result<void, string> => Success()
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("_result.value();");
    expect(cpp).toContain("doof::Result<doof::JSONValue, doof::Any>::success(doof::JSONValue(nullptr))");
    expect(cpp).toContain('"type":"null"');
  });

  it("emits metadata access as ClassName::_metadata", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("Tool::_metadata");
  });

  it("emits instance-qualified metadata access as ClassName::_metadata", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
      }
      function getName(tool: Tool): string => tool::metadata.name
    `);
    expect(cpp).toContain("Tool::_metadata.name");
  });

  it("emits interface-value-qualified metadata access via std::visit", () => {
    const cpp = emit(`
      interface NamedTool {
        static describe(): string
      }
      class Tool implements NamedTool {
        function run(input: string): string => input
        static describe(): string => "tool"
      }
      function getName(tool: NamedTool): string => tool::metadata.name
    `);
    expect(cpp).toContain("std::visit(");
    expect(cpp).toContain("_metadata");
  });

  it("populates $defs for class-typed parameters", () => {
    const cpp = emit(`
      class Config {
        host: string
        port: int
      }
      class Tool {
        function configure(config: Config): string => config.host
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("_doof_defs_");
    expect(cpp).toContain('"Config"');
  });

  it("omits $defs when no class types referenced", () => {
    const cpp = emit(`
      class Tool {
        function add(a: int, b: int): int => a + b
      }
      const m = Tool.metadata
    `);
    // Empty string for defs when no class types
    expect(cpp).not.toContain("_doof_defs_");
  });

  it("handles multiple methods with separate reflection entries", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
        function stop(): void { }
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain('"run"');
    expect(cpp).toContain('"stop"');
    // Two MethodReflection entries
    const reflectionCount = (cpp.match(/doof::MethodReflection<Tool>\{/g) || []).length;
    expect(reflectionCount).toBe(2);
  });

  it("also generates toJsonValue/fromJsonValue when metadata is used", () => {
    const cpp = emit(`
      class Tool {
        name: string
        function run(input: string): string => input
      }
      const m = Tool.metadata
    `);
    expect(cpp).toContain("toJsonValue()");
    expect(cpp).toContain("fromJsonValue(");
  });

  it("deserializes parameters from JSON in invoke lambda", () => {
    const cpp = emit(`
      class Calculator {
        function add(a: int, b: int): int => a + b
      }
      const m = Calculator.metadata
    `);
    expect(cpp).toContain('_p->find("a")');
    expect(cpp).toContain('_p->find("b")');
  });
});

// ============================================================================
// No metadata when not used
// ============================================================================

describe("emitter — metadata not generated when unused", () => {
  it("does not emit metadata field when .metadata is not accessed", () => {
    const cpp = emit(`
      class Tool {
        function run(input: string): string => input
      }
    `);
    expect(cpp).not.toContain("_metadata");
    expect(cpp).not.toContain("MethodReflection");
  });

  it("does not emit metadata when only toJsonValue is used", () => {
    const cpp = emit(`
      class Tool {
        name: string
        function run(input: string): string => input
      }
      function main(): void {
        const t = Tool { name: "test" }
        const json = t.toJsonValue()
      }
    `);
    expect(cpp).toContain("toJsonValue()");
    expect(cpp).not.toContain("_metadata");
    expect(cpp).not.toContain("MethodReflection");
  });
});
