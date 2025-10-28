import { BinaryExpression, UnaryExpression, Identifier, Type, IndexExpression, MemberExpression, MapTypeNode, FieldDeclaration } from "../../types";
import { CompilationContext, VMValue, getActiveValidationContext } from "../vmgen";
import { emit, addConstant } from "./vmgen-emit";
import { generateExpressionOptimal } from "./vmgen-expression-codegen";
import { getExpressionType, getPromotedType, areTypesCompatible, isFloatType, isDoubleType, isIntType, getTypeCategory } from "./vmgen-type-utils";
import { generateConditionalValue } from "./vmgen-conditional-codegen";
import { isIdentifierCaptured } from "./vmgen-lambda-codegen";
import { getInstanceFieldIndex } from "./vmgen-class-utils";
import { 
    inferCoercionFromTypes, CoercionInfo,
    isStringType as isStringTypeShared, isIntType as isIntTypeShared, 
    isFloatType as isFloatTypeShared, isDoubleType as isDoubleTypeShared, 
    isBoolType as isBoolTypeShared, isCharType as isCharTypeShared 
} from "../shared/type-coercion";
import { isCapturedMutableIdentifier, CAPTURE_WRAPPER_FIELD_INDEX } from "./vmgen-capture-utils";

export function generateBinaryExpression(binary: BinaryExpression, targetReg: number, context: CompilationContext): void {
    // For assignment operators, handle specially
    if (binary.operator === '=' || binary.operator === '+=' || binary.operator === '-=' || 
        binary.operator === '*=' || binary.operator === '/=' || binary.operator === '%=') {
        if (binary.operator !== '=') {
            return generateCompoundAssignment(binary, targetReg, context);
        }

        const rhsAllocatedRegs: number[] = [];
        const rhsReg = generateExpressionOptimal(binary.right, rhsAllocatedRegs, context);

        if (binary.left.kind === 'identifier') {
            const leftId = binary.left as Identifier;
            const leftReg = context.registerAllocator.getVariable(leftId.name);
            if (leftReg === undefined) {
                if (context.currentLambda && isIdentifierCaptured(leftId, context.currentLambda)) {
                    throw new Error(`Captured identifier '${leftId.name}' is missing a register binding in VM code generation`);
                }
                throw new Error(`Assignment to undeclared variable ${leftId.name}`);
            }

            if (isCapturedMutableIdentifier(leftId, context)) {
                emit('SET_FIELD', leftReg, CAPTURE_WRAPPER_FIELD_INDEX, rhsReg, context);
            } else if (leftReg !== rhsReg) {
                emit('MOVE', leftReg, rhsReg, 0, context);
            }
        } else if (binary.left.kind === 'index') {
            const indexExpr = binary.left as IndexExpression;
            const lhsTemps: number[] = [];

            const objectReg = generateExpressionOptimal(indexExpr.object, lhsTemps, context);
            const indexReg = generateExpressionOptimal(indexExpr.index, lhsTemps, context);

            const objectType = getExpressionType(indexExpr.object, context);
            if (objectType.kind === 'map') {
                const mapType = objectType as MapTypeNode;
                const keyTypeCategory = getTypeCategory(mapType.keyType);
                const setMapOpcode = keyTypeCategory === 'int' ? 'SET_MAP_INT' : 'SET_MAP';
                emit(setMapOpcode, objectReg, indexReg, rhsReg, context);
            } else {
                emit('SET_ARRAY', objectReg, indexReg, rhsReg, context);
            }

            for (const reg of lhsTemps) {
                if (reg !== rhsReg && reg !== targetReg) {
                    context.registerAllocator.free(reg);
                }
            }
        } else if (binary.left.kind === 'member') {
            const memberExpr = binary.left as MemberExpression;
            let handledStatically = false;

            if (memberExpr.object.kind === 'identifier' && memberExpr.property.kind === 'identifier') {
                const className = (memberExpr.object as Identifier).name;
                const propertyName = (memberExpr.property as Identifier).name;
                const validationContext = getActiveValidationContext(context);

                if (validationContext?.classes.has(className)) {
                    const classDecl = validationContext.classes.get(className)!;
                    const staticField = classDecl.fields.find((field: FieldDeclaration) => field.name.name === propertyName && field.isStatic);
                    if (!staticField) {
                        throw new Error(`Static member '${propertyName}' not found in class '${className}'`);
                    }

                    const globalFieldName = `${className}.${propertyName}`;
                    const globalSlot = context.globalSymbolTable.get(globalFieldName);
                    if (globalSlot === undefined) {
                        throw new Error(`Static field ${globalFieldName} not found in global symbol table`);
                    }

                    const globalHigh = Math.floor(globalSlot / 256);
                    const globalLow = globalSlot % 256;
                    emit('SET_GLOBAL', rhsReg, globalHigh, globalLow, context);
                    handledStatically = true;
                }
            }

            if (!handledStatically) {
                const lhsTemps: number[] = [];
                const objectReg = generateExpressionOptimal(memberExpr.object, lhsTemps, context);

                if (memberExpr.property.kind !== 'identifier') {
                    throw new Error("Unsupported member expression property type for assignment");
                }

                const propertyName = (memberExpr.property as Identifier).name;
                const objectExprType = getExpressionType(memberExpr.object, context);
                if (objectExprType.kind !== 'class') {
                    throw new Error(`Cannot assign to property '${propertyName}' of non-class type`);
                }

                const fieldIndex = getInstanceFieldIndex(objectExprType.name, propertyName, context);
                emit('SET_FIELD', objectReg, fieldIndex, rhsReg, context);

                for (const reg of lhsTemps) {
                    if (reg !== rhsReg && reg !== targetReg) {
                        context.registerAllocator.free(reg);
                    }
                }
            }
        } else {
            throw new Error(`Unsupported left-hand side for assignment: ${binary.left.kind}`);
        }

        if (rhsReg !== targetReg) {
            emit('MOVE', targetReg, rhsReg, 0, context);
        }

        for (const reg of rhsAllocatedRegs) {
            if (reg !== targetReg) {
                context.registerAllocator.free(reg);
            }
        }

        return;
    }

    // Use optimal expression generation to avoid unnecessary allocations
    const allocatedRegs: number[] = [];
    let leftReg = generateExpressionOptimal(binary.left, allocatedRegs, context);
    let rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);

    // Get type coercion information using the shared inference logic
    let coercionInfo: CoercionInfo | undefined;
    try {
        // Use the new shared coercion inference that works from inferredType properties
        coercionInfo = inferCoercionFromTypes(binary);
    } catch (error) {
        // Fall back to legacy behavior if inference fails
        console.warn(`Failed to infer coercion for binary expression: ${error}`);
    }

    // Apply type coercions if needed
    if (coercionInfo) {
        if (coercionInfo.leftCoercion) {
            leftReg = coerceToType(leftReg, coercionInfo.leftCoercion.from, coercionInfo.leftCoercion.to, allocatedRegs, context);
        }
        if (coercionInfo.rightCoercion) {
            rightReg = coerceToType(rightReg, coercionInfo.rightCoercion.from, coercionInfo.rightCoercion.to, allocatedRegs, context);
        }
    }

    // Use the operand type from coercion info, or fallback to legacy logic
    let operandType: Type;
    if (coercionInfo?.operandType) {
        operandType = coercionInfo.operandType;
    } else {
        // Fallback to legacy type promotion logic
        const leftType = getExpressionType(binary.left, context);
        const rightType = getExpressionType(binary.right, context);
        operandType = getPromotedType(leftType, rightType);
    }

    switch (binary.operator) {
        case '+':
            if (isStringTypeShared(operandType)) {
                emit('ADD_STRING', targetReg, leftReg, rightReg, context);
            } else if (isFloatTypeShared(operandType)) {
                emit('ADD_FLOAT', targetReg, leftReg, rightReg, context);
            } else if (isDoubleTypeShared(operandType)) {
                emit('ADD_DOUBLE', targetReg, leftReg, rightReg, context);
            } else {
                emit('ADD_INT', targetReg, leftReg, rightReg, context);
            }
            break;
        case '-':
            if (isFloatTypeShared(operandType)) {
                emit('SUB_FLOAT', targetReg, leftReg, rightReg, context);
            } else if (isDoubleTypeShared(operandType)) {
                emit('SUB_DOUBLE', targetReg, leftReg, rightReg, context);
            } else {
                emit('SUB_INT', targetReg, leftReg, rightReg, context);
            }
            break;
        case '*':
            if (isFloatTypeShared(operandType)) {
                emit('MUL_FLOAT', targetReg, leftReg, rightReg, context);
            } else if (isDoubleTypeShared(operandType)) {
                emit('MUL_DOUBLE', targetReg, leftReg, rightReg, context);
            } else {
                emit('MUL_INT', targetReg, leftReg, rightReg, context);
            }
            break;
        case '/':
            // Division result type is determined by coercion info, or defaults to double
            if (isFloatTypeShared(operandType)) {
                emit('DIV_FLOAT', targetReg, leftReg, rightReg, context);
            } else if (isDoubleTypeShared(operandType)) {
                emit('DIV_DOUBLE', targetReg, leftReg, rightReg, context);
            } else {
                emit('DIV_INT', targetReg, leftReg, rightReg, context);
            }
            break;
        case '%':
            // Modulo operator (integer only)
            emit('MOD_INT', targetReg, leftReg, rightReg, context);
            break;
        case '==':
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
        case '&&':
        case '||':
            // Delegate conditional operators to flow-managed approach
            generateConditionalValue(binary, targetReg, context);
            break;
        default:
            // Default to null for unimplemented operators
            emit('LOADK_NULL', targetReg, 0, 0, context);
            break;
    }

    // Free any temporarily allocated registers
    for (const reg of allocatedRegs) {
        if (reg !== targetReg) {
            context.registerAllocator.free(reg);
        }
    }
}

