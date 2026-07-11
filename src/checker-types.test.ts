import { describe, expect, it } from "vitest";
import {
  BOOL_TYPE,
  CHAR_TYPE,
  DOUBLE_TYPE,
  FLOAT_TYPE,
  INT_TYPE,
  JSON_VALUE_TYPE,
  LONG_TYPE,
  NULL_TYPE,
  RANGE_TYPE,
  STRING_TYPE,
  UNKNOWN_TYPE,
  VOID_TYPE,
  buildMockCallMetadata,
  computeElseNarrowType,
  describeSupportedHashCollectionElementTypes,
  findUnsupportedHashCollectionConstraint,
  findUnsupportedMapKeyType,
  formatUnsupportedHashCollectionConstraintMessage,
  formatUnsupportedMapKeyTypeMessage,
  getResultShape,
  isAssignableTo,
  isJSONSerializable,
  isPrimitiveName,
  isStreamSensitiveType,
  isSupportedHashCollectionElementType,
  isSupportedMapKeyType,
  isSupportedSetElementType,
  makeResultType,
  normalizeTypeForRuntime,
  substituteTypeParams,
  typeContainsTypeVar,
  typeToString,
  typesEqual,
  typesEqualAtRuntime,
  type ResolvedType,
} from "./checker-types.js";
import { check, findId } from "./checker-test-helpers.js";

describe("checker-types — Result shapes and formatting", () => {
  it("recognizes canonical Result arms regardless of order", () => {
    const result = makeResultType(INT_TYPE, STRING_TYPE);
    const reordered: ResolvedType = { kind: "union", types: [...result.types].reverse() };

    expect(getResultShape(result)?.successType).toBe(INT_TYPE);
    expect(getResultShape(reordered)?.errorType).toBe(STRING_TYPE);
    expect(getResultShape({ kind: "union", types: [INT_TYPE, STRING_TYPE] })).toBeNull();
    expect(typeToString(result)).toBe("Result<int, string>");
  });

  it("formats nested runtime types used in diagnostics", () => {
    expect(typeToString({ kind: "builtin-namespace", name: "int" })).toBe("int");
    expect(typeToString({ kind: "range" })).toBe("Range");
    expect(typeToString({ kind: "weak", inner: STRING_TYPE })).toBe("weak string");
    expect(typeToString({ kind: "namespace", sourceModule: "/math.do" })).toBe("namespace(/math.do)");
    expect(typeToString({ kind: "promise", valueType: INT_TYPE })).toBe("Promise<int>");
    expect(typeToString({ kind: "success", valueType: INT_TYPE })).toBe("Success<int>");
    expect(typeToString({ kind: "failure", errorType: STRING_TYPE })).toBe("Failure<string>");
    expect(typeToString({ kind: "typevar", name: "T" })).toBe("T");
    expect(typeToString({ kind: "json-serializable-constraint" })).toBe("JsonSerializable");
    expect(typeToString({ kind: "reflectable-constraint" })).toBe("Reflectable");
  });
});

describe("checker-types — hash collection constraints", () => {
  it("distinguishes supported hashable primitives from numeric-only primitives", () => {
    expect(isPrimitiveName("byte")).toBe(true);
    expect(isPrimitiveName("float")).toBe(true);
    expect(isPrimitiveName("not-a-type")).toBe(false);
    expect(isSupportedHashCollectionElementType(CHAR_TYPE)).toBe(true);
    expect(isSupportedHashCollectionElementType(FLOAT_TYPE)).toBe(false);
    expect(isSupportedHashCollectionElementType({ kind: "typevar", name: "T" })).toBe(true);
    expect(isSupportedMapKeyType(BOOL_TYPE)).toBe(true);
    expect(isSupportedSetElementType(DOUBLE_TYPE)).toBe(false);
    expect(describeSupportedHashCollectionElementTypes()).toContain("enum");
  });

  it("finds the first unsupported nested map key or set element", () => {
    const unsupportedKey: ResolvedType = {
      kind: "map",
      keyType: FLOAT_TYPE,
      valueType: { kind: "array", elementType: STRING_TYPE, readonly_: false },
    };
    const unsupportedSet: ResolvedType = {
      kind: "array",
      elementType: { kind: "set", elementType: { kind: "tuple", elements: [INT_TYPE] } },
      readonly_: false,
    };

    expect(findUnsupportedHashCollectionConstraint(unsupportedKey)).toEqual({
      kind: "map-key",
      type: FLOAT_TYPE,
    });
    expect(findUnsupportedHashCollectionConstraint(unsupportedSet)).toEqual({
      kind: "set-element",
      type: { kind: "tuple", elements: [INT_TYPE] },
    });
    expect(findUnsupportedHashCollectionConstraint(JSON_VALUE_TYPE)).toBeNull();
    expect(findUnsupportedMapKeyType(unsupportedKey)).toBe(FLOAT_TYPE);
    expect(findUnsupportedMapKeyType(unsupportedSet)).toBeNull();
    expect(formatUnsupportedHashCollectionConstraintMessage({ kind: "map-key", type: FLOAT_TYPE }, "map-literal-key"))
      .toContain("Map literal key");
    expect(formatUnsupportedHashCollectionConstraintMessage({ kind: "set-element", type: DOUBLE_TYPE }, "set-literal-element"))
      .toContain("Set literal element");
    expect(formatUnsupportedMapKeyTypeMessage(FLOAT_TYPE, "literal-key")).toContain("Map literal key");
  });
});

