import { Literal, Type, PrimitiveTypeNode } from "../types";
import { createPrimitiveType, createBoolType, createUnknownType, commonTypes } from "../type-utils";
import { Validator } from "./validator";

export function validateLiteral(expr: Literal, validator: Validator): Type {
  switch (expr.literalType) {
    case 'number':
      // Use originalText to determine if the literal was written as floating-point
      const numValue = expr.value as number;
      if (expr.originalText) {
        if (expr.originalText.endsWith('f') || expr.originalText.endsWith('F')) {
          // This was written with 'f' suffix (e.g., "3.14f", "1.0f")
          expr.inferredType = createPrimitiveType('float');
        } else if (expr.originalText.includes('.')) {
          // This was written as a floating-point literal without suffix (e.g., "1.0", "3.14")
          expr.inferredType = createPrimitiveType('double');
        } else {
          // verify value is in int range
          if (numValue < -2147483648 || numValue > 2147483647)
            validator.addError(`Integer literal out of range: ${numValue}`, expr.location);
          expr.inferredType = createPrimitiveType('int');
        }
      } else {
        validator.addError(`Literal is missing original text for type inference`, expr.location);
        return createUnknownType();
      }
      return expr.inferredType;
    case 'string':
      expr.inferredType = createPrimitiveType('string');
      return expr.inferredType;
    case 'char':
      expr.inferredType = createPrimitiveType('char');
      return expr.inferredType;
    case 'boolean':
      expr.inferredType = createBoolType();
      return expr.inferredType;
    case 'null':
      expr.inferredType = createPrimitiveType('null');
      return expr.inferredType;
    default:
      validator.addError(`Unknown literal type: ${expr.literalType}`, expr.location);
      return createUnknownType();
  }
}

export function getLiteralType(literal: Literal): Type {
  switch (literal.literalType) {
    case 'string':
      return commonTypes.string;
    case 'number':
      // Simple heuristic: if it has a decimal point, it's double, otherwise int
      const value = String(literal.value);
      return value.includes('.') ? commonTypes.double : commonTypes.int;
    case 'boolean':
      return commonTypes.bool;
    default:
      return commonTypes.int;
  }
}
