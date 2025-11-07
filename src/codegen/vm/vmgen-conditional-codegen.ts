import { BinaryExpression, ConditionalExpression, Expression, Literal, UnaryExpression, Type } from "../../types";
import { CompilationContext, getActiveValidationContext } from "../vmgen";
import { createLabel, emit, emitJump, setLabel } from "./vmgen-emit";
import { generateExpression, generateExpressionOptimal } from "./vmgen-expression-codegen";
import { getExpressionType, getPromotedType, isNullLiteral } from "./vmgen-type-utils";
import { 
    isStringType as isStringTypeShared, isCharType as isCharTypeShared, 
    isBoolType as isBoolTypeShared, isFloatType as isFloatTypeShared, 
    isDoubleType as isDoubleTypeShared 
} from "../shared/type-coercion";

/**
 * Generates bytecode for conditional expressions (ternary operator: condition ? consequent : alternate).
 * Uses the flow-managed conditional approach for optimal branching.
 */
export function generateConditionalExpression(expr: ConditionalExpression, targetReg: number, context: CompilationContext): void {
    const trueLabel = createLabel(context);
    const falseLabel = createLabel(context);
    const endLabel = createLabel(context);

    // Generate condition using flow-managed approach
    generateConditional(expr.test, trueLabel, falseLabel, context);

    // Generate consequent
    setLabel(trueLabel, context);
    generateExpression(expr.consequent, targetReg, context);
    emitJump('JMP', 0, endLabel, context);

    // Generate alternate
    setLabel(falseLabel, context);
    generateExpression(expr.alternate, targetReg, context);

    setLabel(endLabel, context);
}

/**
 * Generates efficient conditional branching bytecode that jumps to trueLabel if the expression
 * evaluates to true, or falseLabel if false, without necessarily materializing a boolean value.
 * This enables optimal short-circuit evaluation and eliminates unnecessary register usage.
 */
export function generateConditional(
    expr: Expression,
    trueLabel: string,
    falseLabel: string,
    context: CompilationContext
): void {
    switch (expr.kind) {
        case 'binary': {
            const binary = expr as BinaryExpression;

            switch (binary.operator) {
                // Logical operators with short-circuit evaluation
                case '&&': {
                    const intermediateLabel = createLabel(context);
                    // Generate left operand: if false, go to falseLabel; if true, continue
                    generateConditional(binary.left, intermediateLabel, falseLabel, context);
                    setLabel(intermediateLabel, context);
                    // Generate right operand: if false, go to falseLabel; if true, go to trueLabel
                    generateConditional(binary.right, trueLabel, falseLabel, context);
                    break;
                }

                case '||': {
                    const intermediateLabel = createLabel(context);
                    // Generate left operand: if true, go to trueLabel; if false, continue
                    generateConditional(binary.left, trueLabel, intermediateLabel, context);
                    setLabel(intermediateLabel, context);
                    // Generate right operand: if true, go to trueLabel; if false, go to falseLabel
                    generateConditional(binary.right, trueLabel, falseLabel, context);
                    break;
                }

                // Comparison operators - generate direct conditional jumps
                case '==':
                case '!=':
                case '<':
                case '>':
                case '<=':
                case '>=': {
                    generateComparisonConditional(binary, trueLabel, falseLabel, context);
                    break;
                }

                default:
                    // For other binary operators, fallback to materialization
                    generateMaterializedConditional(expr, trueLabel, falseLabel, context);
                    break;
            }
            break;
        }

        case 'unary': {
            const unary = expr as UnaryExpression;
            if (unary.operator === '!') {
                // NOT: swap true/false labels
                generateConditional(unary.operand, falseLabel, trueLabel, context);
            } else {
                // For other unary operators, fallback to materialization
                generateMaterializedConditional(expr, trueLabel, falseLabel, context);
            }
            break;
        }

        case 'literal': {
            const literal = expr as Literal;
            // For literal values, generate direct jump based on truthiness
            if (isTruthyLiteral(literal)) {
                emitJump('JMP', 0, trueLabel, context);
            } else {
                emitJump('JMP', 0, falseLabel, context);
            }
            break;
        }

        default:
            // For all other expressions, materialize the value and test it
            generateMaterializedConditional(expr, trueLabel, falseLabel, context);
            break;
    }
}

