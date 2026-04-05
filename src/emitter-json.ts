/**
 * C++ JSON serialization code generation — toJSON / fromJSON methods.
 *
 * Generates nlohmann::json-based serialization and deserialization code
 * for classes and interface variant types. Handles nested classes, arrays,
 * tuples, enums, nullable types, and const discriminator fields.
 */

import type { ClassDeclaration, Expression, InterfaceDeclaration, Statement } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import type { ClassSymbol, ModuleSymbolTable } from "./types.js";
import type { AnalysisResult } from "./analyzer.js";
import { emitType } from "./emitter-types.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import { emitExpression, indent, emitIdentifierSafe } from "./emitter-expr.js";
import type { EmitContext } from "./emitter-context.js";

// ============================================================================
// On-demand JSON propagation
// ============================================================================

/**
 * Transitively propagate `needsJson` flags across the project.
 *
 * After the checker marks classes/interfaces where user code accesses
 * `.toJSON()` / `.fromJSON()`, this function:
 *   1. Marks all implementing classes of a `needsJson` interface
 *   2. Recursively marks all class types referenced by fields of
 *      `needsJson` classes (so nested serialization works)
 *
 * Must be called once before any emission begins.
 */
export function propagateJsonDemand(analysisResult: AnalysisResult): void {
  // Build lookup: class name → ClassDeclaration AST node(s)
  const classDecls = new Map<string, ClassDeclaration[]>();
  // Build lookup: interface name → InterfaceDeclaration AST node
  const ifaceDecls = new Map<string, InterfaceDeclaration>();
  // Build lookup: interface name → implementing ClassDeclaration nodes
  const ifaceImpls = new Map<string, ClassDeclaration[]>();

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      const decl = unwrapExport(stmt);
      if (decl.kind === "class-declaration") {
        const list = classDecls.get(decl.name) ?? [];
        list.push(decl);
        classDecls.set(decl.name, list);
        // Register as implementor for each interface
        for (const ifaceName of decl.implements_) {
          const impls = ifaceImpls.get(ifaceName) ?? [];
          impls.push(decl);
          ifaceImpls.set(ifaceName, impls);
        }
      } else if (decl.kind === "interface-declaration") {
        ifaceDecls.set(decl.name, decl);
      }
    }
  }

  // Step 1: For each interface with needsJson, mark all implementing classes
  for (const [ifaceName, ifaceDecl] of ifaceDecls) {
    if (!ifaceDecl.needsJson) continue;
    const impls = ifaceImpls.get(ifaceName);
    if (!impls) continue;
    for (const cls of impls) {
      cls.needsJson = true;
    }
  }

  // Step 2: Transitively propagate through class field types
  const visited = new Set<string>();
  const worklist: ClassDeclaration[] = [];

  // Seed worklist with all classes already marked
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
  switch (type.kind) {
    case "any":
      break;
    case "json-value":
      break;
    case "class": {
      const decls = classDecls.get(type.symbol.name);
      if (decls) {
        for (const d of decls) {
          if (!d.needsJson) {
            d.needsJson = true;
            worklist.push(d);
          }
        }
      }
      break;
    }
    case "array":
      markReferencedClasses(type.elementType, classDecls, worklist);
      break;
    case "tuple":
      for (const el of type.elements) {
        markReferencedClasses(el, classDecls, worklist);
      }
      break;
    case "union":
      for (const t of type.types) {
        markReferencedClasses(t, classDecls, worklist);
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
 * an nlohmann::json value. Returns a C++ expression string.
 */
export function emitSerializeExpr(fieldExpr: string, type: ResolvedType): string {
  switch (type.kind) {
    case "any":
      throw new Error("any is not supported for JSON serialization");

    case "json-value":
      return `doof::json_to_nlohmann(${fieldExpr})`;

    case "primitive":
      if (type.name === "char") {
        // char32_t → single-char string
        return `std::string(1, static_cast<char>(${fieldExpr}))`;
      }
      return fieldExpr;

    case "class":
      // Nested class → direct json value, no serialize/reparse
      return `${fieldExpr}->toJSONValue()`;

    case "array":
      // shared_ptr<vector> → json array (element-wise)
      return `[&]() { auto _arr = nlohmann::json::array(); for (const auto& _el : *${fieldExpr}) { _arr.push_back(${emitSerializeExpr("_el", type.elementType)}); } return _arr; }()`;

    case "tuple": {
      // std::tuple → json array (element-wise with std::get)
      const parts = type.elements.map((el, i) =>
        emitSerializeExpr(`std::get<${i}>(${fieldExpr})`, el),
      );
      return `nlohmann::json::array({${parts.join(", ")}})`;
    }

    case "enum":
      // enum → string name via the _name helper
      return `${type.symbol.name}_name(${fieldExpr})`;

    case "null":
      return "nullptr";

    case "union": {
      // T | null unions
      const nonNull = type.types.filter((t) => t.kind !== "null");
      const hasNull = type.types.some((t) => t.kind === "null");
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (inner.kind === "class") {
          // shared_ptr nullable → check for null
          return `(${fieldExpr} ? ${emitSerializeExpr(fieldExpr, inner)} : nlohmann::json(nullptr))`;
        }
        // optional<T> → check has_value
        return `(${fieldExpr}.has_value() ? nlohmann::json(${emitSerializeExpr(`${fieldExpr}.value()`, inner)}) : nlohmann::json(nullptr))`;
      }
      // General union — not commonly serializable but try
      return fieldExpr;
    }

    default:
      return fieldExpr;
  }
}

/**
 * Emit C++ code that deserializes an nlohmann::json value into the
 * given ResolvedType. `jsonExpr` is a C++ expression of type nlohmann::json.
 * Returns a C++ expression string that produces the target type.
 */
export function emitDeserializeExpr(jsonExpr: string, type: ResolvedType, ctx: EmitContext): string {
  switch (type.kind) {
    case "json-value":
      return `doof::json_from_nlohmann(${jsonExpr})`;

    case "primitive":
      switch (type.name) {
        case "int": return `${jsonExpr}.get<int32_t>()`;
        case "long": return `${jsonExpr}.get<int64_t>()`;
        case "float": return `${jsonExpr}.get<float>()`;
        case "double": return `${jsonExpr}.get<double>()`;
        case "string": return `${jsonExpr}.get<std::string>()`;
        case "char": return `static_cast<char32_t>(${jsonExpr}.get<std::string>()[0])`;
        case "bool": return `${jsonExpr}.get<bool>()`;
      }
      return `${jsonExpr}.get<auto>()`;

    case "class":
      // Nested class → direct json value, no dump/reparse
      return `${type.symbol.name}::fromJSONValue(${jsonExpr}).value()`;

    case "array": {
      const elCppType = emitType(type.elementType);
      return `[&]() { auto _vec = std::make_shared<std::vector<${elCppType}>>(); for (const auto& _el : ${jsonExpr}) { _vec->push_back(${emitDeserializeExpr("_el", type.elementType, ctx)}); } return _vec; }()`;
    }

    case "tuple": {
      const parts = type.elements.map((el, i) =>
        emitDeserializeExpr(`${jsonExpr}[${i}]`, el, ctx),
      );
      return `std::make_tuple(${parts.join(", ")})`;
    }

    case "enum":
      return `${type.symbol.name}_fromName(${jsonExpr}.get<std::string>()).value()`;

    case "any":
      throw new Error("any is not supported for JSON serialization");

    case "null":
      return "nullptr";

    case "union": {
      const nonNull = type.types.filter((t) => t.kind !== "null");
      const hasNull = type.types.some((t) => t.kind === "null");
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (inner.kind === "class") {
          // shared_ptr nullable
          return `(${jsonExpr}.is_null() ? ${emitType(type)}{nullptr} : ${emitDeserializeExpr(jsonExpr, inner, ctx)})`;
        }
        // optional<T>
        return `(${jsonExpr}.is_null() ? ${emitType(type)}{std::nullopt} : ${emitType(type)}{${emitDeserializeExpr(jsonExpr, inner, ctx)}})`;
      }
      return `${jsonExpr}.get<auto>()`;
    }

    default:
      return `${jsonExpr}.get<auto>()`;
  }
}

