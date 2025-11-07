import { Expression, Type, PrimitiveTypeNode } from "../../types";
import { CompilationContext } from "../vmgen";
import { 
    isStringType as isStringTypeShared, isIntType as isIntTypeShared, 
    isFloatType as isFloatTypeShared, isDoubleType as isDoubleTypeShared, 
    isBoolType as isBoolTypeShared, isCharType as isCharTypeShared 
} from "../shared/type-coercion";

export function getExpressionType(expr: Expression, context: CompilationContext): Type {
    if (!expr.inferredType) {
        throw new Error("Expression type not inferred");
    }
    return expr.inferredType!;
}

export function isFloatType(type: Type): boolean {
    return isFloatTypeShared(type);
}

export function isDoubleType(type: Type): boolean {
    return isDoubleTypeShared(type);
}

export function isBoolType(type: Type): boolean {
    return isBoolTypeShared(type);
}

export function isIntType(type: Type): boolean {
    return isIntTypeShared(type);
}

export function isLambdaType(type: Type): boolean {
    return type.kind === 'function';
}

/**
 * Helper function to determine the key type category for maps and sets.
 * Returns 'int' if the type is an integer, otherwise 'string'.
 */
export function getTypeCategory(type: Type | undefined): 'int' | 'string' {
    if (!type) return 'string';
    return isIntType(type) ? 'int' : 'string';
}

export function isUnionType(type: Type): boolean {
    return type.kind === 'union';
}

export function isNullableType(type: Type): boolean {
    return type.kind === 'union' && type.types.some(t => t.kind === 'primitive' && t.type === 'null');
}

export function isNullLiteral(expr: Expression): boolean {
    return expr.kind === 'literal' && (expr as any).value === null;
}

/**
 * Determine the promoted type for binary operations between two types.
 * Follows standard type promotion rules.
 */
export function getPromotedType(leftType: Type, rightType: Type): Type {
    // Prefer enum typing if either operand is an enum to preserve backing comparison semantics
    if (leftType.kind === 'enum') return leftType;
    if (rightType.kind === 'enum') return rightType;

    // String concatenation takes precedence
    if (isStringTypeShared(leftType) || isStringTypeShared(rightType)) {
        return { kind: 'primitive', type: 'string' } as PrimitiveTypeNode;
    }

    // Numeric type promotion: double > float > int
    if (isDoubleType(leftType) || isDoubleType(rightType)) {
        return { kind: 'primitive', type: 'double' } as PrimitiveTypeNode;
    }

    if (isFloatType(leftType) || isFloatType(rightType)) {
        return { kind: 'primitive', type: 'float' } as PrimitiveTypeNode;
    }

    if (isIntType(leftType) || isIntType(rightType)) {
        return { kind: 'primitive', type: 'int' } as PrimitiveTypeNode;
    }

    // Char operations - only promote if both operands are char
    if (isCharTypeShared(leftType) && isCharTypeShared(rightType)) {
        return { kind: 'primitive', type: 'char' } as PrimitiveTypeNode;
    }

    // Boolean operations
    if (isBoolType(leftType) && isBoolType(rightType)) {
        return { kind: 'primitive', type: 'bool' } as PrimitiveTypeNode;
    }

    // Default to void for unsupported combinations
    return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
}

/**
 * Check if two types are compatible (no conversion needed).
 */
export function areTypesCompatible(type1: Type, type2: Type): boolean {
    if (type1.kind !== type2.kind) return false;

    if (type1.kind === 'primitive' && type2.kind === 'primitive') {
        return type1.type === type2.type;
    }

    // For now, assume other complex types are incompatible
    return false;
}