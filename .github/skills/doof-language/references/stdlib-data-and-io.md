# stdlib Data and I/O Packages

## std/blob

```doof
import { BlobBuilder, BlobReader, Endian } from "std/blob"
```

- `Endian`: `.BigEndian`, `.LittleEndian`
- `BlobBuilder.create(size: long = 0L, endianness: Endian = .LittleEndian)`
- `BlobReader.create(data: readonly byte[], endianness: Endian = .LittleEndian)`
- Writer methods: `writeByte`, `writeBool`, `writeInt`, `writeLong`, `writeFloat`, `writeDouble`, `writeBytes`, `writeString`
- Reader methods: `readByte`, `readBool`, `readInt`, `readLong`, `readFloat`, `readDouble`, `readBytes`, `readString`

## std/fs

```doof
import { readText, writeText, readBlob, writeBlob, appendText, appendBlob,
         readLineStream, readBlockStream, readBlobStream, writeBlobStream, writeLineStream,
         exists, isFile, isDirectory, readDir, mkdir, remove, rename, copy,
         EntryKind, DirEntry, IoError } from "std/fs"
```

All fallible operations return `Result<T, IoError>`.

- File operations: `readText`, `writeText`, `readBlob`, `writeBlob`, `appendText`, `appendBlob`
- Stream operations: `readLineStream`, `readBlockStream`, `readBlobStream`, `writeBlobStream`, `writeLineStream`
- Path checks and directory ops: `exists`, `isFile`, `isDirectory`, `readDir`, `mkdir`, `remove`, `rename`, `copy`

## std/http

```doof
import { createClient, get, postJsonValue, send,
         HttpRequest, HttpResponse, HttpHeader, HttpError } from "std/http"
```

- `createClient()`
- `get(client, url)`
- `postJsonValue(client, url, body)` sets JSON content type
- `send(client, request)` for custom method/headers/body
- `HttpResponse`: `ok()`, `header(name)`, `getText()`, `getBlob()`, `getLineStream()`, `getJsonValue()`

## std/json

```doof
import { parseJsonValue, formatJsonValue } from "std/json"
```

- `parseJsonValue(text): Result<JsonValue, string>`
- `formatJsonValue(value): string`

## std/path

```doof
import { homeDirectory, tempDirectory, currentWorkingDirectory, setCurrentWorkingDirectory,
         join, dirname, basename, stem, extension, isAbsolute } from "std/path"
```

- Environment path helpers: `homeDirectory`, `tempDirectory`, `currentWorkingDirectory`, `setCurrentWorkingDirectory`
- Path-string helpers: `join`, `dirname`, `basename`, `stem`, `extension`, `isAbsolute`

## std/stream

```doof
import { Chain, blobStreamToLineStream } from "std/stream"
```

- `Chain<T>` wraps `Stream<T>` and provides `filter`, `map`, `take`, `collect`
- `blobStreamToLineStream` decodes chunk streams into `Stream<string>`
