# Doof Standard Library

The standard library ships as a set of first-party packages, each available under the `std/<name>` import path.  They are automatically available in any project — no `doof.json` dependency entry is needed.

---

## Overview

| Package | Import path | Purpose |
|---------|-------------|---------|
| assert  | `std/assert` | Rich assertion helpers for tests |
| blob    | `std/blob`   | Read/write binary buffers |
| crypto  | `std/crypto` | Hashing, HMAC, encoding, randomness, and JWT parsing |
| fs      | `std/fs`     | File system I/O (POSIX) |
| http    | `std/http`   | HTTP client (libcurl) |
| json    | `std/json`   | JSON parse and format |
| os      | `std/os`     | Process and environment utilities |
| path    | `std/path`   | POSIX path manipulation |
| regex   | `std/regex`  | Regular expression matching |
| stream  | `std/stream` | Stream combinators |
| time    | `std/time`   | Dates, times, durations, and time zones |

---

## `std/assert`

Assertion helpers intended for test files.  Each method delegates to the built-in `assert(condition, message)` primitive and panics on failure.

```doof
import { Assert } from "std/assert"
```

### API

```
Assert.equal<T>(actual: T, expected: T, message: string | null = null): void
Assert.notEqual<T>(actual: T, expected: T, message: string | null = null): void
Assert.isTrue(value: bool, message: string | null = null): void
Assert.isFalse(value: bool, message: string | null = null): void
Assert.fail(message: string | null = null): void
```

All methods accept an optional trailing message that is prepended to the default failure text.

### Example

```doof
import { Assert } from "std/assert"
import { add } from "./math"

export function testAdd(): void {
    Assert.equal(add(2, 3), 5)
    Assert.equal(add(-1, 1), 0, "zero sum")
}
```

---

## `std/blob`

Low-level binary buffer read/write with configurable byte order.

```doof
import { BlobBuilder, BlobReader, Endian } from "std/blob"
```

### `Endian`

```doof
enum Endian { BigEndian = 0, LittleEndian = 1 }
```

Default endianness for both `BlobBuilder` and `BlobReader` is `LittleEndian`.

### `BlobBuilder`

Sequentially writes typed values into a growable binary buffer.

```
// Construction
BlobBuilder()                                          // alias for create()
BlobBuilder.create(size: long = 0L, endianness: Endian = .LittleEndian): BlobBuilder

// Position
getPosition(): long
setPosition(position: long): void
length(): long

// Writing
writeByte(value: byte): void
writeBool(value: bool): void
writeInt(value: int): void
writeLong(value: long): void
writeFloat(value: float): void
writeDouble(value: double): void
writeBytes(value: readonly byte[]): void
writeString(value: string): void    // raw UTF-8 bytes, no length prefix

// Produce result
build(): readonly byte[]
```

### `BlobReader`

Sequentially reads typed values from an immutable byte array.

```
// Construction
BlobReader(data: readonly byte[])                      // alias for create()
BlobReader.create(data: readonly byte[], endianness: Endian = .LittleEndian): BlobReader

// Position and size
getPosition(): long
setPosition(position: long): void
length(): long
remaining(): long

// Reading
readByte(): byte
readBool(): bool
readInt(): int
readLong(): long
readFloat(): float
readDouble(): double
readBytes(length: long): readonly byte[]
readString(length: long): string

// Search
findNextAny(candidates: readonly byte[]): long | null
```

### Example

```doof
// Encode a framed message
function encodeMessage(id: int, body: string): readonly byte[] {
    b := BlobBuilder()
    b.writeInt(id)
    b.writeInt(body.length)
    b.writeString(body)
    return b.build()
}

// Decode it
function decodeMessage(data: readonly byte[]): (int, string) {
    r := BlobReader(data)
    id := r.readInt()
    bodyLen := long(r.readInt())
    body := r.readString(bodyLen)
    return (id, body)
}
```

---

## `std/crypto`

Cryptographic helpers for hashing, HMAC, binary/text encoding, randomness, and JWT parsing.

```doof
import { sha256, sha256String, sha256Hex, sha256HexString,
         blobStreamToSha256,
         hmacSha256, hmacSha256String,
         encodeHex, decodeHex,
         encodeBase64, decodeBase64,
         encodeBase64Url, decodeBase64Url,
         randomBytes, uuidV4,
         parseJwt, Jwt, JwtError } from "std/crypto"
```

