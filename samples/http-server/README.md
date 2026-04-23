# Simple HTTP Server Sample

This sample keeps the application logic in Doof and uses a small header-only C++ bridge built on vendored cpp-httplib for socket I/O and HTTP parsing.

Files:

- `main.do` runs the request loop.
- `app.do` handles routing and builds responses.
- `http.do` defines shared HTTP types, parses raw requests in Doof, and maps Doof responses onto the native response builder.
- `native_http_server.hpp` is the bridge that adapts `httplib::Server` requests into `NativeRequest` values consumed by Doof code.
- `vendor/httplib.h` is a vendored copy of cpp-httplib (single-header distribution).

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

The `/headers` route demonstrates that the request line and headers are still parsed on the Doof side, so the application code can inspect them directly.

Response formatting is owned by cpp-httplib through the native bridge. Doof code sets status and response headers on the imported `NativeRequest`, then sends only the response body content.

The sample intentionally keeps the Doof-side routing and response construction small. It currently targets POSIX platforms such as macOS and Linux.