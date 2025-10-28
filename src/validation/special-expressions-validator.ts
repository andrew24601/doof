import { typeToString, isTypeCompatible, createUnknownType, createPrimitiveType, validateEnumMember, createEnumType, createBoolType, isNumericType, getCommonNumericType, createFunctionType, resolveActualType } from "../type-utils";
import { Type, EnumShorthandMemberExpression, InterpolatedString, RangeExpression, Expression, EnumTypeNode, RangeTypeNode, CallExpression, BinaryExpression, UnaryExpression, ConditionalExpression, MemberExpression, FunctionTypeNode, PrimitiveTypeNode, ArrayExpression, ObjectExpression, ArrayTypeNode } from "../types";
import { Validator } from "./validator";
import { getMapMethodType, getSetMethodType, getArrayMethodType, getStringMethodType, getMathMethodType } from "./intrinsics-validator";


export function validateEnumShorthandExpression(expr: EnumShorthandMemberExpression, validator: Validator): Type {
  // Check if we have expected enum type context
  const expectedEnumType = expr._expectedEnumType;

  if (!expectedEnumType) {
    validator.addError(`Enum shorthand '.${expr.memberName}' can only be used in contexts with explicit enum type`, expr.location);
    return createUnknownType();
  }

  // Validate that the member exists in the expected enum
  if (!validateEnumMember(expectedEnumType, expr.memberName, expr.location, validator)) {
    return createUnknownType();
  }

  // Return the enum type
  expr.inferredType = expectedEnumType;
  return expectedEnumType;
}

export function validateInterpolatedString(expr: InterpolatedString, validator: Validator, validateExpressionFn: (expr: Expression, validator: Validator) => Type): Type {
  // Check if this is a tagged template
  if (expr.tagIdentifier) {
    return validateTaggedTemplate(expr, validator, validateExpressionFn);
  }

  // Validate each expression in the interpolated string
  for (const part of expr.parts) {
    if (typeof part !== 'string') {
      // Validate the expression part
      const partType = validateExpressionFn(part, validator);
      
      // Check if the type is printable (basic type checking for template interpolations)
      if (!isPrintableType(partType)) {
        validator.addError(
          `Expression in template is not printable: '${typeToString(partType)}'`,
          part.location
        );
      }

      // If it's a class/struct, mark for JSON print so codegen will emit _toJSON/helpers
      maybeMarkExprForJsonPrint(part, partType, validator);
    }
  }

  // Interpolated strings always result in string type
  expr.inferredType = createPrimitiveType('string');
  return expr.inferredType;
}

