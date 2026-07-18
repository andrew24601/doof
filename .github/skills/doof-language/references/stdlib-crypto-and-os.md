# std/crypto and std/os

## std/crypto

```doof
import { sha1, sha1String, sha1Hex, sha1HexString,
         sha256, sha256String, sha256Hex, sha256HexString,
         blobStreamToSha256,
         hmacSha256, hmacSha256String,
         encodeHex, decodeHex,
         encodeBase64, decodeBase64,
         encodeBase64Url, decodeBase64Url,
         randomBytes, uuidV4,
         parseJwt, Jwt, JwtError } from "std/crypto"
```

### Core API

- SHA-1 compatibility: `sha1`, `sha1String`, `sha1Hex`, `sha1HexString`
- SHA-256: `sha256`, `sha256String`, `sha256Hex`, `sha256HexString`, `blobStreamToSha256`
- HMAC-SHA256: `hmacSha256`, `hmacSha256String`
- Encoding: `encodeHex`, `decodeHex`, `encodeBase64`, `decodeBase64`, `encodeBase64Url`, `decodeBase64Url`
- Random and IDs: `randomBytes(length)`, `uuidV4()`
- JWT parsing: `parseJwt(token): Result<Jwt, JwtError>`

### JWT Notes

- `Jwt` includes `header`, `claims`, `signedContent`, and raw `signature` bytes
- `parseJwt` validates JWT structure and decodes header/payload/signature
- Use separate signature verification for trust decisions

## std/os

```doof
import { env, pid, platform, architecture, ExecOptions, Exec, ExecResult, run } from "std/os"
```

### Core API

- Environment and process metadata: `env`, `pid`, `platform`, `architecture`
- Process execution:
  - `Exec.spawn(command, args = [], options = ExecOptions {})`
  - `run(command, args = [], options = ExecOptions {})`

### ExecOptions

- `cwd: string | null`
- `env: Map<string, string>`
- `inheritEnv: bool = true`
- `withStdin: bool = true`
- `mergeStderrIntoStdout: bool = false`
- `inheritOutput: bool = false`
- `maxOutputBytes: long | null`

### Exec Methods

- Streams/chunks: `stdoutStream`, `stderrStream`, `nextStdoutChunk`, `nextStderrChunk`
- Input: `writeStdinText`, `closeStdin`
- Lifecycle: `isRunning`, `wait`, `terminate`
- Pipe state: `stdoutOpen`, `stderrOpen`

Use `mergeStderrIntoStdout: true` when a child process may write large stderr output and you only plan to drain stdout.
Use `inheritOutput: true` to leave child output attached to the invoking terminal.
Bounded capture continues draining and reports truncation on `ExecResult`.
