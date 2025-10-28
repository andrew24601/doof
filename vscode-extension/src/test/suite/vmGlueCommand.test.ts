import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { describe, it } from 'vitest';
import { collectDoofFiles, uniquePaths } from '../../commands/utils/discoverDoofFiles';

describe('VM Glue utilities', () => {
    it('uniquePaths removes duplicates and normalizes separators', () => {
        const input = [
            '/tmp/workspace/src',
            '/tmp/workspace/src/',
            undefined,
            '/tmp/workspace/../workspace/src'
        ];

    const result = uniquePaths(input);
    assert.ok(result.length >= 1);
    const matches = result.filter(entry => entry.endsWith(path.join('workspace', 'src')));
    assert.strictEqual(matches.length, 1);
    });

    it('collectDoofFiles finds .do files recursively and skips ignored folders', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doof-vm-glue-test-'));
        try {
            const nestedDir = path.join(tmpDir, 'nested');
            const skipDir = path.join(tmpDir, 'node_modules');
            await fs.mkdir(nestedDir, { recursive: true });
            await fs.mkdir(skipDir, { recursive: true });

            const fileA = path.join(tmpDir, 'a.do');
            const fileB = path.join(nestedDir, 'b.do');
            const ignoredFile = path.join(skipDir, 'ignored.do');
            const otherFile = path.join(tmpDir, 'not-doof.txt');

            await Promise.all([
                fs.writeFile(fileA, '// file A'),
                fs.writeFile(fileB, '// file B'),
                fs.writeFile(ignoredFile, '// should be ignored'),
                fs.writeFile(otherFile, '// not doof')
            ]);

            const results = await collectDoofFiles(tmpDir);
            assert.deepStrictEqual(results.sort(), [fileA, fileB].sort());
            assert.ok(!results.includes(ignoredFile));
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });
});
