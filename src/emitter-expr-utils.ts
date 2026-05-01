/**
 * Shared utility functions used across emitter sub-modules.
 */

import type { Expression, FunctionDeclaration, ObjectProperty, TypeAnnotation } from "./ast.js";
import {
  isPrimitiveName,
  JSON_OBJECT_TYPE,
  JSON_VALUE_TYPE,
  NULL_TYPE,
  substituteTypeParams,
  UNKNOWN_TYPE,
  VOID_TYPE,
  type ResolvedType,
} from "./checker-types.js";
import type { ClassSymbol, ModuleSymbol } from "./types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitType } from "./emitter-types.js";

/**
 * Resolve a TypeAnnotation to a ResolvedType.
 * First checks if the analyzer has already resolved it (resolvedSymbol).
 * Falls back to looking up the name in the module's symbol table.
 */
export function resolveTypeAnnotation(
  typeAnn: TypeAnnotation,
  ctx?: EmitContext,
): ResolvedType {
  switch (typeAnn.kind) {
    case "named-type":
      return resolveNamedTypeAnnotation(typeAnn, ctx);

    case "array-type":
      return {
        kind: "array",
        elementType: resolveTypeAnnotation(typeAnn.elementType, ctx),
        readonly_: typeAnn.readonly_,
      };

    case "union-type":
      return {
        kind: "union",
        types: typeAnn.types.map((type) => resolveTypeAnnotation(type, ctx)),
      };

    case "function-type":
      return {
        kind: "function",
        params: typeAnn.params.map((param) => ({
          name: param.name,
          type: resolveTypeAnnotation(param.type, ctx),
        })),
        returnType: resolveTypeAnnotation(typeAnn.returnType, ctx),
      };

    case "tuple-type":
      return {
        kind: "tuple",
        elements: typeAnn.elements.map((element) => resolveTypeAnnotation(element, ctx)),
      };

    case "weak-type":
      return {
        kind: "weak",
        inner: resolveTypeAnnotation(typeAnn.type, ctx),
      };
  }
}

function resolveNamedTypeAnnotation(
  typeAnn: Extract<TypeAnnotation, { kind: "named-type" }>,
  ctx?: EmitContext,
): ResolvedType {
  const { name } = typeAnn;
  if (name === "JsonValue") return JSON_VALUE_TYPE;
  if (name === "JsonObject") return JSON_OBJECT_TYPE;
  if (isPrimitiveName(name)) return { kind: "primitive", name };
  if (name === "void") return VOID_TYPE;
  if (name === "null") return NULL_TYPE;

  if (name === "Array" || name === "ReadonlyArray") {
    const elementType = typeAnn.typeArgs.length > 0
      ? resolveTypeAnnotation(typeAnn.typeArgs[0], ctx)
      : UNKNOWN_TYPE;
    return { kind: "array", elementType, readonly_: name === "ReadonlyArray" };
  }

  if (name === "Tuple") {
    return {
      kind: "tuple",
      elements: typeAnn.typeArgs.map((typeArg) => resolveTypeAnnotation(typeArg, ctx)),
    };
  }

  if (name === "Map" || name === "ReadonlyMap") {
    const keyType = typeAnn.typeArgs.length > 0
      ? resolveTypeAnnotation(typeAnn.typeArgs[0], ctx)
      : UNKNOWN_TYPE;
    const valueType = typeAnn.typeArgs.length > 1
      ? resolveTypeAnnotation(typeAnn.typeArgs[1], ctx)
      : UNKNOWN_TYPE;
    return { kind: "map", keyType, valueType, readonly_: name === "ReadonlyMap" };
  }

  if (name === "Set" || name === "ReadonlySet") {
    const elementType = typeAnn.typeArgs.length > 0
      ? resolveTypeAnnotation(typeAnn.typeArgs[0], ctx)
      : UNKNOWN_TYPE;
    return { kind: "set", elementType, readonly_: name === "ReadonlySet" };
  }

  if (name === "Actor") {
    if (typeAnn.typeArgs.length === 1) {
      const innerType = resolveTypeAnnotation(typeAnn.typeArgs[0], ctx);
      if (innerType.kind === "class") {
        return { kind: "actor", innerClass: innerType };
      }
    }
    return UNKNOWN_TYPE;
  }

  if (name === "Promise") {
    if (typeAnn.typeArgs.length === 1) {
      return {
        kind: "promise",
        valueType: resolveTypeAnnotation(typeAnn.typeArgs[0], ctx),
      };
    }
    return UNKNOWN_TYPE;
  }

  if (name === "Result") {
    if (typeAnn.typeArgs.length === 2) {
      return {
        kind: "result",
        successType: resolveTypeAnnotation(typeAnn.typeArgs[0], ctx),
        errorType: resolveTypeAnnotation(typeAnn.typeArgs[1], ctx),
      };
    }
    return UNKNOWN_TYPE;
  }

  if (name === "Stream") {
    if (typeAnn.typeArgs.length === 1) {
      return {
        kind: "stream",
        elementType: resolveTypeAnnotation(typeAnn.typeArgs[0], ctx),
      };
    }
    return UNKNOWN_TYPE;
  }

  const symbol = typeAnn.resolvedSymbol ?? lookupNamedTypeSymbol(name, ctx);
  if (!symbol) return UNKNOWN_TYPE;
  return resolveModuleSymbolType(symbol, typeAnn.typeArgs, ctx);
}

