import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { resolveDependencyGraph } from '../../../src/project/dependency-resolver';
import { Validator } from '../../../src/validation/validator';
import { validateFiles, FileEntry } from './multiFileValidator';
import {
    Program,
    ValidationError,
    ASTNode,
    Expression,
    Statement,
    ClassDeclaration,
    FunctionDeclaration,
    VariableDeclaration,
    EnumDeclaration,
    MethodDeclaration,
    FieldDeclaration,
    Identifier,
    Type,
    SourceLocation,
    GlobalValidationContext
} from '../../../src/types';

export interface DocumentCache {
    document: vscode.TextDocument;
    ast: Program | null;
    validationErrors: ValidationError[];
    lastModified: number;
}

export class DoofLanguageService {
    private readonly documentCache = new Map<string, DocumentCache>();

    public async processDocument(document: vscode.TextDocument): Promise<{ ast: Program | null; errors: ValidationError[] }> {
        const uri = document.uri.toString();
        const cached = this.documentCache.get(uri);

        if (cached && cached.lastModified === document.version) {
            return { ast: cached.ast, errors: cached.validationErrors };
        }

        let ast: Program | null = null;
        const validationErrors: ValidationError[] = [];

        try {
            const sourceRoots = this.getSourceRoots(document);
            const overrides = this.collectOpenDocumentContents();
            overrides.set(document.uri.fsPath, document.getText());

            const dependencyGraph = await resolveDependencyGraph(document.uri.fsPath, {
                sourceRoots,
                fileContents: overrides
            });

            for (const depError of dependencyGraph.errors) {
                const filename = depError.filename ?? document.uri.fsPath;
                const line = depError.line ?? 1;
                const column = depError.column ?? 1;
                validationErrors.push({
                    message: depError.message,
                    location: {
                        start: { line, column },
                        end: { line, column: column + 1 },
                        filename
                    }
                });
            }

            const fileEntries: FileEntry[] = [];
            for (const filePath of dependencyGraph.files) {
                const override = overrides.get(filePath);
                if (override !== undefined) {
                    fileEntries.push({ path: filePath, content: override });
                    continue;
                }

                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    fileEntries.push({ path: filePath, content });
                } catch (readError) {
                    const message = readError instanceof Error ? readError.message : String(readError);
                    validationErrors.push({
                        message: `Failed to read '${filePath}': ${message}`,
                        location: {
                            start: { line: 1, column: 1 },
                            end: { line: 1, column: 1 },
                            filename: filePath
                        }
                    });
                }
            }

            if (!fileEntries.some(entry => entry.path === document.uri.fsPath)) {
                fileEntries.unshift({ path: document.uri.fsPath, content: document.getText() });
            }

            const validationResult = validateFiles(fileEntries, { sourceRoots });
            const entryErrors = validationResult.errorsByFile.get(document.uri.fsPath);
            if (entryErrors) {
                validationErrors.push(...entryErrors);
            }

            ast = validationResult.programs.get(document.uri.fsPath) ?? this.createMinimalAST(document);
        } catch (error) {
            validationErrors.push({
                message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                location: {
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                    filename: document.uri.fsPath
                }
            });
            if (!ast) {
                ast = this.createMinimalAST(document);
            }
        }

