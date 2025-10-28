// Lambda capture and lifetime analysis for doof

import {
  ASTNode, Expression, LambdaExpression, TrailingLambdaExpression, Identifier, MemberExpression,
  Type, BlockStatement,
  CapturedBinding, CaptureInfo, ScopeTrackerEntry
} from '../types';
import { Validator } from './validator';
import { makeScopeId, registerScopeTrackerEntry } from './scope-tracker-helpers';

export class LambdaCaptureAnalyzer {
  private validator: Validator;
  private lambdaRootStack: ASTNode[] = [];

  constructor(validator: Validator) {
    this.validator = validator;
  }

  /**
   * Analyzes lambda captures and populates capture metadata
   */
  analyzeLambdaCaptures(expr: LambdaExpression, _expectedType?: Type): void {
    const capturedVariables: CapturedBinding[] = [];

    // Collect all locally declared variables within the lambda body
    const localVariables = new Set<string>();
    this.collectLocalVariables(expr.body, localVariables);

    // Analyze the lambda body for captured variables, excluding local variables
    const excludedNames = [...expr.parameters.map(p => p.name.name), ...localVariables];
    this.pushLambdaRoot(expr.body);
    try {
      this.analyzeCapturesInNode(expr.body, capturedVariables, excludedNames);
    } finally {
      this.popLambdaRoot();
    }

    // Store capture information
    expr.captureInfo = this.createCaptureInfo(capturedVariables);
  }

  /**
   * Analyzes trailing lambda captures
   */
  analyzeTrailingLambdaCaptures(expr: TrailingLambdaExpression, _expectedType?: Type): void {
    const capturedVariables: CapturedBinding[] = [];

    // Collect all locally declared variables within the lambda body
    const localVariables = new Set<string>();
    this.collectLocalVariables(expr.lambda.body, localVariables);

    // Get lambda parameter names to exclude from capture analysis
    const lambdaParameters = expr.lambda.parameters?.map(p => p.name.name) || [];
    const excludedNames = [...lambdaParameters, ...localVariables];

    // For trailing lambdas, we need to analyze the lambda body
    this.pushLambdaRoot(expr.lambda.body);
    try {
      this.analyzeCapturesInNode(expr.lambda.body, capturedVariables, excludedNames);
    } finally {
      this.popLambdaRoot();
    }

    // Store capture information in the expression
    expr.lambda.captureInfo = this.createCaptureInfo(capturedVariables);
  }

  /**
   * Collects all locally declared variables within a lambda body
   */
  private collectLocalVariables(node: ASTNode, localVariables: Set<string>): void {
    if (!node) return;

    switch (node.kind) {
      case 'variable':
        const varDecl = node as any; // VariableDeclaration
        localVariables.add(varDecl.identifier.name);
        // Also recursively check the initializer
        if (varDecl.initializer) {
          this.collectLocalVariables(varDecl.initializer, localVariables);
        }
        break;

      case 'for':
        const forStmt = node as any; // ForStatement
        if (forStmt.init && forStmt.init.kind === 'variable') {
          localVariables.add(forStmt.init.identifier.name);
        }
        if (forStmt.condition) this.collectLocalVariables(forStmt.condition, localVariables);
        if (forStmt.update) this.collectLocalVariables(forStmt.update, localVariables);
        this.collectLocalVariables(forStmt.body, localVariables);
        break;

      case 'forOf':
        const forOfStmt = node as any; // ForOfStatement
        localVariables.add(forOfStmt.variable.name);
        this.collectLocalVariables(forOfStmt.iterable, localVariables);
        this.collectLocalVariables(forOfStmt.body, localVariables);
        break;

      case 'block':
        const blockStmt = node as BlockStatement;
        for (const stmt of blockStmt.body) {
          this.collectLocalVariables(stmt, localVariables);
        }
        break;

      // Recursively check other node types
      default:
        // Use reflection to check all properties that might contain variable declarations
        for (const [key, value] of Object.entries(node)) {
          if (key === 'kind' || key === 'location' || key === 'inferredType') continue;

          if (value && typeof value === 'object') {
            if (Array.isArray(value)) {
              for (const item of value) {
                if (item && typeof item === 'object' && 'kind' in item) {
                  this.collectLocalVariables(item, localVariables);
                }
              }
            } else if ('kind' in value) {
              this.collectLocalVariables(value, localVariables);
            }
          }
        }
        break;
    }
  }

