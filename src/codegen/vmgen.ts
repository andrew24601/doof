// VM bytecode generator for doof

import {
  Program, Statement, Expression, Type, ClassDeclaration,
  EnumDeclaration, FunctionDeclaration, VariableDeclaration, Parameter,
  FieldDeclaration, MethodDeclaration, EnumMember,
  IfStatement, WhileStatement, ForStatement, ForOfStatement, SwitchStatement,
  SwitchCase, ReturnStatement,
  BlockStatement, ExpressionStatement, ImportDeclaration, ExportDeclaration,
  Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression, CallExpression,
  MemberExpression, IndexExpression, ArrayExpression, ObjectExpression, PositionalObjectExpression, SetExpression, ObjectProperty,
  LambdaExpression, RangeExpression, EnumShorthandMemberExpression, TrailingLambdaExpression, TypeGuardExpression, InterpolatedString, PrimitiveTypeNode,
  ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, ExternClassTypeNode, EnumTypeNode, FunctionTypeNode, UnionTypeNode,
  ValidationContext, ImportInfo, GlobalValidationContext,
  NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression,
  CaptureInfo
} from '../types';
import { ICodeGenerator, GeneratorOptions, GeneratorResult } from '../codegen-interface';
import { StructuredRegisterAllocator } from './vm/register-allocator';
import { generateExpression, generateExpressionOptimal } from './vm/vmgen-expression-codegen';
import { generateTypedNumericLiteral } from './vm/vmgen-literal-codegen';
import { getExpressionType, isBoolType, isDoubleType, isFloatType, isIntType, isNullLiteral } from './vm/vmgen-type-utils';
import { getNormalizedLambdaInfo, shouldCaptureByValue } from './vm/vmgen-lambda-codegen';
import {  emit, generateVMOutput, addConstant } from './vm/vmgen-emit';
import { 
  generateStatement, 
  generateBlockStatement,
  resolvePendingJumps,
  extractLocalVariables
} from './vm/vmgen-statement-codegen';
import { generateSupportFunction } from './vm/vmgen-array-intrinsics';
import { wrapCapturedMutableParameters } from './vm/vmgen-capture-utils';

// VM instruction representation
export interface VMInstruction {
  opcode: string;
  a: number;
  b: number;
  c: number;
}

// JSON bytecode format interfaces
export interface VMBytecodeFormat {
  version: string;
  metadata: {
    sourceFile: string;
    generatedAt: string;
    doofVersion: string;
  };
  constants: VMConstant[];
  functions: VMFunctionInfo[];
  classes: VMClassInfo[];
  entryPoint: number;
  globalCount: number; // Number of global variables to allocate
  instructions: VMInstructionFormat[];
  debug?: VMDebugInfo; // Optional debug information for DAP
}

// Debug information for DAP support
export interface VMDebugInfo {
  sourceMap: VMSourceMapEntry[];
  functions: VMDebugFunctionInfo[];
  variables: VMDebugVariableInfo[];
  scopes: VMDebugScopeInfo[];
  files: VMDebugFileInfo[];
}

export interface VMSourceMapEntry {
  instructionIndex: number;
  sourceLine: number;
  sourceColumn: number;
  fileIndex: number;
}

export interface VMDebugFunctionInfo {
  name: string;
  startInstruction: number;
  endInstruction: number;
  fileIndex: number;
  sourceLine: number;
  sourceColumn: number;
  parameterCount: number;
  localVariableCount: number;
}

export interface VMDebugVariableInfo {
  name: string;
  type: string;
  startInstruction: number;
  endInstruction: number;
  location: VMVariableLocation;
}

export interface VMVariableLocation {
  type: 'register' | 'global' | 'constant';
  index: number;
}

export interface VMDebugScopeInfo {
  startInstruction: number;
  endInstruction: number;
  parentScopeIndex?: number;
  variableIndices: number[];
}

export interface VMDebugFileInfo {
  path: string;
  content?: string; // Optional source content for debugging
}

export interface VMConstant {
  type: 'null' | 'bool' | 'int' | 'float' | 'double' | 'string';
  value: any;
}

export interface VMFunctionInfo {
  name: string;
  parameterCount: number;
  registerCount: number;
  codeIndex: number;
  constantIndex?: number;
}

export interface VMClassInfo {
  name: string;
  fieldCount: number;
  methodCount: number;
  fields: string[];
  methods: string[];
  constantIndex?: number;
}

