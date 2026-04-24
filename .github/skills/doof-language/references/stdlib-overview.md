# Doof Standard Library Overview

Doof's standard library packages use `std/<name>` import paths and are available without adding explicit package entries.

## Package Index

| Package | Import | Focus |
| --- | --- | --- |
| assert | `std/assert` | Test assertions |
| blob | `std/blob` | Binary buffers and typed read/write |
| crypto | `std/crypto` | Hashing, HMAC, encoding, randomness, JWT parsing |
| fs | `std/fs` | File and directory I/O |
| http | `std/http` | Synchronous HTTP client |
| json | `std/json` | Parse/format `JsonValue` |
| os | `std/os` | Environment, process info, process execution |
| path | `std/path` | POSIX-style path utilities |
| regex | `std/regex` | Compiled regular expressions |
| stream | `std/stream` | Stream combinators and adapters |
| time | `std/time` | Duration/date/time/time-zone types |

## Which Package to Use

- Assertions in tests: `std/assert`
- Reading and writing files: `std/fs`
- Calling HTTP APIs: `std/http`
- Parsing and emitting JSON text: `std/json`
- Building and reading binary frames: `std/blob`
- Hashes/HMAC/Base64/UUID/JWT parsing: `std/crypto`
- Running child processes or reading env vars: `std/os`
- Working with paths as strings: `std/path`
- Pattern matching in strings: `std/regex`
- Stream pipelines over large data: `std/stream`
- Clock, timestamps, calendars, zones: `std/time`
