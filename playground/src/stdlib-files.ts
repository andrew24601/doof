/**
 * Doof source files bundled into the browser compiler.
 *
 * The stdlib checkout is kept next to the compiler repository. Vite turns
 * these raw imports into a static map so browser compilation never needs a
 * filesystem or Node's process environment.
 */
const rawStdlibFiles = import.meta.glob("../../../doof-stdlib/*/*.do", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const STDLIB_SOURCE_PREFIX = "../../../doof-stdlib/";

export const PLAYGROUND_STDLIB_FILES = new Map(
  Object.entries(rawStdlibFiles).map(([path, source]) => [
    path.startsWith(STDLIB_SOURCE_PREFIX) ? path.slice(STDLIB_SOURCE_PREFIX.length) : path,
    source,
  ]),
);
