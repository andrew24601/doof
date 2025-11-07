// VM statement code generation functions

import {
  Statement, Expression, Type, 
  FunctionDeclaration, VariableDeclaration, ClassDeclaration, MethodDeclaration,
  IfStatement, WhileStatement, ForStatement, ForOfStatement, SwitchStatement,
  ReturnStatement, BlockStatement, ExpressionStatement, ExportDeclaration,
  Literal, RangeExpression, Parameter,
  PrimitiveTypeNode
} from '../../types';
import { CompilationContext, VMFunctionMetadata, VMValue, VMDebugVariableInfo, getActiveValidationContext } from '../vmgen';
import { generateExpression } from './vmgen-expression-codegen';
import { generateConditional } from './vmgen-conditional-codegen';
import { getExpressionType, getPromotedType } from './vmgen-type-utils';
import { generateTypedNumericLiteral } from './vmgen-literal-codegen';
import { getNormalizedLambdaInfo } from './vmgen-lambda-codegen';
import { emit, emitJump, createLabel, setLabel, addConstant, setSourceLocationFromNode, beginFunction, endFunction } from './vmgen-emit';
import { StructuredRegisterAllocator } from './register-allocator';
import { generateIteratorBasedForOf as emitIteratorForOf } from './vmgen-iter';
import { shouldWrapCapturedMutable, wrapCapturedMutableParameters, emitWrapRegisterWithCurrentValue } from './vmgen-capture-utils';

function vmDebugEnabled(): boolean {
  const flag = process.env.DOOF_DEBUG;
  return flag === '1' || flag === 'true' || flag === 'vm' || flag === 'vmgen';
}
function dbg(...args: any[]) {
  if (vmDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.error('[VMGEN][stmt]', ...args);
  }
}

/**
 * Format a type for debug information display
 */
function formatTypeForDebug(type: Type): string {
  if (type.kind === 'primitive') {
    return type.type;
  } else if (type.kind === 'array') {
    return `${formatTypeForDebug(type.elementType)}[]`;
  } else if (type.kind === 'class') {
    return type.name;
  } else if (type.kind === 'function') {
    return 'function';
  }
  return 'unknown';
}

/**
 * Extract all local variable declarations from a function body
 */
export function extractLocalVariables(block: BlockStatement): Array<{name: string, type?: Type}> {
  const locals: Array<{name: string, type?: Type}> = [];
  const visited = new Set<string>();

  const visitStatement = (stmt: Statement): void => {
    switch (stmt.kind) {
      case 'variable':
        const varDecl = stmt as VariableDeclaration;
        if (!visited.has(varDecl.identifier.name)) {
          locals.push({
            name: varDecl.identifier.name,
            type: varDecl.type || undefined
          });
          visited.add(varDecl.identifier.name);
        }
        break;
      case 'block':
        const blockStmt = stmt as BlockStatement;
        for (const innerStmt of blockStmt.body) {
          visitStatement(innerStmt);
        }
        break;
      case 'if':
        const ifStmt = stmt as IfStatement;
        visitStatement(ifStmt.thenStatement);
        if (ifStmt.elseStatement) {
          visitStatement(ifStmt.elseStatement);
        }
        break;
      case 'while':
        const whileStmt = stmt as WhileStatement;
        visitStatement(whileStmt.body);
        break;
      case 'for':
        const forStmt = stmt as ForStatement;
        // Handle for loop variable declaration
        if (forStmt.init && forStmt.init.kind === 'variable') {
          const initVar = forStmt.init as VariableDeclaration;
          if (!visited.has(initVar.identifier.name)) {
            locals.push({
              name: initVar.identifier.name,
              type: initVar.type || undefined
            });
            visited.add(initVar.identifier.name);
          }
        }
        visitStatement(forStmt.body);
        break;
      case 'forOf':
        const forOfStmt = stmt as ForOfStatement;
        // Handle for-of loop variable declaration
        if (!visited.has(forOfStmt.variable.name)) {
          locals.push({
            name: forOfStmt.variable.name,
            type: undefined // Type will be inferred from iterable
          });
          visited.add(forOfStmt.variable.name);
        }
        visitStatement(forOfStmt.body);
        break;
      // Add more statement types as needed
    }
  };

  for (const stmt of block.body) {
    visitStatement(stmt);
  }

  return locals;
}