### API

```
sha256(data: readonly byte[]): readonly byte[]
sha256String(text: string): readonly byte[]
sha256Hex(data: readonly byte[]): string
sha256HexString(text: string): string
blobStreamToSha256(source: Stream<readonly byte[]>): readonly byte[]

hmacSha256(key: readonly byte[], data: readonly byte[]): readonly byte[]
hmacSha256String(key: string, text: string): readonly byte[]

encodeHex(data: readonly byte[]): string
decodeHex(text: string): Result<readonly byte[], string>
encodeBase64(data: readonly byte[]): string
decodeBase64(text: string): Result<readonly byte[], string>
encodeBase64Url(data: readonly byte[]): string
decodeBase64Url(text: string): Result<readonly byte[], string>

randomBytes(length: int): readonly byte[]
uuidV4(): string

parseJwt(token: string): Result<Jwt, JwtError>

class Jwt {
    readonly header: readonly Map<string, JsonValue>
    readonly claims: readonly Map<string, JsonValue>
    readonly signedContent: string
    readonly signature: byte[]
}

enum JwtError {
    MalformedToken, InvalidHeader, InvalidPayload,
    AlgorithmMismatch, SignatureInvalid
}
```

### Example

```doof
import { parseJwt, sha256HexString } from "std/crypto"

digest := sha256HexString("hello")

function readClaims(token: string): Result<readonly Map<string, JsonValue>, JwtError> {
    try parsed := parseJwt(token)
    return Success { value: parsed.claims }
}
```

`parseJwt` validates token structure and decodes JWT segments, but does not verify trust by itself. Use signature verification for security decisions.

---

## `std/fs`

File system access for POSIX-compatible platforms.  All operations that can fail return `Result<T, IoError>`.

```doof
import { readText, writeText, readBlob, writeBlob, appendText, appendBlob,
         readLineStream, readBlockStream, writeBlobStream, writeLineStream,
         exists, isFile, isDirectory, readDir, mkdir, remove, rename, copy,
         EntryKind, DirEntry, IoError } from "std/fs"
```

### Types

```doof
enum EntryKind { File = 0, Directory = 1, Symlink = 2, Other = 3 }

class DirEntry {
    name: string        // filename (not full path)
    kind: EntryKind
    size: long          // bytes; 0 for directories
    modifiedAt: long    // Unix epoch seconds
}

enum IoError {
    NotFound = 0, PermissionDenied = 1, AlreadyExists = 2,
    IsDirectory = 3, NotDirectory = 4, InvalidPath = 5,
    Interrupted = 6, Other = 7
}
```

### Whole-file operations

```
readText(path: string): Result<string, IoError>
writeText(path: string, content: string): Result<void, IoError>
readBlob(path: string): Result<readonly byte[], IoError>
writeBlob(path: string, data: readonly byte[]): Result<void, IoError>
appendText(path: string, content: string): Result<void, IoError>
appendBlob(path: string, data: readonly byte[]): Result<void, IoError>
```

### Streaming I/O

```
readBlockStream(path: string, blockSize: int = 65536): Result<Stream<readonly byte[]>, IoError>
readBlobStream(path: string, blockSize: int = 65536): Result<Stream<readonly byte[]>, IoError>
readLineStream(path: string, blockSize: int = 65536): Result<Stream<string>, IoError>
writeBlobStream(path: string, chunks: Stream<readonly byte[]>): Result<void, IoError>
writeLineStream(path: string, lines: Stream<string>): Result<void, IoError>
```

`readLineStream` splits on `\n`, `\r`, and `\r\n`, stripping the delimiter.  The final line is yielded even without a trailing newline.

### Metadata and directory operations

```
exists(path: string): bool
isFile(path: string): bool
isDirectory(path: string): bool
readDir(path: string): Result<DirEntry[], IoError>
mkdir(path: string): Result<void, IoError>
remove(path: string): Result<void, IoError>
rename(sourcePath: string, destPath: string): Result<void, IoError>
copy(sourcePath: string, destPath: string): Result<void, IoError>
```

### Example

```doof
import { readLineStream, writeText, IoError } from "std/fs"

function countLines(path: string): Result<int, IoError> {
    try lines := readLineStream(path)
    let count = 0
    for _ of lines { count += 1 }
    return Success { value: count }
}
```

---

## `std/http`

