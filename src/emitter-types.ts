/**
 * C++ type emission — maps Doof ResolvedType values to C++ type strings.
 *
 * Handles the complete type mapping from the transpiler plan:
 *   - Primitives → C++ fixed-width types
 *   - Classes → std::shared_ptr<T>
 *   - Interfaces → variant aliases (resolved elsewhere, emitted by name)
 *   - Unions → std::variant with null-folding heuristics
 *   - Arrays → std::shared_ptr<std::vector>
 *   - Tuples → std::tuple
 *   - Functions → std::function
 *   - Weak → std::weak_ptr
 *   - Nullable → std::optional for primitives, nullptr for pointers
 */

import { isJsonValueType, type ResolvedType, type PrimitiveName } from "./checker-types.js";
import type { ClassSymbol } from "./types.js";
import { emitModuleNamespace, emitQualifiedModuleName } from "./emitter-names.js";

function emitModuleOwnedName(
  modulePath: string,
  localName: string,
  currentModulePath?: string,
  emittedCppNamespace?: string,
): string {
  return modulePath === currentModulePath
    ? localName
    : emittedCppNamespace
      ? `::${emittedCppNamespace}::${localName}`
      : emitQualifiedModuleName(modulePath, localName);
}

export function emitEnumTypeName(type: Extract<ResolvedType, { kind: "enum" }>, currentModulePath?: string): string {
  return type.symbol.module === "<builtin>"
    ? `doof::${type.symbol.name}`
    : emitModuleOwnedName(type.symbol.module, type.symbol.name, currentModulePath, type.symbol.emittedCppNamespace);
}

export function emitEnumHelperName(
  type: Extract<ResolvedType, { kind: "enum" }>,
  suffix: "_name" | "_fromName" | "_fromValue",
  currentModulePath?: string,
): string {
  return type.symbol.module === "<builtin>"
    ? `doof::${type.symbol.name}${suffix}`
    : emitModuleOwnedName(type.symbol.module, `${type.symbol.name}${suffix}`, currentModulePath, type.symbol.emittedCppNamespace);
}

export function emitEnumVariantAccess(
  type: Extract<ResolvedType, { kind: "enum" }>,
  variant: string,
  currentModulePath?: string,
): string {
  return `${emitEnumTypeName(type, currentModulePath)}::${variant}`;
}

export function emitClassCppName(symbol: ClassSymbol, currentModulePath?: string): string {
  if (symbol.extern_) return symbol.extern_.cppName ?? symbol.name;
  return emitModuleOwnedName(symbol.module, symbol.emittedCppName ?? symbol.name, currentModulePath, symbol.emittedCppNamespace);
}

export function emitLocalClassCppName(symbol: ClassSymbol): string {
  if (symbol.extern_) return symbol.extern_.cppName ?? symbol.name;
  return symbol.emittedCppName ?? symbol.name;
}

export function emitPrivateClassCppName(symbol: ClassSymbol): string {
  return `__doof_private_${mangleModulePathForCppName(symbol.module)}_${sanitizeCppIdentifierPart(symbol.name)}`;
}

export function emitClassForwardDeclName(symbol: ClassSymbol): string {
  return emitLocalClassCppName(symbol);
}

export function emitClassInnerType(type: Extract<ResolvedType, { kind: "class" }>, currentModulePath?: string): string {
  const typeArgStr = type.typeArgs && type.typeArgs.length > 0
    ? `<${type.typeArgs.map((typeArg) => emitType(typeArg, currentModulePath)).join(", ")}>`
    : "";
  return `${emitClassCppName(type.symbol, currentModulePath)}${typeArgStr}`;
}

export function emitClassSharedPtrType(type: Extract<ResolvedType, { kind: "class" }>, currentModulePath?: string): string {
  return `std::shared_ptr<${emitClassInnerType(type, currentModulePath)}>`;
}

function mangleModulePathForCppName(modulePath: string): string {
  const withoutExtension = modulePath.replace(/\.[^/.]+$/, "");
  const sanitized = sanitizeCppIdentifierPart(withoutExtension);
  return sanitized || "module";
}

function sanitizeCppIdentifierPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!sanitized) return "";
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
}

function mangleModuleOwnedSymbol(modulePath: string, name: string, emittedCppNamespace?: string): string {
  return `${(emittedCppNamespace ?? emitModuleNamespace(modulePath)).replace(/::/g, "_")}_${sanitizeCppIdentifierPart(name)}`;
}

// ============================================================================
// Primitive mapping
// ============================================================================