/**
 * Generate code for a statement
 */
export function generateStatement(stmt: Statement, context: CompilationContext): void {
  // Set source location for debug information
  setSourceLocationFromNode(stmt, context);
  
  switch (stmt.kind) {
    case 'blank':
      return;
    case 'function':
      generateFunction(stmt as FunctionDeclaration, context);
      break;
    case 'class':
      generateClass(stmt, context);
      break;
    case 'enum':
      // Enums currently require no runtime bytecode; they are compile-time constants
      // Validation captures enum metadata for conversions; VM uses lowered ints
      return;
    case 'externClass':
      // Extern classes are runtime-provided; no bytecode emitted.
      return;
    case 'variable':
      generateVariableDeclaration(stmt as VariableDeclaration, context);
      break;
    case 'export':
      generateStatement((stmt as ExportDeclaration).declaration, context);
      break;
    case 'import':
      return;
    case 'typeAlias':
      return;
    case 'expression':
      const exprStmt = stmt as ExpressionStatement;
      // For expression statements, allocate a temporary register instead of using r0
      // This prevents assignment expressions from overwriting the return value register
      const tempReg = context.registerAllocator.allocate();
      generateExpression(exprStmt.expression, tempReg, context);
      context.registerAllocator.free(tempReg);
      break;
    case 'if':
      generateIfStatement(stmt as IfStatement, context);
      break;
    case 'while':
      generateWhileStatement(stmt as WhileStatement, context);
      break;
    case 'for':
      generateForStatement(stmt as ForStatement, context);
      break;
    case 'forOf':
      generateForOfStatement(stmt as ForOfStatement, context);
      break;
    case 'return':
      generateReturnStatement(stmt as ReturnStatement, context);
      break;
    case 'block':
      generateBlockStatement(stmt as BlockStatement, context);
      break;
    case 'break':
      generateBreakStatement(context);
      break;
    case 'continue':
      generateContinueStatement(context);
      break;
    case 'switch':
      generateSwitchStatement(stmt as SwitchStatement, context);
      break;
    case 'markdownHeader':
      // Markdown headers do not have VM code generation
      break;
    case 'markdownTable':
      // Markdown tables are currently not supported for VM execution
      break;
    default:
      throw new Error("Unimplemented statement kind: " + (stmt as any).kind);
      break;
  }
}

/**
 * Generate code for a function declaration
 */
export function generateFunction(funcDecl: FunctionDeclaration, context: CompilationContext): void {
  const oldFunction = context.currentFunction;
  context.currentFunction = funcDecl;
  
  // Phase 1: Analyze function structure and setup register allocator
  const parameters = funcDecl.parameters.map(p => ({
    name: p.name.name,
    type: p.type
  }));
  const locals = extractLocalVariables(funcDecl.body);
  
  context.registerAllocator.reset();
  context.registerAllocator.setupFunction(parameters, locals, false);

  // Mark function start in instruction stream
  const functionStartIndex = context.instructions.length;
  const metadata = context.functionMetadataByDecl.get(funcDecl);
  if (!metadata) {
    throw new Error(`Missing function metadata for ${funcDecl.name.name}`);
  }
  metadata.codeIndex = functionStartIndex;
  
  // Add debug function info
  if (funcDecl.location) {
    beginFunction(
      funcDecl.name.name,
      functionStartIndex,
      funcDecl.location.start.line,
      funcDecl.location.start.column,
      funcDecl.parameters.length,
      context
    );
  }

  // Debug: Log register layout
  // console.log(`Function ${funcDecl.name.name}:`);
  // console.log(context.registerAllocator.getRegisterLayout());

  wrapCapturedMutableParameters(funcDecl.parameters, context);

  // Phase 2: Generate function body
  generateBlockStatement(funcDecl.body, context);

  // Add implicit return for void functions
  if (!funcDecl.returnType || (funcDecl.returnType.kind === 'primitive' && funcDecl.returnType.type === 'void')) {
    emit('LOADK_NULL', 0, 0, 0, context);
    emit('RETURN', 0, 0, 0, context);
  }

  // Update register count
  metadata.registerCount = context.registerAllocator.getTotalRegistersUsed();
  
  // End debug function info
  endFunction(context);

  context.currentFunction = oldFunction;
}

