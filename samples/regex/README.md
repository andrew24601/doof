# Regex Sample

This sample follows the same pattern as the sqlite bridge: the C++ header stays small, while the reusable `regex.do` module presents a cleaner Doof-facing API for the common flows.

Files:

- `main.do` demonstrates validation, case-insensitive search, date capture-group destructuring assignment, and replacement.
- `regex.do` defines the reusable `Regex`, `Match`, `CaptureGroup`, and `RegexError` types together with helpers such as `compile`, `matches`, `search`, `find`, `replaceAll`, and `replaceFirst`.
- `native_regex.hpp` is a compact header-only wrapper around `std::regex`.

## Build

From the repository root:

```bash
samples/regex/build.sh
```

Or build and run immediately:

```bash
samples/regex/build.sh --run
```

## Interface

The wrapper is intentionally split into two layers:

- `compile(pattern, ignoreCase?)` returns `Result<Regex, RegexError>` when you want to compile once and reuse the pattern.
- `Regex.matches(text)` checks a full-string match.
- `Regex.search(text)` checks whether the pattern appears anywhere inside the text.
- `Regex.find(text)` returns a `Match | null` with the matched text, offsets, and positional capture-group data.
- `Match.groups` exposes the capture groups as a positional `string[]`, which is handy for destructuring declarations or assignment such as `let year: string | null = null; [year, month, day] = match.groups`. Unmatched optional groups become empty strings in this view.
- `Match.group(index)` returns the captured text for a 1-based group index, or `null` when that group did not participate.
- `Match.capture(index)` returns a `CaptureGroup | null` when you also need offsets for a specific group.
- `Match.captures` preserves the positional capture list, including `null` entries for unmatched optional groups.
- `Regex.replaceAll(text, replacement)` and `Regex.replaceFirst(text, replacement)` cover the common replacement cases.
- The free helpers `matches`, `search`, `find`, `replaceAll`, and `replaceFirst` compile on demand for one-shot use.

This sample intentionally stays inside the capabilities of `std::regex`. That is enough for straightforward validation, scanning, and replacement use cases without adding another dependency.

If you later need stricter worst-case performance guarantees for untrusted input, or richer control over larger-scale regex workloads, that would be the point to revisit a library such as RE2.