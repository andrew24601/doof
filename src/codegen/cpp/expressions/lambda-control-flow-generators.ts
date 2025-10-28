import {
  Expression, Type, LambdaExpression, TrailingLambdaExpression, ConditionalExpression,
  TypeGuardExpression, BlockStatement,
  PrimitiveTypeNode, UnionTypeNode, ClassTypeNode, FunctionTypeNode, Identifier, CapturedBinding, CaptureInfo
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import { generateExpression } from "../cpp-expression-codegen";

/**
 * Generates C++ code for lambda expressions
 */
export function generateLambdaExpression(generator: CppGenerator, expr: LambdaExpression): string {
  const params = expr.parameters.map(p => {
    const paramType = generator.generateType(p.type);
    return `${paramType} ${p.name.name}`;
  }).join(', ');

  // Generate capture clause from capture analysis
  let captureClause = '[]';
  if (expr.captureInfo && expr.captureInfo.capturedVariables.length > 0) {
    const captures = expr.captureInfo.capturedVariables
      .filter(capture => !shouldOmitCapture(generator, capture.name))
      .map(capture => renderCaptureClause(generator, capture));
    if (captures.length > 0) {
      captureClause = `[${captures.join(', ')}]`;
    }
  }

  if (expr.body.kind === 'block') {
    // Use the block statement generator from the context
    const blockBody = generator.generateBlockStatement(expr.body as BlockStatement);
    const mutableKeyword = shouldMakeLambdaMutable(generator, expr.captureInfo);
    return `${captureClause}(${params})${mutableKeyword} ${blockBody}`;
  } else {
    const bodyExpr = generateExpression(generator, expr.body as Expression);
    const returnType = expr.returnType ?? (expr.body as Expression).inferredType;
    const isVoidReturn = returnType?.kind === 'primitive' && returnType.type === 'void';
    const mutableKeyword = shouldMakeLambdaMutable(generator, expr.captureInfo);

    if (isVoidReturn) {
      return `${captureClause}(${params})${mutableKeyword} { ${bodyExpr}; }`;
    }

    return `${captureClause}(${params})${mutableKeyword} { return ${bodyExpr}; }`;
  }
}

/**
 * Generates C++ code for trailing lambda expressions
 */
export function generateTrailingLambdaExpression(generator: CppGenerator, expr: TrailingLambdaExpression): string {
  const callee = generateExpression(generator, expr.callee);
  const args = expr.arguments.map(arg => generateExpression(generator, arg));

  // Create a lambda expression object manually since expr.lambda is not a full LambdaExpression
  const lambdaBody = expr.lambda.body;
  const lambdaParams = expr.lambda.parameters || [];

  const params = lambdaParams.map(p => {
    const paramType = generator.generateType(p.type);
    return `${paramType} ${p.name.name}`;
  }).join(', ');

  // Generate capture clause from capture analysis
  let captureClause = '[]';
  if (expr.lambda.captureInfo && expr.lambda.captureInfo.capturedVariables.length > 0) {
    const captures = expr.lambda.captureInfo.capturedVariables
      .filter(capture => !shouldOmitCapture(generator, capture.name))
      .map(capture => renderCaptureClause(generator, capture));
    if (captures.length > 0) {
      captureClause = `[${captures.join(', ')}]`;
    }
  }

  if (expr.lambda.isBlock) {
    // Use the block statement generator from the context
    const blockBody = generator.generateBlockStatement(lambdaBody as BlockStatement);
    const mutableKeyword = shouldMakeLambdaMutable(generator, expr.lambda.captureInfo);
    const lambdaCode = `${captureClause}(${params})${mutableKeyword} ${blockBody}`;
    const allArgs = args.length > 0 ? `${args.join(', ')}, ${lambdaCode}` : lambdaCode;
    return `${callee}(${allArgs})`;
  } else {
    const bodyExpr = generateExpression(generator, lambdaBody as Expression);
    let returnType: Type | undefined;
    if (expr.lambda._expectedFunctionType && expr.lambda._expectedFunctionType.kind === 'function') {
      returnType = (expr.lambda._expectedFunctionType as FunctionTypeNode).returnType;
    } else {
      returnType = (lambdaBody as Expression).inferredType;
    }
    const isVoidReturn = returnType?.kind === 'primitive' && returnType.type === 'void';
    const mutableKeyword = shouldMakeLambdaMutable(generator, expr.lambda.captureInfo);

    const lambdaBodyCode = isVoidReturn
      ? `${captureClause}(${params})${mutableKeyword} { ${bodyExpr}; }`
      : `${captureClause}(${params})${mutableKeyword} { return ${bodyExpr}; }`;

    const lambdaCode = lambdaBodyCode;
    const allArgs = args.length > 0 ? `${args.join(', ')}, ${lambdaCode}` : lambdaCode;
    return `${callee}(${allArgs})`;
  }
}

const ALWAYS_SKIP_CAPTURES = new Set(['println', 'print', 'panic']);

function shouldOmitCapture(generator: CppGenerator, captureName: string): boolean {
  if (ALWAYS_SKIP_CAPTURES.has(captureName)) {
    return true;
  }

  const context = generator.validationContext;
  if (!context) {
    return false;
  }

  const hasScopedEntry = (() => {
    for (const [key, info] of context.codeGenHints.scopeTracker.entries()) {
      if (!key.startsWith(`${captureName}_`)) {
        continue;
      }
      if (info.kind === 'local' || info.kind === 'parameter' || info.kind === 'field') {
        return true;
      }
    }
    return false;
  })();

  if (hasScopedEntry) {
    return false;
  }

  if (context.functions.has(captureName)) {
    return true;
  }

  if (context.codeGenHints.builtinFunctions.has(captureName)) {
    return true;
  }

  const symbol = context.symbols.get(captureName);
  if (symbol && symbol.kind === 'function') {
    return true;
  }

  return false;
}

function renderCaptureClause(generator: CppGenerator, capture: CapturedBinding): string {
  return determineCaptureMode(generator, capture) === 'reference'
    ? `&${capture.name}`
    : capture.name;
}

function determineCaptureMode(generator: CppGenerator, capture: CapturedBinding): 'reference' | 'value' {
  const capturedMutableScopes = generator.validationContext?.codeGenHints.capturedMutableScopes;
  const requiresValueCapture = capture.declarationScopeId
    ? capturedMutableScopes?.has(capture.declarationScopeId) ?? false
    : false;

  if (requiresValueCapture) {
    return 'value';
  }

  return isReferenceCapture(capture) ? 'reference' : 'value';
}

function isReferenceCapture(capture: CapturedBinding): boolean {
  if (capture.variableKind === 'this') {
    return true;
  }

  if (capture.variableKind === 'field' || capture.variableKind === 'global') {
    return true;
  }

  if (capture.writesInside) {
    return true;
  }

  return false;
}

function shouldMakeLambdaMutable(generator: CppGenerator, captureInfo?: CaptureInfo): string {
  if (!captureInfo) {
    return '';
  }

  const needsMutable = captureInfo.capturedVariables.some((capture: CapturedBinding) =>
    capture.writesInside && determineCaptureMode(generator, capture) === 'value'
  );

  return needsMutable ? ' mutable' : '';
}

/**
 * Generates C++ code for conditional expressions (ternary operator)
 */
export function generateConditionalExpression(generator: CppGenerator, expr: ConditionalExpression): string {
  const test = generateExpression(generator, expr.test);
  const consequent = generateExpression(generator, expr.consequent);
  const alternate = generateExpression(generator, expr.alternate);

  const conditionalExpr = `(${test} ? ${consequent} : ${alternate})`;

  if (expr.inferredType && expr.inferredType.kind === 'primitive' && expr.inferredType.type === 'string') {
    return `std::string${conditionalExpr}`;
  }

  return conditionalExpr;
}

/**
 * Generates C++ code for type guard expressions
 */
export function generateTypeGuardExpression(generator: CppGenerator, expr: TypeGuardExpression): string {
  // Type guards generate boolean expressions for runtime type checking
  // For type guards, we need to use the original variable without any narrowing context
  let variable: string;
  if (expr.expression.kind === 'identifier') {
    // For identifiers in type guards, always use the original name without narrowing
    variable = (expr.expression as Identifier).name;
  } else {
    // For other expressions, generate normally
    variable = generateExpression(generator, expr.expression);
  }
  const targetType = expr.type;

  if (targetType.kind === 'primitive') {
    const primType = targetType as PrimitiveTypeNode;
    if (primType.type === 'null') {
      return `(${variable} == nullptr)`;
    } else {
      // For variant types, use std::holds_alternative
      return `std::holds_alternative<${generator.generateType(targetType)}>(${variable})`;
    }
  } else if (targetType.kind === 'class') {
    const classType = targetType as ClassTypeNode;
    return `(${variable} != nullptr)`;
  } else if (targetType.kind === 'union') {
    // For union type guards, we need to check if the variant holds any of the union types
    const unionType = targetType as UnionTypeNode;
    if (unionType.types.length === 1) {
      return `std::holds_alternative<${generator.generateType(unionType.types[0])}>(${variable})`;
    } else {
      // For multiple types, we need to check each one
      const checks = unionType.types.map(type =>
        `std::holds_alternative<${generator.generateType(type)}>(${variable})`
      );
      return `(${checks.join(' || ')})`;
    }
  }

  // Fallback for unknown types
  return `true`;
}