// ============================================================================
// JSON type checking and naming
// ============================================================================

/** Emit the expected nlohmann::json type check for a field type. */
export function emitJsonTypeCheck(jsonExpr: string, type: ResolvedType): string {
  switch (type.kind) {
    case "any":
      return "false";
    case "json-value":
      return "true";
    case "primitive":
      switch (type.name) {
        case "int": case "long": case "float": case "double":
          return `${jsonExpr}.is_number()`;
        case "string": case "char":
          return `${jsonExpr}.is_string()`;
        case "bool":
          return `${jsonExpr}.is_boolean()`;
      }
      return "true";
    case "class":
      return `${jsonExpr}.is_object()`;
    case "array":
      return `${jsonExpr}.is_array()`;
    case "tuple":
      return `${jsonExpr}.is_array()`;
    case "enum":
      return `${jsonExpr}.is_string()`;
    case "null":
      return `${jsonExpr}.is_null()`;
    case "union": {
      // For T | null, accept the inner type or null
      const nonNull = type.types.filter((t) => t.kind !== "null");
      const hasNull = type.types.some((t) => t.kind === "null");
      if (hasNull && nonNull.length === 1) {
        return `(${jsonExpr}.is_null() || ${emitJsonTypeCheck(jsonExpr, nonNull[0])})`;
      }
      return "true";
    }
    default:
      return "true";
  }
}

