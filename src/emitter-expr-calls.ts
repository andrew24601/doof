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
import { substituteTypeParams, type FunctionResolvedParam, type ResolvedType } from "./checker-types.js";
import { emitClassCppName, emitEnumHelperName, emitNullForType, emitType, isPointerType } from "./emitter-types.js";
import { resolveConcreteGenericTypeArgs, resolveMonomorphizedFunctionName, substituteEmitType } from "./emitter-monomorphize.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression } from "./emitter-expr.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitPanicLocationArgs } from "./emitter-panic.js";
import { emitTypeAnnotation } from "./emitter-decl.js";
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

function isVoidResultType(type: ResolvedType): type is Extract<ResolvedType, { kind: "result" }> {
  return type.kind === "result" && type.successType.kind === "void";
}

function getStaticClassMethodCall(memberExpr: MemberExpression): string | null {
  if (memberExpr.object.kind !== "identifier") return null;

  const binding = memberExpr.object.resolvedBinding;
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || objectType.kind !== "class") return null;
  if (binding?.kind !== "class" && binding?.kind !== "import") return null;

  const method = objectType.symbol.declaration.methods.find(
    (m) => m.name === memberExpr.property && m.static_,
  );
  if (!method) return null;

  const className = emitClassCppName(objectType.symbol);
  return `${className}::${emitIdentifierSafe(memberExpr.property)}`;
}

function getQualifiedClassMethodCall(memberExpr: QualifiedMemberExpression): string | null {
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || objectType.kind !== "class") return null;
  const className = emitClassCppName(objectType.symbol);
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
  "println", "print", "panic", "to_string", "concat",
]);

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
): Map<string, ResolvedType> | null {
  const symbol = expr.resolvedGenericBinding?.symbol;
  if (!symbol || symbol.symbolKind !== "function" || !expr.resolvedGenericTypeArgs) {
    return null;
  }

  const typeArgs = resolveConcreteGenericTypeArgs(expr.resolvedGenericTypeArgs, ctx);
  if (!typeArgs || typeArgs.length === 0) return null;

  const decl = symbol.declaration as FunctionDeclaration;
  const map = new Map<string, ResolvedType>();
  for (let index = 0; index < decl.typeParams.length && index < typeArgs.length; index++) {
    map.set(decl.typeParams[index], typeArgs[index]);
  }
  return map;
}

