import {
  Expression, Type, BinaryExpression, UnaryExpression, PrimitiveTypeNode
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import { generateExpression, generateExpressionWithContext, ExpressionContext } from "../cpp-expression-codegen";
import {
  inferCoercionFromTypes as inferCoercionFromTypesShared, CoercionInfo,
  isStringType as isStringTypeShared, isNumericType as isNumericTypeShared,
  isFloatingType as isFloatingTypeShared, typesEqual as typesEqualShared
} from "../../shared/type-coercion";
import {
  isIntegerLiteral,
  isFloatingLiteral,
  isFloatingLiteralWithZeroFraction,
  endsWithFloatSuffix
} from "../../shared/numeric-literal-utils";

const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);

/**
 * Generates C++ code for binary expressions with type coercion support
 */
export function generateBinaryExpression(generator: CppGenerator, expr: BinaryExpression, targetType?: Type): string {
  // Check for assignment operators first - these should never be treated as pure string concatenation
  if (isAssignmentOperator(expr.operator)) {
    // Use coercion handling which properly handles assignments
    const coercionInfo = inferCoercionFromTypesShared(expr);
    return generateBinaryExpressionWithCoercion(generator, expr, coercionInfo, targetType);
  }

  if (expr.inferredType && expr.inferredType.kind === 'primitive' && expr.inferredType.type === 'string') {
    // If the expression is inferred to be a string, treat it as string concatenation
    return generateStringConcatenation(generator, expr);
  }

  // Use shared coercion inference from inferredType properties
  const coercionInfo = inferCoercionFromTypesShared(expr);
  
  // Use inferred coercion decisions
  return generateBinaryExpressionWithCoercion(generator, expr, coercionInfo, targetType);
}

/**
 * Generates C++ code for unary expressions
 */
export function generateUnaryExpression(generator: CppGenerator, expr: UnaryExpression, targetType?: Type): string {
  // For numeric unary expressions with target type, pass target type to operand
  let operand: string;
  const requiresStorageAccess = expr.operator === '++' || expr.operator === '--' ||
    expr.operator === '++_post' || expr.operator === '--_post';

  if (requiresStorageAccess) {
    operand = generateExpressionWithContext(generator, expr.operand, { capturedAccessMode: 'storage' });
  } else if (targetType && (expr.operator === '+' || expr.operator === '-') && expr.operand.kind === 'literal') {
    operand = generateExpressionWithContext(generator, expr.operand, { targetType });
  } else {
    operand = generateExpression(generator, expr.operand);
  }

  const operandIsSimple = expr.operand.kind === 'literal' || expr.operand.kind === 'identifier';

  switch (expr.operator) {
    case '+':
      return operandIsSimple ? `+${operand}` : `(+${operand})`;
    case '-':
      return operandIsSimple ? `-${operand}` : `(-${operand})`;
    case '!':
      return `(!${operand})`;
    case '++':
      return `(++${operand})`;
    case '--':
      return `(--${operand})`;
    case '++_post':
      return `(${operand}++)`;
    case '--_post':
      return `(${operand}--)`;
    default:
      throw new Error(`Unsupported unary operator: ${expr.operator}`);
  }
}

/**
 * Generates C++ code for string concatenation operations
 */
export function generateStringConcatenation(generator: CppGenerator, expr: BinaryExpression): string {
  const convertToString = (operand: Expression): string => {
    const operandType = operand.inferredType;
    if (!operandType) {
      throw new Error('Operand has no inferred type for string conversion');
    }
    const operandCode = generateExpression(generator, operand);

    if (operandType.kind === 'primitive') {
      const primType = operandType as PrimitiveTypeNode;
      if (primType.type === 'string') {
        // For string literals, wrap in std::string() to avoid const char* pointer arithmetic
        // For string variables/expressions, use directly
        if (operand.kind === 'literal') {
          return `std::string(${operandCode})`;
        }
        return operandCode;
      } else if (primType.type === 'bool') {
        // Use conditional expression for boolean to string conversion
        return `(${operandCode} ? std::string("true") : std::string("false"))`;
      } else if (primType.type === 'char') {
        // Use std::string(1, char) for character to string conversion
        return `std::string(1, ${operandCode})`;
      } else {
        return `std::to_string(${operandCode})`;
      }
    } else {
      // For objects (class instances), use stringstream to serialize via _toJSON
      return `([&]() { std::ostringstream __ss; __ss << ${operandCode}; return __ss.str(); })()`;
    }
  };

  // Handle left operand - if it's also a string concatenation, expand it
  let leftCode: string;
  if (expr.left.kind === 'binary' && expr.left.operator === '+' && isStringTypeShared(expr.left.inferredType!)) {
    leftCode = generateStringConcatenation(generator, expr.left);
  } else {
    leftCode = convertToString(expr.left);
  }

  const rightCode = convertToString(expr.right);

  return `(${leftCode} + ${rightCode})`;
}