export function generateUnaryExpression(unary: UnaryExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];

    switch (unary.operator) {
        case '!':
            // Use flow-managed approach for negation
            generateConditionalValue(unary, targetReg, context);
            break;
        case '-':
            // Negate by subtracting from zero
            const operandReg2 = generateExpressionOptimal(unary.operand, allocatedRegs, context);
            const zeroReg = context.registerAllocator.allocate();
            allocatedRegs.push(zeroReg);

            emit('LOADK_INT16', zeroReg, 0, 0, context);

            const operandType = getExpressionType(unary.operand, context);
            if (isFloatType(operandType)) {
                emit('SUB_FLOAT', targetReg, zeroReg, operandReg2, context);
            } else if (isDoubleType(operandType)) {
                emit('SUB_DOUBLE', targetReg, zeroReg, operandReg2, context);
            } else {
                emit('SUB_INT', targetReg, zeroReg, operandReg2, context);
            }
            break;
        case '++':
        case '++_post':
            handleIncrementExpression(unary, targetReg, context, allocatedRegs);
            break;
        case '--':
        case '--_post':
            handleDecrementExpression(unary, targetReg, context, allocatedRegs);
            break;
        default:
            // For unrecognized operators, throw an error instead of silently failing
            throw new Error(`Unsupported unary operator: ${unary.operator}`);
    }

    // Free any temporarily allocated registers
    for (const reg of allocatedRegs) {
        if (reg !== targetReg) {
            context.registerAllocator.free(reg);
        }
    }
}

