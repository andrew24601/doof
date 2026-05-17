/**
 * C++ JSON serialization code generation — toJsonObject / fromJsonValue methods.
 *
 * Generates doof::JsonValue-based serialization and deserialization code
 * for classes, interface variant types, and discriminated class-union aliases. Handles nested classes, arrays,
 * tuples, enums, nullable types, and const discriminator fields.
 */

import type { AnalysisResult } from "./analyzer.js";
import type { ClassDeclaration, InterfaceDeclaration, Statement } from "./ast.js";
import { isJsonValueType, type ResolvedType } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import { indent, emitIdentifierSafe } from "./emitter-expr.js";
import { emitClassCppName, emitEnumHelperName, emitType } from "./emitter-types.js";
import type { ClassSymbol } from "./types.js";

// ============================================================================
// On-demand JSON propagation
// ============================================================================

/**
 * Transitively propagate `needsJson` flags across the project.
 *
 * After the checker marks classes/interfaces where user code accesses
 * `.toJsonObject()` / `.fromJsonValue()`, this function:
 *   1. Marks all implementing classes of a `needsJson` interface
 *   2. Recursively marks all class types referenced by fields of
 *      `needsJson` classes (so nested serialization works)
 *
 * Must be called once before any emission begins.
 */
export function propagateJsonDemand(analysisResult: AnalysisResult): void {
  const classDecls = new Map<string, ClassDeclaration[]>();
  const ifaceDecls = new Map<string, InterfaceDeclaration>();
  const ifaceImpls = new Map<string, ClassDeclaration[]>();

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      const decl = unwrapExport(stmt);
      if (decl.kind === "class-declaration") {
        const list = classDecls.get(decl.name) ?? [];
        list.push(decl);
        classDecls.set(decl.name, list);
        for (const iface of decl.implements_) {
          const impls = ifaceImpls.get(iface.name) ?? [];
          impls.push(decl);
          ifaceImpls.set(iface.name, impls);
        }
      } else if (decl.kind === "interface-declaration") {
        ifaceDecls.set(decl.name, decl);
      }
    }
  }

  for (const [ifaceName, ifaceDecl] of ifaceDecls) {
    if (!ifaceDecl.needsJson) continue;
    const impls = ifaceImpls.get(ifaceName);
    if (!impls) continue;
    for (const cls of impls) {
      cls.needsJson = true;
    }
  }

  const visited = new Set<string>();
  const worklist: ClassDeclaration[] = [];

  for (const [, decls] of classDecls) {
    for (const decl of decls) {
      if (decl.needsJson) {
        worklist.push(decl);
      }
    }
  }

  while (worklist.length > 0) {
    const cls = worklist.pop()!;
    if (visited.has(cls.name)) continue;
    visited.add(cls.name);

    for (const field of cls.fields) {
      if (!field.resolvedType) continue;
      markReferencedClasses(field.resolvedType, classDecls, worklist);
    }
  }
}

/** Recursively find class types within a ResolvedType and add them to the worklist. */
export function markReferencedClasses(
  type: ResolvedType,
  classDecls: Map<string, ClassDeclaration[]>,
  worklist: ClassDeclaration[],
): void {
  if (isJsonValueType(type)) {
    return;
  }

  switch (type.kind) {
    case "class": {
      const decls = classDecls.get(type.symbol.name);
      if (decls) {
        for (const decl of decls) {
          if (!decl.needsJson) {
            decl.needsJson = true;
            worklist.push(decl);
          }
        }
      }
      break;
    }
    case "array":
      markReferencedClasses(type.elementType, classDecls, worklist);
      break;
    case "tuple":
      for (const element of type.elements) {
        markReferencedClasses(element, classDecls, worklist);
      }
      break;
    case "union":
      for (const inner of type.types) {
        markReferencedClasses(inner, classDecls, worklist);
      }
      break;
    case "result":
      markReferencedClasses(type.successType, classDecls, worklist);
      break;
  }
}

