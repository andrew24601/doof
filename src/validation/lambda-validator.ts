import { validateExpression } from "./expression-validator";
import { validateBlockStatement } from "./statement-validator";
import { getCurrentScopeName } from "./declaration-validator";
import { typeToString, isTypeCompatible, createFunctionType, commonTypes } from "../type-utils";
import { Type, LambdaExpression, TrailingLambdaExpression, FunctionTypeNode, Parameter, Expression, BlockStatement, PrimitiveTypeNode, FunctionDeclaration, Identifier, SourceLocation } from "../types";
import { Validator } from "./validator";
import { LambdaCaptureAnalyzer } from "./lambda-capture-analyzer";
import { createScopeTrackerEntry, registerScopeTrackerEntry } from "./scope-tracker-helpers";

function createLambdaFunctionContext(
  parameters: Parameter[],
  returnType: Type,
  location: SourceLocation,
  bodyOverride?: BlockStatement
): FunctionDeclaration {
  const lambdaName: Identifier = {
    kind: 'identifier',
    name: `<lambda:${location.start.line}:${location.start.column}>`,
    location
  };

  return {
    kind: 'function',
    name: lambdaName,
    parameters,
    returnType,
    body: bodyOverride ?? { kind: 'block', body: [], location },
    location
  };
}

function getExpectedLambdaReturnType(expr: LambdaExpression): Type {
  if (expr.returnType) {
    return expr.returnType;
  }

  const expected = expr._expectedFunctionType;
  if (expected && expected.kind === 'function') {
    return (expected as FunctionTypeNode).returnType;
  }

  return commonTypes.void;
}

export function validateLambdaExpression(expr: LambdaExpression, validator: Validator): Type {
  const prevSymbols = new Map(validator.context.symbols);

  // Handle short-form lambda parameter inference
  let parameters = expr.parameters;
  if (expr.isShortForm && expr._expectedFunctionType && expr._expectedFunctionType.kind === 'function') {
    const expectedFunc = expr._expectedFunctionType as FunctionTypeNode;
    // Infer parameters from expected function type and update the expression
    parameters = expectedFunc.parameters.map(p => ({
      kind: 'parameter' as const,
      name: { kind: 'identifier' as const, name: p.name, location: expr.location },
      type: p.type,
      location: expr.location
    }));
    // Update the expression with inferred parameters
    expr.parameters = parameters;
  }

  // Add parameters to scope
  const expectedReturnType = getExpectedLambdaReturnType(expr);
  const lambdaFunctionContext = createLambdaFunctionContext(
    parameters,
    expectedReturnType,
    expr.location,
    expr.body.kind === 'block' ? (expr.body as BlockStatement) : undefined
  );
  const lambdaName = lambdaFunctionContext.name.name;
  const captureScopeName = getCurrentScopeName(validator);

  validator.pushLambdaScope(parameters.map(p => p.name.name), captureScopeName, lambdaName);
  for (const param of parameters) {
    validator.context.symbols.set(param.name.name, param.type);

    const entry = createScopeTrackerEntry({
      name: param.name.name,
      kind: 'parameter',
      scopeName: lambdaName,
      location: param.location,
      type: param.type,
      isConstant: true,
      declaringClass: validator.context.currentClass?.name.name
    });
    registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, entry);
  }

  const prevFunction = validator.context.currentFunction;
  validator.context.currentFunction = lambdaFunctionContext;

  let bodyType: Type;
  try {
    if (expr.body.kind === 'block') {
      validateBlockStatement(expr.body, validator);
      bodyType = expectedReturnType;
    } else {
      bodyType = validateExpression(expr.body as Expression, validator);
    }
  } finally {
    validator.context.currentFunction = prevFunction;
  }

  const funcType = createFunctionType(
    parameters.map(p => ({ name: p.name.name, type: p.type })),
    expr.returnType || bodyType
  );

  lambdaFunctionContext.returnType = expr.returnType || bodyType;

  // Analyze lambda captures using expected type context
  const captureAnalyzer = new LambdaCaptureAnalyzer(validator);
  captureAnalyzer.analyzeLambdaCaptures(expr, expr._expectedFunctionType);

  validator.context.symbols = prevSymbols;
  validator.popLambdaScope();

  expr.inferredType = funcType;
  return funcType;
}