function lookupNamedTypeSymbol(name: string, ctx?: EmitContext): ModuleSymbol | undefined {
  if (!ctx) return undefined;

  const local = ctx.module.symbols.get(name);
  if (local) return local;

  for (const [, table] of ctx.allModules) {
    const symbol = table.symbols.get(name);
    if (symbol) return symbol;
  }

  return undefined;
}

function resolveModuleSymbolType(
  symbol: ModuleSymbol,
  typeArgs: readonly TypeAnnotation[],
  ctx?: EmitContext,
): ResolvedType {
  switch (symbol.symbolKind) {
    case "class": {
      const resolvedArgs = typeArgs.map((typeArg) => resolveTypeAnnotation(typeArg, ctx));
      return resolvedArgs.length > 0
        ? { kind: "class", symbol, typeArgs: resolvedArgs }
        : { kind: "class", symbol };
    }

    case "interface": {
      const resolvedArgs = typeArgs.map((typeArg) => resolveTypeAnnotation(typeArg, ctx));
      return resolvedArgs.length > 0
        ? { kind: "interface", symbol, typeArgs: resolvedArgs }
        : { kind: "interface", symbol };
    }

    case "enum":
      return { kind: "enum", symbol };

    case "type-alias": {
      const aliasType = resolveTypeAnnotation(symbol.declaration.type, ctx);
      if (symbol.declaration.typeParams.length === 0 || typeArgs.length === 0) {
        return aliasType;
      }

      const typeParamMap = new Map<string, ResolvedType>();
      for (let index = 0; index < symbol.declaration.typeParams.length && index < typeArgs.length; index++) {
        typeParamMap.set(symbol.declaration.typeParams[index], resolveTypeAnnotation(typeArgs[index], ctx));
      }
      return substituteTypeParams(aliasType, typeParamMap);
    }

    default:
      return UNKNOWN_TYPE;
  }
}

/**
 * Build a map from field name to resolved type for a class's instance construction fields.
 */
export function buildFieldTypeMap(classSym: ClassSymbol | undefined): Map<string, ResolvedType> {
  const map = new Map<string, ResolvedType>();
  for (const field of buildConstructorFieldInfoList(classSym)) {
    if (field.type) {
      map.set(field.name, field.type);
    }
  }

  return map;
}

/**
 * Build an ordered list of resolved types for a class's instance construction fields.
 */
export function buildFieldTypeList(classSym: ClassSymbol | undefined): ResolvedType[] {
  return buildConstructorFieldInfoList(classSym)
    .flatMap((field) => field.type ? [field.type] : []);
}