/**
 * Generate code for a class declaration
 */
export function generateClass(classDecl: ClassDeclaration, context: CompilationContext): void {
  const oldClass = context.currentClass;
  context.currentClass = classDecl;

  // Add class metadata to constant pool
  const classMetadata = context.classMetadataByDecl.get(classDecl);
  if (!classMetadata) {
    throw new Error(`Missing class metadata for ${classDecl.name.name}`);
  }

  const classMetadataValue: VMValue = {
    type: 'class',
    value: classMetadata
  };
  addConstant(classMetadataValue, context);

  // Generate methods
  for (const method of classDecl.methods) {
    generateMethod(method, classDecl.name.name, context);
  }

  context.currentClass = oldClass;
}

/**
 * Generate code for a method declaration
 */
export function generateMethod(method: MethodDeclaration, className: string, context: CompilationContext): void {
  // Set current class context for method generation
  const activeValidationContext = getActiveValidationContext(context);
  const classDecl = activeValidationContext?.classes.get(className);
  if (classDecl) {
    context.currentClass = classDecl;
  }

  // Phase 1: Analyze method structure and setup register allocator
  const parameters = method.parameters.map(p => ({
    name: p.name.name,
    type: p.type
  }));
  const locals = extractLocalVariables(method.body);
  
  context.registerAllocator.reset();
  context.registerAllocator.setupFunction(parameters, locals, !method.isStatic); // hasThis = !isStatic

  // Mark method start in instruction stream for code index tracking
  const methodStartIndex = context.instructions.length;
  
  // Store method code index for later metadata updates
  const methodKey = `${className}::${method.name.name}`;
  if (!context.methodCodeIndices) {
    context.methodCodeIndices = new Map();
  }
  context.methodCodeIndices.set(methodKey, methodStartIndex);

  // Debug: Log register layout
  // console.log(`Method ${methodKey}:`);
  // console.log(context.registerAllocator.getRegisterLayout());

  wrapCapturedMutableParameters(method.parameters, context);

  // Phase 2: Generate method body
  generateBlockStatement(method.body, context);

  // Add implicit return for void methods
  if (!method.returnType || (method.returnType.kind === 'primitive' && method.returnType.type === 'void')) {
    emit('LOADK_NULL', 0, 0, 0, context);
    emit('RETURN', 0, 0, 0, context);
  }

  // Clear current class context
  context.currentClass = undefined;
}

/**
 * Generate code for a variable declaration
 */
export function generateVariableDeclaration(varDecl: VariableDeclaration, context: CompilationContext): void {
  const varType = getVariableType(varDecl, context);
  const reg = context.registerAllocator.allocateVariable(varDecl.identifier.name);

  // Store variable type in context for later lookups
  if (!context.variables) {
    context.variables = new Map();
  }
  context.variables.set(varDecl.identifier.name, varType);

  // Add debug information for this variable
  if (context.debug) {
    const currentInstruction = context.instructions.length;
    const variableDebugInfo: VMDebugVariableInfo = {
      name: varDecl.identifier.name,
      type: formatTypeForDebug(varType),
      startInstruction: currentInstruction,
      endInstruction: -1, // Will be set when scope ends, for now use -1 to indicate "until function end"
      location: {
        type: 'register',
        index: reg
      }
    };
    context.debug.variables.push(variableDebugInfo);
  }

  const wrapInCaptured = shouldWrapCapturedMutable(varDecl, context);
  if (vmDebugEnabled() && varDecl.initializer) {
    dbg('Var init', { name: varDecl.identifier.name, kind: varDecl.initializer.kind, annotatedType: formatTypeForDebug(varType) });
  }
  generateInitializerIntoRegister(varDecl, varType, reg, context);

  if (wrapInCaptured) {
    emitWrapRegisterWithCurrentValue(reg, context);
  }
}