Synchronous HTTP client backed by libcurl.

```doof
import { createClient, get, postJsonValue, send,
         HttpClient, HttpRequest, HttpResponse, HttpHeader, HttpError } from "std/http"
```

### Types

```doof
class HttpHeader   { readonly name: string; readonly value: string }
class HttpError    { readonly kind: string; readonly code: string; readonly message: string }

class HttpRequest {
    readonly method: string
    readonly url: string
    readonly headers: HttpHeader[] = []
    readonly body: readonly byte[] | null = null
    readonly timeoutMs: int = 30000
    readonly followRedirects: bool = true
    header(name: string): string | null
}

class HttpResponse {
    readonly status: int
    readonly statusText: string
    readonly headers: HttpHeader[]
    readonly body: readonly byte[]
    ok(): bool                              // status 200–299
    header(name: string): string | null     // case-insensitive lookup
    getText(): string
    getBlob(): readonly byte[]
    getLineStream(): Stream<string>
    getJsonValue(): Result<JsonValue, string>
}

class HttpClient { readonly native: NativeHttpClient }
```

### Functions

```
createClient(): HttpClient
get(client: HttpClient, url: string): Result<HttpResponse, HttpError>
postJsonValue(client: HttpClient, url: string, body: JsonValue): Result<HttpResponse, HttpError>
send(client: HttpClient, request: HttpRequest): Result<HttpResponse, HttpError>
```

`postJsonValue` automatically sets `Content-Type: application/json` and serializes the body.

### Example

```doof
import { createClient, get, send, HttpRequest, HttpHeader } from "std/http"

function fetchJson(url: string): Result<JsonValue, string> {
    client := createClient()
    try resp := get(client, url)
    if !resp.ok() {
        return Failure { error: "HTTP ${string(resp.status)}" }
    }
    return resp.getJsonValue()
}

function patchResource(url: string, data: readonly byte[]): Result<void, string> {
    client := createClient()
    req := HttpRequest {
        method: "PATCH",
        url,
        headers: readonly [HttpHeader { name: "Content-Type", value: "application/octet-stream" }],
        body: data,
    }
    try resp := send(client, req)
    if !resp.ok() {
        return Failure { error: "HTTP ${string(resp.status)}" }
    }
    return Success()
}
```

---

## `std/json`

Parse and format `JsonValue` (the built-in JSON carrier type).

```doof
import { parseJsonValue, formatJsonValue } from "std/json"
```

### Functions

```
parseJsonValue(text: string): Result<JsonValue, string>
formatJsonValue(value: JsonValue): string
```

`formatJsonValue` produces compact JSON with insertion-order key preservation.

### Example

```doof
import { parseJsonValue, formatJsonValue } from "std/json"

function prettyRoundTrip(input: string): Result<string, string> {
    try value := parseJsonValue(input)
    return Success { value: formatJsonValue(value) }
}
```

See [spec/12-json-serialization.md](12-json-serialization.md) for class-level auto-serialization via `.toJsonValue()` and `.fromJsonValue()`.

---

## `std/os`

Environment and process utilities, including process spawning with streaming stdout/stderr.

```doof
import { env, pid, platform, architecture, ExecOptions, Exec, ExecResult, run } from "std/os"
```

### API

```
env(name: string): Result<string, string>
pid(): int
platform(): string
architecture(): string

class ExecOptions {
    readonly cwd: string | null = null
    readonly env: Map<string, string> = {}
    readonly inheritEnv: bool = true
    readonly withStdin: bool = true
    readonly mergeStderrIntoStdout: bool = false
}

class Exec {
    static spawn(command: string, args: string[] = [], options: ExecOptions = ExecOptions {}): Result<Exec, string>
    stdoutStream(): Stream<readonly byte[]>
    stderrStream(): Stream<readonly byte[]>
    nextStdoutChunk(): readonly byte[] | null
    nextStderrChunk(): readonly byte[] | null
    writeStdinText(value: string): Result<void, string>
    closeStdin(): Result<void, string>
    isRunning(): bool
    wait(): Result<int, string>
    terminate(signal: int = 15): Result<void, string>
    stdoutOpen(): bool
    stderrOpen(): bool
}

class ExecResult {
    readonly exitCode: int
    readonly stdout: readonly byte[]
    readonly stderr: readonly byte[]
}

run(command: string, args: string[] = [], options: ExecOptions = ExecOptions {}): Result<ExecResult, string>
```

