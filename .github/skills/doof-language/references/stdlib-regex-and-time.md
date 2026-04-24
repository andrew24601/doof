# std/regex and std/time

## std/regex

```doof
import { Regex, Match, RegexFlag, RegexError } from "std/regex"
```

- Compile: `Regex.compile(pattern, flags = [])`
- Query: `test`, `find`, `findAll`
- Replace: `replaceFirst`, `replaceAll`
- `Match` provides:
  - `value`
  - `range`
  - `captures`
  - `captureRanges`
  - `capture(name)`
  - `captureRange(name)`

Flags: `.IgnoreCase`, `.Multiline`, `.DotAll`, `.Extended`.

## std/time

```doof
import { Duration, Instant, Date, Time, DateTime, TimeZone, ZonedDateTime,
         DayOfWeek, Month } from "std/time"
```

- `Duration`: nanosecond precision elapsed time with arithmetic/comparison
- `Instant`: UTC timeline point with epoch conversion and arithmetic
- `Date`: calendar date operations
- `Time`: time-of-day operations
- `DateTime`: combined date/time (no zone)
- `TimeZone`: IANA zone lookup and UTC offset queries
- `ZonedDateTime`: date/time pinned to a time zone
- Enums: `DayOfWeek`, `Month`

Quick example:

```doof
start := Instant.now()
// work
elapsed := start.durationUntil(Instant.now())
println("Elapsed ms: ${string(elapsed.toMillis())}")
```
