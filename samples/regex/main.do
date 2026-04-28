import { Match, Regex, RegexError, RegexFlag } from "std/regex"

class SampleOutput {
  emailValid: bool
  firstReleaseDate: Match | null
  releaseYear: string | null
  releaseMonth: string | null
  releaseDay: string | null
  firstReleaseDateGroupCount: int
  hasReleaseWarning: bool
  normalizedWhitespace: string
  firstReplacement: string
}

function runSample(): Result<SampleOutput, RegexError> {
  try emailRegex := Regex.compile("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
  try ticketRegex := Regex.compile("([A-Z]+)-([0-9]+)", [RegexFlag.IgnoreCase])
  try dateRegex := Regex.compile("(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})")
  firstReleaseDate := dateRegex.find("Release train departs on 2026-03-30.")
  try whitespaceRegex := Regex.compile("\\s+")
  normalizedWhitespace := whitespaceRegex.replaceAll(" Release \t notes   need   cleanup ", " ")

  let releaseYear: string | null = null
  let releaseMonth: string | null = null
  let releaseDay: string | null = null
  let firstReleaseDateGroupCount = 0
  if firstReleaseDate != null {
    firstReleaseDateGroupCount = firstReleaseDate.captures.length
    [releaseYear, releaseMonth, releaseDay] = firstReleaseDate.captures
  }

  return Success {
    value: SampleOutput {
      emailValid: emailRegex.test("ops@doof.dev"),
      firstReleaseDate,
      releaseYear,
      releaseMonth,
      releaseDay,
      firstReleaseDateGroupCount,
      hasReleaseWarning: ticketRegex.test("Watch for DOOF-999 before cutting RC1"),
      normalizedWhitespace: normalizedWhitespace.trim(),
      firstReplacement: ticketRegex.replaceFirst("DOOF-104 / DOOF-105", "ticket"),
    }
  }
}

function formatMatch(match: Match | null): string {
  if match == null {
    return "no match"
  }

  (start, end) := match.range
  return "${match.value} at ${start}..${end}"
}

function formatOutput(output: SampleOutput): string {
  let text = "Regex sample\n"
  text += "Email is valid: ${output.emailValid}\n"
  text += "First release date: ${formatMatch(output.firstReleaseDate)}\n"
  text += "Date groups: ${output.firstReleaseDateGroupCount} -> ${output.releaseYear ?? "none"}-${output.releaseMonth ?? "none"}-${output.releaseDay ?? "none"}\n"
  text += "Release warning present: ${output.hasReleaseWarning}\n"
  text += "Normalized whitespace: ${output.normalizedWhitespace}\n"
  text += "Replace first: ${output.firstReplacement}"
  return text
}

function formatError(error: RegexError): string {
  let text = "Regex ${error.stage} failed"
  text += " for pattern ${error.pattern}"
  if error.flags.has(RegexFlag.IgnoreCase) {
    text += " (ignoreCase)"
  }
  text += ": ${error.message}"
  return text
}

function main(): int {
  result := runSample()

  println(case result {
    s: Success -> formatOutput(s.value),
    f: Failure -> formatError(f.error)
  })

  return case result {
    s: Success -> 0,
    f: Failure -> 1
  }
}