/** Descriptive name for a JSON type, used in error messages. */
export function jsonTypeName(type: ResolvedType): string {
  switch (type.kind) {
    case "any":
      return "unsupported any";
    case "json-value":
      return "json";
    case "primitive":
      switch (type.name) {
        case "int": case "long": case "float": case "double":
          return "number";
        case "string": case "char":
          return "string";
        case "bool":
          return "boolean";
      }
      return "value";
    case "class": return "object";
    case "array": return "array";
    case "tuple": return "array";
    case "enum": return "string";
    case "null": return "null";
    default: return "value";
  }
}

// ============================================================================
// toJSON / fromJSON method generation
// ============================================================================

/**
 * Generate toJSONValue() (returns nlohmann::json) and toJSON() (returns string) for a class.
 * toJSON() is a thin wrapper that calls toJSONValue().dump().
 * Nested objects use toJSONValue() directly, avoiding serialize/reparse overhead.
 */
export function emitToJSON(
  decl: ClassDeclaration,
  cppName: string,
  ctx: EmitContext,
): void {
  const memberInd = indent({ indent: ctx.indent + 1 });
  const bodyInd = indent({ indent: ctx.indent + 2 });

  // toJSONValue() — the real implementation returning a json object
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}nlohmann::json toJSONValue() const {`);
  ctx.sourceLines.push(`${bodyInd}nlohmann::json _j;`);

  for (const field of decl.fields) {
    if (field.static_) continue;
    const fieldType = field.resolvedType;
    if (!fieldType) continue;

    for (const fieldName of field.names) {
      const safeName = emitIdentifierSafe(fieldName);
      if (field.const_) {
        // const fields: serialize the compile-time value
        if (field.defaultValue) {
          const val = emitExpression(field.defaultValue, ctx);
          if (fieldType.kind === "primitive" && fieldType.name === "string") {
            // const char* → std::string
            ctx.sourceLines.push(`${bodyInd}_j["${fieldName}"] = std::string(${safeName});`);
          } else {
            ctx.sourceLines.push(`${bodyInd}_j["${fieldName}"] = ${safeName};`);
          }
        }
      } else {
        const serialized = emitSerializeExpr(`this->${safeName}`, fieldType);
        ctx.sourceLines.push(`${bodyInd}_j["${fieldName}"] = ${serialized};`);
      }
    }
  }

  ctx.sourceLines.push(`${bodyInd}return _j;`);
  ctx.sourceLines.push(`${memberInd}}`);

  // toJSON() — thin wrapper
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}std::string toJSON() const {`);
  ctx.sourceLines.push(`${bodyInd}return toJSONValue().dump();`);
  ctx.sourceLines.push(`${memberInd}}`);
}