/**
 * Convert a register value to a target type, returning the register with the converted value.
 * May allocate a new register if conversion is needed.
 */
export function coerceToType(sourceReg: number, sourceType: Type, targetType: Type, allocatedRegs: number[], context: CompilationContext): number {
    // If types are already compatible, no conversion needed
    if (areTypesCompatible(sourceType, targetType)) {
        return sourceReg;
    }

    // Allocate a new register for the converted value
    const convertedReg = context.registerAllocator.allocate();
    allocatedRegs.push(convertedReg);

    // Determine conversion opcode based on source and target types
    if (isIntTypeShared(sourceType)) {
        if (isFloatTypeShared(targetType)) {
            emit('INT_TO_FLOAT', convertedReg, sourceReg, 0, context);
        } else if (isDoubleTypeShared(targetType)) {
            emit('INT_TO_DOUBLE', convertedReg, sourceReg, 0, context);
        } else if (isStringTypeShared(targetType)) {
            emit('INT_TO_STRING', convertedReg, sourceReg, 0, context);
        } else if (isCharTypeShared(targetType)) {
            emit('INT_TO_CHAR', convertedReg, sourceReg, 0, context);
        } else {
            // Fallback: just move the value
            emit('MOVE', convertedReg, sourceReg, 0, context);
        }
    } else if (isFloatTypeShared(sourceType)) {
        if (isIntTypeShared(targetType)) {
            emit('FLOAT_TO_INT', convertedReg, sourceReg, 0, context);
        } else if (isDoubleTypeShared(targetType)) {
            emit('FLOAT_TO_DOUBLE', convertedReg, sourceReg, 0, context);
        } else if (isStringTypeShared(targetType)) {
            emit('FLOAT_TO_STRING', convertedReg, sourceReg, 0, context);
        } else {
            emit('MOVE', convertedReg, sourceReg, 0, context);
        }
    } else if (isDoubleTypeShared(sourceType)) {
        if (isIntTypeShared(targetType)) {
            emit('DOUBLE_TO_INT', convertedReg, sourceReg, 0, context);
        } else if (isFloatTypeShared(targetType)) {
            emit('DOUBLE_TO_FLOAT', convertedReg, sourceReg, 0, context);
        } else if (isStringTypeShared(targetType)) {
            emit('DOUBLE_TO_STRING', convertedReg, sourceReg, 0, context);
        } else {
            emit('MOVE', convertedReg, sourceReg, 0, context);
        }
    } else if (isBoolTypeShared(sourceType)) {
        if (isStringTypeShared(targetType)) {
            emit('BOOL_TO_STRING', convertedReg, sourceReg, 0, context);
        } else {
            emit('MOVE', convertedReg, sourceReg, 0, context);
        }
    } else if (isCharTypeShared(sourceType)) {
        if (isIntTypeShared(targetType)) {
            emit('CHAR_TO_INT', convertedReg, sourceReg, 0, context);
        } else if (isStringTypeShared(targetType)) {
            emit('CHAR_TO_STRING', convertedReg, sourceReg, 0, context);
        } else {
            emit('MOVE', convertedReg, sourceReg, 0, context);
        }
    } else {
        // Default case: just move the value
        emit('MOVE', convertedReg, sourceReg, 0, context);
    }

    return convertedReg;
}