export interface VMInstructionFormat {
  opcode: number;
  mnemonic?: string;
  a: number;
  b: number;
  c: number;
  comment?: string;
}

// VM value representation
export interface VMValue {
  type: 'null' | 'bool' | 'int' | 'float' | 'double' | 'string' | 'object' | 'array' | 'function' | 'class';
  value: any;
}

// Function metadata for constant pool
export interface VMFunctionMetadata {
  name: string;
  parameterCount: number;
  registerCount: number;
  codeIndex: number;
  returnType?: Type; // Add return type for proper type tracking
}

// Class metadata for constant pool
export interface VMClassMetadata {
  name: string;
  fieldCount: number;
  methodCount: number;
  fields: string[];
  methods: string[];
}

// Deferred lambda generation info
interface DeferredLambda {
  lambda: LambdaExpression | TrailingLambdaExpression;
  metadata: VMFunctionMetadata;
  createInstructionIndex: number;
  metadataIndex: number; // Index of function metadata in constant pool
}

// Normalized lambda information for unified processing
export interface NormalizedLambdaInfo {
  captureInfo?: CaptureInfo;
  parameters: Parameter[];
  body: Statement | Expression;
  isBlock: boolean;
  lambdaType: 'lambda' | 'trailing';
}

// Loop context for tracking break/continue targets
interface LoopContext {
  continueLabel: string;  // Where continue should jump
  breakLabel: string;     // Where break should jump
  loopType: 'while' | 'for' | 'forOf' | 'switch';
}

// Compilation context
export interface CompilationContext {
  instructions: VMInstruction[];
  constantPool: VMValue[];
  functionTable: Map<string, VMFunctionMetadata>;
  classTable: Map<string, VMClassMetadata>;
  functionMetadataByDecl: Map<FunctionDeclaration, VMFunctionMetadata>;
  classMetadataByDecl: Map<ClassDeclaration, VMClassMetadata>;
  registerAllocator: StructuredRegisterAllocator;
  currentFunction?: FunctionDeclaration;
  currentClass?: ClassDeclaration;
  currentLambda?: LambdaExpression | TrailingLambdaExpression; // Track current lambda being compiled
  currentFilePath?: string;
  labelCounter: number;
  labels: Map<string, number>;
  pendingJumps: Array<{ instructionIndex: number, labelName: string }>;
  variables: Map<string, Type>;  // Track variable types
  deferredLambdas?: DeferredLambda[]; // Lambdas to generate at the end
  loopContextStack: LoopContext[]; // Stack of loop contexts for break/continue
  methodCodeIndices?: Map<string, number>; // Track method code indices for metadata
  globalSymbolTable: Map<string, number>; // Static field name -> global slot index
  arrayIntrinsicsUsed: Set<string>; // Track which array intrinsics are used (filter, map, forEach, reduce)
  arrayIntrinsicsGenerated: Set<string>; // Track which support functions have been generated
  validationContexts?: Map<string, ValidationContext>;
  programOrder?: Program[];
  captureWrapperClassConstant?: number;
  captureWrapperMetadata?: VMClassMetadata;
  // Debug information
  debug: {
    sourceMap: VMSourceMapEntry[];
    functions: VMDebugFunctionInfo[];
    variables: VMDebugVariableInfo[];
    scopes: VMDebugScopeInfo[];
    files: VMDebugFileInfo[];
    currentSourceLine?: number;
    currentSourceColumn?: number;
    currentFileIndex: number;
    variableCounter: number;
    scopeCounter: number;
  };
}

export function getActiveValidationContext(context: CompilationContext): ValidationContext | undefined {
  const { validationContexts, currentFilePath } = context;
  if (!validationContexts || validationContexts.size === 0) {
    return undefined;
  }

  if (currentFilePath) {
    const active = validationContexts.get(currentFilePath);
    if (active) {
      return active;
    }
  }

  if (validationContexts.size === 1) {
    return validationContexts.values().next().value;
  }

  return undefined;
}

export class VMGenerator implements ICodeGenerator {

