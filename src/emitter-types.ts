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

import type { ResolvedType, PrimitiveName } from "./checker-types.js";

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
export function emitType(type: ResolvedType): string {
  switch (type.kind) {
    case "json-value":
      return "doof::JsonValue";

    case "primitive":
      return PRIMITIVE_MAP[type.name];

    case "builtin-namespace":
      throw new Error(`Cannot emit builtin namespace type "${type.name}" in value position`);

    case "class": {
      const cppName = type.symbol.extern_?.cppName ?? type.symbol.name;
      const typeArgStr = type.typeArgs && type.typeArgs.length > 0
        ? `<${type.typeArgs.map(emitType).join(", ")}>`
        : "";
      return `std::shared_ptr<${cppName}${typeArgStr}>`;
    }

    case "interface": {
      // Interfaces are emitted as `using Name = std::variant<...>` aliases.
      // In type position we just use the alias name.
      const typeArgStr = type.typeArgs && type.typeArgs.length > 0
        ? `<${type.typeArgs.map(emitType).join(", ")}>`
        : "";
      return `${type.symbol.name}${typeArgStr}`;
    }

    case "enum":
      return type.symbol.name;

    case "function": {
      const params = type.params.map((p) => emitType(p.type)).join(", ");
      const ret = emitType(type.returnType);
      return `std::function<${ret}(${params})>`;
    }

    case "mock-capture":
      return type.typeName;

    case "array": {
      const el = emitType(type.elementType);
      return `std::shared_ptr<std::vector<${el}>>`;
    }

    case "map": {
      const k = emitType(type.keyType);
      const v = emitType(type.valueType);
      return `std::shared_ptr<std::unordered_map<${k}, ${v}>>`;
    }

    case "set": {
      const el = emitType(type.elementType);
      return `std::shared_ptr<std::unordered_set<${el}>>`;
    }

    case "stream":
      return `__doof_stream_${mangleTypeForCppName(type.elementType)}`;

    case "union":
      return emitUnionType(type.types);

    case "tuple": {
      const els = type.elements.map(emitType).join(", ");
      return `std::tuple<${els}>`;
    }

    case "weak": {
      const inner = emitInnerType(type.inner);
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
      return `std::shared_ptr<doof::Actor<${emitInnerType(type.innerClass)}>>`;

    case "promise":
      return `doof::Promise<${emitType(type.valueType)}>`;

    case "result":
      return `doof::Result<${emitType(type.successType)}, ${emitType(type.errorType)}>`;

    case "success-wrapper":
      throw new Error("Success wrapper type should not reach C++ type emission");

    case "failure-wrapper":
      throw new Error("Failure wrapper type should not reach C++ type emission");

    case "typevar":
      return type.name;

    case "class-metadata": {
      const cppName = type.classType.symbol.extern_?.cppName ?? type.classType.symbol.name;
      return `doof::ClassMetadata<${cppName}>`;
    }

    case "method-reflection": {
      const cppName = type.classType.symbol.extern_?.cppName ?? type.classType.symbol.name;
      return `doof::MethodReflection<${cppName}>`;
    }
  }
}

export function mangleTypeForCppName(type: ResolvedType): string {
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "class":
      return type.symbol.name;
    case "enum":
      return type.symbol.name;
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
      return type.symbol.name;
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
    case "json-value":
      return "json";
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
export function emitInnerType(type: ResolvedType): string {
  if (type.kind === "class") {
    const cppName = type.symbol.extern_?.cppName ?? type.symbol.name;
    const typeArgStr = type.typeArgs && type.typeArgs.length > 0
      ? `<${type.typeArgs.map(emitType).join(", ")}>`
      : "";
    return `${cppName}${typeArgStr}`;
  }
  return emitType(type);
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
function emitUnionType(types: ResolvedType[]): string {
  const hasNull = types.some((t) => t.kind === "null");
  const nonNull = types.filter((t) => t.kind !== "null");

  // Single type + null
  if (hasNull && nonNull.length === 1) {
    const inner = nonNull[0];
    // Class | null → shared_ptr (already nullable)
    if (inner.kind === "class") {
      return `std::shared_ptr<${emitInnerType(inner)}>`;
    }
    if (inner.kind === "array") {
      return `std::shared_ptr<std::vector<${emitType(inner.elementType)}>>`;
    }
    if (inner.kind === "map") {
      return `std::shared_ptr<std::unordered_map<${emitType(inner.keyType)}, ${emitType(inner.valueType)}>>`;
    }
    if (inner.kind === "set") {
      return `std::shared_ptr<std::unordered_set<${emitType(inner.elementType)}>>`;
    }
    // weak Class | null → weak_ptr (already nullable)
    if (inner.kind === "weak" && inner.inner.kind === "class") {
      return `std::weak_ptr<${emitInnerType(inner.inner)}>`;
    }
    // Primitive | null → std::optional
    return `std::optional<${emitType(inner)}>`;
  }

  // Multi-type union
  const memberTypes = nonNull.map(emitType);
  if (hasNull) {
    memberTypes.unshift("std::monostate");
  }
  return `std::variant<${memberTypes.join(", ")}>`;
}

/**
 * Emit a C++ default value for a type (used for uninitialized locals etc.).
 */
export function emitDefaultValue(type: ResolvedType): string {
  switch (type.kind) {
    case "json-value":
      return "doof::JsonValue(nullptr)";
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
  if (type.kind === "json-value") return "doof::JsonValue(nullptr)";
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
 * Returns true for variant unions with monostate (multi-type nullable unions).
 */
export function isMonostateNullable(type: ResolvedType): boolean {
  return type.kind === "union" && isVariantUnionType(type) && type.types.some((t: ResolvedType) => t.kind === "null");
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
