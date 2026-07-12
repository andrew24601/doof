/**
 * C++ call and construct expression emission — function calls, constructor calls,
 * actor method calls, builtins, and positional/named construction.
 */

import type {
  CallExpression,
  ConstructExpression,
  Expression,
  ObjectProperty,
  MemberExpression,
  QualifiedMemberExpression,
  FunctionDeclaration,
} from "./ast.js";
import { getResultShape, substituteTypeParams, type Binding, type FunctionResolvedParam, type ResolvedType, type ResultShape } from "./checker-types.js";
import { emitClassCppName, emitEnumHelperName, emitNullForType, emitType, isPointerType, isVariantUnionType } from "./emitter-types.js";
import { resolveConcreteGenericTypeArgs, resolveMonomorphizedFunctionName, substituteEmitType } from "./emitter-monomorphize.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression } from "./emitter-expr.js";
import { emitRuntimeCoercion } from "./emitter-json-value.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitPanicLocationArgs } from "./emitter-panic.js";
import { emitTypeAnnotation } from "./emitter-decl.js";
import { emitQualifiedHelperName, emitQualifiedSymbolName, emitSymbolReferenceName } from "./emitter-names.js";
import {
  buildPositionalConstructorArgList,
  buildConstructorFieldInfoList,
  buildConstructorFieldInfoListForClassType,
  buildFieldTypeList,
  buildFieldTypeListForClassType,
  buildFieldTypeMap,
  emitClassConstruction,
  emitResolvedClassName,
  emitStreamNextHelperName,
  emitStreamValueHelperName,
  sortNamedArgsByFieldOrder,
} from "./emitter-expr-utils.js";

function isVoidResultType(type: ResolvedType): boolean {
  return getResultShape(type)?.successType.kind === "void";
}

function getStaticClassMethodCall(
  memberExpr: MemberExpression,
  ctx: EmitContext,
  ownerTypeOverride?: Extract<ResolvedType, { kind: "class" | "struct" }>,
): string | null {
  if (memberExpr.object.kind !== "identifier") return null;

  const binding = memberExpr.object.resolvedBinding;
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return null;
  if (binding?.kind !== "class" && binding?.kind !== "struct" && binding?.kind !== "import") return null;

  const method = objectType.symbol.declaration.methods.find(
    (m) => m.name === memberExpr.property && m.static_,
  );
  if (!method) return null;

  const ownerType = ownerTypeOverride?.symbol === objectType.symbol ? ownerTypeOverride : objectType;
  const className = emitResolvedClassName(ownerType, ctx.module.path);
  return `${className}::${emitIdentifierSafe(memberExpr.property)}`;
}

function getQualifiedClassMethodCall(
  memberExpr: QualifiedMemberExpression,
  ctx: EmitContext,
  ownerTypeOverride?: Extract<ResolvedType, { kind: "class" | "struct" }>,
): string | null {
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return null;
  const ownerType = ownerTypeOverride?.symbol === objectType.symbol ? ownerTypeOverride : objectType;
  const className = emitResolvedClassName(ownerType, ctx.module.path);
  return `${className}::${emitIdentifierSafe(memberExpr.property)}`;
}

function emitQualifiedInterfaceStaticCall(
  memberExpr: QualifiedMemberExpression,
  args: string,
  ctx: EmitContext,
): string {
  const obj = emitExpression(memberExpr.object, ctx);
  const method = emitIdentifierSafe(memberExpr.property);
  if (args) {
    return `std::visit([&](auto&& _obj) { using _doof_cls = std::remove_reference_t<decltype(*_obj)>; return _doof_cls::${method}(${args}); }, ${obj})`;
  }
  return `std::visit([](auto&& _obj) { using _doof_cls = std::remove_reference_t<decltype(*_obj)>; return _doof_cls::${method}(); }, ${obj})`;
}

// ============================================================================
// Call expressions
// ============================================================================

/** Doof runtime builtin functions that map to doof:: namespace in C++. */
const DOOF_RUNTIME_BUILTINS = new Set([
  "println", "print", "panic", "to_string", "concat", "readFile", "writeFile", "absolutePath",
]);

function isBuiltinPrimitiveBinding(binding: Binding | undefined): boolean {
  return binding?.kind === "builtin" && binding.module === "<builtin>";
}

function isBuiltinRuntimeFunctionBinding(binding: Binding | undefined): boolean {
  return binding?.kind === "function" && binding.module === "<builtin>";
}

function isUnshadowedResultCtorCall(
  expr: CallExpression,
  name: "Success" | "Failure",
): boolean {
  return expr.callee.kind === "identifier"
    && expr.callee.name === name
    && (!expr.callee.resolvedBinding || expr.callee.resolvedBinding.kind === "builtin");
}

function buildOrderedNamedCallValues(
  params: FunctionResolvedParam[],
  args: Array<{ name: string; value: Expression | null }>,
  ctx: EmitContext,
  callSiteSpan: CallExpression["span"],
): string[] {
  const argMap = new Map(args.map((arg) => [arg.name, arg]));
  const defaultCtx: EmitContext = { ...ctx, sourceLocationSpanOverride: callSiteSpan };
  return params.flatMap((param) => {
    const arg = argMap.get(param.name);
    if (arg) {
      return [arg.value ? emitExpression(arg.value, ctx, param.type) : emitIdentifierSafe(arg.name)];
    }
    if (param.defaultValue) {
      return [emitExpression(param.defaultValue, defaultCtx, param.type)];
    }
    return [];
  });
}

function buildPositionalCallValues(
  params: FunctionResolvedParam[] | undefined,
  args: Array<{ value: Expression }>,
  ctx: EmitContext,
  callSiteSpan: CallExpression["span"],
): string[] {
  const values = args.map((arg, index) => {
    const targetType = params && index < params.length ? params[index].type : undefined;
    return emitExpression(arg.value, ctx, targetType);
  });

  if (!params || args.length >= params.length) {
    return values;
  }

  const defaultCtx: EmitContext = { ...ctx, sourceLocationSpanOverride: callSiteSpan };
  for (let index = args.length; index < params.length; index++) {
    const param = params[index];
    if (!param.defaultValue) break;
    values.push(emitExpression(param.defaultValue, defaultCtx, param.type));
  }

  return values;
}