  private getProgramOrder(
    entryProgram: Program,
    globalContext?: GlobalValidationContext,
    entryFilePath?: string
  ): Program[] {
    if (!globalContext || globalContext.files.size === 0) {
      return [entryProgram];
    }

    const ordered: Program[] = [];
    const entryKey = entryFilePath && globalContext.files.has(entryFilePath)
      ? entryFilePath
      : entryProgram.filename && globalContext.files.has(entryProgram.filename)
        ? entryProgram.filename
        : undefined;

    if (entryKey) {
      const entryFromContext = globalContext.files.get(entryKey);
      if (entryFromContext) {
        ordered.push(entryFromContext);
      }
    } else {
      ordered.push(entryProgram);
    }

    for (const [filePath, program] of globalContext.files.entries()) {
      if (entryKey && filePath === entryKey) {
        continue;
      }
      ordered.push(program);
    }

    return ordered;
  }

  private buildValidationContextMap(
    entryProgram: Program,
    validationContext: ValidationContext | undefined,
    globalContext?: GlobalValidationContext,
    entryFilePath?: string
  ): Map<string, ValidationContext> | undefined {
    if (globalContext?.validationContexts && globalContext.validationContexts.size > 0) {
      return globalContext.validationContexts;
    }

    if (!validationContext) {
      return undefined;
    }

    const key = entryProgram.filename || entryFilePath;
    if (!key) {
      return undefined;
    }

    return new Map([[key, validationContext]]);
  }

  generate(
    program: Program,
    filename: string = 'output',
    validationContext?: ValidationContext,
    globalContext?: GlobalValidationContext,
    sourceFilePath?: string
  ): GeneratorResult {
    const programs = this.getProgramOrder(program, globalContext, sourceFilePath);
    const validationContextMap = this.buildValidationContextMap(program, validationContext, globalContext, sourceFilePath);
    const entryProgram = programs[0];
    const entryValidationContext = entryProgram && entryProgram.filename ? validationContextMap?.get(entryProgram.filename) : validationContext;

    if (!entryValidationContext) {
      throw new Error('Validation context is required for VM generation.');
    }

    const context: CompilationContext = {
      instructions: [],
      constantPool: [],
      functionTable: new Map(),
      classTable: new Map(),
      functionMetadataByDecl: new Map(),
      classMetadataByDecl: new Map(),
      registerAllocator: new StructuredRegisterAllocator(),
  currentFilePath: entryProgram.filename || sourceFilePath,
      labelCounter: 0,
      labels: new Map(),
  pendingJumps: [],
  variables: new Map(),
      validationContexts: validationContextMap,
      programOrder: programs,
      loopContextStack: [],
      globalSymbolTable: new Map(),
      arrayIntrinsicsUsed: new Set(),
      arrayIntrinsicsGenerated: new Set(),
      debug: {
        sourceMap: [],
        functions: [],
        variables: [],
        scopes: [],
        files: programs.map(prog => ({ path: prog.filename || sourceFilePath || filename })),
        currentFileIndex: 0,
        variableCounter: 0,
        scopeCounter: 0
      }
    };

    // First pass: collect function and class metadata across all programs
    this.collectMetadata(programs, context, globalContext);

    // Second pass: generate bytecode for all programs
    this.generatePrograms(programs, context, globalContext);

    // Generate final output
    const source = generateVMOutput(context, filename);
    return { source };
  }

  private collectMetadata(
    programs: Program[],
    context: CompilationContext,
    globalContext?: GlobalValidationContext
  ): void {
    for (const program of programs) {
      const moduleName = program.moduleName;
      for (const stmt of program.body) {
        this.collectMetadataFromStatement(stmt, moduleName, context);
      }
    }

    this.collectStaticFields(programs, context);
    this.registerImportAliases(globalContext, context);
  }