function handleIncrementExpression(unary: UnaryExpression, targetReg: number, context: CompilationContext, allocatedRegs: number[]): void {
    // Pre-increment and post-increment (both behave the same in VM for simplicity)
    if (unary.operand.kind === 'identifier') {
        const identifier = unary.operand as Identifier;
        const varReg = context.registerAllocator.getVariable(identifier.name);
        
        if (varReg === undefined) {
            throw new Error(`Variable '${identifier.name}' not found for increment operation`);
        }
        
        if (isCapturedMutableIdentifier(identifier, context)) {
            const operandType = getExpressionType(unary.operand, context);

            emit('GET_FIELD', targetReg, varReg, CAPTURE_WRAPPER_FIELD_INDEX, context);

            const oneReg = context.registerAllocator.allocate();
            allocatedRegs.push(oneReg);
            emitNumericLiteralForType(operandType, 1, oneReg, context);

            performBinaryOperation('+', targetReg, targetReg, oneReg, operandType, context);

            emit('SET_FIELD', varReg, CAPTURE_WRAPPER_FIELD_INDEX, targetReg, context);
        } else {
            // Load constant 1
            const oneReg = context.registerAllocator.allocate();
            allocatedRegs.push(oneReg);
            emit('LOADK_INT16', oneReg, 0, 1, context);

            // Add 1 to variable in-place
            emit('ADD_INT', varReg, varReg, oneReg, context);

            // Move result to target register
            emit('MOVE', targetReg, varReg, 0, context);
        }
    } else if (unary.operand.kind === 'member') {
        handleMemberIncrement(unary, targetReg, context, allocatedRegs);
    } else {
        throw new Error(`Increment operator can only be applied to variables or member expressions, got ${unary.operand.kind}`);
    }
}

