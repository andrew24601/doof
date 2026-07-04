import type { CallExpression, Expression, ObjectProperty } from "./ast.js";
import type { FunctionResolvedParam, ResolvedType } from "./checker-types.js";
import { getUnsupportedDefaultExpressionReason } from "./default-expression.js";
import { emitClassCppName, emitEnumVariantAccess, emitNullForType, emitType } from "./emitter-types.js";
import { escapeChar, escapeString, formatDouble, formatFloat, emitIdentifierSafe } from "./emitter-expr-literals.js";
import {
  buildPositionalConstructorArgList,
  buildConstructorFieldInfoList,
  buildFieldTypeList,
  emitClassConstruction,
  emitResolvedClassName,
} from "./emitter-expr-utils.js";
import { emitSymbolReferenceName } from "./emitter-names.js";

function unsupportedDefault(expr: Expression, contextType?: ResolvedType): never {
  const reason = getUnsupportedDefaultExpressionReason(expr, contextType)
    ?? `expression kind "${expr.kind}" is not supported in parameter defaults`;
  throw new Error(`Cannot emit parameter default: ${reason}`);
}

function getStaticClassMethodDefaultCall(expr: CallExpression): {
  classType: Extract<ResolvedType, { kind: "class" | "struct" }>;
  methodName: string;
  params: FunctionResolvedParam[];
} | null {
  if (expr.callee.kind === "dot-shorthand") {
    const callee = expr.callee;
    const ownerType = callee.resolvedShorthandOwnerType;
    if (!ownerType || (ownerType.kind !== "class" && ownerType.kind !== "struct")) return null;
    const method = ownerType.symbol.declaration.methods.find(
      (candidate) => candidate.name === callee.name && candidate.static_,
    );
    const calleeType = callee.resolvedType;
    if (!method || calleeType?.kind !== "function") return null;
    return {
      classType: ownerType,
      methodName: callee.name,
      params: calleeType.params,
    };
  }

  if (expr.callee.kind !== "member-expression") return null;
  const callee = expr.callee;
  if (callee.object.kind !== "identifier") return null;

  const binding = callee.object.resolvedBinding;
  const objectType = callee.object.resolvedType;
  if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return null;
  if (binding?.kind !== "class" && binding?.kind !== "struct" && binding?.kind !== "import") return null;

  const method = objectType.symbol.declaration.methods.find(
    (candidate) => candidate.name === callee.property && candidate.static_,
  );
  const calleeType = callee.resolvedType;
  if (!method || calleeType?.kind !== "function") return null;

  return {
    classType: objectType,
    methodName: callee.property,
    params: calleeType.params,
  };
}

function emitStaticClassMethodDefaultCall(
  expr: CallExpression,
  currentModulePath: string | undefined,
): string | null {
  const staticCall = getStaticClassMethodDefaultCall(expr);
  if (!staticCall) return null;

  const args = expr.args.some((arg) => arg.name)
    ? emitNamedStaticMethodDefaultArgs(staticCall.params, expr, currentModulePath)
    : emitPositionalStaticMethodDefaultArgs(staticCall.params, expr, currentModulePath);
  const className = emitClassCppName(staticCall.classType.symbol, currentModulePath);
  return `${className}::${emitIdentifierSafe(staticCall.methodName)}(${args.join(", ")})`;
}

function emitNamedStaticMethodDefaultArgs(
  params: FunctionResolvedParam[],
  expr: CallExpression,
  currentModulePath: string | undefined,
): string[] {
  const argMap = new Map(expr.args.filter((arg) => arg.name).map((arg) => [arg.name!, arg.value]));
  return params.flatMap((param) => {
    const value = argMap.get(param.name);
    if (value) return [emitDefaultExpression(value, param.type, currentModulePath)];
    if (param.defaultValue) return [emitDefaultExpression(param.defaultValue, param.type, currentModulePath)];
    return [];
  });
}

function emitPositionalStaticMethodDefaultArgs(
  params: FunctionResolvedParam[],
  expr: CallExpression,
  currentModulePath: string | undefined,
): string[] {
  const values = expr.args.map((arg, index) =>
    emitDefaultExpression(arg.value, params[index]?.type, currentModulePath)
  );

  for (let index = expr.args.length; index < params.length; index++) {
    const param = params[index];
    if (!param.defaultValue) break;
    values.push(emitDefaultExpression(param.defaultValue, param.type, currentModulePath));
  }

  return values;
}