  private collectMetadataFromStatement(
    stmt: Statement,
    moduleName: string | undefined,
    context: CompilationContext
  ): void {
    if (stmt.kind === 'export') {
      this.collectMetadataFromStatement(stmt.declaration, moduleName, context);
      return;
    }

    if (stmt.kind === 'function') {
      const funcDecl = stmt as FunctionDeclaration;
      const metadata: VMFunctionMetadata = {
        name: funcDecl.name.name,
        parameterCount: funcDecl.parameters.length,
        registerCount: 256,
        codeIndex: -1,
        returnType: funcDecl.returnType
      };

      context.functionMetadataByDecl.set(funcDecl, metadata);

      if (!context.functionTable.has(funcDecl.name.name)) {
        context.functionTable.set(funcDecl.name.name, metadata);
      }

      if (moduleName) {
        context.functionTable.set(`${moduleName}::${funcDecl.name.name}`, metadata);
      }
      return;
    }

    if (stmt.kind === 'class') {
      const classDecl = stmt as ClassDeclaration;
      const metadata: VMClassMetadata = {
        name: classDecl.name.name,
        fieldCount: classDecl.fields.filter(f => !f.isStatic).length,
        methodCount: classDecl.methods.length,
        fields: classDecl.fields.filter(f => !f.isStatic).map(f => f.name.name),
        methods: classDecl.methods.map(m => m.name.name)
      };

      context.classMetadataByDecl.set(classDecl, metadata);

      if (!context.classTable.has(classDecl.name.name)) {
        context.classTable.set(classDecl.name.name, metadata);
      }

      if (moduleName) {
        context.classTable.set(`${moduleName}::${classDecl.name.name}`, metadata);
      }

      for (const method of classDecl.methods) {
        if (!method.isStatic) {
          continue;
        }
        const staticMethodKey = `${classDecl.name.name}.${method.name.name}`;
        const methodMetadata: VMFunctionMetadata = {
          name: staticMethodKey,
          parameterCount: method.parameters.length,
          registerCount: 256,
          codeIndex: -1,
          returnType: method.returnType
        };

        if (!context.functionTable.has(staticMethodKey)) {
          context.functionTable.set(staticMethodKey, methodMetadata);
        }
        if (moduleName) {
          context.functionTable.set(`${moduleName}::${staticMethodKey}`, methodMetadata);
        }
      }
    }
  }

  private collectStaticFields(programs: Program[], context: CompilationContext): void {
    let globalSlotIndex = 0;

    for (const program of programs) {
      for (const stmt of program.body) {
        const classDecl = this.unwrapClassDeclaration(stmt);
        if (!classDecl) {
          continue;
        }

        for (const field of classDecl.fields) {
          if (field.isStatic) {
            const globalFieldName = `${classDecl.name.name}.${field.name.name}`;
            if (!context.globalSymbolTable.has(globalFieldName)) {
              context.globalSymbolTable.set(globalFieldName, globalSlotIndex);
              globalSlotIndex++;
            }
          }
        }
      }
    }
  }

  private registerImportAliases(globalContext: GlobalValidationContext | undefined, context: CompilationContext): void {
    if (!globalContext || !globalContext.validationContexts) {
      return;
    }

    for (const validationContext of globalContext.validationContexts.values()) {
      for (const importInfo of validationContext.imports.values()) {
        const symbol = globalContext.exportedSymbols.get(importInfo.fullyQualifiedName);
        if (!symbol) {
          continue;
        }

        if (symbol.type === 'function') {
          const metadata = this.lookupFunctionMetadata(importInfo.sourceModule, importInfo.importedName, context);
          if (metadata && !context.functionTable.has(importInfo.localName)) {
            context.functionTable.set(importInfo.localName, metadata);
          }
        } else if (symbol.type === 'class') {
          const classMetadata = this.lookupClassMetadata(importInfo.sourceModule, importInfo.importedName, context);
          if (classMetadata && !context.classTable.has(importInfo.localName)) {
            context.classTable.set(importInfo.localName, classMetadata);
          }
        }
      }
    }
  }

  private lookupFunctionMetadata(
    moduleName: string,
    functionName: string,
    context: CompilationContext
  ): VMFunctionMetadata | undefined {
    const qualifiedKey = moduleName ? `${moduleName}::${functionName}` : functionName;
    return context.functionTable.get(qualifiedKey) ?? context.functionTable.get(functionName);
  }

  private lookupClassMetadata(
    moduleName: string,
    className: string,
    context: CompilationContext
  ): VMClassMetadata | undefined {
    const qualifiedKey = moduleName ? `${moduleName}::${className}` : className;
    return context.classTable.get(qualifiedKey) ?? context.classTable.get(className);
  }

  private unwrapClassDeclaration(stmt: Statement): ClassDeclaration | undefined {
    if (stmt.kind === 'class') {
      return stmt as ClassDeclaration;
    }
    if (stmt.kind === 'export' && stmt.declaration.kind === 'class') {
      return stmt.declaration as ClassDeclaration;
    }
    return undefined;
  }

