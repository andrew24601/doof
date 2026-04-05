// Small Doof-first wrapper around a header-only std::regex bridge.

export import class NativeRegexSearchResult from "./native_regex.hpp" {
  found(): bool
  text(): string
  start(): int
  end(): int
  captureCount(): int
  captureFound(index: int): bool
  captureText(index: int): string
  captureStart(index: int): int
  captureEnd(index: int): int
}

export import class NativeRegex from "./native_regex.hpp" {
  static compile(pattern: string, ignoreCase: bool): Result<NativeRegex, string>
  matches(text: string): bool
  search(text: string): bool
  find(text: string): NativeRegexSearchResult
  replaceAll(text: string, replacement: string): string
  replaceFirst(text: string, replacement: string): string
}

export class RegexError {
  stage: string
  pattern: string
  ignoreCase: bool
  message: string
}

export class CaptureGroup {
  index: int
  text: string
  start: int
  end: int

  length(): int => this.end - this.start
}

export type Capture = CaptureGroup | null

export class Match {
  text: string
  start: int
  end: int
  groups: string[]
  captures: Capture[]

  length(): int => this.end - this.start

  captureCount(): int => this.captures.length

  capture(index: int): Capture {
    if index <= 0 || index > this.captures.length {
      return null
    }

    return this.captures[index - 1]
  }

  group(index: int): string | null {
    capture := this.capture(index)
    if capture == null {
      return null
    }

    return capture.text
  }
}

export class Regex {
  native: NativeRegex
  pattern: string
  ignoreCase: bool

  matches(text: string): bool => this.native.matches(text)

  search(text: string): bool => this.native.search(text)

  find(text: string): Match | null {
    nativeMatch := this.native.find(text)
    if !nativeMatch.found() {
      return null
    }

    groups: string[] := []
    captures: Capture[] := []
    for offset of 0..<nativeMatch.captureCount() {
      groupIndex := offset + 1
      if !nativeMatch.captureFound(groupIndex) {
        groups.push("")
        captures.push(null)
        continue
      }

      groupText := nativeMatch.captureText(groupIndex)
      groups.push(groupText)
      captures.push(CaptureGroup {
        index: groupIndex,
        text: groupText,
        start: nativeMatch.captureStart(groupIndex),
        end: nativeMatch.captureEnd(groupIndex),
      })
    }

    return Match {
      text: nativeMatch.text(),
      start: nativeMatch.start(),
      end: nativeMatch.end(),
      groups,
      captures,
    }
  }

  replaceAll(text: string, replacement: string): string {
    return this.native.replaceAll(text, replacement)
  }

  replaceFirst(text: string, replacement: string): string {
    return this.native.replaceFirst(text, replacement)
  }
}

function compileError(pattern: string, ignoreCase: bool, message: string): RegexError {
  return RegexError {
    stage: "compile",
    pattern,
    ignoreCase,
    message,
  }
}

export function compile(pattern: string, ignoreCase: bool = false): Result<Regex, RegexError> {
  return case NativeRegex.compile(pattern, ignoreCase) {
    s: Success => Success {
      value: Regex {
        native: s.value,
        pattern,
        ignoreCase,
      }
    },
    f: Failure => Failure {
      error: compileError(pattern, ignoreCase, f.error)
    }
  }
}

export function matches(text: string, pattern: string, ignoreCase: bool = false): Result<bool, RegexError> {
  try regex := compile(pattern, ignoreCase)
  return Success {
    value: regex.matches(text)
  }
}

export function search(text: string, pattern: string, ignoreCase: bool = false): Result<bool, RegexError> {
  try regex := compile(pattern, ignoreCase)
  return Success {
    value: regex.search(text)
  }
}

export function find(text: string, pattern: string, ignoreCase: bool = false): Result<Match | null, RegexError> {
  try regex := compile(pattern, ignoreCase)
  return Success {
    value: regex.find(text)
  }
}

export function replaceAll(text: string, pattern: string, replacement: string, ignoreCase: bool = false): Result<string, RegexError> {
  try regex := compile(pattern, ignoreCase)
  return Success {
    value: regex.replaceAll(text, replacement)
  }
}

export function replaceFirst(text: string, pattern: string, replacement: string, ignoreCase: bool = false): Result<string, RegexError> {
  try regex := compile(pattern, ignoreCase)
  return Success {
    value: regex.replaceFirst(text, replacement)
  }
}