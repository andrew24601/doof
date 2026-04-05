import type { Expression, Identifier, ObjectProperty, StringLiteral } from "./ast.js";
import {
  findUnsupportedHashCollectionConstraint,
  formatUnsupportedHashCollectionConstraintMessage,
  type Binding,
  type ResolvedType,
} from "./checker-types.js";
import {
  buildFieldTypeList,
  buildFieldTypeMap,
  sortNamedArgsByFieldOrder,
} from "./emitter-expr-utils.js";

function hasInterpolation(expr: StringLiteral): boolean {
  return expr.parts.some((part) => typeof part !== "string");
}

function isAllowedIdentifierBinding(binding: Binding | undefined): boolean {
  if (!binding) return false;

  if (binding.kind === "parameter" || binding.kind === "field") {
    return false;
  }

  if (
    binding.kind === "function"
    || binding.kind === "class"
    || binding.kind === "interface"
    || binding.kind === "type-alias"
    || binding.kind === "builtin"
    || binding.kind === "namespace-import"
  ) {
    return false;
  }

  return binding.type.kind !== "function"
    && binding.type.kind !== "namespace"
    && binding.type.kind !== "builtin-namespace"
    && binding.type.kind !== "success-wrapper"
    && binding.type.kind !== "failure-wrapper"
    && binding.type.kind !== "class-metadata"
    && binding.type.kind !== "method-reflection";
}

function identifierIssue(expr: Identifier): string | null {
  if (isAllowedIdentifierBinding(expr.resolvedBinding)) {
    return null;
  }

  if (!expr.resolvedBinding) {
    return `identifier "${expr.name}" is unresolved`;
  }

  return `identifier "${expr.name}" resolves to a ${expr.resolvedBinding.kind} binding, which is not supported in parameter defaults`;
}

function shorthandPropertyIssue(prop: ObjectProperty): string | null {
  if (prop.value) return null;
  return `shorthand property "${prop.name}" is not supported in parameter defaults`;
}

