import {
    BinaryExpression,
    Type,
    Expression,
    UnionTypeNode,
    Identifier
} from "../types";
import {
    isNumericType,
    getCommonNumericType,
    typeToString,
    isTypeCompatible,
    isBooleanType,
    isStringType,
    createUnknownType,
    createPrimitiveType,
    createBoolType
} from "../type-utils";
import { Validator } from "./validator";
import { validateExpression } from "./expression-validator";
import { canInferObjectLiteralType, inferObjectLiteralType } from "./object-literal-validator";
import { isIdentifierParameter } from "./declaration-validator";

/**
 * Determines if a binary expression with + operator should be treated as string concatenation
 * following left-to-right evaluation. Once a string is encountered, everything after is string.
 */
function shouldTreatAsStringConcatenation(expr: BinaryExpression, validator: Validator): boolean {
    if (expr.operator !== '+') {
        return false;
    }

    // Helper to evaluate type of operand from left to right, including evaluation of nested operations
    function getEffectiveType(operand: Expression): Type {
        if (operand.kind === 'binary' && operand.operator === '+') {
            // For nested + operations, check if the nested operation would result in string concatenation
            if (shouldTreatAsStringConcatenation(operand, validator)) {
                return createPrimitiveType('string');
            } else {
                // If it's numeric addition, determine the result type
                const leftType = validateExpression(operand.left, validator);
                const rightType = validateExpression(operand.right, validator);
                if (isNumericType(leftType) && isNumericType(rightType)) {
                    return getCommonNumericType(leftType, rightType);
                }
            }
        }
        return validateExpression(operand, validator);
    }

    // Evaluate types from left to right
    const leftType = getEffectiveType(expr.left);
    const rightType = getEffectiveType(expr.right);

    // If either operand is a string, treat as string concatenation
    if (isStringType(leftType) || isStringType(rightType)) {
        return true;
    }

    return false;
}

// Helper method for propagating type context
export function propagateTypeContext(expr: Expression, expectedType: Type, validator: Validator): void {
    if (expectedType.kind === 'enum' && expr.kind === 'enumShorthand') {
        expr._expectedEnumType = expectedType;
    }
    // Propagate class type context to object literals
    if (expectedType.kind === 'class' && expr.kind === 'object') {
        if (!expr.className && canInferObjectLiteralType(expr, expectedType)) {
            inferObjectLiteralType(expr, expectedType, validator);
        }
    }
    // Propagate union type context to object literals for disambiguation
    if (expectedType.kind === 'union' && expr.kind === 'object') {
        if (!expr.className) {
            // Store the union type for later disambiguation
            (expr as any)._expectedUnionType = expectedType;
        }
    }
    // Propagate array element type context to array literals
    if (expectedType.kind === 'array' && expr.kind === 'array') {
        expr._expectedElementType = expectedType.elementType;

        // For multi-dimensional arrays, also propagate type context to nested arrays
        const arrayExpr = expr;
        const expectedElementType = expectedType.elementType;
        if (expectedElementType.kind === 'array') {
            // If the expected element type is also an array, propagate it to all elements
            for (const element of arrayExpr.elements) {
                if (element.kind === 'array') {
                    propagateTypeContext(element, expectedElementType, validator);
                }
            }
        }
        
        // Also propagate element type context to tuple expressions in array
        if (expectedElementType.kind === 'class' || expectedElementType.kind === 'externClass') {
            for (const element of arrayExpr.elements) {
                if (element.kind === 'tuple') {
                    (element as any)._inferredTargetType = expectedElementType;
                }
            }
        }
    }
    // Propagate function type context to lambda expressions
    if (expectedType.kind === 'function' && expr.kind === 'lambda') {
        expr._expectedFunctionType = expectedType;
    }
    // Propagate class type context to tuple expressions for type inference
    if ((expectedType.kind === 'class' || expectedType.kind === 'externClass') && expr.kind === 'tuple') {
        (expr as any)._inferredTargetType = expectedType;
    }
    // Handle union types for tuple expressions - extract the non-null class type
    if (expectedType.kind === 'union' && expr.kind === 'tuple') {
        const unionType = expectedType as UnionTypeNode;
        // Find the first class or externClass type in the union
        const classType = unionType.types.find(t => t.kind === 'class' || t.kind === 'externClass');
        if (classType) {
            (expr as any)._inferredTargetType = classType;
        }
    }
}

