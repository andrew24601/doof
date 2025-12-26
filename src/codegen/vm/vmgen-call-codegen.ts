/**
 * Generate instance method call using standard CALL mechanism with 'this' as first parameter.
 */

import { getExpressionId } from "../../type-utils";
import { CallExpression, Expression, MemberExpression, MapTypeNode, SetTypeNode, Type, ExternClassDeclaration } from "../../types";
import { CompilationContext, VMFunctionMetadata, VMValue, getActiveValidationContext } from "../vmgen";
import { addConstant, emit, findClassInConstantPool, emitJump, createLabel, setLabel } from "./vmgen-emit";
import { generateExpression, generateExpressionOptimal } from "./vmgen-expression-codegen";
import { getExpressionType, isIntType } from "./vmgen-type-utils";
import { ensureArrayIntrinsicSupport } from "./vmgen-array-intrinsics";

/**
 * Generates arguments into contiguous parameter registers with proper evaluation order.
 * If the call has reordering metadata (from named arguments in different order),
 * arguments are evaluated in lexical order but placed in positional parameter slots.
 * Returns the starting register for the parameter block.
 */
export function generateArgumentsWithEvaluationOrder(
    call: CallExpression,
    args: Expression[],
    context: CompilationContext
): { paramStartReg: number; argCount: number } {
    if (args.length === 0) {
        return { paramStartReg: 0, argCount: 0 };
    }

    // Check if we have reordering metadata from named arguments
    const lexicalOrder = call.namedArgumentsLexicalOrder;
    
    if (!lexicalOrder || lexicalOrder.length === 0) {
        // No reordering needed - standard argument generation
        const paramStartReg = context.registerAllocator.allocateContiguous(args.length);
        for (let i = 0; i < args.length; i++) {
            const paramReg = paramStartReg + i;
            generateExpression(args[i], paramReg, context);
        }
        return { paramStartReg, argCount: args.length };
    }

    // Check if any arguments actually need temporaries
    const anyNeedsTemp = lexicalOrder.some(arg => arg.needsTemp);
    
    if (!anyNeedsTemp) {
        // All arguments are side-effect-free, standard generation is fine
        const paramStartReg = context.registerAllocator.allocateContiguous(args.length);
        for (let i = 0; i < args.length; i++) {
            const paramReg = paramStartReg + i;
            generateExpression(args[i], paramReg, context);
        }
        return { paramStartReg, argCount: args.length };
    }

    // Need to preserve evaluation order:
    // 1. Allocate temp registers for lexical order evaluation
    // 2. Evaluate in lexical order into temps
    // 3. Allocate final parameter registers
    // 4. Move from temps to final positions

    // Allocate temp registers (one for each argument)
    const tempRegs: number[] = [];
    for (let i = 0; i < lexicalOrder.length; i++) {
        tempRegs.push(context.registerAllocator.allocate());
    }

    // Evaluate in lexical order into temps
    for (let i = 0; i < lexicalOrder.length; i++) {
        generateExpression(lexicalOrder[i].expression, tempRegs[i], context);
    }

    // Allocate final parameter registers
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);

    // Move temps to final parameter positions
    for (let i = 0; i < lexicalOrder.length; i++) {
        const targetParamReg = paramStartReg + lexicalOrder[i].paramIndex;
        emit('MOVE', targetParamReg, tempRegs[i], 0, context);
    }

    // Free temp registers
    for (const reg of tempRegs) {
        context.registerAllocator.free(reg);
    }

    return { paramStartReg, argCount: args.length };
}

/**
 * Frees the contiguous parameter registers allocated for a call.
 */
export function freeArgumentRegisters(paramStartReg: number, argCount: number, context: CompilationContext): void {
    for (let i = 0; i < argCount; i++) {
        context.registerAllocator.free(paramStartReg + i);
    }
}

/**
 * Helper function to determine the type category for maps and sets.
 * Returns 'int' if the type is an integer, otherwise 'string'.
 */
function getTypeCategory(type: Type | undefined): 'int' | 'string' {
    if (!type) return 'string';
    return isIntType(type) ? 'int' : 'string';
}

function getExternClassDeclaration(className: string, context: CompilationContext): ExternClassDeclaration | undefined {
  const activeValidationContext = getActiveValidationContext(context);
  if (activeValidationContext?.externClasses.has(className)) {
    return activeValidationContext.externClasses.get(className);
  }

  if (context.validationContexts) {
    for (const validationContext of context.validationContexts.values()) {
      const decl = validationContext.externClasses.get(className);
      if (decl) {
        return decl;
      }
    }
  }

  return undefined;
}

function resolveExternFunctionName(className: string, methodName: string): string {
  return `${className}::${methodName}`;
}

/**
 * Generate map method call using specific map opcodes
 */
