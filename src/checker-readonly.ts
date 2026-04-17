import type { InterfaceField } from "./ast.js";
import type { CheckerHost } from "./checker-internal.js";
import {
  substituteTypeParams,
  typeToString,
  UNKNOWN_TYPE,
  type ClassType,
  type InterfaceType,
  type ResolvedType,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

export interface DeepReadonlyViolation {
  reason: string;
  offendingType: ResolvedType;
}

export function applyDeepReadonly(type: ResolvedType): ResolvedType {
  switch (type.kind) {
    case "array":
      return {
        kind: "array",
        elementType: applyDeepReadonly(type.elementType),
        readonly_: true,
      };
    case "map":
      return {
        kind: "map",
        keyType: applyDeepReadonly(type.keyType),
        valueType: applyDeepReadonly(type.valueType),
        readonly_: true,
      };
    case "set":
      return {
        kind: "set",
        elementType: applyDeepReadonly(type.elementType),
        readonly_: true,
      };
    case "union":
      return {
        kind: "union",
        types: type.types.map(applyDeepReadonly),
      };
    case "tuple":
      return {
        kind: "tuple",
        elements: type.elements.map(applyDeepReadonly),
      };
    case "weak":
      return { kind: "weak", inner: applyDeepReadonly(type.inner) };
    case "class":
      if (type.typeArgs && type.typeArgs.length > 0) {
        return {
          kind: "class",
          symbol: type.symbol,
          typeArgs: type.typeArgs.map(applyDeepReadonly),
        };
      }
      return type;
    case "interface":
      if (type.typeArgs && type.typeArgs.length > 0) {
        return {
          kind: "interface",
          symbol: type.symbol,
          typeArgs: type.typeArgs.map(applyDeepReadonly),
        };
      }
      return type;
    case "result":
      return {
        kind: "result",
        successType: applyDeepReadonly(type.successType),
        errorType: applyDeepReadonly(type.errorType),
      };
    case "promise":
      return { kind: "promise", valueType: applyDeepReadonly(type.valueType) };
    case "actor":
      return { kind: "actor", innerClass: applyDeepReadonly(type.innerClass) as ClassType };
    case "success-wrapper":
      return { kind: "success-wrapper", valueType: applyDeepReadonly(type.valueType) };
    case "failure-wrapper":
      return { kind: "failure-wrapper", errorType: applyDeepReadonly(type.errorType) };
    case "class-metadata":
      return { kind: "class-metadata", classType: applyDeepReadonly(type.classType) as ClassType };
    case "method-reflection":
      return { kind: "method-reflection", classType: applyDeepReadonly(type.classType) as ClassType };
    default:
      return type;
  }
}

export function findDeepReadonlyViolation(
  host: CheckerHost,
  type: ResolvedType,
  table: ModuleSymbolTable,
  seen = new Set<string>(),
): DeepReadonlyViolation | null {
  switch (type.kind) {
    case "array": {
      if (!type.readonly_) {
        return {
          reason: `array type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.elementType, table, seen);
    }

    case "map": {
      if (!type.readonly_) {
        return {
          reason: `map type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.valueType, table, seen)
        ?? findDeepReadonlyViolation(host, type.keyType, table, seen);
    }

    case "set": {
      if (!type.readonly_) {
        return {
          reason: `set type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.elementType, table, seen);
    }

    case "tuple":
      for (const element of type.elements) {
        const violation = findDeepReadonlyViolation(host, element, table, seen);
        if (violation) return violation;
      }
      return null;

    case "union":
      for (const member of type.types) {
        const violation = findDeepReadonlyViolation(host, member, table, seen);
        if (violation) return violation;
      }
      return null;

    case "weak":
      return findDeepReadonlyViolation(host, type.inner, table, seen);

    case "class":
      return findClassReadonlyViolation(host, type, table, seen);

    case "interface":
      return findInterfaceReadonlyViolation(host, type, table, seen);

    case "result":
      return findDeepReadonlyViolation(host, type.successType, table, seen)
        ?? findDeepReadonlyViolation(host, type.errorType, table, seen);

    case "promise":
      return findDeepReadonlyViolation(host, type.valueType, table, seen);

    case "actor":
      return findDeepReadonlyViolation(host, type.innerClass, table, seen);

    case "success-wrapper":
      return findDeepReadonlyViolation(host, type.valueType, table, seen);

    case "failure-wrapper":
      return findDeepReadonlyViolation(host, type.errorType, table, seen);

    case "class-metadata":
    case "method-reflection":
      return findDeepReadonlyViolation(host, type.classType, table, seen);

    default:
      return null;
  }
}

function findClassReadonlyViolation(
  host: CheckerHost,
  type: ClassType,
  table: ModuleSymbolTable,
  seen: Set<string>,
): DeepReadonlyViolation | null {
  const key = `class:${type.symbol.module}:${type.symbol.name}<${(type.typeArgs ?? []).map(typeToString).join(",")}>`;
  if (seen.has(key)) return null;
  seen.add(key);

  const classDecl = type.symbol.declaration;
  const paramMap = new Map<string, ResolvedType>();
  for (let i = 0; i < classDecl.typeParams.length; i++) {
    const arg = type.typeArgs?.[i];
    if (arg) paramMap.set(classDecl.typeParams[i], arg);
  }

  for (const field of classDecl.fields) {
    const fieldName = field.names[0] ?? "<field>";
    if (!field.readonly_ && !field.const_) {
      return {
        reason: `field "${fieldName}" is mutable`,
        offendingType: type,
      };
    }

    let fieldType = field.resolvedType ?? (field.type ? host.resolveTypeAnnotation(field.type, table) : UNKNOWN_TYPE);
    if (paramMap.size > 0) {
      fieldType = substituteTypeParams(fieldType, paramMap);
    }
    fieldType = applyDeepReadonly(fieldType);

    const violation = findDeepReadonlyViolation(host, fieldType, table, seen);
    if (violation) {
      return {
        reason: `field "${fieldName}" is not deeply immutable: ${violation.reason}`,
        offendingType: violation.offendingType,
      };
    }
  }

  return null;
}

function findInterfaceReadonlyViolation(
  host: CheckerHost,
  type: InterfaceType,
  table: ModuleSymbolTable,
  seen: Set<string>,
): DeepReadonlyViolation | null {
  const key = `interface:${type.symbol.module}:${type.symbol.name}<${(type.typeArgs ?? []).map(typeToString).join(",")}>`;
  if (seen.has(key)) return null;
  seen.add(key);

  const ifaceDecl = type.symbol.declaration;
  const paramMap = new Map<string, ResolvedType>();
  for (let i = 0; i < ifaceDecl.typeParams.length; i++) {
    const arg = type.typeArgs?.[i];
    if (arg) paramMap.set(ifaceDecl.typeParams[i], arg);
  }

  for (const field of ifaceDecl.fields) {
    const violation = findInterfaceFieldReadonlyViolation(host, field, paramMap, table, seen);
    if (violation) return violation;
  }

  return null;
}

function findInterfaceFieldReadonlyViolation(
  host: CheckerHost,
  field: InterfaceField,
  paramMap: Map<string, ResolvedType>,
  table: ModuleSymbolTable,
  seen: Set<string>,
): DeepReadonlyViolation | null {
  if (!field.readonly_) {
    return {
      reason: `field "${field.name}" is mutable`,
      offendingType: UNKNOWN_TYPE,
    };
  }

  let fieldType = field.resolvedType ?? host.resolveTypeAnnotation(field.type, table);
  if (paramMap.size > 0) {
    fieldType = substituteTypeParams(fieldType, paramMap);
  }
  fieldType = applyDeepReadonly(fieldType);

  const violation = findDeepReadonlyViolation(host, fieldType, table, seen);
  if (!violation) return null;

  return {
    reason: `field "${field.name}" is not deeply immutable: ${violation.reason}`,
    offendingType: violation.offendingType,
  };
}