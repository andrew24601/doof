# WebAssembly Sample

This package demonstrates `build.target = "wasm"`. Exported top-level functions in `main.do` become host-callable WebAssembly exports named `doof_export_<function>`.

The sample exports:

- `doof_export_add` for scalar parameters and return values
- `doof_export_greet` for a default parameter
- `doof_export_quote` for a `Result<Quote, string>` envelope
- `doof_export_summarize` for array input and class output

## Build

From the repository root:

```bash
npm run build
node dist/bin.js build samples/webassembly
```

This writes a pure wasm library under `samples/webassembly/build/debug/` and copies the final `.wasm` to `samples/webassembly/dist/`. The CLI does not generate JavaScript glue and does not run wasm targets; the host owns instantiation.

## JavaScript Runtimes

The ABI passes and returns UTF-8 JSON strings. Each returned pointer must be released with `doof_free`.

This sample includes minimal host runtimes:

- `runtime/doof-wasm-runtime.js` — shared JSON ABI helpers plus tiny `wasi_snapshot_preview1` imports
- `runtime/node-runtime.mjs` — Node.js demo that loads `dist/webassembly-sample.wasm`
- `runtime/web-runtime.html` — browser demo that fetches `dist/webassembly-sample.wasm`

Run the Node.js demo from the repository root:

```bash
node samples/webassembly/runtime/node-runtime.mjs
```

Optionally pass a different `.wasm` path:

```bash
node samples/webassembly/runtime/node-runtime.mjs samples/webassembly/build/debug/webassembly-sample.wasm
```

Run the browser demo through a local static server from the repository root:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/samples/webassembly/runtime/web-runtime.html
```

Both demos call `doof_export_add`, `doof_export_greet`, `doof_export_quote`, and `doof_export_summarize`.

The core call shape is:

```js
import { createDoofWasmRuntime } from "./runtime/doof-wasm-runtime.js";

const runtime = await createDoofWasmRuntime(wasmBytes);
console.log(runtime.add({ a: 20, b: 22 }));
console.log(runtime.quote({ unitPrice: 19.99, quantity: 3 }));
console.log(runtime.summarize({ values: [2, 4, 6] }));
```

Successful calls return an envelope such as:

```json
{ "ok": true, "value": 42 }
```

Doof `Result` failures and ABI validation errors return:

```json
{ "ok": false, "error": "quantity must be non-negative" }
```
