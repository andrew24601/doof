import {
  Expression, Type, BinaryExpression, PrimitiveTypeNode
} from "../../types";

/**
 * Coercion information for binary expressions
 */
export interface CoercionInfo {
  leftCoercion?: { from: Type; to: Type };
  rightCoercion?: { from: Type; to: Type };
  operandType: Type;
  resultType: Type;
}

/**
 * Infers coercion information from the inferredType properties of binary expression nodes.
 * This is used by both C++ and VM code generators to determine type coercions needed
 * for binary operations without relying on validation context hints.
 */
export function inferCoercionFromTypes(expr: BinaryExpression): CoercionInfo {
  // Get the inferred types from the expression nodes
  if (!expr.left.inferredType) {
    throw new Error('Left operand has no inferred type');
  }
  if (!expr.right.inferredType) {
    throw new Error('Right operand has no inferred type');
  }
  if (!expr.inferredType) {
    throw new Error('Expression has no inferred type');
  }

  const leftOriginalType = expr.left.inferredType;
  const rightOriginalType = expr.right.inferredType;
  const resultType = expr.inferredType;

  // Determine the common operand type for the operation
  let operandType: Type;
  let leftCoercion: { from: Type; to: Type } | undefined;
  let rightCoercion: { from: Type; to: Type } | undefined;

  // For arithmetic operations, determine the promoted type
  if (['+', '-', '*', '/', '%'].includes(expr.operator)) {
    operandType = determineArithmeticOperandType(leftOriginalType, rightOriginalType, resultType, expr.operator);
    
    // Check if left operand needs coercion
    if (!typesEqual(leftOriginalType, operandType)) {
      leftCoercion = { from: leftOriginalType, to: operandType };
    }
    
    // Check if right operand needs coercion
    if (!typesEqual(rightOriginalType, operandType)) {
      rightCoercion = { from: rightOriginalType, to: operandType };
    }
  } else if (['==', '!=', '<', '>', '<=', '>='].includes(expr.operator)) {
    // For comparison operations, determine common type for comparison
    operandType = determineCommonType(leftOriginalType, rightOriginalType);
    
    // Check if left operand needs coercion
    if (!typesEqual(leftOriginalType, operandType)) {
      leftCoercion = { from: leftOriginalType, to: operandType };
    }
    
    // Check if right operand needs coercion
    if (!typesEqual(rightOriginalType, operandType)) {
      rightCoercion = { from: rightOriginalType, to: operandType };
    }
  } else {
    // For logical and other operations, no coercion typically needed
    operandType = leftOriginalType;
  }

  return {
    leftCoercion,
    rightCoercion,
    operandType,
    resultType
  };
}

/**
 * Determines the appropriate operand type for arithmetic operations
 */
function determineArithmeticOperandType(leftType: Type, rightType: Type, resultType: Type, operator?: string): Type {
  // If we have a specific result type, work backwards from that
  if (resultType.kind === 'primitive') {
    const resultPrim = resultType as PrimitiveTypeNode;
    
    // For arithmetic operations involving floats, if the result is float, don't auto-promote to double
    if ((resultPrim.type === 'float') && (leftType.kind === 'primitive' && rightType.kind === 'primitive')) {
      const leftPrim = leftType as PrimitiveTypeNode;
      const rightPrim = rightType as PrimitiveTypeNode;
      if (leftPrim.type === 'float' && rightPrim.type === 'float') {
        return { kind: 'primitive', type: 'float' } as PrimitiveTypeNode;
      }
    }
    
    // Use the result type as the operand type - this handles int/int = int for division
    return resultType;
  }

  // Fallback to standard type promotion rules
  return determineCommonType(leftType, rightType);
}

/**
 * Determines the common type between two types using standard promotion rules
 */
function determineCommonType(leftType: Type, rightType: Type): Type {
  if (leftType.kind === 'primitive' && rightType.kind === 'primitive') {
    const leftPrim = leftType as PrimitiveTypeNode;
    const rightPrim = rightType as PrimitiveTypeNode;

    // String concatenation case
    if (leftPrim.type === 'string' || rightPrim.type === 'string') {
      return { kind: 'primitive', type: 'string' } as PrimitiveTypeNode;
    }

    // Basic numeric type promotion rules
    if (leftPrim.type === 'double' || rightPrim.type === 'double') {
      return { kind: 'primitive', type: 'double' } as PrimitiveTypeNode;
    } else if (leftPrim.type === 'float' || rightPrim.type === 'float') {
      return { kind: 'primitive', type: 'float' } as PrimitiveTypeNode;
    } else if (leftPrim.type === 'int' || rightPrim.type === 'int') {
      return { kind: 'primitive', type: 'int' } as PrimitiveTypeNode;
    } else if (leftPrim.type === 'char' && rightPrim.type === 'char') {
      return { kind: 'primitive', type: 'char' } as PrimitiveTypeNode;
    } else if (leftPrim.type === 'bool' || rightPrim.type === 'bool') {
      return { kind: 'primitive', type: 'bool' } as PrimitiveTypeNode;
    }
  }

  // Default to left type if no clear promotion
  return leftType;
}

/**
 * Check if two types are equal
 */
export function typesEqual(type1: Type, type2: Type): boolean {
  if (type1.kind !== type2.kind) return false;

  switch (type1.kind) {
    case "primitive":
      return type1.type === (type2 as PrimitiveTypeNode).type;
    case "array":
      return typesEqual(type1.elementType, (type2 as any).elementType);
    case "class":
      return type1.name === (type2 as any).name;
    case "function":
      // Simplified comparison for function types
      return type1.parameters.length === (type2 as any).parameters.length &&
             typesEqual(type1.returnType, (type2 as any).returnType);
    case "union":
      // Simplified comparison for union types
      return type1.types.length === (type2 as any).types.length;
    default:
      return false;
  }
}

/**
 * Type utility functions for checking primitive types
 */
export function isStringType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'string';
}

export function isIntType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'int';
}

export function isFloatType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'float';
}

export function isDoubleType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'double';
}

export function isBoolType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'bool';
}

export function isCharType(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'char';
}

export function isNumericType(type: Type): boolean {
  return type.kind === 'primitive' &&
    ['int', 'float', 'double'].includes(type.type);
}

export function isFloatingType(type: Type): boolean {
  return type.kind === 'primitive' &&
    ['float', 'double'].includes(type.type);
}