/**
 * Generates binary expressions with explicit type coercion
 */
function generateBinaryExpressionWithCoercion(
  generator: CppGenerator,
  expr: BinaryExpression,
  coercionInfo: CoercionInfo,
  targetType?: Type
): string {
  const isAssignment = isAssignmentOperator(expr.operator);

  // Use the coercion info to determine target types for operands
  let leftTargetType = coercionInfo.leftCoercion?.to;
  let rightTargetType = coercionInfo.rightCoercion?.to;

  // Generate operands with appropriate target types
  let leftContext: ExpressionContext | undefined;
  if (leftTargetType || isAssignment) {
    leftContext = {
      targetType: leftTargetType,
      capturedAccessMode: isAssignment ? 'storage' : undefined
    };
  }

  let left = leftContext
    ? generateExpressionWithContext(generator, expr.left, leftContext)
    : generateExpression(generator, expr.left);
  let right = rightTargetType
    ? generateExpressionWithContext(generator, expr.right, { targetType: rightTargetType })
    : generateExpression(generator, expr.right);

  // Apply left coercion if needed
  if (coercionInfo.leftCoercion) {
    left = applyCast(generator, left, coercionInfo.leftCoercion.from, coercionInfo.leftCoercion.to);
  }

  // Apply right coercion if needed
  if (coercionInfo.rightCoercion) {
    right = applyCast(generator, right, coercionInfo.rightCoercion.from, coercionInfo.rightCoercion.to);
  }

  // Generate the operation
  let result: string;
  if (isAssignment) {
    // Assignment operations don't get wrapped in parentheses
    result = `${left} ${expr.operator} ${right}`;
  } else {
    // Standard binary operations
    result = `(${left} ${expr.operator} ${right})`;
  }

  // Apply result coercion if target type differs from result type
  if (targetType && !typesEqualShared(coercionInfo.resultType, targetType)) {
    result = applyCast(generator, result, coercionInfo.resultType, targetType);
  }

  return result;
}

/**
 * Applies a type cast to an expression
 */
function applyCast(generator: CppGenerator, expression: string, fromType: Type, toType: Type): string {
  if (typesEqualShared(fromType, toType)) {
    return expression;
  }

  const toTypeName = generator.generateType(toType);

  // Optimize for simple numeric literal cases
  if (isNumericTypeShared(fromType) && isNumericTypeShared(toType)) {
    // Check if expression already has correct format for target type
    if (toType.kind === 'primitive' && toType.type === 'double') {
      // If expression is already in double format (e.g., "1.0"), don't cast
      if (isFloatingLiteral(expression) && !endsWithFloatSuffix(expression)) {
        return expression;
      }
    }

    // Check if this is a simple integer literal being cast to double/float
    if ((toType.kind === 'primitive' && (toType.type === 'double' || toType.type === 'float')) &&
      fromType.kind === 'primitive' && isIntegerType(fromType)) {
      // Check if expression is a simple number
      if (isIntegerLiteral(expression)) {
        // Generate clean floating-point literal
        return toType.type === 'double' ? `${expression}.0` : `${expression}.0f`;
      }
    }

    // Check if this is a simple floating literal being cast to integer
    if (isIntegerType(toType) && isFloatingTypeShared(fromType)) {
      if (isFloatingLiteralWithZeroFraction(expression)) {
        // For simple .0 cases, we can still use static_cast but it's cleaner
        return `static_cast<${toTypeName}>(${expression})`;
      }
    }

    return `static_cast<${toTypeName}>(${expression})`;
  }

  // Use explicit conversion for string conversions
  if (isStringTypeShared(toType)) {
    if (isNumericTypeShared(fromType)) {
      return `std::to_string(${expression})`;
    }
  }

  // Default to static_cast
  return `static_cast<${toTypeName}>(${expression})`;
}

// Type utility functions
function isIntegerType(type: Type): boolean {
  return type.kind === "primitive" &&
    ["int"].includes(type.type);
}

function isAssignmentOperator(operator: string): boolean {
  return ASSIGNMENT_OPERATORS.has(operator);
}