function handleDecrementExpression(unary: UnaryExpression, targetReg: number, context: CompilationContext, allocatedRegs: number[]): void {
    // Pre-decrement and post-decrement (both behave the same in VM for simplicity)
    if (unary.operand.kind === 'identifier') {
        const identifier = unary.operand as Identifier;
        const varReg = context.registerAllocator.getVariable(identifier.name);
        
        if (varReg === undefined) {
            throw new Error(`Variable '${identifier.name}' not found for decrement operation`);
        }
        
        if (isCapturedMutableIdentifier(identifier, context)) {
            const operandType = getExpressionType(unary.operand, context);

            emit('GET_FIELD', targetReg, varReg, CAPTURE_WRAPPER_FIELD_INDEX, context);

            const oneReg = context.registerAllocator.allocate();
            allocatedRegs.push(oneReg);
            emitNumericLiteralForType(operandType, -1, oneReg, context);

            performBinaryOperation('-', targetReg, targetReg, oneReg, operandType, context);

            emit('SET_FIELD', varReg, CAPTURE_WRAPPER_FIELD_INDEX, targetReg, context);
        } else {
            // Load constant 1
            const oneReg = context.registerAllocator.allocate();
            allocatedRegs.push(oneReg);
            emit('LOADK_INT16', oneReg, 0, 1, context);

            // Subtract 1 from variable in-place
            emit('SUB_INT', varReg, varReg, oneReg, context);

            // Move result to target register
            emit('MOVE', targetReg, varReg, 0, context);
        }
    } else if (unary.operand.kind === 'member') {
        handleMemberDecrement(unary, targetReg, context, allocatedRegs);
    } else {
        throw new Error(`Decrement operator can only be applied to variables or member expressions, got ${unary.operand.kind}`);
    }
}

function handleMemberIncrement(unary: UnaryExpression, targetReg: number, context: CompilationContext, allocatedRegs: number[]): void {
    const memberExpr = unary.operand as MemberExpression;
    const validationContext = getActiveValidationContext(context);
    if (!validationContext) {
        throw new Error("Static member increment requires an active validation context");
    }

    if (memberExpr.object.kind === 'identifier' && memberExpr.property.kind === 'identifier') {
        const className = (memberExpr.object as Identifier).name;
        const propertyName = (memberExpr.property as Identifier).name;

        const classDecl = validationContext.classes.get(className);
        if (!classDecl) {
            throw new Error(`Static member increment missing class '${className}' in validation metadata`);
        }

        const staticField = classDecl.fields.find((field: FieldDeclaration) => field.name.name === propertyName && field.isStatic);
        if (!staticField) {
            throw new Error(`Static member '${propertyName}' not found in class '${className}'`);
        }

        const globalFieldName = `${className}.${propertyName}`;
        const globalSlot = context.globalSymbolTable.get(globalFieldName);
        if (globalSlot === undefined) {
            throw new Error(`Global slot not found for static field '${globalFieldName}'`);
        }

        // Load current value from global slot
        const currentValueReg = context.registerAllocator.allocate();
        allocatedRegs.push(currentValueReg);

        const globalHigh = Math.floor(globalSlot / 256);
        const globalLow = globalSlot % 256;
        emit('GET_GLOBAL', currentValueReg, globalHigh, globalLow, context);

        // For post-increment, store old value in target register first
        if (unary.operator === '++_post') {
            emit('MOVE', targetReg, currentValueReg, 0, context);
        }

        // Load constant 1
        const oneReg = context.registerAllocator.allocate();
        allocatedRegs.push(oneReg);
        emit('LOADK_INT16', oneReg, 0, 1, context);

        // Increment the value
        emit('ADD_INT', currentValueReg, currentValueReg, oneReg, context);

        // Store back to global slot
        emit('SET_GLOBAL', currentValueReg, globalHigh, globalLow, context);

        // For pre-increment, move new value to target register
        if (unary.operator === '++') {
            emit('MOVE', targetReg, currentValueReg, 0, context);
        }

        return;
    }

    throw new Error(`Increment operator on instance member expressions not yet implemented`);
}