/** Unwrap export-declaration to get the inner declaration. */
function unwrapExport(stmt: Statement): Statement {
  return stmt.kind === "export-declaration" ? stmt.declaration : stmt;
}

// ============================================================================
// Serialize / Deserialize expression helpers
// ============================================================================

/**
 * Emit C++ code that serializes a value of the given ResolvedType to
 * a doof::JsonValue. Returns a C++ expression string.
 */
export function emitSerializeExpr(fieldExpr: string, type: ResolvedType): string {
  if (isJsonValueType(type)) {
    return fieldExpr;
  }

  switch (type.kind) {
    case "primitive":
      if (type.name === "char") {
        return `doof::json_value(std::string(1, static_cast<char>(${fieldExpr})))`;
      }
      if (type.name === "byte") {
        return `doof::json_value(static_cast<int32_t>(${fieldExpr}))`;
      }
      return `doof::json_value(${fieldExpr})`;

    case "class":
      return `doof::json_value(${fieldExpr}->toJsonObject())`;

    case "array":
      return `[&]() { auto _arr = std::make_shared<std::vector<doof::JsonValue>>(); _arr->reserve(${fieldExpr}->size()); for (const auto& _el : *${fieldExpr}) { _arr->push_back(${emitSerializeExpr("_el", type.elementType)}); } return doof::json_value(_arr); }()`;

    case "tuple": {
      const parts = type.elements.map((element, index) =>
        emitSerializeExpr(`std::get<${index}>(${fieldExpr})`, element),
      );
      return `doof::json_value(std::make_shared<std::vector<doof::JsonValue>>(std::initializer_list<doof::JsonValue>{${parts.join(", ")}}))`;
    }

    case "enum":
      return `doof::json_value(${emitEnumHelperName(type, "_name")}(${fieldExpr}))`;

    case "null":
      return "doof::json_value(nullptr)";

    case "union": {
      const nonNull = type.types.filter((inner) => inner.kind !== "null");
      const hasNull = type.types.some((inner) => inner.kind === "null");
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (inner.kind === "class") {
          return `(${fieldExpr} ? ${emitSerializeExpr(fieldExpr, inner)} : doof::json_value(nullptr))`;
        }
        return `(${fieldExpr}.has_value() ? ${emitSerializeExpr(`${fieldExpr}.value()`, inner)} : doof::json_value(nullptr))`;
      }
      throw new Error("General union JSON serialization is not supported");
    }

    default:
      throw new Error(`Unsupported JSON serialization type "${type.kind}"`);
  }
}

/**
 * Emit C++ code that deserializes a doof::JsonValue into the
 * given ResolvedType. `jsonExpr` is a C++ expression of type doof::JsonValue.
 * Returns a C++ expression string that produces the target type.
 */
