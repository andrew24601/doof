// Type checker and validator for doof AST

import {
  ASTNode, Program, Statement, Expression, Type, ValidationContext, GlobalValidationContext, ValidationError,
  SourceLocation, TypeSymbolTable, ImportInfo, TypeParameter
} from '../types';
import { DefiniteAssignmentAnalyzer } from './definite-assignment';
import { resolveImports, validateProgram } from './statement-validator';
import { initializeBuiltinMappings, initializeBuiltins, initializeIntrinsics } from './intrinsics-validator';
import { buildGlobalSymbolTable, collectDeclarations, importGlobalSymbols } from './declaration-validator';

// Types for intrinsic registry entries
export type IntrinsicOverload = {
  paramTypes: Type[];
  returnType: (argTypes: Type[]) => Type;
  cppMapping: string;
  vmMapping: string; // VM external function name
  paramNames?: string[];
  paramOptional?: boolean[];
};

export interface IntrinsicRegistryEntry {
  overloads: IntrinsicOverload[];
}

export class Validator {
  public context!: ValidationContext;
  public definiteAssignmentAnalyzer!: DefiniteAssignmentAnalyzer;
  // Registry for method/function intrinsics (e.g. Math.abs)
  public intrinsicRegistry: Map<string, IntrinsicRegistryEntry> = new Map();
  private lambdaParameterStack: string[][] = [];
  private lambdaScopeStack: { captureScope: string; lambdaName: string }[] = [];
  private typeParameterStack: Array<Set<string>> = [];

  /**
   * If true, allows top-level executable statements (legacy/test mode).
   * If false, only declarations are allowed at the top level.
   */
  public allowTopLevelStatements: boolean;

  public verbose: boolean;
  public inFunctionValidation: boolean = false;

  constructor(opts?: { allowTopLevelStatements?: boolean; verbose?: boolean }) {
    this.verbose = opts?.verbose ?? false;
    if (this.verbose) {
      console.log('[Validator] Initialized with verbose mode');
    }
    this.allowTopLevelStatements = opts?.allowTopLevelStatements ?? false;
    this.resetContextState();
  }

  public pushLambdaScope(parameters: string[], captureScope: string, lambdaName: string): void {
    this.lambdaParameterStack.push(parameters);
    this.lambdaScopeStack.push({ captureScope, lambdaName });
  }

  public popLambdaScope(): void {
    this.lambdaParameterStack.pop();
    this.lambdaScopeStack.pop();
  }

  public isLambdaParameter(name: string): boolean {
    for (let i = this.lambdaParameterStack.length - 1; i >= 0; i--) {
      if (this.lambdaParameterStack[i].includes(name)) {
        return true;
      }
    }
    return false;
  }

  public getCurrentLambdaScopeName(): string | undefined {
    if (this.lambdaScopeStack.length === 0) {
      return undefined;
    }
    return this.lambdaScopeStack[this.lambdaScopeStack.length - 1].captureScope;
  }

  public getCurrentLambdaName(): string | undefined {
    if (this.lambdaScopeStack.length === 0) {
      return undefined;
    }
    return this.lambdaScopeStack[this.lambdaScopeStack.length - 1].lambdaName;
  }

  public pushTypeParameters(params?: TypeParameter[]): void {
    if (!params || params.length === 0) {
      return;
    }
    this.typeParameterStack.push(new Set(params.map(p => p.name)));
  }

  public popTypeParameters(): void {
    if (this.typeParameterStack.length > 0) {
      this.typeParameterStack.pop();
    }
  }

  public isTypeParameter(name: string): boolean {
    for (let i = this.typeParameterStack.length - 1; i >= 0; i--) {
      if (this.typeParameterStack[i].has(name)) {
        return true;
      }
    }
    return false;
  }

  validateWithGlobalContext(programs: Program[], globalContext: GlobalValidationContext): ValidationContext[] {
    if (this.verbose) {
      console.log(`[Validator] Starting global validation for ${programs.length} files`);
    }
    // Build global symbol table
    if (this.verbose) console.log('[Validator] Building global symbol table');
    buildGlobalSymbolTable(programs, globalContext);

    const results: ValidationContext[] = [];
    for (const program of programs) {
      if (this.verbose) {
        console.log(`[Validator] Validating file: ${program.filename}`);
      }
      this.resetContextState();
      this.context.currentModule = globalContext.moduleMap.get(program.filename!);
      this.context.globalContext = globalContext; // Store global context for later use
      importGlobalSymbols(this, globalContext);
      resolveImports(program, globalContext, this);
      collectDeclarations(this, program);
      validateProgram(this, program);
      program.callDispatch = new Map(this.context.codeGenHints.callDispatch);
      if (this.verbose && this.context.errors.length > 0) {
        console.log(`[Validator] Errors in ${program.filename}:`);
        for (const err of this.context.errors) {
          console.log(`  ${err.location ? `${err.location.filename || program.filename}:${err.location.start?.line}:${err.location.start?.column}` : ''} ${err.message}`);
        }
      }
      results.push(cloneValidationContext(this.context));
    }

    // Add global errors to the first program's validation context
    if (results.length > 0 && globalContext.errors.length > 0) {
      results[0].errors.push(...globalContext.errors);
    }

    return results;
  }