function handleMemberDecrement(unary: UnaryExpression, targetReg: number, context: CompilationContext, allocatedRegs: number[]): void {
    const memberExpr = unary.operand as MemberExpression;
    const validationContext = getActiveValidationContext(context);
    if (!validationContext) {
        throw new Error("Static member decrement requires an active validation context");
    }

    if (memberExpr.object.kind === 'identifier' && memberExpr.property.kind === 'identifier') {
        const className = (memberExpr.object as Identifier).name;
        const propertyName = (memberExpr.property as Identifier).name;

        const classDecl = validationContext.classes.get(className);
        if (!classDecl) {
            throw new Error(`Static member decrement missing class '${className}' in validation metadata`);
        }

        const staticField = classDecl.fields.find((field: FieldDeclaration) => field.name.name === propertyName && field.isStatic);
        if (!staticField) {
            throw new Error(`Static member '${propertyName}' not found in class '${className}'`);
        }

        const globalFieldName = `${className}.${propertyName}`;
        const globalSlot = context.globalSymbolTable.get(globalFieldName);
        if (globalSlot === undefined) {
            throw new Error(`Global slot not found for static field '${globalFieldName}'`);
        }

        // Load current value from global slot
        const currentValueReg = context.registerAllocator.allocate();
        allocatedRegs.push(currentValueReg);

        const globalHigh = Math.floor(globalSlot / 256);
        const globalLow = globalSlot % 256;
        emit('GET_GLOBAL', currentValueReg, globalHigh, globalLow, context);

        // For post-decrement, store old value in target register first
        if (unary.operator === '--_post') {
            emit('MOVE', targetReg, currentValueReg, 0, context);
        }

        // Load constant 1
        const oneReg = context.registerAllocator.allocate();
        allocatedRegs.push(oneReg);
        emit('LOADK_INT16', oneReg, 0, 1, context);

        // Decrement the value
        emit('SUB_INT', currentValueReg, currentValueReg, oneReg, context);

        // Store back to global slot
        emit('SET_GLOBAL', currentValueReg, globalHigh, globalLow, context);

        // For pre-decrement, move new value to target register
        if (unary.operator === '--') {
            emit('MOVE', targetReg, currentValueReg, 0, context);
        }

        return;
    }

    throw new Error(`Decrement operator on instance member expressions not yet implemented`);
}

/**
 * Generate code for compound assignment operators (+=, -=, *=, /=, %=)
 */
