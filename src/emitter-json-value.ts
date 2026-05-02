import { isAssignableTo, isJsonValueType, normalizeTypeForRuntime, typesEqualAtRuntime, type ResolvedType } from "./checker-types.js";
import { emitType, emitNullForType, isOptionalNullable } from "./emitter-types.js";

export function emitRuntimeCoercion(sourceExpr: string, sourceType: ResolvedType, targetType: ResolvedType): string {
  if (sourceType.kind === "unknown" || targetType.kind === "unknown") {
    return sourceExpr;
  }

  if (typesEqualAtRuntime(sourceType, targetType)) {
    return sourceExpr;
  }

  if (emitType(sourceType) === emitType(targetType)) {
    return sourceExpr;
  }

  if (isJsonValueType(normalizeTypeForRuntime(targetType))) {
    return emitWrapJsonValue(sourceExpr, sourceType);
  }

  if (sourceType.kind === "null") {
    return emitNullForType(targetType);
  }

  if (sourceType.kind === "result" && targetType.kind === "result") {
    const targetCpp = emitType(targetType);
    const successExpr = targetType.successType.kind === "void"
      ? `${targetCpp}::success()`
      : `${targetCpp}::success(${emitRuntimeCoercion("_coerce_src.value()", sourceType.successType, targetType.successType)})`;
    const errorExpr = `${targetCpp}::failure(${emitRuntimeCoercion("_coerce_src.error()", sourceType.errorType, targetType.errorType)})`;
    return `([&]() -> ${targetCpp} { auto&& _coerce_src = ${sourceExpr}; if (_coerce_src.isSuccess()) return ${successExpr}; return ${errorExpr}; })()`;
  }

  if (targetType.kind === "stream") {
    const targetCpp = emitType(targetType);
    const sourceCpp = emitType(sourceType);
    return `${targetCpp}{std::in_place_type<${sourceCpp}>, ${sourceExpr}}`;
  }

  if (sourceType.kind === "union") {
    return emitCoerceUnionSource(sourceExpr, sourceType, targetType);
  }

  if (targetType.kind === "union") {
    return emitCoerceUnionTarget(sourceExpr, sourceType, targetType);
  }

  return sourceExpr;
}

export function emitWrapJsonValue(sourceExpr: string, sourceType: ResolvedType): string {
  switch (sourceType.kind) {
    case "null":
      return "doof::json_value(nullptr)";

    case "primitive":
      if (sourceType.name === "byte") {
        return `doof::json_value(static_cast<int32_t>(${sourceExpr}))`;
      }
      if (sourceType.name === "bool"
        || sourceType.name === "int"
        || sourceType.name === "long"
        || sourceType.name === "float"
        || sourceType.name === "double"
        || sourceType.name === "string") {
        return `doof::json_value(${sourceExpr})`;
      }
      throw new Error(`JsonValue wrapping does not support primitive type "${sourceType.name}"`);

    case "array": {
      if (isJsonValueType(sourceType.elementType)) {
        return `doof::json_value(${sourceExpr})`;
      }
      throw new Error("JsonValue wrapping only supports JsonValue[] without explicit conversion");
    }

    case "map": {
      if (sourceType.keyType.kind === "primitive" && sourceType.keyType.name === "string" && isJsonValueType(sourceType.valueType)) {
        return `doof::json_value(${sourceExpr})`;
      }
      throw new Error("JsonValue wrapping only supports Map<string, JsonValue> without explicit conversion");
    }

    case "union": {
      const branches = sourceType.types.map((memberType) => emitJsonUnionBranch(memberType));
      return `([&]() -> doof::JsonValue { auto&& _json_src = ${sourceExpr}; return std::visit([&](auto&& _value) -> doof::JsonValue {${branches.join(" ")} doof::panic("Unsupported JsonValue union member"); }, _json_src); })()`;
    }

    default:
      throw new Error(`Cannot wrap type "${sourceType.kind}" as JsonValue during emission`);
  }
}

