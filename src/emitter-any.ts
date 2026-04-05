import type { ResolvedType } from "./checker-types.js";
import { typeToString, typesEqual } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitNullForType, emitType, isPointerType } from "./emitter-types.js";

function carrierForType(type: ResolvedType, ctx: EmitContext) {
  const carrier = ctx.anyPlan.carrierByKey.get(typeToString(type));
  if (!carrier) {
    throw new Error(`Missing doof::Any carrier for type "${typeToString(type)}"`);
  }
  return carrier;
}

function emitWrapConcreteAnyValue(valueExpr: string, sourceType: ResolvedType, ctx: EmitContext): string {
  const carrier = carrierForType(sourceType, ctx);
  if (carrier.boxed) {
    return `doof::Any{std::make_shared<${carrier.valueCppType}>(${valueExpr})}`;
  }
  return `doof::Any{${valueExpr}}`;
}

export function emitWrapAnyValue(valueExpr: string, sourceType: ResolvedType, ctx: EmitContext): string {
  switch (sourceType.kind) {
    case "any":
      return valueExpr;

    case "null":
      return "doof::Any{}";

    case "interface":
      return `std::visit([&](auto&& _v) -> doof::Any { return doof::Any{_v}; }, ${valueExpr})`;

    case "union": {
      const nonNull = sourceType.types.filter((type) => type.kind !== "null");
      const hasNull = nonNull.length !== sourceType.types.length;
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (isPointerType(inner)) {
          return `(${valueExpr} ? ${emitWrapAnyValue(valueExpr, inner, ctx)} : doof::Any{})`;
        }
        return `(${valueExpr}.has_value() ? ${emitWrapAnyValue(`${valueExpr}.value()`, inner, ctx)} : doof::Any{})`;
      }

      const branches = sourceType.types.map((member) => {
        if (member.kind === "null") {
          return "if constexpr (std::is_same_v<_T, std::monostate>) { return doof::Any{}; }";
        }
        return `if constexpr (std::is_same_v<_T, ${emitType(member)}>) { return ${emitWrapAnyValue("_v", member, ctx)}; }`;
      }).join(" else ");
      return `std::visit([&](auto&& _v) -> doof::Any { using _T = std::decay_t<decltype(_v)>; ${branches} return doof::Any{}; }, ${valueExpr})`;
    }

    default:
      return emitWrapConcreteAnyValue(valueExpr, sourceType, ctx);
  }
}

export function emitAnyTypeCheck(anyExpr: string, targetType: ResolvedType, ctx: EmitContext): string {
  switch (targetType.kind) {
    case "any":
      return "true";

    case "null":
      return `doof::any_is<std::monostate>(${anyExpr})`;

    case "interface": {
      const impls = ctx.interfaceImpls.get(targetType.symbol.name) ?? [];
      if (impls.length === 0) return "false";
      return impls
        .map((impl) => `doof::any_is<std::shared_ptr<${impl.name}>>(${anyExpr})`)
        .join(" || ");
    }

    case "union":
      return targetType.types.map((member) => emitAnyTypeCheck(anyExpr, member, ctx)).join(" || ");

    default: {
      const carrier = carrierForType(targetType, ctx);
      return `doof::any_is<${carrier.carrierCppType}>(${anyExpr})`;
    }
  }
}

export function emitExtractAnyValue(anyExpr: string, targetType: ResolvedType, ctx: EmitContext): string {
  switch (targetType.kind) {
    case "any":
      return anyExpr;

    case "interface": {
      const impls = ctx.interfaceImpls.get(targetType.symbol.name) ?? [];
      const targetCpp = emitType(targetType);
      const checks = impls.map((impl) => {
        const implCpp = `std::shared_ptr<${impl.name}>`;
        return `if (doof::any_is<${implCpp}>(${anyExpr})) return ${targetCpp}{doof::any_cast<${implCpp}>(${anyExpr})};`;
      }).join(" ");
      return `[&]() -> ${targetCpp} { ${checks} doof::panic("Invalid any cast to ${targetType.symbol.name}"); }()`;
    }

    case "union": {
      const targetCpp = emitType(targetType);
      const nonNull = targetType.types.filter((type) => type.kind !== "null");
      const hasNull = nonNull.length !== targetType.types.length;

      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (isPointerType(inner)) {
          return `(doof::any_is<std::monostate>(${anyExpr}) ? ${emitNullForType(targetType)} : ${emitExtractAnyValue(anyExpr, inner, ctx)})`;
        }
        return `(doof::any_is<std::monostate>(${anyExpr}) ? ${targetCpp}{std::nullopt} : ${targetCpp}{${emitExtractAnyValue(anyExpr, inner, ctx)}})`;
      }

      const checks = targetType.types.map((member) => {
        if (member.kind === "null") {
          return `if (doof::any_is<std::monostate>(${anyExpr})) return ${emitNullForType(targetType)};`;
        }
        return `if (${emitAnyTypeCheck(anyExpr, member, ctx)}) return ${targetCpp}{${emitExtractAnyValue(anyExpr, member, ctx)}};`;
      }).join(" ");
      return `[&]() -> ${targetCpp} { ${checks} doof::panic("Invalid any cast to union"); }()`;
    }

    default: {
      const carrier = carrierForType(targetType, ctx);
      if (carrier.boxed) {
        return `(*doof::any_cast<${carrier.carrierCppType}>(${anyExpr}))`;
      }
      return `doof::any_cast<${carrier.carrierCppType}>(${anyExpr})`;
    }
  }
}