export function getUnsupportedDefaultExpressionReason(
  expr: Expression,
  contextType?: ResolvedType,
): string | null {
  switch (expr.kind) {
    case "int-literal":
    case "long-literal":
    case "float-literal":
    case "double-literal":
    case "char-literal":
    case "bool-literal":
    case "null-literal":
    case "enum-access":
      return null;

    case "string-literal":
      return hasInterpolation(expr)
        ? "interpolated strings are not supported in parameter defaults"
        : null;

    case "identifier":
      return identifierIssue(expr);

    case "dot-shorthand":
      return expr.resolvedType?.kind === "enum"
        ? null
        : `dot shorthand ".${expr.name}" is unresolved`;

    case "member-expression":
      return expr.resolvedType?.kind === "enum"
        ? null
        : `expression kind "${expr.kind}" is not supported in parameter defaults`;

    case "array-literal": {
      const collectionType = contextType ?? expr.resolvedType;
      if (!collectionType || (collectionType.kind !== "array" && collectionType.kind !== "set")) {
        return "array defaults require an array or set parameter type";
      }
      if (collectionType.kind === "set") {
        const issue = findUnsupportedHashCollectionConstraint(collectionType);
        if (issue) {
          return formatUnsupportedHashCollectionConstraintMessage(issue);
        }
      }
      for (const element of expr.elements) {
        const issue = getUnsupportedDefaultExpressionReason(element, collectionType.elementType);
        if (issue) return issue;
      }
      return null;
    }

    case "tuple-literal": {
      const tupleType = contextType ?? expr.resolvedType;
      if (!tupleType) {
        return "tuple defaults require a resolved parameter type";
      }

      if (tupleType.kind === "tuple") {
        for (let i = 0; i < expr.elements.length; i++) {
          const issue = getUnsupportedDefaultExpressionReason(expr.elements[i], tupleType.elements[i]);
          if (issue) return issue;
        }
        return null;
      }

      if (tupleType.kind === "class") {
        const fieldTypes = buildFieldTypeList(tupleType.symbol);
        for (let i = 0; i < expr.elements.length; i++) {
          const issue = getUnsupportedDefaultExpressionReason(expr.elements[i], fieldTypes[i]);
          if (issue) return issue;
        }
        return null;
      }

      return "tuple defaults require a tuple or class parameter type";
    }

    case "call-expression": {
      const callType = expr.resolvedType ?? contextType;
      if (expr.callee.kind !== "identifier" || !callType || callType.kind !== "class") {
        return "only class constructor calls are supported in parameter defaults";
      }

      const fieldTypes = buildFieldTypeList(callType.symbol);
      for (let i = 0; i < expr.args.length; i++) {
        if (expr.args[i].name) {
          return "named call arguments are not supported in parameter defaults";
        }
        const issue = getUnsupportedDefaultExpressionReason(expr.args[i].value, fieldTypes[i]);
        if (issue) return issue;
      }
      return null;
    }

    case "construct-expression": {
      const ctorType = expr.resolvedType ?? contextType;
      if (!ctorType || ctorType.kind !== "class") {
        return `constructed default "${expr.type}" requires a class parameter type`;
      }

      if (expr.named) {
        const props = sortNamedArgsByFieldOrder(expr.args as ObjectProperty[], ctorType.symbol);
        const fieldTypeMap = buildFieldTypeMap(ctorType.symbol);
        for (const prop of props) {
          const shorthandIssue = shorthandPropertyIssue(prop);
          if (shorthandIssue) return shorthandIssue;
          const issue = getUnsupportedDefaultExpressionReason(prop.value!, fieldTypeMap.get(prop.name));
          if (issue) return issue;
        }
        return null;
      }

      const fieldTypes = buildFieldTypeList(ctorType.symbol);
      for (let i = 0; i < expr.args.length; i++) {
        const issue = getUnsupportedDefaultExpressionReason(expr.args[i] as Expression, fieldTypes[i]);
        if (issue) return issue;
      }
      return null;
    }

    case "unary-expression":
      if (expr.operator !== "-" && expr.operator !== "+") {
        return `unary operator "${expr.operator}" is not supported in parameter defaults`;
      }
      return getUnsupportedDefaultExpressionReason(expr.operand, contextType);

    case "object-literal": {
      if (expr.spread) {
        return "object spread is not supported in parameter defaults";
      }

      const objectType = contextType ?? expr.resolvedType;
      if (objectType?.kind === "class") {
        const props = sortNamedArgsByFieldOrder(expr.properties, objectType.symbol);
        const fieldTypeMap = buildFieldTypeMap(objectType.symbol);
        for (const prop of props) {
          const shorthandIssue = shorthandPropertyIssue(prop);
          if (shorthandIssue) return shorthandIssue;
          const issue = getUnsupportedDefaultExpressionReason(prop.value!, fieldTypeMap.get(prop.name));
          if (issue) return issue;
        }
        return null;
      }

      if (objectType?.kind === "map" && expr.properties.length === 0) {
        const issue = findUnsupportedHashCollectionConstraint(objectType);
        if (issue) {
          return formatUnsupportedHashCollectionConstraintMessage(issue);
        }
        return null;
      }

      return "object defaults require a class parameter type or an empty map default";
    }

    case "map-literal": {
      const mapType = contextType ?? expr.resolvedType;
      if (!mapType || mapType.kind !== "map") {
        return "map defaults require a map parameter type";
      }
      const issue = findUnsupportedHashCollectionConstraint(mapType);
      if (issue) {
        return formatUnsupportedHashCollectionConstraintMessage(issue);
      }
      for (const entry of expr.entries) {
        const keyIssue = getUnsupportedDefaultExpressionReason(entry.key, mapType.keyType);
        if (keyIssue) return keyIssue;
        const valueIssue = getUnsupportedDefaultExpressionReason(entry.value, mapType.valueType);
        if (valueIssue) return valueIssue;
      }
      return null;
    }

    default:
      return `expression kind "${expr.kind}" is not supported in parameter defaults`;
  }
}