function buildGenericCallTypeSubstitution(
  expr: CallExpression,
  ctx: EmitContext,
  calleeType: Extract<ResolvedType, { kind: "function" }>,
): Map<string, ResolvedType> | null {
  if (!calleeType.typeParams || calleeType.typeParams.length === 0 || !expr.resolvedGenericTypeArgs) {
    return null;
  }

  const typeArgs = resolveConcreteGenericTypeArgs(expr.resolvedGenericTypeArgs, ctx);
  if (!typeArgs || typeArgs.length === 0) return null;

  const map = new Map<string, ResolvedType>();
  for (let index = 0; index < calleeType.typeParams.length && index < typeArgs.length; index++) {
    map.set(calleeType.typeParams[index], typeArgs[index]);
  }
  return map;
}

function specializeFunctionParamsForGenericCall(
  params: FunctionResolvedParam[] | undefined,
  expr: CallExpression,
  ctx: EmitContext,
  calleeType: Extract<ResolvedType, { kind: "function" }>,
): FunctionResolvedParam[] | undefined {
  if (!params) return undefined;
  const substitution = buildGenericCallTypeSubstitution(expr, ctx, calleeType);
  if (!substitution) return params;
  return params.map((param) => ({
    ...param,
    type: substituteTypeParams(param.type, substitution),
  }));
}

function resolveCallGenericTypeArgs(
  expr: CallExpression,
  ctx: EmitContext,
): ResolvedType[] | null {
  if (!expr.resolvedGenericTypeArgs) return null;
  return resolveConcreteGenericTypeArgs(expr.resolvedGenericTypeArgs, ctx) ?? null;
}

function resolveConstructGenericTypeArgs(
  expr: ConstructExpression,
  ctx: EmitContext,
): ResolvedType[] | null {
  if (!expr.resolvedGenericTypeArgs) return null;
  return resolveConcreteGenericTypeArgs(expr.resolvedGenericTypeArgs, ctx) ?? null;
}

function shouldUseConstructorFactory(classSym: import("./types.js").ClassSymbol | import("./types.js").StructSymbol | undefined, ctx: EmitContext): boolean {
  return !(classSym && ctx.currentClassName === classSym.name && ctx.currentMethodName === "constructor");
}

function getCurrentClassMethod(
  name: string,
  ctx: EmitContext,
): FunctionDeclaration | null {
  const currentClass = ctx.currentClassName
    ? ctx.module.symbols.get(ctx.currentClassName)
    : undefined;
  if (currentClass?.symbolKind !== "class") return null;

  const currentMethod = currentClass.declaration.methods.find((method) => method.name === ctx.currentMethodName);
  const staticContext = currentMethod?.static_ ?? false;
  return currentClass.declaration.methods.find((candidate) =>
    candidate.name === name
    && candidate.static_ === staticContext
  ) ?? null;
}

function specializeFunctionParamsForGenericConstructCall(
  params: FunctionResolvedParam[],
  expr: ConstructExpression,
  ctx: EmitContext,
): FunctionResolvedParam[] {
  const symbol = expr.resolvedGenericBinding?.symbol;
  const typeArgs = resolveConstructGenericTypeArgs(expr, ctx);
  if (!symbol || symbol.symbolKind !== "function" || !typeArgs || typeArgs.length === 0) {
    return params;
  }

  const decl = symbol.declaration as FunctionDeclaration;
  const substitution = new Map<string, ResolvedType>();
  for (let index = 0; index < decl.typeParams.length && index < typeArgs.length; index++) {
    substitution.set(decl.typeParams[index], typeArgs[index]);
  }
  return params.map((param) => ({
    ...param,
    type: substituteTypeParams(param.type, substitution),
  }));
}

function emitMonomorphizedCallName(
  name: string,
  expr: CallExpression,
): string {
  const symbol = expr.resolvedGenericBinding?.symbol;
  if (symbol?.symbolKind === "function") {
    return emitQualifiedSymbolName(symbol, name);
  }
  return emitIdentifierSafe(name);
}

