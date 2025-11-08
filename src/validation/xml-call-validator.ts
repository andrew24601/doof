import { XmlCallExpression, XmlAttribute, Identifier, CallExpression, ObjectProperty, Expression, ArrayExpression, Literal, MemberExpression, Type } from "../types";
import { Validator } from "./validator";
import { createUnknownType, typeToString, isTypeCompatible } from "../type-utils";
import { validateCallExpression } from "./call-expression-validator";

// Helper to convert XmlAttributes to ObjectProperty list
function convertAttributes(attrs: XmlAttribute[]): ObjectProperty[] {
  return attrs.map(a => {
    return {
      kind: 'property',
      key: a.name,
      value: a.value,
      shorthand: false,
      location: a.location
    } as ObjectProperty;
  });
}

function getCalleeIdentifierOrMember(expr: Identifier | MemberExpression): Expression {
  return expr as Expression;
}

export function validateXmlCallExpression(xml: XmlCallExpression, validator: Validator): Type {
  // Build synthetic callee expression
  const calleeExpr = getCalleeIdentifierOrMember(xml.callee);

  // Build synthetic CallExpression
  const call: CallExpression = {
    kind: 'call',
    callee: calleeExpr,
    arguments: [],
    namedArguments: convertAttributes(xml.attributes),
    location: xml.location
  };

  // Detect children parameter presence if body exists
  const hasChildrenContent = xml.children && xml.children.length > 0;
  // Note: We no longer pre-validate callee type here to avoid cycles; call validator will report any issues

  // Process children into array expression if applicable
  if (xml.children && xml.children.length > 0) {
    const processed: Expression[] = [];
    for (const child of xml.children) {
      // Nested xmlCall: recursively validate to populate normalizedCall for downstream
      if (child.kind === 'xmlCall') {
        const nestedType = validateXmlCallExpression(child as XmlCallExpression, validator);
        processed.push(child.normalizedCall ?? child); // Use normalized call for downstream
        continue;
      }
      // Literal text already parsed as literal
      if (child.kind === 'literal') {
        processed.push(child);
        continue;
      }
      // Braced expression or other expression - leave as-is; validator will type-check in call
      processed.push(child);
    }
    const arrayExpr: ArrayExpression = {
      kind: 'array',
      elements: processed,
      location: xml.location
    };
    // Add synthetic children named argument
    (call.namedArguments as ObjectProperty[]).push({
      kind: 'property',
      key: { kind: 'identifier', name: 'children', location: xml.location } as Identifier,
      value: arrayExpr,
      shorthand: false,
      location: xml.location
    });
  }

  // Validate synthetic call expression
  const returnType = validateCallExpression(call, validator);
  xml.normalizedCall = call;
  xml.inferredType = returnType;
  return returnType;
}
