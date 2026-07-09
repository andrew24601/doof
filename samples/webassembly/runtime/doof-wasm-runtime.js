const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeU32(memory, ptr, value) {
  new DataView(memory.buffer).setUint32(ptr, value, true);
}

function writeU64(memory, ptr, value) {
  new DataView(memory.buffer).setBigUint64(ptr, BigInt(value), true);
}

function readCString(memory, ptr) {
  const bytes = new Uint8Array(memory.buffer);
  let end = ptr;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return decoder.decode(bytes.subarray(ptr, end));
}

function writeCString(exports, text) {
  const bytes = encoder.encode(`${text}\0`);
  const ptr = exports.malloc(bytes.length);
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function createWasiImports(state) {
  const write = (fd, text) => {
    if (!text) return;
    if (fd === 2) {
      console.error(text.replace(/\n$/, ""));
    } else {
      console.log(text.replace(/\n$/, ""));
    }
  };

  return {
    fd_close() {
      return 0;
    },

    fd_seek(_fd, offset, _whence, newOffsetPtr) {
      writeU64(state.memory, newOffsetPtr, offset);
      return 0;
    },

    fd_write(fd, iovsPtr, iovsLen, bytesWrittenPtr) {
      const view = new DataView(state.memory.buffer);
      const bytes = new Uint8Array(state.memory.buffer);
      let written = 0;
      let text = "";

      for (let index = 0; index < iovsLen; index += 1) {
        const entryPtr = iovsPtr + index * 8;
        const dataPtr = view.getUint32(entryPtr, true);
        const length = view.getUint32(entryPtr + 4, true);
        written += length;
        text += decoder.decode(bytes.subarray(dataPtr, dataPtr + length));
      }

      write(fd, text);
      writeU32(state.memory, bytesWrittenPtr, written);
      return 0;
    },

    environ_sizes_get(countPtr, bufferSizePtr) {
      writeU32(state.memory, countPtr, 0);
      writeU32(state.memory, bufferSizePtr, 0);
      return 0;
    },

    environ_get() {
      return 0;
    },
  };
}

export async function createDoofWasmRuntime(wasmSource) {
  const state = { memory: null };
  const imports = {
    wasi_snapshot_preview1: createWasiImports(state),
  };

  const { instance } =
    wasmSource instanceof WebAssembly.Module
      ? await WebAssembly.instantiate(wasmSource, imports)
      : await WebAssembly.instantiate(wasmSource, imports);

  const exports = instance.exports;
  state.memory = exports.memory;
  exports._initialize?.();

  function callExport(exportName, params = {}) {
    const fn = exports[exportName];
    if (typeof fn !== "function") {
      throw new Error(`Missing wasm export: ${exportName}`);
    }

    const inputPtr = writeCString(exports, JSON.stringify(params));
    let outputPtr = 0;
    try {
      outputPtr = fn(inputPtr);
    } finally {
      exports.free(inputPtr);
    }

    try {
      return JSON.parse(readCString(exports.memory, outputPtr));
    } finally {
      if (outputPtr) exports.doof_free(outputPtr);
    }
  }

  return {
    exports,
    callExport,
    add: (params) => callExport("doof_export_add", params),
    greet: (params) => callExport("doof_export_greet", params),
    quote: (params) => callExport("doof_export_quote", params),
    summarize: (params) => callExport("doof_export_summarize", params),
  };
}
