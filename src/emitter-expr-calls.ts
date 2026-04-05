/**
 * C++ call and construct expression emission — function calls, constructor calls,
 * actor method calls, builtins, and positional/named construction.
 */

import type {
  CallExpression,
  ConstructExpression,
  Expression,
  MemberExpression,
  QualifiedMemberExpression,
} from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitType } from "./emitter-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression } from "./emitter-expr.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { emitTypeAnnotation } from "./emitter-decl.js";
import {
  buildConstructorFieldInfoList,
  buildFieldTypeList,
  buildFieldTypeMap,
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

  const className = objectType.symbol.extern_?.cppName ?? objectType.symbol.name;
  return `${className}::${emitIdentifierSafe(memberExpr.property)}`;
}

function getQualifiedClassMethodCall(memberExpr: QualifiedMemberExpression): string | null {
  const objectType = memberExpr.object.resolvedType;
  if (!objectType || objectType.kind !== "class") return null;
  const className = objectType.symbol.extern_?.cppName ?? objectType.symbol.name;
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

export function emitCallExpression(expr: CallExpression, ctx: EmitContext): string {
  const calleeType = expr.callee.resolvedType;

  if (expr.callee.kind === "identifier"
      && expr.callee.name === "string"
      && (!expr.callee.resolvedBinding || expr.callee.resolvedBinding.kind === "builtin")) {
    const arg = expr.args.length === 1 ? emitExpression(expr.args[0].value, ctx) : "";
    return `doof::to_string(${arg})`;
  }

  // Numeric casts: int(x) → static_cast<int32_t>(x), float(x) → static_cast<float>(x), etc.
  const NUMERIC_CAST_MAP: Record<string, string> = {
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
  const paramTypes = calleeType?.kind === "function" ? calleeType.params : undefined;
  const args = expr.args.map((a, i) => {
    const targetType = paramTypes && i < paramTypes.length ? paramTypes[i].type : undefined;
    return emitExpression(a.value, ctx, targetType);
  }).join(", ");

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
    // Constructor call → std::make_shared<ClassName>(args...)
    const cppName = calleeType.symbol.extern_?.cppName ?? calleeType.symbol.name;
    return `std::make_shared<${cppName}>(${args})`;
  }

  // Check if this is a method call on an interface-typed object → std::visit
  if (expr.callee.kind === "member-expression") {
    const memberExpr = expr.callee as MemberExpression;
    const objType = memberExpr.object.resolvedType;

    const staticMethod = getStaticClassMethodCall(memberExpr);
    if (staticMethod) {
      return `${staticMethod}(${args})`;
    }

    // Array methods: .push() → .push_back(), .pop()/contains()/slice() → runtime helpers
    if (objType && objType.kind === "array") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      if (method === "push") return `${obj}->push_back(${args})`;
      if (method === "pop") return `doof::array_pop(${obj})`;
      if (method === "contains") return `doof::array_contains(${obj}, ${args})`;
      if (method === "slice") return `doof::array_slice(${obj}, ${args})`;
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
      if (method === "trim") return `doof::string_trim(${obj})`;
      if (method === "trimStart") return `doof::string_trimStart(${obj})`;
      if (method === "trimEnd") return `doof::string_trimEnd(${obj})`;
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
      if (method === "get") return `doof::map_get(${obj}, ${args})`;
      if (method === "set") return `doof::map_index(${obj}, ${expr.args[0] ? emitExpression(expr.args[0].value, ctx) : args}) = ${expr.args[1] ? emitExpression(expr.args[1].value, ctx) : ""}`;
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "keys") return `doof::map_keys(${obj})`;
      if (method === "values") return `doof::map_values(${obj})`;
    }

    if (objType && objType.kind === "set") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = memberExpr.property;
      if (method === "has") return `(${obj}->count(${args}) > 0)`;
      if (method === "add") return `${obj}->insert(${args})`;
      if (method === "delete") return `${obj}->erase(${args})`;
      if (method === "values") return `doof::set_values(${obj})`;
    }

    // JSON serialization: Class.fromJSON(str) → Class::fromJSON(str) (static)
    if (objType && objType.kind === "class" && memberExpr.property === "fromJSON") {
      const className = objType.symbol.extern_?.cppName ?? objType.symbol.name;
      return `${className}::fromJSON(${args})`;
    }

    // JSON serialization: Interface.fromJSON(str) → Interface_fromJSON(str) (free function)
    if (objType && objType.kind === "interface" && memberExpr.property === "fromJSON") {
      return `${objType.symbol.name}_fromJSON(${args})`;
    }

    // Enum static methods: .fromName() → EnumName_fromName(), .fromValue() → EnumName_fromValue()
    if (objType && objType.kind === "enum") {
      const enumName = objType.symbol.name;
      if (memberExpr.property === "fromName") return `${enumName}_fromName(${args})`;
      if (memberExpr.property === "fromValue") return `${enumName}_fromValue(${args})`;
    }

    if (objType && objType.kind === "builtin-namespace" && memberExpr.property === "parse") {
      if (objType.name === "JSON") {
        return `doof::JSON::parse(${args})`;
      }
      const helper = `parse_${objType.name}`;
      return `doof::${helper}(${args})`;
    }

    if (objType && objType.kind === "builtin-namespace" && objType.name === "JSON" && memberExpr.property === "stringify") {
      return `doof::JSON::stringify(${args})`;
    }

    if (objType && objType.kind === "interface") {
      const obj = emitExpression(memberExpr.object, ctx);
      const method = emitIdentifierSafe(memberExpr.property);
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
    const objType = memberExpr.object.resolvedType;

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
    const name = expr.callee.name;
    if (name === "assert") {
      return `doof::assert_(${args})`;
    }
    if (DOOF_RUNTIME_BUILTINS.has(name)) {
      return `doof::${name}(${args})`;
    }

    // Imported function → use the mapped C++ qualified name
    const externCppName = resolveExternFunctionCppName(name, ctx);
    if (externCppName) {
      return `${externCppName}(${args})`;
    }
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
  const className = objType.innerClass.symbol.name;

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
  const sym = resolveClassSymbol(expr, ctx);

  // Success { value: expr } → doof::Result<T, E>::success(val)
  if (!sym && expr.type === "Success" && expr.named) {
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
  if (!sym && expr.type === "Failure" && expr.named) {
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

  // Resolve the C++ class name and class symbol
  let typeName = emitIdentifierSafe(expr.type);
  if (sym?.extern_?.cppName) {
    typeName = sym.extern_.cppName;
  }

  // Append generic type arguments: Box<int> → Box<int32_t>
  if (expr.typeArgs && expr.typeArgs.length > 0) {
    const typeArgStrs = expr.typeArgs.map((ta) => emitTypeAnnotation(ta, ctx));
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  } else if (expr.resolvedType?.kind === "class" && expr.resolvedType.typeArgs && expr.resolvedType.typeArgs.length > 0) {
    // Fall back to resolved type args from checker
    const typeArgStrs = expr.resolvedType.typeArgs.map(emitType);
    typeName = `${typeName}<${typeArgStrs.join(", ")}>`;
  }

  if (expr.named) {
    // Named construction: Type { field: value, ... }
    const props = expr.args as import("./ast.js").ObjectProperty[];
    const propMap = new Map(props.map((prop) => [prop.name, prop]));
    const args = buildConstructorFieldInfoList(sym).map((field) => {
      const prop = propMap.get(field.name);
      if (prop) {
        return prop.value ? emitExpression(prop.value, ctx, field.type) : emitIdentifierSafe(prop.name);
      }
      if (field.defaultValue) {
        return emitExpression(field.defaultValue, ctx, field.type);
      }
      throw new Error(`Missing constructor field \"${field.name}\" during construct emission`);
    }).join(", ");
    return `std::make_shared<${typeName}>(${args})`;
  }

  // Positional construction: Type(arg1, arg2, ...)
  const fieldTypes = buildFieldTypeList(sym);
  const args = (expr.args as Expression[]).map((a, i) => {
    const fieldType = i < fieldTypes.length ? fieldTypes[i] : undefined;
    return emitExpression(a, ctx, fieldType);
  }).join(", ");
  return `std::make_shared<${typeName}>(${args})`;
}

// ============================================================================
// Construct expression helpers
// ============================================================================

/**
 * Resolve the class symbol for a construct expression.
 * Checks resolvedType first, then falls back to local module symbols.
 */
export function resolveClassSymbol(
  expr: ConstructExpression,
  ctx: EmitContext,
): import("./types.js").ClassSymbol | undefined {
  if (expr.resolvedType?.kind === "class") {
    return expr.resolvedType.symbol;
  }
  const sym = ctx.module.symbols.get(expr.type);
  if (sym?.symbolKind === "class") return sym;
  return undefined;
}

