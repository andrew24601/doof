import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { toPortablePath } from "./path-utils.js";

export interface ResolvedDoofResource {
  fromPattern: string;
  destination: string;
}

export interface ExpandedResourceFile {
  sourcePath: string;
  relativePath: string;
}

export function expandResourcePattern(pattern: string): string[] {
  return expandResourceFiles(pattern).map((file) => file.sourcePath);
}

export function expandResourceFiles(pattern: string): ExpandedResourceFile[] {
  if (!hasWildcard(pattern)) {
    if (!nodeFs.existsSync(pattern)) {
      return [];
    }
    const stat = nodeFs.statSync(pattern);
    if (stat.isFile()) {
      return [{ sourcePath: pattern, relativePath: nodePath.basename(pattern) }];
    }
    if (!stat.isDirectory()) {
      return [];
    }

    const matches: ExpandedResourceFile[] = [];
    walkFiles(pattern, (filePath) => {
      matches.push({
        sourcePath: filePath,
        relativePath: toPortablePath(nodePath.relative(pattern, filePath)),
      });
    });
    return matches.sort(compareExpandedResourceFiles);
  }

  const baseDir = getGlobBaseDir(pattern);
  if (!nodeFs.existsSync(baseDir)) {
    return [];
  }

  const relativePattern = toPortablePath(nodePath.relative(baseDir, pattern));
  const matcher = globToRegExp(relativePattern);
  const matches: ExpandedResourceFile[] = [];
  walkFiles(baseDir, (filePath) => {
    const relativePath = toPortablePath(nodePath.relative(baseDir, filePath));
    if (matcher.test(relativePath)) {
      matches.push({ sourcePath: filePath, relativePath });
    }
  });

  return matches.sort(compareExpandedResourceFiles);
}

function compareExpandedResourceFiles(left: ExpandedResourceFile, right: ExpandedResourceFile): number {
  return left.relativePath.localeCompare(right.relativePath)
    || left.sourcePath.localeCompare(right.sourcePath);
}

function walkFiles(dirPath: string, visit: (filePath: string) => void): void {
  const entries = nodeFs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = nodePath.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit);
      continue;
    }
    if (entry.isFile()) {
      visit(entryPath);
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index];
    const next = pattern[index + 1];
    if (current === "*" && next === "*") {
      source += ".*";
      index++;
      continue;
    }
    if (current === "*") {
      source += "[^/]*";
      continue;
    }
    if ("\\.^$+?()[]{}|".includes(current)) {
      source += `\\${current}`;
      continue;
    }
    source += current;
  }
  source += "$";
  return new RegExp(source);
}

function getGlobBaseDir(pattern: string): string {
  const portablePattern = toPortablePath(pattern);
  const wildcardIndex = portablePattern.search(/\*/);
  if (wildcardIndex === -1) {
    return nodePath.dirname(pattern);
  }

  const prefix = portablePattern.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf("/");
  if (slashIndex <= 0) {
    return portablePattern.startsWith("/") ? "/" : nodePath.resolve(".");
  }

  return prefix.slice(0, slashIndex);
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}
