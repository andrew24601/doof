import type { Expression, ObjectProperty } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { getUnsupportedDefaultExpressionReason } from "./default-expression.js";
import { emitClassCppName, emitEnumVariantAccess, emitNullForType, emitType } from "./emitter-types.js";
import { escapeChar, escapeString, formatDouble, formatFloat, emitIdentifierSafe } from "./emitter-expr-literals.js";
import {
  buildPositionalConstructorArgList,
  buildConstructorFieldInfoList,
  buildFieldTypeList,
  buildFieldTypeMap,
  emitClassConstruction,
  emitResolvedClassName,
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

    case "caller-expression":
      return 'std::make_shared<doof::SourceLocation>(std::string("<module>"), 0, std::string("<module>"))';

    case "enum-access":
      if (expr.enumName && expr.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.resolvedType, expr.variant);
      }
      return expr.enumName ? `${expr.enumName}::${expr.variant}` : expr.variant;

    case "dot-shorthand":
      if (expr.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.resolvedType, expr.name);
      }
      return unsupportedDefault(expr, contextType);

    case "member-expression":
      if (expr.resolvedType?.kind === "enum" && expr.object.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.object.resolvedType, expr.property);
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
        return `std::make_shared<doof::ordered_set<${elementType}>>()`;
      }
      const elements = expr.elements
        .map((element) => emitDefaultExpression(element, collectionType.elementType))
        .join(", ");
      if (collectionType.kind === "array") {
        return `std::make_shared<std::vector<${elementType}>>(std::vector<${elementType}>{${elements}})`;
      }
      return `std::make_shared<doof::ordered_set<${elementType}>>(doof::ordered_set<${elementType}>{${elements}})`;
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
        const className = emitResolvedClassName(tupleType);
        const fieldTypes = buildFieldTypeList(tupleType.symbol);
        const providedArgs = expr.elements
          .map((element, index) => emitDefaultExpression(element, fieldTypes[index]));
        const args = buildPositionalConstructorArgList(tupleType.symbol, providedArgs, emitDefaultExpression);
        return emitClassConstruction(className, tupleType.symbol, args);
      }

      return unsupportedDefault(expr, contextType);
    }

    case "call-expression": {
      const callType = expr.resolvedType ?? contextType;
      if (expr.callee.kind !== "identifier" || !callType || callType.kind !== "class") {
        return unsupportedDefault(expr, contextType);
      }
      const className = emitResolvedClassName(callType);
      const fieldTypes = buildFieldTypeList(callType.symbol);
      const providedArgs = expr.args
        .map((arg, index) => emitDefaultExpression(arg.value, fieldTypes[index]));
      const args = buildPositionalConstructorArgList(callType.symbol, providedArgs, emitDefaultExpression);
      return emitClassConstruction(className, callType.symbol, args);
    }

    case "construct-expression": {
      const ctorType = expr.resolvedType ?? contextType;
      if (!ctorType || ctorType.kind !== "class") {
        return unsupportedDefault(expr, contextType);
      }

      const className = emitClassCppName(ctorType.symbol);
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
        return emitClassConstruction(className, ctorType.symbol, args);
      }

      const fieldTypes = buildFieldTypeList(ctorType.symbol);
      const providedArgs = expr.args
        .map((arg, index) => emitDefaultExpression(arg as Expression, fieldTypes[index]));
      const args = buildPositionalConstructorArgList(ctorType.symbol, providedArgs, emitDefaultExpression);
      return emitClassConstruction(className, ctorType.symbol, args);
    }

    case "unary-expression":
      if (expr.operator === "-" || expr.operator === "+") {
        return `${expr.operator}${emitDefaultExpression(expr.operand, contextType)}`;
      }
      return unsupportedDefault(expr, contextType);

    case "object-literal": {
      const objectType = contextType ?? expr.resolvedType;
      if (objectType?.kind === "class") {
        const className = emitResolvedClassName(objectType);
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
        ;
        return emitClassConstruction(className, objectType.symbol, args);
      }

      if (objectType?.kind === "map" && expr.properties.length === 0) {
        const keyType = emitType(objectType.keyType);
        const valueType = emitType(objectType.valueType);
        return `std::make_shared<doof::ordered_map<${keyType}, ${valueType}>>()`;
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
      return `std::make_shared<doof::ordered_map<${keyType}, ${valueType}>>(doof::ordered_map<${keyType}, ${valueType}>{${entries}})`;
    }

    default:
      return unsupportedDefault(expr, contextType);
  }
}