export function emitDeserializeExpr(
  jsonExpr: string,
  type: ResolvedType,
  ctx: EmitContext,
  lenientExpr = "false",
): string {
  if (isJsonValueType(type)) {
    return jsonExpr;
  }

  switch (type.kind) {
    case "primitive":
      switch (type.name) {
        case "byte": return `static_cast<uint8_t>((${lenientExpr}) ? doof::json_as_int_lenient(${jsonExpr}) : doof::json_as_int(${jsonExpr}))`;
        case "int": return `((${lenientExpr}) ? doof::json_as_int_lenient(${jsonExpr}) : doof::json_as_int(${jsonExpr}))`;
        case "long": return `((${lenientExpr}) ? doof::json_as_long_lenient(${jsonExpr}) : doof::json_as_long(${jsonExpr}))`;
        case "float": return `((${lenientExpr}) ? doof::json_as_float_lenient(${jsonExpr}) : doof::json_as_float(${jsonExpr}))`;
        case "double": return `((${lenientExpr}) ? doof::json_as_double_lenient(${jsonExpr}) : doof::json_as_double(${jsonExpr}))`;
        case "string": return `((${lenientExpr}) ? doof::json_as_string_lenient(${jsonExpr}) : doof::json_as_string(${jsonExpr}))`;
        case "char": return `static_cast<char32_t>(doof::json_as_string(${jsonExpr})[0])`;
        case "bool": return `((${lenientExpr}) ? doof::json_as_bool_lenient(${jsonExpr}) : doof::json_as_bool(${jsonExpr}))`;
      }
      throw new Error("Unsupported primitive JSON deserialization type");

    case "class":
      return `${emitClassCppName(type.symbol, ctx.module.path)}::fromJsonValue(${jsonExpr}, ${lenientExpr}).value()`;

    case "array": {
      const elementType = emitType(type.elementType, ctx.module.path);
      return `[&]() { const auto* _arr = doof::json_as_array(${jsonExpr}); if (_arr == nullptr) { doof::panic("Expected JSON array"); } auto _vec = std::make_shared<std::vector<${elementType}>>(); _vec->reserve(_arr->size()); for (const auto& _el : *_arr) { _vec->push_back(${emitDeserializeExpr("_el", type.elementType, ctx, lenientExpr)}); } return _vec; }()`;
    }

    case "tuple": {
      const parts = type.elements.map((element, index) =>
        emitDeserializeExpr(`(*_arr)[${index}]`, element, ctx, lenientExpr),
      );
      return `[&]() { const auto* _arr = doof::json_as_array(${jsonExpr}); if (_arr == nullptr) { doof::panic("Expected JSON array"); } return std::make_tuple(${parts.join(", ")}); }()`;
    }

    case "enum":
      return `${emitEnumHelperName(type, "_fromName")}(doof::json_as_string(${jsonExpr})).value()`;

    case "null":
      return "nullptr";

    case "union": {
      const nonNull = type.types.filter((inner) => inner.kind !== "null");
      const hasNull = type.types.some((inner) => inner.kind === "null");
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (inner.kind === "class") {
          return `(doof::json_is_null(${jsonExpr}) ? ${emitType(type, ctx.module.path)}{nullptr} : ${emitDeserializeExpr(jsonExpr, inner, ctx, lenientExpr)})`;
        }
        return `(doof::json_is_null(${jsonExpr}) ? ${emitType(type, ctx.module.path)}{std::nullopt} : ${emitType(type, ctx.module.path)}{${emitDeserializeExpr(jsonExpr, inner, ctx, lenientExpr)}})`;
      }
      throw new Error("General union JSON deserialization is not supported");
    }

    default:
      throw new Error(`Unsupported JSON deserialization type "${type.kind}"`);
  }
}

// ============================================================================
// JSON type checking and naming
// ============================================================================

/** Emit the expected JsonValue type check for a field type. */
export function emitJsonTypeCheck(jsonExpr: string, type: ResolvedType, lenientExpr = "false"): string {
  if (isJsonValueType(type)) {
    return "true";
  }

  switch (type.kind) {
    case "primitive":
      switch (type.name) {
        case "byte":
        case "int":
        case "long":
        case "float":
        case "double":
          return `((${lenientExpr}) ? doof::json_is_lenient_number(${jsonExpr}) : doof::json_is_number(${jsonExpr}))`;
        case "string":
          return `((${lenientExpr}) ? doof::json_is_lenient_string(${jsonExpr}) : doof::json_is_string(${jsonExpr}))`;
        case "char":
          return `doof::json_is_string(${jsonExpr})`;
        case "bool":
          return `((${lenientExpr}) ? doof::json_is_lenient_boolean(${jsonExpr}) : doof::json_is_boolean(${jsonExpr}))`;
      }
      return "true";
    case "class":
      return `doof::json_is_object(${jsonExpr})`;
    case "array":
    case "tuple":
      return `doof::json_is_array(${jsonExpr})`;
    case "enum":
      return `doof::json_is_string(${jsonExpr})`;
    case "null":
      return `doof::json_is_null(${jsonExpr})`;
    case "union": {
      const nonNull = type.types.filter((inner) => inner.kind !== "null");
      const hasNull = type.types.some((inner) => inner.kind === "null");
      if (hasNull && nonNull.length === 1) {
        return `(doof::json_is_null(${jsonExpr}) || ${emitJsonTypeCheck(jsonExpr, nonNull[0], lenientExpr)})`;
      }
      return "true";
    }
    default:
      return "true";
  }
}