function generateInitializerIntoRegister(
  varDecl: VariableDeclaration,
  targetType: Type,
  targetReg: number,
  context: CompilationContext
): void {
  if (varDecl.initializer) {
    if (varDecl.initializer.kind === 'literal' && targetType.kind === 'primitive') {
      const literal = varDecl.initializer as Literal;
      if (literal.literalType === 'number') {
        generateTypedNumericLiteral(literal, targetType.type, targetReg, context);
        return;
      }
    }

    generateExpression(varDecl.initializer, targetReg, context);
    const initType = getExpressionType(varDecl.initializer, context);
    if (needsTypeConversion(initType, targetType)) {
      const tempReg = context.registerAllocator.allocate();
      emit('MOVE', tempReg, targetReg, 0, context);
      generateTypeConversion(tempReg, initType, targetType, targetReg, context);
      context.registerAllocator.free(tempReg);
    }
  } else {
    emit('LOADK_NULL', targetReg, 0, 0, context);
  }
}

/**
 * Generate code for an if statement
 */
export function generateIfStatement(ifStmt: IfStatement, context: CompilationContext): void {
  const thenLabel = createLabel(context);
  const elseLabel = createLabel(context);
  const endLabel = createLabel(context);

  // Use flow-managed conditional generation - no register allocation needed
  generateConditional(ifStmt.condition, thenLabel, elseLabel, context);

  // Generate then statement
  setLabel(thenLabel, context);
  generateStatement(ifStmt.thenStatement, context);
  
  if (ifStmt.elseStatement) {
    // Jump to end after then statement
    emitJump('JMP', 0, endLabel, context);
    
    // Generate else statement
    setLabel(elseLabel, context);
    generateStatement(ifStmt.elseStatement, context);
  } else {
    setLabel(elseLabel, context);
  }

  setLabel(endLabel, context);
}

/**
 * Generate code for a while statement
 */
export function generateWhileStatement(whileStmt: WhileStatement, context: CompilationContext): void {
  const loopStart = createLabel(context);
  const loopBody = createLabel(context);
  const loopEnd = createLabel(context);

  // Push loop context for break/continue
  context.loopContextStack.push({
    continueLabel: loopStart,  // continue jumps to loop start (condition check)
    breakLabel: loopEnd,       // break jumps to loop end
    loopType: 'while'
  });

  setLabel(loopStart, context);
  
  // Use flow-managed conditional generation - no register allocation needed
  generateConditional(whileStmt.condition, loopBody, loopEnd, context);

  setLabel(loopBody, context);
  generateStatement(whileStmt.body, context);
  emitJump('JMP', 0, loopStart, context);
  
  setLabel(loopEnd, context);

  // Pop loop context
  context.loopContextStack.pop();
}

/**
 * Generate code for a for statement
 */
export function generateForStatement(forStmt: ForStatement, context: CompilationContext): void {
  // Generate initialization
  if (forStmt.init) {
    if (forStmt.init.kind === 'variable') {
      generateVariableDeclaration(forStmt.init as VariableDeclaration, context);
    } else {
      // Use a dummy register for init expression since we don't need its result
      const initReg = context.registerAllocator.allocate();
      generateExpression(forStmt.init as Expression, initReg, context);
      context.registerAllocator.free(initReg);
    }
  }

  const loopStart = createLabel(context);
  const loopBody = createLabel(context);
  const loopContinue = createLabel(context);
  const loopEnd = createLabel(context);

  // Push loop context for break/continue
  context.loopContextStack.push({
    continueLabel: loopContinue,  // continue jumps to update expression
    breakLabel: loopEnd,          // break jumps to loop end
    loopType: 'for'
  });

  setLabel(loopStart, context);

  // Generate condition check using flow-managed conditionals
  if (forStmt.condition) {
    generateConditional(forStmt.condition, loopBody, loopEnd, context);
  } else {
    // No condition means infinite loop, fall through to body
    emitJump('JMP', 0, loopBody, context);
  }

  // Generate body
  setLabel(loopBody, context);
  generateStatement(forStmt.body, context);

  // Continue label - where continue statements jump to
  setLabel(loopContinue, context);

  // Generate update
  if (forStmt.update) {
    const updateReg = context.registerAllocator.allocate();
    generateExpression(forStmt.update, updateReg, context);
    context.registerAllocator.free(updateReg);
  }

  emitJump('JMP', 0, loopStart, context);
  setLabel(loopEnd, context);

  // Pop loop context
  context.loopContextStack.pop();
}

