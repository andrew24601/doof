export import function jsonIsObject(value: JSONValue): bool from "./native_json_bridge.hpp" as doof_openai::jsonIsObject
export import function jsonIsArray(value: JSONValue): bool from "./native_json_bridge.hpp" as doof_openai::jsonIsArray
export import function jsonObjectGet(value: JSONValue, key: string): JSONValue from "./native_json_bridge.hpp" as doof_openai::jsonObjectGet
export import function jsonArrayValues(value: JSONValue): JSONValue[] from "./native_json_bridge.hpp" as doof_openai::jsonArrayValues
export import function jsonStringValue(value: JSONValue): string | null from "./native_json_bridge.hpp" as doof_openai::jsonStringValue