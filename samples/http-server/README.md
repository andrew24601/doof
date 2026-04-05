# Simple HTTP Server Sample

This sample keeps the application logic in Doof and uses a small header-only C++ bridge for blocking socket I/O, HTTP message framing, and sequential HTTP/1.1 keep-alive handling.

Files:

- `main.do` runs the request loop.
- `app.do` handles routing and builds responses.
- `http.do` defines shared HTTP types, parses raw requests in Doof, and maps Doof responses onto the native response builder.
- `native_http_server.hpp` is the tiny POSIX socket bridge that reads requests, formats responses, and keeps a client socket open across sequential requests until the client closes it or the idle timeout expires.

## Build

From the repository root:

```bash
samples/http-server/build.sh
```

Or build and run immediately:

```bash
samples/http-server/build.sh --run
```

## Try it

With the server running:

```bash
curl http://127.0.0.1:8080/
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/about
curl http://127.0.0.1:8080/headers -H 'X-Debug: yes'
curl http://127.0.0.1:8080/missing
```

The `/headers` route demonstrates that the request line and headers are parsed on the Doof side, so the application code can inspect them directly.

Response formatting is now owned by the native bridge. Doof code sets status and response headers on the imported `NativeRequest`, then sends only the response body content.

The sample implements a deliberately small subset of HTTP/1.1 semantics:

- sequential keep-alive on a single connection
- a simple idle read timeout before the server closes an unused persistent connection
- request bodies framed by `Content-Length`

The sample intentionally does not support HTTP pipelining, chunked transfer encoding, or streaming request/response bodies.

The sample is intentionally small and currently targets POSIX platforms such as macOS and Linux.