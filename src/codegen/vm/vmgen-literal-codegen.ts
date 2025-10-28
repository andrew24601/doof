import { Literal } from "../../types";
import { CompilationContext, VMValue } from "../vmgen";
import { addConstant, emit } from "./vmgen-emit";

export function generateLiteral(literal: Literal, targetReg: number, context: CompilationContext): void {
    switch (literal.literalType) {
        case 'null':
            emit('LOADK_NULL', targetReg, 0, 0, context);
            break;
        case 'boolean':
            const boolValue = literal.value ? 1 : 0;
            emit('LOADK_BOOL', targetReg, boolValue, 0, context);
            break;
        case 'number':
            generateNumericLiteral(literal, targetReg, context);
            break;
        case 'char':
            const charValue = (literal.value as string).charCodeAt(0);
            emit('LOADK_CHAR', targetReg, charValue, 0, context);
            break;
        case 'string':
            const stringValue: VMValue = {
                type: 'string',
                value: literal.value as string
            };
            const stringIndex = addConstant(stringValue, context);
            emit('LOADK', targetReg, Math.floor(stringIndex / 256), stringIndex % 256, context);
            break;
    }
}

export function generateNumericLiteral(literal: Literal, targetReg: number, context: CompilationContext): void {
    const numValue = literal.value as number;

    if (literal.inferredType!.kind !== 'primitive') {
        throw new Error("Missing type hint for numeric literal");
    }
    const targetType = literal.inferredType!.type;

    // Use validated type if available, otherwise infer from value
    if (targetType === 'int') {
        // Integer handling
        if (numValue >= -32768 && numValue <= 32767) {
            // Use 16-bit immediate for small integers
            const value16 = numValue & 0xFFFF;
            emit('LOADK_INT16', targetReg, Math.floor(value16 / 256), value16 % 256, context);
        } else {
            // Use constant pool for large integers
            const constValue: VMValue = { type: 'int', value: numValue };
            const constIndex = addConstant(constValue, context);
            emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
        }
    } else if (targetType === 'float') {
        // Float handling - try fixed-point encoding first
        if (numValue >= -128 && numValue < 128) {
            const fixedPoint = Math.round(numValue * 256);
            if (fixedPoint === numValue * 256) {
                const value16 = fixedPoint & 0xFFFF;
                emit('LOADK_FLOAT', targetReg, Math.floor(value16 / 256), value16 % 256, context);
                return;
            }
        }
        // Fall back to constant pool for floats that don't fit fixed-point
        const constValue: VMValue = { type: 'float', value: numValue };
        const constIndex = addConstant(constValue, context);
        emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
    } else if (targetType === 'double') {
        // Double handling - always use constant pool
        const constValue: VMValue = { type: 'double', value: numValue };
        const constIndex = addConstant(constValue, context);
        emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
    } else {
        throw new Error("Missing type hint for numeric literal");
    }
}

export function generateTypedNumericLiteral(literal: Literal, targetType: string, targetReg: number, context: CompilationContext): void {
    const numValue = literal.value as number;

    if (targetType === 'int') {
        // Integer handling
        if (numValue >= -32768 && numValue <= 32767) {
            const value16 = numValue & 0xFFFF;
            emit('LOADK_INT16', targetReg, Math.floor(value16 / 256), value16 % 256, context);
        } else {
            const constValue: VMValue = { type: 'int', value: Math.floor(numValue) };
            const constIndex = addConstant(constValue, context);
            emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
        }
    } else if (targetType === 'float') {
        // Float handling - try fixed-point encoding first
        if (numValue >= -128 && numValue < 128) {
            const fixedPoint = Math.round(numValue * 256);
            if (fixedPoint === numValue * 256) {
                const value16 = fixedPoint & 0xFFFF;
                emit('LOADK_FLOAT', targetReg, Math.floor(value16 / 256), value16 % 256, context);
                return;
            }
        }
        // Fall back to constant pool for floats that don't fit fixed-point
        const constValue: VMValue = { type: 'float', value: numValue };
        const constIndex = addConstant(constValue, context);
        emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
    } else if (targetType === 'double') {
        // Double handling
        const constValue: VMValue = { type: 'double', value: numValue };
        const constIndex = addConstant(constValue, context);
        emit('LOADK', targetReg, Math.floor(constIndex / 256), constIndex % 256, context);
    } else {
        // Fallback to normal generation
        generateNumericLiteral(literal, targetReg, context);
    }
}