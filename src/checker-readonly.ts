import type { InterfaceField } from "./ast.js";
import type { CheckerHost } from "./checker-internal.js";
import {
  substituteTypeParams,
  typeToString,
  UNKNOWN_TYPE,
  type ActorType,
  type ArrayResolvedType,
  type ClassType,
  type ClassMetaType,
  type FailureWrapperType,
  type InterfaceType,
  type JsonValueResolvedType,
  type MapResolvedType,
  type MethodReflectionType,
  type PromiseType,
  type ResultResolvedType,
  type ResolvedType,
  type SetResolvedType,
  type SuccessWrapperType,
  type TupleResolvedType,
  type UnionResolvedType,
  type WeakResolvedType,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

export interface DeepReadonlyViolation {
  reason: string;
  offendingType: ResolvedType;
}

export function applyDeepReadonly(type: ResolvedType): ResolvedType {
  return applyDeepReadonlyInternal(type, new Map<ResolvedType, ResolvedType>());
}

function applyDeepReadonlyInternal(
  type: ResolvedType,
  seen: Map<ResolvedType, ResolvedType>,
): ResolvedType {
  const cached = seen.get(type);
  if (cached) return cached;

  switch (type.kind) {
    case "array": {
      const readonlyArray: ArrayResolvedType = {
        kind: "array",
        elementType: type.elementType,
        readonly_: true,
      };
      seen.set(type, readonlyArray);
      readonlyArray.elementType = applyDeepReadonlyInternal(type.elementType, seen);
      return readonlyArray;
    }
    case "map": {
      const readonlyMap: MapResolvedType = {
        kind: "map",
        keyType: type.keyType,
        valueType: type.valueType,
        readonly_: true,
      };
      seen.set(type, readonlyMap);
      readonlyMap.keyType = applyDeepReadonlyInternal(type.keyType, seen);
      readonlyMap.valueType = applyDeepReadonlyInternal(type.valueType, seen);
      return readonlyMap;
    }
    case "set": {
      const readonlySet: SetResolvedType = {
        kind: "set",
        elementType: type.elementType,
        readonly_: true,
      };
      seen.set(type, readonlySet);
      readonlySet.elementType = applyDeepReadonlyInternal(type.elementType, seen);
      return readonlySet;
    }
    case "union": {
      const readonlyUnion: UnionResolvedType | JsonValueResolvedType = {
        kind: "union",
        types: [] as ResolvedType[],
        ...(("jsonValue" in type && type.jsonValue) ? { jsonValue: true } : {}),
      };
      seen.set(type, readonlyUnion);
      readonlyUnion.types = type.types.map((member) => applyDeepReadonlyInternal(member, seen));
      return readonlyUnion;
    }
    case "tuple": {
      const readonlyTuple: TupleResolvedType = {
        kind: "tuple",
        elements: [] as ResolvedType[],
      };
      seen.set(type, readonlyTuple);
      readonlyTuple.elements = type.elements.map((element) => applyDeepReadonlyInternal(element, seen));
      return readonlyTuple;
    }
    case "weak": {
      const readonlyWeak: WeakResolvedType = { kind: "weak", inner: type.inner };
      seen.set(type, readonlyWeak);
      readonlyWeak.inner = applyDeepReadonlyInternal(type.inner, seen);
      return readonlyWeak;
    }
    case "class":
      if (type.typeArgs && type.typeArgs.length > 0) {
        const readonlyClass: ClassType = {
          kind: "class",
          symbol: type.symbol,
          typeArgs: [] as ResolvedType[],
        };
        seen.set(type, readonlyClass);
        readonlyClass.typeArgs = type.typeArgs.map((arg) => applyDeepReadonlyInternal(arg, seen));
        return readonlyClass;
      }
      return type;
    case "interface":
      if (type.typeArgs && type.typeArgs.length > 0) {
        const readonlyInterface: InterfaceType = {
          kind: "interface",
          symbol: type.symbol,
          typeArgs: [] as ResolvedType[],
        };
        seen.set(type, readonlyInterface);
        readonlyInterface.typeArgs = type.typeArgs.map((arg) => applyDeepReadonlyInternal(arg, seen));
        return readonlyInterface;
      }
      return type;
    case "result": {
      const readonlyResult: ResultResolvedType = {
        kind: "result",
        successType: type.successType,
        errorType: type.errorType,
      };
      seen.set(type, readonlyResult);
      readonlyResult.successType = applyDeepReadonlyInternal(type.successType, seen);
      readonlyResult.errorType = applyDeepReadonlyInternal(type.errorType, seen);
      return readonlyResult;
    }
    case "promise": {
      const readonlyPromise: PromiseType = { kind: "promise", valueType: type.valueType };
      seen.set(type, readonlyPromise);
      readonlyPromise.valueType = applyDeepReadonlyInternal(type.valueType, seen);
      return readonlyPromise;
    }
    case "actor": {
      const readonlyActor: ActorType = { kind: "actor", innerClass: type.innerClass };
      seen.set(type, readonlyActor);
      readonlyActor.innerClass = applyDeepReadonlyInternal(type.innerClass, seen) as ClassType;
      return readonlyActor;
    }
    case "success-wrapper": {
      const readonlySuccess: SuccessWrapperType = { kind: "success-wrapper", valueType: type.valueType };
      seen.set(type, readonlySuccess);
      readonlySuccess.valueType = applyDeepReadonlyInternal(type.valueType, seen);
      return readonlySuccess;
    }
    case "failure-wrapper": {
      const readonlyFailure: FailureWrapperType = { kind: "failure-wrapper", errorType: type.errorType };
      seen.set(type, readonlyFailure);
      readonlyFailure.errorType = applyDeepReadonlyInternal(type.errorType, seen);
      return readonlyFailure;
    }
    case "class-metadata": {
      const readonlyMetadata: ClassMetaType = { kind: "class-metadata", classType: type.classType };
      seen.set(type, readonlyMetadata);
      readonlyMetadata.classType = applyDeepReadonlyInternal(type.classType, seen) as ClassType;
      return readonlyMetadata;
    }
    case "method-reflection": {
      const readonlyMethodReflection: MethodReflectionType = { kind: "method-reflection", classType: type.classType };
      seen.set(type, readonlyMethodReflection);
      readonlyMethodReflection.classType = applyDeepReadonlyInternal(type.classType, seen) as ClassType;
      return readonlyMethodReflection;
    }
    default:
      return type;
  }
}

export function findDeepReadonlyViolation(
  host: CheckerHost,
  type: ResolvedType,
  table: ModuleSymbolTable,
  seen = new Set<string>(),
  visited = new Set<ResolvedType>(),
): DeepReadonlyViolation | null {
  if (visited.has(type)) return null;
  visited.add(type);

  switch (type.kind) {
    case "array": {
      if (!type.readonly_) {
        return {
          reason: `array type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.elementType, table, seen, visited);
    }

    case "map": {
      if (!type.readonly_) {
        return {
          reason: `map type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.valueType, table, seen, visited)
        ?? findDeepReadonlyViolation(host, type.keyType, table, seen, visited);
    }

    case "set": {
      if (!type.readonly_) {
        return {
          reason: `set type "${typeToString(type)}" is mutable`,
          offendingType: type,
        };
      }
      return findDeepReadonlyViolation(host, type.elementType, table, seen, visited);
    }

    case "tuple":
      for (const element of type.elements) {
        const violation = findDeepReadonlyViolation(host, element, table, seen, visited);
        if (violation) return violation;
      }
      return null;

    case "union":
      for (const member of type.types) {
        const violation = findDeepReadonlyViolation(host, member, table, seen, visited);
        if (violation) return violation;
      }
      return null;

    case "weak":
      return findDeepReadonlyViolation(host, type.inner, table, seen, visited);

    case "class":
      return findClassReadonlyViolation(host, type, table, seen, visited);

    case "interface":
      return findInterfaceReadonlyViolation(host, type, table, seen, visited);

    case "result":
      return findDeepReadonlyViolation(host, type.successType, table, seen, visited)
        ?? findDeepReadonlyViolation(host, type.errorType, table, seen, visited);

    case "promise":
      return findDeepReadonlyViolation(host, type.valueType, table, seen, visited);

    case "actor":
      return findDeepReadonlyViolation(host, type.innerClass, table, seen, visited);

    case "success-wrapper":
      return findDeepReadonlyViolation(host, type.valueType, table, seen, visited);

    case "failure-wrapper":
      return findDeepReadonlyViolation(host, type.errorType, table, seen, visited);

    case "class-metadata":
    case "method-reflection":
      return findDeepReadonlyViolation(host, type.classType, table, seen, visited);

    default:
      return null;
  }
}

function findClassReadonlyViolation(
  host: CheckerHost,
  type: ClassType,
  table: ModuleSymbolTable,
  seen: Set<string>,
  visited: Set<ResolvedType>,
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

    const violation = findDeepReadonlyViolation(host, fieldType, table, seen, visited);
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
  visited: Set<ResolvedType>,
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
    const violation = findInterfaceFieldReadonlyViolation(host, field, paramMap, table, seen, visited);
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
  visited: Set<ResolvedType>,
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

  const violation = findDeepReadonlyViolation(host, fieldType, table, seen, visited);
  if (!violation) return null;

  return {
    reason: `field "${field.name}" is not deeply immutable: ${violation.reason}`,
    offendingType: violation.offendingType,
  };
}