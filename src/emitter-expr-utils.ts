/**
 * Shared utility functions used across emitter sub-modules.
 */

import type { Expression, ObjectProperty, TypeAnnotation } from "./ast.js";
import { ANY_TYPE, isPrimitiveName, type ResolvedType } from "./checker-types.js";
import type { ClassSymbol } from "./types.js";
import type { EmitContext } from "./emitter-context.js";

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
    if (name === "any") {
      return ANY_TYPE;
    }
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
  if (!classSym) return map;

  for (const field of classSym.declaration.fields) {
    if (!field.const_ && !field.static_ && field.resolvedType) {
      for (const name of field.names) {
        map.set(name, field.resolvedType);
      }
    }
  }

  return map;
}

/**
 * Build an ordered list of resolved types for a class's instance construction fields.
 */
export function buildFieldTypeList(classSym: ClassSymbol | undefined): ResolvedType[] {
  const types: ResolvedType[] = [];
  if (!classSym) return types;

  for (const field of classSym.declaration.fields) {
    if (!field.const_ && !field.static_ && field.resolvedType) {
      for (const _name of field.names) {
        types.push(field.resolvedType);
      }
    }
  }

  return types;
}

export interface ConstructorFieldInfo {
  name: string;
  type: ResolvedType | undefined;
  defaultValue: Expression | null;
}

export function buildConstructorFieldInfoList(
  classSym: ClassSymbol | undefined,
): ConstructorFieldInfo[] {
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

  const fieldOrder: string[] = [];
  for (const field of classSym.declaration.fields) {
    if (!field.const_ && !field.static_) {
      for (const name of field.names) {
        fieldOrder.push(name);
      }
    }
  }

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