const PRIMITIVE_MAP: Record<PrimitiveName, string> = {
  byte: "uint8_t",
  int: "int32_t",
  long: "int64_t",
  float: "float",
  double: "double",
  string: "std::string",
  char: "char32_t",
  bool: "bool",
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Emit a C++ type string for a resolved Doof type.
 *
 * For class types this returns `std::shared_ptr<ClassName>` since all Doof
 * class instances are heap-allocated and reference-counted.
 */
export function emitType(type: ResolvedType, currentModulePath?: string): string {
  if (isJsonValueType(type)) {
    return "doof::JsonValue";
  }

  switch (type.kind) {
    case "primitive":
      return PRIMITIVE_MAP[type.name];

    case "builtin-namespace":
      throw new Error(`Cannot emit builtin namespace type "${type.name}" in value position`);

    case "class": {
      return emitClassSharedPtrType(type, currentModulePath);
    }

    case "interface": {
      // Interfaces are emitted as `using Name = std::variant<...>` aliases.
      // In type position we just use the alias name.
      const typeArgStr = type.typeArgs && type.typeArgs.length > 0
        ? `<${type.typeArgs.map((typeArg) => emitType(typeArg, currentModulePath)).join(", ")}>`
        : "";
      return `${emitModuleOwnedName(type.symbol.module, type.symbol.name, currentModulePath, type.symbol.emittedCppNamespace)}${typeArgStr}`;
    }

    case "enum":
      return emitEnumTypeName(type, currentModulePath);

    case "function": {
      const params = type.params.map((p) => emitType(p.type, currentModulePath)).join(", ");
      const ret = emitType(type.returnType, currentModulePath);
      return `std::function<${ret}(${params})>`;
    }

    case "mock-capture":
      return type.typeName;

    case "array": {
      const el = emitType(type.elementType, currentModulePath);
      return `std::shared_ptr<std::vector<${el}>>`;
    }

    case "map": {
      const k = emitType(type.keyType, currentModulePath);
      const v = emitType(type.valueType, currentModulePath);
      return `std::shared_ptr<doof::ordered_map<${k}, ${v}>>`;
    }

    case "set": {
      const el = emitType(type.elementType, currentModulePath);
      return `std::shared_ptr<doof::ordered_set<${el}>>`;
    }

    case "stream":
      return `__doof_stream_${mangleTypeForCppName(type.elementType)}`;

    case "union":
      return emitUnionType(type.types, currentModulePath);

    case "tuple": {
      const els = type.elements.map((element) => emitType(element, currentModulePath)).join(", ");
      return `std::tuple<${els}>`;
    }

    case "weak": {
      const inner = emitInnerType(type.inner, currentModulePath);
      return `std::weak_ptr<${inner}>`;
    }

    case "null":
      return "std::monostate";

    case "void":
      return "void";

    case "unknown":
      throw new Error("Cannot emit unresolved unknown type");

    case "namespace":
      throw new Error("Cannot emit namespace type in value position");

    case "actor":
      return `std::shared_ptr<doof::Actor<${emitInnerType(type.innerClass, currentModulePath)}>>`;

    case "promise":
      return `doof::Promise<${emitType(type.valueType, currentModulePath)}>`;

    case "result":
      return `doof::Result<${emitType(type.successType, currentModulePath)}, ${emitType(type.errorType, currentModulePath)}>`;

    case "success-wrapper":
      throw new Error("Success wrapper type should not reach C++ type emission");

    case "failure-wrapper":
      throw new Error("Failure wrapper type should not reach C++ type emission");

    case "typevar":
      return type.name;

    case "class-metadata": {
      return `doof::ClassMetadata<${emitClassInnerType(type.classType, currentModulePath)}>`;
    }

    case "method-reflection": {
      return `doof::MethodReflection<${emitClassInnerType(type.classType, currentModulePath)}>`;
    }
  }
}

export function mangleTypeForCppName(type: ResolvedType): string {
  if (isJsonValueType(type)) {
    return "json";
  }

  switch (type.kind) {
    case "primitive":
      return type.name;
    case "class":
      return type.symbol.extern_
        ? sanitizeCppIdentifierPart(emitClassCppName(type.symbol))
        : mangleModuleOwnedSymbol(type.symbol.module, type.symbol.emittedCppName ?? type.symbol.name, type.symbol.emittedCppNamespace);
    case "enum":
      return mangleModuleOwnedSymbol(type.symbol.module, type.symbol.name, type.symbol.emittedCppNamespace);
    case "array":
      return `array_${mangleTypeForCppName(type.elementType)}`;
    case "map":
      return `map_${mangleTypeForCppName(type.keyType)}_${mangleTypeForCppName(type.valueType)}`;
    case "set":
      return `set_${mangleTypeForCppName(type.elementType)}`;
    case "tuple":
      return `tuple_${type.elements.map(mangleTypeForCppName).join("_")}`;
    case "union":
      return `union_${type.types.map(mangleTypeForCppName).join("_")}`;
    case "null":
      return "null";
    case "stream":
      return `stream_${mangleTypeForCppName(type.elementType)}`;
    case "interface":
      return mangleModuleOwnedSymbol(type.symbol.module, type.symbol.name, type.symbol.emittedCppNamespace);
    case "function":
      return "fn";
    case "weak":
      return `weak_${mangleTypeForCppName(type.inner)}`;
    case "void":
      return "void";
    case "unknown":
      return "unknown";
    case "namespace":
      return "namespace";
    case "actor":
      return `actor_${mangleTypeForCppName(type.innerClass)}`;
    case "promise":
      return `promise_${mangleTypeForCppName(type.valueType)}`;
    case "result":
      return `result_${mangleTypeForCppName(type.successType)}_${mangleTypeForCppName(type.errorType)}`;
    case "success-wrapper":
      return `success_${mangleTypeForCppName(type.valueType)}`;
    case "failure-wrapper":
      return `failure_${mangleTypeForCppName(type.errorType)}`;
    case "typevar":
      return type.name;
    case "builtin-namespace":
      return type.name;
    case "mock-capture":
      return type.typeName;
    case "class-metadata":
      return `metadata_${mangleTypeForCppName(type.classType)}`;
    case "method-reflection":
      return `method_${mangleTypeForCppName(type.classType)}`;
  }
}

/**
 * Emit the "inner" type for shared_ptr/weak_ptr wrapping.
 * For class types this strips the shared_ptr layer — returns just the class name.
 */
export function emitInnerType(type: ResolvedType, currentModulePath?: string): string {
  if (type.kind === "class") {
    return emitClassInnerType(type, currentModulePath);
  }
  return emitType(type, currentModulePath);
}

/**
 * Emit a C++ type for a union, applying the null-folding heuristics:
 *
 *   - `ClassA | null`           → std::shared_ptr<ClassA>  (ptr is nullable)
 *   - `int | null`              → std::optional<int32_t>
 *   - `int | string`            → std::variant<int32_t, std::string>
 *   - `int | string | null`     → std::variant<std::monostate, int32_t, std::string>
 *   - `ClassA | ClassB`         → std::variant<shared_ptr<A>, shared_ptr<B>>
 *   - `ClassA | ClassB | null`  → std::variant<std::monostate, shared_ptr<A>, shared_ptr<B>>
 */
function emitUnionType(types: ResolvedType[], currentModulePath?: string): string {
  const hasNull = types.some((t) => t.kind === "null");
  const nonNull = types.filter((t) => t.kind !== "null");

  // Single type + null
  if (hasNull && nonNull.length === 1) {
    const inner = nonNull[0];
    // Class | null → shared_ptr (already nullable)
    if (inner.kind === "class") {
      return `std::shared_ptr<${emitInnerType(inner, currentModulePath)}>`;
    }
    if (inner.kind === "array") {
      return `std::shared_ptr<std::vector<${emitType(inner.elementType, currentModulePath)}>>`;
    }
    if (inner.kind === "map") {
      return `std::shared_ptr<doof::ordered_map<${emitType(inner.keyType, currentModulePath)}, ${emitType(inner.valueType, currentModulePath)}>>`;
    }
    if (inner.kind === "set") {
      return `std::shared_ptr<doof::ordered_set<${emitType(inner.elementType, currentModulePath)}>>`;
    }
    // weak Class | null → weak_ptr (already nullable)
    if (inner.kind === "weak" && inner.inner.kind === "class") {
      return `std::weak_ptr<${emitInnerType(inner.inner, currentModulePath)}>`;
    }
    // Primitive | null → std::optional
    return `std::optional<${emitType(inner, currentModulePath)}>`;
  }

  // Multi-type union
  const memberTypes = nonNull.map((member) => emitType(member, currentModulePath));
  if (hasNull) {
    memberTypes.unshift("std::monostate");
  }
  return `std::variant<${memberTypes.join(", ")}>`;
}

/**
 * Emit a C++ default value for a type (used for uninitialized locals etc.).
 */
export function emitDefaultValue(type: ResolvedType): string {
  if (isJsonValueType(type)) {
    return "doof::json_value(nullptr)";
  }

  switch (type.kind) {
    case "primitive":
      switch (type.name) {
        case "byte": return "static_cast<uint8_t>(0)";
        case "int": return "0";
        case "long": return "0LL";
        case "float": return "0.0f";
        case "double": return "0.0";
        case "string": return `""`;
        case "char": return "U'\\0'";
        case "bool": return "false";
      }
      break; // unreachable but satisfies TS
    case "null":
      return "std::monostate{}";
    case "void":
      return "";
    default:
      return "{}";
  }
  return "{}";
}

/**
 * Check if a ResolvedType is a class type (determines -> vs . member access).
 */
export function isClassType(type: ResolvedType): boolean {
  return type.kind === "class";
}

/**
 * Check if a ResolvedType should be accessed through a pointer (shared_ptr or weak_ptr).
 * Also recognizes nullable class unions (Class | null) which emit as shared_ptr.
 */
export function isPointerType(type: ResolvedType): boolean {
  if (type.kind === "class" || type.kind === "weak" || type.kind === "array" || type.kind === "map" || type.kind === "set") return true;
  // Class | null → shared_ptr (already nullable, still a pointer)
  if (type.kind === "union") {
    const nonNull = type.types.filter((t) => t.kind !== "null");
    const hasNull = type.types.some((t) => t.kind === "null");
    if (hasNull && nonNull.length === 1) {
      return nonNull[0].kind === "class"
        || nonNull[0].kind === "weak"
        || nonNull[0].kind === "array"
        || nonNull[0].kind === "map"
        || nonNull[0].kind === "set";
    }
  }
  return false;
}

/**
 * Check if a ResolvedType emits as a std::variant (multi-member union).
 *
 * Returns true for unions that become `std::variant<...>` in C++.
 * Single-class nullable (`Class | null`) emits as shared_ptr, NOT variant.
 * Single-primitive nullable (`int | null`) emits as optional, NOT variant.
 */
export function isVariantUnionType(type: ResolvedType): boolean {
  if (isJsonValueType(type)) return false;
  if (type.kind !== "union") return false;
  const hasNull = type.types.some((t) => t.kind === "null");
  const nonNull = type.types.filter((t) => t.kind !== "null");
  // Single non-null + null: shared_ptr (class) or optional (primitive), not variant
  if (hasNull && nonNull.length === 1) return false;
  // 2+ non-null types → variant
  return nonNull.length >= 2;
}

/**
 * Emit the correct C++ null representation for a target type.
 *
 *   - `std::variant<std::monostate, ...>` → `std::monostate{}`
 *   - `std::optional<T>`                  → `std::nullopt`
 *   - `std::shared_ptr<T>` / pointer      → `nullptr`
 */
export function emitNullForType(type: ResolvedType): string {
  if (isJsonValueType(type)) return "doof::json_value(nullptr)";
  if (isVariantUnionType(type)) return "std::monostate{}";
  if (type.kind === "union") {
    const nonNull = type.types.filter((t) => t.kind !== "null");
    const hasNull = type.types.some((t) => t.kind === "null");
    if (hasNull && nonNull.length === 1) {
      // Single class + null → shared_ptr → nullptr
      if (nonNull[0].kind === "class"
          || nonNull[0].kind === "weak"
          || nonNull[0].kind === "array"
          || nonNull[0].kind === "map"
          || nonNull[0].kind === "set") return "nullptr";
      // Single primitive + null → optional → nullopt
      return "std::nullopt";
    }
  }
  return "nullptr";
}

/**
 * Check if comparing a value with null needs monostate-based comparison.
 * Returns true for variant-backed nullable unions, including JsonValue.
 */
export function isMonostateNullable(type: ResolvedType): boolean {
  return type.kind === "union"
    && type.types.some((t: ResolvedType) => t.kind === "null")
    && (isVariantUnionType(type) || isJsonValueType(type));
}

/**
 * Check if a type is an optional-nullable (T | null where T is not a class/weak).
 * These map to std::optional<T> in C++ and need std::nullopt for null comparisons.
 */
export function isOptionalNullable(type: ResolvedType): boolean {
  if (type.kind !== "union") return false;
  const nonNull = type.types.filter((t) => t.kind !== "null");
  const hasNull = type.types.some((t) => t.kind === "null");
  if (!hasNull || nonNull.length !== 1) return false;
  // Class/weak | null → shared_ptr/weak_ptr (nullable pointer, not optional)
  if (nonNull[0].kind === "class"
      || nonNull[0].kind === "weak"
      || nonNull[0].kind === "array"
      || nonNull[0].kind === "map"
      || nonNull[0].kind === "set") return false;
  return true;
}