function emitIdentifierCallByName(
  name: string,
  args: string[],
  ctx: EmitContext,
  panicSpan?: CallExpression["span"],
  genericTypeArgs?: ResolvedType[] | null,
  binding?: Binding,
): string {
  const joinedArgs = args.join(", ");

  if (name === "string" && isBuiltinPrimitiveBinding(binding)) {
    const arg = args.length === 1 ? args[0] : "";
    return `doof::to_string(${arg})`;
  }

  const NUMERIC_CAST_MAP: Record<string, string> = {
    byte: "uint8_t",
    int: "int32_t",
    long: "int64_t",
    float: "float",
    double: "double",
  };
  if (name in NUMERIC_CAST_MAP && isBuiltinPrimitiveBinding(binding)) {
    const cppType = NUMERIC_CAST_MAP[name];
    const arg = args.length === 1 ? args[0] : "";
    return `static_cast<${cppType}>(${arg})`;
  }

  if (name === "assert" && isBuiltinRuntimeFunctionBinding(binding)) {
    if (panicSpan) {
      return `doof::assert_at(${emitPanicLocationArgs(panicSpan, ctx)}, ${joinedArgs})`;
    }
    return `doof::assert_(${joinedArgs})`;
  }
  if (name === "panic" && panicSpan && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::panic_at(${emitPanicLocationArgs(panicSpan, ctx)}, ${joinedArgs})`;
  }
  if (name === "metricsIncrement" && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::metrics::increment_counter(${joinedArgs})`;
  }
  if (name === "metricsSnapshotPrometheus" && isBuiltinRuntimeFunctionBinding(binding)) {
    return "doof::metrics::snapshot_prometheus()";
  }
  if (name === "readFile" && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::read_file(${joinedArgs})`;
  }
  if (name === "writeFile" && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::write_file(${joinedArgs})`;
  }
  if (name === "absolutePath" && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::absolute_path(${joinedArgs})`;
  }
  if (DOOF_RUNTIME_BUILTINS.has(name) && isBuiltinRuntimeFunctionBinding(binding)) {
    return `doof::${name}(${joinedArgs})`;
  }

  const genericSuffix = genericTypeArgs && genericTypeArgs.length > 0
    ? `<${genericTypeArgs.map((typeArg) => emitType(typeArg, ctx.module.path)).join(", ")}>`
    : "";
  if (getCurrentClassMethod(name, ctx)?.static_ === false) {
    return `this->${emitIdentifierSafe(name)}${genericSuffix}(${joinedArgs})`;
  }

  const externCppName = resolveExternFunctionCppName(name, ctx);
  if (externCppName) {
    return `${externCppName}(${joinedArgs})`;
  }

  const importedSymbol = binding?.kind === "import" && binding.symbol
    ? binding.symbol
    : ctx.module.imports.find((imp) => imp.localName === name)?.symbol;
  if (importedSymbol) {
    return `${emitSymbolReferenceName(importedSymbol)}${genericSuffix}(${joinedArgs})`;
  }

  return `${emitIdentifierSafe(name)}${genericSuffix}(${joinedArgs})`;
}

function emitExplicitGenericMethodCall(
  expr: CallExpression,
  ctx: EmitContext,
  args: string,
): string | null {
  const methodTypeArgs = resolveConcreteGenericTypeArgs(expr.resolvedGenericTypeArgs, ctx);
  if (!methodTypeArgs || methodTypeArgs.length === 0 || !expr.resolvedGenericMethodName) return null;

  if (expr.callee.kind === "member-expression") {
    const objectType = substituteEmitType(expr.callee.object.resolvedType, ctx);
    if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return null;
    const staticMethod = getStaticClassMethodCall(expr.callee, ctx);
    const typeArgs = methodTypeArgs.map((typeArg) => emitType(typeArg, ctx.module.path)).join(", ");
    if (staticMethod) {
      return `${staticMethod}<${typeArgs}>(${args})`;
    }
    const object = emitExpression(expr.callee.object, ctx);
    const accessor = isPointerType(objectType) ? "->" : ".";
    return `${object}${accessor}${emitIdentifierSafe(expr.resolvedGenericMethodName)}<${typeArgs}>(${args})`;
  }

  if (expr.callee.kind === "qualified-member-expression") {
    const objectType = substituteEmitType(expr.callee.object.resolvedType, ctx);
    if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return null;
    const className = emitResolvedClassName(objectType, ctx.module.path);
    const typeArgs = methodTypeArgs.map((typeArg) => emitType(typeArg, ctx.module.path)).join(", ");
    return `${className}::${emitIdentifierSafe(expr.resolvedGenericMethodName)}<${typeArgs}>(${args})`;
  }

  return null;
}

function emitConcreteClassName(
  type: Extract<ResolvedType, { kind: "class" | "struct" }>,
  ctx: EmitContext,
): string {
  return emitResolvedClassName(type, ctx.module.path);
}

function isDirectFunctionIdentifierCall(expr: CallExpression, binding: Binding | undefined): boolean {
  if (expr.callee.kind !== "identifier") return false;
  return binding?.kind === "function"
    || binding?.kind === "builtin"
    || (binding?.kind === "import" && binding.symbol?.symbolKind === "function");
}

function isFunctionFieldCall(expr: CallExpression): boolean {
  if (expr.callee.kind !== "member-expression") return false;
  const memberExpr = expr.callee;
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || (objectType.kind !== "class" && objectType.kind !== "struct")) return false;
  return objectType.symbol.declaration.fields.some((field) =>
    field.names.includes(memberExpr.property)
    && field.resolvedType?.kind === "function"
  );
}

function isExplicitCallbackCall(expr: CallExpression): boolean {
  if (expr.callee.kind !== "member-expression") return false;
  return expr.callee.property === "call"
    && expr.callee.object.resolvedType?.kind === "function";
}

function isExplicitCallbackDispatch(expr: CallExpression): boolean {
  if (expr.callee.kind !== "member-expression") return false;
  return expr.callee.property === "dispatch"
    && expr.callee.object.resolvedType?.kind === "function";
}

function emitCallbackCall(callee: string, args: string): string {
  return `${callee}.call(${args})`;
}

function emitCallbackDispatch(callee: string, args: string): string {
  return `${callee}.dispatch(${args})`;
}

function emitCatchPanicCall(
  expr: CallExpression,
  positionalCallValues: string[],
  ctx: EmitContext,
): string | null {
  const resultType = expr.resolvedType;
  if (!resultType) return null;
  const result = getResultShape(resultType);
  if (!result) return null;
  const callback = positionalCallValues[0];
  if (!callback) return null;

  const resultCppType = emitType(resultType, ctx.module.path);
  if (isVoidResultType(resultType)) {
    return `[&]() -> ${resultCppType} { try { ${callback}.call(); return ${emitType(result.successArm, ctx.module.path)}{}; } catch (const doof::Panic& _panic) { return ${emitType(result.failureArm, ctx.module.path)}{std::string(_panic.what())}; } }()`;
  }
  return `[&]() -> ${resultCppType} { try { return ${emitType(result.successArm, ctx.module.path)}{${callback}.call()}; } catch (const doof::Panic& _panic) { return ${emitType(result.failureArm, ctx.module.path)}{std::string(_panic.what())}; } }()`;
}

function emitResultHelperCall(
  expr: CallExpression,
  memberExpr: MemberExpression,
  objectType: ResultShape,
  positionalCallValues: string[],
  ctx: EmitContext,
): string | null {
  const object = emitExpression(memberExpr.object, ctx);
  const arg0 = positionalCallValues[0] ?? "";
  const tmp = `_result_${ctx.tempCounter++}`;
  const callArg0 = (args: string) => `${arg0}.call(${args})`;
  const callbackType = expr.args[0]?.value.resolvedType;
  const callbackReturnType = callbackType?.kind === "function" ? callbackType.returnType : null;

  if (memberExpr.property === "isSuccess") {
    return `doof::is_success(${object})`;
  }

  if (memberExpr.property === "isFailure") {
    return `doof::is_failure(${object})`;
  }

  if (memberExpr.property === "map") {
    const resultType = expr.resolvedType;
    if (!resultType) return null;
    const result = getResultShape(resultType);
    if (!result) return null;
    const resultCppType = emitType(resultType, ctx.module.path);
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${emitType(result.failureArm, ctx.module.path)}{std::move(doof::failure_error(${tmp}))}; return ${emitType(result.successArm, ctx.module.path)}{${callArg0(`std::move(doof::success_value(${tmp}))`)} }; }()`;
  }

  if (memberExpr.property === "mapError") {
    const resultType = expr.resolvedType;
    if (!resultType) return null;
    const result = getResultShape(resultType);
    if (!result) return null;
    const resultCppType = emitType(resultType, ctx.module.path);
    if (objectType.successType.kind === "void") {
      return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${emitType(result.failureArm, ctx.module.path)}{${callArg0(`std::move(doof::failure_error(${tmp}))`)} }; return ${emitType(result.successArm, ctx.module.path)}{}; }()`;
    }
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${emitType(result.failureArm, ctx.module.path)}{${callArg0(`std::move(doof::failure_error(${tmp}))`)} }; return ${emitType(result.successArm, ctx.module.path)}{std::move(doof::success_value(${tmp}))}; }()`;
  }

  if (memberExpr.property === "andThen") {
    const resultType = expr.resolvedType;
    if (!resultType) return null;
    const result = getResultShape(resultType);
    if (!result) return null;
    const resultCppType = emitType(resultType, ctx.module.path);
    const nextTmp = `_result_${ctx.tempCounter++}`;
    if (objectType.successType.kind === "void") {
      const convertedNext = callbackReturnType ? emitRuntimeCoercion(nextTmp, callbackReturnType, resultType) : nextTmp;
      return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${emitType(result.failureArm, ctx.module.path)}{std::move(doof::failure_error(${tmp}))}; auto ${nextTmp} = ${arg0}.call(); return ${convertedNext}; }()`;
    }
    const convertedNext = callbackReturnType ? emitRuntimeCoercion(nextTmp, callbackReturnType, resultType) : nextTmp;
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${emitType(result.failureArm, ctx.module.path)}{std::move(doof::failure_error(${tmp}))}; auto ${nextTmp} = ${callArg0(`std::move(doof::success_value(${tmp}))`)}; return ${convertedNext}; }()`;
  }

  if (memberExpr.property === "orElse") {
    const resultType = expr.resolvedType;
    if (!resultType) return null;
    const result = getResultShape(resultType);
    if (!result) return null;
    const resultCppType = emitType(resultType, ctx.module.path);
    const nextTmp = `_result_${ctx.tempCounter++}`;
    const recoverArg = objectType.errorType.kind === "void" ? "" : `std::move(doof::failure_error(${tmp}))`;
    const convertedNext = callbackReturnType ? emitRuntimeCoercion(nextTmp, callbackReturnType, resultType) : nextTmp;
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) { auto ${nextTmp} = ${callArg0(recoverArg)}; return ${convertedNext}; } return ${emitType(result.successArm, ctx.module.path)}{std::move(doof::success_value(${tmp}))}; }()`;
  }

  if (memberExpr.property === "unwrapOr") {
    const returnType = expr.resolvedType ?? objectType.successType;
    const returnCppType = emitType(returnType, ctx.module.path);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${arg0}; return std::move(doof::success_value(${tmp})); }()`;
  }

  if (memberExpr.property === "unwrapOrElse") {
    const returnType = expr.resolvedType ?? objectType.successType;
    const returnCppType = emitType(returnType, ctx.module.path);
    const fallbackArg = objectType.errorType.kind === "void" ? "" : `std::move(doof::failure_error(${tmp}))`;
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${callArg0(fallbackArg)}; return std::move(doof::success_value(${tmp})); }()`;
  }

  if (memberExpr.property === "ok") {
    const returnType = expr.resolvedType;
    if (!returnType) return null;
    const returnCppType = emitType(returnType, ctx.module.path);
    const nullValue = emitNullForType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return ${nullValue}; return std::move(doof::success_value(${tmp})); }()`;
  }

  if (memberExpr.property === "err") {
    const returnType = expr.resolvedType;
    if (!returnType) return null;
    const returnCppType = emitType(returnType, ctx.module.path);
    const nullValue = emitNullForType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (doof::is_failure(${tmp})) return std::move(doof::failure_error(${tmp})); return ${nullValue}; }()`;
  }

  return null;
}

export function emitCallExpression(expr: CallExpression, ctx: EmitContext): string {
  const calleeType = substituteEmitType(expr.callee.resolvedType, ctx);
  const calleeBinding = expr.callee.kind === "identifier" ? expr.callee.resolvedBinding : undefined;
  const hasNamedArgs = expr.args.some((arg) => arg.name);
  const monomorphizedName = resolveMonomorphizedFunctionName(expr, ctx);

  if (hasNamedArgs && calleeType?.kind === "function") {
    const args = buildOrderedNamedCallValues(
      calleeType.params,
      expr.args.map((arg) => ({ name: arg.name!, value: arg.value })),
      ctx,
      expr.span,
    );

    if (monomorphizedName) {
      return `${emitMonomorphizedCallName(monomorphizedName, expr)}(${args.join(", ")})`;
    }

    if (expr.callee.kind === "identifier") {
      if (!isDirectFunctionIdentifierCall(expr, calleeBinding)) {
        return emitCallbackCall(emitIdentifierSafe(expr.callee.name), args.join(", "));
      }
      return emitIdentifierCallByName(expr.callee.name, args, ctx, expr.span, resolveCallGenericTypeArgs(expr, ctx), calleeBinding);
    }

    if (expr.callee.kind === "dot-shorthand" && (expr.callee.resolvedShorthandOwnerType?.kind === "class" || expr.callee.resolvedShorthandOwnerType?.kind === "struct")) {
      return `${emitExpression(expr.callee, ctx)}(${args.join(", ")})`;
    }

    if (expr.callee.kind === "member-expression") {
      const ownerTypeOverride = expr.callee.property === "constructor" && (expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct")
        ? expr.resolvedType
        : undefined;
      const staticMethod = getStaticClassMethodCall(expr.callee, ctx, ownerTypeOverride);
      if (staticMethod) {
        return `${staticMethod}(${args.join(", ")})`;
      }
    }

    if (expr.callee.kind === "qualified-member-expression") {
      const ownerTypeOverride = expr.callee.property === "constructor" && (expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct")
        ? expr.resolvedType
        : undefined;
      const staticMethod = getQualifiedClassMethodCall(expr.callee, ctx, ownerTypeOverride);
      if (staticMethod) {
        return `${staticMethod}(${args.join(", ")})`;
      }
    }

    const callee = emitExpression(expr.callee, ctx);
    if (expr.callee.kind !== "member-expression" || isFunctionFieldCall(expr) || isExplicitCallbackCall(expr)) {
      return emitCallbackCall(callee, args.join(", "));
    }
    if (isExplicitCallbackDispatch(expr)) {
      return emitCallbackDispatch(emitExpression((expr.callee as MemberExpression).object, ctx), args.join(", "));
    }
    return `${callee}(${args.join(", ")})`;
  }

  if (hasNamedArgs && (calleeType?.kind === "class" || calleeType?.kind === "struct")) {
    const props: ObjectProperty[] = expr.args.map((arg) => ({
      kind: "object-property",
      name: arg.name!,
      value: arg.value,
      span: arg.span,
    }));
    const propMap = new Map(props.map((prop) => [prop.name, prop]));
    const classType = expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct" ? expr.resolvedType : calleeType;
    const cppName = emitConcreteClassName(classType, ctx);
    const defaultCtx: EmitContext = { ...ctx, sourceLocationSpanOverride: expr.span };
    const allowFactory = shouldUseConstructorFactory(classType.symbol, ctx);
    const args = buildConstructorFieldInfoListForClassType(classType, allowFactory).map((field) => {
      const prop = propMap.get(field.name);
      if (prop) {
        return prop.value ? emitExpression(prop.value, ctx, field.type) : emitIdentifierSafe(prop.name);
      }
      if (field.defaultValue) {
        return emitExpression(field.defaultValue, defaultCtx, field.type);
      }
      throw new Error(`Missing constructor field "${field.name}" during call emission`);
    });
    return emitClassConstruction(cppName, classType.symbol, args, allowFactory);
  }

  if (expr.callee.kind === "identifier"
      && expr.callee.name === "string"
      && isBuiltinPrimitiveBinding(calleeBinding)) {
    const arg = expr.args.length === 1 ? emitExpression(expr.args[0].value, ctx) : "";
    return `doof::to_string(${arg})`;
  }

  // Numeric casts: int(x) → static_cast<int32_t>(x), float(x) → static_cast<float>(x), etc.
  const NUMERIC_CAST_MAP: Record<string, string> = {
    byte: "uint8_t",
    int: "int32_t",
    long: "int64_t",
    float: "float",
    double: "double",
  };
  if (expr.callee.kind === "identifier"
      && isBuiltinPrimitiveBinding(calleeBinding)
      && expr.callee.name in NUMERIC_CAST_MAP) {
    const cppType = NUMERIC_CAST_MAP[expr.callee.name];
    const arg = expr.args.length === 1 ? emitExpression(expr.args[0].value, ctx) : "";
    return `static_cast<${cppType}>(${arg})`;
  }

  // Build argument list, passing parameter target types for null coercion.
  const paramTypes = calleeType?.kind === "function"
    ? specializeFunctionParamsForGenericCall(calleeType.params, expr, ctx, calleeType)
    : undefined;
  const positionalCallValues = buildPositionalCallValues(
    paramTypes,
    expr.args,
    ctx,
    expr.span,
  );
  const args = positionalCallValues.join(", ");
  const explicitGenericMethodCall = emitExplicitGenericMethodCall(expr, ctx, args);

  if (isExplicitCallbackCall(expr)) {
    return emitCallbackCall(emitExpression((expr.callee as MemberExpression).object, ctx), args);
  }

  if (isExplicitCallbackDispatch(expr)) {
    return emitCallbackDispatch(emitExpression((expr.callee as MemberExpression).object, ctx), args);
  }

  // Positional intrinsic arm construction.
  if (expr.callee.kind === "identifier" && expr.callee.name === "Success" && isUnshadowedResultCtorCall(expr, "Success")) {
    const successType = expr.resolvedType;
    if (!successType || successType.kind !== "success") throw new Error("Success() is missing its intrinsic type during emission");
    if (successType.valueType.kind === "void") return `${emitType(successType, ctx.module.path)}{}`;
    const valueArg = expr.args[0] ? emitExpression(expr.args[0].value, ctx, successType.valueType) : args;
    return `${emitType(successType, ctx.module.path)}{${valueArg}}`;
  }

  // Positional intrinsic failure construction.
  if (expr.callee.kind === "identifier" && expr.callee.name === "Failure" && isUnshadowedResultCtorCall(expr, "Failure")) {
    const failureType = expr.resolvedType;
    if (!failureType || failureType.kind !== "failure") throw new Error("Failure() is missing its intrinsic type during emission");
    if (failureType.errorType.kind === "void") return `${emitType(failureType, ctx.module.path)}{}`;
    const errorArg = expr.args[0] ? emitExpression(expr.args[0].value, ctx, failureType.errorType) : args;
    return `${emitType(failureType, ctx.module.path)}{${errorArg}}`;
  }

  if (calleeType && (calleeType.kind === "class" || calleeType.kind === "struct")) {
    // Constructor call → std::make_shared<ClassName>(args...) or static constructor(...)
    const classType = getResolvedConstructionClassType(expr.resolvedType) ?? calleeType;
    const cppName = emitConcreteClassName(classType, ctx);
    const allowFactory = shouldUseConstructorFactory(classType.symbol, ctx);
    const fieldTypes = buildFieldTypeListForClassType(classType, allowFactory);
    const classPositionalValues = expr.args.map((arg, index) => {
      const targetType = index < fieldTypes.length ? fieldTypes[index] : undefined;
      return emitExpression(arg.value, ctx, targetType);
    });
    const positionalArgs = buildPositionalConstructorArgList(
      classType.symbol,
      classPositionalValues,
      (defaultExpr, targetType) => emitExpression(defaultExpr, { ...ctx, sourceLocationSpanOverride: expr.span }, targetType),
      allowFactory,
    );
    return emitClassConstruction(cppName, classType.symbol, positionalArgs, allowFactory);
  }

  // Check if this is a method call on an interface-typed object → std::visit
  if (expr.callee.kind === "member-expression") {
    const memberExpr = expr.callee as MemberExpression;
    const objType = substituteEmitType(memberExpr.object.resolvedType, ctx);

    if (calleeType?.kind === "function" && isFunctionFieldCall(expr)) {
      return emitCallbackCall(emitExpression(memberExpr, ctx), args);
    }

    if (memberExpr.object.kind === "this-expression") {
      const method = emitIdentifierSafe(memberExpr.property);
      return `this->${method}(${args})`;
    }

    if (explicitGenericMethodCall) {
      return explicitGenericMethodCall;
    }

    const constructorOwnerType = expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct"
      ? expr.resolvedType
      : calleeType?.kind === "function" && (calleeType.returnType.kind === "class" || calleeType.returnType.kind === "struct")
        ? calleeType.returnType
        : undefined;
    const ownerTypeOverride = memberExpr.property === "constructor"
      ? constructorOwnerType
      : undefined;
    const staticMethod = getStaticClassMethodCall(memberExpr, ctx, ownerTypeOverride);
    if (staticMethod) {
      return `${staticMethod}(${args})`;
    }

    // Array methods: .push() → .push_back(), .reserve() → vector::reserve(),
    // and the remaining methods → runtime helpers.
    if (objType && objType.kind === "array") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "push") return `${obj}->push_back(${args})`;
      if (method === "reserve") return `doof::array_reserve(${obj}, ${args})`;
      if (method === "pop") return `doof::array_pop(${obj})`;
      if (method === "contains") return `doof::array_contains(${obj}, ${args}, ${locationArgs})`;
      if (method === "includes") return `doof::array_contains(${obj}, ${args}, ${locationArgs})`;
      if (method === "indexOf") return `doof::array_indexOf(${obj}, ${args}, ${locationArgs})`;
      if (method === "some") return `doof::array_some(${obj}, ${args}, ${locationArgs})`;
      if (method === "every") return `doof::array_every(${obj}, ${args}, ${locationArgs})`;
      if (method === "filter") return `doof::array_filter(${obj}, ${args}, ${locationArgs})`;
      if (method === "map") return `doof::array_map(${obj}, ${args}, ${locationArgs})`;
      if (method === "slice") return `doof::array_slice(${obj}, ${args}, ${locationArgs})`;
      if (method === "buildReadonly") return `doof::array_buildReadonly(${obj}, ${locationArgs})`;
      if (method === "cloneMutable") return `doof::array_cloneMutable(${obj}, ${locationArgs})`;
    }

    // String methods
    if (objType && objType.kind === "primitive" && objType.name === "string") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "indexOf") return `doof::string_indexOf(${obj}, ${args})`;
      if (method === "contains") return `doof::string_contains(${obj}, ${args})`;
      if (method === "startsWith") return `doof::string_startsWith(${obj}, ${args})`;
      if (method === "endsWith") return `doof::string_endsWith(${obj}, ${args})`;
      if (method === "substring") return `doof::string_substring(${obj}, ${args})`;
      if (method === "slice") return `doof::string_slice(${obj}, ${args})`;
      if (method === "padStart") return `doof::string_padStart(${obj}, ${args})`;
      if (method === "trim") return `doof::string_trim(${obj})`;
      if (method === "trimStart") return `doof::string_trimStart(${obj})`;
      if (method === "trimEnd") return expr.args.length === 0
        ? `doof::string_trimEnd(${obj})`
        : `doof::string_trimEnd(${obj}, ${args})`;
      if (method === "toUpperCase") return `doof::string_toUpperCase(${obj})`;
      if (method === "toLowerCase") return `doof::string_toLowerCase(${obj})`;
      if (method === "replace") return `doof::string_replace(${obj}, ${args})`;
      if (method === "replaceAll") return `doof::string_replaceAll(${obj}, ${args})`;
      if (method === "split") return `doof::string_split(${obj}, ${args})`;
      if (method === "charAt") return `doof::string_at(${obj}, ${args}, ${locationArgs})`;
      if (method === "repeat") return `doof::string_repeat(${obj}, ${args})`;
    }

    // Map methods: .get(), .set(), .has(), .delete(), .keys(), .values(), .buildReadonly(), .cloneMutable()
    if (objType && objType.kind === "map") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "get") return `doof::map_get(${obj}, ${args}, ${locationArgs})`;
      if (method === "set") {
        const key = expr.args[0] ? emitExpression(expr.args[0].value, ctx, objType.keyType) : args;
        const value = expr.args[1] ? emitExpression(expr.args[1].value, ctx, objType.valueType) : "";
        return `doof::map_set(${obj}, ${key}, ${value}, ${locationArgs})`;
      }
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "keys") return `doof::map_keys(${obj}, ${locationArgs})`;
      if (method === "values") return `doof::map_values(${obj}, ${locationArgs})`;
      if (method === "buildReadonly") return `doof::map_buildReadonly(${obj}, ${locationArgs})`;
      if (method === "cloneMutable") return `doof::map_cloneMutable(${obj}, ${locationArgs})`;
    }

    if (objType && objType.kind === "set") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "add") return `${obj}->insert(${args})`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "values") return `doof::set_values(${obj}, ${locationArgs})`;
      if (method === "buildReadonly") return `doof::set_buildReadonly(${obj}, ${locationArgs})`;
      if (method === "cloneMutable") return `doof::set_cloneMutable(${obj}, ${locationArgs})`;
    }

    const objectResult = objType ? getResultShape(objType) : null;
    if (objectResult) {
      const resultHelperCall = emitResultHelperCall(expr, memberExpr, objectResult, positionalCallValues, ctx);
      if (resultHelperCall) return resultHelperCall;
    }

    // Generic JSON deserialization: T.fromJsonValue(value) where T is emitted
    // as the concrete value type (classes are shared_ptr<Class>).
    if (objType && objType.kind === "typevar" && memberExpr.property === "fromJsonValue") {
      return `${objType.name}::element_type::fromJsonValue(${args})`;
    }

    // JSON serialization: Class.fromJsonValue(value) → Class::fromJsonValue(value) (static)
    if (objType && (objType.kind === "class" || objType.kind === "struct") && memberExpr.property === "fromJsonValue") {
      const className = emitClassCppName(objType.symbol, ctx.module.path);
      return `${className}::fromJsonValue(${args})`;
    }

    // JSON serialization: Interface.fromJsonValue(value) → Interface_fromJsonValue(value) (free function)
    if (objType && objType.kind === "interface" && memberExpr.property === "fromJsonValue") {
      return `${emitQualifiedSymbolName(objType.symbol, `${objType.symbol.name}_fromJsonValue`)}(${args})`;
    }

    // JSON serialization: UnionAlias.fromJsonValue(value) → UnionAlias_fromJsonValue(value)
    if (memberExpr.object.kind === "identifier"
        && memberExpr.object.resolvedBinding?.symbol?.symbolKind === "type-alias"
        && memberExpr.property === "fromJsonValue") {
      const symbol = memberExpr.object.resolvedBinding.symbol;
      return `${emitQualifiedSymbolName(symbol, `${symbol.name}_fromJsonValue`)}(${args})`;
    }

    // Enum static methods: .fromName() → EnumName_fromName(), .fromValue() → EnumName_fromValue()
    if (objType && objType.kind === "enum") {
      if (memberExpr.property === "fromName") return `${emitEnumHelperName(objType, "_fromName")}(${args})`;
      if (memberExpr.property === "fromValue") return `${emitEnumHelperName(objType, "_fromValue")}(${args})`;
    }

    if (objType && objType.kind === "builtin-namespace" && memberExpr.property === "parse") {
      const helper = `parse_${objType.name}`;
      return `doof::${helper}(${args})`;
    }

    if (objType && objType.kind === "interface") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = emitIdentifierSafe(memberExpr.property);
      if (args) {
        return `std::visit([&](auto&& _obj) { return _obj->${method}(${args}); }, ${obj})`;
      }
      return `std::visit([](auto&& _obj) { return _obj->${method}(); }, ${obj})`;
    }

    if (objType && isVariantUnionType(objType)) {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = emitIdentifierSafe(memberExpr.property);
      if (expr.resolvedType?.kind === "union") {
        const resultType = emitType(expr.resolvedType, ctx.module.path);
        if (args) {
          return `std::visit([&](auto&& _obj) -> ${resultType} { return ${resultType}{_obj->${method}(${args})}; }, ${obj})`;
        }
        return `std::visit([](auto&& _obj) -> ${resultType} { return ${resultType}{_obj->${method}()}; }, ${obj})`;
      }
      if (args) {
        return `std::visit([&](auto&& _obj) { return _obj->${method}(${args}); }, ${obj})`;
      }
      return `std::visit([](auto&& _obj) { return _obj->${method}(); }, ${obj})`;
    }

    if (objType && objType.kind === "stream") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = emitIdentifierSafe(memberExpr.property);
      if (memberExpr.property === "next" && !args) {
        return `${emitQualifiedHelperName(ctx.module.path, emitStreamNextHelperName(emitType(objType, ctx.module.path)), ctx.allModules)}(${obj})`;
      }
      if (memberExpr.property === "value" && !args) {
        return `${emitQualifiedHelperName(ctx.module.path, emitStreamValueHelperName(emitType(objType, ctx.module.path)), ctx.allModules)}(${obj})`;
      }
      if (args) {
        return `std::visit([&](auto&& _obj) { return _obj->${method}(${args}); }, ${obj})`;
      }
      return `std::visit([](auto&& _obj) { return _obj->${method}(); }, ${obj})`;
    }

    // Actor method call (sync) → actor->call_sync(...)
    if (objType && objType.kind === "actor") {
      return emitActorSyncCall(expr, memberExpr, objType, args, ctx);
    }
  }

  if (expr.callee.kind === "qualified-member-expression") {
    const memberExpr = expr.callee as QualifiedMemberExpression;
    const objType = substituteEmitType(memberExpr.object.resolvedType, ctx);

    if (explicitGenericMethodCall) {
      return explicitGenericMethodCall;
    }

    const constructorOwnerType = expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct"
      ? expr.resolvedType
      : calleeType?.kind === "function" && (calleeType.returnType.kind === "class" || calleeType.returnType.kind === "struct")
        ? calleeType.returnType
        : undefined;
    const ownerTypeOverride = memberExpr.property === "constructor"
      ? constructorOwnerType
      : undefined;
    const staticMethod = getQualifiedClassMethodCall(memberExpr, ctx, ownerTypeOverride);
    if (staticMethod) {
      return `${staticMethod}(${args})`;
    }

    if (objType && objType.kind === "interface") {
      return emitQualifiedInterfaceStaticCall(memberExpr, args, ctx);
    }
  }

  if (expr.callee.kind === "dot-shorthand" && (expr.callee.resolvedShorthandOwnerType?.kind === "class" || expr.callee.resolvedShorthandOwnerType?.kind === "struct")) {
    return `${emitExpression(expr.callee, ctx)}(${args})`;
  }

  // Map known Doof runtime builtins to doof:: namespace
  if (expr.callee.kind === "identifier") {
    if (expr.callee.name === "catchPanic" && isBuiltinRuntimeFunctionBinding(calleeBinding)) {
      const catchPanicCall = emitCatchPanicCall(expr, positionalCallValues, ctx);
      if (catchPanicCall) return catchPanicCall;
    }
    if (monomorphizedName) {
      return `${emitMonomorphizedCallName(monomorphizedName, expr)}(${args})`;
    }
    if (calleeType?.kind === "function" && !isDirectFunctionIdentifierCall(expr, calleeBinding)) {
      return emitCallbackCall(emitIdentifierSafe(expr.callee.name), args);
    }
    return emitIdentifierCallByName(
      expr.callee.name,
      positionalCallValues,
      ctx,
      expr.span,
      resolveCallGenericTypeArgs(expr, ctx),
      calleeBinding,
    );
  }

  const callee = emitExpression(expr.callee, ctx);
  if (calleeType?.kind === "function" && (expr.callee.kind !== "member-expression" || isFunctionFieldCall(expr))) {
    return emitCallbackCall(callee, args);
  }
  return `${callee}(${args})`;
}

/**
 * If `name` refers to an imported C/C++ function (locally declared or re-exported),
 * return its C++ qualified name; otherwise return null.
 */
function resolveExternFunctionCppName(name: string, ctx: EmitContext): string | null {
  // Check local symbols first
  const sym = ctx.module.symbols.get(name);
  if (sym && sym.symbolKind === "function" && sym.extern_) {
    return sym.extern_.cppName ?? sym.name;
  }
  // Check imports
  for (const imp of ctx.module.imports) {
    if (imp.localName === name && imp.symbol?.symbolKind === "function" && imp.symbol.extern_) {
      return imp.symbol.extern_.cppName ?? imp.symbol.name;
    }
  }
  return null;
}

function emitActorSyncCall(
  expr: CallExpression,
  memberExpr: MemberExpression,
  objType: Extract<NonNullable<MemberExpression["object"]["resolvedType"]>, { kind: "actor" }>,
  args: string,
  ctx: EmitContext,
): string {
  const obj = emitExpression(memberExpr.object, ctx);
  const method = emitIdentifierSafe(memberExpr.property);
  const className = emitClassCppName(objType.innerClass.symbol, ctx.module.path);

  const retType = expr.resolvedType;
  const cppRetType = retType ? emitType(retType) : "void";

  if (cppRetType === "void") {
    if (args) {
      return `${obj}->template call_sync<void>([&](${className}& _self) { _self.${method}(${args}); })`;
    }
    return `${obj}->template call_sync<void>([](${className}& _self) { _self.${method}(); })`;
  }
  if (args) {
    return `${obj}->template call_sync<${cppRetType}>([&](${className}& _self) -> ${cppRetType} { return _self.${method}(${args}); })`;
  }
  return `${obj}->template call_sync<${cppRetType}>([](${className}& _self) -> ${cppRetType} { return _self.${method}(); })`;
}

// ============================================================================
// Construct expressions
// ============================================================================

export function emitConstructExpression(expr: ConstructExpression, ctx: EmitContext): string {
  const resolvedExprType = substituteEmitType(expr.resolvedType, ctx);
  const functionParams = resolveFunctionParams(expr, ctx);
  const directClassSym = resolveDirectClassSymbol(expr, ctx);

  // Named intrinsic arm construction.
  if (!directClassSym && expr.type === "Success" && expr.named) {
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "success") {
      if (resultType.valueType.kind === "void") return `${emitType(resultType, ctx.module.path)}{}`;
      const valueProp = props.find((p) => p.name === "value");
      if (!valueProp?.value) {
        throw new Error("Success { ... } is missing a value property during emission");
      }
      const val = emitExpression(valueProp.value, ctx, resultType.valueType);
      return `${emitType(resultType, ctx.module.path)}{${val}}`;
    }
    throw new Error("Success { ... } is missing Result type context during emission");
  }

  // Named intrinsic failure-arm construction.
  if (!directClassSym && expr.type === "Failure" && expr.named) {
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const errorProp = props.find((p) => p.name === "error");
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "failure") {
      if (resultType.errorType.kind === "void") return `${emitType(resultType, ctx.module.path)}{}`;
      if (!errorProp?.value) throw new Error("Failure { ... } is missing an error property during emission");
      return `${emitType(resultType, ctx.module.path)}{${emitExpression(errorProp.value, ctx, resultType.errorType)}}`;
    }
    throw new Error("Failure { ... } is missing Result type context during emission");
  }

  if (expr.named && expr.tightBraces && functionParams) {
    const params = specializeFunctionParamsForGenericConstructCall(functionParams, expr, ctx);
    const args = buildOrderedNamedCallValues(params, expr.args as ObjectProperty[], ctx, expr.span);
    return emitIdentifierCallByName(expr.type, args, ctx, expr.span, resolveConstructGenericTypeArgs(expr, ctx));
  }

  const sym = resolveClassSymbol(expr, ctx);

  // Resolve the C++ class name and class symbol
  let typeName = emitIdentifierSafe(expr.type);
  if (sym) {
    typeName = emitClassCppName(sym, ctx.module.path);
  }

  // Append generic type arguments: Box<int> → Box<int32_t>
  const constructionClassType = getResolvedConstructionClassType(resolvedExprType);
  if (constructionClassType && constructionClassType.typeArgs && constructionClassType.typeArgs.length > 0) {
    const typeArgStrs = constructionClassType.typeArgs.map((typeArg) => emitType(typeArg, ctx.module.path));
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  } else if (expr.typeArgs && expr.typeArgs.length > 0) {
    const typeArgStrs = expr.typeArgs.map((ta) => emitTypeAnnotation(ta, ctx));
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  }

  if (expr.named) {
    // Named construction: Type { field: value, ... }
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const propMap = new Map(props.map((prop) => [prop.name, prop]));
    const fields = constructionClassType
      ? buildConstructorFieldInfoListForClassType(constructionClassType, shouldUseConstructorFactory(constructionClassType.symbol, ctx))
      : buildConstructorFieldInfoList(sym, shouldUseConstructorFactory(sym, ctx));
    const defaultCtx: EmitContext = { ...ctx, sourceLocationSpanOverride: expr.span };
    const args = fields.map((field) => {
      const prop = propMap.get(field.name);
      if (prop) {
        return prop.value ? emitExpression(prop.value, ctx, field.type) : emitIdentifierSafe(prop.name);
      }
      if (field.defaultValue) {
        return emitExpression(field.defaultValue, defaultCtx, field.type);
      }
      throw new Error(`Missing constructor field \"${field.name}\" during construct emission`);
    });
    return emitClassConstruction(typeName, sym, args, shouldUseConstructorFactory(sym, ctx));
  }

  // Positional construction: Type(arg1, arg2, ...)
  const fieldTypes = constructionClassType
    ? buildFieldTypeListForClassType(constructionClassType, shouldUseConstructorFactory(constructionClassType.symbol, ctx))
    : buildFieldTypeList(sym, shouldUseConstructorFactory(sym, ctx));
  const args = (expr.args as Expression[]).map((a, i) => {
    const fieldType = i < fieldTypes.length ? fieldTypes[i] : undefined;
    return emitExpression(a, ctx, fieldType);
  });
  const positionalArgs = buildPositionalConstructorArgList(
    sym,
    args,
    (defaultExpr, targetType) => emitExpression(defaultExpr, { ...ctx, sourceLocationSpanOverride: expr.span }, targetType),
    shouldUseConstructorFactory(sym, ctx),
  );
  return emitClassConstruction(typeName, sym, positionalArgs, shouldUseConstructorFactory(sym, ctx));
}

