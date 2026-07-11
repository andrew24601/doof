/**
 * Emitter tests for JsonValue wrapping and runtime coercions.
 *
 * These tests use the complete parse → analyze → check → emit pipeline so the
 * exercised coercions are produced by real Doof programs and assignments.
 */

import { describe, expect, it } from "vitest";
import { emit } from "./emitter-test-helpers.js";

describe("emitter — JsonValue wrapping and coercion", () => {
  it("wraps scalar values through JsonValue assignments", () => {
    const cpp = emit(`
      function main(): int {
        byteValue: JsonValue := byte(7)
        boolValue: JsonValue := true
        intValue: JsonValue := 8
        longValue: JsonValue := 9L
        floatValue: JsonValue := 1.5f
        doubleValue: JsonValue := 2.5
        stringValue: JsonValue := "hello"
        nullValue: JsonValue := null
        return 0
      }
    `);

    expect(cpp).toContain("doof::json_value(static_cast<int32_t>(static_cast<uint8_t>(7)))");
    expect(cpp).toContain("doof::json_value(true)");
    expect(cpp).toContain("doof::json_value(8)");
    expect(cpp).toContain("doof::json_value(9LL)");
    expect(cpp).toContain("doof::json_value(1.5f)");
    expect(cpp).toContain("doof::json_value(2.5)");
    expect(cpp).toContain('doof::json_value(std::string("hello"))');
    expect(cpp).toContain("doof::json_value(nullptr)");
  });

  it("widens a Failure payload while preserving the failure arm", () => {
    const cpp = emit(`
      function widen(failure: Failure<int>): Failure<long> {
        return failure
      }
    `);

    expect(cpp).toContain("doof::Failure<int64_t>{failure.error}");
  });

  it("widens a Success payload while preserving the success arm", () => {
    const cpp = emit(`
      function widen(success: Success<int>): Success<long> {
        return success
      }
    `);

    expect(cpp).toContain("doof::Success<int64_t>{success.value}");
  });

  it("emits a payloadless Success conversion in a generic function", () => {
    const cpp = emit(`
      function discard<T>(success: Success<T>): Success<void> {
        return success
      }
    `);

    expect(cpp).toContain("doof::Success<void>{}");
  });

  it("emits a payloadless Failure conversion in a generic function", () => {
    const cpp = emit(`
      function discard<T>(failure: Failure<T>): Failure<void> {
        return failure
      }
    `);

    expect(cpp).toContain("doof::Failure<void>{}");
  });

  it("widens every member of a numeric union when returning a scalar", () => {
    const cpp = emit(`
      type Number = int | long

      function widen(value: Number): double {
        return value
      }
    `);

    expect(cpp).toContain("std::visit");
    expect(cpp).toContain("-> double");
    expect(cpp).toContain("Unsupported runtime coercion from union");
  });

  it("preserves null while widening a nullable union member", () => {
    const cpp = emit(`
      function widen(value: int | null): long | null {
        return value
      }
    `);

    expect(cpp).toContain("std::optional<int64_t>");
    expect(cpp).toContain("_coerce_src.has_value()");
    expect(cpp).toContain("_coerce_src.value()");
    expect(cpp).toContain("std::nullopt");
  });

  it("emits null for optional, nullable-class, and multi-member unions", () => {
    const cpp = emit(`
      class Box { value: int }

      function optionalValue(): int | null {
        return null
      }

      function optionalBox(): Box | null {
        return null
      }

      function multiMember(): Box | string | null {
        return null
      }
    `);

    expect(cpp).toContain("return std::nullopt;");
    expect(cpp).toContain("return nullptr;");
    expect(cpp).toContain("return std::monostate{};");
  });

  it("constructs a multi-member union when returning a concrete value", () => {
    const cpp = emit(`
      function choose(value: int): int | string {
        return value
      }
    `);

    expect(cpp).toContain("std::variant<int32_t, std::string>");
    expect(cpp).toContain("std::in_place_type<int32_t>");
  });
});
