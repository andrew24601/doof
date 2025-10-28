/**
 * Array intrinsic support function generators
 * 
 * Generates reusable VM functions for array methods (filter, map, forEach, reduce)
 * instead of inlining the logic at every call site.
 */

import { CompilationContext, VMFunctionMetadata, VMValue } from "../vmgen";
import { emit, addConstant, createLabel, setLabel, emitJump } from "./vmgen-emit";

/**
 * Ensure that an array intrinsic support function will be generated.
 * Returns the function metadata for calling the support function.
 * The actual function generation is deferred until later.
 */
export function ensureArrayIntrinsicSupport(
  methodName: string,
  context: CompilationContext
): VMFunctionMetadata {
  const supportFuncName = `__array_${methodName}`;
  
  // Check if already created
  if (context.functionTable.has(supportFuncName)) {
    return context.functionTable.get(supportFuncName)!;
  }

  // Mark as used (function will be generated later)
  context.arrayIntrinsicsUsed.add(methodName);
  
  // Create metadata immediately (codeIndex will be set later)
  const parameterCount = getIntrinsicParameterCount(methodName);
  const metadata: VMFunctionMetadata = {
    name: supportFuncName,
    parameterCount,
    registerCount: 16, // Fixed register count - we use registers 1-15
    codeIndex: -1 // Will be set when function is actually generated
  };
  
  // Add to function table immediately so subsequent calls can find it
  context.functionTable.set(supportFuncName, metadata);
  
  return metadata;
}

/**
 * Generate a support function for an array intrinsic method.
 */
function generateArrayIntrinsicSupportFunction(
  methodName: string,
  context: CompilationContext
): VMFunctionMetadata {
  const supportFuncName = `__array_${methodName}`;
  
  // Create function metadata
  const parameterCount = getIntrinsicParameterCount(methodName);
  const metadata: VMFunctionMetadata = {
    name: supportFuncName,
    parameterCount,
    registerCount: 16, // Fixed register count - we use registers 1-15
    codeIndex: context.instructions.length // Current instruction index
  };
  
  // Add to function table
  context.functionTable.set(supportFuncName, metadata);
  
  // Generate the support function bytecode
  generateSupportFunction(methodName, context);
  
  return metadata;
}

/**
 * Get the parameter count for an intrinsic method support function
 */
function getIntrinsicParameterCount(methodName: string): number {
  switch (methodName) {
    case 'filter':
    case 'map':
    case 'forEach':
      return 2; // array, lambda
    case 'reduce':
      return 3; // array, initialValue, reducer (initialValue always required)
    default:
      throw new Error(`Unknown intrinsic method: ${methodName}`);
  }
}

/**
 * Generate __array_filter support function
 * Parameters: r1=array, r2=predicate
 * Returns: filtered array in r0
 */