export function validateBinaryExpression(expr: BinaryExpression, validator: Validator): Type {
    const leftType = validateExpression(expr.left, validator);

            const assignmentOperators = ['=', '+=', '-=', '*=', '/=', '%='];
            if (assignmentOperators.includes(expr.operator) && expr.left.kind === 'identifier') {
            const identifier = expr.left as Identifier;
            if (isIdentifierParameter(identifier.name, validator)) {
                    if (expr.operator === '=') {
                        propagateTypeContext(expr.right, leftType, validator);
                    }

                    validateExpression(expr.right, validator);

                    validator.addError(
                        `Cannot assign to parameter '${identifier.name}'. Parameters are immutable; assign to a local variable instead.`,
                        identifier.location
                    );
                    expr.inferredType = leftType;
                    return leftType;
            }
        }

    // For assignment operators, propagate expected type context to the right
    if (expr.operator === '=') {
        propagateTypeContext(expr.right, leftType, validator);
    }

    const rightType = validateExpression(expr.right, validator);

    // Type checking for binary operators
    let resultType: Type;

    switch (expr.operator) {
        case '+':
        case '-':
        case '*':
        case '%':
            // Handle string concatenation with + operator using left-to-right evaluation
            if (expr.operator === '+' && shouldTreatAsStringConcatenation(expr, validator)) {
                // Allow string concatenation and return string type
                resultType = createPrimitiveType('string');
            } else if (isNumericType(leftType) && isNumericType(rightType)) {
                resultType = getCommonNumericType(leftType, rightType);
            } else {
                validator.addError(`Operator '${expr.operator}' cannot be applied to types '${typeToString(leftType)}' and '${typeToString(rightType)}'`, expr.location);
                resultType = createUnknownType();
            }
            break;
        case '/':
            // Integer division or floating-point division based on operand types
            if (isNumericType(leftType) && isNumericType(rightType)) {
                resultType = getCommonNumericType(leftType, rightType);
            } else {
                validator.addError(`Operator '${expr.operator}' cannot be applied to types '${typeToString(leftType)}' and '${typeToString(rightType)}'`, expr.location);
                resultType = createUnknownType();
            }
            break;
        case '==':
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
            if (isTypeCompatible(leftType, rightType, validator) || isTypeCompatible(rightType, leftType, validator)) {
                resultType = createBoolType();
            } else {
                validator.addError(`Operator '${expr.operator}' cannot be applied to types '${typeToString(leftType)}' and '${typeToString(rightType)}'`, expr.location);
                resultType = createBoolType();
            }
            break;
        case '&&':
        case '||':
            if (isBooleanType(leftType) && isBooleanType(rightType)) {
                resultType = createBoolType();
            } else {
                validator.addError(`Logical operators require boolean operands`, expr.location);
                resultType = createBoolType();
            }
            break;
        case '=':
            if (isTypeCompatible(rightType, leftType, validator)) {
                resultType = leftType;
            } else {
                validator.addError(`Cannot assign type '${typeToString(rightType)}' to '${typeToString(leftType)}'`, expr.location);
                resultType = leftType;
            }
            break;
        case '+=':
        case '-=':
        case '*=':
        case '/=':
        case '%=':
            // Assignment operators: check compatibility and return left type
            if (isNumericType(leftType) && isNumericType(rightType)) {
                resultType = leftType;
            } else if (expr.operator === '+=' && isStringType(leftType) && isStringType(rightType)) {
                resultType = leftType;
            } else {
                validator.addError(`Operator '${expr.operator}' cannot be applied to types '${typeToString(leftType)}' and '${typeToString(rightType)}'`, expr.location);
                resultType = leftType;
            }
            break;
        default:
            validator.addError(`Unknown binary operator: ${expr.operator}`, expr.location);
            resultType = createUnknownType();
    }

    expr.inferredType = resultType;
    return resultType;
}
