import * as vscode from 'vscode';

export async function withErrorNotification<T>(action: () => Promise<T>, message: string): Promise<T | undefined> {
    try {
        return await action();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`${message}: ${detail}`);
        return undefined;
    }
}
