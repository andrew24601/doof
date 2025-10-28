import { validateExpression } from "./expression-validator";
import { typeToString, isTypeCompatible, createUnknownType, createFunctionType, createPrimitiveType, isNullableType, stripNullableType } from "../type-utils";
import { Type, NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression, UnionTypeNode, PrimitiveTypeNode, ClassTypeNode, Identifier, Expression, ArrayTypeNode, MapTypeNode } from "../types";
import { Validator } from "./validator";

export function validateNullCoalesceExpression(expr: NullCoalesceExpression, validator: Validator): Type {
  const leftType = validateExpression(expr.left, validator);
  const rightType = validateExpression(expr.right, validator);

  // Left side should be nullable
  if (!isNullableType(leftType)) {
    validator.addError(
      `Left operand of null coalescing operator (??) should be nullable, but got: ${typeToString(leftType)}`,
      expr.left.location
    );
  }

  // The result type is the non-null version of the left type united with the right type
  const leftNonNull = stripNullableType(leftType);

  // If the right side is also nullable, the result remains nullable
  if (isNullableType(rightType)) {
    const rightNonNull = stripNullableType(rightType);

    if (isTypeCompatible(leftNonNull, rightNonNull, validator)) {
      // Both types have the same base type, create a union with null
      return {
        kind: 'union',
        types: [leftNonNull, { kind: 'primitive', type: 'null' } as PrimitiveTypeNode]
      };
    } else {
      // Different base types, create a union of both non-null types plus null
      return {
        kind: 'union',
        types: [leftNonNull, rightNonNull, { kind: 'primitive', type: 'null' } as PrimitiveTypeNode]
      };
    }
  }

  // Right side is not nullable - the result is guaranteed non-null
  if (isTypeCompatible(leftNonNull, rightType, validator)) {
    expr.inferredType = leftNonNull;
    return leftNonNull;
  }

  // Different types - create a union
  const resultType: UnionTypeNode = {
    kind: 'union',
    types: [leftNonNull, rightType]
  };

  expr.inferredType = resultType;
  return resultType;
}

export function validateOptionalChainExpression(expr: OptionalChainExpression, validator: Validator): Type {
  const objectType = validateExpression(expr.object, validator);

  // Object should be nullable
  if (!isNullableType(objectType)) {
    validator.addError(
      `Object in optional chaining (?.) should be nullable, but got: ${typeToString(objectType)}`,
      expr.object.location
    );
  }

  // Get the non-null type of the object
  const nonNullObjectType = stripNullableType(objectType);

  // Direct optional call like fn?.()
  if (!expr.property) {
    if (!expr.isMethodCall) {
      validator.addError(
        `Optional chaining segment is missing a property name`,
        expr.location
      );
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }

    if (nonNullObjectType.kind === 'function') {
      expr.inferredType = nonNullObjectType;
      return nonNullObjectType;
    }

    validator.addError(
      `Optional call target is not a function type`,
      expr.location
    );
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  // Validate the property access on the non-null type
  let propertyType: Type;

  if (expr.computed) {
    // For computed access like obj?.[expr], validate as index expression
    propertyType = validateComputedPropertyAccess(nonNullObjectType, expr.property as Expression, validator, expr.location);
  } else {
    // For normal property access like obj?.prop
    const propertyName = (expr.property as Identifier).name;
    propertyType = validatePropertyAccess(nonNullObjectType, propertyName, validator, expr.location);
  }

  // If this is a method call, return the function type (it will be called by the wrapping CallExpression)
  if (expr.isMethodCall) {
    if (propertyType.kind === 'function') {
      expr.inferredType = propertyType;
      return propertyType;
    } else {
      validator.addError(
        `Property '${(expr.property as Identifier).name}' is not a method`,
        expr.property.location
      );
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }
  }

  // For property access, return nullable version of the property type
  return makeNullableType(propertyType);
}

export function validateNonNullAssertionExpression(expr: NonNullAssertionExpression, validator: Validator): Type {
  const operandType = validateExpression(expr.operand, validator);

  // Operand should be nullable
  if (!isNullableType(operandType)) {
    validator.addError(
      `Non-null assertion (!) can only be applied to nullable types, but got: ${typeToString(operandType)}`,
      expr.operand.location
    );
    expr.inferredType = operandType;
    return operandType;
  }

  // Return the non-null version of the type
  return stripNullableType(operandType);
}

function makeNullableType(type: Type): Type {
  if (isNullableType(type)) {
    return type; // Already nullable
  }

  return {
    kind: 'union',
    types: [type, createPrimitiveType('null')]
  } as UnionTypeNode;
}

function validatePropertyAccess(objectType: Type, propertyName: string, validator: Validator, location?: any): Type {
  // This is a simplified version - in the real implementation, 
  // you would need to resolve the object type and check its members
  switch (objectType.kind) {
    case 'class':
      const classType = objectType as ClassTypeNode;
      const classDecl = validator.context.classes.get(classType.name);
      if (classDecl) {
        const field = classDecl.fields.find(f => f.name.name === propertyName);
        if (field) {
          return field.type;
        }
        const method = classDecl.methods.find(m => m.name.name === propertyName);
        if (method) {
          return createFunctionType(
            method.parameters.map(p => ({ name: p.name.name, type: p.type })),
            method.returnType
          );
        }
      }
      break;
    default:
      validator.addError(`Cannot access property '${propertyName}' on type ${typeToString(objectType)}`, location);
      return createUnknownType();
  }

  validator.addError(`Property '${propertyName}' does not exist on type ${typeToString(objectType)}`, location);
  return createUnknownType();
}

function validateComputedPropertyAccess(objectType: Type, indexExpr: Expression, validator: Validator, location?: any): Type {
  // Simplified implementation - handle arrays, maps, etc.
  if (objectType.kind === 'array') {
    return (objectType as ArrayTypeNode).elementType;
  }

  if (objectType.kind === 'map') {
    return (objectType as MapTypeNode).valueType;
  }

  validator.addError(`Cannot use computed property access on type ${typeToString(objectType)}`, location);
  return createUnknownType();
}
