# Streams Sample

This sample demonstrates the current stream surface in Doof:

- explicit `implements Stream<T>` on classes
- direct `next()` calls returning `T | null`
- `for-of` iteration over `Stream<int>` and `Stream<string>`

Run it from the repository root with:

```bash
npm run build
node dist/bin.js run samples/streams
```

Expected output:

```text
first 2
second 3
count 2
count 3
count 4
total 9
word red
word green
word blue
```

The process exits with status `9`.

Current limitation: generic helpers such as `function collect<T>(stream: Stream<T>): T[]` are not yet supported end to end. Type checking succeeds, but the emitted C++ still treats `Stream<T>` as a concrete alias name rather than a templated stream surface.