### Example

```doof
import { run } from "std/os"
import { BlobReader } from "std/blob"

function runEcho(message: string): Result<string, string> {
    try result := run("echo", [message])
    reader := BlobReader(result.stdout)
    return Success { value: reader.readString(reader.length()).trim() }
}
```

When reading only one output stream from a noisy process, set `mergeStderrIntoStdout` to avoid pipe backpressure deadlocks.

---

## `std/path`

POSIX path string manipulation.  No filesystem access; works on strings only.

```doof
import { homeDirectory, tempDirectory, currentWorkingDirectory, setCurrentWorkingDirectory,
         join, dirname, basename, stem, extension, isAbsolute } from "std/path"
```

### Functions

```
homeDirectory(): Result<string, string>
tempDirectory(): string
currentWorkingDirectory(): Result<string, string>
setCurrentWorkingDirectory(path: string): Result<void, string>

join(parts: string[]): string
dirname(path: string): string
basename(path: string): string
stem(path: string): string
extension(path: string): string
isAbsolute(path: string): bool
```

`homeDirectory`, `tempDirectory`, and `currentWorkingDirectory` return normalized POSIX-style paths.

**`join`** normalises `.`, resolves `..`, collapses repeated `/`, and preserves a leading `/` when any element is absolute. A later absolute segment resets accumulated state.

**`dirname`** returns the parent directory portion. Returns `"."` for a plain filename, `"/"` for the root.

**`basename`** returns the final path component (including extension).

**`stem`** returns the final path component without its last extension.

**`extension`** returns the last extension including the dot, e.g. `".txt"`, or `""` if none.

**`isAbsolute`** returns `true` when the path starts with `/`.

### Example

```doof
import { homeDirectory, join, basename, extension, stem } from "std/path"

root := try! homeDirectory()
configDir := join([root, ".config", "myapp"])
logFile   := join([configDir, "../logs", "app.log"])    // "/home/ada/.config/logs/app.log"
base      := basename(logFile)   // "app.log"
name      := stem(logFile)       // "app"
ext       := extension(logFile)  // ".log"
```

---

## `std/regex`

POSIX extended regular expressions via a native bridge.

```doof
import { Regex, Match, RegexFlag, RegexError } from "std/regex"
```

### Types

```doof
enum RegexFlag { IgnoreCase = 0, Multiline = 1, DotAll = 2, Extended = 3 }

class RegexError {
    stage: string                   // "compile"
    pattern: string
    flags: ReadonlySet<RegexFlag>
    message: string
}

class Match {
    value: string                   // full matched text
    range: Tuple<int, int>          // (start, end) byte offsets
    captures: string[]              // indexed capture groups (1-based, stored 0-based)
    captureRanges: Tuple<int, int>[]
    capture(name: string): string | null        // named capture group
    captureRange(name: string): Tuple<int, int> | null
}
```

### `Regex`

```
static compile(pattern: string, flags: ReadonlySet<RegexFlag> = []): Result<Regex, RegexError>

test(input: string): bool
find(input: string): Match | null
findAll(input: string): Match[]
replaceFirst(input: string, replacement: string): string
replaceAll(input: string, replacement: string): string
```

In replacement strings, `$n` refers to the n-th capture group.

### Example

```doof
import { Regex, RegexFlag } from "std/regex"

try emailRe := Regex.compile("([^@]+)@([^@]+\\.\\w+)")

// Test
emailRe.test("ada@example.com")          // true

// Extract
match := emailRe.find("Contact: ada@example.com") else { return }
user   := match.captures[0]              // "ada"
domain := match.captures[1]             // "example.com"

// Named groups
try namedRe := Regex.compile("(?P<user>[^@]+)@(?P<domain>[^@]+)")
m := namedRe.find("ada@example.com") else { return }
u := m.capture("user")                  // "ada" | null

// Case-insensitive replace
try ci := Regex.compile("hello", readonly [.IgnoreCase])
result := ci.replaceAll("Hello, HELLO!", "hi")   // "hi, hi!"
```

---

## `std/stream`

Combinators for the built-in `Stream<T>` pull-iteration protocol.

Any class with a `next(): T | null` method satisfies `Stream<T>`.  `std/stream` provides:

```doof
import { Chain, blobStreamToLineStream } from "std/stream"
```