function getResolvedConstructionClassType(type: ResolvedType | undefined): Extract<ResolvedType, { kind: "class" | "struct" }> | null {
  if (!type) return null;
  if (type.kind === "class" || type.kind === "struct") return type;
  const result = getResultShape(type);
  if (result && (result.successType.kind === "class" || result.successType.kind === "struct")) return result.successType;
  return null;
}

// ============================================================================
// Construct expression helpers
// ============================================================================

/**
 * Resolve the class symbol for a construct expression.
 * Checks resolvedType first, then falls back to local module symbols.
 */
function resolveDirectClassSymbol(
  expr: ConstructExpression,
  ctx: EmitContext,
): import("./types.js").ClassSymbol | import("./types.js").StructSymbol | undefined {
  const sym = ctx.module.symbols.get(expr.type);
  if (sym?.symbolKind === "class" || sym?.symbolKind === "struct") return sym;
  const imported = ctx.module.imports.find((imp) => imp.localName === expr.type)?.symbol;
  if (imported?.symbolKind === "class" || imported?.symbolKind === "struct") return imported;
  return undefined;
}

export function resolveClassSymbol(
  expr: ConstructExpression,
  ctx: EmitContext,
): import("./types.js").ClassSymbol | import("./types.js").StructSymbol | undefined {
  const direct = resolveDirectClassSymbol(expr, ctx);
  if (direct) return direct;
  if (expr.resolvedType?.kind === "class" || expr.resolvedType?.kind === "struct") {
    return expr.resolvedType.symbol;
  }
  return undefined;
}

