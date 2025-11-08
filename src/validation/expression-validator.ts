import { validateIdentifier } from "./declaration-validator";
import { validateLiteral } from "./literals-validator";
import { validateBinaryExpression } from "./binary-expression-validator";
import { validateUnaryExpression, validateConditionalExpression } from "./unary-conditional-validator";
import { validateCallExpression } from "./call-expression-validator";
import { validateMemberExpression, validateIndexExpression } from "./member-access-validator";
import { validateObjectExpression, validatePositionalObjectExpression } from "./object-literal-validator";
import { validateArrayExpression, validateSetExpression } from "./collection-validator";
import { validateLambdaExpression, validateTrailingLambdaExpression } from "./lambda-validator";
import { validateTypeGuardExpression } from "./type-narrowing-validator";
import { 
  validateEnumShorthandExpression, 
  validateInterpolatedString,
  validateRangeExpression,
  validateTupleExpression
} from "./special-expressions-validator";
import { 
  validateNullCoalesceExpression, 
  validateOptionalChainExpression, 
  validateNonNullAssertionExpression 
} from "./null-safety-validator";
import { createUnknownType } from "../type-utils";
import { Expression, Type, InterpolatedString, RangeExpression } from "../types";
import { validateXmlCallExpression } from './xml-call-validator';
import { Validator } from "./validator";

export function validateExpression(expr: Expression, validator: Validator): Type {
  let type: Type;
  
  switch (expr.kind) {
    case 'literal':
      type = validateLiteral(expr, validator);
      break;
    case 'identifier':
      type = validateIdentifier(expr, validator);
      break;
    case 'binary':
      type = validateBinaryExpression(expr, validator);
      break;
    case 'unary':
      type = validateUnaryExpression(expr, validator);
      break;
    case 'conditional':
      type = validateConditionalExpression(expr, validator);
      break;
    case 'call':
      type = validateCallExpression(expr, validator);
      break;
    case 'xmlCall':
      type = validateXmlCallExpression(expr as any, validator);
      break;
    case 'member':
      type = validateMemberExpression(expr, validator);
      break;
    case 'index':
      type = validateIndexExpression(expr, validator);
      break;
    case 'array':
      type = validateArrayExpression(expr, validator);
      break;
    case 'object':
      type = validateObjectExpression(expr, validator);
      break;
    case 'positionalObject':
      type = validatePositionalObjectExpression(expr, validator);
      break;
    case 'tuple':
      type = validateTupleExpression(expr, validator, validateExpression);
      break;
    case 'set':
      type = validateSetExpression(expr, validator);
      break;
    case 'enumShorthand':
      type = validateEnumShorthandExpression(expr, validator);
      break;
    case 'lambda':
      type = validateLambdaExpression(expr, validator);
      break;
    case 'trailingLambda':
      type = validateTrailingLambdaExpression(expr, validator);
      break;
    case 'typeGuard':
      type = validateTypeGuardExpression(expr, validator);
      break;
    case 'interpolated-string':
      type = validateInterpolatedString(expr, validator, validateExpression);
      break;
    case 'nullCoalesce':
      type = validateNullCoalesceExpression(expr, validator);
      break;
    case 'optionalChain':
      type = validateOptionalChainExpression(expr, validator);
      break;
    case 'nonNullAssertion':
      type = validateNonNullAssertionExpression(expr, validator);
      break;
    case 'range':
      type = validateRangeExpression(expr as RangeExpression, validator, validateExpression);
      break;
    default:
      // TypeScript exhaustiveness check: this should never be reached
      validator.addError(`Unknown expression kind: ${(expr as any).kind}`, (expr as any).location);
      type = createUnknownType();
      break;
  }
  
  // Ensure all expressions have their inferredType set
  // Some validators already set this, but this ensures consistency
  if (!expr.inferredType) {
    expr.inferredType = type;
  }
  
  return type;
}

// Re-export important functions that other modules might need
export { analyzeTypeGuard } from "./type-narrowing-validator";
export { propagateTypeContext } from "./binary-expression-validator";
export { canInferObjectLiteralType, inferObjectLiteralType } from "./object-literal-validator";
export { getLiteralType } from "./literals-validator";
export { isEnumMemberExpression } from "./special-expressions-validator";

// (moved) XML-call validation now lives in xml-call-validator.ts
