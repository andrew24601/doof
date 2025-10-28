import { validateExpression } from "./expression-validator";
import { typeToString, isTypeCompatible, validateType, createPrimitiveType, isNullableType, stripNullableType } from "../type-utils";
import { Type, TypeGuardExpression, Expression, BinaryExpression, MemberExpression, Identifier, Literal, UnionTypeNode, PrimitiveTypeNode, ClassTypeNode } from "../types";
import { Validator } from "./validator";
import { buildExpressionAccessPath } from "./narrowing-utils";

export interface TypeGuardAnalysisResult {
  thenNarrowing: Map<string, Type>;
  elseNarrowing: Map<string, Type>;
  originalTypes: Map<string, Type>;
}

export function validateTypeGuardExpression(expr: TypeGuardExpression, validator: Validator): Type {
  // Validate the expression being type-checked
  const exprType = validateExpression(expr.expression, validator);

  // Validate the guard type
  validateType(expr.type, expr.location, validator);

  // Generate JavaScript condition for code generation
  let jsCondition = '';
  const exprName = expr.expression.kind === 'identifier' ?
    (expr.expression as Identifier).name : 'expr';

  if (expr.type.kind === 'primitive') {
    const primType = expr.type as PrimitiveTypeNode;
    switch (primType.type) {
      case 'string':
        jsCondition = `typeof ${exprName} === 'string'`;
        break;
      case 'int':
      case 'float':
      case 'double':
        jsCondition = `typeof ${exprName} === 'number'`;
        break;
      case 'bool':
        jsCondition = `typeof ${exprName} === 'boolean'`;
        break;
      case 'null':
        jsCondition = `${exprName} === null`;
        break;
      default:
        jsCondition = `typeof ${exprName} === 'object'`;
    }
  } else if (expr.type.kind === 'class') {
    const typeName = expr.type.name;
    jsCondition = `${exprName} instanceof ${typeName}`;
  } else {
    jsCondition = `/* TODO: type guard for ${expr.type.kind} */`;
  }

  // Store type guard metadata for code generation
  const guardKey = `${expr.location?.start?.line || 0}_${expr.location?.start?.column || 0}`;
  validator.context.codeGenHints.typeGuards.set(guardKey, {
    jsCondition,
    originalType: exprType,
    targetType: expr.type
  });

  // Check for impossible type guards
  // For union types, check if the target type is in the union
  if (exprType.kind === 'union') {
    const unionType = exprType as UnionTypeNode;
    const targetMatches = unionType.types.some(t => 
      typeToString(t) === typeToString(expr.type)
    );
    if (!targetMatches) {
      const guardTypeString = typeToString(expr.type);
      validator.addError(
        `Type guard for '${guardTypeString}' will never be true - not present in union type '${typeToString(exprType)}'`,
        expr.location
      );
    }
  }
  // For class types, allow null checks (since classes are shared_ptr)
  else if (exprType.kind === 'class' && typeToString(expr.type) === 'null') {
    // This is valid - checking if shared_ptr is null
  }
  // For non-union/optional types, warn about potentially unnecessary type guards
  else if (typeToString(exprType) !== typeToString(expr.type)) {
    validator.addError(
      `Type guard for '${typeToString(expr.type)}' will never be true - expression has type '${typeToString(exprType)}'`,
      expr.location
    );
  }

  // Type guard expressions always return boolean
  const boolType = createPrimitiveType('bool');
  expr.inferredType = boolType;
  return boolType;
}

/**
 * Analyzes an expression to see if it's a type guard that can be used for type narrowing.
 * Returns narrowing information for then/else branches, or null if no narrowing is possible.
 */
export function analyzeTypeGuard(condition: Expression, validator: Validator): TypeGuardAnalysisResult | null {
  // Handle explicit type guards
  if (condition.kind === 'typeGuard') {
    return analyzeExplicitTypeGuard(condition as TypeGuardExpression, validator);
  }

  // Handle const field comparisons for type narrowing
  if (condition.kind === 'binary') {
    const binaryCondition = condition as BinaryExpression;
    const nullComparison = analyzeNullComparison(binaryCondition, validator);
    if (nullComparison) {
      return nullComparison;
    }

    if (binaryCondition.operator === '==') {
      return analyzeConstFieldComparison(binaryCondition, validator);
    }
  }

  return null;
}