  /**
   * Recursively analyzes an AST node for captured variables
   */
  private analyzeCapturesInNode(node: ASTNode, capturedVariables: CapturedBinding[], lambdaParameters: string[]): void {
    if (!node) return;

    switch (node.kind) {
      case 'identifier':
        this.analyzeIdentifierCapture(node as Identifier, capturedVariables, lambdaParameters);
        break;

      case 'member':
        this.analyzeMemberCapture(node as MemberExpression, capturedVariables, lambdaParameters);
        break;

      case 'block':
        const blockStmt = node as BlockStatement;
        for (const stmt of blockStmt.body) {
          this.analyzeCapturesInNode(stmt, capturedVariables, lambdaParameters);
        }
        break;

      // Handle all expression and statement types
      case 'binary':
      case 'unary':
      case 'conditional':
      case 'call':
      case 'index':
      case 'array':
      case 'object':
      case 'pipe':
      case 'typeGuard':
        this.analyzeGenericNode(node, capturedVariables, lambdaParameters);
        break;

      // Handle statements
      case 'expression':
      case 'variable':
      case 'if':
      case 'while':
      case 'for':
      case 'forOf':
      case 'switch':
      case 'return':
        this.analyzeGenericNode(node, capturedVariables, lambdaParameters);
        break;
    }
  }

  /**
   * Analyzes identifier captures
   */
  private analyzeIdentifierCapture(identifier: Identifier, capturedVariables: CapturedBinding[], lambdaParameters: string[]): void {
    const name = identifier.name;
    const scopeTrackerEntry = this.getScopeTrackerEntry(identifier);

    // Skip lambda parameters
    if (lambdaParameters.includes(name)) {
      return;
    }

    // Skip if already captured
    if (capturedVariables.some(cv => cv.name === name)) {
      return;
    }

    // Global or imported functions are directly callable in C++ and do not require capture
    if (this.shouldSkipCaptureForFunction(identifier, scopeTrackerEntry)) {
      return;
    }

    // Check if it's 'this'
    if (name === 'this') {
      const scopeName = this.validator.getCurrentLambdaScopeName() ?? this.validator.context.currentClass?.name.name ?? 'instance';
      const scopeId = identifier.scopeInfo?.scopeId ?? makeScopeId('this', scopeName, identifier.location);
      const entry: ScopeTrackerEntry = {
        scopeId,
        name: 'this',
        kind: 'this',
        declarationScope: scopeName,
        declarationLocation: identifier.location,
        type: identifier.inferredType,
        isConstant: true,
        declaringClass: this.validator.context.currentClass?.name.name
      };
      registerScopeTrackerEntry(this.validator.context.codeGenHints.scopeTracker, entry);
      capturedVariables.push(this.createCapturedBinding(identifier, entry));
      return;
    }

    // Check scope tracker first for more reliable parameter detection
    if (scopeTrackerEntry) {
      capturedVariables.push(this.createCapturedBinding(identifier, scopeTrackerEntry));
      return;
    }

    // Fallback: Check scope information from resolved identifier
    const scopeInfo = identifier.scopeInfo;
    if (scopeInfo) {
      if (scopeInfo.scopeId && scopeInfo.scopeKind) {
        const entry: ScopeTrackerEntry = {
          scopeId: scopeInfo.scopeId,
          name: identifier.name,
          kind: scopeInfo.scopeKind,
          declarationScope: scopeInfo.declarationScope ?? 'global',
          declarationLocation: identifier.location,
          isConstant: scopeInfo.isParameter,
          declaringClass: scopeInfo.declaringClass,
          type: identifier.inferredType
        };
        registerScopeTrackerEntry(this.validator.context.codeGenHints.scopeTracker, entry);
        capturedVariables.push(this.createCapturedBinding(identifier, entry));
        return;
      }
    } else {
      // Fallback: check if it's in current symbols (local/parameter)
      if (this.validator.context.symbols.has(name)) {
        const entry = this.lookupFallbackEntry(identifier);
        if (entry) {
          capturedVariables.push(entry);
        }
      }
    }
  }

