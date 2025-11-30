import * as vscode from 'vscode';
import * as path from 'path';
import { FormatterOptions, DEFAULT_FORMATTER_OPTIONS, formatDoofCode } from '../../../src/formatter';
import { Lexer, Token, TokenType } from '../../../src/parser/lexer';
import {
    Program,
    ASTNode,
    Expression,
    ClassDeclaration,
    FunctionDeclaration,
    VariableDeclaration,
    EnumDeclaration,
    MethodDeclaration,
    FieldDeclaration,
    Type,
    SourceLocation
} from '../../../src/types';
import { DoofLanguageService } from './languageService';
import { LANGUAGE_ID } from '../constants';
import type { TranspilerError } from '../../../src/transpiler';

const DOMINO_KEYWORDS = [
    'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return',
    'switch', 'case', 'default', 'async', 'await',
    'let', 'const', 'readonly', 'function', 'class', 'enum', 'interface',
    'extern', 'export', 'import', 'from', 'static', 'private', 'weak', 'type',
    'extends', 'this', 'of', 'in', 'is', 'new', 'true', 'false', 'null'
];

const DOMINO_TYPES = [
    'int', 'float', 'double', 'bool', 'char', 'string', 'void',
    'Array', 'Map', 'Set'
];

const DOMINO_OPERATORS = [
    '=>', '..', '..<', '&&', '||', '==', '!=', '<=', '>=',
    '+=', '-=', '*=', '/=', '\\', '++', '--'
];

let hasWarnedAboutTabIndent = false;

function isConfigurationOverridden(
    inspect: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined
): boolean {
    return !!inspect && (
        inspect.globalValue !== undefined ||
        inspect.workspaceValue !== undefined ||
        inspect.workspaceFolderValue !== undefined
    );
}

export function buildFormatterOptions(
    document: vscode.TextDocument,
    formattingOptions: vscode.FormattingOptions
): FormatterOptions {
    const config = vscode.workspace.getConfiguration('doof.format', document);
    const base: FormatterOptions = { ...DEFAULT_FORMATTER_OPTIONS };
    const mutableBase = base as FormatterOptions & Record<string, boolean | number>;

    const indentInspect = config.inspect<number>('indentSize');
    if (isConfigurationOverridden(indentInspect)) {
        const indentSize = config.get<number>('indentSize', base.indentSize);
        if (typeof indentSize === 'number' && indentSize > 0) {
            base.indentSize = indentSize;
        }
    } else if (formattingOptions.tabSize && formattingOptions.tabSize > 0) {
        base.indentSize = Math.max(1, Math.floor(formattingOptions.tabSize));
    }

    const maxLineInspect = config.inspect<number>('maxLineLength');
    if (isConfigurationOverridden(maxLineInspect)) {
        const maxLineLength = config.get<number>('maxLineLength', base.maxLineLength);
        if (typeof maxLineLength === 'number' && maxLineLength > 0) {
            base.maxLineLength = maxLineLength;
        }
    }

    const booleanKeys: Array<keyof FormatterOptions> = [
        'alignObjectProperties',
        'breakLongArrays',
        'breakLongFunctionParameters',
        'breakLongObjects',
        'insertFinalNewline',
        'insertSpaceAfterComma',
        'insertSpaceAfterKeywords',
        'insertSpaceAroundBinaryOperators',
        'insertSpaceBeforeBlockBrace',
        'trimTrailingWhitespace'
    ];

    for (const key of booleanKeys) {
        const inspect = config.inspect<boolean>(key as string);
        if (isConfigurationOverridden(inspect)) {
            const value = config.get<boolean>(key as string);
            if (typeof value === 'boolean') {
                mutableBase[key as string] = value;
            }
        }
    }

    if (!isConfigurationOverridden(config.inspect<boolean>('insertFinalNewline'))) {
        const filesConfig = vscode.workspace.getConfiguration('files', document);
        const fileSetting = filesConfig.get<boolean>('insertFinalNewline');
        if (typeof fileSetting === 'boolean') {
            base.insertFinalNewline = fileSetting;
        }
    }

    if (!isConfigurationOverridden(config.inspect<boolean>('trimTrailingWhitespace'))) {
        const filesConfig = vscode.workspace.getConfiguration('files', document);
        const fileSetting = filesConfig.get<boolean>('trimTrailingWhitespace');
        if (typeof fileSetting === 'boolean') {
            base.trimTrailingWhitespace = fileSetting;
        }
    }

    return base;
}