export function generateMapMethodCall(
  mapExpr: Expression,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const allocatedRegs: number[] = [];
  const mapReg = generateExpressionOptimal(mapExpr, allocatedRegs, context);

  // Get map key type from inferred type
  const mapType = getExpressionType(mapExpr, context);
  const keyTypeCategory = mapType.kind === 'map' ? getTypeCategory((mapType as MapTypeNode).keyType) : 'string';

  const getMapOpcode = keyTypeCategory === 'int' ? 'GET_MAP_INT' : 'GET_MAP';
  const setMapOpcode = keyTypeCategory === 'int' ? 'SET_MAP_INT' : 'SET_MAP';
  const hasKeyOpcode = keyTypeCategory === 'int' ? 'HAS_KEY_MAP_INT' : 'HAS_KEY_MAP';
  const deleteMapOpcode = keyTypeCategory === 'int' ? 'DELETE_MAP_INT' : 'DELETE_MAP';

  switch (methodName) {
    case 'get':
      if (args.length === 1) {
        const keyReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(getMapOpcode, targetReg, mapReg, keyReg, context);
      } else {
        emit('LOADK_NULL', targetReg, 0, 0, context);
      }
      break;

    case 'set':
      if (args.length === 2) {
        const keyReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        const valueReg = generateExpressionOptimal(args[1], allocatedRegs, context);
        emit(setMapOpcode, mapReg, keyReg, valueReg, context);
        // set() returns void, but for chaining compatibility, return the map
        if (targetReg !== mapReg) {
          emit('MOVE', targetReg, mapReg, 0, context);
        }
      } else {
        emit('LOADK_NULL', targetReg, 0, 0, context);
      }
      break;

    case 'has':
      if (args.length === 1) {
        const keyReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(hasKeyOpcode, targetReg, mapReg, keyReg, context);
      } else {
        emit('LOADK_BOOL', targetReg, 0, 0, context); // false
      }
      break;

    case 'delete':
      if (args.length === 1) {
        const keyReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(deleteMapOpcode, targetReg, mapReg, keyReg, context);
      } else {
        emit('LOADK_BOOL', targetReg, 0, 0, context); // false
      }
      break;

    case 'clear':
      emit('CLEAR_MAP', mapReg, 0, 0, context);
      // clear() returns void, but for chaining compatibility, return the map
      if (targetReg !== mapReg) {
        emit('MOVE', targetReg, mapReg, 0, context);
      }
      break;

    case 'keys':
      emit('KEYS_MAP', targetReg, mapReg, 0, context);
      break;

    case 'values':
      emit('VALUES_MAP', targetReg, mapReg, 0, context);
      break;

    default:
      // Unknown map method
      emit('LOADK_NULL', targetReg, 0, 0, context);
      break;
  }

  // Free allocated registers
  for (const reg of allocatedRegs) {
    context.registerAllocator.free(reg);
  }
}

/**
 * Generate set method call using specific set opcodes
 */
export function generateSetMethodCall(
  setExpr: Expression,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const allocatedRegs: number[] = [];
  const setReg = generateExpressionOptimal(setExpr, allocatedRegs, context);

  // Get set element type from inferred type
  const setType = getExpressionType(setExpr, context);
  const elementTypeCategory = setType.kind === 'set' ? getTypeCategory((setType as SetTypeNode).elementType) : 'string';

  const addSetOpcode = elementTypeCategory === 'int' ? 'ADD_SET_INT' : 'ADD_SET';
  const hasSetOpcode = elementTypeCategory === 'int' ? 'HAS_SET_INT' : 'HAS_SET';
  const deleteSetOpcode = elementTypeCategory === 'int' ? 'DELETE_SET_INT' : 'DELETE_SET';

  switch (methodName) {
    case 'add':
      if (args.length === 1) {
        const valueReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(addSetOpcode, targetReg, setReg, valueReg, context);
      } else {
        emit('LOADK_NULL', targetReg, 0, 0, context);
      }
      break;

    case 'has':
      if (args.length === 1) {
        const valueReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(hasSetOpcode, targetReg, setReg, valueReg, context);
      } else {
        emit('LOADK_BOOL', targetReg, 0, 0, context); // false
      }
      break;

    case 'delete':
      if (args.length === 1) {
        const valueReg = generateExpressionOptimal(args[0], allocatedRegs, context);
        emit(deleteSetOpcode, targetReg, setReg, valueReg, context);
      } else {
        emit('LOADK_BOOL', targetReg, 0, 0, context); // false
      }
      break;

    case 'clear':
      emit('CLEAR_SET', setReg, 0, 0, context);
      // clear() returns void, but for chaining compatibility, return the set
      if (targetReg !== setReg) {
        emit('MOVE', targetReg, setReg, 0, context);
      }
      break;

    case 'toArray':
      emit('TO_ARRAY_SET', targetReg, setReg, 0, context);
      break;

    default:
      // Unknown set method
      emit('LOADK_NULL', targetReg, 0, 0, context);
      break;
  }

  // Free allocated registers
  for (const reg of allocatedRegs) {
    context.registerAllocator.free(reg);
  }
}

/**
 * Generate array method call using external function calls
 */
export function generateArrayMethodCall(
  arrayExpr: Expression,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  // Validate supported array methods
  const supportedMethods = ['push', 'pop', 'length', 'filter', 'map', 'forEach', 'reduce'];
  if (!supportedMethods.includes(methodName)) {
    throw new Error(`Unsupported array method: ${methodName}(). Supported methods: ${supportedMethods.join(', ')}`);
  }

  // Validate argument count for each method
  switch (methodName) {
    case 'push':
      if (args.length !== 1) {
        throw new Error(`Array.push() expects exactly 1 argument, got ${args.length}`);
      }
      break;
    case 'pop':
      if (args.length !== 0) {
        throw new Error(`Array.pop() expects no arguments, got ${args.length}`);
      }
      break;
    case 'length':
      if (args.length !== 0) {
        throw new Error(`Array.length expects no arguments, got ${args.length}`);
      }
      break;
    case 'filter':
      if (args.length !== 1) {
        throw new Error(`Array.filter() expects exactly 1 argument (predicate function), got ${args.length}`);
      }
      break;
    case 'map':
      if (args.length !== 1) {
        throw new Error(`Array.map() expects exactly 1 argument (mapper function), got ${args.length}`);
      }
      break;
    case 'forEach':
      if (args.length !== 1) {
        throw new Error(`Array.forEach() expects exactly 1 argument (callback function), got ${args.length}`);
      }
      break;
    case 'reduce':
      if (args.length !== 2) {
        throw new Error(`Array.reduce() requires exactly 2 arguments (initial value, reducer function), got ${args.length}`);
      }
      break;
  }

  // Handle intrinsic methods with support function calls
  if (['filter', 'map', 'forEach', 'reduce'].includes(methodName)) {
    generateArrayIntrinsicCall(arrayExpr, methodName, args, targetReg, context);
    return;
  }

  // Legacy extern call handling for push, pop, length
  const externFuncName = `Array::${methodName}`;

  // Calculate total parameters: array object + method arguments
  const totalParams = 1 + args.length;
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  // Generate array object into first parameter register
  generateExpression(arrayExpr, paramStartReg, context);

  // Generate method arguments into subsequent parameter registers
  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  // Call external function
  generateExternCall(externFuncName, [], context, paramStartReg);

  // Move return value from r0 to target register
  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  // Free parameter registers
  for (let i = 0; i < totalParams; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }
}

