import type * as nodeFsModule from "node:fs";

export interface ObserverAssets {
  html: string;
  css: string;
  js: string;
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

function readObserverAsset(name: string): string {
  const nodeFs = getNodeFs();
  if (!nodeFs) {
    throw new Error("Observer UI assets are not available in this runtime");
  }

  return nodeFs.readFileSync(new URL(`../observer-ui/${name}`, import.meta.url), "utf8");
}

export function loadObserverAssets(): ObserverAssets {
  return {
    html: readObserverAsset("index.html"),
    css: readObserverAsset("app.css"),
    js: readObserverAsset("app.js"),
  };
}
