import {
  Match,
  RegexError,
  compile,
  matches,
  replaceAll,
} from "./regex"

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
  try emailValid := matches(
    "ops@doof.dev",
    "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$",
  )
  try ticketRegex := compile("([A-Z]+)-([0-9]+)", true)
  try dateRegex := compile("([0-9]{4})-([0-9]{2})-([0-9]{2})")
  firstReleaseDate := dateRegex.find("Release train departs on 2026-03-30.")
  try normalizedWhitespace := replaceAll(
    " Release \t notes   need   cleanup ",
    "\\s+",
    " ",
  )

  let releaseYear: string | null = null
  let releaseMonth: string | null = null
  let releaseDay: string | null = null
  let firstReleaseDateGroupCount = 0
  if firstReleaseDate != null {
    firstReleaseDateGroupCount = firstReleaseDate.captureCount()
    [releaseYear, releaseMonth, releaseDay] = firstReleaseDate.groups
  }

  return Success {
    value: SampleOutput {
      emailValid,
      firstReleaseDate,
      releaseYear,
      releaseMonth,
      releaseDay,
      firstReleaseDateGroupCount,
      hasReleaseWarning: ticketRegex.search("Watch for DOOF-999 before cutting RC1"),
      normalizedWhitespace: normalizedWhitespace.trim(),
      firstReplacement: ticketRegex.replaceFirst("DOOF-104 / DOOF-105", "ticket"),
    }
  }
}

function formatMatch(match: Match | null): string {
  if match == null {
    return "no match"
  }

  return "${match.text} at ${match.start}..${match.end}"
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
  if error.ignoreCase {
    text += " (ignoreCase)"
  }
  text += ": ${error.message}"
  return text
}

function main(): int {
  result := runSample()

  println(case result {
    s: Success => formatOutput(s.value),
    f: Failure => formatError(f.error)
  })

  return case result {
    s: Success => 0,
    f: Failure => 1
  }
}