/**
 * Generate code for a for-of statement
 */
export function generateForOfStatement(forOfStmt: ForOfStatement, context: CompilationContext): void {
  // Check if the iterable is a range expression
  if (forOfStmt.iterable.kind === 'range') {
    const rangeExpr = forOfStmt.iterable as RangeExpression;
    
    // Allocate register for the loop variable
    const loopVarReg = context.registerAllocator.allocateVariable(forOfStmt.variable.name);
    
    // Allocate registers for start and end values
    const startReg = context.registerAllocator.allocate();
    const endReg = context.registerAllocator.allocate();
    const tempReg = context.registerAllocator.allocate();
    
    // Generate start and end expressions
    generateExpression(rangeExpr.start, startReg, context);
    generateExpression(rangeExpr.end, endReg, context);
    
    // Initialize loop variable to start value
    emit('MOVE', loopVarReg, startReg, 0, context);
    
    // Create labels for loop control
    const loopStart = createLabel(context);
    const loopContinue = createLabel(context);
    const loopEnd = createLabel(context);

    // Push loop context for break/continue
    context.loopContextStack.push({
      continueLabel: loopContinue,  // continue jumps to increment
      breakLabel: loopEnd,          // break jumps to loop end
      loopType: 'forOf'
    });
    
    setLabel(loopStart, context);
    
    // Generate condition: loopVar < end (for exclusive) or loopVar <= end (for inclusive)
    if (rangeExpr.inclusive) {
      // loopVar <= end: check if loopVar > end, jump if true
      emit('LT_INT', tempReg, endReg, loopVarReg, context); // tempReg = end < loopVar (i.e., loopVar > end)
    } else {
      // loopVar < end: check if loopVar >= end, jump if true  
      emit('LT_INT', tempReg, loopVarReg, endReg, context); // tempReg = loopVar < end
      emit('NOT_BOOL', tempReg, tempReg, 0, context); // tempReg = !(loopVar < end) = loopVar >= end
    }
    emitJump('JMP_IF_TRUE', tempReg, loopEnd, context);
    
    // Generate loop body
    generateStatement(forOfStmt.body, context);
    
    // Continue label - where continue statements jump to
    setLabel(loopContinue, context);

    // Increment loop variable
    emit('LOADK_INT16', tempReg, 0, 1, context); // tempReg = 1
    emit('ADD_INT', loopVarReg, loopVarReg, tempReg, context); // loopVar++
    
    // Jump back to loop start
    emitJump('JMP', 0, loopStart, context);
    
    setLabel(loopEnd, context);

    // Pop loop context
    context.loopContextStack.pop();
    
    // Free temporary registers
    context.registerAllocator.free(startReg);
    context.registerAllocator.free(endReg);
    context.registerAllocator.free(tempReg);
  } else {
    // Handle array, set, and map iteration using iterators
    emitIteratorForOf(forOfStmt, context, generateStatement);
  }
}

/**
 * Generate code for a return statement
 */
export function generateReturnStatement(returnStmt: ReturnStatement, context: CompilationContext): void {
  if (returnStmt.argument) {
    // Generate return value directly into r0 (reserved for function returns)
    generateExpression(returnStmt.argument, 0, context);
    emit('RETURN', 0, 0, 0, context);
  } else {
    emit('LOADK_NULL', 0, 0, 0, context);
    emit('RETURN', 0, 0, 0, context);
  }
}

/**
 * Generate code for a block statement
 */
export function generateBlockStatement(block: BlockStatement, context: CompilationContext): void {
  for (const stmt of block.body) {
    generateStatement(stmt, context);
  }
}

/**
 * Generate code for a break statement
 */
export function generateBreakStatement(context: CompilationContext): void {
  if (context.loopContextStack.length === 0) {
    throw new Error('Break statement outside of loop');
  }
  const currentLoop = context.loopContextStack[context.loopContextStack.length - 1];
  emitJump('JMP', 0, currentLoop.breakLabel, context);
}

