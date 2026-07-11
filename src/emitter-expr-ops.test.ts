import { describe, expect, it } from "vitest";
import { emit, emitMulti } from "./emitter-test-helpers.js";

describe("emitter expression operators", () => {
  it("emits special binary operators and nullable comparisons", () => {
    const cpp = emit(`
      class Left { value: int }
      class Right { value: int }

      function shift(value: int, amount: int): int => value >>> amount
      function coalesceOptional(value: int | null, fallback: int): int => value ?? fallback
      function coalescePointer(value: Left | null, fallback: Left): Left => value ?? fallback
      function inclusive(): Range => 1..4
      function exclusive(): Range => 1..<4
      function leftString(value: int): string => "value=" + value
      function rightString(value: int): string => value + "!"
      function jsonRight(value: JsonValue): bool => value == null
      function jsonLeft(value: JsonValue): bool => null != value
      function jsonLeftEqual(value: JsonValue): bool => null == value
      function optionalLeft(value: int | null): bool => null == value
      function pointerLeft(value: Left | null): bool => null != value
      function variantRight(value: Left | Right | null): bool => value == null
      function variantLeft(value: Left | Right | null): bool => null != value
    `);

    expect(cpp).toContain("static_cast<int32_t>(static_cast<uint32_t>(value) >> amount)");
    expect(cpp).toContain("(value ? *value : fallback)");
    expect(cpp).toContain("(value ? value : fallback)");
    expect(cpp).toContain("doof::range(1, 4)");
    expect(cpp).toContain("doof::range_exclusive(1, 4)");
    expect(cpp).toContain('std::string("value=") + doof::to_string(value)');
    expect(cpp).toContain('doof::to_string(value) + std::string("!")');
    expect(cpp).toContain("doof::json_is_null(value)");
    expect(cpp).toContain("!doof::json_is_null(value)");
    expect(cpp).toContain("std::nullopt == value");
    expect(cpp).toContain("nullptr != value");
    expect(cpp).toContain("std::holds_alternative<std::monostate>(value)");
  });

  it("emits try operators for value and void Results", () => {
    const cpp = emit(`
      function read(): Result<int, string> => Success(7)
      function write(): Result<void, string> => Success()

      function take(): int {
        return try! read()
      }

      function positive(value: int): int => +value
      function bitNot(value: int): int => ~value
      function nested(value: int): int => -(-value)

      function finish(): void {
        try! write()
      }

      function maybe(): int | null {
        return try? read()
      }
    `);

    expect(cpp).toContain("[&]() -> int32_t");
    expect(cpp).toContain("[&]() -> void");
    expect(cpp).toContain("std::optional<int32_t>");
    expect(cpp).toContain("+value");
    expect(cpp).toContain("~value");
    expect(cpp).toContain("-(-value)");
    expect(cpp).toContain("doof::is_failure(_try_");
    expect(cpp).toContain("std::move(doof::success_value(_try_");
  });

  it("emits compound assignments and map/array assignment paths", () => {
    const cpp = emit(`
      function mutate(values: int[], lookup: Map<string, int>): void {
        values[0] += 1
        lookup["count"] = 1
        lookup["count"] += 1
        let optional: int | null = null
        optional ??= 5

        let quotient = 8
        quotient \\= 2
        quotient **= 2
      }
    `);

    expect(cpp).toContain("doof::array_at(values, 0");
    expect(cpp).toContain("doof::map_set(lookup, std::string(\"count\"), 1");
    expect(cpp).toContain("doof::map_at(lookup, std::string(\"count\")");
    expect(cpp).toContain("if (!optional) optional = 5");
    expect(cpp).toContain("quotient /= 2");
    expect(cpp).toContain("quotient = std::pow(quotient, 2)");
  });

  it("emits specialized member access for enums, collections, Results, and metadata", () => {
    const cpp = emit(`
      enum Color { Red, Blue }

      class Tool "A tool." {
        name: string
        static readonly kind = "tool"
        static create(value: int): Tool => Tool { name: string(value) }
        function run(input: string): string => input
      }

      function enumValue(color: Color): int => color.value
      function enumName(color: Color): string => color.name
      function enumVariant(): Color => Color.Red
      function stringLength(value: string): int => value.length
      function arrayLength(value: int[]): int => value.length
      function mapLength(value: Map<string, int>): int => value.size
      function setLength(value: Set<int>): int => value.size
      function rangeLower(value: Range): int => value.lowerBound
      function rangeUpper(value: Range): int => value.upperBound
      function resultValue(value: Result<int, string>): int => value.value
      function resultError(value: Result<int, string>): string => value.error
      function successValue(value: Success<int>): int => value.value
      function failureError(value: Failure<string>): string => value.error
      function staticKind(): string => Tool.kind
      function staticDecoder(): (json: JsonValue, lenient: bool): Result<Tool, string> => Tool.fromJsonValue
      function staticFactory(): (value: int): Tool => Tool.create
      function metadataName(): string => Tool.metadata.name
      function metadataDescription(): string => Tool.metadata.description
      function metadataDefs(): JsonValue | null => Tool.metadata.defs
      function methodName(): string => Tool.metadata.methods[0].name
      function methodDescription(): string => Tool.metadata.methods[0].description
      function methodInput(): JsonValue => Tool.metadata.methods[0].inputSchema
      function methodOutput(): JsonValue => Tool.metadata.methods[0].outputSchema
      function methodInvoke(tool: Tool, params: JsonValue): Result<JsonValue, JsonValue> => Tool.metadata.methods[0].invoke(tool, params)
    `);

    expect(cpp).toContain("static_cast<int32_t>(color)");
    expect(cpp).toContain("Color_name(color)");
    expect(cpp).toContain("Color::Red");
    expect(cpp).toContain("(int32_t)value.length()");
    expect(cpp).toContain("(int32_t)value->size()");
    expect(cpp).toContain("value.lowerBound");
    expect(cpp).toContain("doof::success_value(value)");
    expect(cpp).toContain("doof::failure_error(value)");
    expect(cpp).toContain("value.value");
    expect(cpp).toContain("value.error");
    expect(cpp).toContain("Tool::kind");
    expect(cpp).toContain("Tool::fromJsonValue");
    expect(cpp).toContain("Tool::_metadata.name");
    expect(cpp).toContain("Tool::_metadata.description");
    expect(cpp).toContain("Tool::_metadata.defs");
    expect(cpp).toContain("Tool::_metadata.methods");
    expect(cpp).toContain(".description");
    expect(cpp).toContain(".inputSchema");
    expect(cpp).toContain(".outputSchema");
    expect(cpp).toContain(".invoke");
  });

  it("emits qualified static access and type metadata", () => {
    const cpp = emit(`
      class Tool {
        name: string
        static readonly kind = "tool"
        static make(): Tool => Tool { name: "made" }
      }

      function qualifiedKind(tool: Tool): string => tool::kind
      function qualifiedMetadata(tool: Tool): string => tool::metadata.name
      function qualifiedMake(tool: Tool): Tool => tool::make()
      function qualifiedDecoder(tool: Tool): (json: JsonValue, lenient: bool): Result<Tool, string> => tool::fromJsonValue
      function qualifiedFactory(tool: Tool): (): Tool => tool::make
      function optionalName(tool: Tool | null): string | null => tool?.name
      function optionalLength(value: string | null): int | null => value?.length
      function forcedName(tool: Tool | null): string => tool!.name

      function metadataOf<T: Reflectable>() => T.metadata
      function qualifiedMetadataOf<T: Reflectable>() => T::metadata.name
    `);

    expect(cpp).toContain("Tool::kind");
    expect(cpp).toContain("Tool::_metadata");
    expect(cpp).toContain("Tool::make()");
    expect(cpp).toContain("tool ? tool->name : decltype(tool->name){}");
    expect(cpp).toContain("tool->name");
    expect(cpp).toContain("doof::metadata_for_type<T>()");
  });

  it("emits interface and type-alias JSON static references", () => {
    const cpp = emit(`
      interface Shape {
        area(): int
      }

      class Circle implements Shape {
        const kind = "circle"
        radius: int
        function area(): int => radius * radius
      }

      class Square implements Shape {
        const kind = "square"
        side: int
        function area(): int => side * side
      }

      type ShapeUnion = Circle | Square

      function interfaceDecoder(): (json: JsonValue, lenient: bool): Result<Shape, string> => Shape.fromJsonValue
      function aliasDecoder(): (json: JsonValue, lenient: bool): Result<ShapeUnion, string> => ShapeUnion.fromJsonValue
      function aliasQualifiedDecoder(): (json: JsonValue, lenient: bool): Result<ShapeUnion, string> => ShapeUnion::fromJsonValue
    `);

    expect(cpp).toContain("Shape_fromJsonValue");
    expect(cpp).toContain("ShapeUnion_fromJsonValue");
  });

  it("emits metadata unions and variant field access", () => {
    const cpp = emit(`
      class First {
        value: int
      }

      class Second {
        value: int
      }

      type Either = First | Second

      function readVariant(value: Either): int => value.value

      function readMetadata(flag: bool): string {
        metadata := if flag then First.metadata else Second.metadata
        return metadata.name
      }
    `);

    expect(cpp).toContain("std::visit");
    expect(cpp).toContain("_obj->value");
    expect(cpp).toContain("metadata.name");
  });

  it("emits interface-qualified metadata access", () => {
    const cpp = emit(`
      interface Named {
        name: string
      }

      class First implements Named {
        name: string
      }

      class Second implements Named {
        name: string
      }

      function read(value: Named): string => value::metadata.name
    `);

    expect(cpp).toContain("std::visit");
    expect(cpp).toContain("::_metadata");
  });

  it("emits nullable and non-nullable collection indexing", () => {
    const cpp = emit(`
      function arrayAt(values: int[], index: int): int => values[index]
      function mapAt(values: Map<string, int>, key: string): int => values[key]
      function optionalArray(values: int[] | null, index: int): int | null => values?[index]
      function optionalMap(values: Map<string, int> | null, key: string): int | null => values?[key]
    `);

    expect(cpp).toContain("doof::array_at(values, index");
    expect(cpp).toContain("doof::map_at(values, key");
    expect(cpp).toContain("if (values) return doof::array_at(values, index");
    expect(cpp).toContain("if (values) return doof::map_at(values, key");
  });

  it("emits string indexing", () => {
    const cpp = emit(`
      function main(): int {
        i := "12"[0]
        return 0
      }
    `);

    expect(cpp).toContain('auto i = doof::string_at(std::string("12"), 0, "main.do", 3);');
  });

  it("emits namespace and imported member references canonically", () => {
    const cpp = emitMulti({
      "/main.do": `
        import * as config from "./config"
        function read(): string => config.name
      `,
      "/config.do": `
        export readonly name = "configured"
      `,
    }, "/main.do");

    expect(cpp).toContain("config::name");
  });
});
