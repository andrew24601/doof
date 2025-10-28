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

// Legacy in-file implementations replaced by modular language service and providers.

export function activate(context: vscode.ExtensionContext) {
    console.log('Doof Language Support extension is now active!');

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Doof extension requires a workspace folder');
        return;
    }

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
        vscode.languages.registerCompletionItemProvider('doof', completionProvider, '.', ':', '('),
        vscode.languages.registerHoverProvider('doof', hoverProvider),
        vscode.languages.registerDocumentSymbolProvider('doof', symbolProvider),
        vscode.languages.registerDocumentSemanticTokensProvider(
            'doof', 
            semanticTokensProvider, 
            DoofSemanticTokensProvider.legend
        ),
        vscode.languages.registerCodeActionsProvider('doof', codeActionsProvider),
        vscode.languages.registerDocumentFormattingEditProvider('doof', new DoofDocumentFormattingEditProvider()),
        diagnosticsProvider
    );

    // Immediately validate any already-open Doof documents so diagnostics appear
    (async () => {
        const openDocs = vscode.workspace.textDocuments.filter(d => d.languageId === 'doof');
        for (const doc of openDocs) {
            try {
                await diagnosticsProvider.updateDiagnostics(doc);
            } catch (e) {
                console.error('Error updating diagnostics for open document:', e);
            }
        }
    })();

    // Register global validation command
    const validateWorkspaceCommand = vscode.commands.registerCommand('doof.validateWorkspace', async () => {
        vscode.window.showInformationMessage('Running global validation...');
        try {
            await languageService.validateWorkspace();
            // Refresh diagnostics for open Doof documents after global validation
            const openDocs = vscode.workspace.textDocuments.filter(d => d.languageId === 'doof');
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
    const taskProvider = new DoofTaskProvider(workspaceRoot);
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(DoofTaskProvider.DoofType, taskProvider)
    );

    // Register problem matchers
    registerProblemMatchers();

    // Register debug command
    const debugCommand = vscode.commands.registerCommand('doof.debug', async (uri: vscode.Uri) => {
        if (!uri && vscode.window.activeTextEditor) {
            uri = vscode.window.activeTextEditor.document.uri;
        }
        
        if (uri && uri.fsPath.endsWith('.do')) {
            // Start debugging session
            const config: vscode.DebugConfiguration = {
                type: 'doof',
                request: 'launch',
                name: 'Debug Doof File',
                program: vscode.workspace.asRelativePath(uri.fsPath),
                cwd: workspaceRoot,
                stopOnEntry: true
            };
            
            await vscode.debug.startDebugging(undefined, config);
        } else {
            vscode.window.showErrorMessage('Please select a .do file to debug');
        }
    });

    // Register create launch config command
    const createLaunchConfigCommand = vscode.commands.registerCommand('doof.createLaunchConfig', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const launchJsonPath = path.join(vscodeDir, 'launch.json');

        // Create .vscode directory if it doesn't exist
        if (!require('fs').existsSync(vscodeDir)) {
            require('fs').mkdirSync(vscodeDir, { recursive: true });
        }

        const launchConfig = {
            version: "0.2.0",
            configurations: [
                {
                    name: "Debug Current Doof File",
                    type: "doof",
                    request: "launch",
                    program: "${file}",
                    cwd: "${workspaceFolder}",
                    stopOnEntry: true
                },
                {
                    name: "Debug main.do",
                    type: "doof",
                    request: "launch",
                    program: "${workspaceFolder}/main.do",
                    cwd: "${workspaceFolder}",
                    stopOnEntry: true
                }
            ]
        };

        try {
            require('fs').writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
            vscode.window.showInformationMessage(`Created launch configuration at ${launchJsonPath}`);
            
            // Open the launch.json file
            const doc = await vscode.workspace.openTextDocument(launchJsonPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create launch configuration: ${error instanceof Error ? error.message : error}`);
        }
    });

    // Register build VM command
    const buildVMCommand = vscode.commands.registerCommand('doof.buildVM', async () => {
        const vmBuildDir = path.join(workspaceRoot, 'vm', 'build');
        
        if (!require('fs').existsSync(vmBuildDir)) {
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