function validateTaggedTemplate(expr: InterpolatedString, validator: Validator, validateExpressionFn: (expr: Expression, validator: Validator) => Type): Type {
  const tagIdentifier = expr.tagIdentifier!;

  // Import validateIdentifier function is needed - for now let's resolve the tag manually
  const tagType = validator.context.symbols.get(tagIdentifier.name);

  if (!tagType) {
    validator.addError(
      `Tagged template tag '${tagIdentifier.name}' is not defined`,
      tagIdentifier.location
    );
    return createUnknownType();
  }

  if (tagType.kind !== 'function') {
    validator.addError(
      `Tagged template tag '${tagIdentifier.name}' must be a function, got '${typeToString(tagType)}'`,
      tagIdentifier.location
    );
    return createUnknownType();
  }

  const functionType = tagType as FunctionTypeNode;

  // Validate that the tag function has exactly 2 parameters
  if (functionType.parameters.length !== 2) {
    validator.addError(
      `Tagged template function '${tagIdentifier.name}' must have exactly 2 parameters (string[], value[]), got ${functionType.parameters.length}`,
      tagIdentifier.location
    );
    return createUnknownType();
  }

  // Validate first parameter is string[]
  const firstParam = functionType.parameters[0].type;
  if (firstParam.kind !== 'array' || (firstParam as ArrayTypeNode).elementType.kind !== 'primitive' ||
    ((firstParam as ArrayTypeNode).elementType as PrimitiveTypeNode).type !== 'string') {
    validator.addError(
      `Tagged template function '${tagIdentifier.name}' first parameter must be 'string[]', got '${typeToString(firstParam)}'`,
      tagIdentifier.location
    );
  }

  // Extract value expressions (non-string parts)
  const valueExpressions = expr.parts.filter(part => typeof part !== 'string') as Expression[];

  // Validate expressions and check against second parameter type
  const secondParam = functionType.parameters[1].type;
  if (secondParam.kind === 'array') {
    const expectedElementType = (secondParam as ArrayTypeNode).elementType;

    for (const valueExpr of valueExpressions) {
      // Validate the expression and check type compatibility
      const actualType = validateExpressionFn(valueExpr, validator);
      if (!isTypeCompatible(actualType, expectedElementType, validator)) {
        validator.addError(
          `Tagged template expression has type '${typeToString(actualType)}' but tag function expects '${typeToString(expectedElementType)}'`,
          valueExpr.location
        );
      }
    }
  } else {
    validator.addError(
      `Tagged template function '${tagIdentifier.name}' second parameter must be an array type, got '${typeToString(secondParam)}'`,
      tagIdentifier.location
    );
  }

  // Return the function's return type
  expr.inferredType = functionType.returnType;
  return functionType.returnType;
}

export function validateRangeExpression(expr: RangeExpression, validator: Validator, validateExpressionFn: (expr: Expression, validator: Validator) => Type): Type {
  const startType = validateExpressionFn(expr.start, validator);
  const endType = validateExpressionFn(expr.end, validator);

  // Both start and end must be integers
  if (!isTypeCompatible(startType, createPrimitiveType('int'), validator)) {
    validator.addError(`Range start must be an integer, got ${typeToString(startType)}`, expr.start.location);
  }

  if (!isTypeCompatible(endType, createPrimitiveType('int'), validator)) {
    validator.addError(`Range end must be an integer, got ${typeToString(endType)}`, expr.end.location);
  }

  // Range expressions themselves represent a special "range" type that can be iterated
  const rangeType: RangeTypeNode = {
    kind: 'range',
    start: startType,
    end: endType,
    inclusive: expr.inclusive
  };
  
  expr.inferredType = rangeType;
  return rangeType;
}

export function isEnumMemberExpression(expr: Expression, validator: Validator): boolean {
  // Check for enum member access: identifier.member
  if (expr.kind === 'member') {
    const memberExpr = expr as MemberExpression;
    if (memberExpr.object.kind === 'identifier' && !memberExpr.computed) {
      const enumName = (memberExpr.object as any).name;
      return validator.context.enums.has(enumName);
    }
  }

  // Check for enum shorthand: .member
  if (expr.kind === 'enumShorthand') {
    return true; // Validation of enum member happens elsewhere
  }

  return false;
}



function isPrintableType(type: Type): boolean {
  switch (type.kind) {
    case 'primitive':
      return true;
    case 'class':
    case 'array':
    case 'map':
    case 'set':
    case 'union':
    case 'enum':
      return true;
    default:
      return false;
  }
}

function maybeMarkExprForJsonPrint(expr: Expression, inferredType: Type, validator: Validator) {
  if (!inferredType) return;

  // Use a set to track visited types to avoid infinite recursion
  const visited = new Set<string>();
  markTypeForJsonPrint(inferredType, validator, visited);
}

