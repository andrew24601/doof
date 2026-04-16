import type { ResolvedType } from "./checker-types.js";
import { typeToString, typesEqual } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitType, isMonostateNullable, isOptionalNullable, isPointerType } from "./emitter-types.js";

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
  targetType: ResolvedType,
  ctx: EmitContext,
): string {
  const targetCpp = emitType(targetType);
  const resultCpp = `doof::Result<${targetCpp}, std::string>`;

  if (typesEqual(sourceType, targetType)) {
    return `${resultCpp}::success(${sourceExpr})`;
  }

  const tmp = `_as_${ctx.tempCounter++}`;

  if (sourceType.kind === "union") {
    const nonNull = sourceType.types.filter((t) => t.kind !== "null");
    const hasNull = nonNull.length < sourceType.types.length;
    if (hasNull && nonNull.length === 1 && typesEqual(nonNull[0], targetType)) {
      if (isPointerType(targetType)) {
        return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}) return ${resultCpp}::success(${tmp}); return ${resultCpp}::failure("Narrowing from nullable to ${escapeStringForCpp(typeToString(targetType))} failed: value is null"); }()`;
      }
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}.has_value()) return ${resultCpp}::success(${tmp}.value()); return ${resultCpp}::failure("Narrowing from nullable to ${escapeStringForCpp(typeToString(targetType))} failed: value is null"); }()`;
    }

    const memberCpp = emitType(targetType);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${memberCpp}>(${tmp})) return ${resultCpp}::success(std::get<${memberCpp}>(${tmp})); return ${resultCpp}::failure("Narrowing from union to ${escapeStringForCpp(typeToString(targetType))} failed"); }()`;
  }

  if (sourceType.kind === "interface" && targetType.kind === "class") {
    const classCpp = emitType(targetType);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${classCpp}>(${tmp})) return ${resultCpp}::success(std::get<${classCpp}>(${tmp})); return ${resultCpp}::failure("Narrowing from ${escapeStringForCpp(sourceType.symbol.name)} to ${escapeStringForCpp(targetType.symbol.name)} failed"); }()`;
  }

  return `${resultCpp}::failure("Unsupported narrowing")`;
}

function escapeStringForCpp(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}