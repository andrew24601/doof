import { promises as fs } from 'fs';
import path from 'path';

export interface DependencyError {
  filename?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface DependencyResolutionOptions {
  sourceRoots?: string[];
  fileContents?: Map<string, string>;
}

export interface DependencyGraphResult {
  entry: string;
  files: string[];
  errors: DependencyError[];
}

const IMPORT_PATTERN = /^(?:\s*|\t*)import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm;

export async function resolveDependencyGraph(
  entryFile: string,
  options: DependencyResolutionOptions = {}
): Promise<DependencyGraphResult> {
  const entryPath = path.resolve(entryFile);
  const visited = new Set<string>();
  const queue: string[] = [entryPath];
  const files: string[] = [];
  const errors: DependencyError[] = [];
  const sourceRoots = (options.sourceRoots && options.sourceRoots.length > 0)
    ? options.sourceRoots.map(root => path.resolve(root))
    : [path.dirname(entryPath)];
  const overrideContents = options.fileContents;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    files.push(current);

    let contents: string;
    const override = overrideContents?.get(current);
    if (override !== undefined) {
      contents = override;
    } else {
      try {
        contents = await fs.readFile(current, 'utf8');
      } catch (error) {
        errors.push({
          filename: current,
          message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
        });
        continue;
      }
    }

    const importMatches = [...contents.matchAll(IMPORT_PATTERN)];

    for (const match of importMatches) {
      const rawImportPath = match[1];
  const resolved = await resolveImportPath(rawImportPath, current, sourceRoots, overrideContents);

      if (!resolved) {
        errors.push({
          filename: current,
          line: estimateLineNumber(contents, match.index ?? 0),
          message: `Unable to resolve import '${rawImportPath}'`
        });
        continue;
      }

      if (!visited.has(resolved) && !queue.includes(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { entry: entryPath, files, errors };
}

async function resolveImportPath(
  importPath: string,
  fromFile: string,
  sourceRoots: string[],
  overrideContents?: Map<string, string>
): Promise<string | null> {
  const withExtension = (candidate: string): string => {
    if (candidate.endsWith('.do')) {
      return candidate;
    }
    return `${candidate}.do`;
  };

  const candidates: string[] = [];

  if (importPath.startsWith('.')) {
    const relative = path.resolve(path.dirname(fromFile), importPath);
    candidates.push(withExtension(relative));
  } else {
    for (const root of sourceRoots) {
      candidates.push(withExtension(path.resolve(root, importPath)));
    }
  }

  for (const candidate of candidates) {
    try {
      if (overrideContents?.has(candidate)) {
        return candidate;
      }
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep trying
    }
  }

  return null;
}

function estimateLineNumber(source: string, index: number): number {
  const prefix = source.slice(0, index);
  return prefix.split(/\r?\n/).length;
}
