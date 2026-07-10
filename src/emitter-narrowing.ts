import type { ResolvedType } from "./checker-types.js";
import {
  getResultShape,
  makeResultType,
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
    return `std::get<${emitType(targetType, _ctx.module.path)}>(${sourceExpr})`;
  }

  if (sourceType.kind === "interface" || sourceType.kind === "union") {
    if (targetType.kind === "interface") {
      return sourceExpr;
    }
    return `std::get<${emitType(targetType, _ctx.module.path)}>(${sourceExpr})`;
  }

  return sourceExpr;
}

export function emitAsNarrowExpression(
  sourceExpr: string,
  sourceType: ResolvedType,
  resultType: ResolvedType,
  ctx: EmitContext,
): string {
  const result = getResultShape(resultType);
  if (!result) {
    throw new Error(`As narrowing must resolve to Result<T, E>, got ${resultType.kind}`);
  }

  const targetType = result.successType;
  const targetCpp = emitType(targetType);
  const resultCpp = emitType(resultType, ctx.module.path);
  const successCpp = emitType(result.successArm, ctx.module.path);
  const failureCpp = emitType(result.failureArm, ctx.module.path);

  const sourceResult = getResultShape(sourceType);
  if (sourceResult) {
    const sourceTmp = `_as_${ctx.tempCounter++}`;
    const narrowTmp = `_as_${ctx.tempCounter++}`;
    const innerResultType = makeResultType(targetType, STRING_TYPE);
    const narrowed = emitAsNarrowExpression(`doof::success_value(${sourceTmp})`, sourceResult.successType, innerResultType, ctx);
    return `[&]() -> ${resultCpp} { auto ${sourceTmp} = ${sourceExpr}; if (doof::is_failure(${sourceTmp})) return ${failureCpp}{doof::failure_error(${sourceTmp})}; auto ${narrowTmp} = ${narrowed}; if (doof::is_failure(${narrowTmp})) return ${failureCpp}{doof::failure_error(${narrowTmp})}; return ${successCpp}{doof::success_value(${narrowTmp})}; }()`;
  }

  if (typesEqual(sourceType, targetType)) {
    return `${successCpp}{${sourceExpr}}`;
  }

  const tmp = `_as_${ctx.tempCounter++}`;

  if (isNumericAsTarget(sourceType, targetType)) {
    return emitCheckedNumericAsExpression(sourceExpr, targetType, resultCpp, successCpp, failureCpp, tmp, `Narrowing from ${escapeStringForCpp(typeToString(sourceType))} to ${escapeStringForCpp(typeToString(targetType))} failed`);
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
      resultCpp, successCpp, failureCpp,
      tmp,
      failurePrefix,
    );
  }

  if (sourceType.kind === "interface" && targetType.kind === "class") {
    const classCpp = emitType(targetType, ctx.module.path);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${classCpp}>(${tmp})) return ${successCpp}{std::get<${classCpp}>(${tmp})}; return ${failureCpp}{"Narrowing from ${escapeStringForCpp(sourceType.symbol.name)} to ${escapeStringForCpp(targetType.symbol.name)} failed"}; }()`;
  }

  return `${failureCpp}{"Unsupported narrowing"}`;
}

function emitUnionNarrowExpression(
  sourceExpr: string,
  sourceType: ResolvedType,
  targetType: ResolvedType,
  resultCpp: string,
  successCpp: string,
  failureCpp: string,
  tmp: string,
  failureMessage: string,
): string {
  if (sourceType.kind !== "union") {
    return `${failureCpp}{"Unsupported narrowing"}`;
  }

  const nonNull = sourceType.types.filter((t) => t.kind !== "null");
  const hasNull = nonNull.length < sourceType.types.length;
  if (hasNull && nonNull.length === 1 && isValidUnionMemberNarrow(nonNull[0], targetType)) {
    if (typesEqual(nonNull[0], targetType) && isPointerType(targetType)) {
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}) return ${successCpp}{${tmp}}; return ${failureCpp}{"${failureMessage}: value is null"}; }()`;
    }
    if (typesEqual(nonNull[0], targetType)) {
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}.has_value()) return ${successCpp}{${tmp}.value()}; return ${failureCpp}{"${failureMessage}: value is null"}; }()`;
    }
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (!${tmp}.has_value()) return ${failureCpp}{"${failureMessage}: value is null"}; auto _checked = doof::checked_numeric_as<${emitType(targetType)}>(${tmp}.value()); if (_checked.has_value()) return ${successCpp}{_checked.value()}; return ${failureCpp}{"${failureMessage}"}; }()`;
  }

  const candidateBranches = sourceType.types
    .filter((member) => isValidUnionMemberNarrow(member, targetType))
    .map((member) => emitUnionMemberBranch(tmp, member, targetType, successCpp, failureCpp, failureMessage));

  if (candidateBranches.length === 0) {
    return `${failureCpp}{"Unsupported narrowing"}`;
  }

  return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; ${candidateBranches.join(" ")} return ${failureCpp}{"${failureMessage}"}; }()`;
}

function emitUnionMemberBranch(
  tmp: string,
  memberType: ResolvedType,
  targetType: ResolvedType,
  successCpp: string,
  failureCpp: string,
  failureMessage: string,
): string {
  const memberCpp = emitType(memberType);
  if (typesEqual(memberType, targetType)) {
    return `if (std::holds_alternative<${memberCpp}>(${tmp})) return ${successCpp}{std::get<${memberCpp}>(${tmp})};`;
  }

  const targetCpp = emitType(targetType);
  return `if (std::holds_alternative<${memberCpp}>(${tmp})) { auto _checked = doof::checked_numeric_as<${targetCpp}>(std::get<${memberCpp}>(${tmp})); if (_checked.has_value()) return ${successCpp}{_checked.value()}; return ${failureCpp}{"${failureMessage}"}; }`;
}

function emitCheckedNumericAsExpression(
  sourceExpr: string,
  targetType: ResolvedType,
  resultCpp: string,
  successCpp: string,
  failureCpp: string,
  tmp: string,
  failureMessage: string,
): string {
  return `[&]() -> ${resultCpp} { auto ${tmp} = doof::checked_numeric_as<${emitType(targetType)}>(${sourceExpr}); if (${tmp}.has_value()) return ${successCpp}{${tmp}.value()}; return ${failureCpp}{"${failureMessage}"}; }()`;
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