### `Chain<T>`

A wrapper that adds a fluent combinator API to any `Stream<T>`.  `Chain<T>` itself implements `Stream<T>`.

```
Chain<T> { source: Stream<T> }      // construction

filter(pred: (it: T): bool): Chain<T>
map<U>(transform: (it: T): U): Chain<U>
take(count: int): Chain<T>
collect(): T[]
next(): T | null                    // Stream<T> interface
```

Combinators return a new `Chain` wrapping an inner stream; no evaluation occurs until iteration.

### `blobStreamToLineStream`

```
blobStreamToLineStream(source: Stream<readonly byte[]>): Stream<string>
```

Decodes a sequence of raw byte chunks as UTF-8 and splits on `\n`, `\r`, or `\r\n`, yielding one string per line without the delimiter.  The final line is emitted even without a trailing newline.

### Example

```doof
import { Chain } from "std/stream"
import { readBlockStream } from "std/fs"

function firstTenNonEmptyLines(path: string): Result<string[], IoError> {
    try blocks := readBlockStream(path)
    import { blobStreamToLineStream } from "std/stream"
    lines := blobStreamToLineStream(blocks)
    result := Chain<string> { source: lines }
        .filter(=> it.length > 0)
        .take(10)
        .collect()
    return Success { value: result }
}
```

---

## `std/time`

Comprehensive date, time, duration, and timezone support with nanosecond precision.

```doof
import { Duration, Instant, Date, Time, DateTime, TimeZone, ZonedDateTime,
         DayOfWeek, Month } from "std/time"
```

### `Duration`

A signed elapsed time with nanosecond precision.

```
// Static constructors
Duration.ofNanos(n: long): Duration
Duration.ofMicros(us: long): Duration
Duration.ofMillis(ms: long): Duration
Duration.ofSeconds(s: long): Duration
Duration.ofMinutes(m: long): Duration
Duration.ofHours(h: long): Duration
Duration.ofDays(d: long): Duration
Duration.ZERO: Duration

// Accessors
toNanos(): long
toMicros(): long
toMillis(): long
toSeconds(): long
toMinutes(): long
toHours(): long
toDays(): long
isNegative(): bool
isZero(): bool

// Arithmetic
abs(): Duration
negated(): Duration
plus(other: Duration): Duration
minus(other: Duration): Duration
multipliedBy(factor: long): Duration
dividedBy(divisor: long): Duration

// Comparison
compareTo(other: Duration): int
isLessThan(other: Duration): bool
isGreaterThan(other: Duration): bool
equals(other: Duration): bool

// Formatting
toISOString(): string          // e.g. "PT3H25M10.5S"
```

### `Instant`

A point in UTC time (nanoseconds since Unix epoch).

```
// Static constructors
Instant.now(): Instant
Instant.ofEpochNanos(nanos: long): Instant
Instant.ofEpochMillis(ms: long): Instant
Instant.ofEpochSeconds(s: long): Instant
Instant.parse(s: string): Result<Instant, string>   // RFC 3339 / ISO 8601 UTC
Instant.EPOCH: Instant

// Accessors
toEpochNanos(): long
toEpochMillis(): long
toEpochSeconds(): long

// Arithmetic
plus(d: Duration): Instant
minus(d: Duration): Instant
durationUntil(other: Instant): Duration
durationSince(other: Instant): Duration

// Comparison
compareTo(other: Instant): int
isBefore(other: Instant): bool
isAfter(other: Instant): bool
equals(other: Instant): bool

// Conversion
toDateTime(): DateTime              // UTC
toZonedDateTime(zone: TimeZone): ZonedDateTime

// Formatting
toISOString(): string               // e.g. "2024-06-01T12:00:00.123456789Z"
```

### `Date`

A calendar date with no time-of-day or timezone.

```
// Static constructors
Date.create(year: int, month: int, day: int): Result<Date, string>
Date.todayUTC(): Date
Date.today(zone: TimeZone): Date
Date.parse(s: string): Result<Date, string>     // ISO 8601, e.g. "2024-06-01"
Date.MIN: Date     // year 1
Date.MAX: Date     // year 9999

// Fields
readonly year: int
readonly month: int    // 1–12
readonly day: int      // 1–31

// Derived
dayOfWeek(): DayOfWeek
dayOfYear(): int
isLeapYear(): bool
daysInMonth(): int

// Arithmetic
plusDays(n: int): Date
minusDays(n: int): Date
plusMonths(n: int): Date
minusMonths(n: int): Date
plusYears(n: int): Date
minusYears(n: int): Date
daysUntil(other: Date): int

// Comparison
compareTo(other: Date): int
isBefore(other: Date): bool
isAfter(other: Date): bool
equals(other: Date): bool

// Formatting
toISOString(): string   // "YYYY-MM-DD"
```

