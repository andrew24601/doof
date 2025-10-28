import { validateExpression } from "./expression-validator";
import { canInferObjectLiteralType, inferObjectLiteralType } from "./object-literal-validator";
import { isTypeCompatible, commonTypes, validateSetElementType } from "../type-utils";
import { Type, ArrayExpression, SetExpression, ObjectExpression, ArrayTypeNode, SetTypeNode, PrimitiveTypeNode, EnumTypeNode, MemberExpression, Expression, EnumShorthandMemberExpression } from "../types";
import { Validator } from "./validator";

function expandEnumShorthand(shorthand: EnumShorthandMemberExpression, enumType: EnumTypeNode): MemberExpression {
  return {
    kind: 'member',
    object: { kind: 'identifier', name: enumType.name, location: shorthand.location },
    property: { kind: 'identifier', name: shorthand.memberName, location: shorthand.location },
    computed: false,
    location: shorthand.location
  } as MemberExpression;
}

export function validateArrayExpression(expr: ArrayExpression, validator: Validator): Type {
  // Check if we have an expected element type to propagate
  const expectedElementType = expr._expectedElementType;

  if (expr.elements.length === 0 && !expectedElementType) {
    validator.addError(`Cannot infer type of empty array`, expr.location);
    expr.inferredType = { kind: 'array', elementType: commonTypes.void } as ArrayTypeNode;
    return expr.inferredType;
  }

  // If we have an expected element type, propagate it to object literals
  if (expectedElementType) {
    for (const element of expr.elements) {
      if (element.kind === 'object') {
        const objExpr = element as ObjectExpression;
        if (!objExpr.className && canInferObjectLiteralType(objExpr, expectedElementType)) {
          inferObjectLiteralType(objExpr, expectedElementType, validator);
        }
      }
    }
  }

  // If we have an expected enum element type, allow enum shorthand members in the array
  if (expectedElementType && expectedElementType.kind === 'enum') {
    for (let i = 0; i < expr.elements.length; i++) {
      const el = expr.elements[i];
      if (el.kind === 'enumShorthand') {
        expr.elements[i] = expandEnumShorthand(el as EnumShorthandMemberExpression, expectedElementType as EnumTypeNode);
      }
    }
  }

  const elementTypes = expr.elements.map(e => validateExpression(e, validator));
  const firstType = expectedElementType ?? elementTypes[0];

  // Check that all elements have the same type
  for (let i = 1; i < elementTypes.length; i++) {
    if (!isTypeCompatible(elementTypes[i], firstType, validator)) {
      validator.addError(`Array elements must have the same type`, expr.elements[i].location);
    }
  }

  expr.inferredType = { kind: 'array', elementType: firstType } as ArrayTypeNode;

  return expr.inferredType;
}

export function validateSetExpression(expr: SetExpression, validator: Validator): Type {
  if (expr.elements.length === 0) {
    validator.addError(`Cannot infer type of empty set literal`, expr.location);
    expr.inferredType = { kind: 'set', elementType: commonTypes.void } as SetTypeNode;
    return expr.inferredType;
  }

  // If the parent variable declaration has an explicit enum type, propagate it
  let expectedEnumType: EnumTypeNode | undefined;
  if (expr._expectedEnumType) {
    expectedEnumType = (expr as any)._expectedEnumType;
  }

  const elementTypes = expr.elements.map((e, index) => {
    if (e.kind === 'enumShorthand') {
      if (!expectedEnumType) {
        validator.addError(`Enum shorthand '.${e.memberName}' requires explicit enum type context`, e.location);
        return { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
      }
      expr.elements[index] = expandEnumShorthand(e, expectedEnumType); // Replace shorthand with full expression
      return validateExpression(expr.elements[index], validator);
    } else {
      return validateExpression(e, validator);
    }
  });
  let firstType: Type;
  firstType = elementTypes[0];

  // Validate that the element type is valid for sets
  validateSetElementType(firstType, expr.location, validator);

  // Check that all elements have the same type
  for (let i = 1; i < elementTypes.length; i++) {
    const t = elementTypes[i];
    if (!isTypeCompatible(t, firstType, validator)) {
      validator.addError(`Set elements must have the same type`, expr.elements[i].location);
    }
  }

  expr.inferredType = { kind: 'set', elementType: firstType } as SetTypeNode;

  return expr.inferredType;
}