describe("checker-types — runtime compatibility", () => {
  it("normalizes collection mutability for runtime equality", () => {
    const mutable: ResolvedType = { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE, readonly_: false };
    const readonly: ResolvedType = { kind: "map", keyType: STRING_TYPE, valueType: INT_TYPE, readonly_: true };

    expect(typesEqualAtRuntime(mutable, readonly)).toBe(true);
    expect(normalizeTypeForRuntime({ kind: "array", elementType: INT_TYPE, readonly_: true })).toEqual({
      kind: "array",
      elementType: INT_TYPE,
      readonly_: false,
    });
    expect(normalizeTypeForRuntime({ kind: "set", elementType: STRING_TYPE, readonly_: true })).toEqual({
      kind: "set",
      elementType: STRING_TYPE,
    });
  });

  it("handles constraint, stream, range, weak, and Result-arm assignability", () => {
    const cr = check({ "/main.do": `class Box { value: int }\nconst box = Box(1)\nfunction use(): Box => box` }, "/main.do");
    const boxType = findId(cr, "box")[0].type;

    expect(isAssignableTo(INT_TYPE, { kind: "json-serializable-constraint" })).toBe(true);
    expect(isAssignableTo({ kind: "function", params: [], returnType: VOID_TYPE }, { kind: "json-serializable-constraint" })).toBe(false);
    expect(isAssignableTo(INT_TYPE, { kind: "reflectable-constraint" })).toBe(false);
    expect(isAssignableTo(boxType, { kind: "reflectable-constraint" })).toBe(true);
    expect(isAssignableTo({ kind: "typevar", name: "T" }, STRING_TYPE)).toBe(true);
    expect(isAssignableTo(RANGE_TYPE, { kind: "range" })).toBe(true);
    expect(isAssignableTo({ kind: "weak", inner: INT_TYPE }, { kind: "weak", inner: LONG_TYPE })).toBe(true);
    expect(isAssignableTo({ kind: "success", valueType: INT_TYPE }, { kind: "success", valueType: LONG_TYPE })).toBe(true);
    expect(isAssignableTo({ kind: "failure", errorType: INT_TYPE }, { kind: "failure", errorType: STRING_TYPE })).toBe(false);
  });
});

describe("checker-types — narrowing and substitution", () => {
  it("computes nullable and Result else-narrow types", () => {
    expect(computeElseNarrowType({ kind: "union", types: [STRING_TYPE, NULL_TYPE] })).toEqual({
      narrowedType: STRING_TYPE,
      applicable: true,
    });
    expect(computeElseNarrowType({ kind: "union", types: [makeResultType(INT_TYPE, STRING_TYPE), NULL_TYPE] })).toEqual({
      narrowedType: INT_TYPE,
      applicable: true,
    });
    expect(computeElseNarrowType(NULL_TYPE)).toEqual({ narrowedType: UNKNOWN_TYPE, applicable: true });
    expect(computeElseNarrowType(BOOL_TYPE)).toEqual({ narrowedType: BOOL_TYPE, applicable: false });
  });

  it("substitutes type variables through nested types and normalizes unions", () => {
    const type: ResolvedType = {
      kind: "function",
      params: [{ name: "items", type: { kind: "array", elementType: { kind: "typevar", name: "T" }, readonly_: true } }],
      returnType: { kind: "union", types: [{ kind: "typevar", name: "T" }, INT_TYPE, INT_TYPE] },
    };
    const substituted = substituteTypeParams(type, new Map([["T", STRING_TYPE]]));

    expect(substituted).toEqual({
      kind: "function",
      params: [{ name: "items", type: { kind: "array", elementType: STRING_TYPE, readonly_: true } }],
      returnType: { kind: "union", types: [STRING_TYPE, INT_TYPE] },
    });
    expect(typeContainsTypeVar(type)).toBe(true);
    expect(typeContainsTypeVar(JSON_VALUE_TYPE)).toBe(false);
    expect(isStreamSensitiveType({ kind: "map", keyType: STRING_TYPE, valueType: { kind: "stream", elementType: { kind: "typevar", name: "T" } } })).toBe(true);
    expect(isStreamSensitiveType({ kind: "tuple", elements: [INT_TYPE, STRING_TYPE] })).toBe(false);
  });
});

describe("checker-types — JSON and mock metadata", () => {
  it("classifies JSON-compatible and runtime-only types", () => {
    expect(isJSONSerializable(JSON_VALUE_TYPE)).toBe(true);
    expect(isJSONSerializable({ kind: "array", elementType: STRING_TYPE, readonly_: false })).toBe(true);
    expect(isJSONSerializable({ kind: "map", keyType: STRING_TYPE, valueType: JSON_VALUE_TYPE })).toBe(true);
    expect(isJSONSerializable({ kind: "set", elementType: STRING_TYPE })).toBe(false);
    expect(isJSONSerializable({ kind: "stream", elementType: INT_TYPE })).toBe(false);
    expect(isJSONSerializable({ kind: "range" })).toBe(false);
    expect(isJSONSerializable({ kind: "promise", valueType: INT_TYPE })).toBe(false);
    expect(isJSONSerializable(makeResultType(INT_TYPE, STRING_TYPE))).toBe(false);
    expect(isJSONSerializable({ kind: "union", types: [STRING_TYPE, NULL_TYPE] })).toBe(true);
  });

  it("builds stable mock capture names for module and class methods", () => {
    const moduleCall = buildMockCallMetadata("/pkg/net-client.do", "send-request", [
      { name: "url", type: STRING_TYPE },
    ]);
    const methodCall = buildMockCallMetadata("/pkg/net-client.do", "send-request", [], "Gateway");

    expect(moduleCall.captureType.typeName).toBe("__pkg_net_client_send_request_Call");
    expect(moduleCall.storageName).toBe("__pkg_net_client_send_request_calls");
    expect(methodCall.captureType.typeName).toBe("__Gateway_send_request_Call");
    expect(methodCall.storageName).toBe("__send_request_calls");
  });
});
