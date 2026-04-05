/**
 * Shared test utilities used across all test suites.
 */

import type { FileSystem } from "./resolver.js";

/**
 * In-memory file system for tests. Maps absolute paths to file contents.
 */
export class VirtualFS implements FileSystem {
  private files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }

  readFile(absolutePath: string): string | null {
    return this.files.get(absolutePath) ?? null;
  }

  fileExists(absolutePath: string): boolean {
    return this.files.has(absolutePath);
  }
}
