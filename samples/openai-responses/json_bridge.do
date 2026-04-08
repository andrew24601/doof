export import function jsonIsObject(value: JsonValue): bool from "./native_json_bridge.hpp" as doof_openai::jsonIsObject
export import function jsonIsArray(value: JsonValue): bool from "./native_json_bridge.hpp" as doof_openai::jsonIsArray
export import function jsonObjectGet(value: JsonValue, key: string): JsonValue from "./native_json_bridge.hpp" as doof_openai::jsonObjectGet
export import function jsonArrayValues(value: JsonValue): JsonValue[] from "./native_json_bridge.hpp" as doof_openai::jsonArrayValues
export import function jsonStringValue(value: JsonValue): string | null from "./native_json_bridge.hpp" as doof_openai::jsonStringValue