function generateCompoundAssignment(binary: BinaryExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];
    const resultType = getExpressionType(binary.left, context);
    
    // Extract the base operator from compound operator
    let baseOperator: string;
    switch (binary.operator) {
        case '+=': baseOperator = '+'; break;
        case '-=': baseOperator = '-'; break;
        case '*=': baseOperator = '*'; break;
        case '/=': baseOperator = '/'; break;
        case '%=': baseOperator = '%'; break;
        default:
            throw new Error(`Unsupported compound assignment operator: ${binary.operator}`);
    }
    
    if (binary.left.kind === 'identifier') {
        // Handle variable compound assignment: var += value
        const leftId = binary.left as Identifier;
        const leftReg = context.registerAllocator.getVariable(leftId.name);
        if (leftReg === undefined) {
            throw new Error(`Assignment to undeclared variable ${leftId.name}`);
        }

        if (isCapturedMutableIdentifier(leftId, context)) {
            const rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);
            const currentValueReg = context.registerAllocator.allocate();
            allocatedRegs.push(currentValueReg);

            emit('GET_FIELD', currentValueReg, leftReg, CAPTURE_WRAPPER_FIELD_INDEX, context);

            performBinaryOperation(baseOperator, currentValueReg, currentValueReg, rightReg, resultType, context);

            emit('SET_FIELD', leftReg, CAPTURE_WRAPPER_FIELD_INDEX, currentValueReg, context);

            if (targetReg !== currentValueReg) {
                emit('MOVE', targetReg, currentValueReg, 0, context);
            }

            for (const reg of allocatedRegs) {
                if (reg !== targetReg) {
                    context.registerAllocator.free(reg);
                }
            }
            return;
        }
        
        // Generate right-hand side
        const rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);
        
        // Perform the operation and store back to the variable
    performBinaryOperation(baseOperator, leftReg, leftReg, rightReg, resultType, context);
        
        // Copy result to target register if different
        if (targetReg !== leftReg) {
            emit('MOVE', targetReg, leftReg, 0, context);
        }
        
    } else if (binary.left.kind === 'member') {
        // Handle member compound assignment: obj.field += value
        const memberExpr = binary.left as MemberExpression;
        
        // Generate object expression
        const objectReg = generateExpressionOptimal(memberExpr.object, allocatedRegs, context);
        
        // Generate right-hand side value
        const rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);
        
        if (memberExpr.property.kind === 'identifier') {
            const propertyName = (memberExpr.property as Identifier).name;
            const objectExprType = getExpressionType(memberExpr.object, context);
            
            if (objectExprType.kind === 'class') {
                // Get field index
                const fieldIndex = getInstanceFieldIndex(objectExprType.name, propertyName, context);
                
                // Load current field value
                const currentValueReg = context.registerAllocator.allocate();
                allocatedRegs.push(currentValueReg);
                emit('GET_FIELD', currentValueReg, objectReg, fieldIndex, context);
                
                // Perform the operation
                performBinaryOperation(baseOperator, currentValueReg, currentValueReg, rightReg, resultType, context);

                // Store back to field
                emit('SET_FIELD', objectReg, fieldIndex, currentValueReg, context);

                // Copy result to target register
                if (targetReg !== currentValueReg) {
                    emit('MOVE', targetReg, currentValueReg, 0, context);
                }
            } else {
                throw new Error(`Cannot perform compound assignment on property '${propertyName}' of non-class type`);
            }
        } else {
            throw new Error("Unsupported member expression property type for compound assignment");
        }
        
    } else if (binary.left.kind === 'index') {
        // Handle index compound assignment: arr[index] += value
        const indexExpr = binary.left as IndexExpression;
        
        // Generate object and index expressions
        const objectReg = generateExpressionOptimal(indexExpr.object, allocatedRegs, context);
        const indexReg = generateExpressionOptimal(indexExpr.index, allocatedRegs, context);
        const rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);
        
        // Load current indexed value
        const currentValueReg = context.registerAllocator.allocate();
        allocatedRegs.push(currentValueReg);
        
        const objectType = getExpressionType(indexExpr.object, context);
        if (objectType.kind === 'map') {
            const mapType = objectType as MapTypeNode;
            const keyTypeCategory = getTypeCategory(mapType.keyType);
            const getMapOpcode = keyTypeCategory === 'int' ? 'GET_MAP_INT' : 'GET_MAP';
            emit(getMapOpcode, currentValueReg, objectReg, indexReg, context);
        } else {
            emit('GET_ARRAY', currentValueReg, objectReg, indexReg, context);
        }
        
        // Perform the operation
    performBinaryOperation(baseOperator, currentValueReg, currentValueReg, rightReg, resultType, context);
        
        // Store back to indexed location
        if (objectType.kind === 'map') {
            const mapType = objectType as MapTypeNode;
            const keyTypeCategory = getTypeCategory(mapType.keyType);
            const setMapOpcode = keyTypeCategory === 'int' ? 'SET_MAP_INT' : 'SET_MAP';
            emit(setMapOpcode, objectReg, indexReg, currentValueReg, context);
        } else {
            emit('SET_ARRAY', objectReg, indexReg, currentValueReg, context);
        }
        
        // Copy result to target register
        if (targetReg !== currentValueReg) {
            emit('MOVE', targetReg, currentValueReg, 0, context);
        }
        
    } else {
        throw new Error(`Unsupported left-hand side for compound assignment: ${binary.left.kind}`);
    }
    
    // Free temporary registers
    for (const reg of allocatedRegs) {
        context.registerAllocator.free(reg);
    }
}