  /**
   * Analyzes member expression captures (e.g., obj.field)
   */
  private analyzeMemberCapture(member: MemberExpression, capturedVariables: CapturedBinding[], lambdaParameters: string[]): void {
    // First analyze the object being accessed
    this.analyzeCapturesInNode(member.object, capturedVariables, lambdaParameters);

    // If the property is computed, analyze the property expression too
    if (member.computed && member.property.kind !== 'literal') {
      this.analyzeCapturesInNode(member.property, capturedVariables, lambdaParameters);
    }
  }

  /**
   * Generic node analysis for expressions and statements
   */
  private analyzeGenericNode(node: ASTNode, capturedVariables: CapturedBinding[], lambdaParameters: string[]): void {
    // Use reflection to analyze all properties that are ASTNode or arrays of ASTNode
    for (const [key, value] of Object.entries(node)) {
      if (key === 'kind' || key === 'location' || key === 'inferredType') continue;

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && 'kind' in item) {
              this.analyzeCapturesInNode(item as ASTNode, capturedVariables, lambdaParameters);
            }
          }
        } else if ('kind' in value) {
          this.analyzeCapturesInNode(value as ASTNode, capturedVariables, lambdaParameters);
        }
      }
    }
  }

  /**
   * Determines whether a function-like identifier should be skipped for capture because
   * it refers to a global/imported function or method.
   */
  private shouldSkipCaptureForFunction(
    identifier: Identifier,
    scopeTrackerEntry?: ScopeTrackerEntry
  ): boolean {
    const name = identifier.name;

    if (identifier.scopeInfo?.isGlobalFunction) {
      return true;
    }

    if (this.validator.context.functions.has(name)) {
      return true;
    }

    const builtinSymbol = this.validator.context.symbols.get(name);
    if (builtinSymbol && builtinSymbol.kind === 'function' && !identifier.scopeInfo?.isLocalVariable && !identifier.scopeInfo?.isParameter) {
      return true;
    }

    if (identifier.scopeInfo?.isImported) {
      const importInfo = this.validator.context.imports.get(name);
      if (importInfo) {
        const exported = this.validator.context.globalSymbols.get(importInfo.fullyQualifiedName);
        if (exported?.type === 'function') {
          return true;
        }
      }
    }

    const scopeKind = scopeTrackerEntry?.kind;
    if ((scopeKind === 'global' || scopeKind === 'import' || identifier.scopeInfo?.isImported) &&
      identifier.inferredType &&
      identifier.inferredType.kind === 'function' &&
      !identifier.scopeInfo?.isLocalVariable &&
      !identifier.scopeInfo?.isParameter) {
      return true;
    }

    return false;
  }

  private createCaptureInfo(capturedVariables: CapturedBinding[]): CaptureInfo {
    const hasMutableCaptures = capturedVariables.some(capture => capture.writesInside);
    const includesThis = capturedVariables.some(capture => capture.variableKind === 'this');

    for (const capture of capturedVariables) {
      if (!capture.writesInside) {
        continue;
      }

      if (!capture.declarationScopeId) {
        continue;
      }

      const isLocalOrParameter = capture.variableKind === 'local' || capture.variableKind === 'parameter';
      if (!isLocalOrParameter) {
        continue;
      }

      this.validator.context.codeGenHints.capturedMutableScopes.add(capture.declarationScopeId);
    }
    return {
      capturedVariables,
      hasMutableCaptures,
      includesThis
    };
  }

  private createCapturedBinding(identifier: Identifier, entry: ScopeTrackerEntry): CapturedBinding {
    const existing = this.validator.context.codeGenHints.scopeTracker.get(entry.scopeId);
    const effectiveEntry = existing ?? entry;
    if (!existing) {
      registerScopeTrackerEntry(this.validator.context.codeGenHints.scopeTracker, entry);
    }
    const type = effectiveEntry.type || identifier.inferredType || { kind: 'unknown' } as Type;
    const writesInside = this.isWriteTarget(identifier);
    const readsInside = true;

    const variableKind = this.normalizeVariableKind(effectiveEntry.kind);

    return {
      name: identifier.name,
      declarationScopeId: entry.scopeId,
      variableKind,
      type,
      sourceLocation: identifier.location,
      declarationLocation: effectiveEntry.declarationLocation,
      declaringClass: effectiveEntry.declaringClass,
      writesInside,
      readsInside
    };
  }

  private lookupFallbackEntry(identifier: Identifier): CapturedBinding | undefined {
    const name = identifier.name;
    const symbolType = identifier.inferredType || this.validator.context.symbols.get(name);
    if (!symbolType) {
      return undefined;
    }
    const scopeName = this.validator.getCurrentLambdaScopeName() ?? this.validator.context.currentFunction?.name?.name ?? 'global';
    const scopeId = makeScopeId(name, scopeName, identifier.location);
    const isParam = this.validator.isLambdaParameter(name);
    const entry: ScopeTrackerEntry = {
      scopeId,
      name,
      kind: isParam ? 'parameter' : 'local',
      declarationScope: scopeName,
      declarationLocation: identifier.location,
      type: symbolType,
      isConstant: isParam,
      declaringClass: this.validator.context.currentClass?.name.name
    };
    return this.createCapturedBinding(identifier, entry);
  }

  private getScopeTrackerEntry(identifier: Identifier): ScopeTrackerEntry | undefined {
    const scopeId = identifier.scopeInfo?.scopeId;
    if (scopeId) {
      return this.validator.context.codeGenHints.scopeTracker.get(scopeId);
    }
    const scopeName = this.validator.getCurrentLambdaScopeName();
    let fallback: ScopeTrackerEntry | undefined;
    for (const entry of this.validator.context.codeGenHints.scopeTracker.values()) {
      if (entry.name !== identifier.name) {
        continue;
      }
      if (scopeName && entry.declarationScope === scopeName) {
        return entry;
      }
      if (!fallback && (entry.kind === 'local' || entry.kind === 'parameter' || entry.kind === 'field')) {
        fallback = entry;
      } else if (!fallback) {
        fallback = entry;
      }
    }
    return fallback;
  }

  private normalizeVariableKind(kind: ScopeTrackerEntry['kind']): CapturedBinding['variableKind'] {
    switch (kind) {
      case 'parameter':
      case 'local':
      case 'field':
      case 'global':
      case 'this':
        return kind;
      case 'method':
      case 'import':
        return 'global';
      default:
        return 'local';
    }
  }

  private isWriteTarget(identifier: Identifier): boolean {
    const parent = this.findParentNode(identifier, this.currentLambdaRoot);
    if (!parent) {
      return false;
    }

    if (parent.kind === 'binary') {
      const binary = parent as any;
      if (binary.left === identifier && ['=', '+=', '-=', '*=', '/=', '%='].includes(binary.operator)) {
        return true;
      }
    }

    if (parent.kind === 'unary') {
      const unary = parent as any;
      if (unary.operand === identifier && ['++', '--', '++_post', '--_post'].includes(unary.operator)) {
        return true;
      }
    }

    return false;
  }

  private findParentNode(target: ASTNode, root?: ASTNode): ASTNode | undefined {
    if (!root) {
      return undefined;
    }
    const stack: ASTNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          if (Array.isArray(value)) {
            for (const child of value) {
              if (child === target) {
                return node;
              }
              if (child && typeof child === 'object' && 'kind' in child) {
                stack.push(child as ASTNode);
              }
            }
          } else if ((value as ASTNode) === target) {
            return node;
          } else if ('kind' in value) {
            stack.push(value as ASTNode);
          }
        }
      }
    }
    return undefined;
  }

  private get currentLambdaRoot(): ASTNode | undefined {
    if (this.lambdaRootStack.length === 0) {
      return undefined;
    }
    return this.lambdaRootStack[this.lambdaRootStack.length - 1];
  }

  private pushLambdaRoot(node: ASTNode): void {
    this.lambdaRootStack.push(node);
  }

  private popLambdaRoot(): void {
    this.lambdaRootStack.pop();
  }
}
