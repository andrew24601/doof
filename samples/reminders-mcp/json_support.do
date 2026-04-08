export function parseJsonText(text: string): Result<JsonValue, string> => JSON.parse(text)

export function parseJsonTextOrPanic(text: string): JsonValue => try! JSON.parse(text)

export function parseJsonResult(result: Result<string, string>): Result<JsonValue, string> {
  return case result {
    s: Success => case JSON.parse(s.value) {
      parsed: Success => Success(parsed.value),
      failed: Failure => Failure("Native reminders bridge returned invalid JSON: " + failed.error)
    },
    f: Failure => Failure(f.error)
  }
}