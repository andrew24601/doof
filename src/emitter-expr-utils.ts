/**
 * Shared utility functions used across emitter sub-modules.
 */

import type { Expression, FunctionDeclaration, ObjectProperty, TypeAnnotation } from "./ast.js";
import { isPrimitiveName, type ResolvedType } from "./checker-types.js";
import type { ClassSymbol } from "./types.js";
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
  if (typeAnn.kind === "named-type" && typeAnn.resolvedSymbol) {
    const sym = typeAnn.resolvedSymbol;
    switch (sym.symbolKind) {
      case "class": return { kind: "class", symbol: sym };
      case "interface": return { kind: "interface", symbol: sym };
      case "enum": return { kind: "enum", symbol: sym };
      default: return { kind: "unknown" };
    }
  }

  if (typeAnn.kind === "named-type" && ctx) {
    const name = typeAnn.name;
    if (isPrimitiveName(name)) {
      return { kind: "primitive", name };
    }
    const sym = ctx.module.symbols.get(name);
    if (sym) {
      switch (sym.symbolKind) {
        case "class": return { kind: "class", symbol: sym };
        case "interface": return { kind: "interface", symbol: sym };
        case "enum": return { kind: "enum", symbol: sym };
      }
    }
    for (const [, table] of ctx.allModules) {
      const s = table.symbols.get(name);
      if (s) {
        switch (s.symbolKind) {
          case "class": return { kind: "class", symbol: s };
          case "interface": return { kind: "interface", symbol: s };
          case "enum": return { kind: "enum", symbol: s };
        }
      }
    }
  }

  return { kind: "unknown" };
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