function analyzeExplicitTypeGuard(typeGuard: TypeGuardExpression, validator: Validator): TypeGuardAnalysisResult | null {
  // The expression being type-checked must be an identifier for narrowing to work
  if (typeGuard.expression.kind !== 'identifier') {
    return null;
  }

  const identifier = typeGuard.expression as Identifier;
  const variableName = identifier.name;

  // Get the current type of the variable
  const currentType = validator.context.symbols.get(variableName);
  if (!currentType) {
    return null;
  }

  const guardType = typeGuard.type;
  const guardTypeString = typeToString(guardType);

  // Union and optional types can be narrowed
  if (currentType.kind === 'union') {
  return analyzeUnionTypeGuard(variableName, currentType as UnionTypeNode, guardType, guardTypeString);
  }

  return null;
}

function analyzeUnionTypeGuard(variableName: string, unionType: UnionTypeNode, guardType: Type, guardTypeString: string): TypeGuardAnalysisResult | null {
  // Find the matching type in the union
  const matchingType = unionType.types.find(t => typeToString(t) === guardTypeString);
  if (!matchingType) {
    return null;
  }

  // Create narrowed types
  const thenNarrowing = new Map<string, Type>();
  const elseNarrowing = new Map<string, Type>();
  const originalTypes = new Map<string, Type>();

  originalTypes.set(variableName, unionType);

  // In the then-branch, narrow to the guard type
  thenNarrowing.set(variableName, matchingType);

  // In the else-branch, narrow to the remaining types in the union
  const remainingTypes = unionType.types.filter(t => typeToString(t) !== guardTypeString);
  if (remainingTypes.length === 1) {
    // If only one type remains, narrow to that type
    elseNarrowing.set(variableName, remainingTypes[0]);
  } else if (remainingTypes.length > 1) {
    // If multiple types remain, create a new union type
    const remainingUnion: UnionTypeNode = {
      kind: 'union',
      types: remainingTypes
    };
    elseNarrowing.set(variableName, remainingUnion);
  }

  return { thenNarrowing, elseNarrowing, originalTypes };
}

function analyzeNullComparison(binaryExpr: BinaryExpression, validator: Validator): TypeGuardAnalysisResult | null {
  const equalityOperators = ['==', '!=', '===', '!=='];
  if (!equalityOperators.includes(binaryExpr.operator)) {
    return null;
  }

  const leftIsNull = isNullLiteral(binaryExpr.left);
  const rightIsNull = isNullLiteral(binaryExpr.right);

  if (!leftIsNull && !rightIsNull) {
    return null;
  }

  const candidate = leftIsNull ? binaryExpr.right : binaryExpr.left;
  const target = resolveNarrowingTarget(candidate, validator);
  if (!target) {
    return null;
  }

  const { key, currentType } = target;

  if (!isNullableType(currentType)) {
    return null;
  }

  const thenNarrowing = new Map<string, Type>();
  const elseNarrowing = new Map<string, Type>();
  const originalTypes = new Map<string, Type>();

  originalTypes.set(key, currentType);

  const nonNullType = stripNullableType(currentType);
  const nullType = createPrimitiveType('null');
  const isEqualityCheck = binaryExpr.operator === '==' || binaryExpr.operator === '===';

  if (isEqualityCheck) {
    thenNarrowing.set(key, nullType);
    elseNarrowing.set(key, nonNullType);
  } else {
    thenNarrowing.set(key, nonNullType);
    elseNarrowing.set(key, nullType);
  }

  return { thenNarrowing, elseNarrowing, originalTypes };
}

function isNullLiteral(expr: Expression): boolean {
  return expr.kind === 'literal' && (expr as Literal).literalType === 'null';
}

type NarrowingTarget = { key: string; currentType: Type };