export class DoofCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private readonly languageService: DoofLanguageService) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
        const items: vscode.CompletionItem[] = [];
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);
        const memberAccessMatch = textBeforeCursor.match(/(\w+)\.$/);

        if (memberAccessMatch) {
            const objectName = memberAccessMatch[1];
            await this.addMemberCompletions(objectName, items, document, position);
        } else {
            await this.addGeneralCompletions(items, document);
        }

        return items;
    }

    private async addMemberCompletions(objectName: string, items: vscode.CompletionItem[], document: vscode.TextDocument, position: vscode.Position): Promise<void> {
        const { ast } = await this.languageService.processDocument(document);

        if (objectName === 'Math') {
            this.addMathCompletions(items);
        } else if (ast) {
            const objectType = this.getObjectTypeFromAST(objectName, ast, position);
            if (objectType) {
                this.addTypeSpecificCompletions(objectType, items);
            }
        }

        if (items.length === 0) {
            const typeFromText = this.getTypeFromTextAnalysis(objectName, document, position);
            if (typeFromText) {
                this.addTypeSpecificCompletions(typeFromText, items);
            }
        }

        if (items.length === 0) {
            this.addGenericMemberCompletions(items);
        }
    }

    private getTypeFromTextAnalysis(objectName: string, document: vscode.TextDocument, position: vscode.Position): string | null {
        const text = document.getText();
        const patterns = [
            new RegExp(`const\\s+${objectName}\\s*:\\s*([^=\\s]+)`, 'g'),
            new RegExp(`let\\s+${objectName}\\s*:\\s*([^=\\s]+)`, 'g'),
            new RegExp(`${objectName}\\s*:\\s*([^=\\s]+)\\s*=`, 'g')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(text);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        if (new RegExp(`${objectName}\\s*=\\s*\\[`, 'g').test(text)) {
            return 'Array';
        }
        if (new RegExp(`${objectName}\\s*=\\s*["']`, 'g').test(text)) {
            return 'string';
        }
        return null;
    }

    private addMathCompletions(items: vscode.CompletionItem[]): void {
        const mathConstants = [
            { name: 'PI', detail: 'PI: double', doc: 'The mathematical constant π (pi)' },
            { name: 'E', detail: 'E: double', doc: "Euler's number, the base of natural logarithms" },
            { name: 'LN2', detail: 'LN2: double', doc: 'The natural logarithm of 2' },
            { name: 'LN10', detail: 'LN10: double', doc: 'The natural logarithm of 10' },
            { name: 'LOG2E', detail: 'LOG2E: double', doc: 'The base 2 logarithm of e' },
            { name: 'LOG10E', detail: 'LOG10E: double', doc: 'The base 10 logarithm of e' },
            { name: 'SQRT1_2', detail: 'SQRT1_2: double', doc: 'The square root of 1/2' },
            { name: 'SQRT2', detail: 'SQRT2: double', doc: 'The square root of 2' }
        ];

        for (const constant of mathConstants) {
            const item = new vscode.CompletionItem(constant.name, vscode.CompletionItemKind.Constant);
            item.detail = constant.detail;
            item.documentation = constant.doc;
            items.push(item);
        }

        const mathMethods = [
            { name: 'abs', params: '(x: double)', doc: 'Returns the absolute value of x' },
            { name: 'min', params: '(a: double, b: double)', doc: 'Returns the smaller of two values' },
            { name: 'max', params: '(a: double, b: double)', doc: 'Returns the larger of two values' },
            { name: 'pow', params: '(base: double, exp: double)', doc: 'Returns base raised to the power of exp' },
            { name: 'sqrt', params: '(x: double)', doc: 'Returns the square root of x' },
            { name: 'sin', params: '(x: double)', doc: 'Returns the sine of x (in radians)' },
            { name: 'cos', params: '(x: double)', doc: 'Returns the cosine of x (in radians)' },
            { name: 'tan', params: '(x: double)', doc: 'Returns the tangent of x (in radians)' },
            { name: 'asin', params: '(x: double)', doc: 'Returns the arcsine of x in radians' },
            { name: 'acos', params: '(x: double)', doc: 'Returns the arccosine of x in radians' },
            { name: 'atan', params: '(x: double)', doc: 'Returns the arctangent of x in radians' },
            { name: 'atan2', params: '(y: double, x: double)', doc: 'Returns the arctangent of y/x in radians' },
            { name: 'exp', params: '(x: double)', doc: 'Returns e raised to the power of x' },
            { name: 'log', params: '(x: double)', doc: 'Returns the natural logarithm of x' },
            { name: 'log10', params: '(x: double)', doc: 'Returns the base 10 logarithm of x' },
            { name: 'floor', params: '(x: double)', doc: 'Returns the largest integer <= x' },
            { name: 'ceil', params: '(x: double)', doc: 'Returns the smallest integer >= x' },
            { name: 'round', params: '(x: double)', doc: 'Returns x rounded to the nearest integer' },
            { name: 'fmod', params: '(a: double, b: double)', doc: 'Returns the floating-point remainder of a/b' },
            { name: 'hypot', params: '(a: double, b: double)', doc: 'Returns sqrt(a² + b²)' }
        ];

        for (const method of mathMethods) {
            const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
            item.detail = `${method.name}${method.params}: double`;
            item.documentation = method.doc;
            item.insertText = new vscode.SnippetString(`${method.name}(\${1})`);
            items.push(item);
        }
    }

    private addTypeSpecificCompletions(objectType: string, items: vscode.CompletionItem[]): void {
        const normalizedType = objectType.trim();

        if (normalizedType.endsWith('[]') || normalizedType === 'Array' || normalizedType.includes('Array')) {
            this.addArrayCompletions(items);
        } else if (normalizedType === 'string') {
            this.addStringCompletions(items);
        } else if (normalizedType.startsWith('Map<') || normalizedType === 'Map') {
            this.addMapCompletions(items);
        } else if (normalizedType.startsWith('Set<') || normalizedType === 'Set') {
            this.addSetCompletions(items);
        }
    }

    private addArrayCompletions(items: vscode.CompletionItem[]): void {
        const arrayMethods = [
            { name: 'push', params: '(element: T)', returns: 'void', doc: 'Adds an element to the end of the array' },
            { name: 'pop', params: '()', returns: 'T', doc: 'Removes and returns the last element' },
            { name: 'forEach', params: '(callback: (it: T, index: int) => void)', returns: 'void', doc: 'Executes a function for each element' },
            { name: 'map', params: '(callback: (it: T, index: int) => U)', returns: 'U[]', doc: 'Transforms each element and returns a new array' },
            { name: 'filter', params: '(callback: (it: T, index: int) => bool)', returns: 'T[]', doc: 'Keeps elements that pass the predicate' },
            { name: 'find', params: '(callback: (it: T, index: int) => bool)', returns: 'T', doc: 'Returns the first element matching the predicate' },
            { name: 'indexOf', params: '(element: T)', returns: 'int', doc: 'Returns the index of the element or -1 if not found' }
        ];

        const arrayProperties = [
            { name: 'length', type: 'int', doc: 'The number of elements in the array' }
        ];

        for (const method of arrayMethods) {
            const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
            item.detail = `${method.name}${method.params}: ${method.returns}`;
            item.documentation = method.doc;
            item.insertText = new vscode.SnippetString(`${method.name}(\${1})`);
            items.push(item);
        }

        for (const prop of arrayProperties) {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            item.detail = `${prop.name}: ${prop.type}`;
            item.documentation = prop.doc;
            items.push(item);
        }
    }

    private addStringCompletions(items: vscode.CompletionItem[]): void {
        const stringMethods = [
            { name: 'substring', params: '(start: int, end: int)', returns: 'string', doc: 'Returns a substring from start to end (exclusive)' },
            { name: 'indexOf', params: '(searchValue: string)', returns: 'int', doc: 'Returns the index of the first occurrence of searchValue' },
            { name: 'replace', params: '(searchValue: string, replaceValue: string)', returns: 'string', doc: 'Returns a string with the first occurrence replaced' },
            { name: 'toUpperCase', params: '()', returns: 'string', doc: 'Returns the string converted to uppercase' },
            { name: 'toLowerCase', params: '()', returns: 'string', doc: 'Returns the string converted to lowercase' }
        ];

        const stringProperties = [
            { name: 'length', type: 'int', doc: 'The number of characters in the string' }
        ];

        for (const method of stringMethods) {
            const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
            item.detail = `${method.name}${method.params}: ${method.returns}`;
            item.documentation = method.doc;
            item.insertText = new vscode.SnippetString(`${method.name}(\${1})`);
            items.push(item);
        }

        for (const prop of stringProperties) {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            item.detail = `${prop.name}: ${prop.type}`;
            item.documentation = prop.doc;
            items.push(item);
        }
    }

    private addMapCompletions(items: vscode.CompletionItem[]): void {
        const mapMethods = [
            { name: 'set', params: '(key: K, value: V)', returns: 'void', doc: 'Sets the value for the specified key' },
            { name: 'get', params: '(key: K)', returns: 'V', doc: 'Returns the value for the specified key' },
            { name: 'has', params: '(key: K)', returns: 'bool', doc: 'Returns true if the key exists' },
            { name: 'delete', params: '(key: K)', returns: 'bool', doc: 'Removes the entry and returns true if it existed' },
            { name: 'clear', params: '()', returns: 'void', doc: 'Removes all entries from the map' },
            { name: 'keys', params: '()', returns: 'K[]', doc: 'Returns an array of all keys' },
            { name: 'values', params: '()', returns: 'V[]', doc: 'Returns an array of all values' },
            { name: 'forEach', params: '(callback: (value: V, key: K) => void)', returns: 'void', doc: 'Executes a function for each map entry' }
        ];

        const mapProperties = [
            { name: 'size', type: 'int', doc: 'The number of entries in the map' }
        ];

        for (const method of mapMethods) {
            const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
            item.detail = `${method.name}${method.params}: ${method.returns}`;
            item.documentation = method.doc;
            item.insertText = new vscode.SnippetString(`${method.name}(\${1})`);
            items.push(item);
        }

        for (const prop of mapProperties) {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            item.detail = `${prop.name}: ${prop.type}`;
            item.documentation = prop.doc;
            items.push(item);
        }
    }

    private addSetCompletions(items: vscode.CompletionItem[]): void {
        const setMethods = [
            { name: 'add', params: '(value: T)', returns: 'void', doc: 'Adds a value to the set' },
            { name: 'has', params: '(value: T)', returns: 'bool', doc: 'Returns true if the value exists' },
            { name: 'delete', params: '(value: T)', returns: 'bool', doc: 'Removes the value and returns true if it existed' },
            { name: 'clear', params: '()', returns: 'void', doc: 'Removes all values from the set' },
            { name: 'values', params: '()', returns: 'T[]', doc: 'Returns an array of all values' },
            { name: 'forEach', params: '(callback: (value: T) => void)', returns: 'void', doc: 'Executes a function for each set value' }
        ];

        const setProperties = [
            { name: 'size', type: 'int', doc: 'The number of values in the set' }
        ];

        for (const method of setMethods) {
            const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
            item.detail = `${method.name}${method.params}: ${method.returns}`;
            item.documentation = method.doc;
            item.insertText = new vscode.SnippetString(`${method.name}(\${1})`);
            items.push(item);
        }

        for (const prop of setProperties) {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            item.detail = `${prop.name}: ${prop.type}`;
            item.documentation = prop.doc;
            items.push(item);
        }
    }

    private addGenericMemberCompletions(items: vscode.CompletionItem[]): void {
        const commonMethods = ['toString', 'equals', 'hashCode'];
        for (const method of commonMethods) {
            const item = new vscode.CompletionItem(method, vscode.CompletionItemKind.Method);
            item.detail = `${method}()`;
            items.push(item);
        }
    }

    private getObjectTypeFromAST(objectName: string, ast: Program, position: vscode.Position): string | null {
        let foundType: string | null = null;

        this.walkAST(ast, (node) => {
            if (node.kind === 'variable') {
                const varDecl = node as VariableDeclaration;
                if (varDecl.identifier.name === objectName) {
                    if (varDecl.type) {
                        foundType = this.typeToString(varDecl.type);
                    } else if (varDecl.initializer) {
                        foundType = this.inferTypeFromInitializer(varDecl.initializer);
                    }
                }
            }
        });

        return foundType;
    }

    private walkAST(node: ASTNode, callback: (node: ASTNode) => void): void {
        callback(node);

        if (node.kind === 'program') {
            const program = node as Program;
            program.body.forEach(stmt => this.walkAST(stmt, callback));
        } else if (node.kind === 'class') {
            const cls = node as ClassDeclaration;
            cls.fields.forEach(field => this.walkAST(field, callback));
            cls.methods.forEach(method => this.walkAST(method, callback));
        } else if (node.kind === 'function') {
            const func = node as FunctionDeclaration;
            if (func.body) {
                this.walkAST(func.body, callback);
            }
        } else if (node.kind === 'block') {
            const block = node as any;
            if (Array.isArray(block.statements)) {
                block.statements.forEach((stmt: ASTNode) => this.walkAST(stmt, callback));
            }
        } else if (node.kind === 'expression') {
            const exprStmt = node as any;
            if (exprStmt.expression) {
                this.walkAST(exprStmt.expression, callback);
            }
        }
    }

    private inferTypeFromInitializer(initializer: Expression): string | null {
        if (initializer.kind === 'array') {
            return 'Array';
        }
        if (initializer.kind === 'literal') {
            const literal = initializer as any;
            if (typeof literal.value === 'string') {
                return 'string';
            }
            if (typeof literal.value === 'number') {
                return 'int';
            }
            if (typeof literal.value === 'boolean') {
                return 'bool';
            }
        }
        return null;
    }

    private async addGeneralCompletions(items: vscode.CompletionItem[], document: vscode.TextDocument): Promise<void> {
        const { ast } = await this.languageService.processDocument(document);

        for (const keyword of DOMINO_KEYWORDS) {
            const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
            item.detail = 'Doof keyword';
            items.push(item);
        }

        for (const type of DOMINO_TYPES) {
            const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter);
            item.detail = 'Doof type';
            items.push(item);
        }

        for (const operator of DOMINO_OPERATORS) {
            const item = new vscode.CompletionItem(operator, vscode.CompletionItemKind.Operator);
            item.detail = 'Doof operator';
            items.push(item);
        }

        if (ast) {
            this.addSymbolCompletions(ast, items);
        }

        const printlnItem = new vscode.CompletionItem('println', vscode.CompletionItemKind.Function);
        printlnItem.detail = 'println(value): void';
        printlnItem.documentation = 'Prints any value followed by a newline';
        printlnItem.insertText = new vscode.SnippetString('println(${1:value});');
        items.push(printlnItem);
    }

    private addSymbolCompletions(ast: Program, items: vscode.CompletionItem[]): void {
        this.walkAST(ast, (node) => {
            if (node.kind === 'function') {
                const func = node as FunctionDeclaration;
                const item = new vscode.CompletionItem(func.name.name, vscode.CompletionItemKind.Function);
                item.detail = `function ${func.name.name}`;
                item.documentation = func.returnType ? `Returns: ${this.typeToString(func.returnType)}` : undefined;
                items.push(item);
            } else if (node.kind === 'class') {
                const cls = node as ClassDeclaration;
                const item = new vscode.CompletionItem(cls.name.name, vscode.CompletionItemKind.Class);
                item.detail = `class ${cls.name.name}`;
                items.push(item);
            } else if (node.kind === 'enum') {
                const enumDecl = node as EnumDeclaration;
                const item = new vscode.CompletionItem(enumDecl.name.name, vscode.CompletionItemKind.Enum);
                item.detail = `enum ${enumDecl.name.name}`;
                items.push(item);
            } else if (node.kind === 'variable') {
                const varDecl = node as VariableDeclaration;
                const item = new vscode.CompletionItem(varDecl.identifier.name, vscode.CompletionItemKind.Variable);
                item.detail = `${varDecl.isConst ? 'const' : 'let'} ${varDecl.identifier.name}`;
                if (varDecl.type) {
                    item.detail += `: ${this.typeToString(varDecl.type)}`;
                }
                items.push(item);
            }
        });
    }

    private typeToString(type: Type): string {
        switch (type.kind) {
            case 'primitive':
                return (type as any).type;
            case 'array':
                return `${this.typeToString((type as any).elementType)}[]`;
            case 'class':
                return (type as any).name;
            case 'map':
                return `Map<${this.typeToString((type as any).keyType)}, ${this.typeToString((type as any).valueType)}>`;
            case 'set':
                return `Set<${this.typeToString((type as any).elementType)}>`;
            default:
                return 'unknown';
        }
    }
}

