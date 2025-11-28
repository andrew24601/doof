// C++ code generator for doof

import {
  Program, Statement, Expression, Type, ClassDeclaration, ExternClassDeclaration,
  EnumDeclaration, TypeAliasDeclaration, FunctionDeclaration, VariableDeclaration, Parameter,
  FieldDeclaration, MethodDeclaration, EnumMember,
  IfStatement, WhileStatement, ForStatement, ForOfStatement, SwitchStatement,
  SwitchCase, ReturnStatement,
  BlockStatement, ExpressionStatement, ImportDeclaration, ExportDeclaration,
  Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression, CallExpression,
  MemberExpression, IndexExpression, ArrayExpression, ObjectExpression, PositionalObjectExpression, SetExpression, ObjectProperty,
  LambdaExpression, RangeExpression, EnumShorthandMemberExpression, TrailingLambdaExpression, TypeGuardExpression, InterpolatedString, PrimitiveTypeNode,
  ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, ExternClassTypeNode, EnumTypeNode, FunctionTypeNode, UnionTypeNode,
  ValidationContext, GlobalValidationContext,
  NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression,
  CaptureInfo, CapturedBinding, ScopeTrackerEntry, SourceLocation, ASTNode
} from '../types';
import { ICodeGenerator, GeneratorOptions, GeneratorResult } from '../codegen-interface';
import { CppTypeCodegen } from './cpp/cpp-type-codegen';
import { 
  generateExpression, 
  generateExpressionWithContext 
} from './cpp/cpp-expression-codegen';
import { 
  generateStatement, 
  generateBlockStatement, 
  generateVariableDeclaration
} from './cpp/cpp-statement-codegen';
import {
  generateClassDeclarationHeader,
  generateClassDeclarationSource,
  generateToJSONMethodSource,
  generateFromJSONMethodSource,
  generateOperatorOverloadSource,
  generateFieldDeserialization
} from './cpp/cpp-class-decl-codegen';
import {
  generateFunctionDeclarationHeader,
  generateFunctionDeclarationSource,
  generateMethodDeclarationHeader,
  generateMethodDeclarationSource,
  generateStaticMethodDeclarationSource
} from './cpp/cpp-function-decl-codegen';
import {
  generateEnumDeclaration
} from './cpp/cpp-enum-decl-codegen';
import {
  generateTypeAliasDeclaration
} from './cpp/cpp-type-alias-codegen';
import {
  shouldIncludeInHeader,
  collectForwardDeclarations,
  collectFluentInterfaceClasses,
  generateForwardDeclarations,
  generateMainWrapper,
  generateHeaderGuard,
  wrapWithNamespace,
  CodeOrganizationContext
} from './cpp/cpp-code-organization';
import {
  formatParameterList,
  getMemberPropertyName,
  isRuntimeSymbol,
  encodeCppFieldName,
  getCppFieldName,
  getQualifiedClassName,
  getHeaderNameFromFilePath,
  CppGeneratorContext
} from './cpp/cpp-utility-functions';
import { classUsesThisAsValue } from '../fluent-interface-utils';

export class CppGenerator implements ICodeGenerator {
  public options: GeneratorOptions;
  public typeGen = new CppTypeCodegen();