export function canEmitDefaultExpressionInHeader(expr: Expression): boolean {
  switch (expr.kind) {
    case "call-expression":
      if (getStaticClassMethodDefaultCall(expr)) return false;
      if (expr.callee.kind === "identifier" && (expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct")) return false;
      return expr.args.every((arg) => canEmitDefaultExpressionInHeader(arg.value));

    case "construct-expression":
      return false;

    case "object-literal":
      return false;

    case "tuple-literal":
      if (expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct") return false;
      return expr.elements.every((element) => canEmitDefaultExpressionInHeader(element));

    case "array-literal":
      return expr.elements.every((element) => canEmitDefaultExpressionInHeader(element));

    case "dot-shorthand":
      return expr.resolvedShorthandOwnerType?.kind !== "class" && expr.resolvedShorthandOwnerType?.kind !== "struct";

    case "map-literal":
      return expr.entries.every((entry) =>
        canEmitDefaultExpressionInHeader(entry.key) && canEmitDefaultExpressionInHeader(entry.value)
      );

    case "unary-expression":
      return canEmitDefaultExpressionInHeader(expr.operand);

    default:
      return true;
  }
}

export function emitDefaultExpression(expr: Expression, contextType?: ResolvedType, currentModulePath?: string): string {
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
      if (expr.resolvedBinding?.kind === "import" && expr.resolvedBinding.symbol) {
        return emitSymbolReferenceName(expr.resolvedBinding.symbol);
      }
      return emitIdentifierSafe(expr.name);

    case "caller-expression":
      return 'std::make_shared<doof::SourceLocation>(std::string("<module>"), 0, std::string("<module>"))';

    case "enum-access":
      if (expr.enumName && expr.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.resolvedType, expr.variant, currentModulePath);
      }
      return expr.enumName ? `${expr.enumName}::${expr.variant}` : expr.variant;

    case "dot-shorthand":
      if (expr.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.resolvedType, expr.name, currentModulePath);
      }
      if (expr.resolvedShorthandOwnerType?.kind === "class" || expr.resolvedShorthandOwnerType?.kind === "struct") {
        return `${emitClassCppName(expr.resolvedShorthandOwnerType.symbol, currentModulePath)}::${emitIdentifierSafe(expr.name)}`;
      }
      return unsupportedDefault(expr, contextType);

    case "member-expression":
      if (expr.resolvedType?.kind === "enum" && expr.object.resolvedType?.kind === "enum") {
        return emitEnumVariantAccess(expr.object.resolvedType, expr.property, currentModulePath);
      }
      return unsupportedDefault(expr, contextType);

    case "array-literal": {
      const collectionType = contextType ?? expr.resolvedType;
      if (!collectionType || (collectionType.kind !== "array" && collectionType.kind !== "set")) {
        return unsupportedDefault(expr, contextType);
      }
      const elementType = emitType(collectionType.elementType, currentModulePath);
      if (expr.elements.length === 0) {
        if (collectionType.kind === "array") {
          return `std::make_shared<std::vector<${elementType}>>()`;
        }
        return `std::make_shared<doof::ordered_set<${elementType}>>()`;
      }
      const elements = expr.elements
        .map((element) => emitDefaultExpression(element, collectionType.elementType, currentModulePath))
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
          .map((element, index) => emitDefaultExpression(element, tupleType.elements[index], currentModulePath))
          .join(", ");
        return `std::make_tuple(${elements})`;
      }

      if (tupleType.kind === "class" || tupleType.kind === "struct") {
        const className = emitResolvedClassName(tupleType, currentModulePath);
        const fieldTypes = buildFieldTypeList(tupleType.symbol);
        const providedArgs = expr.elements
          .map((element, index) => emitDefaultExpression(element, fieldTypes[index], currentModulePath));
        const args = buildPositionalConstructorArgList(
          tupleType.symbol,
          providedArgs,
          (defaultExpr, targetType) => emitDefaultExpression(defaultExpr, targetType, currentModulePath),
        );
        return emitClassConstruction(className, tupleType.symbol, args);
      }

      return unsupportedDefault(expr, contextType);
    }

    case "call-expression": {
      const staticMethodCall = emitStaticClassMethodDefaultCall(expr, currentModulePath);
      if (staticMethodCall) return staticMethodCall;

      const callType = expr.resolvedType ?? contextType;
      if (expr.callee.kind !== "identifier" || !callType || (callType.kind !== "class" && callType.kind !== "struct")) {
        return unsupportedDefault(expr, contextType);
      }
      const className = emitResolvedClassName(callType, currentModulePath);
      const fieldTypes = buildFieldTypeList(callType.symbol);
      const providedArgs = expr.args
        .map((arg, index) => emitDefaultExpression(arg.value, fieldTypes[index], currentModulePath));
      const args = buildPositionalConstructorArgList(
        callType.symbol,
        providedArgs,
        (defaultExpr, targetType) => emitDefaultExpression(defaultExpr, targetType, currentModulePath),
      );
      return emitClassConstruction(className, callType.symbol, args);
    }

    case "construct-expression": {
      const ctorType = expr.resolvedType ?? contextType;
      if (!ctorType || (ctorType.kind !== "class" && ctorType.kind !== "struct")) {
        return unsupportedDefault(expr, contextType);
      }

      const className = emitClassCppName(ctorType.symbol, currentModulePath);
      if (expr.named) {
        const propMap = new Map((expr.args as ObjectProperty[]).map((prop) => [prop.name, prop]));
        const args = buildConstructorFieldInfoList(ctorType.symbol).map((field) => {
          const prop = propMap.get(field.name);
          if (prop) {
            return prop.value ? emitDefaultExpression(prop.value, field.type, currentModulePath) : emitIdentifierSafe(prop.name);
          }
          if (field.defaultValue) {
            return emitDefaultExpression(field.defaultValue, field.type, currentModulePath);
          }
          throw new Error(`Missing constructor field \"${field.name}\" during default construct emission`);
        });
        return emitClassConstruction(className, ctorType.symbol, args);
      }

      const fieldTypes = buildFieldTypeList(ctorType.symbol);
      const providedArgs = expr.args
        .map((arg, index) => emitDefaultExpression(arg as Expression, fieldTypes[index], currentModulePath));
      const args = buildPositionalConstructorArgList(
        ctorType.symbol,
        providedArgs,
        (defaultExpr, targetType) => emitDefaultExpression(defaultExpr, targetType, currentModulePath),
      );
      return emitClassConstruction(className, ctorType.symbol, args);
    }

    case "unary-expression":
      if (expr.operator === "-" || expr.operator === "+") {
        return `${expr.operator}${emitDefaultExpression(expr.operand, contextType, currentModulePath)}`;
      }
      return unsupportedDefault(expr, contextType);

    case "object-literal": {
      const objectType = contextType ?? expr.resolvedType;
      if (objectType?.kind === "class" || objectType?.kind === "struct") {
        const className = emitResolvedClassName(objectType, currentModulePath);
        const propMap = new Map(expr.properties.map((prop) => [prop.name, prop]));
        const args = buildConstructorFieldInfoList(objectType.symbol)
          .map((field) => {
            const prop = propMap.get(field.name);
            if (prop) {
              return prop.value ? emitDefaultExpression(prop.value, field.type, currentModulePath) : emitIdentifierSafe(prop.name);
            }
            if (field.defaultValue) {
              return emitDefaultExpression(field.defaultValue, field.type, currentModulePath);
            }
            throw new Error(`Missing constructor field \"${field.name}\" during object default emission`);
          })
        ;
        return emitClassConstruction(className, objectType.symbol, args);
      }

      if (objectType?.kind === "map" && expr.properties.length === 0) {
        const keyType = emitType(objectType.keyType, currentModulePath);
        const valueType = emitType(objectType.valueType, currentModulePath);
        return `std::make_shared<doof::ordered_map<${keyType}, ${valueType}>>()`;
      }

      return unsupportedDefault(expr, contextType);
    }

    case "map-literal": {
      const mapType = expr.resolvedType ?? contextType;
      if (!mapType || mapType.kind !== "map") {
        return unsupportedDefault(expr, contextType);
      }
      const keyType = emitType(mapType.keyType, currentModulePath);
      const valueType = emitType(mapType.valueType, currentModulePath);
      const entries = expr.entries
        .map((entry) => `{
${emitDefaultExpression(entry.key, mapType.keyType, currentModulePath)}, ${emitDefaultExpression(entry.value, mapType.valueType, currentModulePath)}}`)
        .join(", ");
      return `std::make_shared<doof::ordered_map<${keyType}, ${valueType}>>(doof::ordered_map<${keyType}, ${valueType}>{${entries}})`;
    }

    default:
      return unsupportedDefault(expr, contextType);
  }
}
