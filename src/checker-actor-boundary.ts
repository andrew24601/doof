import type { InterfaceField } from "./ast.js";
import type { CheckerHost } from "./checker-internal.js";
import { applyDeepReadonly } from "./checker-readonly.js";
import {
  substituteTypeParams,
  type ClassType,
  type InterfaceType,
  type ResolvedType,
  type StructType,
  typeToString,
  UNKNOWN_TYPE,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

export interface ActorBoundaryViolation {
  reason: string;
  offendingType: ResolvedType;
}

export function findActorBoundaryViolation(
  host: CheckerHost,
  type: ResolvedType,
  table: ModuleSymbolTable,
  seen = new Set<string>(),
  visited = new Set<ResolvedType>(),
): ActorBoundaryViolation | null {
  if (visited.has(type)) return null;
  visited.add(type);

  switch (type.kind) {
    case "primitive":
    case "null":
    case "void":
    case "enum":
    case "unknown":
    case "typevar":
    case "json-serializable-constraint":
      return null;

    case "actor":
      return {
        reason: "Actor<T> references cannot cross actor boundaries",
        offendingType: type,
      };

    case "promise":
      return {
        reason: "Promise<T> values cannot cross actor boundaries",
        offendingType: type,
      };

    case "array":
      if (!type.readonly_) {
        return {
          reason: `array type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findActorBoundaryViolation(host, type.elementType, table, seen, visited);

    case "map":
      if (!type.readonly_) {
        return {
          reason: `map type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findActorBoundaryViolation(host, type.keyType, table, seen, visited)
        ?? findActorBoundaryViolation(host, type.valueType, table, seen, visited);

    case "set":
      if (!type.readonly_) {
        return {
          reason: `set type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findActorBoundaryViolation(host, type.elementType, table, seen, visited);

    case "tuple":
      for (const element of type.elements) {
        const violation = findActorBoundaryViolation(host, element, table, seen, visited);
        if (violation) return violation;
      }
      return null;

    case "union":
      for (const member of type.types) {
        const violation = findActorBoundaryViolation(host, member, table, seen, visited);
        if (violation) return violation;
      }
      return null;

    case "class":
    case "struct":
      return findClassBoundaryViolation(host, type, table, seen, visited);

    case "interface":
      return findInterfaceBoundaryViolation(host, type, table, seen, visited);

    case "result":
      return findActorBoundaryViolation(host, type.successType, table, seen, visited)
        ?? findActorBoundaryViolation(host, type.errorType, table, seen, visited);

    case "weak":
      return findActorBoundaryViolation(host, type.inner, table, seen, visited);

    case "success-wrapper":
      return findActorBoundaryViolation(host, type.valueType, table, seen, visited);

    case "failure-wrapper":
      return findActorBoundaryViolation(host, type.errorType, table, seen, visited);

    case "class-metadata":
    case "method-reflection":
      return findActorBoundaryViolation(host, type.classType, table, seen, visited);

    case "function":
      for (const param of type.params) {
        const violation = findActorBoundaryViolation(host, param.type, table, seen, visited);
        if (violation) {
          return {
            reason: `callback parameter "${param.name}" cannot cross actor boundaries: ${violation.reason}`,
            offendingType: violation.offendingType,
          };
        }
      }
      return findActorBoundaryViolation(host, type.returnType, table, seen, visited);

    case "stream":
      return {
        reason: `stream type "${typeToString(type)}" is mutable`,
        offendingType: type,
      };

    case "range":
      return null;

    case "mock-capture":
    case "builtin-namespace":
    case "namespace":
      return {
        reason: `type "${typeToString(type)}" cannot cross actor boundaries`,
        offendingType: type,
      };
  }
}

function findClassBoundaryViolation(
  host: CheckerHost,
  type: ClassType | StructType,
  table: ModuleSymbolTable,
  seen: Set<string>,
  visited: Set<ResolvedType>,
): ActorBoundaryViolation | null {
  const key = `${type.kind}:${type.symbol.module}:${type.symbol.name}<${(type.typeArgs ?? []).map(typeToString).join(",")}>`;
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

    const violation = findActorBoundaryViolation(host, fieldType, table, seen, visited);
    if (violation) {
      return {
        reason: `field "${fieldName}" cannot cross actor boundaries: ${violation.reason}`,
        offendingType: violation.offendingType,
      };
    }
  }

  return null;
}

function findInterfaceBoundaryViolation(
  host: CheckerHost,
  type: InterfaceType,
  table: ModuleSymbolTable,
  seen: Set<string>,
  visited: Set<ResolvedType>,
): ActorBoundaryViolation | null {
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
    const violation = findInterfaceFieldBoundaryViolation(host, field, paramMap, table, seen, visited);
    if (violation) return violation;
  }

  return null;
}

function findInterfaceFieldBoundaryViolation(
  host: CheckerHost,
  field: InterfaceField,
  paramMap: Map<string, ResolvedType>,
  table: ModuleSymbolTable,
  seen: Set<string>,
  visited: Set<ResolvedType>,
): ActorBoundaryViolation | null {
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

  const violation = findActorBoundaryViolation(host, fieldType, table, seen, visited);
  if (!violation) return null;

  return {
    reason: `field "${field.name}" cannot cross actor boundaries: ${violation.reason}`,
    offendingType: violation.offendingType,
  };
}
