import type { ResolvedType } from "./checker-types.js";
import {
  normalizeTypeForRuntime,
  STRING_TYPE,
  typeToString,
  typesEqualAtRuntime,
  typesEqual,
} from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitType, isMonostateNullable, isOptionalNullable, isPointerType } from "./emitter-types.js";

const NUMERIC_PRIMITIVE_NAMES = new Set(["byte", "int", "long", "float", "double"]);

export function emitExtractNarrowedValue(
  sourceExpr: string,
  sourceType: ResolvedType,
  targetType: ResolvedType,
  _ctx: EmitContext,
): string {
  if (isOptionalNullable(sourceType)) {
    return `${sourceExpr}.value()`;
  }

  if (isPointerType(sourceType)) {
    return sourceExpr;
  }

  if (isMonostateNullable(sourceType)) {
    return `std::get<${emitType(targetType)}>(${sourceExpr})`;
  }

  if (sourceType.kind === "interface" || sourceType.kind === "union") {
    if (targetType.kind === "interface") {
      return sourceExpr;
    }
    return `std::get<${emitType(targetType)}>(${sourceExpr})`;
  }

  return sourceExpr;
}

export function emitAsNarrowExpression(
  sourceExpr: string,
  sourceType: ResolvedType,
  resultType: ResolvedType,
  ctx: EmitContext,
): string {
  if (resultType.kind !== "result") {
    throw new Error(`As narrowing must resolve to Result<T, E>, got ${resultType.kind}`);
  }

  const targetType = resultType.successType;
  const targetCpp = emitType(targetType);
  const resultCpp = emitType(resultType);

  if (sourceType.kind === "result") {
    const sourceTmp = `_as_${ctx.tempCounter++}`;
    const narrowTmp = `_as_${ctx.tempCounter++}`;
    const innerResultType: ResolvedType = {
      kind: "result",
      successType: targetType,
      errorType: STRING_TYPE,
    };
    const narrowed = emitAsNarrowExpression(`${sourceTmp}.value()`, sourceType.successType, innerResultType, ctx);
    return `[&]() -> ${resultCpp} { auto ${sourceTmp} = ${sourceExpr}; if (${sourceTmp}.isFailure()) return ${resultCpp}::failure(${sourceTmp}.error()); auto ${narrowTmp} = ${narrowed}; if (${narrowTmp}.isFailure()) return ${resultCpp}::failure(${narrowTmp}.error()); return ${resultCpp}::success(${narrowTmp}.value()); }()`;
  }

  if (typesEqual(sourceType, targetType)) {
    return `${resultCpp}::success(${sourceExpr})`;
  }

  const tmp = `_as_${ctx.tempCounter++}`;

  if (isNumericAsTarget(sourceType, targetType)) {
    return emitCheckedNumericAsExpression(sourceExpr, targetType, resultCpp, tmp, `Narrowing from ${escapeStringForCpp(typeToString(sourceType))} to ${escapeStringForCpp(typeToString(targetType))} failed`);
  }

  if (sourceType.kind === "union") {
    const unionTarget = normalizeTypeForRuntime(targetType);
    const failurePrefix = typesEqual(sourceType, targetType)
      ? `Narrowing from ${escapeStringForCpp(typeToString(sourceType))} to ${escapeStringForCpp(typeToString(targetType))} failed`
      : `Narrowing from union to ${escapeStringForCpp(typeToString(targetType))} failed`;
    return emitUnionNarrowExpression(
      sourceExpr,
      sourceType,
      unionTarget,
      resultCpp,
      tmp,
      failurePrefix,
    );
  }

  if (sourceType.kind === "interface" && targetType.kind === "class") {
    const classCpp = emitType(targetType);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${classCpp}>(${tmp})) return ${resultCpp}::success(std::get<${classCpp}>(${tmp})); return ${resultCpp}::failure("Narrowing from ${escapeStringForCpp(sourceType.symbol.name)} to ${escapeStringForCpp(targetType.symbol.name)} failed"); }()`;
  }

  return `${resultCpp}::failure("Unsupported narrowing")`;
}

function emitUnionNarrowExpression(
  sourceExpr: string,
  sourceType: ResolvedType,
  targetType: ResolvedType,
  resultCpp: string,
  tmp: string,
  failureMessage: string,
): string {
  if (sourceType.kind !== "union") {
    return `${resultCpp}::failure("Unsupported narrowing")`;
  }

  const nonNull = sourceType.types.filter((t) => t.kind !== "null");
  const hasNull = nonNull.length < sourceType.types.length;
  if (hasNull && nonNull.length === 1 && isValidUnionMemberNarrow(nonNull[0], targetType)) {
    if (typesEqual(nonNull[0], targetType) && isPointerType(targetType)) {
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}) return ${resultCpp}::success(${tmp}); return ${resultCpp}::failure("${failureMessage}: value is null"); }()`;
    }
    if (typesEqual(nonNull[0], targetType)) {
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}.has_value()) return ${resultCpp}::success(${tmp}.value()); return ${resultCpp}::failure("${failureMessage}: value is null"); }()`;
    }
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (!${tmp}.has_value()) return ${resultCpp}::failure("${failureMessage}: value is null"); auto _checked = doof::checked_numeric_as<${emitType(targetType)}>(${tmp}.value()); if (_checked.has_value()) return ${resultCpp}::success(_checked.value()); return ${resultCpp}::failure("${failureMessage}"); }()`;
  }

  const candidateBranches = sourceType.types
    .filter((member) => isValidUnionMemberNarrow(member, targetType))
    .map((member) => emitUnionMemberBranch(tmp, member, targetType, resultCpp, failureMessage));

  if (candidateBranches.length === 0) {
    return `${resultCpp}::failure("Unsupported narrowing")`;
  }

  return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; ${candidateBranches.join(" ")} return ${resultCpp}::failure("${failureMessage}"); }()`;
}

function emitUnionMemberBranch(
  tmp: string,
  memberType: ResolvedType,
  targetType: ResolvedType,
  resultCpp: string,
  failureMessage: string,
): string {
  const memberCpp = emitType(memberType);
  if (typesEqual(memberType, targetType)) {
    return `if (std::holds_alternative<${memberCpp}>(${tmp})) return ${resultCpp}::success(std::get<${memberCpp}>(${tmp}));`;
  }

  const targetCpp = emitType(targetType);
  return `if (std::holds_alternative<${memberCpp}>(${tmp})) { auto _checked = doof::checked_numeric_as<${targetCpp}>(std::get<${memberCpp}>(${tmp})); if (_checked.has_value()) return ${resultCpp}::success(_checked.value()); return ${resultCpp}::failure("${failureMessage}"); }`;
}

function emitCheckedNumericAsExpression(
  sourceExpr: string,
  targetType: ResolvedType,
  resultCpp: string,
  tmp: string,
  failureMessage: string,
): string {
  return `[&]() -> ${resultCpp} { auto ${tmp} = doof::checked_numeric_as<${emitType(targetType)}>(${sourceExpr}); if (${tmp}.has_value()) return ${resultCpp}::success(${tmp}.value()); return ${resultCpp}::failure("${failureMessage}"); }()`;
}

function isValidUnionMemberNarrow(sourceType: ResolvedType, targetType: ResolvedType): boolean {
  return typesEqualAtRuntime(sourceType, targetType) || isNumericAsTarget(sourceType, targetType);
}

function isNumericAsTarget(sourceType: ResolvedType, targetType: ResolvedType): boolean {
  return sourceType.kind === "primitive"
    && targetType.kind === "primitive"
    && NUMERIC_PRIMITIVE_NAMES.has(sourceType.name)
    && NUMERIC_PRIMITIVE_NAMES.has(targetType.name);
}

function escapeStringForCpp(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}