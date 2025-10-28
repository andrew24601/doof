import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Transpiler } from '../../../src/transpiler';
import { DoofSemanticDiagnosticsProvider } from '../language/languageFeatures';
import { collectDoofFiles, uniquePaths } from './utils/discoverDoofFiles';
import { groupErrorsByFile, logErrors } from './utils/errorHandling';

type BuilderSettings = {
    root?: string;
    outDir: string;
    extraArgs: string[];
};

type WriteSingleFileOutputFn = (
    result: { header?: string; source?: string; },
    outputDir: string,
    basename: string,
    transpilerOptions: {
        target: 'cpp' | 'js' | 'vm';
        validate?: boolean;
        outputHeader: boolean;
        outputSource: boolean;
        sourceRoots?: string[];
    },
    copyRuntime?: boolean
) => Promise<void>;

interface RegisterTranspileFolderCommandsOptions {
    context: vscode.ExtensionContext;
    diagnosticsProvider: DoofSemanticDiagnosticsProvider;
    getCppBuilderSettings: (filePath?: string) => BuilderSettings;
    getJsBuilderSettings: (filePath?: string) => BuilderSettings;
    transpilerOutput: vscode.OutputChannel;
    writeSingleFileOutput: WriteSingleFileOutputFn;
}

type Target = 'cpp' | 'js';

export function registerTranspileFolderCommands(options: RegisterTranspileFolderCommandsOptions): vscode.Disposable[] {
    const command = vscode.commands.registerCommand('doof.transpileFolder', async (resource?: vscode.Uri) => {
        const folderUri = await resolveFolder(resource);
        if (!folderUri) {
            return;
        }

        const target = await pickTarget();
        if (!target) {
            return;
        }

        options.transpilerOutput.show(true);
        options.transpilerOutput.appendLine(`Starting folder transpile for ${folderUri.fsPath} -> ${target.toUpperCase()}`);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Transpiling Doof folder to ${target === 'cpp' ? 'C++' : 'JavaScript'}`,
                cancellable: true
            }, async (progress, token) => {
                const doofFiles = await collectDoofFiles(folderUri.fsPath, token);
                if (token.isCancellationRequested) {
                    return;
                }

                if (doofFiles.length === 0) {
                    vscode.window.showInformationMessage(`No Doof files (.do) found in ${folderUri.fsPath}`);
                    return;
                }

                doofFiles.sort();
                options.transpilerOutput.appendLine(`Found ${doofFiles.length} Doof source files to transpile.`);

                if (target === 'cpp') {
                    await transpileFolderToCpp(doofFiles, folderUri.fsPath, progress, token, options);
                } else {
                    await transpileFolderToJs(doofFiles, folderUri.fsPath, progress, token, options);
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            options.transpilerOutput.appendLine(`Folder transpilation failed: ${message}`);
            vscode.window.showErrorMessage(`Doof folder transpilation failed: ${message}`);
        }
    });

    return [command];
}

async function resolveFolder(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource && resource.scheme === 'file') {
        try {
            const stat = await fs.stat(resource.fsPath);
            if (stat.isDirectory()) {
                return resource;
            }
            if (stat.isFile()) {
                return vscode.Uri.file(path.dirname(resource.fsPath));
            }
        } catch (error) {
            console.error('Failed to stat resource', error);
        }
    }

    const selection = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Doof Folder'
    });

    if (!selection || selection.length === 0) {
        return undefined;
    }

    return selection[0];
}

async function pickTarget(): Promise<Target | undefined> {
    const pick = await vscode.window.showQuickPick([
        {
            label: 'C++ (headers and sources)',
            description: 'Generate .h/.cpp files using doof.cppBuilder settings',
            target: 'cpp' as Target
        },
        {
            label: 'JavaScript',
            description: 'Generate .js files using doof.jsBuilder settings',
            target: 'js' as Target
        }
    ], {
        placeHolder: 'Select target language for folder transpilation'
    });

    return pick?.target;
}

async function transpileFolderToCpp(
    files: string[],
    folderPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
    options: RegisterTranspileFolderCommandsOptions
): Promise<void> {
    const settings = options.getCppBuilderSettings();
    const sourceRoots = uniquePaths([settings.root, folderPath]);

    const transpilerOptions = {
        target: 'cpp' as const,
        validate: true,
        outputHeader: true,
        outputSource: true,
        sourceRoots
    };

    const transpiler = new Transpiler(transpilerOptions);

    progress.report({ message: 'Validating and generating C++ project...' });

    const result = await transpiler.transpileProject(files);

    const errorMap = groupErrorsByFile(result.errors);
    for (const file of files) {
        const errors = errorMap.get(file) ?? [];
        options.diagnosticsProvider.setDiagnosticsFromErrors(file, errors);
    }

    if (result.errors.length > 0) {
        logErrors(result.errors, options.transpilerOutput);
        vscode.window.showErrorMessage('Folder transpilation failed due to errors. See "Doof Transpiler" output for details.');
        return;
    }

    let runtimeCopied = false;
    for (const [filePath, output] of result.files.entries()) {
        if (token.isCancellationRequested) {
            return;
        }
        const relative = path.relative(folderPath, filePath) || path.basename(filePath);
        progress.report({ message: `Writing outputs for ${relative}` });
        const basename = path.basename(filePath, path.extname(filePath));
        await options.writeSingleFileOutput(output, settings.outDir, basename, transpilerOptions, !runtimeCopied);
        runtimeCopied = true;
    }

    options.transpilerOutput.appendLine(`Folder transpilation to C++ completed. Output in ${settings.outDir}`);
    vscode.window.showInformationMessage(`Doof folder transpiled to C++ successfully (${files.length} files). Output in ${settings.outDir}`);
}

async function transpileFolderToJs(
    files: string[],
    folderPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
    options: RegisterTranspileFolderCommandsOptions
): Promise<void> {
    const settings = options.getJsBuilderSettings();
    const sourceRoots = uniquePaths([settings.root, folderPath]);

    const transpilerOptions = {
        target: 'js' as const,
        validate: true,
        outputHeader: false,
        outputSource: true,
        sourceRoots
    };
    const transpiler = new Transpiler(transpilerOptions);

    progress.report({ message: 'Validating and generating JavaScript project...' });

    const result = await transpiler.transpileProject(files);

    const errorMap = groupErrorsByFile(result.errors);
    for (const file of files) {
        const errors = errorMap.get(file) ?? [];
        options.diagnosticsProvider.setDiagnosticsFromErrors(file, errors);
    }

    if (result.errors.length > 0) {
        logErrors(result.errors, options.transpilerOutput);
        vscode.window.showErrorMessage('Folder transpilation failed due to errors. See "Doof Transpiler" output for details.');
        return;
    }

    let successCount = 0;
    for (const [filePath, output] of result.files.entries()) {
        if (token.isCancellationRequested) {
            return;
        }
        const relative = path.relative(folderPath, filePath) || path.basename(filePath);
        progress.report({ message: `Writing outputs for ${relative}` });
        const basename = path.basename(filePath, path.extname(filePath));
        await options.writeSingleFileOutput(output, settings.outDir, basename, transpilerOptions, false);
        successCount++;
    }

    options.transpilerOutput.appendLine(`JavaScript transpilation completed for ${successCount}/${files.length} files. Output in ${settings.outDir}`);
    options.transpilerOutput.appendLine(`Folder transpilation to JavaScript completed. Output in ${settings.outDir}`);
    vscode.window.showInformationMessage(`Doof folder transpiled to JavaScript successfully (${successCount} files). Output in ${settings.outDir}`);
}