/** Descriptive name for a JSON type, used in error messages. */
export function jsonTypeName(type: ResolvedType): string {
  if (isJsonValueType(type)) {
    return "json";
  }

  switch (type.kind) {
    case "primitive":
      switch (type.name) {
        case "byte":
        case "int":
        case "long":
        case "float":
        case "double":
          return "number";
        case "string":
        case "char":
          return "string";
        case "bool":
          return "boolean";
      }
      return "value";
    case "class":
      return "object";
    case "array":
    case "tuple":
      return "array";
    case "enum":
      return "string";
    case "null":
      return "null";
    default:
      return "value";
  }
}

// ============================================================================
// toJsonObject / fromJsonValue method generation
// ============================================================================

/** Generate toJsonObject() for a class. */
export function emitToJSON(
  decl: ClassDeclaration,
  _cppName: string,
  ctx: EmitContext,
): void {
  const memberInd = indent({ indent: ctx.indent + 1 });
  const bodyInd = indent({ indent: ctx.indent + 2 });

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}doof::JsonObject toJsonObject() const {`);
  ctx.sourceLines.push(`${bodyInd}auto _j = std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>();`);

  for (const field of decl.fields) {
    if (field.static_) continue;
    const fieldType = field.resolvedType;
    if (!fieldType) continue;

    for (const fieldName of field.names) {
      const safeName = emitIdentifierSafe(fieldName);
      const fieldExpr = field.const_ ? safeName : `this->${safeName}`;
      ctx.sourceLines.push(
        `${bodyInd}(*_j)["${fieldName}"] = ${emitSerializeExpr(fieldExpr, fieldType)};`,
      );
    }
  }

  ctx.sourceLines.push(`${bodyInd}return _j;`);
  ctx.sourceLines.push(`${memberInd}}`);
}

/** Generate fromJsonValue() for a class. */
export function emitFromJSON(
  decl: ClassDeclaration,
  cppName: string,
  ctx: EmitContext,
): void {
  const memberInd = indent({ indent: ctx.indent + 1 });
  const bodyInd = indent({ indent: ctx.indent + 2 });
  const resultType = `doof::Result<std::shared_ptr<${cppName}>, std::string>`;

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}static ${resultType} fromJsonValue(const doof::JsonValue& _j, bool _lenient = false) {`);
  ctx.sourceLines.push(`${bodyInd}const auto* _obj = doof::json_as_object(_j);`);
  ctx.sourceLines.push(`${bodyInd}if (_obj == nullptr) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Expected JSON object");`);
  ctx.sourceLines.push(`${bodyInd}}`);

  const constructorFields = decl.fields
    .filter((field) => !field.const_ && !field.static_)
    .flatMap((field) => field.names.map((name) => ({ name, field })));

  for (const constructorField of constructorFields) {
    const fieldType = constructorField.field.resolvedType;
    if (!fieldType) continue;

    const safeName = emitIdentifierSafe(constructorField.name);
    const iterName = `_it_${safeName}`;
    if (constructorField.field.defaultValue) {
      const defaultValue = emitDefaultExpression(constructorField.field.defaultValue, fieldType, ctx.module.path);
      ctx.sourceLines.push(`${bodyInd}${emitType(fieldType, ctx.module.path)} _f_${safeName};`);
      ctx.sourceLines.push(`${bodyInd}if (auto ${iterName} = _obj->find("${constructorField.name}"); ${iterName} != _obj->end()) {`);
      ctx.sourceLines.push(`${bodyInd}    if (!${emitJsonTypeCheck(`${iterName}->second`, fieldType, "_lenient")}) {`);
      ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure("Field \\"${constructorField.name}\\" expected ${jsonTypeName(fieldType)} but got " + std::string(doof::json_type_name(${iterName}->second)));`);
      ctx.sourceLines.push(`${bodyInd}    }`);
      ctx.sourceLines.push(`${bodyInd}    _f_${safeName} = ${emitDeserializeExpr(`${iterName}->second`, fieldType, ctx, "_lenient")};`);
      ctx.sourceLines.push(`${bodyInd}} else {`);
      ctx.sourceLines.push(`${bodyInd}    _f_${safeName} = ${defaultValue};`);
      ctx.sourceLines.push(`${bodyInd}}`);
      continue;
    }

    ctx.sourceLines.push(`${bodyInd}auto ${iterName} = _obj->find("${constructorField.name}");`);
    ctx.sourceLines.push(`${bodyInd}if (${iterName} == _obj->end()) {`);
    ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Missing required field \\"${constructorField.name}\\"");`);
    ctx.sourceLines.push(`${bodyInd}}`);
    ctx.sourceLines.push(`${bodyInd}if (!${emitJsonTypeCheck(`${iterName}->second`, fieldType, "_lenient")}) {`);
    ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Field \\"${constructorField.name}\\" expected ${jsonTypeName(fieldType)} but got " + std::string(doof::json_type_name(${iterName}->second)));`);
    ctx.sourceLines.push(`${bodyInd}}`);
    ctx.sourceLines.push(`${bodyInd}auto _f_${safeName} = ${emitDeserializeExpr(`${iterName}->second`, fieldType, ctx, "_lenient")};`);
  }

  for (const field of decl.fields) {
    if (!field.const_ || !field.defaultValue) continue;
    for (const fieldName of field.names) {
      const iterName = `_it_${emitIdentifierSafe(fieldName)}_const`;
      if (field.defaultValue.kind === "string-literal") {
        const constValue = field.defaultValue.parts
          .filter((part): part is string => typeof part === "string")
          .join("");
        ctx.sourceLines.push(`${bodyInd}if (auto ${iterName} = _obj->find("${fieldName}"); ${iterName} != _obj->end()) {`);
        ctx.sourceLines.push(`${bodyInd}    if (doof::json_is_string(${iterName}->second) && doof::json_as_string(${iterName}->second) != "${constValue}") {`);
        ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure("Field \\"${fieldName}\\" must be \\"${constValue}\\" but got \\"" + doof::json_as_string(${iterName}->second) + "\\"");`);
        ctx.sourceLines.push(`${bodyInd}    }`);
        ctx.sourceLines.push(`${bodyInd}}`);
      } else if (field.defaultValue.kind === "int-literal") {
        const constValue = (field.defaultValue as { value: number }).value;
        ctx.sourceLines.push(`${bodyInd}if (auto ${iterName} = _obj->find("${fieldName}"); ${iterName} != _obj->end()) {`);
        ctx.sourceLines.push(`${bodyInd}    if (doof::json_is_number(${iterName}->second) && doof::json_as_int(${iterName}->second) != ${constValue}) {`);
        ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure("Field \\"${fieldName}\\" must be ${constValue}");`);
        ctx.sourceLines.push(`${bodyInd}    }`);
        ctx.sourceLines.push(`${bodyInd}}`);
      }
    }
  }

  if (constructorFields.length > 0) {
    const args = constructorFields.map((field) => `_f_${emitIdentifierSafe(field.name)}`).join(", ");
    ctx.sourceLines.push(`${bodyInd}return ${resultType}::success(std::make_shared<${cppName}>(${args}));`);
  } else {
    ctx.sourceLines.push(`${bodyInd}return ${resultType}::success(std::make_shared<${cppName}>());`);
  }

  ctx.sourceLines.push(`${memberInd}}`);
}