function resolveNarrowingTarget(expr: Expression, validator: Validator): NarrowingTarget | null {
  if (expr.kind === 'identifier') {
    const name = (expr as Identifier).name;
    const symbolType = validator.context.symbols.get(name) ?? expr.inferredType;
    if (!symbolType) {
      return null;
    }
    return { key: name, currentType: symbolType };
  }

  if (expr.kind === 'member') {
    const path = buildExpressionAccessPath(expr as MemberExpression);
    if (!path) {
      return null;
    }

    const inferredType = expr.inferredType ?? validator.context.propertyNarrowings.get(path);
    if (!inferredType) {
      return null;
    }

    return { key: path, currentType: inferredType };
  }

  return null;
}

function analyzeConstFieldComparison(binaryExpr: BinaryExpression, validator: Validator): TypeGuardAnalysisResult | null {
  // Check if this is a member access comparison: variable.constField == literal
  let memberExpr: MemberExpression;
  let literal: Literal;

  if (binaryExpr.left.kind === 'member' && binaryExpr.right.kind === 'literal') {
    memberExpr = binaryExpr.left as MemberExpression;
    literal = binaryExpr.right as Literal;
  } else if (binaryExpr.right.kind === 'member' && binaryExpr.left.kind === 'literal') {
    memberExpr = binaryExpr.right as MemberExpression;
    literal = binaryExpr.left as Literal;
  } else {
    return null;
  }

  // The object being accessed must be an identifier
  if (memberExpr.object.kind !== 'identifier') {
    return null;
  }

  const identifier = memberExpr.object as Identifier;
  const variableName = identifier.name;
  const fieldName = memberExpr.property.kind === 'identifier'
    ? (memberExpr.property as Identifier).name
    : String((memberExpr.property as Literal).value);

  // Get the current type of the variable
  const currentType = validator.context.symbols.get(variableName);
  if (!currentType || currentType.kind !== 'union') {
    return null;
  }

  const unionType = currentType as UnionTypeNode;

  const originalTypes = new Map<string, Type>();
  originalTypes.set(variableName, currentType);

  // Find which union member(s) have a const field with the given value
  const matchingTypes: Type[] = [];
  const nonMatchingTypes: Type[] = [];

  for (const type of unionType.types) {
    if (hasConstFieldWithValue(type, fieldName, literal, validator)) {
      matchingTypes.push(type);
    } else {
      nonMatchingTypes.push(type);
    }
  }

  if (matchingTypes.length === 0) {
    // No types match, narrowing will never be true
    return null;
  }

  // Create narrowed types
  const thenNarrowing = new Map<string, Type>();
  const elseNarrowing = new Map<string, Type>();

  // In the then-branch, narrow to matching types
  if (matchingTypes.length === 1) {
    thenNarrowing.set(variableName, matchingTypes[0]);
  } else {
    const matchingUnion: UnionTypeNode = {
      kind: 'union',
      types: matchingTypes
    };
    thenNarrowing.set(variableName, matchingUnion);
  }

  // In the else-branch, narrow to non-matching types
  if (nonMatchingTypes.length === 1) {
    elseNarrowing.set(variableName, nonMatchingTypes[0]);
  } else if (nonMatchingTypes.length > 1) {
    const nonMatchingUnion: UnionTypeNode = {
      kind: 'union',
      types: nonMatchingTypes
    };
    elseNarrowing.set(variableName, nonMatchingUnion);
  }

  return { thenNarrowing, elseNarrowing, originalTypes };
}

function hasConstFieldWithValue(type: Type, fieldName: string, literal: Literal, validator: Validator): boolean {
  if (type.kind === 'class') {
    const classDecl = validator.context.classes.get((type as ClassTypeNode).name);
    if (classDecl) {
      const field = classDecl.fields.find(f => f.name.name === fieldName && f.isConst);
      if (field && field.defaultValue && field.defaultValue.kind === 'literal') {
        return (field.defaultValue as Literal).value === literal.value;
      }
    }
  }
  return false;
}
