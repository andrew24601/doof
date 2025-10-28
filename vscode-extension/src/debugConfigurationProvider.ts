import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DoofDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private readonly extensionPath?: string) {}
    
    /**
     * Massage a debug configuration just before a debug session is started.
     */
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        
        console.log('Resolving debug configuration:', config);
        console.log('Workspace folder:', folder?.uri.fsPath);
        
        // If launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            console.log('No debug configuration found, creating default');
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'doof') {
                config.type = 'doof';
                config.name = 'Debug Doof File';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        if (!config.program) {
            console.log('No program specified in debug configuration');
            return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
                return undefined; // abort launch
            });
        }

        // Set default values if not provided
        if (!config.cwd) {
            config.cwd = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        }

        const isRemote = config.mode === 'remote' || config.remote === true;
        if (!config.mode) {
            config.mode = isRemote ? 'remote' : 'local';
        }
        
        // Resolve workspace-relative paths
        if (folder) {
            if (config.program && config.program.includes('${workspaceFolder}')) {
                config.program = config.program.replace('${workspaceFolder}', folder.uri.fsPath);
            }
            if (config.cwd && config.cwd.includes('${workspaceFolder}')) {
                config.cwd = config.cwd.replace('${workspaceFolder}', folder.uri.fsPath);
            }
            if (!isRemote && config.vmPath && config.vmPath.includes('${workspaceFolder}')) {
                config.vmPath = config.vmPath.replace('${workspaceFolder}', folder.uri.fsPath);
            }
            if (config.transpilerPath && config.transpilerPath.includes('${workspaceFolder}')) {
                config.transpilerPath = config.transpilerPath.replace('${workspaceFolder}', folder.uri.fsPath);
            }
        }
        
        if (isRemote) {
            if (!config.host) {
                config.host = '127.0.0.1';
            }
            if (!config.port) {
                config.port = 7777;
            }
        }
        // Note: vmPath is optional - if not provided, the debugAdapter will use the bundled VM
        // Do not set a default here to allow the debugAdapter to handle it

        console.log('Final debug configuration (before variable substitution):', {
            program: config.program,
            cwd: config.cwd,
            vmPath: config.vmPath || '(will use bundled VM)',
            mode: config.mode,
            host: config.host,
            port: config.port
        });

        console.log('Debug configuration resolved successfully (validation will happen after variable substitution)');
        return config;
    }

    /**
     * Provide initial debug configurations for when launch.json doesn't exist
     */
    provideDebugConfigurations(
        folder: vscode.WorkspaceFolder | undefined,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        
        const workspaceRoot = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        return [
            {
                name: 'Debug Current Doof File',
                type: 'doof',
                request: 'launch',
                program: '${file}',
                cwd: '${workspaceFolder}',
                stopOnEntry: true
            },
            {
                name: 'Debug Specific Doof File',
                type: 'doof',
                request: 'launch',
                program: '${workspaceFolder}/main.do',
                cwd: '${workspaceFolder}',
                stopOnEntry: true
            },
            {
                name: 'Debug Doof on Remote Host',
                type: 'doof',
                request: 'launch',
                mode: 'remote',
                host: '127.0.0.1',
                port: 7777,
                program: '${file}',
                cwd: '${workspaceFolder}',
                stopOnEntry: true
            },
            {
                name: 'Attach to Running VM',
                type: 'doof',
                request: 'attach',
                host: 'localhost',
                port: 4711
            }
        ];
    }

    /**
     * Massage a debug configuration right before the debug adapter is started.
     */
    resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        
        // Perform any final variable substitutions
        // VS Code has already resolved ${file}, ${workspaceFolder}, etc.
        
        console.log('Final debug configuration (after variable substitution):', {
            program: config.program,
            cwd: config.cwd,
            vmPath: config.vmPath,
            mode: config.mode,
            host: config.host,
            port: config.port
        });

        // Note: We don't validate vmPath here because:
        // 1. If vmPath is not provided, the debugAdapter will use the bundled VM
        // 2. If vmPath is provided, the debugAdapter will validate it and provide a better error message
        // This allows the debugAdapter to have full control over VM location and fallback logic
        
        console.log('Debug configuration validated successfully after variable substitution');
        return config;
    }
}