function specializeFunctionParamsForGenericCall(
  params: FunctionResolvedParam[] | undefined,
  expr: CallExpression,
  ctx: EmitContext,
): FunctionResolvedParam[] | undefined {
  if (!params) return undefined;
  const substitution = buildGenericCallTypeSubstitution(expr, ctx);
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

function emitIdentifierCallByName(
  name: string,
  args: string[],
  ctx: EmitContext,
  panicSpan?: CallExpression["span"],
  genericTypeArgs?: ResolvedType[] | null,
): string {
  const joinedArgs = args.join(", ");

  if (name === "string") {
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
  if (name in NUMERIC_CAST_MAP) {
    const cppType = NUMERIC_CAST_MAP[name];
    const arg = args.length === 1 ? args[0] : "";
    return `static_cast<${cppType}>(${arg})`;
  }

  if (name === "assert") {
    if (panicSpan) {
      return `doof::assert_at(${emitPanicLocationArgs(panicSpan, ctx)}, ${joinedArgs})`;
    }
    return `doof::assert_(${joinedArgs})`;
  }
  if (name === "panic" && panicSpan) {
    return `doof::panic_at(${emitPanicLocationArgs(panicSpan, ctx)}, ${joinedArgs})`;
  }
  if (DOOF_RUNTIME_BUILTINS.has(name)) {
    return `doof::${name}(${joinedArgs})`;
  }

  const genericSuffix = genericTypeArgs && genericTypeArgs.length > 0
    ? `<${genericTypeArgs.map(emitType).join(", ")}>`
    : "";
  const externCppName = resolveExternFunctionCppName(name, ctx);
  if (externCppName) {
    return `${externCppName}${genericSuffix}(${joinedArgs})`;
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
    if (!objectType || objectType.kind !== "class") return null;
    const staticMethod = getStaticClassMethodCall(expr.callee);
    const typeArgs = methodTypeArgs.map(emitType).join(", ");
    if (staticMethod) {
      return `${staticMethod}<${typeArgs}>(${args})`;
    }
    const object = emitExpression(expr.callee.object, ctx);
    const accessor = isPointerType(objectType) ? "->" : ".";
    return `${object}${accessor}${emitIdentifierSafe(expr.resolvedGenericMethodName)}<${typeArgs}>(${args})`;
  }

  if (expr.callee.kind === "qualified-member-expression") {
    const objectType = substituteEmitType(expr.callee.object.resolvedType, ctx);
    if (!objectType || objectType.kind !== "class") return null;
    const className = emitClassCppName(objectType.symbol);
    const typeArgs = methodTypeArgs.map(emitType).join(", ");
    return `${className}::${emitIdentifierSafe(expr.resolvedGenericMethodName)}<${typeArgs}>(${args})`;
  }

  return null;
}

function emitConcreteClassName(
  type: Extract<ResolvedType, { kind: "class" }>,
): string {
  return emitResolvedClassName(type);
}

function emitResultHelperCall(
  expr: CallExpression,
  memberExpr: MemberExpression,
  objectType: Extract<ResolvedType, { kind: "result" }>,
  positionalCallValues: string[],
  ctx: EmitContext,
): string | null {
  const object = emitExpression(memberExpr.object, ctx);
  const arg0 = positionalCallValues[0] ?? "";
  const tmp = `_result_${ctx.tempCounter++}`;

  if (memberExpr.property === "map") {
    const resultType = expr.resolvedType;
    if (!resultType || resultType.kind !== "result") return null;
    const resultCppType = emitType(resultType);
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${resultCppType}::failure(std::move(${tmp}.error())); return ${resultCppType}::success(${arg0}(std::move(${tmp}.value()))); }()`;
  }

  if (memberExpr.property === "mapError") {
    const resultType = expr.resolvedType;
    if (!resultType || resultType.kind !== "result") return null;
    const resultCppType = emitType(resultType);
    if (objectType.successType.kind === "void") {
      return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${resultCppType}::failure(${arg0}(std::move(${tmp}.error()))); ${tmp}.value(); return ${resultCppType}::success(); }()`;
    }
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${resultCppType}::failure(${arg0}(std::move(${tmp}.error()))); return ${resultCppType}::success(std::move(${tmp}.value())); }()`;
  }

  if (memberExpr.property === "andThen") {
    const resultType = expr.resolvedType;
    if (!resultType || resultType.kind !== "result") return null;
    const resultCppType = emitType(resultType);
    const nextTmp = `_result_${ctx.tempCounter++}`;
    if (objectType.successType.kind === "void") {
      return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${resultCppType}::failure(std::move(${tmp}.error())); ${tmp}.value(); auto ${nextTmp} = ${arg0}(); if (${nextTmp}.isFailure()) return ${resultCppType}::failure(std::move(${nextTmp}.error())); return ${resultCppType}::success(std::move(${nextTmp}.value())); }()`;
    }
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${resultCppType}::failure(std::move(${tmp}.error())); auto ${nextTmp} = ${arg0}(std::move(${tmp}.value())); if (${nextTmp}.isFailure()) return ${resultCppType}::failure(std::move(${nextTmp}.error())); return ${resultCppType}::success(std::move(${nextTmp}.value())); }()`;
  }

  if (memberExpr.property === "orElse") {
    const resultType = expr.resolvedType;
    if (!resultType || resultType.kind !== "result") return null;
    const resultCppType = emitType(resultType);
    const nextTmp = `_result_${ctx.tempCounter++}`;
    return `[&]() -> ${resultCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) { auto ${nextTmp} = ${arg0}(std::move(${tmp}.error())); if (${nextTmp}.isFailure()) return ${resultCppType}::failure(std::move(${nextTmp}.error())); return ${resultCppType}::success(std::move(${nextTmp}.value())); } return ${resultCppType}::success(std::move(${tmp}.value())); }()`;
  }

  if (memberExpr.property === "unwrapOr") {
    const returnType = expr.resolvedType ?? objectType.successType;
    const returnCppType = emitType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${arg0}; return std::move(${tmp}.value()); }()`;
  }

  if (memberExpr.property === "unwrapOrElse") {
    const returnType = expr.resolvedType ?? objectType.successType;
    const returnCppType = emitType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${arg0}(std::move(${tmp}.error())); return std::move(${tmp}.value()); }()`;
  }

  if (memberExpr.property === "ok") {
    const returnType = expr.resolvedType;
    if (!returnType) return null;
    const returnCppType = emitType(returnType);
    const nullValue = emitNullForType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return ${nullValue}; return std::move(${tmp}.value()); }()`;
  }

  if (memberExpr.property === "err") {
    const returnType = expr.resolvedType;
    if (!returnType) return null;
    const returnCppType = emitType(returnType);
    const nullValue = emitNullForType(returnType);
    return `[&]() -> ${returnCppType} { auto ${tmp} = ${object}; if (${tmp}.isFailure()) return std::move(${tmp}.error()); return ${nullValue}; }()`;
  }

  return null;
}

