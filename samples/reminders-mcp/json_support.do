import { formatJsonValue, parseJsonValue } from "std/json"

export function parseJsonText(text: string): Result<JsonValue, string> => parseJsonValue(text)

export function parseJsonTextOrPanic(text: string): JsonValue => try! parseJsonValue(text)

export function formatJsonText(value: JsonValue): string => formatJsonValue(value)

export function parseJsonResult(result: Result<string, string>): Result<JsonValue, string> {
  return case result {
    s: Success -> case parseJsonValue(s.value) {
      parsed: Success -> Success(parsed.value),
      failed: Failure -> Failure("Native reminders bridge returned invalid JSON: " + failed.error)
    },
    f: Failure -> Failure(f.error)
  }
}