import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { Lexer } from '../../src/parser/lexer';
import { Parser } from '../../src/parser/parser';
import { Validator } from '../../src/validation/validator';
import { TranspilerError, transpileVmBundle } from '../../src/transpiler';

// Debug protocol message types
interface DebugRequest {
    seq: number;
    type: 'request';
    command: string;
    arguments?: any;
}

interface DebugResponse {
    seq: number;
    type: 'response';
    request_seq: number;
    command: string;
    success: boolean;
    message?: string;
    body?: any;
}

interface DebugEvent {
    seq: number;
    type: 'event';
    event: string;
    body?: any;
}

interface LaunchRequestArguments extends vscode.DebugConfiguration {
    program: string;
    cwd: string;
    vmPath?: string;
    transpilerPath?: string;
    stopOnEntry?: boolean;
    mode?: 'local' | 'remote';
    host?: string;
    port?: number;
}

interface AttachRequestArguments extends vscode.DebugConfiguration {
    port: number;
    host?: string;
}

export class DoofDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor(private extensionPath: string) {}
    
    createDebugAdapterDescriptor(
        session: vscode.DebugSession,
        executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        
        // We use an inline debug adapter - VS Code will communicate directly with our DoofDebugAdapter
        return new vscode.DebugAdapterInlineImplementation(new DoofDebugAdapter(session, this.extensionPath));
    }
}

class DoofDebugAdapter implements vscode.DebugAdapter {
    private vmProcess: ChildProcess | null = null;
    private remoteSocket: net.Socket | null = null;
    private remoteBuffer = '';
    private pendingUploadResolve: (() => void) | null = null;
    private pendingUploadReject: ((reason: any) => void) | null = null;
    private pendingUploadSeq = 0;
    private session: vscode.DebugSession;
    private isTerminated = false;
    private isInitialized = false;
    private isLaunched = false;
    private vmReady = false; // Track when VM is ready to receive DAP commands
    private outputChannel: vscode.OutputChannel;
    private sequenceNumber = 1;
    private pendingBreakpoints = new Map<string, any>(); // Store breakpoints until VM is ready
    private shouldAutoContinue = false; // Track whether to auto-continue on entry stop
    private pendingVMRequests: any[] = [];
    private breakpointIdCounter = 1;

    // Event emitter for the DebugAdapter interface
    private _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this._onDidSendMessage.event;
    // Track whether this adapter has been disposed to avoid emitting into closed ports
    private isDisposed: boolean = false;
    private extensionPath: string;

    constructor(session: vscode.DebugSession, extensionPath: string) {
        this.session = session;
        this.extensionPath = extensionPath;
        this.outputChannel = vscode.window.createOutputChannel(`Doof Debug: ${session.name}`);
    }