/**
 * Generate call to array intrinsic support function
 */
function generateArrayIntrinsicCall(
  arrayExpr: Expression,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  // Ensure the support function is generated and get its metadata
  const supportMetadata = ensureArrayIntrinsicSupport(methodName, context);
  
  // For reduce, enforce that initial value is always provided
  if (methodName === 'reduce' && args.length !== 2) {
    throw new Error(`Array.reduce() requires exactly 2 arguments (initial value, reducer function), got ${args.length}`);
  }
  
  // Calculate parameter count and allocate registers
  // Support function signature is: (array, initialValue, reducer)
  const paramCount = methodName === 'reduce' ? 3 : 2; // array + initialValue + reducer
  const paramStartReg = context.registerAllocator.allocateContiguous(paramCount);
  
  // Generate array expression into first parameter register
  generateExpression(arrayExpr, paramStartReg, context);
  
  // For non-reduce methods the second parameter is the lambda
  if (methodName !== 'reduce') {
    generateExpression(args[0], paramStartReg + 1, context);
  } else {
    // For reduce, new call order: initialValue, reducer
    // param layout: r1=array, r2=initialValue, r3=reducer
    generateExpression(args[0], paramStartReg + 1, context); // initial value
    generateExpression(args[1], paramStartReg + 2, context); // reducer
  }
  
  // Add support function to constant pool and emit call
  const funcConstantValue: VMValue = {
    type: 'function',
    value: supportMetadata
  };
  const funcIndex = addConstant(funcConstantValue, context);
  
  // CALL paramStartReg, funcIndex
  emit('CALL', paramStartReg, Math.floor(funcIndex / 256), funcIndex % 256, context);
  
  // Move return value from r0 to target register
  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }
  
  // Free parameter registers
  for (let i = 0; i < paramCount; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }
}



/**
 * Generate bytecode for Array.filter()
 */
function generateArrayFilter(
  arrayExpr: Expression,
  predicateExpr: Expression,
  targetReg: number,
  context: CompilationContext
): void {
  // Allocate registers for loop state
  const arrayReg = context.registerAllocator.allocate();
  const predicateReg = context.registerAllocator.allocate();
  const lengthReg = context.registerAllocator.allocate();
  const indexReg = context.registerAllocator.allocate();
  const elementReg = context.registerAllocator.allocate();
  const resultReg = context.registerAllocator.allocate();
  const tempReg = context.registerAllocator.allocate();
  const oneReg = context.registerAllocator.allocate();

  // Generate expressions
  generateExpression(arrayExpr, arrayReg, context);
  generateExpression(predicateExpr, predicateReg, context);

  // Create new output array
  emit('NEW_ARRAY', targetReg, 0, 0, context);
  
  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Initialize index to 0
  emit('LOADK_INT16', indexReg, 0, 0, context);
  
  // Load constant 1 for incrementing
  emit('LOADK_INT16', oneReg, 0, 1, context);

  // Loop start label
  const loopStart = createLabel(context);
  setLabel(loopStart, context);

  // Check if index < length
  emit('LT_INT', tempReg, indexReg, lengthReg, context);
  const loopEnd = createLabel(context);
  emitJump('JMP_IF_FALSE', tempReg, loopEnd, context);

  // Get current element: element = array[index]
  emit('GET_ARRAY', elementReg, arrayReg, indexReg, context);

  // Prepare lambda arguments: (element, index, array)
  const paramStartReg = context.registerAllocator.allocateContiguous(3);
  emit('MOVE', paramStartReg, elementReg, 0, context);
  emit('MOVE', paramStartReg + 1, indexReg, 0, context);
  emit('MOVE', paramStartReg + 2, arrayReg, 0, context);

  // Call predicate lambda
  emit('INVOKE_LAMBDA', paramStartReg, predicateReg, 3, context);
  
  // Free lambda parameter registers
  for (let i = 0; i < 3; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }

  // If result is truthy, add element to output array
  const skipAdd = createLabel(context);
  emitJump('JMP_IF_FALSE', 0, skipAdd, context); // Result is in r0

  // Push element to output array using Array::push
  const pushArgsReg = context.registerAllocator.allocateContiguous(2);
  emit('MOVE', pushArgsReg, targetReg, 0, context);     // args[0] = array
  emit('MOVE', pushArgsReg + 1, elementReg, 0, context); // args[1] = element
  
  const pushNameIndex = addConstant({ type: 'string', value: 'Array::push' }, context);
  emit('EXTERN_CALL', pushArgsReg, 0, pushNameIndex, context);
  
  // Free push argument registers
  for (let i = 0; i < 2; i++) {
    context.registerAllocator.free(pushArgsReg + i);
  }

  // Mark skip label
  setLabel(skipAdd, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Free allocated registers
  context.registerAllocator.free(arrayReg);
  context.registerAllocator.free(predicateReg);
  context.registerAllocator.free(lengthReg);
  context.registerAllocator.free(indexReg);
  context.registerAllocator.free(elementReg);
  context.registerAllocator.free(resultReg);
  context.registerAllocator.free(tempReg);
  context.registerAllocator.free(oneReg);
}

function generateExternInstanceMethodCall(
  objectExpr: Expression,
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const externDecl = getExternClassDeclaration(className, context);
  if (!externDecl) {
    throw new Error(`Extern class '${className}' metadata not found for instance method call.`);
  }
  const method = externDecl.methods.find(m => m.name.name === methodName && !m.isStatic);
  if (!method) {
    throw new Error(`Instance method '${methodName}' not declared on extern class '${className}'.`);
  }

  const totalParams = 1 + args.length;
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  generateExpression(objectExpr, paramStartReg, context);
  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  const externFuncName = resolveExternFunctionName(className, methodName);
  generateExternCall(externFuncName, [], context, paramStartReg);

  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  context.registerAllocator.freeContiguous(paramStartReg, totalParams);
}

function generateExternInstanceMethodCallFromRegister(
  objectReg: number,
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const externDecl = getExternClassDeclaration(className, context);
  if (!externDecl) {
    throw new Error(`Extern class '${className}' metadata not found for instance method call.`);
  }
  const method = externDecl.methods.find(m => m.name.name === methodName && !m.isStatic);
  if (!method) {
    throw new Error(`Instance method '${methodName}' not declared on extern class '${className}'.`);
  }

  const totalParams = 1 + args.length;
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  emit('MOVE', paramStartReg, objectReg, 0, context);
  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  const externFuncName = resolveExternFunctionName(className, methodName);
  generateExternCall(externFuncName, [], context, paramStartReg);

  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  context.registerAllocator.freeContiguous(paramStartReg, totalParams);
}

function generateExternStaticMethodCall(
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const externDecl = getExternClassDeclaration(className, context);
  if (!externDecl) {
    throw new Error(`Extern class '${className}' metadata not found for static method call.`);
  }
  const method = externDecl.methods.find(m => m.name.name === methodName && m.isStatic);
  if (!method) {
    throw new Error(`Static method '${methodName}' not declared on extern class '${className}'.`);
  }

  if (args.length === 0) {
    const externFuncName = resolveExternFunctionName(className, methodName);
    generateExternCall(externFuncName, [], context);
  } else {
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);
    for (let i = 0; i < args.length; i++) {
      generateExpression(args[i], paramStartReg + i, context);
    }

    const externFuncName = resolveExternFunctionName(className, methodName);
    generateExternCall(externFuncName, [], context, paramStartReg);

    context.registerAllocator.freeContiguous(paramStartReg, args.length);
  }

  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }
}