/**
 * Generate fromJSONValue() (takes nlohmann::json) and fromJSON() (takes string) for a class.
 * fromJSON() is a thin wrapper that parses the string and delegates to fromJSONValue().
 * Nested objects use fromJSONValue() directly, avoiding dump/reparse overhead.
 */
export function emitFromJSON(
  decl: ClassDeclaration,
  cppName: string,
  ctx: EmitContext,
): void {
  const memberInd = indent({ indent: ctx.indent + 1 });
  const bodyInd = indent({ indent: ctx.indent + 2 });
  const resultType = `doof::Result<std::shared_ptr<${cppName}>, std::string>`;

  // fromJSONValue() — the real implementation taking a json object
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}static ${resultType} fromJSONValue(const nlohmann::json& _j) {`);
  ctx.sourceLines.push(`${bodyInd}if (!_j.is_object()) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Expected JSON object");`);
  ctx.sourceLines.push(`${bodyInd}}`);

  // Collect constructor args (non-const fields)
  const constructorFields = decl.fields
    .filter((f) => !f.const_ && !f.static_)
    .flatMap((f) => f.names.map((n) => ({ name: n, field: f })));

  // Validate and extract each field
  for (const cf of constructorFields) {
    const fieldType = cf.field.resolvedType;
    if (!fieldType) continue;

    const safeName = emitIdentifierSafe(cf.name);
    const hasDefault = cf.field.defaultValue !== null;

    if (hasDefault) {
      // Optional field: use default if absent
      const defaultVal = emitDefaultExpression(cf.field.defaultValue!, fieldType);
      ctx.sourceLines.push(`${bodyInd}${emitType(fieldType)} _f_${safeName};`);
      ctx.sourceLines.push(`${bodyInd}if (_j.contains("${cf.name}")) {`);
      // Type check
      ctx.sourceLines.push(`${bodyInd}    if (!${emitJsonTypeCheck(`_j["${cf.name}"]`, fieldType)}) {`);
      ctx.sourceLines.push(`${bodyInd}        return ${resultType}::failure("Field \\"${cf.name}\\" expected ${jsonTypeName(fieldType)} but got " + std::string(_j["${cf.name}"].type_name()));`);
      ctx.sourceLines.push(`${bodyInd}    }`);
      ctx.sourceLines.push(`${bodyInd}    _f_${safeName} = ${emitDeserializeExpr(`_j["${cf.name}"]`, fieldType, ctx)};`);
      ctx.sourceLines.push(`${bodyInd}} else {`);
      ctx.sourceLines.push(`${bodyInd}    _f_${safeName} = ${defaultVal};`);
      ctx.sourceLines.push(`${bodyInd}}`);
    } else {
      // Required field: must be present
      ctx.sourceLines.push(`${bodyInd}if (!_j.contains("${cf.name}")) {`);
      ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Missing required field \\"${cf.name}\\"");`);
      ctx.sourceLines.push(`${bodyInd}}`);
      // Type check
      ctx.sourceLines.push(`${bodyInd}if (!${emitJsonTypeCheck(`_j["${cf.name}"]`, fieldType)}) {`);
      ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Field \\"${cf.name}\\" expected ${jsonTypeName(fieldType)} but got " + std::string(_j["${cf.name}"].type_name()));`);
      ctx.sourceLines.push(`${bodyInd}}`);
      ctx.sourceLines.push(`${bodyInd}auto _f_${safeName} = ${emitDeserializeExpr(`_j["${cf.name}"]`, fieldType, ctx)};`);
    }
  }

  // Validate const fields if present in JSON
  for (const field of decl.fields) {
    if (!field.const_ || !field.defaultValue) continue;
    for (const fieldName of field.names) {
      if (field.defaultValue.kind === "string-literal") {
        const constValue = field.defaultValue.parts
          .filter((p): p is string => typeof p === "string")
          .join("");
        ctx.sourceLines.push(`${bodyInd}if (_j.contains("${fieldName}") && _j["${fieldName}"].is_string() && _j["${fieldName}"].get<std::string>() != "${constValue}") {`);
        ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Field \\"${fieldName}\\" must be \\"${constValue}\\" but got \\"" + _j["${fieldName}"].get<std::string>() + "\\"");`);
        ctx.sourceLines.push(`${bodyInd}}`);
      } else if (field.defaultValue.kind === "int-literal") {
        const constValue = (field.defaultValue as any).value;
        ctx.sourceLines.push(`${bodyInd}if (_j.contains("${fieldName}") && _j["${fieldName}"].is_number() && _j["${fieldName}"].get<int32_t>() != ${constValue}) {`);
        ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Field \\"${fieldName}\\" must be ${constValue}");`);
        ctx.sourceLines.push(`${bodyInd}}`);
      }
    }
  }

  // Construct the object
  if (constructorFields.length > 0) {
    const args = constructorFields.map((cf) => `_f_${emitIdentifierSafe(cf.name)}`).join(", ");
    ctx.sourceLines.push(`${bodyInd}return ${resultType}::success(std::make_shared<${cppName}>(${args}));`);
  } else {
    ctx.sourceLines.push(`${bodyInd}return ${resultType}::success(std::make_shared<${cppName}>());`);
  }

  ctx.sourceLines.push(`${memberInd}}`);

  // fromJSON() — thin wrapper that parses and delegates
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}static ${resultType} fromJSON(const std::string& _json_str) {`);
  ctx.sourceLines.push(`${bodyInd}nlohmann::json _j;`);
  ctx.sourceLines.push(`${bodyInd}try { _j = nlohmann::json::parse(_json_str); } catch (const std::exception& _e) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure(std::string("Invalid JSON: ") + _e.what());`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}return fromJSONValue(_j);`);
  ctx.sourceLines.push(`${memberInd}}`);
}