  // Helper method for checking private access
  public isPrivateMemberAccessible(isPublic: boolean, className: string): boolean {
    if (isPublic) return true;
    return !!(this.context.currentClass && this.context.currentClass.name.name === className);
  }

  validate(program: Program): ValidationContext {
    if (this.verbose) {
      console.log(`[Validator] Validating single file: ${program.filename}`);
    }
    this.resetContextState();
    // First pass: collect all top-level declarations
    collectDeclarations(this, program);
    // Second pass: validate all nodes and infer types
    validateProgram(this, program);
    program.callDispatch = new Map(this.context.codeGenHints.callDispatch);
    if (this.verbose && this.context.errors.length > 0) {
      console.log(`[Validator] Errors in ${program.filename || 'input'}:`);
      for (const err of this.context.errors) {
        console.log(`  ${err.location ? `${err.location.filename || program.filename || 'input'}:${err.location.start?.line}:${err.location.start?.column}` : ''} ${err.message}`);
      }
    }
    return this.context;
  }

  public addError(message: string, location: SourceLocation): void {
    this.context.errors.push({ message, location, severity: 'error' });
  }

  public addWarning(message: string, location: SourceLocation): void {
    this.context.errors.push({ message, location, severity: 'warning' });
  }

  private resetContextState(): void {
    this.context = {
      symbols: new Map(),
      globalSymbols: new Map(),
      imports: new Map(),
      classes: new Map(),
      externClasses: new Map(),
  interfaces: new Map(),
      enums: new Map(),
      functions: new Map(),
      typeAliases: new Map(),
  typeSymbols: new TypeSymbolTable(new Map(), new Map(), new Map(), new Map()),
      errors: [],
      propertyNarrowings: new Map(),
      codeGenHints: {
        builtinFunctions: new Map(),
        objectInstantiations: new Map(),
        typeGuards: new Map(),
        typeNarrowing: new Map(),
        scopeTracker: new Map(),
        jsonPrintTypes: new Set(),
        jsonFromTypes: new Set(),
        includeTypeConversions: false,
        enumToStringFunctions: new Set(),
        enumValidationFunctions: new Set(),
        callDispatch: new Map(),
    externDependencies: new Set(),
    capturedMutableScopes: new Set()
      }
    };
    this.definiteAssignmentAnalyzer = new DefiniteAssignmentAnalyzer();
    this.lambdaParameterStack.length = 0;
    this.lambdaScopeStack.length = 0;
  this.typeParameterStack.length = 0;
    this.intrinsicRegistry.clear();
    initializeBuiltins(this);
    initializeIntrinsics(this);
    initializeBuiltinMappings(this);
  }
}

function cloneValidationContext(context: ValidationContext): ValidationContext {
  const clonedImports = new Map<string, ImportInfo>();
  for (const [key, value] of context.imports.entries()) {
    clonedImports.set(key, { ...value });
  }

  return {
    symbols: new Map(context.symbols),
    globalSymbols: new Map(context.globalSymbols),
    imports: clonedImports,
    classes: new Map(context.classes),
    externClasses: new Map(context.externClasses),
    interfaces: new Map(context.interfaces),
    enums: new Map(context.enums),
    functions: new Map(context.functions),
    typeAliases: new Map(context.typeAliases),
    typeSymbols: context.typeSymbols,
    currentClass: context.currentClass,
    currentFunction: context.currentFunction,
    currentMethod: context.currentMethod,
    currentModule: context.currentModule,
    globalContext: context.globalContext,
    inLoop: context.inLoop,
    inSwitch: context.inSwitch,
    errors: [...context.errors],
    propertyNarrowings: new Map(context.propertyNarrowings),
    codeGenHints: {
      builtinFunctions: new Map(context.codeGenHints.builtinFunctions),
      objectInstantiations: new Map(context.codeGenHints.objectInstantiations),
      typeGuards: new Map(context.codeGenHints.typeGuards),
      typeNarrowing: new Map(context.codeGenHints.typeNarrowing),
      scopeTracker: new Map(context.codeGenHints.scopeTracker),
      jsonPrintTypes: new Set(context.codeGenHints.jsonPrintTypes),
      jsonFromTypes: new Set(context.codeGenHints.jsonFromTypes),
      includeTypeConversions: context.codeGenHints.includeTypeConversions,
      enumToStringFunctions: new Set(context.codeGenHints.enumToStringFunctions),
      enumValidationFunctions: new Set(context.codeGenHints.enumValidationFunctions),
      callDispatch: new Map(context.codeGenHints.callDispatch),
  externDependencies: new Set(context.codeGenHints.externDependencies),
  capturedMutableScopes: new Set(context.codeGenHints.capturedMutableScopes)
    }
  };
}