export function emitCallExpression(expr: CallExpression, ctx: EmitContext): string {
  const calleeType = substituteEmitType(expr.callee.resolvedType, ctx);
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
      return `${emitIdentifierSafe(monomorphizedName)}(${args.join(", ")})`;
    }

    if (expr.callee.kind === "identifier") {
      return emitIdentifierCallByName(expr.callee.name, args, ctx, expr.span, resolveCallGenericTypeArgs(expr, ctx));
    }

    const callee = emitExpression(expr.callee, ctx);
    return `${callee}(${args.join(", ")})`;
  }

  if (hasNamedArgs && calleeType?.kind === "class") {
    const props: ObjectProperty[] = expr.args.map((arg) => ({
      kind: "object-property",
      name: arg.name!,
      value: arg.value,
      span: arg.span,
    }));
    const propMap = new Map(props.map((prop) => [prop.name, prop]));
    const classType = expr.resolvedType?.kind === "class" ? expr.resolvedType : calleeType;
    const cppName = emitConcreteClassName(classType);
    const defaultCtx: EmitContext = { ...ctx, sourceLocationSpanOverride: expr.span };
    const args = buildConstructorFieldInfoListForClassType(classType).map((field) => {
      const prop = propMap.get(field.name);
      if (prop) {
        return prop.value ? emitExpression(prop.value, ctx, field.type) : emitIdentifierSafe(prop.name);
      }
      if (field.defaultValue) {
        return emitExpression(field.defaultValue, defaultCtx, field.type);
      }
      throw new Error(`Missing constructor field "${field.name}" during call emission`);
    });
    return emitClassConstruction(cppName, classType.symbol, args);
  }

  if (expr.callee.kind === "identifier"
      && expr.callee.name === "string"
      && (!expr.callee.resolvedBinding || expr.callee.resolvedBinding.kind === "builtin")) {
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
      && (!expr.callee.resolvedBinding || expr.callee.resolvedBinding.kind === "builtin")
      && expr.callee.name in NUMERIC_CAST_MAP) {
    const cppType = NUMERIC_CAST_MAP[expr.callee.name];
    const arg = expr.args.length === 1 ? emitExpression(expr.args[0].value, ctx) : "";
    return `static_cast<${cppType}>(${arg})`;
  }

  // Build argument list, passing parameter target types for null coercion.
  const paramTypes = calleeType?.kind === "function"
    ? specializeFunctionParamsForGenericCall(calleeType.params, expr, ctx)
    : undefined;
  const positionalCallValues = buildPositionalCallValues(paramTypes, expr.args, ctx, expr.span);
  const args = positionalCallValues.join(", ");
  const explicitGenericMethodCall = emitExplicitGenericMethodCall(expr, ctx, args);

  // Positional Success(value) → doof::Result<T, E>::success(val)
  if (expr.callee.kind === "identifier" && expr.callee.name === "Success" && isUnshadowedResultCtorCall(expr, "Success")) {
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "result") {
      if (isVoidResultType(resultType)) {
        return `${emitType(resultType)}::success()`;
      }
      return `${emitType(resultType)}::success(${args})`;
    }
    const fnRet = ctx.currentFunctionReturnType;
    if (fnRet && fnRet.kind === "result") {
      if (isVoidResultType(fnRet)) {
        return `${emitType(fnRet)}::success()`;
      }
      return `${emitType(fnRet)}::success(${args})`;
    }
    throw new Error("Success() call is missing Result type context during emission");
  }

  // Positional Failure(error) → doof::Result<T, E>::failure(err)
  if (expr.callee.kind === "identifier" && expr.callee.name === "Failure" && isUnshadowedResultCtorCall(expr, "Failure")) {
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "result") {
      return `${emitType(resultType)}::failure(${args})`;
    }
    const fnRet = ctx.currentFunctionReturnType;
    if (fnRet && fnRet.kind === "result") {
      return `${emitType(fnRet)}::failure(${args})`;
    }
    throw new Error("Failure() call is missing Result type context during emission");
  }

  if (calleeType && calleeType.kind === "class") {
    // Constructor call → std::make_shared<ClassName>(args...) or extern create(...)
    const classType = expr.resolvedType?.kind === "class" ? expr.resolvedType : calleeType;
    const cppName = emitConcreteClassName(classType);
    const fieldTypes = buildFieldTypeListForClassType(classType);
    const classPositionalValues = expr.args.map((arg, index) => {
      const targetType = index < fieldTypes.length ? fieldTypes[index] : undefined;
      return emitExpression(arg.value, ctx, targetType);
    });
    const positionalArgs = buildPositionalConstructorArgList(
      classType.symbol,
      classPositionalValues,
      (defaultExpr, targetType) => emitExpression(defaultExpr, { ...ctx, sourceLocationSpanOverride: expr.span }, targetType),
    );
    return emitClassConstruction(cppName, classType.symbol, positionalArgs);
  }

  // Check if this is a method call on an interface-typed object → std::visit
  if (expr.callee.kind === "member-expression") {
    const memberExpr = expr.callee as MemberExpression;
    const objType = substituteEmitType(memberExpr.object.resolvedType, ctx);

    if (memberExpr.object.kind === "this-expression") {
      const method = emitIdentifierSafe(memberExpr.property);
      return `this->${method}(${args})`;
    }

    if (explicitGenericMethodCall) {
      return explicitGenericMethodCall;
    }

    const staticMethod = getStaticClassMethodCall(memberExpr);
    if (staticMethod) {
      return `${staticMethod}(${args})`;
    }

    // Array methods: .push() → .push_back(), .pop()/contains()/slice() → runtime helpers
    if (objType && objType.kind === "array") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "push") return `${obj}->push_back(${args})`;
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
      if (method === "charAt") return `doof::string_charAt(${obj}, ${args})`;
      if (method === "repeat") return `doof::string_repeat(${obj}, ${args})`;
    }

    // Map methods: .get(), .set(), .has(), .delete(), .keys(), .values()
    if (objType && objType.kind === "map") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "get") return `doof::map_get(${obj}, ${args}, ${locationArgs})`;
      if (method === "set") return `doof::map_index(${obj}, ${expr.args[0] ? emitExpression(expr.args[0].value, ctx) : args}, ${locationArgs}) = ${expr.args[1] ? emitExpression(expr.args[1].value, ctx) : ""}`;
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "keys") return `doof::map_keys(${obj}, ${locationArgs})`;
      if (method === "values") return `doof::map_values(${obj}, ${locationArgs})`;
    }

    if (objType && objType.kind === "set") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      const locationArgs = emitPanicLocationArgs(expr.span, ctx);
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "add") return `${obj}->insert(${args})`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "values") return `doof::set_values(${obj}, ${locationArgs})`;
    }

    if (objType && objType.kind === "result") {
      const resultHelperCall = emitResultHelperCall(expr, memberExpr, objType, positionalCallValues, ctx);
      if (resultHelperCall) return resultHelperCall;
    }

    // JSON serialization: Class.fromJsonValue(value) → Class::fromJsonValue(value) (static)
    if (objType && objType.kind === "class" && memberExpr.property === "fromJsonValue") {
      const className = emitClassCppName(objType.symbol);
      return `${className}::fromJsonValue(${args})`;
    }

    // JSON serialization: Interface.fromJsonValue(value) → Interface_fromJsonValue(value) (free function)
    if (objType && objType.kind === "interface" && memberExpr.property === "fromJsonValue") {
      return `${objType.symbol.name}_fromJsonValue(${args})`;
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

    if (objType && objType.kind === "stream") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = emitIdentifierSafe(memberExpr.property);
      if (memberExpr.property === "next" && !args) {
        return `${emitStreamNextHelperName(emitType(objType))}(${obj})`;
      }
      if (memberExpr.property === "value" && !args) {
        return `${emitStreamValueHelperName(emitType(objType))}(${obj})`;
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

    const staticMethod = getQualifiedClassMethodCall(memberExpr);
    if (staticMethod) {
      return `${staticMethod}(${args})`;
    }

    if (objType && objType.kind === "interface") {
      return emitQualifiedInterfaceStaticCall(memberExpr, args, ctx);
    }
  }

  // Map known Doof runtime builtins to doof:: namespace
  if (expr.callee.kind === "identifier") {
    if (monomorphizedName) {
      return `${emitIdentifierSafe(monomorphizedName)}(${args})`;
    }
    return emitIdentifierCallByName(
      expr.callee.name,
      positionalCallValues,
      ctx,
      expr.span,
      resolveCallGenericTypeArgs(expr, ctx),
    );
  }

  const callee = emitExpression(expr.callee, ctx);
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
  const className = emitClassCppName(objType.innerClass.symbol);

  if (method === "stop") {
    return `${obj}->stop()`;
  }

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

  // Success { value: expr } → doof::Result<T, E>::success(val)
  if (!directClassSym && expr.type === "Success" && expr.named) {
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "result") {
      if (isVoidResultType(resultType)) {
        return `${emitType(resultType)}::success()`;
      }
      const valueProp = props.find((p) => p.name === "value");
      if (!valueProp?.value) {
        throw new Error("Success { ... } is missing a value property during emission");
      }
      const val = emitExpression(valueProp.value, ctx);
      return `${emitType(resultType)}::success(${val})`;
    }
    const fnRet = ctx.currentFunctionReturnType;
    if (fnRet && fnRet.kind === "result") {
      if (isVoidResultType(fnRet)) {
        return `${emitType(fnRet)}::success()`;
      }
      const valueProp = props.find((p) => p.name === "value");
      if (!valueProp?.value) {
        throw new Error("Success { ... } is missing a value property during emission");
      }
      const val = emitExpression(valueProp.value, ctx);
      return `${emitType(fnRet)}::success(${val})`;
    }
    throw new Error("Success { ... } is missing Result type context during emission");
  }

  // Failure { error: expr } → doof::Result<T, E>::failure(err)
  if (!directClassSym && expr.type === "Failure" && expr.named) {
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const errorProp = props.find((p) => p.name === "error");
    if (!errorProp?.value) {
      throw new Error("Failure { ... } is missing an error property during emission");
    }
    const err = emitExpression(errorProp.value, ctx);
    const resultType = expr.resolvedType;
    if (resultType && resultType.kind === "result") {
      return `${emitType(resultType)}::failure(${err})`;
    }
    const fnRet = ctx.currentFunctionReturnType;
    if (fnRet && fnRet.kind === "result") {
      return `${emitType(fnRet)}::failure(${err})`;
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
    typeName = emitClassCppName(sym);
  }

  // Append generic type arguments: Box<int> → Box<int32_t>
  if (resolvedExprType?.kind === "class" && resolvedExprType.typeArgs && resolvedExprType.typeArgs.length > 0) {
    const typeArgStrs = resolvedExprType.typeArgs.map(emitType);
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  } else if (expr.typeArgs && expr.typeArgs.length > 0) {
    const typeArgStrs = expr.typeArgs.map((ta) => emitTypeAnnotation(ta, ctx));
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  }

  if (expr.named) {
    // Named construction: Type { field: value, ... }
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const propMap = new Map(props.map((prop) => [prop.name, prop]));
    const fields = resolvedExprType?.kind === "class"
      ? buildConstructorFieldInfoListForClassType(resolvedExprType)
      : buildConstructorFieldInfoList(sym);
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
    return emitClassConstruction(typeName, sym, args);
  }

  // Positional construction: Type(arg1, arg2, ...)
  const fieldTypes = resolvedExprType?.kind === "class"
    ? buildFieldTypeListForClassType(resolvedExprType)
    : buildFieldTypeList(sym);
  const args = (expr.args as Expression[]).map((a, i) => {
    const fieldType = i < fieldTypes.length ? fieldTypes[i] : undefined;
    return emitExpression(a, ctx, fieldType);
  });
  const positionalArgs = buildPositionalConstructorArgList(
    sym,
    args,
    (defaultExpr, targetType) => emitExpression(defaultExpr, { ...ctx, sourceLocationSpanOverride: expr.span }, targetType),
  );
  return emitClassConstruction(typeName, sym, positionalArgs);
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
): import("./types.js").ClassSymbol | undefined {
  const sym = ctx.module.symbols.get(expr.type);
  if (sym?.symbolKind === "class") return sym;
  const imported = ctx.module.imports.find((imp) => imp.localName === expr.type)?.symbol;
  if (imported?.symbolKind === "class") return imported;
  return undefined;
}

export function resolveClassSymbol(
  expr: ConstructExpression,
  ctx: EmitContext,
): import("./types.js").ClassSymbol | undefined {
  const direct = resolveDirectClassSymbol(expr, ctx);
  if (direct) return direct;
  if (expr.resolvedType?.kind === "class") {
    return expr.resolvedType.symbol;
  }
  return undefined;
}

function resolveFunctionParams(
  expr: ConstructExpression,
  ctx: EmitContext,
): FunctionResolvedParam[] | null {
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