/**
 * Generate code for a continue statement
 */
export function generateContinueStatement(context: CompilationContext): void {
  if (context.loopContextStack.length === 0) {
    throw new Error('Continue statement outside of loop');
  }
  const currentLoop = context.loopContextStack[context.loopContextStack.length - 1];
  if (currentLoop.loopType === 'switch') {
    throw new Error('Continue statement not allowed inside switch');
  }
  emitJump('JMP', 0, currentLoop.continueLabel, context);
}

/**
 * Resolve pending jumps by updating instruction offsets
 */
export function resolvePendingJumps(context: CompilationContext): void {
  for (const jump of context.pendingJumps) {
    const targetAddress = context.labels.get(jump.labelName);
    if (targetAddress !== undefined) {
      let offset: number;
      const jumpInstruction = jump.instructionIndex < context.instructions.length ? context.instructions[jump.instructionIndex] : null;
      if (jumpInstruction && (jumpInstruction.opcode === 'JMP' || jumpInstruction.opcode === 'JMP_IF_FALSE' || jumpInstruction.opcode === 'JMP_IF_TRUE')) {
        // These opcodes add offset to current IP, not next IP
        offset = targetAddress - jump.instructionIndex;
      } else {
        // Other jump instructions use standard relative offset
        offset = targetAddress - (jump.instructionIndex + 1);
      }
      
      const instruction = context.instructions[jump.instructionIndex];
      
      // Other jump instructions use register + 16-bit offset (b, c fields)
      // Handle signed 16-bit offset (range: -32768 to 32767)
      if (offset < -32768 || offset > 32767) {
        throw new Error(`Jump offset ${offset} out of range for 16-bit signed value`);
      }
      const offsetValue = offset < 0 ? (offset + (1 << 16)) : offset;
      instruction.b = (offsetValue >> 8) & 0xFF;
      instruction.c = offsetValue & 0xFF;
    }
  }
}

/**
 * Get the type of a variable declaration
 */
function getVariableType(varDecl: VariableDeclaration, context: CompilationContext): Type {
  if (varDecl.type) {
    return varDecl.type;
  }
  
  // Try to infer from initializer
  if (varDecl.initializer) {
    return getExpressionType(varDecl.initializer, context);
  }

  // Default to any/void
  return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
}

/**
 * Check if type conversion is needed between source and target types
 */
function needsTypeConversion(sourceType: Type, targetType: Type): boolean {
  if (sourceType.kind !== 'primitive' || targetType.kind !== 'primitive') {
    return false;
  }
  
  const source = sourceType as PrimitiveTypeNode;
  const target = targetType as PrimitiveTypeNode;
  
  return source.type !== target.type;
}

/**
 * Generate type conversion instructions
 */
function generateTypeConversion(sourceReg: number, sourceType: Type, targetType: Type, targetReg: number, context: CompilationContext): void {
  if (sourceType.kind !== 'primitive' || targetType.kind !== 'primitive') {
    // For non-primitive types, just move the value
    emit('MOVE', targetReg, sourceReg, 0, context);
    return;
  }
  
  const source = sourceType as PrimitiveTypeNode;
  const target = targetType as PrimitiveTypeNode;
  
  // Handle numeric conversions
  if (source.type === 'float' && target.type === 'int') {
    emit('FLOAT_TO_INT', targetReg, sourceReg, 0, context);
  } else if (source.type === 'double' && target.type === 'int') {
    emit('DOUBLE_TO_INT', targetReg, sourceReg, 0, context);
  } else if (source.type === 'int' && target.type === 'float') {
    emit('INT_TO_FLOAT', targetReg, sourceReg, 0, context);
  } else if (source.type === 'int' && target.type === 'double') {
    emit('INT_TO_DOUBLE', targetReg, sourceReg, 0, context);
  } else if (source.type === 'float' && target.type === 'double') {
    emit('FLOAT_TO_DOUBLE', targetReg, sourceReg, 0, context);
  } else if (source.type === 'double' && target.type === 'float') {
    emit('DOUBLE_TO_FLOAT', targetReg, sourceReg, 0, context);
  } else {
    // For all other cases (including same type), just move the value
    emit('MOVE', targetReg, sourceReg, 0, context);
  }
}