/**
 * Generates optimized conditional jumps for comparison operators.
 */
function generateComparisonConditional(
    binary: BinaryExpression,
    trueLabel: string,
    falseLabel: string,
    context: CompilationContext
): void {
    const allocatedRegs: number[] = [];

    // Check if this is a null comparison
    const isNullComparison = isNullLiteral(binary.left) || isNullLiteral(binary.right);

    let leftReg: number;
    let rightReg: number;

    if (isNullComparison) {
        // For null comparisons, we only need the non-null operand
        const nonNullExpr = isNullLiteral(binary.left) ? binary.right : binary.left;
        leftReg = generateExpressionOptimal(nonNullExpr, allocatedRegs, context);
        rightReg = 0; // Not used for IS_NULL
    } else {
        leftReg = generateExpressionOptimal(binary.left, allocatedRegs, context);
        rightReg = generateExpressionOptimal(binary.right, allocatedRegs, context);
    }

    // Get type information for optimal instruction selection
    const leftType = getExpressionType(binary.left, context);
    const rightType = getExpressionType(binary.right, context);
    // Prefer enum typing if present to choose correct equality opcode
    const operandType = (leftType.kind === 'enum') ? leftType
        : (rightType.kind === 'enum') ? rightType
        : getPromotedType(leftType, rightType);

    // Generate the comparison and conditional jump
    switch (binary.operator) {
        case '==':
            generateEqualityConditional(leftReg, rightReg, operandType, trueLabel, falseLabel, context, isNullComparison);
            break;
        case '!=':
            generateEqualityConditional(leftReg, rightReg, operandType, falseLabel, trueLabel, context, isNullComparison);
            break;
        case '<':
            generateLessThanConditional(leftReg, rightReg, operandType, trueLabel, falseLabel, context);
            break;
        case '>':
            // a > b is equivalent to b < a
            generateLessThanConditional(rightReg, leftReg, operandType, trueLabel, falseLabel, context);
            break;
        case '<=':
            // a <= b is equivalent to !(b < a)
            generateLessThanConditional(rightReg, leftReg, operandType, falseLabel, trueLabel, context);
            break;
        case '>=':
            // a >= b is equivalent to !(a < b)
            generateLessThanConditional(leftReg, rightReg, operandType, falseLabel, trueLabel, context);
            break;
    }

    // Free temporary registers
    for (const reg of allocatedRegs) {
        context.registerAllocator.free(reg);
    }
}

/**
 * Generates conditional jumps for equality comparisons.
 */
function generateEqualityConditional(
    leftReg: number,
    rightReg: number,
    operandType: Type,
    equalLabel: string,
    notEqualLabel: string,
    context: CompilationContext,
    isNullComparison: boolean
): void {
    const tempReg = context.registerAllocator.allocate();

    if (isNullComparison) {
        // For null comparisons, we need to check which operand contains the variable
        // IS_NULL only takes one operand - the register to check for null
        // For now, assume leftReg contains the variable (this works for "variable == null")
        emit('IS_NULL', tempReg, leftReg, 0, context);
    } else if (operandType.kind === 'enum') {
        // Enum equality: choose backing opcode (string or int) based on member literal types
        const validationContext = getActiveValidationContext(context);
        const decl = validationContext?.enums.get((operandType as any).name);
        if (decl) {
            const hasString = decl.members.some(m => !!m.value && (m.value as any).literalType === 'string');
            if (hasString) {
                emit('EQ_STRING', tempReg, leftReg, rightReg, context);
            } else {
                emit('EQ_INT', tempReg, leftReg, rightReg, context);
            }
        } else {
            // Fallback: assume int-backed if metadata missing; fail fast choice kept explicit
            emit('EQ_INT', tempReg, leftReg, rightReg, context);
        }
    } else if (isStringTypeShared(operandType)) {
        emit('EQ_STRING', tempReg, leftReg, rightReg, context);
    } else if (isCharTypeShared(operandType)) {
        emit('EQ_CHAR', tempReg, leftReg, rightReg, context);
    } else if (isBoolTypeShared(operandType)) {
        emit('EQ_BOOL', tempReg, leftReg, rightReg, context);
    } else if (isFloatTypeShared(operandType)) {
        emit('EQ_FLOAT', tempReg, leftReg, rightReg, context);
    } else if (isDoubleTypeShared(operandType)) {
        emit('EQ_DOUBLE', tempReg, leftReg, rightReg, context);
    } else {
        emit('EQ_INT', tempReg, leftReg, rightReg, context);
    } 
    emitJump('JMP_IF_TRUE', tempReg, equalLabel, context);
    emitJump('JMP', 0, notEqualLabel, context);
    context.registerAllocator.free(tempReg);
}

