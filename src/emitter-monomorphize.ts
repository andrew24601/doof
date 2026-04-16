import type { CallExpression, FunctionDeclaration } from "./ast.js";
import { isStreamSensitiveType, substituteTypeParams, type Binding, type ResolvedType } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { mangleTypeForCppName } from "./emitter-types.js";

export function substituteEmitType(
  type: ResolvedType | undefined,
  ctx: EmitContext,
): ResolvedType | undefined {
  if (!type || !ctx.typeSubstitution || ctx.typeSubstitution.size === 0) return type;
  return substituteTypeParams(type, ctx.typeSubstitution);
}

export function functionDeclIsStreamSensitive(decl: FunctionDeclaration): boolean {
  return !!(decl.resolvedType && decl.resolvedType.kind === "function" && isStreamSensitiveType(decl.resolvedType));
}

export function buildGenericFunctionKey(
  modulePath: string,
  functionName: string,
  typeArgs: ResolvedType[],
): string {
  return `${modulePath}::${functionName}::${typeArgs.map(mangleTypeForCppName).join("__")}`;
}

export function buildGenericFunctionKeyFromBinding(
  binding: Binding | undefined,
  typeArgs: ResolvedType[] | undefined,
): string | null {
  if (!binding?.symbol || binding.symbol.symbolKind !== "function" || !typeArgs || typeArgs.length === 0) {
    return null;
  }
  return buildGenericFunctionKey(binding.symbol.module, binding.symbol.name, typeArgs);
}

export function buildMonomorphizedFunctionName(
  functionName: string,
  typeArgs: ResolvedType[],
): string {
  return `${functionName}__${typeArgs.map(mangleTypeForCppName).join("_")}`;
}

export function resolveMonomorphizedFunctionName(
  expr: CallExpression,
  ctx: EmitContext,
): string | null {
  if (!ctx.monomorphizedFunctionNames || !expr.resolvedGenericBinding || !expr.resolvedGenericTypeArgs) {
    return null;
  }
  const concreteTypeArgs = ctx.typeSubstitution
    ? expr.resolvedGenericTypeArgs.map((typeArg) => substituteTypeParams(typeArg, ctx.typeSubstitution!))
    : expr.resolvedGenericTypeArgs;
  const key = buildGenericFunctionKeyFromBinding(expr.resolvedGenericBinding, concreteTypeArgs);
  if (!key) return null;
  return ctx.monomorphizedFunctionNames.get(key) ?? null;
}

export function resolveConcreteGenericTypeArgs(
  typeArgs: ResolvedType[] | undefined,
  ctx: EmitContext,
): ResolvedType[] | undefined {
  if (!typeArgs) return undefined;
  if (!ctx.typeSubstitution || ctx.typeSubstitution.size === 0) return typeArgs;
  return typeArgs.map((typeArg) => substituteTypeParams(typeArg, ctx.typeSubstitution!));
}