        this.cacheResults(uri, document, ast, validationErrors);
        return { ast, errors: validationErrors };
    }

    private getSourceRoots(document: vscode.TextDocument): string[] {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const workspaceRoot = workspaceFolder?.uri.fsPath;
        const config = vscode.workspace.getConfiguration('doof', document.uri);
        const cppBuilder = config.get<any>('cppBuilder') || {};
        const vmGlue = config.get<any>('vmGlue') || {};

        const candidates: Array<string | undefined> = [];

        if (typeof cppBuilder.root === 'string') {
            candidates.push(this.expandConfigPath(cppBuilder.root, workspaceRoot, document.uri.fsPath));
        }

        if (Array.isArray(vmGlue.sourceRoots)) {
            for (const rawRoot of vmGlue.sourceRoots) {
                if (typeof rawRoot === 'string') {
                    candidates.push(this.expandConfigPath(rawRoot, workspaceRoot, document.uri.fsPath));
                }
            }
        }

        if (workspaceRoot) {
            candidates.push(workspaceRoot);
            candidates.push(path.join(workspaceRoot, 'src'));
        }

        candidates.push(path.dirname(document.uri.fsPath));

        const unique = new Set<string>();
        for (const candidate of candidates) {
            if (candidate) {
                unique.add(path.resolve(candidate));
            }
        }

        return Array.from(unique.values());
    }

    private expandConfigPath(value: string, workspaceRoot: string | undefined, filePath: string): string {
        let result = value;
        if (workspaceRoot) {
            result = result.replace(/\$\{workspaceFolder\}/g, workspaceRoot);
            result = result.replace(/\$\{workspaceFolderBasename\}/g, path.basename(workspaceRoot));
        }

        result = result.replace(/\$\{file\}/g, filePath);
        result = result.replace(/\$\{fileBasename\}/g, path.basename(filePath));
        return result;
    }

    private collectOpenDocumentContents(): Map<string, string> {
        const overrides = new Map<string, string>();
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'doof') {
                overrides.set(doc.uri.fsPath, doc.getText());
            }
        }
        return overrides;
    }

    private cacheResults(uri: string, document: vscode.TextDocument, ast: Program | null, validationErrors: ValidationError[]): void {
        this.documentCache.set(uri, {
            document,
            ast,
            validationErrors,
            lastModified: document.version
        });
    }

    private extractLocationFromError(error: any, document: vscode.TextDocument): SourceLocation {
        if (error && typeof error === 'object' && 'location' in error && error.location) {
            const loc = error.location as SourceLocation;
            return {
                start: loc.start,
                end: loc.end,
                filename: document.uri.fsPath
            };
        }

        if (error && error.message) {
            const lineMatch = error.message.match(/line\s+(\d+)/i);
            const columnMatch = error.message.match(/column\s+(\d+)/i);

            if (lineMatch) {
                const line = parseInt(lineMatch[1], 10);
                const column = columnMatch ? parseInt(columnMatch[1], 10) : 1;
                return {
                    start: { line, column },
                    end: { line, column: column + 1 },
                    filename: document.uri.fsPath
                };
            }
        }

        return {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
            filename: document.uri.fsPath
        };
    }

    private createMinimalAST(document: vscode.TextDocument): Program {
        return {
            kind: 'program',
            body: [],
            filename: document.uri.fsPath,
            moduleName: 'main',
            location: {
                start: { line: 1, column: 1 },
                end: { line: document.lineCount, column: 1 },
                filename: document.uri.fsPath
            }
        };
    }

    public getDocumentCache(uri: string): DocumentCache | undefined {
        return this.documentCache.get(uri);
    }

    public clearCache(uri?: string): void {
        if (uri) {
            this.documentCache.delete(uri);
        } else {
            this.documentCache.clear();
        }
    }

    public async validateWorkspace(): Promise<void> {
        const doofFiles = await vscode.workspace.findFiles('**/*.do');
        if (doofFiles.length === 0) {
            return;
        }

        const programs: Program[] = [];
        const documents = await Promise.all(doofFiles.map(uri => vscode.workspace.openTextDocument(uri)));

        for (const document of documents) {
            const { ast } = await this.processDocument(document);
            if (ast) {
                programs.push(ast);
            }
        }

        if (programs.length > 1) {
            const globalValidator = new Validator({ allowTopLevelStatements: true, verbose: false });
            const globalContext: GlobalValidationContext = {
                files: new Map(programs.map((program, i) => [documents[i].uri.fsPath, program])),
                moduleMap: new Map(programs.map((program, i) => [documents[i].uri.fsPath, program.moduleName || 'main'])),
                exportedSymbols: new Map(),
                errors: []
            };

            const results = globalValidator.validateWithGlobalContext(programs, globalContext);

            for (let i = 0; i < documents.length && i < results.length; i++) {
                const document = documents[i];
                const result = results[i];
                this.documentCache.set(document.uri.toString(), {
                    document,
                    ast: programs[i],
                    validationErrors: result.errors,
                    lastModified: document.version
                });
            }
        }
    }
}
