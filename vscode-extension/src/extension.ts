import * as vscode from 'vscode';
import * as path from 'path';
import { DoofDebugAdapterDescriptorFactory } from './debugAdapter';
import { DoofTaskProvider, registerProblemMatchers } from './taskProvider';
import { DoofDebugConfigurationProvider } from './debugConfigurationProvider';
import { DoofLanguageService } from './language/languageService';
import {
    DoofCodeActionsProvider,
    DoofCompletionProvider,
    DoofDocumentFormattingEditProvider,
    DoofDocumentSymbolProvider,
    DoofHoverProvider,
    DoofSemanticDiagnosticsProvider,
    DoofSemanticTokensProvider
} from './language/languageFeatures';
import { LANGUAGE_ID } from './constants';

// Legacy in-file implementations replaced by modular language service and providers.

const COMMANDS = {
    validateWorkspace: 'doof.validateWorkspace',
    debug: 'doof.debug',
    createLaunchConfig: 'doof.createLaunchConfig',
    buildVM: 'doof.buildVM',
} as const;

// Helpers
function getWorkspaceFolderForUri(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
    if (uri) {
        return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
    }
    return vscode.workspace.workspaceFolders?.[0];
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Doof Language Support extension is now active!');

    // Initialize the language service
    const languageService = new DoofLanguageService();

    // Register enhanced language features with AST integration
    const completionProvider = new DoofCompletionProvider(languageService);
    const hoverProvider = new DoofHoverProvider(languageService);
    const diagnosticsProvider = new DoofSemanticDiagnosticsProvider(languageService);
    const symbolProvider = new DoofDocumentSymbolProvider(languageService);
    const semanticTokensProvider = new DoofSemanticTokensProvider(languageService);
    const codeActionsProvider = new DoofCodeActionsProvider(languageService);

    // Register providers
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(LANGUAGE_ID, completionProvider, '.', ':', '('),
        vscode.languages.registerHoverProvider(LANGUAGE_ID, hoverProvider),
        vscode.languages.registerDocumentSymbolProvider(LANGUAGE_ID, symbolProvider),
        vscode.languages.registerDocumentSemanticTokensProvider(
            LANGUAGE_ID,
            semanticTokensProvider, 
            DoofSemanticTokensProvider.legend
        ),
        vscode.languages.registerCodeActionsProvider(LANGUAGE_ID, codeActionsProvider),
        vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, new DoofDocumentFormattingEditProvider()),
        diagnosticsProvider
    );

    // Immediately validate any already-open Doof documents so diagnostics appear
    (async () => {
        const openDocs = vscode.workspace.textDocuments.filter(d => d.languageId === LANGUAGE_ID);
        for (const doc of openDocs) {
            try {
                await diagnosticsProvider.updateDiagnostics(doc);
            } catch (e) {
                console.error('Error updating diagnostics for open document:', e);
            }
        }
    })();

    // Register global validation command
    const validateWorkspaceCommand = vscode.commands.registerCommand(COMMANDS.validateWorkspace, async () => {
        vscode.window.showInformationMessage('Running global validation...');
        try {
            await languageService.validateWorkspace();
            // Refresh diagnostics for open Doof documents after global validation
            const openDocs = vscode.workspace.textDocuments.filter(d => d.languageId === LANGUAGE_ID);
            for (const doc of openDocs) {
                await diagnosticsProvider.updateDiagnostics(doc);
            }
            vscode.window.showInformationMessage('Global validation completed!');
        } catch (error) {
            vscode.window.showErrorMessage(`Global validation failed: ${error instanceof Error ? error.message : error}`);
        }
    });

    // Register debug adapter and configuration provider
    const debugAdapterFactory = new DoofDebugAdapterDescriptorFactory(context.extensionPath);
    const debugConfigProvider = new DoofDebugConfigurationProvider(context.extensionPath);
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('doof', debugAdapterFactory),
        vscode.debug.registerDebugConfigurationProvider('doof', debugConfigProvider)
    );

    // Register task provider
    const taskProvider = new DoofTaskProvider(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(DoofTaskProvider.DoofType, taskProvider)
    );

    // Register problem matchers
    registerProblemMatchers();

    // Register debug command
    const debugCommand = vscode.commands.registerCommand(COMMANDS.debug, async (uri: vscode.Uri) => {
        if (!uri && vscode.window.activeTextEditor) {
            uri = vscode.window.activeTextEditor.document.uri;
        }
        
        if (uri && uri.fsPath.endsWith('.do')) {
            const folder = getWorkspaceFolderForUri(uri);
            if (!folder) {
                vscode.window.showErrorMessage('Please open a workspace folder to debug Doof files.');
                return;
            }
            // Start debugging session
            // Compute program relative to the selected folder for stable multi-root behavior
            const relativeProgram = path.relative(folder.uri.fsPath, uri.fsPath);

            const config: vscode.DebugConfiguration = {
                type: LANGUAGE_ID,
                request: 'launch',
                name: 'Debug Doof File',
                program: relativeProgram,
                cwd: folder.uri.fsPath,
                stopOnEntry: true
            };
            
            await vscode.debug.startDebugging(undefined, config);
        } else {
            vscode.window.showErrorMessage('Please select a .do file to debug');
        }
    });

    // Register create launch config command
    const createLaunchConfigCommand = vscode.commands.registerCommand(COMMANDS.createLaunchConfig, async () => {
        const workspaceFolder = getWorkspaceFolderForUri(vscode.window.activeTextEditor?.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const vscodeDirUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
        const launchJsonUri = vscode.Uri.joinPath(vscodeDirUri, 'launch.json');

        const launchConfig = {
            version: "0.2.0",
            configurations: [
                {
                    name: "Debug Current Doof File",
                    type: LANGUAGE_ID,
                    request: "launch",
                    program: "${file}",
                    cwd: "${workspaceFolder}",
                    stopOnEntry: true
                },
                {
                    name: "Debug main.do",
                    type: LANGUAGE_ID,
                    request: "launch",
                    program: "${workspaceFolder}/main.do",
                    cwd: "${workspaceFolder}",
                    stopOnEntry: true
                }
            ]
        };

        try {
            await vscode.workspace.fs.createDirectory(vscodeDirUri);
            await vscode.workspace.fs.writeFile(launchJsonUri, Buffer.from(JSON.stringify(launchConfig, null, 2), 'utf8'));
            vscode.window.showInformationMessage(`Created launch configuration at ${launchJsonUri.fsPath}`);
            
            // Open the launch.json file
            const doc = await vscode.workspace.openTextDocument(launchJsonUri);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create launch configuration: ${error instanceof Error ? error.message : error}`);
        }
    });

    // Register build VM command
    const buildVMCommand = vscode.commands.registerCommand(COMMANDS.buildVM, async () => {
        const folder = getWorkspaceFolderForUri(vscode.window.activeTextEditor?.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            vscode.window.showErrorMessage('No workspace folder found. Open a folder to build the VM.');
            return;
        }

        const vmBuildDir = path.join(folder.uri.fsPath, 'vm', 'build');

        // Check existence via VS Code FS API
        let buildDirExists = true;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(vmBuildDir));
        } catch {
            buildDirExists = false;
        }

        if (!buildDirExists) {
            vscode.window.showErrorMessage(`VM build directory not found: ${vmBuildDir}. Please create it first with 'mkdir -p vm/build && cd vm/build && cmake ..'`);
            return;
        }

        vscode.window.showInformationMessage('Building Doof VM...');
        
        try {
            // Execute the build VM task
            const tasks = await vscode.tasks.fetchTasks({ type: 'doof' });
            const buildTask = tasks.find(task => task.name === 'Build VM');
            
            if (buildTask) {
                await vscode.tasks.executeTask(buildTask);
            } else {
                // Fallback to direct execution
                const terminal = vscode.window.createTerminal('Doof VM Build');
                terminal.sendText(`cd "${vmBuildDir}" && cmake --build .`);
                terminal.show();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`VM build failed: ${error instanceof Error ? error.message : error}`);
        }
    });

    context.subscriptions.push(
        validateWorkspaceCommand,
        debugCommand,
        createLaunchConfigCommand,
        buildVMCommand
    );
}

export function deactivate() {
    console.log('Doof Language Support extension is now deactivated!');
}
