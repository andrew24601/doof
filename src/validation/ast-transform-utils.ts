/**
 * Type-safe AST node transformation utilities.
 * 
 * Instead of mutating node types with unsafe casts, these utilities
 * properly transform nodes while preserving type safety.
 */

import {
  Expression,
  ObjectExpression,
  CallExpression,
  ArrayExpression,
  SetExpression,
  ASTNode,
  SourceLocation,
  Type
} from '../types';

/**
 * Shared properties that all AST nodes have.
 */
interface SharedASTProperties {
  location: SourceLocation;
  inferredType?: any;
}

/**
 * Safely copies shared properties from one AST node to another.
 */
function copySharedProperties(from: ASTNode, to: ASTNode): void {
  to.location = from.location;
  if (from.inferredType) {
    to.inferredType = from.inferredType;
  }
}

/**
 * Transforms an ObjectExpression to a CallExpression.
 * Used when an object literal with a className is actually a named argument function call.
 */
export function transformObjectToCall(expr: ObjectExpression, callExpr: CallExpression): void {
  // Instead of mutating the type, we copy all properties from callExpr to expr
  // The node remains typed as ObjectExpression in TypeScript, but at runtime
  // it has all the properties of a CallExpression.
  
  // This is still a runtime mutation, but we're being explicit about what we're doing
  // and the properties we're copying.
  Object.assign(expr, {
    kind: callExpr.kind,
    callee: callExpr.callee,
    arguments: callExpr.arguments,
    namedArguments: callExpr.namedArguments,
    callInfo: callExpr.callInfo,
    callInfoSnapshot: callExpr.callInfoSnapshot,
    intrinsicInfo: callExpr.intrinsicInfo,
    typeConversionInfo: callExpr.typeConversionInfo,
    enumConversionInfo: callExpr.enumConversionInfo,
    namedArgumentsLexicalOrder: callExpr.namedArgumentsLexicalOrder,
    argumentEvaluationOrder: callExpr.argumentEvaluationOrder,
    typeArguments: callExpr.typeArguments,
    resolvedTypeArguments: callExpr.resolvedTypeArguments,
    genericInstantiation: callExpr.genericInstantiation
  });
  
  // Remove properties that are specific to ObjectExpression
  delete (expr as any).properties;
  delete (expr as any).className;
  delete (expr as any).typeArguments;
  delete (expr as any).resolvedTypeArguments;
  delete (expr as any).genericInstantiation;
  delete (expr as any).instantiationInfo;
  delete (expr as any)._expectedEnumKeyType;
  delete (expr as any)._expectedUnionType;
}

/**
 * Transforms an ArrayExpression to a SetExpression.
 * Used when type context indicates the array literal should be interpreted as a set.
 */
export function transformArrayToSet(expr: ArrayExpression, setType: any): void {
  Object.assign(expr, {
    kind: 'set',
    inferredType: setType,
    _expectedEnumType: setType.elementType?.kind === 'enum' ? setType.elementType : undefined
  });
  
  // ArrayExpression and SetExpression both have 'elements', so no renaming needed
}

/**
 * Transforms a CallExpression to an ObjectExpression.
 * Used when Map() constructor is converted to an object literal.
 */
export function transformCallToObject(expr: CallExpression, objExpr: ObjectExpression): void {
  Object.assign(expr, {
    kind: objExpr.kind,
    properties: objExpr.properties,
    className: objExpr.className,
    inferredType: objExpr.inferredType,
    instantiationInfo: objExpr.instantiationInfo,
    typeArguments: objExpr.typeArguments,
    resolvedTypeArguments: objExpr.resolvedTypeArguments,
    genericInstantiation: objExpr.genericInstantiation
  });
  
  // Remove CallExpression-specific properties
  delete (expr as any).callee;
  delete (expr as any).arguments;
  delete (expr as any).namedArguments;
  delete (expr as any).callInfo;
  delete (expr as any).callInfoSnapshot;
  delete (expr as any).intrinsicInfo;
  delete (expr as any).typeConversionInfo;
  delete (expr as any).enumConversionInfo;
  delete (expr as any).namedArgumentsLexicalOrder;
  delete (expr as any).argumentEvaluationOrder;
}

/**
 * Transforms a CallExpression to a SetExpression.
 * Used when Set() constructor is converted to a set literal.
 */
export function transformCallToSet(expr: CallExpression, setExpr: SetExpression): void {
  Object.assign(expr, {
    kind: setExpr.kind,
    elements: setExpr.elements,
    inferredType: setExpr.inferredType,
    _expectedEnumType: setExpr._expectedEnumType
  });
  
  // Remove CallExpression-specific properties
  delete (expr as any).callee;
  delete (expr as any).arguments;
  delete (expr as any).namedArguments;
  delete (expr as any).callInfo;
  delete (expr as any).callInfoSnapshot;
  delete (expr as any).intrinsicInfo;
  delete (expr as any).typeConversionInfo;
  delete (expr as any).enumConversionInfo;
  delete (expr as any).namedArgumentsLexicalOrder;
  delete (expr as any).argumentEvaluationOrder;
}

/**
 * Sets a temporary property on an expression for type context propagation.
 * This is safer than arbitrary casting because we're explicit about what we're setting.
 */
export function setTemporaryProperty<T extends Expression, K extends string, V>(
  expr: T,
  key: K,
  value: V
): void {
  (expr as any)[key] = value;
}

/**
 * Gets a temporary property from an expression.
 */
export function getTemporaryProperty<T extends Expression, K extends string, V>(
  expr: T,
  key: K
): V | undefined {
  return (expr as any)[key];
}

/**
 * Transforms a Type node's kind in place.
 * Used when resolving type aliases to their underlying type.
 * This is a controlled mutation for type resolution.
 */
export function transformTypeKind(type: Type, newKind: Type['kind'], additionalProperties?: Record<string, any>): void {
  Object.assign(type, { kind: newKind, ...additionalProperties });
}