export function validateTrailingLambdaExpression(expr: TrailingLambdaExpression, validator: Validator): Type {
  // First validate the callee and arguments like a regular call expression
  const calleeType = validateExpression(expr.callee, validator);

  for (const arg of expr.arguments) {
    validateExpression(arg, validator);
  }

  // Check if the callee is a function type and if the next parameter expects a lambda
  if (calleeType.kind === 'function') {
    const funcType = calleeType as FunctionTypeNode;
    const nextParamIndex = expr.arguments.length;

    // Check if there's a next parameter and if it's a function type
    if (nextParamIndex >= funcType.parameters.length) {
      validator.addError(
        `Function does not accept a trailing lambda - no more parameters expected`,
        expr.location
      );
      return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
    }

    const nextParam = funcType.parameters[nextParamIndex];
    if (nextParam.type.kind !== 'function') {
      validator.addError(
        `Function parameter at position ${nextParamIndex + 1} is not a function type - trailing lambda not allowed`,
        expr.location
      );
      return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
    }

    // The next parameter is a function type, so trailing lambda is valid
    const expectedLambdaType = nextParam.type as FunctionTypeNode;

    // Store expected function type for capture analysis
    expr.lambda._expectedFunctionType = expectedLambdaType;

    // Infer and store parameters from expected function signature
    expr.lambda.parameters = expectedLambdaType.parameters.map(p => ({
      kind: 'parameter' as const,
      name: { kind: 'identifier' as const, name: p.name, location: expr.location },
      type: p.type,
      location: expr.location
    }));

    // Validate the lambda body with the expected parameter types
    const prevSymbols = new Map(validator.context.symbols);
    const lambdaFunctionContext = createLambdaFunctionContext(
      expr.lambda.parameters!,
      expectedLambdaType.returnType,
      expr.location,
      expr.lambda.isBlock ? (expr.lambda.body as BlockStatement) : undefined
    );
    const lambdaName = lambdaFunctionContext.name.name;
    const captureScopeName = getCurrentScopeName(validator);

    validator.pushLambdaScope(expectedLambdaType.parameters.map(p => p.name), captureScopeName, lambdaName);

    // Add lambda parameters to scope based on expected function signature
    expectedLambdaType.parameters.forEach((param) => {
      validator.context.symbols.set(param.name, param.type);

      const entry = createScopeTrackerEntry({
        name: param.name,
        kind: 'parameter',
        scopeName: lambdaName,
        location: expr.location,
        type: param.type,
        isConstant: true,
        declaringClass: validator.context.currentClass?.name.name
      });
      registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, entry);
    });

    const prevFunction = validator.context.currentFunction;
    validator.context.currentFunction = lambdaFunctionContext;

    let bodyType: Type;
    try {
      if (expr.lambda.isBlock) {
        validateBlockStatement(expr.lambda.body as BlockStatement, validator);
        bodyType = expectedLambdaType.returnType;
      } else {
        bodyType = validateExpression(expr.lambda.body as Expression, validator);
      }
    } finally {
      validator.context.currentFunction = prevFunction;
    }

    // Check if lambda return type matches expected return type
    if (!isTypeCompatible(bodyType, expectedLambdaType.returnType, validator)) {
      validator.addError(
        `Lambda return type '${typeToString(bodyType)}' does not match expected type '${typeToString(expectedLambdaType.returnType)}'`,
        expr.location
      );
    }

    // Analyze lambda captures
    const captureAnalyzer = new LambdaCaptureAnalyzer(validator);
    captureAnalyzer.analyzeTrailingLambdaCaptures(expr, expectedLambdaType);

    validator.context.symbols = prevSymbols;
    validator.popLambdaScope();

    // The return type of a trailing lambda expression is the return type of the called function
    const returnType = funcType.returnType;
    expr.inferredType = returnType;
    return returnType;
  } else {
    validator.addError(
      `Cannot use trailing lambda on non-function expression`,
      expr.location
    );
    return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
  }
}
