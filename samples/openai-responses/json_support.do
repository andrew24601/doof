import { parseJsonValue } from "std/json"

export function parseJsonText(text: string): Result<JsonValue, string> => parseJsonValue(text)