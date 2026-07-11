import type * as nodeFsModule from "node:fs";
import { loadObserverAssets } from "./observer-assets.js";

interface SyncAssetRequest {
  open(method: string, url: string, asynchronous: boolean): void;
  send(): void;
  status: number;
  responseText: string;
}

interface BrowserAssetGlobals {
  XMLHttpRequest?: new () => SyncAssetRequest;
}

function getNodeFs(): typeof nodeFsModule | null {
  if (typeof process === "undefined" || !process.versions?.node) {
    return null;
  }

  const processWithBuiltins = process as typeof process & { getBuiltinModule?: (id: string) => unknown };
  return typeof processWithBuiltins.getBuiltinModule === "function"
    ? processWithBuiltins.getBuiltinModule("node:fs") as typeof nodeFsModule
    : null;
}

/** Load the checked-in C++ runtime template used by the emitter. */
export function loadRuntimeHeader(): string {
  return loadRuntimeAsset("doof_runtime.h");
}

export function loadObserverPlatformSupport(): string {
  return loadRuntimeAsset("doof_observer_platform.h");
}

export function buildObserverRuntimeSupport(): string {
  const assets = loadObserverAssets();
  const template = loadRuntimeAsset("doof_observer_runtime.h");
  return template
    .replace('R"DOOFOBS(__DOOF_OBSERVER_HTML__)DOOFOBS"', cxxRawLiteral(assets.html))
    .replace('R"DOOFOBS(__DOOF_OBSERVER_CSS__)DOOFOBS"', cxxRawLiteral(assets.css))
    .replace('R"DOOFOBS(__DOOF_OBSERVER_JS__)DOOFOBS"', cxxRawLiteral(assets.js));
}

function loadRuntimeAsset(name: string): string {
  const nodeFs = getNodeFs();
  if (nodeFs) {
    return nodeFs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  }

  // The browser compiler is synchronous, so load the Vite-emitted asset through
  // a synchronous request when no Node filesystem is available.
  const XMLHttpRequest = (globalThis as BrowserAssetGlobals).XMLHttpRequest;
  if (XMLHttpRequest) {
    const request = new XMLHttpRequest();
    request.open("GET", new URL(`../${name}`, import.meta.url).toString(), false);
    request.send();
    if (request.status >= 200 && request.status < 300) {
      return request.responseText;
    }
  }

  throw new Error("The Doof runtime header is not available in this runtime");
}

function cxxRawLiteral(value: string): string {
  const delimiter = "DOOFOBS";
  if (value.includes(`)${delimiter}"`)) {
    throw new Error("Observer UI asset contains the reserved C++ raw-string delimiter");
  }
  return `R"${delimiter}(${value})${delimiter}"`;
}