    handleMessage(message: vscode.DebugProtocolMessage): void {
        try {
            const request = message as DebugRequest;
            if (request.type === 'request') {
                this.handleRequest(request).catch(error => {
                    this.outputChannel.appendLine(`Error handling request: ${error instanceof Error ? error.message : error}`);
                    console.error('Debug adapter error:', error);
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error handling message: ${error instanceof Error ? error.message : error}`);
            console.error('Debug adapter error:', error);
        }
    }

    private async handleRequest(request: DebugRequest): Promise<void> {
        const { command, arguments: args } = request;
        
        this.outputChannel.appendLine(`Handling ${command} request (seq: ${request.seq})`);

        switch (command) {
            case 'initialize':
                await this.handleInitializeRequest(request, args);
                break;
            case 'launch':
                await this.handleLaunchRequest(request, args as LaunchRequestArguments);
                break;
            case 'attach':
                await this.handleAttachRequest(request, args as AttachRequestArguments);
                break;
            case 'disconnect':
            case 'terminate':
                await this.handleTerminateRequest(request);
                break;
            case 'setBreakpoints':
                await this.handleSetBreakpointsRequest(request, args);
                break;
            case 'continue':
                await this.handleContinueRequest(request, args);
                break;
            case 'next':
                await this.handleNextRequest(request, args);
                break;
            case 'stepIn':
                await this.handleStepInRequest(request, args);
                break;
            case 'stepOut':
                await this.handleStepOutRequest(request, args);
                break;
            case 'pause':
                await this.handlePauseRequest(request, args);
                break;
            case 'stackTrace':
                await this.handleStackTraceRequest(request, args);
                break;
            case 'scopes':
                await this.handleScopesRequest(request, args);
                break;
            case 'variables':
                await this.handleVariablesRequest(request, args);
                break;
            case 'threads':
                await this.handleThreadsRequest(request, args);
                break;
            case 'configurationDone':
                await this.handleConfigurationDoneRequest(request);
                break;
            case 'source':
                await this.handleSourceRequest(request, args);
                break;
            default:
                this.outputChannel.appendLine(`⚠️  UNHANDLED COMMAND: ${command} (seq: ${request.seq})`);
                this.outputChannel.appendLine(`Request args: ${JSON.stringify(args)}`);
                this.sendErrorResponse(request, `Unhandled command: ${command}`);
        }
    }

    private async handleInitializeRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Handling initialize request');
        
        if (this.isInitialized) {
            this.outputChannel.appendLine('Already initialized, ignoring duplicate request');
            return;
        }
        
        this.isInitialized = true;
        
        // Send capabilities back to VS Code
        this.sendResponse(request, {
            supportsConfigurationDoneRequest: true,
            supportsEvaluateForHovers: false,
            supportsStepBack: false,
            supportsDataBreakpoints: false,
            supportsCompletionsRequest: false,
            supportsCancelRequest: false,
            supportsBreakpointLocationsRequest: false,
            supportsStepInTargetsRequest: false,
            supportsExceptionOptions: false,
            supportsModulesRequest: false,
            supportsRestartRequest: false,
            supportsExceptionInfoRequest: false,
            supportTerminateDebuggee: true,
            supportSuspendDebuggee: false,
            supportsDelayedStackTraceLoading: false,
            supportsLoadedSourcesRequest: false,
            supportsLogPoints: false,
            supportsTerminateThreadsRequest: false,
            supportsSetVariable: false,
            supportsRestartFrame: false,
            supportsGotoTargetsRequest: false,
            supportsClipboardContext: false,
            supportsValueFormattingOptions: false,
            supportsExceptionFilterOptions: false,
            supportsFunctionBreakpoints: false,
            supportsInstructionBreakpoints: false,
            supportsReadMemoryRequest: false,
            supportsDisassembleRequest: false,
        });

        this.sendEvent('initialized');
        this.outputChannel.appendLine('Sent initialized event');
        let initArgs: any;
        try {
            initArgs = args ? JSON.parse(JSON.stringify(args)) : {};
        } catch (error) {
            this.outputChannel.appendLine(`Failed to clone initialize arguments, using shallow copy: ${error instanceof Error ? error.message : error}`);
            initArgs = args || {};
        }
        this.pendingVMRequests = [];
        this.enqueueVMRequest('initialize', initArgs);
    }

    private async handleLaunchRequest(request: DebugRequest, args: LaunchRequestArguments): Promise<void> {
        if (this.isLaunched) {
            this.outputChannel.appendLine('Already launched, ignoring duplicate request');
            return;
        }
        
        this.outputChannel.appendLine(`Launching Doof debugger for: ${args.program}`);
        this.outputChannel.appendLine(`Working directory: ${args.cwd}`);
        const configuredTranspilerPath = args.transpilerPath;
        this.outputChannel.appendLine(
            configuredTranspilerPath
                ? `Transpiler: executing in-process (config reference: ${configuredTranspilerPath})`
                : 'Transpiler: executing in-process (no external path configured)'
        );
        if (args.mode === 'remote' || args.host || args.port) {
            this.outputChannel.appendLine(`Remote host: ${args.host || '127.0.0.1'}:${args.port || 7777}`);
        } else {
            this.outputChannel.appendLine(`VM path: ${args.vmPath || path.join(args.cwd, 'vm', 'build', 'json-runner')}`);
        }
        
        try {
            // First, compile the .do file to .vmbc
            const vmbcPath = await this.compileToVMBC(args);
            this.outputChannel.appendLine(`Compilation successful: ${vmbcPath}`);
            
            const isRemote = args.mode === 'remote' || args.host !== undefined || args.port !== undefined;
            if (isRemote) {
                await this.launchRemote(vmbcPath, args);
                this.outputChannel.appendLine('Remote VM connection established');
            } else {
                await this.launchVM(vmbcPath, args);
                this.outputChannel.appendLine('VM launched successfully');
            }
            this.flushPendingVMRequests();
            
            this.isLaunched = true;
            
            // Forward any pending breakpoints now that VM is ready
            this.forwardPendingBreakpoints();
            
            // Set auto-continue flag if stopOnEntry is false
            this.shouldAutoContinue = !args.stopOnEntry;
            
            // Now send the launch command to the VM (VM always stops on entry)
            this.outputChannel.appendLine(`Sending launch command to VM, will auto-continue: ${this.shouldAutoContinue}`);
            const launchArguments = {
                program: path.resolve(args.cwd, args.program),
                cwd: args.cwd,
                stopOnEntry: true
            };
            this.enqueueVMRequest('launch', launchArguments);
            this.flushPendingVMRequests();
            
            this.sendResponse(request, {});
            const processEvent: any = {
                name: path.basename(args.program),
                isLocalProcess: !(args.mode === 'remote' || this.remoteSocket),
                startMethod: 'launch'
            };
            if (this.vmProcess?.pid) {
                processEvent.systemProcessId = this.vmProcess.pid;
            }
            this.sendEvent('process', processEvent);

            // Don't send stopped event here - let the VM send it via DAP

        } catch (error) {
            this.outputChannel.appendLine(`Launch failed: ${error instanceof Error ? error.message : error}`);
            this.sendErrorResponse(request, `Failed to launch: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async handleAttachRequest(request: DebugRequest, args: AttachRequestArguments): Promise<void> {
        this.outputChannel.appendLine(`Attaching to Doof VM on ${args.host || 'localhost'}:${args.port}`);
        
        try {
            // For attach mode, we'd connect to an already running VM instance
            // This is a placeholder - the actual implementation would establish a TCP connection
            // to the VM running with --dap --port <port>
            
            this.sendResponse(request, {});
            this.sendEvent('process', {
                name: `Doof VM (${args.host || 'localhost'}:${args.port})`,
                isLocalProcess: false,
                startMethod: 'attach'
            });
            
        } catch (error) {
            this.sendErrorResponse(request, `Failed to attach: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async compileToVMBC(args: LaunchRequestArguments): Promise<string> {
        const programPath = path.resolve(args.cwd, args.program);
        const vmbcPath = programPath.replace(/\.do$/, '.vmbc');

        // Validate the .do file using the proper language service
        try {
            await this.validateWithLanguageService(programPath);
        } catch (error) {
            throw new Error(`Validation failed: ${error instanceof Error ? error.message : error}`);
        }

        this.outputChannel.appendLine(`Compiling ${programPath} to ${vmbcPath} using in-process transpiler`);

        const sourceRoots = Array.from(new Set([args.cwd, path.dirname(programPath)].filter((p): p is string => typeof p === 'string' && p.length > 0)));

        const transpilerOptions = {
            target: 'vm' as const,
            validate: true,
            outputHeader: false,
            outputSource: true,
            sourceRoots,
            verbose: false
        };

        const result = await transpileVmBundle(programPath, transpilerOptions);

        if (result.errors.length > 0) {
            this.outputChannel.appendLine('Compilation errors:');
            const formattedErrors = result.errors.map((err: TranspilerError) => {
                const locationParts: Array<string | number | undefined> = [];
                if (err.filename) {
                    locationParts.push(err.filename);
                }
                if (err.line !== undefined) {
                    locationParts.push(err.line);
                    if (err.column !== undefined) {
                        locationParts.push(err.column);
                    }
                }
                const location = locationParts.length > 0 ? locationParts.join(':') : 'unknown location';
                return `${location}: ${err.message}`;
            });

            for (const message of formattedErrors) {
                this.outputChannel.appendLine(`  ${message}`);
            }

            throw new Error(`Compilation failed: ${formattedErrors.length} error(s)`);
        }

        if (result.warnings.length > 0) {
            this.outputChannel.appendLine('Compilation warnings:');
            for (const warning of result.warnings) {
                this.outputChannel.appendLine(`  ${warning}`);
            }
        }

        if (!result.source) {
            throw new Error('Compilation failed: VM transpiler did not produce output');
        }

        await fs.promises.writeFile(vmbcPath, result.source, 'utf8');
        this.outputChannel.appendLine(`Compilation successful: ${vmbcPath}`);
        return vmbcPath;
    }

    private async launchVM(vmbcPath: string, args: LaunchRequestArguments): Promise<void> {
        // Ensure remote state cleared when launching locally
        this.closeRemoteSocket();
        this.resetPendingUpload();
        
        // Try bundled binary first, then fall back to workspace VM
        const bundledVMPath = path.join(this.extensionPath, 'runtime', 'json-runner');
        const workspaceVMPath = args.vmPath || path.join(args.cwd, 'vm', 'build', 'json-runner');
        
        this.outputChannel.appendLine(`Extension path: ${this.extensionPath}`);
        this.outputChannel.appendLine(`Checking bundled VM at: ${bundledVMPath}`);
        
        // Check bundled VM first
        let vmPath = bundledVMPath;
        if (!fs.existsSync(bundledVMPath)) {
            this.outputChannel.appendLine(`Bundled VM not found, trying workspace VM at: ${workspaceVMPath}`);
            vmPath = workspaceVMPath;
        } else {
            this.outputChannel.appendLine(`Using bundled VM: ${bundledVMPath}`);
        }
        
        this.outputChannel.appendLine(`Checking VM executable: ${vmPath}`);
        if (!fs.existsSync(vmPath)) {
            throw new Error(`VM executable not found at ${vmPath}. Please build the VM first by running 'cmake --build .' in the vm/build directory.`);
        }

        this.outputChannel.appendLine(`Checking bytecode file: ${vmbcPath}`);
        if (!fs.existsSync(vmbcPath)) {
            throw new Error(`Bytecode file not found: ${vmbcPath}`);
        }

        const vmArgs = ['--dap'];
        // Note: --verbose is disabled in DAP mode to avoid stdout pollution
        // The VM will automatically disable verbose output when --dap is used
        vmArgs.push(vmbcPath);

        this.outputChannel.appendLine(`Starting VM: ${vmPath} ${vmArgs.join(' ')}`);

        return new Promise((resolve, reject) => {
            this.vmProcess = spawn(vmPath, vmArgs, {
                cwd: args.cwd,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            if (!this.vmProcess || !this.vmProcess.stdin || !this.vmProcess.stdout || !this.vmProcess.stderr) {
                reject(new Error('Failed to create VM process'));
                return;
            }

            this.outputChannel.appendLine(`VM process started with PID: ${this.vmProcess.pid}`);
            this.setupVMCommunication(this.vmProcess);

            this.vmProcess.on('error', (error) => {
                const errorMsg = `Failed to start VM: ${error.message}`;
                this.outputChannel.appendLine(errorMsg);
                reject(new Error(errorMsg));
            });

            this.vmProcess.on('spawn', () => {
                this.outputChannel.appendLine('VM process spawned successfully');
                this.flushPendingVMRequests();
                resolve();
            });

            // Backup timeout in case spawn event doesn't fire
            setTimeout(() => {
                if (this.vmProcess && !this.vmProcess.killed) {
                    this.outputChannel.appendLine('VM process appears to be running (timeout backup)');
                    this.flushPendingVMRequests();
                    resolve();
                } else {
                    reject(new Error('VM process failed to start within timeout'));
                }
            }, 3000);
        });
    }

    private setupVMCommunication(vmProcess: ChildProcess): void {
        if (!vmProcess.stdout || !vmProcess.stderr) {return;}

        // Handle VM stdout (DAP responses and events)
        let buffer = '';
        vmProcess.stdout.on('data', (data) => {
            const output = data.toString();
            this.outputChannel.appendLine(`VM stdout: ${output}`);
            buffer += output;
            buffer = this.processVMMessages(buffer);
        });

        // Handle VM stderr (debug output)
        vmProcess.stderr.on('data', (data) => {
            const output = data.toString();
            this.outputChannel.appendLine(`VM stderr: ${output}`);
        });

        vmProcess.on('close', (code) => {
//            this.outputChannel.appendLine(`VM process exited with code ${code}`);
            if (!this.isTerminated) {
                this.sendEvent('terminated');
                this.isTerminated = true;
            }
        });

        vmProcess.on('exit', (code, signal) => {
//            this.outputChannel.appendLine(`VM process exited with code ${code}, signal ${signal}`);
        });
    }

    private async launchRemote(vmbcPath: string, args: LaunchRequestArguments): Promise<void> {
    const host = args.host || '127.0.0.1';
    const port = args.port || 7777;
    const bytecode = await fs.promises.readFile(vmbcPath, 'utf8');

    this.closeRemoteSocket();
    this.resetPendingUpload();

        return new Promise((resolve, reject) => {
            this.outputChannel.appendLine(`Connecting to remote VM at ${host}:${port}`);

            const socket = net.createConnection({ host, port }, () => {
                this.outputChannel.appendLine('Connected to remote VM server');
                this.remoteSocket = socket;
                this.remoteBuffer = '';
                this.vmReady = false;
                this.setupSocketCommunication(socket);
                this.flushPendingVMRequests();

                const uploadCommand = {
                    seq: this.sequenceNumber++,
                    type: 'request' as const,
                    command: 'uploadBytecode',
                    arguments: {
                        bytecode,
                        program: path.resolve(args.cwd, args.program)
                    }
                };

                const uploadPromise = new Promise<void>((resolveUpload, rejectUpload) => {
                    this.pendingUploadSeq = uploadCommand.seq;
                    this.pendingUploadResolve = () => {
                        this.outputChannel.appendLine('Remote VM acknowledged bytecode upload');
                        this.flushPendingVMRequests();
                        resolveUpload();
                        this.resetPendingUpload();
                    };
                    this.pendingUploadReject = (reason) => {
                        rejectUpload(reason);
                        this.resetPendingUpload();
                    };
                });

                this.sendToVM(uploadCommand);

                uploadPromise.then(resolve).catch(reject);
            });

            socket.setNoDelay(true);

            socket.on('error', (err) => {
                this.outputChannel.appendLine(`Remote socket error: ${err.message}`);
                if (this.pendingUploadReject) {
                    this.pendingUploadReject(err);
                } else {
                    reject(err);
                }
                this.resetPendingUpload();
                this.closeRemoteSocket();
            });

            socket.on('close', () => {
                this.outputChannel.appendLine('Remote socket closed');
                if (!this.isTerminated) {
                    this.sendEvent('terminated');
                    this.isTerminated = true;
                }
                if (this.pendingUploadReject) {
                    this.pendingUploadReject(new Error('Connection closed during upload'));
                    this.resetPendingUpload();
                }
                this.remoteSocket = null;
                this.remoteBuffer = '';
            });
        });
    }

    private setupSocketCommunication(socket: net.Socket): void {
        socket.on('data', (data: Buffer | string) => {
            const output = data.toString();
            this.outputChannel.appendLine(`VM socket: ${output}`);
            this.remoteBuffer += output;
            this.remoteBuffer = this.processVMMessages(this.remoteBuffer);
        });

        socket.on('error', (err) => {
            this.outputChannel.appendLine(`Socket communication error: ${err.message}`);
        });
    }

    private canWriteToVM(): boolean {
        const localReady = this.vmProcess && this.vmProcess.stdin && !this.vmProcess.killed;
        const remoteReady = this.remoteSocket && !this.remoteSocket.destroyed;
        return Boolean(localReady || remoteReady);
    }

    private closeRemoteSocket(): void {
        if (this.remoteSocket) {
            try {
                this.remoteSocket.end();
            } catch (err) {
                // ignore errors during shutdown
            }
            try {
                this.remoteSocket.destroy();
            } catch (err) {
                // ignore
            }
            this.remoteSocket = null;
        }
        this.remoteBuffer = '';
        this.resetPendingUpload();
    }

    private resetPendingUpload(): void {
        this.pendingUploadResolve = null;
        this.pendingUploadReject = null;
        this.pendingUploadSeq = 0;
    }

    private enqueueVMRequest(command: string, args: any): void {
        const message = {
            seq: this.sequenceNumber++,
            type: 'request' as const,
            command,
            arguments: args
        };

        if (this.canWriteToVM()) {
            this.outputChannel.appendLine(`Sending ${command} request to VM`);
            this.sendToVM(message);
        } else {
            this.outputChannel.appendLine(`Queueing ${command} request until VM connection is ready`);
            this.pendingVMRequests.push(message);
        }
    }

    private flushPendingVMRequests(): void {
        if (this.pendingVMRequests.length === 0) {
            return;
        }

        if (!this.canWriteToVM()) {
            return;
        }

        this.outputChannel.appendLine(`Flushing ${this.pendingVMRequests.length} queued VM request(s)`);
        const queued = this.pendingVMRequests;
        this.pendingVMRequests = [];
        for (const message of queued) {
            if (!this.canWriteToVM()) {
                this.pendingVMRequests.unshift(message);
                return;
            }
            this.sendToVM(message);
        }
    }

    private processVMMessages(buffer: string): string {
        // Process DAP messages from the VM
        // The VM should send DAP-compliant JSON messages with Content-Length headers
        let remaining = buffer;
        
        while (remaining.length > 0) {
            // Look for Content-Length header
            const headerMatch = remaining.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
            if (headerMatch) {
                const contentLength = parseInt(headerMatch[1]);
                const headerEnd = headerMatch.index! + headerMatch[0].length;
                
                // Check if we have the complete message
                if (remaining.length >= headerEnd + contentLength) {
                    const messageContent = remaining.substring(headerEnd, headerEnd + contentLength);
                    this.outputChannel.appendLine(`Received complete DAP message: ${messageContent}`);
                    this.forwardVMMessage(messageContent);
                    
                    // Remove processed content
                    remaining = remaining.substring(headerEnd + contentLength);
                } else {
                    // Incomplete message, wait for more data
                    break;
                }
            } else {
                // Look for direct JSON messages (fallback)
                const jsonMatch = remaining.match(/^(\{.*?\})/);
                if (jsonMatch) {
                    this.outputChannel.appendLine(`Received direct JSON message: ${jsonMatch[1]}`);
                    this.forwardVMMessage(jsonMatch[1]);
                    remaining = remaining.substring(jsonMatch[1].length);
                } else {
                    // No complete message found, wait for more data
                    break;
                }
            }
        }
        
        // Return the remaining unprocessed buffer
        return remaining;
    }

    private forwardVMMessage(messageText: string): void {
        try {
            const message = JSON.parse(messageText);
            this.outputChannel.appendLine(`VM Message: ${JSON.stringify(message)}`);

            if (message.type === 'response' && message.command === 'uploadBytecode') {
                if (message.success) {
                    if (this.pendingUploadResolve) {
                        this.pendingUploadResolve();
                    }
                } else {
                    const error = new Error(message.message || 'uploadBytecode failed');
                    if (this.pendingUploadReject) {
                        this.pendingUploadReject(error);
                    }
                }
                this.resetPendingUpload();
                return;
            }
            
            // Forward VM events and responses to VS Code
            if (message.type === 'event') {
                this.outputChannel.appendLine(`Forwarding VM event: ${message.event}`);
                if (message.event === 'stopped') {
                    this.outputChannel.appendLine(`🛑 VM stopped! Reason: ${message.body?.reason}, Thread: ${message.body?.threadId}`);
                    
                    // Auto-continue if this is an entry stop and stopOnEntry was false
                    if (message.body?.reason === 'entry' && this.shouldAutoContinue) {
                        this.shouldAutoContinue = false; // Only auto-continue once
                        this.outputChannel.appendLine('Auto-continuing because stopOnEntry is false');
                        
                        // Send continue command after a brief delay to ensure breakpoints are set
                        setTimeout(() => {
                            const continueCommand = {
                                seq: this.sequenceNumber++,
                                type: 'request' as const,
                                command: 'continue',
                                arguments: { threadId: message.body?.threadId || 1 }
                            };
                            this.sendToVM(continueCommand);
                        }, 10);
                    }
                } else if (message.event === 'output') {
                    this.outputChannel.appendLine(`📺 Output event: [${message.body?.category}] ${message.body?.output}`);
                }
                this.sendEvent(message.event, message.body);
            } else if (message.type === 'response') {
                // Handle successful launch response - VM is now ready
                if (message.command === 'launch' && message.success) {
                    this.outputChannel.appendLine('🚀 VM launch response received - VM is now ready for breakpoints');
                    this.vmReady = true;
                    // Forward any pending breakpoints now that VM is ready
                    this.forwardPendingBreakpoints();
                }
                
                // Handle setBreakpoints responses to send back to original VSCode request
                if (message.command === 'setBreakpoints') {
                    this.outputChannel.appendLine(`📍 Received setBreakpoints acknowledgement from VM: ${JSON.stringify(message.body)}`);
                    return;
                }
                
                // Forward other VM responses directly to VS Code
                this.outputChannel.appendLine(`Forwarding VM response: ${message.command}`);
                this.safeFire(message as vscode.DebugProtocolMessage);
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse VM message: ${messageText}`);
        }
    }

    /**
     * Safely emit debug protocol messages to VS Code. Emission can fail when the
     * extension host or underlying message port is shutting down; swallow those
     * errors to avoid unhandled exceptions from bubbling up into the host.
     */
    private safeFire(message: vscode.DebugProtocolMessage): void {
        if (this.isDisposed) {
            // Already disposed: ignore any outgoing messages
            return;
        }

        try {
            this._onDidSendMessage.fire(message);
        } catch (err) {
            // Log and swallow. During shutdown VS Code may cancel the underlying
            // message port which throws a Canceled error — treat that as benign.
            try {
                this.outputChannel.appendLine(`Warning: failed to send debug message (adapter disposing?): ${err instanceof Error ? err.message : String(err)}`);
            } catch (_) {
                // ignore logging errors
            }
        }
    }

    private async handleTerminateRequest(request: DebugRequest): Promise<void> {
        this.outputChannel.appendLine('Terminating debug session');

        this.isTerminated = true;

        if (this.vmProcess && !this.vmProcess.killed) {
            this.vmProcess.kill('SIGTERM');
            
            // Give the process time to clean up
            setTimeout(() => {
                if (this.vmProcess && !this.vmProcess.killed) {
                    this.vmProcess.kill('SIGKILL');
                }
            }, 2000);
        }

        if (this.remoteSocket && !this.remoteSocket.destroyed) {
            this.closeRemoteSocket();
        }

        this.pendingVMRequests = [];

        this.sendResponse(request, {});
        this.sendEvent('terminated');
    }

    private async handleSetBreakpointsRequest(request: DebugRequest, args: any): Promise<void> {
        const { source, lines, breakpoints } = args;

        const lineList = Array.isArray(lines) ? lines : [];
        const breakpointList = Array.isArray(breakpoints) ? breakpoints : [];
        const requestedLines: number[] = [];

        for (const entry of breakpointList) {
            if (entry && typeof entry.line === 'number') {
                requestedLines.push(entry.line);
            }
        }
        if (requestedLines.length === 0 && lineList.length > 0) {
            for (const line of lineList) {
                if (typeof line === 'number') {
                    requestedLines.push(line);
                }
            }
        }

        this.outputChannel.appendLine(`Setting breakpoints in ${source?.path || 'unknown'} at lines: ${requestedLines.join(', ') || 'none'}`);

        if (!source) {
            this.outputChannel.appendLine('Missing source in breakpoint request - sending empty response');
            this.sendResponse(request, { breakpoints: [] });
            return;
        }

        const sourcePath = source.path || source.name || 'unknown';
        const responseBreakpoints = requestedLines.map(line => ({
            id: this.breakpointIdCounter++,
            verified: true,
            line
        }));

        if (this.vmReady && this.canWriteToVM()) {
            const dapRequest = {
                seq: this.sequenceNumber++,
                type: 'request' as const,
                command: 'setBreakpoints',
                arguments: args
            };

            this.outputChannel.appendLine(`VM ready - forwarding setBreakpoints to VM (seq: ${dapRequest.seq})`);
            this.sendToVM(dapRequest);
        } else {
            const channelState = {
                vmProcess: !!this.vmProcess,
                stdin: !!this.vmProcess?.stdin,
                remoteSocket: !!this.remoteSocket && !this.remoteSocket.destroyed,
                vmReady: this.vmReady
            };
            this.outputChannel.appendLine(`VM not ready ${JSON.stringify(channelState)} - caching breakpoints for ${sourcePath}`);
            this.pendingBreakpoints.set(sourcePath, args);
        }

        this.sendResponse(request, { breakpoints: responseBreakpoints });
    }

    private forwardPendingBreakpoints(): void {
        if (this.pendingBreakpoints.size === 0) {
            return;
        }

        this.outputChannel.appendLine(`Forwarding ${this.pendingBreakpoints.size} pending breakpoint request(s) to VM`);

        for (const [sourcePath, args] of this.pendingBreakpoints) {
            const dapRequest = {
                seq: this.sequenceNumber++,
                type: 'request' as const,
                command: 'setBreakpoints',
                arguments: args
            };

            this.outputChannel.appendLine(`Forwarding pending setBreakpoints for ${sourcePath} to VM (seq: ${dapRequest.seq})`);
            this.sendToVM(dapRequest);
        }

        // Clear pending breakpoints - they've been forwarded
        this.pendingBreakpoints.clear();
    }

    private async handleSourceRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine(`Getting source content for: ${JSON.stringify(args)}`);
        
        // VSCode is asking for source content, usually when it can't find the file
        // The args should contain either a 'source' object or 'sourceReference'
        
        if (args.source && args.source.path) {
            const sourcePath = args.source.path;
            this.outputChannel.appendLine(`Source path requested: ${sourcePath}`);
            
            try {
                // Try to read the source file directly from the provided path
                const fs = require('fs');
                
                if (fs.existsSync(sourcePath)) {
                    const content = fs.readFileSync(sourcePath, 'utf8');
                    this.sendResponse(request, { content });
                    return;
                }
                
                // Fallback: return error
                this.sendErrorResponse(request, `Source file not found: ${sourcePath}`);
                
            } catch (error) {
                this.outputChannel.appendLine(`Error reading source file: ${error}`);
                this.sendErrorResponse(request, `Error reading source: ${error}`);
            }
        } else {
            this.sendErrorResponse(request, 'No source path provided in source request');
        }
    }

    private async handleContinueRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Continue execution');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'continue',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }

        this.sendResponse(request, { allThreadsContinued: true });
    }

    private async handleNextRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Step over');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'next',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }

        this.sendResponse(request, {});
    }

    private async handleStepInRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Step into');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'stepIn',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }

        this.sendResponse(request, {});
    }

    private async handleStepOutRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Step out');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'stepOut', 
                arguments: args
            };

