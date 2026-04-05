export function parseJsonText(text: string): Result<JSONValue, string> => JSON.parse(text)

export function parseJsonTextOrPanic(text: string): JSONValue => try! JSON.parse(text)

export function parseJsonResult(result: Result<string, string>): Result<JSONValue, string> {
  return case result {
    s: Success => case JSON.parse(s.value) {
      parsed: Success => Success(parsed.value),
      failed: Failure => Failure("Native reminders bridge returned invalid JSON: " + failed.error)
    },
    f: Failure => Failure(f.error)
  }
}