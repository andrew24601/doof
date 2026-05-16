# Simple HTTP Server Sample

This sample keeps the application logic in Doof and uses the standard `std/http-server` package for HTTP parsing, routing, and response delivery.

Files:

- `main.do` starts `std/http-server`, wires requests into an async event channel, and runs the main event loop.
- `app.do` handles routing and builds typed `Response` values.

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

The `/headers` route demonstrates request metadata and header access from Doof code. The sample intentionally keeps the Doof-side routing and response construction small while relying on `std/http-server` for native socket integration.