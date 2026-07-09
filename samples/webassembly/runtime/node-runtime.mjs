import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createDoofWasmRuntime } from "./doof-wasm-runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = process.argv[2] ?? join(here, "../dist/webassembly-sample.wasm");
const wasmBytes = await readFile(wasmPath);
const runtime = await createDoofWasmRuntime(wasmBytes);

const examples = [
  ["add", runtime.add({ a: 20, b: 22 })],
  ["greet default", runtime.greet({})],
  ["greet named", runtime.greet({ name: "Node.js" })],
  ["quote success", runtime.quote({ unitPrice: 19.99, quantity: 3 })],
  ["quote failure", runtime.quote({ unitPrice: 19.99, quantity: -1 })],
  ["summarize", runtime.summarize({ values: [2, 4, 6] })],
];

for (const [label, result] of examples) {
  console.log(`${label}: ${JSON.stringify(result)}`);
}