export interface ConstructorFieldInfo {
  name: string;
  type: ResolvedType | undefined;
  defaultValue: Expression | null;
}

function findExternConstructorFactoryMethod(
  classSym: ClassSymbol | undefined,
): FunctionDeclaration | null {
  if (!classSym?.extern_) return null;

  for (const method of classSym.declaration.methods) {
    if (!method.static_ || method.name !== "create") continue;
    const returnType = method.returnType;
    if (!returnType || returnType.kind !== "named-type") continue;
    if (returnType.resolvedSymbol === classSym || returnType.name === classSym.name) {
      return method;
    }
  }

  return null;
}

export function hasExternConstructorFactory(classSym: ClassSymbol | undefined): boolean {
  return findExternConstructorFactoryMethod(classSym) !== null;
}

export function emitResolvedClassName(type: Extract<ResolvedType, { kind: "class" }>): string {
  const cppName = type.symbol.extern_?.cppName ?? type.symbol.name;
  if (!type.typeArgs || type.typeArgs.length === 0) {
    return cppName;
  }
  return `${cppName}<${type.typeArgs.map(emitType).join(", ")}>`;
}

export function emitStreamNextHelperName(aliasName: string): string {
  return `__doof_stream_next_${aliasName.replace(/[^A-Za-z0-9]/g, "_")}`;
}

export function buildConstructorFieldInfoList(
  classSym: ClassSymbol | undefined,
): ConstructorFieldInfo[] {
  const factoryMethod = findExternConstructorFactoryMethod(classSym);
  if (factoryMethod) {
    return factoryMethod.params.map((param) => ({
      name: param.name,
      type: param.resolvedType,
      defaultValue: param.defaultValue,
    }));
  }

  const fields: ConstructorFieldInfo[] = [];
  if (!classSym) return fields;

  for (const field of classSym.declaration.fields) {
    if (!field.const_ && !field.static_) {
      for (const name of field.names) {
        fields.push({
          name,
          type: field.resolvedType,
          defaultValue: field.defaultValue,
        });
      }
    }
  }

  return fields;
}

/**
 * Sort named properties to match the class field declaration order.
 */
export function sortNamedArgsByFieldOrder(
  props: ObjectProperty[],
  classSym: ClassSymbol | undefined,
): ObjectProperty[] {
  if (!classSym) return props;

  const fieldOrder = buildConstructorFieldInfoList(classSym).map((field) => field.name);

  const propMap = new Map<string, ObjectProperty>();
  for (const prop of props) {
    propMap.set(prop.name, prop);
  }

  const sorted: ObjectProperty[] = [];
  for (const name of fieldOrder) {
    const prop = propMap.get(name);
    if (prop) {
      sorted.push(prop);
      propMap.delete(name);
    }
  }

  for (const prop of propMap.values()) {
    sorted.push(prop);
  }

  return sorted;
}

export function buildPositionalConstructorArgList(
  classSym: ClassSymbol | undefined,
  providedArgs: string[],
  emitDefaultValue: (expr: Expression, targetType?: ResolvedType) => string,
): string[] {
  if (!hasExternConstructorFactory(classSym)) {
    return providedArgs;
  }

  const params = buildConstructorFieldInfoList(classSym);
  const args: string[] = [];
  for (let index = 0; index < params.length; index++) {
    if (index < providedArgs.length) {
      args.push(providedArgs[index]);
      continue;
    }

    const param = params[index];
    if (param.defaultValue) {
      args.push(emitDefaultValue(param.defaultValue, param.type));
    }
  }

  return args;
}

export function emitClassConstruction(
  className: string,
  classSym: ClassSymbol | undefined,
  args: string[],
): string {
  if (hasExternConstructorFactory(classSym)) {
    return `${className}::create(${args.join(", ")})`;
  }

  return `std::make_shared<${className}>(${args.join(", ")})`;
}