  // State properties moved directly into CppGenerator
  private indentLevel: number = 0;
  private forwardDeclarations: Set<string> = new Set();
  private fluentInterfaceClasses: Set<string> = new Set();
  public currentClass?: ClassDeclaration;
  public currentMethod?: MethodDeclaration;
  private runtimeNamespaces: Map<string, string> = new Map();
  public currentScope: 'global' | 'function' | 'method' = 'global';
  private isInOutputContext: boolean = false;
  public isGeneratingHeader: boolean = false;
  public variableTypes: Map<string, Type> = new Map();
  public currentFunctionReturnType?: Type;
  public functionSignatures: Map<string, FunctionDeclaration> = new Map();
  public validationContext?: ValidationContext;
  private _globalContext?: GlobalValidationContext;
  public typeNarrowingContext: Map<string, Type> = new Map();
  private _sourceFilePath?: string;
  private _lastLinePragma?: { file?: string; line?: number };

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      includeHeaders: ['<iostream>', '<string>', '<vector>', '<array>', '<unordered_map>', '<map>', '<unordered_set>', '<memory>', '<cmath>', '<chrono>', '<filesystem>', '<fstream>', '<algorithm>', '<sstream>', '<fstream>'],
      outputHeader: true,
      outputSource: true,
      ...options
    };

    this.initializeRuntimeNamespaces();

    // Set up qualified name resolver for type generator
    this.typeGen.setQualifiedNameResolver((className: string) => this.getQualifiedClassName(className));
  }

  private initializeRuntimeNamespaces(): void {
    // Map doof runtime objects to C++ namespaces/libraries
    this.runtimeNamespaces.set('Math', 'std');
    this.runtimeNamespaces.set('fs', 'std::filesystem');
    this.runtimeNamespaces.set('Console', 'std'); // For future console operations
    this.runtimeNamespaces.set('String', 'std');  // For future string utilities
    // Add more runtime namespaces as needed
  }

  // Global context getter
  get globalContext(): GlobalValidationContext | undefined {
    return this._globalContext;
  }

  // Delegate to type generator
  generateType(type: Type): string {
    return this.typeGen.generateType(type);
  }

  // Expression generation delegation
  generateExpression(expr: Expression, targetType?: Type): string {
    return generateExpression(this, expr, { targetType });
  }

  generateExpressionWithContext(expr: Expression, context?: { targetType?: Type, isReturnContext?: boolean, isAssignmentRhs?: boolean }): string {
    return generateExpressionWithContext(this, expr, context);
  }

  // Expose block statement generation so expression generator (now functional) can call it without creating import cycles
  public generateBlockStatement(block: BlockStatement): string {
    return generateBlockStatement(this, block);
  }

  public getVariableType(varDecl: VariableDeclaration): Type {
    if (varDecl.type) {
      return varDecl.type;
    }
    // If no explicit type, try to infer from initializer
    if (varDecl.initializer) {
      return varDecl.initializer.inferredType || { kind: 'unknown' };
    }
    return { kind: 'unknown' };
  }

  public canUseConstexpr(type: Type, defaultValue?: Expression): boolean {
    // Only allow constexpr for primitive types that can be compile-time constants
    if (type.kind !== 'primitive') return false;
    if (!defaultValue || defaultValue.kind !== 'literal') return false;
    
    const primType = type as PrimitiveTypeNode;
    // String types cannot be constexpr in class definitions - they must be static const
    if (primType.type === 'string') return false;
    
    return true;
  }

  public generateDefaultInitializer(type: Type): string {
    switch (type.kind) {
      case 'primitive':
        const primType = type as PrimitiveTypeNode;
        switch (primType.type) {
          case 'int':
          case 'float':
          case 'double':
            return '0';
          case 'string': return '""';
          case 'bool': return 'false';
          case 'char': return "'\\0'";
          default: return 'nullptr';
        }
      case 'array':
      case 'map':
      case 'set':
        // These are all shared_ptr types now
        return 'nullptr';
      case 'class':
        const classType = type as ClassTypeNode;
        if (classType.isWeak) {
          return `${this.generateType(type)}()`;
        }
        return 'nullptr';
      case 'externClass':
        const externType = type as ExternClassTypeNode;
        if (externType.isWeak) {
          return `${this.generateType(type)}()`;
        }
        return 'nullptr';
      default:
        return 'nullptr';
    }
  }

  public withTypeNarrowing<T>(narrowingMap: Map<string, Type>, callback: () => T): T {
    // Save current context
    const savedContext = new Map(this.typeNarrowingContext);
    
    // Apply narrowing
    for (const [varName, narrowedType] of narrowingMap) {
      this.typeNarrowingContext.set(varName, narrowedType);
    }
    
    try {
      return callback();
    } finally {
      // Restore context - clear and repopulate to maintain reference
      this.typeNarrowingContext.clear();
      for (const [varName, type] of savedContext) {
        this.typeNarrowingContext.set(varName, type);
      }
    }
  }

  // Allow adding custom runtime namespace mappings
  addRuntimeNamespace(doofName: string, cppNamespace: string): void {
    this.runtimeNamespaces.set(doofName, cppNamespace);
  }

  // Reset all state to initial values
  private reset(): void {
    this.indentLevel = 0;
    this.forwardDeclarations.clear();
    this.fluentInterfaceClasses.clear();
    this.currentClass = undefined;
    this.currentMethod = undefined;
    this.currentScope = 'global';
    this.isInOutputContext = false;
    this.isGeneratingHeader = false;
    this.variableTypes.clear();
    this.currentFunctionReturnType = undefined;
  this.functionSignatures.clear();
    this.validationContext = undefined;
    this._globalContext = undefined;
    this.typeNarrowingContext.clear();
    this._lastLinePragma = undefined;
    // Note: We don't clear runtimeNamespaces as they're static mappings
  }

  // Set validation context for current generation
  private setValidationContext(validationContext?: ValidationContext, globalContext?: GlobalValidationContext): void {
    this.validationContext = validationContext;
    this._globalContext = globalContext;
  }

  private getScopeIdForIdentifier(identifier: Identifier): string | undefined {
    const fromScopeInfo = identifier.scopeInfo?.scopeId;
    if (fromScopeInfo) {
      return fromScopeInfo;
    }

    const tracker = this.validationContext?.codeGenHints.scopeTracker;
    if (!tracker) {
      return undefined;
    }

    for (const entry of tracker.values()) {
      if (entry.name !== identifier.name) {
        continue;
      }

      if (entry.declarationLocation && this.locationsEqual(entry.declarationLocation, identifier.location)) {
        return entry.scopeId;
      }
    }

    return undefined;
  }

  private getScopeIdForVariable(varDecl: VariableDeclaration): string | undefined {
    const idScope = this.getScopeIdForIdentifier(varDecl.identifier);
    if (idScope) {
      return idScope;
    }

    const tracker = this.validationContext?.codeGenHints.scopeTracker;
    if (!tracker) {
      return undefined;
    }

    for (const entry of tracker.values()) {
      if (entry.name !== varDecl.identifier.name) {
        continue;
      }

      if (entry.declarationLocation && this.locationsEqual(entry.declarationLocation, varDecl.location)) {
        return entry.scopeId;
      }
    }

    return undefined;
  }

  private locationsEqual(a?: SourceLocation, b?: SourceLocation): boolean {
    if (!a || !b) {
      return false;
    }

    const sameFile = !a.filename || !b.filename || a.filename === b.filename;
    return sameFile &&
      a.start.line === b.start.line &&
      a.start.column === b.start.column &&
      a.end.line === b.end.line &&
      a.end.column === b.end.column;
  }

  public shouldWrapCapturedMutable(varDecl: VariableDeclaration): boolean {
    if (varDecl.isConst) {
      return false;
    }

    const scopeId = this.getScopeIdForVariable(varDecl);
    if (!scopeId) {
      return false;
    }

    const capturedMutableScopes = this.validationContext?.codeGenHints.capturedMutableScopes;
    if (!capturedMutableScopes) {
      return false;
    }

    return capturedMutableScopes.has(scopeId);
  }

  private getScopeIdForParameter(param: Parameter): string | undefined {
    const scopeTracker = this.validationContext?.codeGenHints.scopeTracker;
    if (!scopeTracker) {
      return undefined;
    }

    for (const [, entry] of scopeTracker.entries()) {
      if (entry.kind !== 'parameter') {
        continue;
      }
      if (entry.name !== param.name.name) {
        continue;
      }
      if (entry.declarationLocation && !this.locationsEqual(entry.declarationLocation, param.location)) {
        continue;
      }
      return entry.scopeId;
    }

    return undefined;
  }

  public shouldWrapCapturedMutableParameter(param: Parameter): boolean {
    const scopeId = this.getScopeIdForParameter(param);
    if (!scopeId) {
      return false;
    }

    const capturedMutableScopes = this.validationContext?.codeGenHints.capturedMutableScopes;
    if (!capturedMutableScopes) {
      return false;
    }

    return capturedMutableScopes.has(scopeId);
  }

  public renderCapturedType(type: Type): string {
    const baseType = this.generateType(type);
    return `doof_runtime::Captured<${baseType}>`;
  }

  public isCapturedMutableIdentifier(identifier: Identifier): boolean {
    const scopeId = this.getScopeIdForIdentifier(identifier);
    if (!scopeId) {
      return false;
    }

    const capturedMutableScopes = this.validationContext?.codeGenHints.capturedMutableScopes;
    if (!capturedMutableScopes) {
      return false;
    }

    return capturedMutableScopes.has(scopeId);
  }

  private generateHeaderIncludesSection(program: Program, defaultIncludes: string[]): string {
    const lines: string[] = [];

    const uniqueDefaults = Array.from(new Set(defaultIncludes));
    uniqueDefaults.sort();
    for (const header of uniqueDefaults) {
      lines.push(`#include ${header}`);
    }

    const externHeaders = new Set<string>();
    const dependencyNames = new Set<string>();
    const externDeclarations = new Map<string, ExternClassDeclaration>();

    if (this.validationContext) {
      const externDeps = this.validationContext.codeGenHints.externDependencies;
      if (externDeps) {
        for (const name of externDeps) {
          dependencyNames.add(name);
        }
      }

      for (const [name, decl] of this.validationContext.externClasses) {
        dependencyNames.add(name);
        externDeclarations.set(name, decl);
      }
    }

    for (const stmt of program.body) {
      if (stmt.kind === 'externClass') {
        dependencyNames.add(stmt.name.name);
        externDeclarations.set(stmt.name.name, stmt);
      }
    }

    const sortedDependencyNames = Array.from(dependencyNames).sort();
    for (const name of sortedDependencyNames) {
      if (name === 'StringBuilder') {
        continue;
      }
      const decl = externDeclarations.get(name);
      const headerName = decl?.header || `${name}.h`;
      externHeaders.add(`"${headerName}"`);
    }

    const sortedExternHeaders = Array.from(externHeaders).sort();
    for (const header of sortedExternHeaders) {
      lines.push(`#include ${header}`);
    }

    lines.push(`#include "doof_runtime.h"`);

    if (this.validationContext?.imports) {
      const includedModules = new Set<string>();
      for (const [, importInfo] of this.validationContext.imports) {
        if (!includedModules.has(importInfo.sourceFile)) {
          const headerName = getHeaderNameFromFilePath(importInfo.sourceFile);
          lines.push(`#include "${headerName}"`);
          includedModules.add(importInfo.sourceFile);
        }
      }
    }

    return lines.map(line => `${line}\n`).join('');
  }

  generate(program: Program, filename: string = 'output', validationContext?: ValidationContext, globalContext?: GlobalValidationContext, sourceFilePath?: string): GeneratorResult {
    this.reset();
    this.setValidationContext(validationContext, globalContext);
    this._sourceFilePath = sourceFilePath;

    const codeOrgContext: CodeOrganizationContext = {
      forwardDeclarations: this.forwardDeclarations,
      fluentInterfaceClasses: this.fluentInterfaceClasses,
      options: this.options
    };

    const header = this.generateHeader(program, filename, codeOrgContext);
    const source = this.generateSource(program, filename);

    return { header, source };
  }

  // Emit a #line directive if enabled and the location differs from the last one
  public maybeEmitLineDirective(node: ASTNode | { location?: any }): string {
    if (!this.options.emitLineDirectives) return '';
    if (this.isGeneratingHeader) return '';
    const loc = (node as any)?.location;
    if (!loc || !loc.start || typeof loc.start.line !== 'number') return '';
    const file = loc.filename || this._sourceFilePath;
    const line = loc.start.line;
    if (!file || !line) return '';
    if (this._lastLinePragma && this._lastLinePragma.file === file && this._lastLinePragma.line === line) {
      return '';
    }
    this._lastLinePragma = { file, line };
    // Preprocessor directives should start at column 0
    return `#line ${line} \"${file}\"\n`;
  }

  private generateHeader(program: Program, filename: string, codeOrgContext: CodeOrganizationContext): string {
    this.isGeneratingHeader = true;  // Set flag for header generation

    let output = '';

    // Generate includes section
  output += this.generateHeaderIncludesSection(program, this.options.includeHeaders || []);
    output += '\n';

    // Collect forward declarations and fluent interface classes
    collectForwardDeclarations(codeOrgContext, program);
    collectFluentInterfaceClasses(codeOrgContext, program);

    // Add forward declarations
    output += generateForwardDeclarations(codeOrgContext);

    // Generate declarations in namespace if specified
    let declarationsContent = '';
    for (const stmt of program.body) {
      if (shouldIncludeInHeader(stmt)) {
        declarationsContent += this.generateStatementHeader(stmt);
        declarationsContent += '\n';
      }
    }

    // Wrap with namespace if specified
    if (this.options.namespace) {
      declarationsContent = wrapWithNamespace(declarationsContent, this.options.namespace, 0);
    }

    output += declarationsContent;

    // Generate header guard
    output = generateHeaderGuard(filename, output);

    this.isGeneratingHeader = false;  // Clear flag after header generation
    return output;
  }

  private generateSource(program: Program, filename: string): string {
    let output = `#include "${filename}.h"\n`;

    // Always include runtime header for helper functions
    output += `#include "doof_runtime.h"\n`;

    output += '\n';

    // Generate implementations in namespace if specified
    let implementationsContent = '';
    for (const stmt of program.body) {
      const pragma = this.maybeEmitLineDirective(stmt as any);
      const impl = this.generateStatementSource(stmt);
      if (impl) {
        implementationsContent += pragma + impl;
        implementationsContent += '\n';
      }
    }

    // Wrap with namespace if specified
    if (this.options.namespace) {
      implementationsContent = wrapWithNamespace(implementationsContent, this.options.namespace, 0);
    }

    output += implementationsContent;

    // Generate C++ main wrapper if a main function exists
    const mainWrapper = generateMainWrapper(program, this.options);
    if (mainWrapper) {
      output += '\n' + mainWrapper;
    }

    return output;
  }

  private generateStatementHeader(stmt: Statement): string {
    switch (stmt.kind) {
      case 'class':
        return this.generateClassDeclarationHeader(stmt);
      case 'enum':
        return generateEnumDeclaration(this, stmt);
      case 'typeAlias':
        return generateTypeAliasDeclaration(this, stmt);
      case 'function':
        return generateFunctionDeclarationHeader(this, stmt);
      case 'export':
        return this.generateStatementHeader(stmt.declaration);
      default:
        return '';
    }
  }

  private generateStatementSource(stmt: Statement): string {
    
    switch (stmt.kind) {
      case 'class':
        return generateClassDeclarationSource(this, stmt);
      case 'typeAlias':
        return ''; // Type aliases don't generate source code
      case 'function':
        return generateFunctionDeclarationSource(this, stmt);
      case 'variable':
        return generateVariableDeclaration(this, stmt, true);
      case 'export':
        return this.generateStatementSource(stmt.declaration);
      case 'expression':
        return this.generateExpression(stmt.expression) + ';\n';
      case 'if':
      case 'while':
      case 'for':
      case 'forOf':
      case 'switch':
      case 'return':
      case 'break':
      case 'continue':
      case 'block':
        return generateStatement(this, stmt);
      case 'markdownHeader':
      case 'markdownTable':
        return generateStatement(this, stmt);
      default:
        return '';
    }
  }

  private generateClassDeclarationHeader(classDecl: ClassDeclaration): string {
    return generateClassDeclarationHeader(this, classDecl);
  }

  // Indentation management
  indent(): string {
    return '    '.repeat(this.indentLevel);
  }

  public increaseIndent(): void {
    this.indentLevel++;
  }

  public decreaseIndent(): void {
    this.indentLevel--;
  }

  // Helper method to format parameter lists
  formatParameterList(parameters: Parameter[], includeDefaults: boolean = false): string {
    const context: CppGeneratorContext = {
      getExternClass: (name: string) => this.getExternClassDeclaration(name),
      validationContext: this.validationContext,
      globalContext: this.globalContext,
      generateType: (type: Type) => this.generateType(type),
      generateExpression: (expr: any) => this.generateExpression(expr)
    };
    return formatParameterList(parameters, context, includeDefaults);
  }

  // Helper method to generate class member sections
  generateMemberSection(fields: FieldDeclaration[], methods: MethodDeclaration[],
    isPublic: boolean, isStatic: boolean): string {
    let output = '';

    // Fields
    const filteredFields = fields.filter(f => f.isPublic === isPublic && f.isStatic === isStatic);
    for (const field of filteredFields) {
      const staticPrefix = isStatic ? 'static ' : '';
      output += this.indent() + `${staticPrefix}${this.typeGen.generateType(field.type)} ${field.name.name};\n`;
    }

    // Methods
    const filteredMethods = methods.filter(m => m.isPublic === isPublic && m.isStatic === isStatic);
    for (const method of filteredMethods) {
      if (isStatic) {
        output += this.indent() + 'static ' + generateMethodDeclarationHeader(this, method, false);
      } else {
        output += generateMethodDeclarationHeader(this, method);
      }
    }

    return output;
  }

  // Helper method to get qualified class name for imports
  getQualifiedClassName(className: string): string {
    const context: CppGeneratorContext = {
      getExternClass: (name: string) => this.getExternClassDeclaration(name),
      validationContext: this.validationContext,
      globalContext: this.globalContext,
      generateType: (type: Type) => this.generateType(type),
      generateExpression: (expr: any) => this.generateExpression(expr)
    };
    return getQualifiedClassName(className, context);
  }

  public getClassDeclaration(name: string): ClassDeclaration | undefined {
    const fromValidation = this.validationContext?.classes.get(name);
    if (fromValidation) {
      return fromValidation;
    }

    const importInfo = this.validationContext?.imports.get(name);
    const globalContext = this.globalContext;
    if (!importInfo || !globalContext) {
      return undefined;
    }

    const sourceAst = globalContext.files.get(importInfo.sourceFile)
      ?? globalContext.files.get(importInfo.sourceModule)
      ?? globalContext.files.get(`${importInfo.sourceModule}.do`);
    if (!sourceAst) {
      return undefined;
    }

    for (const stmt of sourceAst.body) {
      if (stmt.kind === 'class' && stmt.name.name === importInfo.importedName) {
        return stmt;
      }
    }

    return undefined;
  }

  public getExternClassDeclaration(name: string): ExternClassDeclaration | undefined {
    const fromValidation = this.validationContext?.externClasses.get(name);
    if (fromValidation) {
      return fromValidation;
    }

    const importInfo = this.validationContext?.imports.get(name);
    const globalContext = this.globalContext;
    if (!importInfo || !globalContext) {
      return undefined;
    }

    const sourceAst = globalContext.files.get(importInfo.sourceFile)
      ?? globalContext.files.get(importInfo.sourceModule)
      ?? globalContext.files.get(`${importInfo.sourceModule}.do`);
    if (!sourceAst) {
      return undefined;
    }

    for (const stmt of sourceAst.body) {
      if (stmt.kind === 'externClass' && stmt.name.name === importInfo.importedName) {
        return stmt;
      }
    }

    return undefined;
  }

}
