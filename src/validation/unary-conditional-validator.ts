import { 
  UnaryExpression, 
  ConditionalExpression, 
  Type,
  Identifier
} from "../types";
import { 
  isNumericType, 
  getCommonNumericType, 
  typeToString, 
  isTypeCompatible, 
  isBooleanType, 
  createBoolType,
  isTypeEqual
} from "../type-utils";
import { Validator } from "./validator";
import { validateExpression } from "./expression-validator";
import { isIdentifierParameter } from "./declaration-validator";

export function validateUnaryExpression(expr: UnaryExpression, validator: Validator): Type {
  const operandType = validateExpression(expr.operand, validator);
  let resultType: Type;

  switch (expr.operator) {
    case '-':
    case '+':
      if (isNumericType(operandType)) {
        resultType = operandType;
      } else {
        validator.addError(`Unary operator '${expr.operator}' cannot be applied to type '${typeToString(operandType)}'`, expr.location);
        resultType = operandType;
      }
      break;
    case '!':
      if (isBooleanType(operandType)) {
        resultType = operandType;
      } else {
        validator.addError(`Logical not operator requires boolean operand`, expr.location);
        resultType = createBoolType();
      }
      break;
    case '++':
    case '--':
    case '++_post':
    case '--_post':
      if (isNumericType(operandType)) {
        if (expr.operand.kind === 'identifier') {
          const identifier = expr.operand as Identifier;
          if (isIdentifierParameter(identifier.name, validator)) {
            validator.addError(
              `Cannot modify parameter '${identifier.name}'. Parameters are immutable; assign to a local variable instead.`,
              identifier.location
            );
          }
        }
        resultType = operandType;
      } else {
        validator.addError(`Increment/decrement operators require numeric operand`, expr.location);
        resultType = operandType;
      }
      break;
    default:
      validator.addError(`Unknown unary operator: ${expr.operator}`, expr.location);
      resultType = operandType;
  }

  expr.inferredType = resultType;
  return resultType;
}

export function validateConditionalExpression(expr: ConditionalExpression, validator: Validator): Type {
  const testType = validateExpression(expr.test, validator);
  const consequentType = validateExpression(expr.consequent, validator);
  const alternateType = validateExpression(expr.alternate, validator);

  // Test must be boolean
  if (!isBooleanType(testType)) {
    validator.addError(`Ternary condition must be of boolean type, got '${typeToString(testType)}'`, expr.test.location);
  }

  // Check if types are equal
  if (isTypeEqual(consequentType, alternateType)) {
    expr.inferredType = consequentType;
    return consequentType;
  }

  // If both are numeric, find common numeric type
  if (isNumericType(consequentType) && isNumericType(alternateType)) {
    const resultType = getCommonNumericType(consequentType, alternateType);
    expr.inferredType = resultType;
    return resultType;
  }

  // Check if one is compatible with the other
  if (isTypeCompatible(alternateType, consequentType, validator)) {
    expr.inferredType = consequentType;
    return consequentType;
  }

  if (isTypeCompatible(consequentType, alternateType, validator)) {
    expr.inferredType = alternateType;
    return alternateType;
  }

  // Types are incompatible
  validator.addError(
    `Incompatible types in ternary expression: '${typeToString(consequentType)}' and '${typeToString(alternateType)}'`,
    expr.location
  );

  expr.inferredType = consequentType; // fallback to consequent type
  return consequentType;
}