### `Time`

A time-of-day with nanosecond precision; no date or timezone.

```
// Static constructors
Time.create(hour: int, minute: int, second: int = 0, nanosecond: int = 0): Result<Time, string>
Time.parse(s: string): Result<Time, string>     // "HH:MM", "HH:MM:SS", or "HH:MM:SS.nnnnnnnnn"
Time.MIDNIGHT: Time
Time.NOON: Time

// Fields
readonly hour: int         // 0–23
readonly minute: int       // 0–59
readonly second: int       // 0–59
readonly nanosecond: int   // 0–999_999_999

// Arithmetic (wraps around midnight)
plusHours(n: int): Time
plusMinutes(n: int): Time
plusSeconds(n: int): Time
plusNanos(n: long): Time

// Comparison
compareTo(other: Time): int
isBefore(other: Time): bool
isAfter(other: Time): bool
equals(other: Time): bool

// Formatting
toISOString(): string   // "HH:MM:SS" or "HH:MM:SS.nnnnnnnnn" (trailing zeros trimmed)
```

### `DateTime`

A combined date and time with no timezone.

```
// Static constructors
DateTime.create(date: Date, time: Time): DateTime
DateTime.fromParts(year: int, month: int, day: int, hour: int, minute: int,
                   second: int = 0, nanosecond: int = 0): Result<DateTime, string>
DateTime.nowUTC(): DateTime
DateTime.parse(s: string): Result<DateTime, string>  // ISO 8601, e.g. "2024-06-01T14:30:00"

// Fields
readonly date: Date
readonly time: Time

// Arithmetic
plusDays(n: int): DateTime
minusDays(n: int): DateTime
plusHours(n: int): DateTime
plusMinutes(n: int): DateTime
plusSeconds(n: int): DateTime
plus(d: Duration): DateTime
minus(d: Duration): DateTime

// Conversion
toInstantUTC(): Instant
toInstant(zone: TimeZone): Instant
atZone(zone: TimeZone): ZonedDateTime

// Comparison
compareTo(other: DateTime): int
isBefore(other: DateTime): bool
isAfter(other: DateTime): bool
equals(other: DateTime): bool

// Formatting
toISOString(): string   // "YYYY-MM-DDTHH:MM:SS[.nnn]"
```

### `TimeZone`

An IANA timezone identifier.

```
// Static constructors
TimeZone.lookup(id: string): Result<TimeZone, string>
TimeZone.local(): TimeZone
TimeZone.UTC: TimeZone

// Field
readonly id: string

// Queries
offsetSecondsAt(instant: Instant): int
isDSTAt(instant: Instant): bool
```

### `ZonedDateTime`

A `DateTime` pinned to a `TimeZone`.

```
// Static constructors
ZonedDateTime.now(zone: TimeZone): ZonedDateTime
ZonedDateTime.nowUTC(): ZonedDateTime

// Fields
readonly dateTime: DateTime
readonly zone: TimeZone

// Derived
date(): Date
time(): Time
offsetSeconds(): int

// Conversion
toInstant(): Instant
toUTC(): ZonedDateTime
withZoneSameInstant(newZone: TimeZone): ZonedDateTime
withZoneSameLocal(newZone: TimeZone): ZonedDateTime
toDateTime(): DateTime

// Comparison
compareTo(other: ZonedDateTime): int
isBefore(other: ZonedDateTime): bool
isAfter(other: ZonedDateTime): bool

// Formatting
toISOString(): string   // "YYYY-MM-DDTHH:MM:SS±HH:MM" or "...Z"
```

### Enums

```doof
enum DayOfWeek { Monday = 1, Tuesday = 2, Wednesday = 3, Thursday = 4,
                 Friday = 5, Saturday = 6, Sunday = 7 }

enum Month { January = 1, February = 2, March = 3, April = 4,
             May = 5, June = 6, July = 7, August = 8,
             September = 9, October = 10, November = 11, December = 12 }
```