// ============================================================================
// Interface-level fromJsonValue dispatcher
// ============================================================================

/** Generate a free-function JsonValue dispatcher for interface deserialization. */
export function emitInterfaceFromJSON(
  ifaceName: string,
  _impls: ClassSymbol[],
  disc: { fieldName: string; valueMap: Map<string, ClassSymbol> },
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const bodyInd = indent({ indent: ctx.indent + 1 });
  const resultType = `doof::Result<${ifaceName}, std::string>`;

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline ${resultType} ${ifaceName}_fromJsonValue(const doof::JsonValue& _j, bool _lenient = false) {`);
  ctx.sourceLines.push(`${bodyInd}const auto* _obj = doof::json_as_object(_j);`);
  ctx.sourceLines.push(`${bodyInd}if (_obj == nullptr) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Expected JSON object");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}auto _disc_it = _obj->find("${disc.fieldName}");`);
  ctx.sourceLines.push(`${bodyInd}if (_disc_it == _obj->end() || !doof::json_is_string(_disc_it->second)) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Missing or invalid discriminator field \\"${disc.fieldName}\\"");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}auto _disc = doof::json_as_string(_disc_it->second);`);

  let first = true;
  for (const [value, cls] of disc.valueMap.entries()) {
    const keyword = first ? "if" : "} else if";
    first = false;
    ctx.sourceLines.push(`${bodyInd}${keyword} (_disc == "${value}") {`);
    ctx.sourceLines.push(`${bodyInd}    auto _r = ${emitClassCppName(cls, ctx.module.path)}::fromJsonValue(_j, _lenient);`);
    ctx.sourceLines.push(`${bodyInd}    if (_r.isSuccess()) {`);
    ctx.sourceLines.push(`${bodyInd}        return ${resultType}::success(${ifaceName}(_r.value()));`);
    ctx.sourceLines.push(`${bodyInd}    } else {`);
    ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure(_r.error());`);
    ctx.sourceLines.push(`${bodyInd}    }`);
  }
  ctx.sourceLines.push(`${bodyInd}} else {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Unknown ${disc.fieldName}: \\"" + _disc + "\\"");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${ind}}`);
}

/** Generate a free-function JsonValue dispatcher for type alias deserialization. */
export function emitTypeAliasFromJSON(
  aliasName: string,
  disc: { fieldName: string; valueMap: Map<string, ClassSymbol> },
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const bodyInd = indent({ indent: ctx.indent + 1 });
  const resultType = `doof::Result<${aliasName}, std::string>`;

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline ${resultType} ${aliasName}_fromJsonValue(const doof::JsonValue& _j, bool _lenient = false) {`);
  ctx.sourceLines.push(`${bodyInd}const auto* _obj = doof::json_as_object(_j);`);
  ctx.sourceLines.push(`${bodyInd}if (_obj == nullptr) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Expected JSON object");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}auto _disc_it = _obj->find("${disc.fieldName}");`);
  ctx.sourceLines.push(`${bodyInd}if (_disc_it == _obj->end() || !doof::json_is_string(_disc_it->second)) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Missing or invalid discriminator field \\\"${disc.fieldName}\\\"");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}auto _disc = doof::json_as_string(_disc_it->second);`);

  let first = true;
  for (const [value, cls] of disc.valueMap.entries()) {
    const keyword = first ? "if" : "} else if";
    first = false;
    ctx.sourceLines.push(`${bodyInd}${keyword} (_disc == "${value}") {`);
    ctx.sourceLines.push(`${bodyInd}    auto _r = ${emitClassCppName(cls, ctx.module.path)}::fromJsonValue(_j, _lenient);`);
    ctx.sourceLines.push(`${bodyInd}    if (_r.isSuccess()) {`);
    ctx.sourceLines.push(`${bodyInd}        return ${resultType}::success(${aliasName}(_r.value()));`);
    ctx.sourceLines.push(`${bodyInd}    } else {`);
    ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure(_r.error());`);
    ctx.sourceLines.push(`${bodyInd}    }`);
  }
  ctx.sourceLines.push(`${bodyInd}} else {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Unknown ${disc.fieldName}: \\\"" + _disc + "\\\"");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${ind}}`);
}