function emitNumericLiteralForType(valueType: Type, numericValue: number, targetReg: number, context: CompilationContext): void {
    if (valueType.kind === 'primitive') {
        switch (valueType.type) {
            case 'float':
                emitNumericConstantFromPool('float', numericValue, targetReg, context);
                return;
            case 'double':
                emitNumericConstantFromPool('double', numericValue, targetReg, context);
                return;
            case 'int':
                emitInt16Literal(numericValue, targetReg, context);
                return;
        }
    }

    emitInt16Literal(numericValue, targetReg, context);
}

function emitInt16Literal(value: number, targetReg: number, context: CompilationContext): void {
    const normalized = value & 0xFFFF;
    emit('LOADK_INT16', targetReg, Math.floor(normalized / 256), normalized % 256, context);
}

function emitNumericConstantFromPool(type: 'float' | 'double', value: number, targetReg: number, context: CompilationContext): void {
    const constValue: VMValue = { type, value };
    const constantIndex = addConstant(constValue, context);
    emit('LOADK', targetReg, Math.floor(constantIndex / 256), constantIndex % 256, context);
}

/**
 * Perform a binary operation and emit the appropriate opcode
 */
function performBinaryOperation(
    operator: string,
    targetReg: number,
    leftReg: number,
    rightReg: number,
    operandType: Type,
    context: CompilationContext
): void {
    switch (operator) {
        case '+':
            if (isStringTypeShared(operandType)) {
                emit('ADD_STRING', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isFloatTypeShared(operandType)) {
                emit('ADD_FLOAT', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isDoubleTypeShared(operandType)) {
                emit('ADD_DOUBLE', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isIntTypeShared(operandType)) {
                emit('ADD_INT', targetReg, leftReg, rightReg, context);
                return;
            }
            break;
        case '-':
            if (isFloatTypeShared(operandType)) {
                emit('SUB_FLOAT', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isDoubleTypeShared(operandType)) {
                emit('SUB_DOUBLE', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isIntTypeShared(operandType)) {
                emit('SUB_INT', targetReg, leftReg, rightReg, context);
                return;
            }
            break;
        case '*':
            if (isFloatTypeShared(operandType)) {
                emit('MUL_FLOAT', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isDoubleTypeShared(operandType)) {
                emit('MUL_DOUBLE', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isIntTypeShared(operandType)) {
                emit('MUL_INT', targetReg, leftReg, rightReg, context);
                return;
            }
            break;
        case '/':
            if (isFloatTypeShared(operandType)) {
                emit('DIV_FLOAT', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isDoubleTypeShared(operandType)) {
                emit('DIV_DOUBLE', targetReg, leftReg, rightReg, context);
                return;
            }
            if (isIntTypeShared(operandType)) {
                emit('DIV_INT', targetReg, leftReg, rightReg, context);
                return;
            }
            break;
        case '%':
            if (isIntTypeShared(operandType)) {
                emit('MOD_INT', targetReg, leftReg, rightReg, context);
                return;
            }
            break;
        default:
            throw new Error(`Unsupported binary operator: ${operator}`);
    }

    throw new Error(`Unsupported operand type for operator '${operator}'`);
}