function generateFilterSupportFunction(context: CompilationContext): void {
  // Fixed register assignments
  const arrayReg = 1;      // r1: input array
  const predicateReg = 2;  // r2: predicate lambda
  const outputReg = 3;     // r3: output array
  const lengthReg = 4;     // r4: array length
  const indexReg = 5;      // r5: loop index
  const elementReg = 6;    // r6: current element
  const tempReg = 7;       // r7: temporary values
  const oneReg = 8;        // r8: constant 1

  // Create new output array
  emit('NEW_ARRAY', outputReg, 0, 0, context);
  
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

  // Prepare lambda arguments in registers 9-11: (element, index, array)
  emit('MOVE', 9, elementReg, 0, context);
  emit('MOVE', 10, indexReg, 0, context);
  emit('MOVE', 11, arrayReg, 0, context);

  // Call predicate lambda
  emit('INVOKE_LAMBDA', 9, predicateReg, 3, context);

  // If result is truthy, add element to output array
  const skipAdd = createLabel(context);
  emitJump('JMP_IF_FALSE', 0, skipAdd, context); // Result is in r0

  // Push element to output array using Array::push
  emit('MOVE', 12, outputReg, 0, context);     // args[0] = array
  emit('MOVE', 13, elementReg, 0, context);    // args[1] = element
  
  const pushNameIndex = addConstant({ type: 'string', value: 'Array::push' }, context);
  emit('EXTERN_CALL', 12, Math.floor(pushNameIndex / 256), pushNameIndex % 256, context);

  // Mark skip label
  setLabel(skipAdd, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Move output array to return register (r0)
  emit('MOVE', 0, outputReg, 0, context);
}

/**
 * Generate __array_map support function
 * Parameters: r1=array, r2=mapper
 * Returns: mapped array in r0
 */
function generateMapSupportFunction(context: CompilationContext): void {
  // Fixed register assignments
  const arrayReg = 1;      // r1: input array
  const mapperReg = 2;     // r2: mapper lambda
  const outputReg = 3;     // r3: output array
  const lengthReg = 4;     // r4: array length
  const indexReg = 5;      // r5: loop index
  const elementReg = 6;    // r6: current element
  const tempReg = 7;       // r7: temporary values
  const oneReg = 8;        // r8: constant 1

  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Create empty output array
  emit('NEW_ARRAY', outputReg, 0, 0, context);
  
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

  // Prepare lambda arguments in registers 9-11: (element, index, array)
  emit('MOVE', 9, elementReg, 0, context);
  emit('MOVE', 10, indexReg, 0, context);
  emit('MOVE', 11, arrayReg, 0, context);

  // Call mapper lambda
  emit('INVOKE_LAMBDA', 9, mapperReg, 3, context);

  // Push mapped result to output array using Array::push
  emit('MOVE', 12, outputReg, 0, context);     // args[0] = array
  emit('MOVE', 13, 0, 0, context);            // args[1] = result (r0)
  
  const pushNameIndex = addConstant({ type: 'string', value: 'Array::push' }, context);
  emit('EXTERN_CALL', 12, Math.floor(pushNameIndex / 256), pushNameIndex % 256, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Move output array to return register (r0)
  emit('MOVE', 0, outputReg, 0, context);
}

/**
 * Generate __array_forEach support function
 * Parameters: r1=array, r2=callback
 * Returns: undefined (null) in r0
 */
function generateForEachSupportFunction(context: CompilationContext): void {
  // Fixed register assignments
  const arrayReg = 1;      // r1: input array
  const callbackReg = 2;   // r2: callback lambda
  const lengthReg = 3;     // r3: array length
  const indexReg = 4;      // r4: loop index
  const elementReg = 5;    // r5: current element
  const tempReg = 6;       // r6: temporary values
  const oneReg = 7;        // r7: constant 1

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

  // Prepare lambda arguments in registers 8-10: (element, index, array)
  emit('MOVE', 8, elementReg, 0, context);
  emit('MOVE', 9, indexReg, 0, context);
  emit('MOVE', 10, arrayReg, 0, context);

  // Call callback lambda (discard result)
  emit('INVOKE_LAMBDA', 8, callbackReg, 3, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // forEach returns undefined (load null)
  emit('LOADK_NULL', 0, 0, 0, context);
}

/**
 * Generate a support function for a specific array intrinsic method (called from main generator)
 */
export function generateSupportFunction(methodName: string, context: CompilationContext): void {
  switch (methodName) {
    case 'filter':
      generateFilterSupportFunction(context);
      break;
    case 'map':
      generateMapSupportFunction(context);
      break;
    case 'forEach':
      generateForEachSupportFunction(context);
      break;
    case 'reduce':
      generateReduceSupportFunction(context);
      break;
    default:
      throw new Error(`Unsupported array intrinsic: ${methodName}`);
  }
  
  // Add RETURN instruction at the end
  emit('RETURN', 0, 0, 0, context);
}

/**
 * Generate __array_reduce support function
 * Parameters: r1=array, r2=initialValue, r3=reducer
 * Returns: reduced value in r0
 */
function generateReduceSupportFunction(context: CompilationContext): void {
  // Fixed register assignments
  const arrayReg = 1;      // r1: input array
  const initialReg = 2;    // r2: initial value (always required)
  const reducerReg = 3;    // r3: reducer lambda
  const lengthReg = 4;     // r4: array length
  const indexReg = 5;      // r5: loop index
  const elementReg = 6;    // r6: current element
  const accReg = 7;        // r7: accumulator
  const tempReg = 8;       // r8: temporary values
  const oneReg = 9;        // r9: constant 1

  // Get array length
  emit('LENGTH_ARRAY', lengthReg, arrayReg, 0, context);
  
  // Load constant 1 for incrementing
  emit('LOADK_INT16', oneReg, 0, 1, context);

  // Initialize accumulator with initial value
  emit('MOVE', accReg, initialReg, 0, context);
  
  // Start from index 0 (initial value is always provided)
  emit('LOADK_INT16', indexReg, 0, 0, context);

  // Loop start label
  const loopStart = createLabel(context);
  setLabel(loopStart, context);

  // Check if index < length
  emit('LT_INT', tempReg, indexReg, lengthReg, context);
  const loopEnd = createLabel(context);
  emitJump('JMP_IF_FALSE', tempReg, loopEnd, context);

  // Get current element: element = array[index]
  emit('GET_ARRAY', elementReg, arrayReg, indexReg, context);

  // Prepare lambda arguments in registers 10-13: (accumulator, it, index, array)
  // Note: the element parameter is named 'it' in the callback signature
  emit('MOVE', 10, accReg, 0, context);
  emit('MOVE', 11, elementReg, 0, context); // it
  emit('MOVE', 12, indexReg, 0, context);
  emit('MOVE', 13, arrayReg, 0, context);

  // Call reducer lambda
  emit('INVOKE_LAMBDA', 10, reducerReg, 4, context);

  // Update accumulator with result (r0)
  emit('MOVE', accReg, 0, 0, context);

  // Increment index
  emit('ADD_INT', indexReg, indexReg, oneReg, context);

  // Jump back to loop start
  emitJump('JMP', 0, loopStart, context);

  // Mark loop end
  setLabel(loopEnd, context);

  // Move final accumulator to return register (r0)
  emit('MOVE', 0, accReg, 0, context);
}