export class DoofHoverProvider implements vscode.HoverProvider {
    constructor(private readonly languageService: DoofLanguageService) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return undefined;
        }

        const word = document.getText(range);
        const { ast } = await this.languageService.processDocument(document);

        if (ast) {
            const symbolInfo = this.findSymbolAtPosition(ast, position, word);
            if (symbolInfo) {
                return new vscode.Hover(symbolInfo, range);
            }
        }

        const hoverInfo = this.getBasicHoverInfo(word);
        if (hoverInfo) {
            return new vscode.Hover(hoverInfo, range);
        }
        return undefined;
    }

    private findSymbolAtPosition(ast: Program, position: vscode.Position, word: string): vscode.MarkdownString | undefined {
        let symbolInfo: vscode.MarkdownString | undefined;

        this.walkAST(ast, (node) => {
            if (node.kind === 'functionDeclaration') {
                const func = node as FunctionDeclaration;
                if (func.name.name === word) {
                    symbolInfo = new vscode.MarkdownString();
                    symbolInfo.appendCodeblock(`function ${func.name.name}`, 'doof');
                    if (func.returnType) {
                        symbolInfo.appendMarkdown(`\n\n**Returns:** \`${this.typeToString(func.returnType)}\``);
                    }
                    if (func.parameters.length > 0) {
                        symbolInfo.appendMarkdown('\n\n**Parameters:**\n');
                        for (const param of func.parameters) {
                            symbolInfo!.appendMarkdown(`- \`${param.name.name}\`: \`${this.typeToString(param.type)}\`\n`);
                        }
                    }
                }
            } else if (node.kind === 'classDeclaration') {
                const cls = node as ClassDeclaration;
                if (cls.name.name === word) {
                    symbolInfo = new vscode.MarkdownString();
                    symbolInfo.appendCodeblock(`class ${cls.name.name}`, 'doof');
                    symbolInfo.appendMarkdown('\n\nReference type with shared_ptr semantics in C++.');
                }
            }
        });

        return symbolInfo;
    }

    private walkAST(node: ASTNode, callback: (node: ASTNode) => void): void {
        callback(node);

        if (node.kind === 'program') {
            const program = node as Program;
            program.body.forEach(stmt => this.walkAST(stmt, callback));
        } else if (node.kind === 'classDeclaration') {
            const cls = node as ClassDeclaration;
            cls.fields.forEach(field => this.walkAST(field, callback));
            cls.methods.forEach(method => this.walkAST(method, callback));
        } else if (node.kind === 'functionDeclaration') {
            const func = node as FunctionDeclaration;
            if (func.body) {
                this.walkAST(func.body, callback);
            }
        }
    }

    private typeToString(type: Type): string {
        switch (type.kind) {
            case 'primitive':
                return (type as any).type;
            case 'array':
                return `${this.typeToString((type as any).elementType)}[]`;
            case 'class':
                return (type as any).name;
            default:
                return 'unknown';
        }
    }

    private getBasicHoverInfo(word: string): vscode.MarkdownString | undefined {
        const hoverMap: Record<string, string> = {
            'class': 'Define a reference type with methods and fields. Objects are managed by shared_ptr in C++.',
            'struct': 'Define a value type with public fields only. Structs are stack-allocated in C++.',
            'enum': 'Define an enumeration with string or integer values.',
            'exception': 'Define an exception type that can be thrown and caught.',
            'extern': 'Declare an external C++ class interface.',
            'function': 'Define a function with explicit parameter and return types.',
            'let': 'Declare a mutable variable with optional type inference.',
            'const': 'Declare an immutable variable.',
            'weak': 'Declare a weak reference to avoid circular dependencies.',
            'static': 'Mark a field or method as belonging to the class rather than instances.',
            'private': 'Mark a field or method as private to the class.',
            'export': 'Make a symbol available to other modules.',
            'import': 'Import symbols from other modules.',
            'int': 'Signed 32-bit integer type.',
            'float': 'Single-precision floating-point type.',
            'double': 'Double-precision floating-point type.',
            'bool': 'Boolean type (true or false).',
            'char': 'Single character type.',
            'string': 'String type (maps to std::string in C++).',
            'void': 'No return value type.',
            'println': 'Built-in function to print values followed by newline.',
            '=>': 'Lambda arrow operator for creating anonymous functions.',
            '..': 'Inclusive range operator (e.g., 1..5 includes 5).',
            '..<': 'Exclusive range operator (e.g., 1..<5 excludes 5).',
            '\\': 'Truncating division operator (truncates toward zero).',
            '/': 'Floating-point division operator (always returns floating-point result).'
        };

        if (hoverMap[word]) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${word}** - ${hoverMap[word]}`);
            return markdown;
        }
        return undefined;
    }
}

export class DoofSemanticDiagnosticsProvider implements vscode.Disposable {
    private readonly diagnosticCollection: vscode.DiagnosticCollection;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly languageService: DoofLanguageService) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);

        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(document => this.scheduleDiagnostics(document)),
            vscode.workspace.onDidChangeTextDocument(event => this.scheduleDiagnostics(event.document)),
            vscode.workspace.onDidSaveTextDocument(document => this.scheduleDiagnostics(document)),
            vscode.workspace.onDidCloseTextDocument(document => {
                this.cancelScheduledDiagnostics(document.uri);
                this.clearDiagnostics(document.uri);
            })
        );
    }

    public async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== LANGUAGE_ID) {
            return;
        }

        const { errors } = await this.languageService.processDocument(document);
        const diagnostics: vscode.Diagnostic[] = [];

        for (const error of errors) {
            const range = this.locationToRange(error.location);
            const severity = this.getSeverity(error.message);
            const diagnostic = new vscode.Diagnostic(range, error.message, severity);
            diagnostic.source = LANGUAGE_ID;
            diagnostics.push(diagnostic);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    public clearDiagnostics(uri: vscode.Uri): void {
        this.cancelScheduledDiagnostics(uri);
        this.diagnosticCollection.delete(uri);
    }

    private locationToRange(location?: SourceLocation): vscode.Range {
        if (!location) {
            return new vscode.Range(0, 0, 0, 0);
        }

        const start = new vscode.Position(Math.max(0, location.start.line - 1), Math.max(0, location.start.column - 1));
        const end = new vscode.Position(Math.max(0, location.end.line - 1), Math.max(0, location.end.column - 1));
        return new vscode.Range(start, end);
    }

    private getSeverity(message: string): vscode.DiagnosticSeverity {
        const lowered = message.toLowerCase();
        if (lowered.includes('error') || lowered.includes('undefined') || lowered.includes('not found') || lowered.includes('missing')) {
            return vscode.DiagnosticSeverity.Error;
        }
        if (lowered.includes('warning') || lowered.includes('deprecated')) {
            return vscode.DiagnosticSeverity.Warning;
        }
        return vscode.DiagnosticSeverity.Information;
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const timeout of this.pendingUpdates.values()) {
            clearTimeout(timeout);
        }
        this.pendingUpdates.clear();
        this.diagnosticCollection.dispose();
    }

    public setDiagnosticsFromErrors(filePath: string, errors: Array<string | TranspilerError>): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const pattern = /^(.*?)(?::(\d+)(?::(\d+))?)?:\s*(.*)$/;

        for (const err of errors) {
            if (typeof err === 'string') {
                const match = pattern.exec(err.trim());
                if (match) {
                    const [, filename, lineStr, colStr, message] = match;
                    if (filename && path.resolve(filename) !== path.resolve(filePath) && path.basename(filename) !== path.basename(filePath)) {
                        continue;
                    }
                    const line = lineStr ? Math.max(0, parseInt(lineStr, 10) - 1) : 0;
                    const column = colStr ? Math.max(0, parseInt(colStr, 10) - 1) : 0;
                    const range = new vscode.Range(line, column, line, column + 1);
                    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
                    diagnostic.source = LANGUAGE_ID;
                    diagnostics.push(diagnostic);
                } else {
                    const range = new vscode.Range(0, 0, 0, 1);
                    const diagnostic = new vscode.Diagnostic(range, err, vscode.DiagnosticSeverity.Error);
                    diagnostic.source = LANGUAGE_ID;
                    diagnostics.push(diagnostic);
                }
            } else {
                const te = err;
                if (te.filename && path.resolve(te.filename) !== path.resolve(filePath) && path.basename(te.filename) !== path.basename(filePath)) {
                    continue;
                }
                const startLine = te.line ? Math.max(0, te.line - 1) : 0;
                const startCol = te.column ? Math.max(0, te.column - 1) : 0;
                const range = new vscode.Range(startLine, startCol, startLine, startCol + 1);
                const severity = te.severity === 'warning'
                    ? vscode.DiagnosticSeverity.Warning
                    : te.severity === 'info'
                        ? vscode.DiagnosticSeverity.Information
                        : vscode.DiagnosticSeverity.Error;
                const diagnostic = new vscode.Diagnostic(range, te.message, severity);
                diagnostic.source = LANGUAGE_ID;
                diagnostics.push(diagnostic);
            }
        }

        try {
            const uri = vscode.Uri.file(filePath);
            this.diagnosticCollection.set(uri, diagnostics);
        } catch (error) {
            console.error('Failed to set diagnostics:', error);
        }
    }

    private scheduleDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== LANGUAGE_ID) {
            return;
        }

        const key = document.uri.toString();
        const existing = this.pendingUpdates.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const handle = setTimeout(() => {
            this.pendingUpdates.delete(key);
            if (document.isClosed) {
                return;
            }
            void this.updateDiagnostics(document);
        }, 250);

        this.pendingUpdates.set(key, handle);
    }

    private cancelScheduledDiagnostics(uri: vscode.Uri): void {
        const key = uri.toString();
        const existing = this.pendingUpdates.get(key);
        if (existing) {
            clearTimeout(existing);
            this.pendingUpdates.delete(key);
        }
    }
}

export class DoofDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    constructor(private readonly languageService: DoofLanguageService) {}

    async provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const { ast } = await this.languageService.processDocument(document);
        if (!ast) {
            return symbols;
        }

        this.walkAST(ast, (node) => {
            if (!node.location) {
                return;
            }

            const range = this.locationToRange(node.location);
            const selectionRange = range;

            if (node.kind === 'classDeclaration') {
                const cls = node as ClassDeclaration;
                symbols.push(new vscode.DocumentSymbol(cls.name.name, 'class', vscode.SymbolKind.Class, range, selectionRange));
            } else if (node.kind === 'functionDeclaration') {
                const func = node as FunctionDeclaration;
                symbols.push(new vscode.DocumentSymbol(func.name.name, 'function', vscode.SymbolKind.Function, range, selectionRange));
            } else if (node.kind === 'enumDeclaration') {
                const enumDecl = node as EnumDeclaration;
                symbols.push(new vscode.DocumentSymbol(enumDecl.name.name, 'enum', vscode.SymbolKind.Enum, range, selectionRange));
            }
        });

        return symbols;
    }

    private walkAST(node: ASTNode, callback: (node: ASTNode) => void): void {
        callback(node);

        if (node.kind === 'program') {
            const program = node as Program;
            program.body.forEach(stmt => this.walkAST(stmt, callback));
        } else if (node.kind === 'classDeclaration') {
            const cls = node as ClassDeclaration;
            cls.fields.forEach(field => this.walkAST(field, callback));
            cls.methods.forEach(method => this.walkAST(method, callback));
        } else if (node.kind === 'functionDeclaration') {
            const func = node as FunctionDeclaration;
            if (func.body) {
                this.walkAST(func.body, callback);
            }
        }
    }

    private locationToRange(location: SourceLocation): vscode.Range {
        const start = new vscode.Position(Math.max(0, location.start.line - 1), Math.max(0, location.start.column - 1));
        const end = new vscode.Position(Math.max(0, location.end.line - 1), Math.max(0, location.end.column - 1));
        return new vscode.Range(start, end);
    }
}

export class DoofSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    static readonly legend = new vscode.SemanticTokensLegend(
        [
            'class', 'struct', 'enum', 'function', 'variable', 'property', 'parameter', 'type', 'keyword',
            'string', 'number', 'operator', 'comment', 'templateString', 'interpolationExpression'
        ],
        ['declaration', 'definition', 'static', 'readonly', 'interpolated']
    );

    constructor(private readonly languageService: DoofLanguageService) {}

    async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.SemanticTokens> {
        const builder = new vscode.SemanticTokensBuilder(DoofSemanticTokensProvider.legend);

        try {
            const lexer = new Lexer(document.getText(), document.uri.fsPath);
            const tokens = lexer.tokenize();
            this.processLexerTokens(tokens, builder, document);

            const { ast } = await this.languageService.processDocument(document);
            if (ast) {
                this.collectSemanticTokens(ast, builder);
            }
        } catch (error) {
            console.error('Error providing semantic tokens:', error);
        }

        return builder.build();
    }

    private processLexerTokens(tokens: Token[], builder: vscode.SemanticTokensBuilder, document: vscode.TextDocument): void {
        let isInInterpolation = false;

        for (const token of tokens) {
            if (!token.location) {
                continue;
            }

            const range = this.locationToRange(token.location);
            switch (token.type) {
                case TokenType.TEMPLATE_STRING:
                    builder.push(range, 'templateString', []);
                    break;
                case TokenType.STRING:
                    builder.push(range, 'string', []);
                    break;
                case TokenType.INTERPOLATION_START:
                    isInInterpolation = true;
                    builder.push(range, 'operator', ['interpolated']);
                    break;
                case TokenType.INTERPOLATION_END:
                    isInInterpolation = false;
                    builder.push(range, 'operator', ['interpolated']);
                    break;
                case TokenType.IDENTIFIER:
                    if (isInInterpolation) {
                        builder.push(range, 'variable', ['interpolated']);
                    }
                    break;
                case TokenType.NUMBER:
                    builder.push(range, 'number', isInInterpolation ? ['interpolated'] : []);
                    break;
                default:
                    if (isInInterpolation && this.isFunctionCallToken(token, tokens)) {
                        builder.push(range, 'function', ['interpolated']);
                    } else if (isInInterpolation && this.isOperatorToken(token)) {
                        builder.push(range, 'operator', ['interpolated']);
                    }
                    break;
            }
        }
    }

    private isFunctionCallToken(token: Token, allTokens: Token[]): boolean {
        const index = allTokens.indexOf(token);
        if (index === -1 || index >= allTokens.length - 1) {
            return false;
        }
        const next = allTokens[index + 1];
        return token.type === TokenType.IDENTIFIER && next.type === TokenType.LEFT_PAREN;
    }

    private isOperatorToken(token: Token): boolean {
        const operatorTypes = [
            TokenType.PLUS, TokenType.MINUS, TokenType.MULTIPLY, TokenType.DIVIDE,
            TokenType.DOT, TokenType.LEFT_PAREN, TokenType.RIGHT_PAREN
        ];
        return operatorTypes.includes(token.type);
    }

    private collectSemanticTokens(node: ASTNode, builder: vscode.SemanticTokensBuilder): void {
        if (!node.location) {
            return;
        }

        const range = this.locationToRange(node.location);
        switch (node.kind) {
            case 'class':
                builder.push(range, 'class', ['declaration']);
                (node as ClassDeclaration).fields.forEach(field => this.collectSemanticTokens(field, builder));
                (node as ClassDeclaration).methods.forEach(method => this.collectSemanticTokens(method, builder));
                break;
            case 'function':
                builder.push(range, 'function', ['declaration']);
                if ((node as FunctionDeclaration).body) {
                    this.collectSemanticTokens((node as FunctionDeclaration).body as ASTNode, builder);
                }
                break;
            case 'enum':
                builder.push(range, 'enum', ['declaration']);
                break;
            case 'field':
                builder.push(range, 'property', (node as FieldDeclaration).isStatic ? ['static'] : []);
                break;
            case 'method':
                builder.push(range, 'function', (node as MethodDeclaration).isStatic ? ['static'] : []);
                if ((node as MethodDeclaration).body) {
                    this.collectSemanticTokens((node as MethodDeclaration).body as ASTNode, builder);
                }
                break;
            case 'variable':
                builder.push(range, 'variable', (node as VariableDeclaration).isConst ? ['readonly'] : []);
                if ((node as VariableDeclaration).initializer) {
                    this.collectSemanticTokens((node as VariableDeclaration).initializer as ASTNode, builder);
                }
                break;
            case 'program':
                (node as Program).body.forEach(stmt => this.collectSemanticTokens(stmt, builder));
                break;
            default:
                break;
        }
    }

    private locationToRange(location: SourceLocation): vscode.Range {
        const start = new vscode.Position(Math.max(0, location.start.line - 1), Math.max(0, location.start.column - 1));
        const end = new vscode.Position(Math.max(0, location.end.line - 1), Math.max(0, location.end.column - 1));
        return new vscode.Range(start, end);
    }
}

export class DoofCodeActionsProvider implements vscode.CodeActionProvider {
    constructor(private readonly languageService: DoofLanguageService) {}

    async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === LANGUAGE_ID) {
                const action = this.createQuickFix(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
        }

        return actions;
    }

    private createQuickFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | undefined {
        const line = document.lineAt(diagnostic.range.start.line);
        const lineText = line.text;

        if (diagnostic.message.includes('type annotation')) {
            const action = new vscode.CodeAction('Add type annotation', vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];

            let suggestedType = 'any';
            if (lineText.includes('= []')) {
                suggestedType = 'any[]';
            } else if (lineText.includes('= ""') || lineText.includes("= ''")) {
                suggestedType = 'string';
            } else if (lineText.includes('= 0') || lineText.includes('= 1')) {
                suggestedType = 'int';
            } else if (lineText.includes('= true') || lineText.includes('= false')) {
                suggestedType = 'bool';
            }

            const edit = new vscode.WorkspaceEdit();
            const insertPosition = new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character);
            edit.insert(document.uri, insertPosition, `: ${suggestedType}`);
            action.edit = edit;

            return action;
        }

        if (diagnostic.message.includes('new operator')) {
            const action = new vscode.CodeAction('Replace with object literal', vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];

            const edit = new vscode.WorkspaceEdit();
            const newText = lineText.replace(/new\s+\w+\s*\(/g, '{');
            const replaced = newText.replace(/\)/, '}');
            edit.replace(document.uri, line.range, replaced);
            action.edit = edit;

            return action;
        }

        return undefined;
    }
}

export class DoofDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        formattingOptions: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        if (token.isCancellationRequested) {
            return [];
        }

        if (!formattingOptions.insertSpaces && !hasWarnedAboutTabIndent) {
            hasWarnedAboutTabIndent = true;
            void vscode.window.showWarningMessage(
                'The Doof formatter currently outputs spaces. Consider enabling "Indent Using Spaces" for best results.'
            );
        }

        let formatted: string;
        try {
            const formatterOptions = buildFormatterOptions(document, formattingOptions);
            formatted = formatDoofCode(document.getText(), formatterOptions);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Doof formatter failed: ${message}`);
            throw error;
        }

        if (token.isCancellationRequested || formatted === document.getText()) {
            return [];
        }

        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
}