---

## Cookbook

### Count lines in a file

```doof
import { readLineStream, IoError } from "std/fs"

function countLines(path: string): Result<int, IoError> {
    try lines := readLineStream(path)
    let n = 0
    for _ of lines { n += 1 }
    return Success { value: n }
}
```

### Fetch JSON from an API

```doof
import { createClient, get } from "std/http"

function fetchUser(id: int): Result<JsonValue, string> {
    client := createClient()
    try resp := get(client, "https://api.example.com/users/${string(id)}")
    if !resp.ok() {
        return Failure { error: "HTTP ${string(resp.status)}" }
    }
    return resp.getJsonValue()
}
```

### POST JSON and parse the response

```doof
import { createClient, postJsonValue } from "std/http"

class CreateUserRequest { name: string; email: string }
class CreateUserResponse { id: int; name: string }

function createUser(req: CreateUserRequest): Result<CreateUserResponse, string> {
    client := createClient()
    try resp := postJsonValue(client, "https://api.example.com/users", req.toJsonValue())
    if !resp.ok() {
        return Failure { error: "HTTP ${string(resp.status)}" }
    }
    try json := resp.getJsonValue()
    return CreateUserResponse.fromJsonValue(json)
}
```

### Compute elapsed time

```doof
import { Instant } from "std/time"

start := Instant.now()
doExpensiveWork()
elapsed := start.durationUntil(Instant.now())
println("Elapsed: ${string(elapsed.toMillis())}ms")
```

### Format a date in a custom pattern

```doof
import { Date, DayOfWeek } from "std/time"

function formatFriendly(d: Date): string {
    dayNames := ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    dow := d.dayOfWeek()
    name := dayNames[dow.value - 1]
    return "${name} ${string(d.day)}/${string(d.month)}/${string(d.year)}"
}
```

### Skip weekends when adding business days

```doof
import { Date, DayOfWeek } from "std/time"

function addBusinessDays(date: Date, n: int): Date {
    let remaining = n
    let current = date
    while remaining > 0 {
        current = current.plusDays(1)
        dow := current.dayOfWeek()
        if dow != .Saturday && dow != .Sunday {
            remaining -= 1
        }
    }
    return current
}
```

### Validate and extract an email with regex

```doof
import { Regex } from "std/regex"

try emailRe := Regex.compile("([^@]+)@([^@]+\\.\\w+)")

function extractEmail(input: string): (string, string) | null {
    match := emailRe.find(input) else { return null }
    return (match.captures[0], match.captures[1])
}
```

### Parse and manipulate paths

```doof
import { join, dirname, basename, extension } from "std/path"

function swapExtension(path: string, newExt: string): string {
    dir  := dirname(path)
    name := basename(path)
    ext  := extension(name)
    stem := name.substring(0, name.length - ext.length)
    return join([dir, stem + newExt])
}
```

### Build and parse a binary frame

```doof
import { BlobBuilder, BlobReader } from "std/blob"

function encode(msgType: byte, payload: readonly byte[]): readonly byte[] {
    b := BlobBuilder()
    b.writeByte(msgType)
    b.writeInt(payload.length)
    b.writeBytes(payload)
    return b.build()
}

function decode(data: readonly byte[]): (byte, readonly byte[]) {
    r := BlobReader(data)
    msgType := r.readByte()
    length  := long(r.readInt())
    payload := r.readBytes(length)
    return (msgType, payload)
}
```

### Filter and transform a large file with streams

```doof
import { readBlockStream, writeLineStream, IoError } from "std/fs"
import { blobStreamToLineStream } from "std/stream"
import { Chain } from "std/stream"

function extractNonEmpty(src: string, dst: string): Result<void, IoError> {
    try blocks := readBlockStream(src)
    lines  := blobStreamToLineStream(blocks)
    output := Chain<string> { source: lines }.filter(=> it.length > 0)
    return writeLineStream(dst, output)
}
```

### Write a test using std/assert

```doof
import { Assert } from "std/assert"
import { join, basename } from "std/path"

export function testJoin(): void {
    Assert.equal(join(["a", "b", "c"]), "a/b/c")
    Assert.equal(join(["/root", "..", "sibling"]), "/sibling")
}

export function testBasename(): void {
    Assert.equal(basename("/a/b/file.txt"), "file.txt")
    Assert.equal(basename("/"), "")
}
```
