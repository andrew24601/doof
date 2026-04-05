import type { Expression, ObjectProperty } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { getUnsupportedDefaultExpressionReason } from "./default-expression.js";
import { emitType } from "./emitter-types.js";
import { escapeChar, escapeString, formatDouble, formatFloat, emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitNullForType } from "./emitter-types.js";
import {
  buildConstructorFieldInfoList,
  buildFieldTypeList,
  buildFieldTypeMap,
  sortNamedArgsByFieldOrder,
} from "./emitter-expr-utils.js";

function unsupportedDefault(expr: Expression, contextType?: ResolvedType): never {
  const reason = getUnsupportedDefaultExpressionReason(expr, contextType)
    ?? `expression kind "${expr.kind}" is not supported in parameter defaults`;
  throw new Error(`Cannot emit parameter default: ${reason}`);
}

export function emitDefaultExpression(expr: Expression, contextType?: ResolvedType): string {
  const issue = getUnsupportedDefaultExpressionReason(expr, contextType);
  if (issue) {
    unsupportedDefault(expr, contextType);
  }

  switch (expr.kind) {
    case "int-literal":
      return String(expr.value);

    case "long-literal":
      return `${expr.value}LL`;

    case "float-literal":
      return formatFloat(expr.value);

    case "double-literal":
      return formatDouble(expr.value);

    case "string-literal":
      return `"${escapeString(expr.value)}"`;

    case "char-literal":
      return `U'${escapeChar(expr.value)}'`;

    case "bool-literal":
      return expr.value ? "true" : "false";

    case "null-literal":
      return contextType ? emitNullForType(contextType) : "nullptr";

    case "identifier":
      return emitIdentifierSafe(expr.name);

    case "enum-access":
      return expr.enumName ? `${expr.enumName}::${expr.variant}` : expr.variant;

    case "dot-shorthand":
      if (expr.resolvedType?.kind === "enum") {
        return `${expr.resolvedType.symbol.name}::${expr.name}`;
      }
      return unsupportedDefault(expr, contextType);

    case "member-expression":
      if (expr.resolvedType?.kind === "enum" && expr.object.resolvedType?.kind === "enum") {
        return `${expr.object.resolvedType.symbol.name}::${expr.property}`;
      }
      return unsupportedDefault(expr, contextType);

    case "array-literal": {
      const collectionType = contextType ?? expr.resolvedType;
      if (!collectionType || (collectionType.kind !== "array" && collectionType.kind !== "set")) {
        return unsupportedDefault(expr, contextType);
      }
      const elementType = emitType(collectionType.elementType);
      if (expr.elements.length === 0) {
        if (collectionType.kind === "array") {
          return `std::make_shared<std::vector<${elementType}>>()`;
        }
        return `std::make_shared<std::unordered_set<${elementType}>>()`;
      }
      const elements = expr.elements
        .map((element) => emitDefaultExpression(element, collectionType.elementType))
        .join(", ");
      if (collectionType.kind === "array") {
        return `std::make_shared<std::vector<${elementType}>>(std::vector<${elementType}>{${elements}})`;
      }
      return `std::make_shared<std::unordered_set<${elementType}>>(std::unordered_set<${elementType}>{${elements}})`;
    }

    case "tuple-literal": {
      const tupleType = contextType ?? expr.resolvedType;
      if (!tupleType) {
        return unsupportedDefault(expr, contextType);
      }

      if (tupleType.kind === "tuple") {
        const elements = expr.elements
          .map((element, index) => emitDefaultExpression(element, tupleType.elements[index]))
          .join(", ");
        return `std::make_tuple(${elements})`;
      }

      if (tupleType.kind === "class") {
        const className = tupleType.symbol.extern_?.cppName ?? tupleType.symbol.name;
        const fieldTypes = buildFieldTypeList(tupleType.symbol);
        const args = expr.elements
          .map((element, index) => emitDefaultExpression(element, fieldTypes[index]))
          .join(", ");
        return `std::make_shared<${className}>(${args})`;
      }

      return unsupportedDefault(expr, contextType);
    }

    case "call-expression": {
      const callType = expr.resolvedType ?? contextType;
      if (expr.callee.kind !== "identifier" || !callType || callType.kind !== "class") {
        return unsupportedDefault(expr, contextType);
      }
      const className = callType.symbol.extern_?.cppName ?? callType.symbol.name;
      const fieldTypes = buildFieldTypeList(callType.symbol);
      const args = expr.args
        .map((arg, index) => emitDefaultExpression(arg.value, fieldTypes[index]))
        .join(", ");
      return `std::make_shared<${className}>(${args})`;
    }

    case "construct-expression": {
      const ctorType = expr.resolvedType ?? contextType;
      if (!ctorType || ctorType.kind !== "class") {
        return unsupportedDefault(expr, contextType);
      }

      const className = ctorType.symbol.extern_?.cppName ?? ctorType.symbol.name;
      if (expr.named) {
        const propMap = new Map((expr.args as ObjectProperty[]).map((prop) => [prop.name, prop]));
        const args = buildConstructorFieldInfoList(ctorType.symbol).map((field) => {
          const prop = propMap.get(field.name);
          if (prop) {
            return prop.value ? emitDefaultExpression(prop.value, field.type) : emitIdentifierSafe(prop.name);
          }
          if (field.defaultValue) {
            return emitDefaultExpression(field.defaultValue, field.type);
          }
          throw new Error(`Missing constructor field \"${field.name}\" during default construct emission`);
        });
        return `std::make_shared<${className}>(${args.join(", ")})`;
      }

      const fieldTypes = buildFieldTypeList(ctorType.symbol);
      const args = expr.args
        .map((arg, index) => emitDefaultExpression(arg as Expression, fieldTypes[index]))
        .join(", ");
      return args.length > 0
        ? `std::make_shared<${className}>(${args})`
        : `std::make_shared<${className}>()`;
    }

    case "unary-expression":
      if (expr.operator === "-" || expr.operator === "+") {
        return `${expr.operator}${emitDefaultExpression(expr.operand, contextType)}`;
      }
      return unsupportedDefault(expr, contextType);

    case "object-literal": {
      const objectType = contextType ?? expr.resolvedType;
      if (objectType?.kind === "class") {
        const className = objectType.symbol.extern_?.cppName ?? objectType.symbol.name;
        const propMap = new Map(expr.properties.map((prop) => [prop.name, prop]));
        const args = buildConstructorFieldInfoList(objectType.symbol)
          .map((field) => {
            const prop = propMap.get(field.name);
            if (prop) {
              return prop.value ? emitDefaultExpression(prop.value, field.type) : emitIdentifierSafe(prop.name);
            }
            if (field.defaultValue) {
              return emitDefaultExpression(field.defaultValue, field.type);
            }
            throw new Error(`Missing constructor field \"${field.name}\" during object default emission`);
          })
          .join(", ");
        return `std::make_shared<${className}>(${args})`;
      }

      if (objectType?.kind === "map" && expr.properties.length === 0) {
        const keyType = emitType(objectType.keyType);
        const valueType = emitType(objectType.valueType);
        return `std::make_shared<std::unordered_map<${keyType}, ${valueType}>>()`;
      }

      return unsupportedDefault(expr, contextType);
    }

    case "map-literal": {
      const mapType = expr.resolvedType ?? contextType;
      if (!mapType || mapType.kind !== "map") {
        return unsupportedDefault(expr, contextType);
      }
      const keyType = emitType(mapType.keyType);
      const valueType = emitType(mapType.valueType);
      const entries = expr.entries
        .map((entry) => `{
${emitDefaultExpression(entry.key, mapType.keyType)}, ${emitDefaultExpression(entry.value, mapType.valueType)}}`)
        .join(", ");
      return `std::make_shared<std::unordered_map<${keyType}, ${valueType}>>(std::unordered_map<${keyType}, ${valueType}>{${entries}})`;
    }

    default:
      return unsupportedDefault(expr, contextType);
  }
}