/**
 * Generate code for a switch statement
 */
export function generateSwitchStatement(switchStmt: SwitchStatement, context: CompilationContext): void {
  const discriminantReg = context.registerAllocator.allocate();
  generateExpression(switchStmt.discriminant, discriminantReg, context);
  const discriminantType = getExpressionType(switchStmt.discriminant, context);

  const endLabel = createLabel(context);
  const caseLabels: string[] = [];
  let defaultIndex: number | undefined;

  for (let i = 0; i < switchStmt.cases.length; i++) {
    const label = createLabel(context);
    caseLabels.push(label);
    if (switchStmt.cases[i].isDefault) {
      defaultIndex = i;
    }
  }

  context.loopContextStack.push({
    continueLabel: endLabel,
    breakLabel: endLabel,
    loopType: 'switch'
  });

  for (let i = 0; i < switchStmt.cases.length; i++) {
    const switchCase = switchStmt.cases[i];
    if (switchCase.isDefault) {
      continue;
    }

    for (const test of switchCase.tests) {
      const matchReg = test.kind === 'range'
        ? emitRangeMatch(discriminantReg, discriminantType, test as RangeExpression, context)
        : emitEqualityMatch(discriminantReg, discriminantType, test as Expression, context);
      emitJump('JMP_IF_TRUE', matchReg, caseLabels[i], context);
      context.registerAllocator.free(matchReg);
    }
  }

  if (defaultIndex !== undefined) {
    emitJump('JMP', 0, caseLabels[defaultIndex], context);
  } else {
    emitJump('JMP', 0, endLabel, context);
  }

  for (let i = 0; i < switchStmt.cases.length; i++) {
    const switchCase = switchStmt.cases[i];
    setLabel(caseLabels[i], context);

    for (const stmt of switchCase.body) {
      generateStatement(stmt, context);
    }

    emitJump('JMP', 0, endLabel, context);
  }

  setLabel(endLabel, context);
  context.loopContextStack.pop();
  context.registerAllocator.free(discriminantReg);
}

function emitEqualityMatch(
  discriminantReg: number,
  discriminantType: Type,
  testExpr: Expression,
  context: CompilationContext
): number {
  if (testExpr.kind === 'literal' && (testExpr as Literal).literalType === 'null') {
    setSourceLocationFromNode(testExpr, context);
    const resultReg = context.registerAllocator.allocate();
    emit('IS_NULL', resultReg, discriminantReg, 0, context);
    return resultReg;
  }

  const testReg = context.registerAllocator.allocate();
  generateExpression(testExpr, testReg, context);
  const testType = getExpressionType(testExpr, context);
  const operandType = determineComparisonType(discriminantType, testType);
  const opcode = selectEqualityOpcode(operandType, context);

  const resultReg = context.registerAllocator.allocate();
  emit(opcode, resultReg, discriminantReg, testReg, context);

  context.registerAllocator.free(testReg);
  return resultReg;
}

function emitRangeMatch(
  discriminantReg: number,
  discriminantType: Type,
  rangeExpr: RangeExpression,
  context: CompilationContext
): number {
  const startReg = context.registerAllocator.allocate();
  generateExpression(rangeExpr.start, startReg, context);
  const endReg = context.registerAllocator.allocate();
  generateExpression(rangeExpr.end, endReg, context);

  const operandType = determineComparisonType(
    discriminantType,
    getExpressionType(rangeExpr.start, context),
    getExpressionType(rangeExpr.end, context)
  );

  const lessThanOpcode = selectLessThanOpcode(operandType);

  const lowerCmpReg = context.registerAllocator.allocate();
  emit(lessThanOpcode, lowerCmpReg, discriminantReg, startReg, context);
  const lowerOkReg = context.registerAllocator.allocate();
  emit('NOT_BOOL', lowerOkReg, lowerCmpReg, 0, context);
  context.registerAllocator.free(lowerCmpReg);

  let resultReg: number;
  if (rangeExpr.inclusive) {
    const upperCmpReg = context.registerAllocator.allocate();
    emit(lessThanOpcode, upperCmpReg, endReg, discriminantReg, context);
    const upperOkReg = context.registerAllocator.allocate();
    emit('NOT_BOOL', upperOkReg, upperCmpReg, 0, context);
    context.registerAllocator.free(upperCmpReg);

    resultReg = context.registerAllocator.allocate();
    emit('AND_BOOL', resultReg, lowerOkReg, upperOkReg, context);
    context.registerAllocator.free(lowerOkReg);
    context.registerAllocator.free(upperOkReg);
  } else {
    const upperCmpReg = context.registerAllocator.allocate();
    emit(lessThanOpcode, upperCmpReg, discriminantReg, endReg, context);
    resultReg = context.registerAllocator.allocate();
    emit('AND_BOOL', resultReg, lowerOkReg, upperCmpReg, context);
    context.registerAllocator.free(lowerOkReg);
    context.registerAllocator.free(upperCmpReg);
  }

  context.registerAllocator.free(startReg);
  context.registerAllocator.free(endReg);
  return resultReg;
}