/**
 * Generates conditional jumps for less-than comparisons.
 */
function generateLessThanConditional(
    leftReg: number,
    rightReg: number,
    operandType: Type,
    trueLabel: string,
    falseLabel: string,
    context: CompilationContext
): void {
    const tempReg = context.registerAllocator.allocate();

    if (isStringTypeShared(operandType)) {
        emit('LT_STRING', tempReg, leftReg, rightReg, context);
    } else if (isCharTypeShared(operandType)) {
        emit('LT_CHAR', tempReg, leftReg, rightReg, context);
    } else if (isBoolTypeShared(operandType)) {
        emit('LT_BOOL', tempReg, leftReg, rightReg, context);
    } else if (isFloatTypeShared(operandType)) {
        emit('LT_FLOAT', tempReg, leftReg, rightReg, context);
    } else if (isDoubleTypeShared(operandType)) {
        emit('LT_DOUBLE', tempReg, leftReg, rightReg, context);
    } else {
        emit('LT_INT', tempReg, leftReg, rightReg, context);
    }

    emitJump('JMP_IF_TRUE', tempReg, trueLabel, context);
    emitJump('JMP', 0, falseLabel, context);
    context.registerAllocator.free(tempReg);
}

/**
 * Fallback method that materializes the expression value and tests it for truthiness.
 * Used for expressions that cannot be optimized into direct conditional jumps.
 */
function generateMaterializedConditional(
    expr: Expression,
    trueLabel: string,
    falseLabel: string,
    context: CompilationContext
): void {
    const conditionReg = context.registerAllocator.allocate();
    generateExpression(expr, conditionReg, context);
    emitJump('JMP_IF_TRUE', conditionReg, trueLabel, context);
    emitJump('JMP', 0, falseLabel, context);
    context.registerAllocator.free(conditionReg);
}

/**
 * Generates a boolean value in a register using the flow-managed conditional approach.
 * This is used when conditional operators are needed in value contexts.
 */
export function generateConditionalValue(expr: Expression, targetReg: number, context: CompilationContext): void {
    const trueLabel = createLabel(context);
    const falseLabel = createLabel(context);
    const endLabel = createLabel(context);

    // Use flow-managed conditional to branch appropriately
    generateConditional(expr, trueLabel, falseLabel, context);

    // Set true value
    setLabel(trueLabel, context);
    emit('LOADK_BOOL', targetReg, 1, 0, context); // true
    emitJump('JMP', 0, endLabel, context);

    // Set false value
    setLabel(falseLabel, context);
    emit('LOADK_BOOL', targetReg, 0, 0, context); // false

    setLabel(endLabel, context);
}

/**
 * Determines if a literal value is truthy according to JavaScript semantics.
 */
function isTruthyLiteral(literal: Literal): boolean {
    switch (literal.literalType) {
        case 'null':
            return false;
        case 'boolean':
            return literal.value === true;
        case 'number':
            return typeof literal.value === 'number' && literal.value !== 0 && !isNaN(literal.value);
        case 'string':
        case 'char':
            return literal.value !== '';
        default:
            return true;
    }
}