function markTypeForJsonPrint(type: Type, validator: Validator, visited: Set<string>) {
  if (!type) return;

  switch (type.kind) {
    case 'class':
      const typeName = (type as any).name;
      if (visited.has(typeName)) return; // Avoid infinite recursion
      visited.add(typeName);

      validator.context.codeGenHints.jsonPrintTypes.add(typeName);

      // Recursively mark field types
      const classDecl = validator.context.classes.get(typeName);
      if (classDecl) {
        for (const field of classDecl.fields) {
          markTypeForJsonPrint(field.type, validator, visited);
        }
      }
      break;
    case 'array':
      markTypeForJsonPrint((type as any).elementType, validator, visited);
      break;
    case 'map':
      markTypeForJsonPrint((type as any).valueType, validator, visited);
      markTypeForJsonPrint((type as any).keyType, validator, visited);
      break;
    case 'set':
      markTypeForJsonPrint((type as any).elementType, validator, visited);
      break;
    case 'union':
      for (const t of (type as any).types) markTypeForJsonPrint(t, validator, visited);
      break;
    default:
      break;
  }
}

export function validateTupleExpression(expr: any, validator: Validator, validateExpression: (expr: Expression, validator: Validator) => Type): Type {
  // Import TupleExpression type dynamically to avoid circular dependency issues
  const tupleExpr = expr as any; // TupleExpression
  
  // First, try to infer the target type from context
  const targetType = inferTupleTargetType(tupleExpr, validator);
  
  if (!targetType) {
    validator.addError('Cannot infer type for tuple expression - no type context available', tupleExpr.location);
    return createUnknownType();
  }
  
  // Store the inferred target type for later use
  tupleExpr._inferredTargetType = targetType;
  
  // Validate that the target type supports positional initialization
  if (targetType.kind !== 'class' && targetType.kind !== 'externClass') {
    validator.addError(`Tuple expressions can only be used for class/struct types, got '${typeToString(targetType)}'`, tupleExpr.location);
    return createUnknownType();
  }
  
  // Validate elements and check compatibility with target type
  const elementTypes: Type[] = [];
  for (const element of tupleExpr.elements) {
    const elementType = validateExpression(element, validator);
    elementTypes.push(elementType);
  }
  
  // Check if the target type can be constructed positionally with these arguments
  const typeName = (targetType as any).name;
  const classDecl = validator.context.classes.get(typeName);
  
  if (classDecl) {
    // Validate against class fields
    const publicFields = classDecl.fields.filter(f => f.isPublic);
    
    if (tupleExpr.elements.length > publicFields.length) {
      validator.addError(`Too many arguments for ${typeName}: expected ${publicFields.length}, got ${tupleExpr.elements.length}`, tupleExpr.location);
      return targetType;
    }
    
    // Check type compatibility for each provided argument
    for (let i = 0; i < tupleExpr.elements.length; i++) {
      const expectedType = publicFields[i].type;
      const actualType = elementTypes[i];
      
      if (!isTypeCompatible(actualType, expectedType, validator)) {
        validator.addError(
          `Argument ${i + 1} of tuple: cannot convert '${typeToString(actualType)}' to '${typeToString(expectedType)}'`,
          tupleExpr.elements[i].location
        );
      }
    }
    
    // Check if all required fields are provided (those without default values)
    for (let i = tupleExpr.elements.length; i < publicFields.length; i++) {
      const field = publicFields[i];
      if (!field.defaultValue) {
        validator.addError(`Missing required argument for field '${field.name.name}' in ${typeName}`, tupleExpr.location);
      }
    }
  } else {
    // External class - cannot validate positional arguments, assume valid
    validator.addError(`Cannot validate tuple arguments for external class '${typeName}' - validation not supported`, tupleExpr.location);
  }
  
  tupleExpr.inferredType = targetType;
  return targetType;
}

function inferTupleTargetType(tupleExpr: any, validator: Validator): Type | null {
  // Check if type context was propagated during assignment validation
  if (tupleExpr._inferredTargetType) {
    return tupleExpr._inferredTargetType;
  }
  
  // Future enhancements could include:
  // 1. Function parameter types during argument validation
  // 2. Return types during return statement validation  
  // 3. Array element types during array literal validation
  // 4. Field types during object literal validation
  
  return null;
}