function determineComparisonType(baseType: Type, ...otherTypes: Type[]): Type {
  let current = resolveComparableType(baseType);
  for (const other of otherTypes) {
    current = mergeComparisonTypes(current, resolveComparableType(other));
  }
  return current;
}

function resolveComparableType(type: Type): Type {
  if (type.kind === 'union') {
    for (const candidate of type.types) {
      if (!(candidate.kind === 'primitive' && candidate.type === 'null')) {
        return resolveComparableType(candidate);
      }
    }
    return type.types[0] ?? type;
  }
  return type;
}

function mergeComparisonTypes(left: Type, right: Type): Type {
  if (left.kind === 'primitive' && right.kind === 'primitive') {
    const promoted = getPromotedType(left, right);
    if (promoted.kind === 'primitive' && promoted.type === 'void') {
      throw new Error(`Unsupported switch comparison between '${formatTypeForDebug(left)}' and '${formatTypeForDebug(right)}'`);
    }
    return promoted;
  }

  if (left.kind === right.kind) {
    return left;
  }

  if (left.kind === 'primitive') {
    return left;
  }

  if (right.kind === 'primitive') {
    return right;
  }

  return left;
}

function selectEqualityOpcode(type: Type, context: CompilationContext): string {
  if (type.kind === 'primitive') {
    switch (type.type) {
      case 'string':
        return 'EQ_STRING';
      case 'char':
        return 'EQ_CHAR';
      case 'bool':
        return 'EQ_BOOL';
      case 'float':
        return 'EQ_FLOAT';
      case 'double':
        return 'EQ_DOUBLE';
      case 'int':
        return 'EQ_INT';
      case 'null':
      case 'void':
        throw new Error(`Unsupported switch comparison for type '${type.type}'`);
      default:
        return 'EQ_INT';
    }
  }

  if (type.kind === 'class' || type.kind === 'externClass') {
    return 'EQ_OBJECT';
  }

  if (type.kind === 'enum') {
    // Determine backing representation: if any member has a string literal value, use string equality
    const validationContext = getActiveValidationContext(context);
    const decl = validationContext?.enums.get(type.name);
    if (decl) {
      const hasString = decl.members.some(m => !!m.value && (m.value as any).literalType === 'string');
      return hasString ? 'EQ_STRING' : 'EQ_INT';
    }
    return 'EQ_INT';
  }

  throw new Error(`Unsupported switch comparison for type kind '${type.kind}'`);
}

function selectLessThanOpcode(type: Type): string {
  if (type.kind === 'primitive') {
    switch (type.type) {
      case 'int':
        return 'LT_INT';
      case 'float':
        return 'LT_FLOAT';
      case 'double':
        return 'LT_DOUBLE';
      case 'char':
        return 'LT_CHAR';
      case 'string':
        return 'LT_STRING';
      case 'bool':
        return 'LT_BOOL';
      case 'null':
      case 'void':
        throw new Error(`Unsupported switch range comparison for type '${type.type}'`);
      default:
        return 'LT_INT';
    }
  }

  if (type.kind === 'enum') {
    return 'LT_INT';
  }

  throw new Error(`Unsupported switch range comparison for type kind '${type.kind}'`);
}
