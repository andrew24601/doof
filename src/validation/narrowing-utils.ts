import { Expression, Identifier, Literal, MemberExpression } from '../types';

/**
 * Builds a dot-separated access path (e.g. "foo.bar.baz") for an expression that
 * consists of identifiers and non-computed member accesses. Returns null when the
 * expression cannot be represented as a simple property path (for example, when
 * it involves computed indexing or other expression kinds).
 */
export function buildExpressionAccessPath(expr: Expression): string | null {
  switch (expr.kind) {
    case 'identifier':
      return (expr as Identifier).name;
    case 'member':
      return buildMemberExpressionAccessPath(expr as MemberExpression);
    default:
      return null;
  }
}

export function buildMemberExpressionAccessPath(expr: MemberExpression): string | null {
  if (expr.computed) {
    return null;
  }

  const propertyName = getPropertyName(expr.property);
  if (!propertyName) {
    return null;
  }

  const objectPath = buildExpressionAccessPath(expr.object);
  if (!objectPath) {
    return null;
  }

  return `${objectPath}.${propertyName}`;
}

function getPropertyName(property: Identifier | Literal): string | null {
  if (property.kind === 'identifier') {
    return property.name;
  }

  if (property.kind === 'literal' && property.literalType === 'string') {
    return String(property.value);
  }

  return null;
}
