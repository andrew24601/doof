import type { ResolvedType } from "./checker-types.js";
import { emitType } from "./emitter-types.js";

export function emitWrapJsonValue(sourceExpr: string, sourceType: ResolvedType): string {
  switch (sourceType.kind) {
    case "null":
      return "doof::JsonValue(nullptr)";

    case "primitive":
      if (sourceType.name === "byte") {
        return `doof::JsonValue(static_cast<int32_t>(${sourceExpr}))`;
      }
      if (sourceType.name === "bool"
        || sourceType.name === "int"
        || sourceType.name === "long"
        || sourceType.name === "float"
        || sourceType.name === "double"
        || sourceType.name === "string") {
        return `doof::JsonValue(${sourceExpr})`;
      }
      throw new Error(`JsonValue wrapping does not support primitive type "${sourceType.name}"`);

    case "array": {
      if (sourceType.elementType.kind === "json-value") {
        return `doof::JsonValue(${sourceExpr})`;
      }
      throw new Error("JsonValue wrapping only supports JsonValue[] without explicit conversion");
    }

    case "map": {
      if (sourceType.keyType.kind === "primitive" && sourceType.keyType.name === "string" && sourceType.valueType.kind === "json-value") {
        return `doof::JsonValue(${sourceExpr})`;
      }
      throw new Error("JsonValue wrapping only supports Map<string, JsonValue> without explicit conversion");
    }

    case "union": {
      const branches = sourceType.types.map((memberType) => emitJsonUnionBranch(memberType));
      return `([&]() -> doof::JsonValue { auto&& _json_src = ${sourceExpr}; return std::visit([&](auto&& _value) -> doof::JsonValue {${branches.join(" ")} doof::panic("Unsupported JsonValue union member"); }, _json_src); })()`;
    }

    default:
      throw new Error(`Cannot wrap type "${sourceType.kind}" as JsonValue during emission`);
  }
}

function emitJsonUnionBranch(memberType: ResolvedType): string {
  const cppType = emitType(memberType);
  const wrappedValue = emitWrapJsonValue("_value", memberType);
  return ` if constexpr (std::is_same_v<std::decay_t<decltype(_value)>, ${cppType}>) { return ${wrappedValue}; }`;
}