function resolveFunctionParams(
  expr: ConstructExpression,
  ctx: EmitContext,
): FunctionResolvedParam[] | null {
  const currentClassMethod = getCurrentClassMethod(expr.type, ctx);
  if (currentClassMethod?.resolvedType?.kind === "function") {
    return currentClassMethod.resolvedType.params;
  }

  const local = ctx.module.symbols.get(expr.type);
  if (local?.symbolKind === "function" && local.declaration.resolvedType?.kind === "function") {
    return local.declaration.resolvedType.params;
  }

  const imported = ctx.module.imports.find((imp) => imp.localName === expr.type)?.symbol;
  if (imported?.symbolKind === "function" && imported.declaration.resolvedType?.kind === "function") {
    return imported.declaration.resolvedType.params;
  }

  if (expr.type === "string") {
    return [{ name: "value", type: { kind: "unknown" } }];
  }
  if (["byte", "int", "long", "float", "double"].includes(expr.type)) {
    return [{ name: "value", type: { kind: "unknown" } }];
  }
  if (expr.type === "assert") {
    return [
      { name: "condition", type: { kind: "primitive", name: "bool" } },
      { name: "message", type: { kind: "primitive", name: "string" } },
    ];
  }
  if (DOOF_RUNTIME_BUILTINS.has(expr.type)) {
    return [{ name: "value", type: { kind: "unknown" } }];
  }

  return null;
}
