import type { ResolvedType } from "./checker-types.js";

export function emitWrapJsonValue(sourceExpr: string, sourceType: ResolvedType): string {
  switch (sourceType.kind) {
    case "null":
      return "doof::JsonValue(nullptr)";

    case "primitive":
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

    default:
      throw new Error(`Cannot wrap type "${sourceType.kind}" as JsonValue during emission`);
  }
}