/**
 * Generate bytecode for Array.map()
 */
function generateArrayMap(
  arrayExpr: Expression,
  mapperExpr: Expression,
  targetReg: number,
  context: CompilationContext
): void {
  // Allocate registers for loop state
  const arrayReg = context.registerAllocator.allocate();
  const mapperReg = context.registerAllocator.allocate();
  const lengthReg = context.registerAllocator.allocate();
  const indexReg = context.registerAllocator.allocate();
  const elementReg = context.registerAllocator.allocate();
  const tempReg = context.registerAllocator.allocate();
  const oneReg = context.registerAllocator.allocate();

  // Generate expressions
  generateExpression(arrayExpr, arrayReg, context);
  generateExpression(mapperExpr, mapperReg, context);

  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Create output array
  emit('NEW_ARRAY', targetReg, 0, 0, context);
  
  // Initialize index to 0
  emit('LOADK_INT16', indexReg, 0, 0, context);
  
  // Load constant 1 for incrementing
  emit('LOADK_INT16', oneReg, 0, 1, context);

  // Loop start label
  const loopStart = createLabel(context);
  setLabel(loopStart, context);

  // Check if index < length
  emit('LT_INT', tempReg, indexReg, lengthReg, context);
  const loopEnd = createLabel(context);
  emitJump('JMP_IF_FALSE', tempReg, loopEnd, context);

  // Get current element: element = array[index]
  emit('GET_ARRAY', elementReg, arrayReg, indexReg, context);

  // Prepare lambda arguments: (element, index, array)
  const paramStartReg = context.registerAllocator.allocateContiguous(3);
  emit('MOVE', paramStartReg, elementReg, 0, context);
  emit('MOVE', paramStartReg + 1, indexReg, 0, context);
  emit('MOVE', paramStartReg + 2, arrayReg, 0, context);

  // Call mapper lambda
  emit('INVOKE_LAMBDA', mapperReg, paramStartReg, 3, context);
  
  // Free lambda parameter registers
  for (let i = 0; i < 3; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }

  // Store mapped result: output[index] = result (r0)
  emit('SET_ARRAY', targetReg, indexReg, 0, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Free allocated registers
  context.registerAllocator.free(arrayReg);
  context.registerAllocator.free(mapperReg);
  context.registerAllocator.free(lengthReg);
  context.registerAllocator.free(indexReg);
  context.registerAllocator.free(elementReg);
  context.registerAllocator.free(tempReg);
  context.registerAllocator.free(oneReg);
}

/**
 * Generate bytecode for Array.forEach()
 */
function generateArrayForEach(
  arrayExpr: Expression,
  callbackExpr: Expression,
  targetReg: number,
  context: CompilationContext
): void {
  // Allocate registers for loop state
  const arrayReg = context.registerAllocator.allocate();
  const callbackReg = context.registerAllocator.allocate();
  const lengthReg = context.registerAllocator.allocate();
  const indexReg = context.registerAllocator.allocate();
  const elementReg = context.registerAllocator.allocate();
  const tempReg = context.registerAllocator.allocate();
  const oneReg = context.registerAllocator.allocate();

  // Generate expressions
  generateExpression(arrayExpr, arrayReg, context);
  generateExpression(callbackExpr, callbackReg, context);

  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Initialize index to 0
  emit('LOADK_INT16', indexReg, 0, 0, context);
  
  // Load constant 1 for incrementing
  emit('LOADK_INT16', oneReg, 0, 1, context);

  // Loop start label
  const loopStart = createLabel(context);
  setLabel(loopStart, context);

  // Check if index < length
  emit('LT_INT', tempReg, indexReg, lengthReg, context);
  const loopEnd = createLabel(context);
  emitJump('JMP_IF_FALSE', tempReg, loopEnd, context);

  // Get current element: element = array[index]
  emit('GET_ARRAY', elementReg, arrayReg, indexReg, context);

  // Prepare lambda arguments: (element, index, array)
  const paramStartReg = context.registerAllocator.allocateContiguous(3);
  emit('MOVE', paramStartReg, elementReg, 0, context);
  emit('MOVE', paramStartReg + 1, indexReg, 0, context);
  emit('MOVE', paramStartReg + 2, arrayReg, 0, context);

  // Call callback lambda (discard result)
  emit('INVOKE_LAMBDA', callbackReg, paramStartReg, 3, context);
  
  // Free lambda parameter registers
  for (let i = 0; i < 3; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // forEach returns undefined (load null)
  emit('LOADK_NULL', targetReg, 0, 0, context);

  // Free allocated registers
  context.registerAllocator.free(arrayReg);
  context.registerAllocator.free(callbackReg);
  context.registerAllocator.free(lengthReg);
  context.registerAllocator.free(indexReg);
  context.registerAllocator.free(elementReg);
  context.registerAllocator.free(tempReg);
  context.registerAllocator.free(oneReg);
}

/**
 * Generate bytecode for Array.reduce()
 */
function generateArrayReduce(
  arrayExpr: Expression,
  reducerExpr: Expression,
  initialValueExpr: Expression | null,
  targetReg: number,
  context: CompilationContext
): void {
  // Allocate registers for loop state
  const arrayReg = context.registerAllocator.allocate();
  const reducerReg = context.registerAllocator.allocate();
  const lengthReg = context.registerAllocator.allocate();
  const indexReg = context.registerAllocator.allocate();
  const elementReg = context.registerAllocator.allocate();
  const accReg = context.registerAllocator.allocate();
  const tempReg = context.registerAllocator.allocate();
  const oneReg = context.registerAllocator.allocate();

  // Generate expressions
  generateExpression(arrayExpr, arrayReg, context);
  generateExpression(reducerExpr, reducerReg, context);

  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Load constant 1 for incrementing
  emit('LOADK_INT16', oneReg, 0, 1, context);

  // Initialize accumulator and index
  if (initialValueExpr) {
    // Use provided initial value
    generateExpression(initialValueExpr, accReg, context);
    emit('LOADK_INT16', indexReg, 0, 0, context);
  } else {
    // Use first element as initial value, start from index 1
    emit('LOADK_INT16', tempReg, 0, 0, context);
    emit('GET_ARRAY', accReg, arrayReg, tempReg, context);
    emit('LOADK_INT16', indexReg, 0, 1, context);
  }

  // Loop start label
  const loopStart = createLabel(context);
  setLabel(loopStart, context);

  // Check if index < length
  emit('LT_INT', tempReg, indexReg, lengthReg, context);
  const loopEnd = createLabel(context);
  emitJump('JMP_IF_FALSE', tempReg, loopEnd, context);

  // Get current element: element = array[index]
  emit('GET_ARRAY', elementReg, arrayReg, indexReg, context);

  // Prepare lambda arguments: (accumulator, element, index, array)
  const paramStartReg = context.registerAllocator.allocateContiguous(4);
  emit('MOVE', paramStartReg, accReg, 0, context);
  emit('MOVE', paramStartReg + 1, elementReg, 0, context);
  emit('MOVE', paramStartReg + 2, indexReg, 0, context);
  emit('MOVE', paramStartReg + 3, arrayReg, 0, context);

  // Call reducer lambda
  emit('INVOKE_LAMBDA', reducerReg, paramStartReg, 4, context);
  
  // Free lambda parameter registers
  for (let i = 0; i < 4; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }

  // Update accumulator with result (r0)
  emit('MOVE', accReg, 0, 0, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Move final accumulator to target register
  if (targetReg !== accReg) {
    emit('MOVE', targetReg, accReg, 0, context);
  }

  // Free allocated registers
  context.registerAllocator.free(arrayReg);
  context.registerAllocator.free(reducerReg);
  context.registerAllocator.free(lengthReg);
  context.registerAllocator.free(indexReg);
  context.registerAllocator.free(elementReg);
  context.registerAllocator.free(accReg);
  context.registerAllocator.free(tempReg);
  context.registerAllocator.free(oneReg);
}

/**
 * Generate string method call using external function calls
 */
export function generateStringMethodCall(
  stringExpr: Expression,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  const externFuncName = `String::${methodName}`;

  // Calculate total parameters: string object + method arguments
  const totalParams = 1 + args.length;
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  // Generate string object into first parameter register
  generateExpression(stringExpr, paramStartReg, context);

  // Generate method arguments into subsequent parameter registers
  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  // Call external function
  generateExternCall(externFuncName, [], context, paramStartReg);

  // Move return value from r0 to target register
  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  // Free parameter registers
  for (let i = 0; i < totalParams; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }
}

export function generateInstanceMethodCall(
  objectExpr: Expression,
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  if (isExternClass(className, context)) {
    generateExternInstanceMethodCall(objectExpr, className, methodName, args, targetReg, context);
    return;
  }

  // Allocate registers for: this + parameters
  const totalParams = 1 + args.length; // this + args
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  // Generate 'this' object into first parameter register
  generateExpression(objectExpr, paramStartReg, context);

  // Generate arguments into subsequent parameter registers
  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  // Get method metadata from validation context or class table
  const methodMetadata = getMethodMetadata(className, methodName, false, context);
  const methodConstantValue: VMValue = {
    type: 'function',
    value: methodMetadata
  };
  const methodIndex = addConstant(methodConstantValue, context);

  // Call method with parameters
  emit('CALL', paramStartReg, Math.floor(methodIndex / 256), methodIndex % 256, context);

  // Move return value to target register
  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  // Free parameter registers
  for (let i = 0; i < totalParams; i++) {
    context.registerAllocator.free(paramStartReg + i);
  }
}

export function generateInstanceMethodCallFromRegister(
  objectReg: number,
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  if (isExternClass(className, context)) {
    generateExternInstanceMethodCallFromRegister(objectReg, className, methodName, args, targetReg, context);
    return;
  }

  const totalParams = 1 + args.length;
  const paramStartReg = context.registerAllocator.allocateContiguous(totalParams);

  emit('MOVE', paramStartReg, objectReg, 0, context);

  for (let i = 0; i < args.length; i++) {
    generateExpression(args[i], paramStartReg + 1 + i, context);
  }

  const methodMetadata = getMethodMetadata(className, methodName, false, context);
  const methodIndex = addConstant({ type: 'function', value: methodMetadata }, context);

  emit('CALL', paramStartReg, Math.floor(methodIndex / 256), methodIndex % 256, context);

  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }

  context.registerAllocator.freeContiguous(paramStartReg, totalParams);
}

/**
 * Generate static method call using standard CALL mechanism without 'this' parameter.
 */
export function generateStaticMethodCall(
  className: string,
  methodName: string,
  args: Expression[],
  targetReg: number,
  context: CompilationContext
): void {
  // Special lowering for auto-generated fromJSON static method: treat as extern call 'ClassName.fromJSON'
  if (methodName === 'fromJSON') {
    // Generate single string argument into a temp register
    if (args.length > 1) {
      throw new Error(`fromJSON static method expects at most 1 argument; got ${args.length}`);
    }
    const jsonReg = context.registerAllocator.allocate();
    if (args.length === 1) {
      generateExpression(args[0], jsonReg, context);
    } else {
      // If no argument provided, load null
      emit('LOADK_NULL', jsonReg, 0, 0, context);
    }
    // Find class metadata constant index
    const classConstIndex = findClassInConstantPool(className, context);
    if (classConstIndex < 0) {
      throw new Error(`Class metadata not found in constant pool for ${className}`);
    }
    // Emit CLASS_FROM_JSON jsonReg, classConstIndex (result overwrites jsonReg)
    emit('CLASS_FROM_JSON', jsonReg, Math.floor(classConstIndex / 256), classConstIndex % 256, context);
    // Move result to target register if needed
    if (targetReg !== jsonReg) {
      if (targetReg !== 0) {
        emit('MOVE', targetReg, jsonReg, 0, context);
      } else {
        emit('MOVE', 0, jsonReg, 0, context);
      }
    }
    // Free temp
    context.registerAllocator.free(jsonReg);
    return;
  }
  if (isExternClass(className, context)) {
    generateExternStaticMethodCall(className, methodName, args, targetReg, context);
    return;
  }

  // Standard function call - no 'this' parameter needed
  if (args.length === 0) {
    const methodMetadata = getMethodMetadata(className, methodName, true, context);
    const methodIndex = addConstant({ type: 'function', value: methodMetadata }, context);
    emit('CALL', 1, Math.floor(methodIndex / 256), methodIndex % 256, context);
  } else {
    // Allocate contiguous registers for parameters
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);

    // Generate arguments
    for (let i = 0; i < args.length; i++) {
      generateExpression(args[i], paramStartReg + i, context);
    }

    const methodMetadata = getMethodMetadata(className, methodName, true, context);
    const methodIndex = addConstant({ type: 'function', value: methodMetadata }, context);
    emit('CALL', paramStartReg, Math.floor(methodIndex / 256), methodIndex % 256, context);

    // Free parameter registers
    for (let i = 0; i < args.length; i++) {
      context.registerAllocator.free(paramStartReg + i);
    }
  }

  // Move return value to target register
  if (targetReg !== 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }
}

export function generateIntrinsicExternCall(call: CallExpression, targetReg: number, context: CompilationContext): void {
  const intrinsicInfo = call.intrinsicInfo!;

  // Use the resolved VM mapping from the validator
  const externFuncName = intrinsicInfo.vmMapping;

  // Check if this is a member expression call (instance method on extern class)
  const isInstanceMethodCall = call.callee.kind === 'member';
  let totalParamCount = call.arguments.length;
  let needsTargetObject = false;

  if (isInstanceMethodCall) {
    // For extern class instance methods, include the target object as first parameter
    const memberExpr = call.callee as MemberExpression;
    const objectType = getExpressionType(memberExpr.object, context);

    // Check if this is an extern class method call
    if (objectType.kind === 'externClass' ||
      (objectType.kind === 'class' && isExternClass(objectType.name, context))) {
      totalParamCount = call.arguments.length + 1; // +1 for the target object
      needsTargetObject = true;
    }
  }

  if (totalParamCount === 0) {
    // No arguments (static method or parameterless call)
    generateExternCall(externFuncName, [], context);
  } else {
    // Arguments needed: allocate contiguous registers for all parameters
    const paramStartReg = context.registerAllocator.allocateContiguous(totalParamCount);
    let currentParamReg = paramStartReg;

    // For instance method calls, generate the target object as the first parameter
    if (needsTargetObject) {
      const memberExpr = call.callee as MemberExpression;
      // Generate the target object into the first parameter register
      generateExpression(memberExpr.object, currentParamReg, context);
      currentParamReg++;
    }

    // Generate call arguments into subsequent parameter registers
    for (let i = 0; i < call.arguments.length; i++) {
      generateExpression(call.arguments[i], currentParamReg, context);
      currentParamReg++;
    }

    generateExternCall(externFuncName, [], context, paramStartReg);

    // Free parameter registers
    for (let i = 0; i < totalParamCount; i++) {
      context.registerAllocator.free(paramStartReg + i);
    }
  }

  // Return value is in r0, move to target register
  if (targetReg != 0) {
    emit('MOVE', targetReg, 0, 0, context);
  }
}

export function generateExternCall(funcName: string, args: Expression[], context: CompilationContext, paramStartReg?: number): void {
  // Add function name to constant pool
  const externNameValue: VMValue = {
    type: 'string',
    value: funcName
  };
  const externNameIndex = addConstant(externNameValue, context);

  // EXTERN_CALL paramStartReg, externNameIndex
  const startReg = paramStartReg || 1; // Use 1 if no parameters
  emit('EXTERN_CALL', startReg, Math.floor(externNameIndex / 256), externNameIndex % 256, context);
}

export function generateUserFunctionCall(funcMetadata: VMFunctionMetadata, args: Expression[], targetReg: number, context: CompilationContext): void {
  if (args.length === 0) {
    // No arguments
    const funcConstantValue: VMValue = {
      type: 'function',
      value: funcMetadata
    };
    const funcIndex = addConstant(funcConstantValue, context);

    // CALL with no parameters (paramStartReg can be any value since no params)
    emit('CALL', 1, Math.floor(funcIndex / 256), funcIndex % 256, context);
  } else {
    // Allocate contiguous registers for parameters
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);

    // Generate arguments directly into parameter registers
    for (let i = 0; i < args.length; i++) {
      const paramReg = paramStartReg + i;
      generateExpression(args[i], paramReg, context);
    }

    // Add function metadata to constant pool
    const funcConstantValue: VMValue = {
      type: 'function',
      value: funcMetadata
    };
    const funcIndex = addConstant(funcConstantValue, context);

    // CALL paramStartReg, funcIndex - parameters are in paramStartReg..paramStartReg+N-1
    emit('CALL', paramStartReg, Math.floor(funcIndex / 256), funcIndex % 256, context);

    // Free parameter registers
    for (let i = 0; i < args.length; i++) {
      context.registerAllocator.free(paramStartReg + i);
    }
  }

  // Return value is in r0, move to target register
  if (targetReg != 0)
    emit('MOVE', targetReg, 0, 0, context);
}