export function emitExtractNarrowedValue(
  sourceExpr: string,
  sourceType: ResolvedType,
  targetType: ResolvedType,
  ctx: EmitContext,
): string {
  if (sourceType.kind === "any") {
    return emitExtractAnyValue(sourceExpr, targetType, ctx);
  }

  if (sourceType.kind === "interface" || sourceType.kind === "union") {
    if (targetType.kind === "interface") {
      return sourceExpr;
    }
    return `std::get<${emitType(targetType)}>(${sourceExpr})`;
  }

  return sourceExpr;
}

// ============================================================================
// As-expression — runtime narrowing yielding Result<T, string>
// ============================================================================

/**
 * Emit an `expr as T` expression as a C++ IIFE returning `doof::Result<T, string>`.
 *
 * Dispatches on source type:
 *  - Identity (T → T): unconditional success
 *  - any → T: `doof::any_is<carrier>` check
 *  - Nullable (T | null → T): `.has_value()` or pointer check
 *  - Union member (U1 | U2 → T): `std::holds_alternative<T>()`
 *  - Interface → Class: `std::holds_alternative<shared_ptr<Class>>()`
 */
export function emitAsNarrowExpression(
  sourceExpr: string,
  sourceType: ResolvedType,
  targetType: ResolvedType,
  ctx: EmitContext,
): string {
  const targetCpp = emitType(targetType);
  const resultCpp = `doof::Result<${targetCpp}, std::string>`;

  // Identity: T → T — unconditional success
  if (typesEqual(sourceType, targetType)) {
    return `${resultCpp}::success(${sourceExpr})`;
  }

  const tmp = `_as_${ctx.tempCounter++}`;

  // any → T
  if (sourceType.kind === "any") {
    const check = emitAnyTypeCheck(tmp, targetType, ctx);
    const extract = emitExtractAnyValue(tmp, targetType, ctx);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${check}) return ${resultCpp}::success(${extract}); return ${resultCpp}::failure("Narrowing from any to ${escapeStringForCpp(typeToString(targetType))} failed"); }()`;
  }

  // Nullable: T | null → T
  if (sourceType.kind === "union") {
    const nonNull = sourceType.types.filter((t) => t.kind !== "null");
    const hasNull = nonNull.length < sourceType.types.length;
    if (hasNull && nonNull.length === 1 && typesEqual(nonNull[0], targetType)) {
      const sourceCpp = emitType(sourceType);
      if (isPointerType(targetType)) {
        return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}) return ${resultCpp}::success(${tmp}); return ${resultCpp}::failure("Narrowing from nullable to ${escapeStringForCpp(typeToString(targetType))} failed: value is null"); }()`;
      }
      return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (${tmp}.has_value()) return ${resultCpp}::success(${tmp}.value()); return ${resultCpp}::failure("Narrowing from nullable to ${escapeStringForCpp(typeToString(targetType))} failed: value is null"); }()`;
    }

    // Union member extraction: U1 | U2 → T
    const memberCpp = emitType(targetType);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${memberCpp}>(${tmp})) return ${resultCpp}::success(std::get<${memberCpp}>(${tmp})); return ${resultCpp}::failure("Narrowing from union to ${escapeStringForCpp(typeToString(targetType))} failed"); }()`;
  }

  // Interface → Class
  if (sourceType.kind === "interface" && targetType.kind === "class") {
    const classCpp = emitType(targetType);
    return `[&]() -> ${resultCpp} { auto ${tmp} = ${sourceExpr}; if (std::holds_alternative<${classCpp}>(${tmp})) return ${resultCpp}::success(std::get<${classCpp}>(${tmp})); return ${resultCpp}::failure("Narrowing from ${escapeStringForCpp(sourceType.symbol.name)} to ${escapeStringForCpp(targetType.symbol.name)} failed"); }()`;
  }

  // Fallback — shouldn't reach here if checker validated
  return `${resultCpp}::failure("Unsupported narrowing")`;
}

function escapeStringForCpp(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}