  private setValidationContextForProgram(program: Program, context: CompilationContext): void {
    if (!context.validationContexts || !program.filename) {
      return;
    }

    if (!context.validationContexts.has(program.filename)) {
      throw new Error(`Missing validation context for program ${program.filename}`);
    }
  }

  private unwrapFunctionName(stmt: Statement): string | undefined {
    if (stmt.kind === 'function') {
      return (stmt as FunctionDeclaration).name.name;
    }
    if (stmt.kind === 'export' && stmt.declaration.kind === 'function') {
      return (stmt.declaration as FunctionDeclaration).name.name;
    }
    return undefined;
  }

  private programHasMain(program: Program): boolean {
    for (const stmt of program.body) {
      if (this.unwrapFunctionName(stmt) === 'main') {
        return true;
      }
    }
    return false;
  }

  private generateGlobalInitialization(programs: Program[], context: CompilationContext): void {
    context.registerAllocator.setupFunction([], [], false);

    for (const program of programs) {
      context.currentFilePath = program.filename || context.currentFilePath;
      this.setValidationContextForProgram(program, context);

      for (const stmt of program.body) {
        const classDecl = this.unwrapClassDeclaration(stmt);
        if (!classDecl) {
          continue;
        }

        for (const field of classDecl.fields) {
          if (!field.isStatic) {
            continue;
          }

          const globalFieldName = `${classDecl.name.name}.${field.name.name}`;
          const globalSlot = context.globalSymbolTable.get(globalFieldName);

          if (globalSlot === undefined) {
            continue;
          }

          const tempReg = context.registerAllocator.allocateTemporary();

          if (field.defaultValue) {
            generateExpression(field.defaultValue, tempReg, context);
          } else {
            if (field.type.kind === 'primitive') {
              switch (field.type.type) {
                case 'int':
                  emit('LOADK_INT16', tempReg, 0, 0, context);
                  break;
                case 'string':
                  {
                    const stringValue: VMValue = { type: 'string', value: '' };
                    const stringIndex = addConstant(stringValue, context);
                    emit('LOADK', tempReg, Math.floor(stringIndex / 256), stringIndex % 256, context);
                  }
                  break;
                default:
                  emit('LOADK_NULL', tempReg, 0, 0, context);
                  break;
              }
            } else {
              emit('LOADK_NULL', tempReg, 0, 0, context);
            }
          }

          const globalHigh = Math.floor(globalSlot / 256);
          const globalLow = globalSlot % 256;
          emit('SET_GLOBAL', tempReg, globalHigh, globalLow, context);

          context.registerAllocator.free(tempReg);
        }
      }
    }
  }

  private generatePrograms(
    programs: Program[],
    context: CompilationContext,
    globalContext?: GlobalValidationContext
  ): void {
    this.generateGlobalInitialization(programs, context);

    const entryProgram = programs[0];
    const entryHasMain = entryProgram ? this.programHasMain(entryProgram) : false;
    const entryModuleName = entryProgram?.moduleName;
    const entryMainKey = entryModuleName ? `${entryModuleName}::main` : 'main';
    const mainMetadata = entryHasMain
      ? (context.functionTable.get(entryMainKey) ?? context.functionTable.get('main'))
      : undefined;

    let callInstructionIndex: number | null = null;

    if (mainMetadata) {
      const callReg = context.registerAllocator.allocateTemporary();
      emit('CALL', callReg, 0, 0, context);
      callInstructionIndex = context.instructions.length - 1;
      context.registerAllocator.free(callReg);
      emit('HALT', 0, 0, 0, context);
    }

    programs.forEach((program, index) => {
      context.currentFilePath = program.filename || context.currentFilePath;
      this.setValidationContextForProgram(program, context);
      context.debug.currentFileIndex = Math.min(index, context.debug.files.length - 1);

      for (const stmt of program.body) {
        if (stmt.kind === 'import') {
          continue;
        }
        if (stmt.kind === 'export') {
          generateStatement(stmt.declaration, context);
        } else {
          generateStatement(stmt, context);
        }
      }
    });

    if (mainMetadata && callInstructionIndex !== null && mainMetadata.codeIndex >= 0) {
      const mainFuncConstant: VMValue = {
        type: 'function',
        value: mainMetadata
      };
      const funcConstIndex = addConstant(mainFuncConstant, context);
      const callInstruction = context.instructions[callInstructionIndex];
      callInstruction.b = Math.floor(funcConstIndex / 256);
      callInstruction.c = funcConstIndex % 256;
    } else if (!mainMetadata) {
      emit('HALT', 0, 0, 0, context);
    }

    if (context.deferredLambdas) {
      for (const deferredLambda of context.deferredLambdas) {
        const lambdaCodeIndex = context.instructions.length;
        deferredLambda.metadata.codeIndex = lambdaCodeIndex;

        const constantValue = context.constantPool[deferredLambda.metadataIndex];
        if (constantValue.type === 'function') {
          (constantValue.value as VMFunctionMetadata).codeIndex = lambdaCodeIndex;
        }

        const lambdaInfo = getNormalizedLambdaInfo(deferredLambda.lambda);
        this.generateLambdaBody(lambdaInfo, deferredLambda.lambda, deferredLambda.metadata, context);

        const metadataConstant = context.constantPool[deferredLambda.metadataIndex];
        if (metadataConstant.type === 'function') {
          (metadataConstant.value as VMFunctionMetadata).registerCount = deferredLambda.metadata.registerCount;
        }
      }
    }

    this.generateArrayIntrinsicSupportFunctions(context);
    resolvePendingJumps(context);
  }

