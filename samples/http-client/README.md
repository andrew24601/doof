# Simple HTTP Client Sample

This sample keeps the request and response types in Doof and uses a small libcurl-backed C++ bridge for transport, TLS, redirects, and header/body capture.

Files:

- `main.do` performs a simple GET request and prints a short response summary.
- `http.do` defines the Doof-facing request, response, and error types together with convenience functions such as `get`, `post`, and `send`.
- `native_http_client.hpp` is a compact header-only libcurl bridge.

## Build

From the repository root:

```bash
samples/http-client/build.sh
```

Or build and run immediately:

```bash
samples/http-client/build.sh --run
```

The build script uses `curl-config` when available so it can pick up the right include paths and link flags for libcurl.

## Interface

The first cut keeps the Doof API intentionally small:

- `HttpRequest` carries the method, URL, headers, optional body, timeout, and redirect policy.
- `HttpResponse` carries the status, reason text, headers, and body, with helpers such as `ok()` and `headerOr()`.
- `HttpError` surfaces transport failures with a `kind`, libcurl `code`, and human-readable message.
- `createClient()`, `get(...)`, `post(...)`, and `send(...)` provide the main entry points.

HTTP `4xx` and `5xx` responses are still successful `HttpResponse` values. Only transport or configuration failures return `Failure<HttpError>`.

## Notes

- The sample is synchronous by design.
- HTTPS support comes from libcurl rather than a custom TLS stack.
- The default example fetches `https://example.com`, but the helper functions are intended to be reused for other URLs or local test endpoints.