/**
 * Generate user function call with proper evaluation order for named arguments.
 * This variant takes the full CallExpression to access reordering metadata.
 */
export function generateUserFunctionCallWithEvalOrder(
    funcMetadata: VMFunctionMetadata,
    call: CallExpression,
    targetReg: number,
    context: CompilationContext
): void {
    const args = call.arguments;
    
    if (args.length === 0) {
        // No arguments
        const funcConstantValue: VMValue = {
            type: 'function',
            value: funcMetadata
        };
        const funcIndex = addConstant(funcConstantValue, context);
        emit('CALL', 1, Math.floor(funcIndex / 256), funcIndex % 256, context);
    } else {
        // Generate arguments with proper evaluation order
        const { paramStartReg, argCount } = generateArgumentsWithEvaluationOrder(call, args, context);

        // Add function metadata to constant pool
        const funcConstantValue: VMValue = {
            type: 'function',
            value: funcMetadata
        };
        const funcIndex = addConstant(funcConstantValue, context);

        // CALL paramStartReg, funcIndex - parameters are in paramStartReg..paramStartReg+N-1
        emit('CALL', paramStartReg, Math.floor(funcIndex / 256), funcIndex % 256, context);

        // Free parameter registers
        freeArgumentRegisters(paramStartReg, argCount, context);
    }

    // Return value is in r0, move to target register
    if (targetReg !== 0) {
        emit('MOVE', targetReg, 0, 0, context);
    }
}

