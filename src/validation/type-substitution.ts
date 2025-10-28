import { Type } from "../types";
import { createUnknownType } from "../type-utils";

function assertValidType(value: Type | undefined, context: string, parent: Type): asserts value is Type {
  if (!value || typeof value !== "object" || typeof (value as any).kind !== "string") {
    throw new Error(
      `cloneTypeNode received invalid ${context}: ${JSON.stringify(value)} in parent ${JSON.stringify(parent)}`
    );
  }
}

export function cloneTypeNode(type: Type): Type {
  if (!type || typeof type !== "object" || typeof (type as any).kind !== "string") {
    throw new Error(`cloneTypeNode received invalid type: ${JSON.stringify(type)}`);
  }
  switch (type.kind) {
    case "primitive":
      return { kind: "primitive", type: type.type };
    case "unknown":
      return { kind: "unknown" };
    case "enum":
      return { kind: "enum", name: type.name };
    case "typeParameter":
      return { kind: "typeParameter", name: type.name };
    case "class":
      return {
        kind: "class",
        name: type.name,
        isWeak: type.isWeak,
        wasNullable: type.wasNullable,
        typeArguments: type.typeArguments?.map(arg => {
          assertValidType(arg, "class type argument", type);
          return cloneTypeNode(arg);
        })
      };
    case "externClass":
      return {
        kind: "externClass",
        name: type.name,
        isWeak: type.isWeak,
        wasNullable: type.wasNullable,
        namespace: type.namespace
      };
    case "array":
      assertValidType(type.elementType, "array element type", type);
      return { kind: "array", elementType: cloneTypeNode(type.elementType) };
    case "map":
      assertValidType(type.keyType, "map key type", type);
      assertValidType(type.valueType, "map value type", type);
      return {
        kind: "map",
        keyType: cloneTypeNode(type.keyType),
        valueType: cloneTypeNode(type.valueType)
      };
    case "set":
      assertValidType(type.elementType, "set element type", type);
      return { kind: "set", elementType: cloneTypeNode(type.elementType) };
    case "union":
      return {
        kind: "union",
        types: type.types.map(t => {
          assertValidType(t, "union member type", type);
          return cloneTypeNode(t);
        })
      };
    case "function": {
      assertValidType(type.returnType, "function return type", type);
      return {
        kind: "function",
        parameters: type.parameters.map(p => {
          assertValidType(p.type, `function parameter '${p.name}' type`, type);
          return { name: p.name, type: cloneTypeNode(p.type) };
        }),
        returnType: cloneTypeNode(type.returnType),
        typeParameters: type.typeParameters,
        isConciseForm: type.isConciseForm,
        isPrintlnFunction: type.isPrintlnFunction
      };
    }
    case "typeAlias":
      return {
        kind: "typeAlias",
        name: type.name,
        isWeak: type.isWeak,
        typeArguments: type.typeArguments?.map(arg => {
          assertValidType(arg, "type alias argument", type);
          return cloneTypeNode(arg);
        })
      };
    case "range":
      assertValidType(type.start, "range start type", type);
      assertValidType(type.end, "range end type", type);
      return {
        kind: "range",
        start: cloneTypeNode(type.start),
        end: cloneTypeNode(type.end),
        inclusive: type.inclusive
      };
    default:
      return { kind: "unknown" };
  }
}

export function substituteTypeParametersInType(type: Type, mapping: Map<string, Type>): Type {
  switch (type.kind) {
    case "typeParameter": {
      const replacement = mapping.get(type.name);
      return replacement ? cloneTypeNode(replacement) : createUnknownType();
    }
    case "primitive":
      return { kind: "primitive", type: type.type };
    case "unknown":
      return { kind: "unknown" };
    case "enum":
      return { kind: "enum", name: type.name };
    case "class":
      return {
        kind: "class",
        name: type.name,
        isWeak: type.isWeak,
        wasNullable: type.wasNullable,
        typeArguments: type.typeArguments?.map(arg => substituteTypeParametersInType(arg, mapping))
      };
    case "externClass":
      return {
        kind: "externClass",
        name: type.name,
        isWeak: type.isWeak,
        wasNullable: type.wasNullable,
        namespace: type.namespace
      };
    case "array":
      return { kind: "array", elementType: substituteTypeParametersInType(type.elementType, mapping) };
    case "map":
      return {
        kind: "map",
        keyType: substituteTypeParametersInType(type.keyType, mapping),
        valueType: substituteTypeParametersInType(type.valueType, mapping)
      };
    case "set":
      return { kind: "set", elementType: substituteTypeParametersInType(type.elementType, mapping) };
    case "union":
      return { kind: "union", types: type.types.map(t => substituteTypeParametersInType(t, mapping)) };
    case "function":
      return {
        kind: "function",
        parameters: type.parameters.map(p => ({ name: p.name, type: substituteTypeParametersInType(p.type, mapping) })),
        returnType: substituteTypeParametersInType(type.returnType, mapping),
        typeParameters: type.typeParameters,
        isConciseForm: type.isConciseForm,
        isPrintlnFunction: type.isPrintlnFunction
      };
    case "typeAlias":
      return {
        kind: "typeAlias",
        name: type.name,
        isWeak: type.isWeak,
        typeArguments: type.typeArguments?.map(arg => substituteTypeParametersInType(arg, mapping))
      };
    case "range":
      return {
        kind: "range",
        start: substituteTypeParametersInType(type.start, mapping),
        end: substituteTypeParametersInType(type.end, mapping),
        inclusive: type.inclusive
      };
    default:
      return cloneTypeNode(type);
  }
}