  /**
   * Generate array intrinsic support functions that were used during compilation
   */
  private generateArrayIntrinsicSupportFunctions(context: CompilationContext): void {
    for (const methodName of context.arrayIntrinsicsUsed) {
      if (!context.arrayIntrinsicsGenerated.has(methodName)) {
        const supportFuncName = `__array_${methodName}`;
        const metadata = context.functionTable.get(supportFuncName);
        
        if (metadata) {
          // Set the code index to current instruction position
          metadata.codeIndex = context.instructions.length;
          
          // Update any existing constant pool references to this function
          for (const constant of context.constantPool) {
            if (constant.type === 'function' && 
                (constant.value as VMFunctionMetadata).name === supportFuncName) {
              (constant.value as VMFunctionMetadata).codeIndex = metadata.codeIndex;
            }
          }
          
          // Call the specific generator
          generateSupportFunction(methodName, context);
          
          // Mark as generated
          context.arrayIntrinsicsGenerated.add(methodName);
        }
      }
    }
  }

  private generateLambdaBody(lambdaInfo: NormalizedLambdaInfo, originalLambda: LambdaExpression | TrailingLambdaExpression, metadata: VMFunctionMetadata, context: CompilationContext): void {
    // Save current register allocator state and lambda context
    const oldAllocator = context.registerAllocator;
    const oldLambda = context.currentLambda;
    context.registerAllocator = new StructuredRegisterAllocator();
    context.currentLambda = originalLambda;
    
    // Setup lambda parameters properly
    const parameters = lambdaInfo.parameters.map(p => ({
      name: p.name.name,
      type: p.type
    }));

    const locals: Array<{ name: string; type?: Type }> = [];
    const seenLocals = new Set<string>();

    if (lambdaInfo.captureInfo) {
      for (const capture of lambdaInfo.captureInfo.capturedVariables) {
  if (shouldCaptureByValue(capture, context) && !seenLocals.has(capture.name)) {
          locals.push({ name: capture.name });
          seenLocals.add(capture.name);
        }
      }
    }

    if (lambdaInfo.isBlock) {
      const blockLocals = extractLocalVariables(lambdaInfo.body as BlockStatement);
      for (const local of blockLocals) {
        if (!seenLocals.has(local.name)) {
          locals.push(local);
          seenLocals.add(local.name);
        }
      }
    }

  context.registerAllocator.setupFunction(parameters, locals, false);
  wrapCapturedMutableParameters(lambdaInfo.parameters, context);
    
    // Generate lambda body
    if (lambdaInfo.isBlock) {
      generateBlockStatement(lambdaInfo.body as BlockStatement, context);
      // Add implicit return for block lambdas
      emit('LOADK_NULL', 0, 0, 0, context);
      emit('RETURN', 0, 0, 0, context);
    } else {
      // Expression lambda - generate expression and return result
      generateExpression(lambdaInfo.body as Expression, 0, context);
      emit('RETURN', 0, 0, 0, context);
    }
    
    // Update metadata with actual register count
    metadata.registerCount = context.registerAllocator.getTotalRegistersUsed();
    
    // Restore previous register allocator and lambda context
    context.registerAllocator = oldAllocator;
    context.currentLambda = oldLambda;
  }
}