            this.sendToVM(dapRequest);
        }

        this.sendResponse(request, {});
    }

    private async handlePauseRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Pause execution');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'pause',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }

        this.sendResponse(request, {});
    }

    private async handleThreadsRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Getting threads');
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'threads',
                arguments: args
            };

            this.sendToVM(dapRequest);
            // Don't send response here - let the VM respond
            return;
        }

        // If no VM process, return empty threads
        this.sendResponse(request, {
            threads: []
        });
    }

    private async handleStackTraceRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine(`Getting stack trace for thread ${args?.threadId || 'unknown'}`);
        
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'stackTrace',
                arguments: args
            };

            this.sendToVM(dapRequest);
            // Don't send response here - let the VM respond
            return;
        }

        // Fallback response if no VM process
        this.sendResponse(request, {
            stackFrames: [],
            totalFrames: 0
        });
    }

    private async handleScopesRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Getting scopes');
        
        // Forward the scopes request to the VM
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'scopes',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }
    }

    private async handleVariablesRequest(request: DebugRequest, args: any): Promise<void> {
        this.outputChannel.appendLine('Getting variables');
        
        // Forward the variables request to the VM
        if (this.canWriteToVM()) {
            const dapRequest = {
                seq: request.seq,
                type: 'request' as const,
                command: 'variables',
                arguments: args
            };

            this.sendToVM(dapRequest);
        }
    }

    private async handleConfigurationDoneRequest(request: DebugRequest): Promise<void> {
        this.outputChannel.appendLine('Configuration done');
        this.sendResponse(request, {});
        let configurationArgs: any;
        try {
            configurationArgs = request.arguments ? JSON.parse(JSON.stringify(request.arguments)) : {};
        } catch (error) {
            this.outputChannel.appendLine(`Failed to clone configurationDone arguments, using shallow copy: ${error instanceof Error ? error.message : error}`);
            configurationArgs = request.arguments || {};
        }
        this.enqueueVMRequest('configurationDone', configurationArgs);
        this.flushPendingVMRequests();
    }

    private async validateWithLanguageService(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath, 'utf8');
        
        try {
            // Use the same validation approach as the language service
            const lexer = new Lexer(content, filePath);
            const tokens = lexer.tokenize();
            
            const parser = new Parser(tokens, filePath);
            const ast = parser.parse();
            
            if (parser.errors && parser.errors.length > 0) {
                const errorMessages = parser.errors.map(err => err instanceof Error ? err.message : String(err));
                throw new Error(`Parse errors:\n${errorMessages.join('\n')}`);
            }
            
            if (!ast) {
                throw new Error('Failed to parse the file');
            }
            
            // Use the validator with the same settings as the language service
            const validator = new Validator({ allowTopLevelStatements: false, verbose: false });
            const validationContext = validator.validate(ast);
            
            if (validationContext.errors && validationContext.errors.length > 0) {
                const errorMessages = validationContext.errors.map(err => err.message);
                throw new Error(`Validation errors:\n${errorMessages.join('\n')}`);
            }
            
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Validation failed: ${String(error)}`);
        }
    }

    private sendToVM(message: any): void {
        if (this.vmProcess && this.vmProcess.stdin) {
            const messageText = JSON.stringify(message);
            const content = `Content-Length: ${messageText.length}\r\n\r\n${messageText}`;
            
            this.outputChannel.appendLine(`Sending to VM: ${content}`);
            this.vmProcess.stdin.write(content);
        } else if (this.remoteSocket && !this.remoteSocket.destroyed) {
            const messageText = JSON.stringify(message);
            const content = `Content-Length: ${messageText.length}\r\n\r\n${messageText}`;
            this.outputChannel.appendLine(`Sending to remote VM: ${content}`);
            this.remoteSocket.write(content);
        } else {
            this.outputChannel.appendLine(`Cannot send to VM - process not available`);
        }
    }

    private sendResponse(request: DebugRequest, body: any): void {
        const response: DebugResponse = {
            seq: this.sequenceNumber++,
            type: 'response',
            request_seq: request.seq,
            command: request.command,
            success: true,
            body: body
        };
        this.safeFire(response as vscode.DebugProtocolMessage);
    }

    private sendErrorResponse(request: DebugRequest, message: string): void {
        const response: DebugResponse = {
            seq: this.sequenceNumber++,
            type: 'response',
            request_seq: request.seq,
            command: request.command,
            success: false,
            message: message
        };

        this.outputChannel.appendLine(`Error: ${message}`);
        this.safeFire(response as vscode.DebugProtocolMessage);
    }

    private sendEvent(event: string, body?: any): void {
        const eventMessage: DebugEvent = {
            seq: this.sequenceNumber++,
            type: 'event',
            event: event,
            body: body
        };

        this.outputChannel.appendLine(`Event: ${event} ${body ? JSON.stringify(body) : ''}`);
        this.safeFire(eventMessage as vscode.DebugProtocolMessage);
    }

    dispose(): void {
        // Mark disposed first so any in-flight callbacks stop attempting to emit
        this.isDisposed = true;

        try {
            if (this.vmProcess && !this.vmProcess.killed) {
                this.vmProcess.kill();
            }
        } catch (e) {
            // ignore errors killing process during shutdown
        }

        try {
            if (this.remoteSocket && !this.remoteSocket.destroyed) {
                this.closeRemoteSocket();
            }
        } catch (e) {
            // ignore
        }

        try {
            this.outputChannel.dispose();
        } catch (e) {
            // ignore
        }

        try {
            this._onDidSendMessage.dispose();
        } catch (e) {
            // ignore
        }

        this.pendingVMRequests = [];
    }
}