// Iterator validation for for..of loops
// Validates iterable types and handles enum lowering for VM compatibility

import {
  ForOfStatement, Expression, Type, ValidationContext, 
  ArrayTypeNode, SetTypeNode, MapTypeNode, EnumTypeNode, PrimitiveTypeNode,
  Identifier, ValidationError, EnumDeclaration, EnumMember
} from '../types';
import { getExpressionId } from '../type-utils';

export interface IteratorTypeInfo {
  iterableType: 'array' | 'set' | 'map';
  elementType?: Type;
  keyType?: Type;
  valueType?: Type;
  requiresEnumLowering: boolean;
  enumMappings?: Map<string, number>;
}

/**
 * Validates for..of statement and annotates with iterator type information
 */
export function validateForOfStatement(
  node: ForOfStatement,
  context: ValidationContext
): IteratorTypeInfo {
  const iterable = node.iterable;

  if (!iterable.inferredType) {
        const error: ValidationError = {
      message: `Cannot determine type of iterable expression`,
      location: node.iterable.location
    };
    context.errors.push(error);
    throw error;

  }
  const iterableType = iterable.inferredType;
  
  // Handle different iterable types
  if (iterableType.kind === 'array') {
    return validateArrayIteration(node, iterableType, context);
  } else if (iterableType.kind === 'set') {
    return validateSetIteration(node, iterableType, context);
  } else if (iterableType.kind === 'map') {
    return validateMapIteration(node, iterableType, context);
  } else {
    const error: ValidationError = {
      message: `Type '${iterableType.kind}' is not iterable`,
      location: node.iterable.location
    };
    context.errors.push(error);
    throw error;
  }
}

/**
 * Validates array iteration: for (let item of array)
 */
function validateArrayIteration(
  node: ForOfStatement,
  arrayType: ArrayTypeNode,
  context: ValidationContext
): IteratorTypeInfo {
  // Arrays support any element type
  return {
    iterableType: 'array',
    elementType: arrayType.elementType,
    requiresEnumLowering: false
  };
}

/**
 * Validates set iteration: for (let value of set)
 */
function validateSetIteration(
  node: ForOfStatement,
  setType: SetTypeNode,
  context: ValidationContext
): IteratorTypeInfo {
  const elementType = setType.elementType;
  
  // Check if element type is VM-compatible
  const vmCompatible = isVMCompatibleType(elementType, context);
  if (!vmCompatible.compatible) {
    const error: ValidationError = {
      message: `Set element type '${elementType.kind}' is not supported for iteration. ` +
        `Only string, int, or enum types are allowed.`,
      location: node.iterable.location
    };
    context.errors.push(error);
    throw error;
  }

  return {
    iterableType: 'set',
    elementType: elementType,
    requiresEnumLowering: vmCompatible.requiresEnumLowering,
    enumMappings: vmCompatible.enumMappings
  };
}

/**
 * Validates map iteration: for (let [key, value] of map)
 */
function validateMapIteration(
  node: ForOfStatement,
  mapType: MapTypeNode,
  context: ValidationContext
): IteratorTypeInfo {
  const keyType = mapType.keyType;
  const valueType = mapType.valueType;
  
  // Check if key type is VM-compatible
  const keyCompatible = isVMCompatibleType(keyType, context);
  if (!keyCompatible.compatible) {
    const error: ValidationError = {
      message: `Map key type '${keyType.kind}' is not supported for iteration. ` +
        `Only string, int, or enum types are allowed.`,
      location: node.iterable.location
    };
    context.errors.push(error);
    throw error;
  }

  // Value type can be any type (no restriction for map values)
  return {
    iterableType: 'map',
    keyType: keyType,
    valueType: valueType,
    requiresEnumLowering: keyCompatible.requiresEnumLowering,
    enumMappings: keyCompatible.enumMappings
  };
}

/**
 * Check if a type is compatible with VM map/set operations
 */
function isVMCompatibleType(type: Type, context: ValidationContext): {
  compatible: boolean;
  requiresEnumLowering: boolean;
  enumMappings?: Map<string, number>;
} {
  switch (type.kind) {
    case 'primitive':
      const primitiveType = type as PrimitiveTypeNode;
      if (primitiveType.type === 'string' || primitiveType.type === 'int') {
        return { compatible: true, requiresEnumLowering: false };
      }
      return { compatible: false, requiresEnumLowering: false };
    
    case 'enum':
      const enumType = type as EnumTypeNode;
      const enumDecl = context.enums.get(enumType.name);
      if (!enumDecl) {
        return { compatible: false, requiresEnumLowering: false };
      }
      
      const enumMappings = new Map<string, number>();
      
      // Build enum to int mapping
      enumDecl.members.forEach((member: EnumMember, index: number) => {
        const value = member.value ? (member.value.value as number) : index;
        enumMappings.set(member.name.name, value);
      });
      
      return { 
        compatible: true, 
        requiresEnumLowering: true, 
        enumMappings 
      };
    
    default:
      return { compatible: false, requiresEnumLowering: false };
  }
}

/**
 * Get the VM-compatible type for a given type (lowering enums to int)
 */
export function getVMCompatibleType(type: Type): Type {
  if (type.kind === 'enum') {
    return { kind: 'primitive', type: 'int' } as PrimitiveTypeNode;
  }
  return type;
}

/**
 * Validate destructuring pattern for map iteration
 */
export function validateMapDestructuring(
  node: ForOfStatement,
  mapTypeInfo: IteratorTypeInfo
): void {
  if (mapTypeInfo.iterableType !== 'map') {
    return; // Not a map, no destructuring validation needed
  }

  // Check if the loop variable is a destructuring pattern
  if (node.variable.kind === 'identifier') {
    const error: ValidationError = {
      message: `Map iteration requires destructuring pattern: for (let [key, value] of map)`,
      location: node.variable.location
    };
    throw error;
  }

  // For now, assume proper destructuring validation is handled elsewhere
  // In a full implementation, we'd validate the destructuring pattern here
}