function emitJsonUnionBranch(memberType: ResolvedType): string {
  const cppType = emitType(memberType);
  const wrappedValue = emitWrapJsonValue("_value", memberType);
  return ` if constexpr (std::is_same_v<std::decay_t<decltype(_value)>, ${cppType}>) { return ${wrappedValue}; }`;
}

function emitCoerceUnionSource(sourceExpr: string, sourceType: Extract<ResolvedType, { kind: "union" }>, targetType: ResolvedType): string {
  if (isOptionalNullable(sourceType)) {
    const memberType = sourceType.types.find((type) => type.kind !== "null");
    if (!memberType) return sourceExpr;
    const targetCpp = emitType(targetType);
    const nullExpr = emitNullForType(targetType);
    const coercedValue = emitRuntimeCoercion("_coerce_src.value()", memberType, targetType);
    return `([&]() -> ${targetCpp} { auto&& _coerce_src = ${sourceExpr}; if (!_coerce_src.has_value()) return ${nullExpr}; return ${coercedValue}; })()`;
  }

  const targetCpp = emitType(targetType);
  const branches = sourceType.types.map((memberType) => emitUnionCoercionBranch(memberType, targetType));
  return `([&]() -> ${targetCpp} { auto&& _coerce_src = ${sourceExpr}; return std::visit([&](auto&& _value) -> ${targetCpp} {${branches.join(" ")} doof::panic("Unsupported runtime coercion from union"); }, _coerce_src); })()`;
}

function emitUnionCoercionBranch(memberType: ResolvedType, targetType: ResolvedType): string {
  const cppType = emitType(memberType);
  const coercedValue = emitRuntimeCoercion("_value", memberType, targetType);
  return ` if constexpr (std::is_same_v<std::decay_t<decltype(_value)>, ${cppType}>) { return ${coercedValue}; }`;
}

function emitCoerceUnionTarget(sourceExpr: string, sourceType: ResolvedType, targetType: Extract<ResolvedType, { kind: "union" }>): string {
  const nullableMember = getNullableUnionMember(targetType);
  if (nullableMember) {
    if (nullableMember.kind === "class"
      || nullableMember.kind === "array"
      || nullableMember.kind === "map"
      || nullableMember.kind === "set"
      || nullableMember.kind === "weak") {
      return sourceType.kind === "null"
        ? "nullptr"
        : emitRuntimeCoercion(sourceExpr, sourceType, nullableMember);
    }

    if (sourceType.kind === "null") {
      return "std::nullopt";
    }

    const innerCpp = emitType(nullableMember);
    const coercedValue = emitRuntimeCoercion(sourceExpr, sourceType, nullableMember);
    return `std::optional<${innerCpp}>{${coercedValue}}`;
  }

  if (sourceType.kind === "null") {
    return emitNullForType(targetType);
  }

  const targetMember = pickUnionTargetMember(sourceType, targetType);
  if (!targetMember) {
    return sourceExpr;
  }

  const targetCpp = emitType(targetType);
  const memberCpp = emitType(targetMember);
  const coercedValue = emitRuntimeCoercion(sourceExpr, sourceType, targetMember);
  return `${targetCpp}{std::in_place_type<${memberCpp}>, ${coercedValue}}`;
}

function getNullableUnionMember(targetType: Extract<ResolvedType, { kind: "union" }>): ResolvedType | null {
  const nonNull = targetType.types.filter((type) => type.kind !== "null");
  const hasNull = nonNull.length !== targetType.types.length;
  return hasNull && nonNull.length === 1 ? nonNull[0] : null;
}

function pickUnionTargetMember(sourceType: ResolvedType, targetType: Extract<ResolvedType, { kind: "union" }>): ResolvedType | null {
  const exactMember = targetType.types.find((memberType) => memberType.kind !== "null" && emitType(memberType) === emitType(sourceType));
  if (exactMember) {
    return exactMember;
  }

  return targetType.types.find((memberType) => memberType.kind !== "null" && isAssignableTo(sourceType, memberType)) ?? null;
}