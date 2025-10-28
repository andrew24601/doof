import * as path from 'path';
import { promises as fs, Dirent } from 'fs';
import * as vscode from 'vscode';

const SKIP_DIRECTORIES = new Set<string>([
    'node_modules',
    '.git',
    'build',
    'dist',
    'out',
    '.vscode'
]);

export async function collectDoofFiles(root: string, token?: vscode.CancellationToken): Promise<string[]> {
    const results: string[] = [];

    async function walk(current: string): Promise<void> {
        if (token?.isCancellationRequested) {
            return;
        }

        let entries: Dirent[];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch (error) {
            console.warn(`Failed to read directory ${current}:`, error);
            return;
        }

        for (const entry of entries) {
            if (token?.isCancellationRequested) {
                return;
            }

            if (entry.isSymbolicLink()) {
                continue;
            }

            const fullPath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                if (!SKIP_DIRECTORIES.has(entry.name)) {
                    await walk(fullPath);
                }
            } else if (entry.isFile() && entry.name.endsWith('.do')) {
                results.push(fullPath);
            }
        }
    }

    await walk(root);
    return results;
}

export function uniquePaths(paths: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const p of paths) {
        if (!p) {
            continue;
        }

        const normalized = path.normalize(p);
        const root = path.parse(normalized).root;
        const trimmed = normalized.endsWith(path.sep) && normalized !== root
            ? normalized.slice(0, -1)
            : normalized;

        if (!seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
        }
    }

    return result;
}