// ============================================================================
// Interface-level fromJSON dispatcher
// ============================================================================

/**
 * Generate free functions for interface deserialization:
 * - InterfaceName_fromJSONValue(json) — dispatches on discriminator field
 * - InterfaceName_fromJSON(str) — thin wrapper that parses and delegates
 */
export function emitInterfaceFromJSON(
  ifaceName: string,
  impls: ClassSymbol[],
  disc: { fieldName: string; valueMap: Map<string, ClassSymbol> },
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const bodyInd = indent({ indent: ctx.indent + 1 });
  const resultType = `doof::Result<${ifaceName}, std::string>`;

  // _fromJSONValue() — the real implementation taking a json object
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline ${resultType} ${ifaceName}_fromJSONValue(const nlohmann::json& _j) {`);
  ctx.sourceLines.push(`${bodyInd}if (!_j.is_object()) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Expected JSON object");`);
  ctx.sourceLines.push(`${bodyInd}}`);

  // Check discriminator field
  ctx.sourceLines.push(`${bodyInd}if (!_j.contains("${disc.fieldName}") || !_j["${disc.fieldName}"].is_string()) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure("Missing or invalid discriminator field \\"${disc.fieldName}\\"");`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}auto _disc = _j["${disc.fieldName}"].get<std::string>();`);

  // Dispatch to the correct class's fromJSONValue
  let first = true;
  for (const [value, cls] of disc.valueMap.entries()) {
    const cond = first ? "if" : "} else if";
    first = false;
    ctx.sourceLines.push(`${bodyInd}${cond} (_disc == "${value}") {`);
    ctx.sourceLines.push(`${bodyInd}    auto _r = ${cls.name}::fromJSONValue(_j);`);
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

  // _fromJSON() — thin wrapper that parses and delegates
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline ${resultType} ${ifaceName}_fromJSON(const std::string& _json_str) {`);
  ctx.sourceLines.push(`${bodyInd}nlohmann::json _j;`);
  ctx.sourceLines.push(`${bodyInd}try { _j = nlohmann::json::parse(_json_str); } catch (const std::exception& _e) {`);
  ctx.sourceLines.push(`${bodyInd}    return ${resultType}::failure(std::string("Invalid JSON: ") + _e.what());`);
  ctx.sourceLines.push(`${bodyInd}}`);
  ctx.sourceLines.push(`${bodyInd}return ${ifaceName}_fromJSONValue(_j);`);
  ctx.sourceLines.push(`${ind}}`);
}
