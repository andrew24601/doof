import * as vscode from 'vscode';
import { TranspilerError } from '../../../../src/transpiler';

export function groupErrorsByFile(errors: TranspilerError[]): Map<string, Array<string | TranspilerError>> {
    const map = new Map<string, Array<string | TranspilerError>>();
    for (const err of errors) {
        const key = err.filename || 'unknown';
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key)!.push(err);
    }
    return map;
}

export function logErrors(errors: Array<string | TranspilerError>, output: vscode.OutputChannel, fallbackFile?: string): void {
    if (errors.length === 0) {
        return;
    }

    output.appendLine('Errors:');
    for (const err of errors) {
        if (typeof err === 'string') {
            output.appendLine(`  ${err}`);
            continue;
        }
        const file = err.filename || fallbackFile || 'unknown';
        const line = err.line !== undefined ? err.line : '?';
        const column = err.column !== undefined ? err.column : '?';
        const severity = err.severity ? `${err.severity.toUpperCase()}: ` : '';
        output.appendLine(`  ${file}:${line}:${column}: ${severity}${err.message}`);
    }
}