export function generateAsyncCall(funcMetadata: VMFunctionMetadata, args: Expression[], targetReg: number, context: CompilationContext): void {
  if (args.length === 0) {
    // No arguments
    const funcConstantValue: VMValue = {
      type: 'function',
      value: funcMetadata
    };
    const funcIndex = addConstant(funcConstantValue, context);

    // ASYNC_CALL targetReg, funcIndex
    // targetReg will receive the Future
    emit('ASYNC_CALL', targetReg, Math.floor(funcIndex / 256), funcIndex % 256, context);
  } else {
    // Allocate contiguous registers for parameters
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);

    // Generate arguments directly into parameter registers
    for (let i = 0; i < args.length; i++) {
      const paramReg = paramStartReg + i;
      generateExpression(args[i], paramReg, context);
    }

    // Add function metadata to constant pool
    const funcConstantValue: VMValue = {
      type: 'function',
      value: funcMetadata
    };
    const funcIndex = addConstant(funcConstantValue, context);

    // ASYNC_CALL paramStartReg, funcIndex
    // The Future will be stored in paramStartReg (overwriting the first argument)
    emit('ASYNC_CALL', paramStartReg, Math.floor(funcIndex / 256), funcIndex % 256, context);

    // Move Future to target register if needed
    if (targetReg !== paramStartReg) {
      emit('MOVE', targetReg, paramStartReg, 0, context);
    }

    // Free parameter registers
    for (let i = 0; i < args.length; i++) {
      context.registerAllocator.free(paramStartReg + i);
    }
  }
}

export function isIntrinsicFunction(funcName: string): boolean {
  return ['println', 'panic'].includes(funcName);
}

export function generateIntrinsicCall(funcName: string, args: Expression[], targetReg: number, context: CompilationContext): void {
  if (args.length === 0) {
    // No arguments
    generateExternCall(funcName, [], context);
  } else if (args.length === 1) {
    // Single argument: generate directly into a temporary register to avoid conflicts
    const argReg = context.registerAllocator.allocate();
    const argExpr = args[0];
    generateExpression(argExpr, argReg, context);

    // If printing an enum, convert backing value (int or string) to its label string using a small compare chain
    const argType = argExpr.inferredType;
    if (funcName === 'println' && argType && argType.kind === 'enum') {
      const validationContext = getActiveValidationContext(context);
      const enumDecl = validationContext?.enums.get(argType.name);
      if (enumDecl) {
  const outReg = context.registerAllocator.allocate();
  const doneLabel = createLabel(context);
  const defaultLabel = createLabel(context);

        // We'll first emit all comparisons with jumps to per-member labels,
        // then emit the labeled blocks that assign the label string.
        const pendingLabelBlocks: { labelName: string; labelString: string }[] = [];

        let currentOrdinal = 0;
        for (const m of enumDecl.members) {
          let value: any;
          if (m.value && (m.value as any).literalType === 'number') {
            value = (m.value as any).value;
            currentOrdinal = Number(value);
          } else if (!m.value) {
            value = currentOrdinal;
          } else {
            value = m.value && (m.value as any).literalType === 'string' ? (m.value as any).value : m.name.name;
          }

          const cmpReg = context.registerAllocator.allocate();
          if (typeof value === 'number') {
            if (value >= -32768 && value <= 32767) {
              const valReg = context.registerAllocator.allocate();
              emit('LOADK_INT16', valReg, (value >> 8) & 0xFF, value & 0xFF, context);
              emit('EQ_INT', cmpReg, argReg, valReg, context);
              context.registerAllocator.free(valReg);
            } else {
              const constIndex = addConstant({ type: 'int', value }, context);
              const valReg = context.registerAllocator.allocate();
              emit('LOADK', valReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
              emit('EQ_INT', cmpReg, argReg, valReg, context);
              context.registerAllocator.free(valReg);
            }
          } else {
            const constIndex = addConstant({ type: 'string', value: value }, context);
            const valReg = context.registerAllocator.allocate();
            emit('LOADK', valReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
            emit('EQ_STRING', cmpReg, argReg, valReg, context);
            context.registerAllocator.free(valReg);
          }

          const matchLabel = createLabel(context);
          emitJump('JMP_IF_TRUE', cmpReg, matchLabel, context);
          context.registerAllocator.free(cmpReg);
          pendingLabelBlocks.push({ labelName: matchLabel, labelString: m.name.name });

          if (typeof value === 'number') {
            currentOrdinal = Number(value) + 1;
          } else {
            currentOrdinal = 0;
          }
        }

        // After all comparisons jump to default label
        emitJump('JMP', 0, defaultLabel, context);

        // Emit label blocks (one per enum member)
        for (const block of pendingLabelBlocks) {
          setLabel(block.labelName, context);
          const labelIdx = addConstant({ type: 'string', value: block.labelString }, context);
          emit('LOADK', outReg, (labelIdx >> 8) & 0xFF, labelIdx & 0xFF, context);
          emitJump('JMP', 0, doneLabel, context);
        }

        // Default path when no match: use backing value directly (should not occur if enum validated)
        setLabel(defaultLabel, context);
        emit('MOVE', outReg, argReg, 0, context);

        setLabel(doneLabel, context);
        generateExternCall(funcName, [], context, outReg);
        context.registerAllocator.free(outReg);
      } else {
        generateExternCall(funcName, [], context, argReg);
      }
    } else {
      generateExternCall(funcName, [], context, argReg);
    }

    // Free the argument register
    context.registerAllocator.free(argReg);
  } else {
    // Multiple arguments: allocate contiguous registers for parameters
    const paramStartReg = context.registerAllocator.allocateContiguous(args.length);

    // Generate arguments directly into parameter registers
    for (let i = 0; i < args.length; i++) {
      const paramReg = paramStartReg + i;
      generateExpression(args[i], paramReg, context);
    }

    generateExternCall(funcName, [], context, paramStartReg);

    // Free parameter registers
    for (let i = 0; i < args.length; i++) {
      context.registerAllocator.free(paramStartReg + i);
    }
  }

  // Return value is in r0, move to target register
  if (targetReg != 0)
    emit('MOVE', targetReg, 0, 0, context);
}

/**
* Get method metadata for a given class and method name.
*/
function getMethodMetadata(className: string, methodName: string, isStatic: boolean, context: CompilationContext): VMFunctionMetadata {
  const validationContext = getActiveValidationContext(context);
  if (!validationContext) {
    throw new Error("Method metadata lookup requires an active validation context");
  }

  const classDecl = validationContext.classes.get(className);
  if (!classDecl) {
    throw new Error(`Unknown class ${className} when resolving method metadata`);
  }

  const method = classDecl.methods.find((methodDecl) => methodDecl.name.name === methodName && methodDecl.isStatic === isStatic);
  if (!method) {
    throw new Error(`Unknown method ${methodName} in class ${className}`);
  }

  const methodKey = `${className}::${methodName}`;
  const codeIndex = context.methodCodeIndices?.get(methodKey) ?? -1;

  return {
    name: methodKey,
    parameterCount: method.parameters.length + (isStatic ? 0 : 1), // Add 'this' for instance methods
    registerCount: 256, // Will be calculated during generation
    codeIndex
  };
}

/**
 * Check if a class name refers to an extern class (like StringBuilder)
 */
export function isExternClass(className: string, context: CompilationContext): boolean {
  return getExternClassDeclaration(className, context) !== undefined;
}

  /**
   * Generate constructor call - creates object and calls constructor if present
   */
  export function generateConstructorCall(
    className: string, 
    args: Expression[], 
    targetReg: number, 
    context: CompilationContext
  ): void {
    // Special handling for extern classes like StringBuilder
    if (isExternClass(className, context)) {
      // For StringBuilder(), treat as StringBuilder.create() or StringBuilder.createWithCapacity(capacity)
      if (className === 'StringBuilder') {
        const externFuncName = args.length === 0 ? 'StringBuilder::create' : 'StringBuilder::createWithCapacity';
        
        if (args.length === 0) {
          // StringBuilder() -> StringBuilder.create()
          generateExternCall(externFuncName, [], context);
        } else {
          // StringBuilder(capacity) -> StringBuilder.createWithCapacity(capacity)
          const paramStartReg = context.registerAllocator.allocateContiguous(args.length);
          
          // Generate arguments directly into parameter registers
          for (let i = 0; i < args.length; i++) {
            const paramReg = paramStartReg + i;
            generateExpression(args[i], paramReg, context);
          }
          
          generateExternCall(externFuncName, [], context, paramStartReg);
          
          // Free parameter registers
          for (let i = 0; i < args.length; i++) {
            context.registerAllocator.free(paramStartReg + i);
          }
        }
        
        // Return value is in r0, move to target register
        if (targetReg !== 0) {
          emit('MOVE', targetReg, 0, 0, context);
        }
        return;
      }
      
      // For other extern classes, throw an error for now
      throw new Error(`Constructor calls not supported for extern class ${className}`);
    }

    // Regular class handling - no explicit constructors, only supports empty positional calls
    // Field initialization is handled by the positional object expression generator
    if (args.length > 0) {
      throw new Error(`Constructor arguments not supported for generateConstructorCall with class ${className}. Use positional object expression instead: ${className}(...)`);
    }
    
    const classMetadata = context.classTable.get(className);
    if (!classMetadata) {
      throw new Error(`Class metadata not found for ${className}`);
    }
    
    const classConstantIndex = findClassInConstantPool(className, context);
    emit('NEW_OBJECT', targetReg, Math.floor(classConstantIndex / 256), classConstantIndex % 256, context);
  }

