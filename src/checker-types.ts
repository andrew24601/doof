/**
 * Type representations and supporting types for the Doof type checker.
 *
 * Defines "resolved types" — the semantic type of every expression and
 * binding — as well as the Binding, Scope, and ModuleTypeInfo structures
 * that the checker produces.
 */

import type { Expression, SourceSpan } from "./ast.js";
import type { ClassSymbol, InterfaceSymbol, EnumSymbol, Diagnostic } from "./types.js";

// ============================================================================
// Resolved types
// ============================================================================

export type PrimitiveName =
  | "byte"
  | "int"
  | "long"
  | "float"
  | "double"
  | "string"
  | "char"
  | "bool";

export interface PrimitiveType {
  kind: "primitive";
  name: PrimitiveName;
}

export interface JsonValueResolvedType {
  kind: "json-value";
}

export type BuiltinNamespaceName = PrimitiveName | "JSON";

export interface BuiltinNamespaceType {
  kind: "builtin-namespace";
  name: BuiltinNamespaceName;
}

export interface ClassType {
  kind: "class";
  symbol: ClassSymbol;
  /** Concrete type arguments for generic classes (e.g. Box<int> → [int]). */
  typeArgs?: ResolvedType[];
}

export interface InterfaceType {
  kind: "interface";
  symbol: InterfaceSymbol;
  /** Concrete type arguments for generic interfaces. */
  typeArgs?: ResolvedType[];
}

export interface EnumType {
  kind: "enum";
  symbol: EnumSymbol;
}

export interface FunctionResolvedType {
  kind: "function";
  params: FunctionResolvedParam[];
  returnType: ResolvedType;
  /** Type parameter names for generic functions. */
  typeParams?: string[];
}

export interface FunctionResolvedParam {
  name: string;
  type: ResolvedType;
  hasDefault?: boolean;
  defaultValue?: Expression | null;
}

export interface ArrayResolvedType {
  kind: "array";
  elementType: ResolvedType;
  readonly_: boolean;
}

export interface MapResolvedType {
  kind: "map";
  keyType: ResolvedType;
  valueType: ResolvedType;
  readonly_?: boolean;
}

export interface SetResolvedType {
  kind: "set";
  elementType: ResolvedType;
  readonly_?: boolean;
}

export interface UnionResolvedType {
  kind: "union";
  types: ResolvedType[];
}

export interface TupleResolvedType {
  kind: "tuple";
  elements: ResolvedType[];
}

export interface WeakResolvedType {
  kind: "weak";
  inner: ResolvedType;
}

export interface NullType {
  kind: "null";
}

export interface VoidType {
  kind: "void";
}

export interface UnknownType {
  kind: "unknown";
}

export interface NamespaceType {
  kind: "namespace";
  /** The absolute path of the source module this namespace refers to. */
  sourceModule: string;
}

export interface ActorType {
  kind: "actor";
  /** The class type wrapped by this actor. */
  innerClass: ClassType;
}

export interface PromiseType {
  kind: "promise";
  /** The type of the value the promise resolves to. */
  valueType: ResolvedType;
}

export interface ResultResolvedType {
  kind: "result";
  /** The success type (T in Result<T, E>). */
  successType: ResolvedType;
  /** The error type (E in Result<T, E>). */
  errorType: ResolvedType;
}

/** Narrowed type for a Success variant in a case arm on Result. */
export interface SuccessWrapperType {
  kind: "success-wrapper";
  /** The T in Result<T, E>. */
  valueType: ResolvedType;
}

/** Narrowed type for a Failure variant in a case arm on Result. */
export interface FailureWrapperType {
  kind: "failure-wrapper";
  /** The E in Result<T, E>. */
  errorType: ResolvedType;
}

/** A type variable (generic parameter) — resolved during instantiation. */
export interface TypeVariableType {
  kind: "typevar";
  /** The name of the type parameter (e.g. "T", "U"). */
  name: string;
}

/** Structured metadata for a class — returned by ClassName.metadata. */
export interface ClassMetaType {
  kind: "class-metadata";
  /** The class this metadata describes. */
  classType: ClassType;
}

/** A single method reflection entry — element of ClassMetadata.methods. */
export interface MethodReflectionType {
  kind: "method-reflection";
  /** The class this method belongs to. */
  classType: ClassType;
}

/** A fully-resolved semantic type. */
export type ResolvedType =
  | JsonValueResolvedType
  | PrimitiveType
  | BuiltinNamespaceType
  | ClassType
  | InterfaceType
  | EnumType
  | FunctionResolvedType
  | ArrayResolvedType
  | MapResolvedType
  | SetResolvedType
  | UnionResolvedType
  | TupleResolvedType
  | WeakResolvedType
  | NullType
  | VoidType
  | UnknownType
  | NamespaceType
  | ActorType
  | PromiseType
  | ResultResolvedType
  | SuccessWrapperType
  | FailureWrapperType
  | TypeVariableType
  | ClassMetaType
  | MethodReflectionType;

// ============================================================================
// Singleton type constants
// ============================================================================

export const BYTE_TYPE: PrimitiveType = { kind: "primitive", name: "byte" };
export const INT_TYPE: PrimitiveType = { kind: "primitive", name: "int" };
export const LONG_TYPE: PrimitiveType = { kind: "primitive", name: "long" };
export const FLOAT_TYPE: PrimitiveType = { kind: "primitive", name: "float" };
export const DOUBLE_TYPE: PrimitiveType = { kind: "primitive", name: "double" };
export const STRING_TYPE: PrimitiveType = { kind: "primitive", name: "string" };
export const CHAR_TYPE: PrimitiveType = { kind: "primitive", name: "char" };
export const BOOL_TYPE: PrimitiveType = { kind: "primitive", name: "bool" };
export const JSON_VALUE_TYPE: JsonValueResolvedType = { kind: "json-value" };
export const VOID_TYPE: VoidType = { kind: "void" };
export const NULL_TYPE: NullType = { kind: "null" };
export const UNKNOWN_TYPE: UnknownType = { kind: "unknown" };

// ============================================================================
// Bindings (identifier provenance)
// ============================================================================

/** How a binding was introduced into a scope. */
export type BindingKind =
  | "const"
  | "readonly"
  | "immutable-binding"
  | "let"
  | "parameter"
  | "field"
  | "function"
  | "class"
  | "interface"
  | "enum"
  | "type-alias"
  | "import"
  | "builtin"
  | "namespace-import";

/**
 * A resolved binding — the provenance and type of a name accessible in
 * the current scope.
 */
export interface Binding {
  /** The name as declared (may differ from the local name due to renames). */
  name: string;
  /** How this binding entered the current scope. */
  kind: BindingKind;
  /** The resolved type. */
  type: ResolvedType;
  /** Whether the binding can be reassigned. */
  mutable: boolean;
  /** Source span of the declaration. */
  span: SourceSpan;
  /** Module that declares this binding. */
  module: string;
}

// ============================================================================
// Scope
// ============================================================================

export type ScopeKind = "module" | "function" | "method" | "block";

/**
 * A lexical scope in the checker.  Scopes form a chain via `parent`
 * links so identifier lookup walks outward.
 */
export interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
  kind: ScopeKind;
  /** For method scopes, the resolved type of `this`. */
  thisType: ResolvedType | null;
  /** Expected return type of the enclosing function/method (null if not in function). */
  returnType: ResolvedType | null;
  /** True when inside a case-expression arm body (return is disallowed). */
  inCaseExpressionArm?: boolean;
  /** Yield state for a block body inside a case-expression arm. */
  caseExpressionYield?: {
    type: ResolvedType | null;
    hasYield: boolean;
  };
  /** True when inside a catch-expression body used in expression position (return is disallowed). */
  inCatchExpressionBody?: boolean;
  /** True when inside a trailing lambda body (return is disallowed). */
  inTrailingLambda?: boolean;
}

// ============================================================================
// Module type info (result)
// ============================================================================

/**
 * Per-module result of the type-checking pass.
 *
 * All resolved type information is decorated directly on the AST nodes
 * (via `resolvedType`, `resolvedBinding`, `resolvedSymbol`). This struct
 * carries only the diagnostics produced during checking.
 */
export interface ModuleTypeInfo {
  /** Diagnostics produced during type checking. */
  diagnostics: Diagnostic[];
}

// ============================================================================
// Utilities
// ============================================================================

/** Human-readable string for a ResolvedType (useful for tests/diagnostics). */
export function typeToString(t: ResolvedType): string {
  switch (t.kind) {
    case "json-value":
      return "JsonValue";
    case "primitive":
      return t.name;
    case "builtin-namespace":
      return t.name;
    case "class":
      if (t.typeArgs && t.typeArgs.length > 0) {
        return `${t.symbol.name}<${t.typeArgs.map(typeToString).join(", ")}>`;
      }
      return t.symbol.name;
    case "interface":
      if (t.typeArgs && t.typeArgs.length > 0) {
        return `${t.symbol.name}<${t.typeArgs.map(typeToString).join(", ")}>`;
      }
      return t.symbol.name;
    case "enum":
      return t.symbol.name;
    case "function": {
      const tpPrefix = t.typeParams && t.typeParams.length > 0
        ? `<${t.typeParams.join(", ")}>`
        : "";
      const params = t.params
        .map((p) => `${p.name}: ${typeToString(p.type)}`)
        .join(", ");
      return `${tpPrefix}(${params}): ${typeToString(t.returnType)}`;
    }
    case "array": {
      const el = typeToString(t.elementType);
      return t.readonly_ ? `readonly ${el}[]` : `${el}[]`;
    }
    case "map": {
      const prefix = t.readonly_ ? "ReadonlyMap" : "Map";
      return `${prefix}<${typeToString(t.keyType)}, ${typeToString(t.valueType)}>`;
    }
    case "set": {
      const prefix = t.readonly_ ? "ReadonlySet" : "Set";
      return `${prefix}<${typeToString(t.elementType)}>`;
    }
    case "union":
      return t.types.map(typeToString).join(" | ");
    case "tuple":
      return `Tuple<${t.elements.map(typeToString).join(", ")}>`;
    case "weak":
      return `weak ${typeToString(t.inner)}`;
    case "null":
      return "null";
    case "void":
      return "void";
    case "unknown":
      return "unknown";
    case "namespace":
      return `namespace(${t.sourceModule})`;
    case "actor":
      return `Actor<${typeToString(t.innerClass)}>`;
    case "promise":
      return `Promise<${typeToString(t.valueType)}>`;
    case "result":
      return `Result<${typeToString(t.successType)}, ${typeToString(t.errorType)}>`;
    case "success-wrapper":
      return `Success<${typeToString(t.valueType)}>`;
    case "failure-wrapper":
      return `Failure<${typeToString(t.errorType)}>`;
    case "typevar":
      return t.name;
    case "class-metadata":
      return `ClassMetadata<${typeToString(t.classType)}>`;
    case "method-reflection":
      return `MethodReflection<${typeToString(t.classType)}>`;
  }
}

const PRIMITIVE_NAMES = new Set<string>([
  "byte", "int", "long", "float", "double", "string", "char", "bool",
]);

const SUPPORTED_HASH_COLLECTION_PRIMITIVE_NAMES = new Set<PrimitiveName>([
  "byte",
  "string",
  "int",
  "long",
  "char",
  "bool",
]);

export interface HashCollectionConstraintIssue {
  kind: "map-key" | "set-element";
  type: ResolvedType;
}

/** Type-guard: is `name` one of the Doof primitive type names? */
export function isPrimitiveName(name: string): name is PrimitiveName {
  return PRIMITIVE_NAMES.has(name);
}

export function describeSupportedHashCollectionElementTypes(): string {
  return "byte, string, int, long, char, bool, or enum";
}

export function isSupportedHashCollectionElementType(type: ResolvedType): boolean {
  return (type.kind === "primitive" && SUPPORTED_HASH_COLLECTION_PRIMITIVE_NAMES.has(type.name))
    || type.kind === "enum"
    || type.kind === "typevar"
    || type.kind === "unknown";
}

export function isSupportedMapKeyType(type: ResolvedType): boolean {
  return isSupportedHashCollectionElementType(type);
}

export function isSupportedSetElementType(type: ResolvedType): boolean {
  return isSupportedHashCollectionElementType(type);
}

export function findUnsupportedHashCollectionConstraint(type: ResolvedType): HashCollectionConstraintIssue | null {
  switch (type.kind) {
    case "class":
    case "interface":
      for (const arg of type.typeArgs ?? []) {
        const unsupported = findUnsupportedHashCollectionConstraint(arg);
        if (unsupported) return unsupported;
      }
      return null;

    case "array":
      return findUnsupportedHashCollectionConstraint(type.elementType);

    case "map": {
      if (!isSupportedHashCollectionElementType(type.keyType)) {
        return { kind: "map-key", type: type.keyType };
      }
      return findUnsupportedHashCollectionConstraint(type.valueType);
    }

    case "set":
      if (!isSupportedHashCollectionElementType(type.elementType)) {
        return { kind: "set-element", type: type.elementType };
      }
      return null;

    case "union":
      for (const member of type.types) {
        const unsupported = findUnsupportedHashCollectionConstraint(member);
        if (unsupported) return unsupported;
      }
      return null;

    case "tuple":
      for (const element of type.elements) {
        const unsupported = findUnsupportedHashCollectionConstraint(element);
        if (unsupported) return unsupported;
      }
      return null;

    case "weak":
      return findUnsupportedHashCollectionConstraint(type.inner);

    case "function":
      for (const param of type.params) {
        const unsupported = findUnsupportedHashCollectionConstraint(param.type);
        if (unsupported) return unsupported;
      }
      return findUnsupportedHashCollectionConstraint(type.returnType);

    case "actor":
      return findUnsupportedHashCollectionConstraint(type.innerClass);

    case "promise":
      return findUnsupportedHashCollectionConstraint(type.valueType);

    case "result": {
      const unsupportedSuccess = findUnsupportedHashCollectionConstraint(type.successType);
      if (unsupportedSuccess) return unsupportedSuccess;
      return findUnsupportedHashCollectionConstraint(type.errorType);
    }

    case "success-wrapper":
      return findUnsupportedHashCollectionConstraint(type.valueType);

    case "failure-wrapper":
      return findUnsupportedHashCollectionConstraint(type.errorType);

    case "class-metadata":
    case "method-reflection":
      return findUnsupportedHashCollectionConstraint(type.classType);

    default:
      return null;
  }
}

export function formatUnsupportedHashCollectionConstraintMessage(
  issue: HashCollectionConstraintIssue,
  context: "type" | "map-literal-key" | "set-literal-element" = "type",
): string {
  const typeString = typeToString(issue.type);
  const supported = describeSupportedHashCollectionElementTypes();
  if (issue.kind === "map-key" && context === "map-literal-key") {
    return `Map literal key has type "${typeString}" which is not supported; map keys must be ${supported}`;
  }
  if (issue.kind === "set-element" && context === "set-literal-element") {
    return `Set literal element has type "${typeString}" which is not supported; set elements must be ${supported}`;
  }
  if (issue.kind === "set-element") {
    return `Set element type "${typeString}" is not supported; set elements must be ${supported}`;
  }
  return `Map key type "${typeString}" is not supported; map keys must be ${supported}`;
}

export function findUnsupportedMapKeyType(type: ResolvedType): ResolvedType | null {
  const issue = findUnsupportedHashCollectionConstraint(type);
  return issue?.kind === "map-key" ? issue.type : null;
}

export function formatUnsupportedMapKeyTypeMessage(
  type: ResolvedType,
  context: "type" | "literal-key" = "type",
): string {
  return formatUnsupportedHashCollectionConstraintMessage(
    { kind: "map-key", type },
    context === "literal-key" ? "map-literal-key" : "type",
  );
}

// ============================================================================
// Type compatibility
// ============================================================================

/**
 * Check whether `source` is assignable to `target`.
 *
 * Rules:
 *   - identical types are always compatible
 *   - unknown is compatible with anything (incomplete inference)
 *   - null is assignable to a union that contains null
 *   - numeric widening: int→long, float→double, int→float, int→double, long→double
 *   - union target: source must be assignable to at least one member
 *   - union source: every member must be assignable to target
 *   - array: element types must match (and readonly source can't go to mutable target)
 *   - tuple: same arity, element-wise compatibility
 *   - function: contra-variant params, co-variant return
 *   - class: nominal — same class symbol, or source implements target interface
 *   - interface: structural — source class must have all required fields/methods
 *   - weak: inner types must be compatible
 *   - void: only void is assignable to void
 */
export function isAssignableTo(source: ResolvedType, target: ResolvedType): boolean {
  // Unknown is a wildcard (inference not complete).
  if (source.kind === "unknown" || target.kind === "unknown") return true;

  if (target.kind === "json-value") return isAssignableToJsonValue(source);
  if (source.kind === "json-value") return false;

  // Type variables are wildcards (unresolved generic params).
  if (source.kind === "typevar" || target.kind === "typevar") return true;

  // Identical types.
  if (typesEqual(source, target)) return true;

  // void only matches void.
  if (target.kind === "void" || source.kind === "void") {
    return source.kind === "void" && target.kind === "void";
  }

  // null assignable to union containing null.
  if (source.kind === "null") {
    if (target.kind === "null") return true;
    if (target.kind === "union") {
      return target.types.some((t) => t.kind === "null");
    }
    return false;
  }

  // Numeric widening: int→long, int→float, int→double, long→double, float→double.
  if (source.kind === "primitive" && target.kind === "primitive") {
    return isNumericWidening(source.name, target.name);
  }

  if (source.kind === "builtin-namespace" || target.kind === "builtin-namespace") {
    return false;
  }

  // Union source: every member must be assignable to target.
  if (source.kind === "union") {
    return source.types.every((t) => isAssignableTo(t, target));
  }

  // Union target: source fits if assignable to at least one member.
  if (target.kind === "union") {
    return target.types.some((t) => isAssignableTo(source, t));
  }

  // Array compatibility.
  if (source.kind === "array" && target.kind === "array") {
    // readonly source can't go to mutable target.
    if (source.readonly_ && !target.readonly_) return false;
    return isAssignableTo(source.elementType, target.elementType);
  }

  // Map compatibility.
  if (source.kind === "map" && target.kind === "map") {
    if (source.readonly_ && !target.readonly_) return false;
    return isAssignableTo(source.keyType, target.keyType)
      && isAssignableTo(source.valueType, target.valueType);
  }

  // Set compatibility.
  if (source.kind === "set" && target.kind === "set") {
    if (source.readonly_ && !target.readonly_) return false;
    return isAssignableTo(source.elementType, target.elementType);
  }

  // Tuple compatibility.
  if (source.kind === "tuple" && target.kind === "tuple") {
    if (source.elements.length !== target.elements.length) return false;
    return source.elements.every((s, i) => isAssignableTo(s, target.elements[i]));
  }

  // Function compatibility (contra-variant params, co-variant return).
  if (source.kind === "function" && target.kind === "function") {
    if (source.params.length !== target.params.length) return false;
    // Params are contra-variant: target param types must be assignable to source param types.
    for (let i = 0; i < source.params.length; i++) {
      if (!isAssignableTo(target.params[i].type, source.params[i].type)) return false;
    }
    // Return is co-variant.
    return isAssignableTo(source.returnType, target.returnType);
  }

  // Class → class: nominal — must be same class.
  if (source.kind === "class" && target.kind === "class") {
    return source.symbol.name === target.symbol.name
      && source.symbol.module === target.symbol.module;
  }

  // Class → interface: structural — class must have all interface fields and methods.
  if (source.kind === "class" && target.kind === "interface") {
    return classImplementsInterface(source, target);
  }

  // Enum: nominal.
  if (source.kind === "enum" && target.kind === "enum") {
    return source.symbol.name === target.symbol.name
      && source.symbol.module === target.symbol.module;
  }

  // Weak compatibility.
  if (source.kind === "weak" && target.kind === "weak") {
    return isAssignableTo(source.inner, target.inner);
  }

  // Result compatibility: co-variant success, co-variant error.
  if (source.kind === "result" && target.kind === "result") {
    return isAssignableTo(source.successType, target.successType)
      && isAssignableTo(source.errorType, target.errorType);
  }

  // Success/Failure wrapper compatibility.
  if (source.kind === "success-wrapper" && target.kind === "success-wrapper") {
    return isAssignableTo(source.valueType, target.valueType);
  }
  if (source.kind === "failure-wrapper" && target.kind === "failure-wrapper") {
    return isAssignableTo(source.errorType, target.errorType);
  }

  return false;
}

/**
 * Check numeric widening rules.
 * Safe widenings: int→long, int→float, int→double, long→double, float→double.
 */
function isNumericWidening(source: PrimitiveName, target: PrimitiveName): boolean {
  if (source === target) return true;
  const widenings: Record<string, Set<string>> = {
    byte:   new Set(["int", "long", "float", "double"]),
    int:    new Set(["long", "float", "double"]),
    long:   new Set(["double"]),
    float:  new Set(["double"]),
  };
  return widenings[source]?.has(target) ?? false;
}

/** Structural check: does the class have all fields and methods required by the interface? */
function classImplementsInterface(source: ClassType, target: InterfaceType): boolean {
  const classDecl = source.symbol.declaration;
  const ifaceDecl = target.symbol.declaration;

  // Check interface fields.
  for (const iField of ifaceDecl.fields) {
    const classField = classDecl.fields.find((f) => f.names.includes(iField.name));
    if (!classField) return false;
    // If interface field is readonly, class field must also be readonly or const.
    if (iField.readonly_ && !classField.readonly_ && !classField.const_) return false;
  }

  // Check interface methods.
  for (const iMethod of ifaceDecl.methods) {
    const classMethod = classDecl.methods.find((m) => m.name === iMethod.name && m.static_ === iMethod.static_);
    if (!classMethod) return false;
    // Parameter count must match.
    if (classMethod.params.length !== iMethod.params.length) return false;
  }

  return true;
}

/** Check whether two types are structurally equal. */
export function typesEqual(a: ResolvedType, b: ResolvedType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "json-value":
      return true;
    case "primitive":
      return a.name === (b as PrimitiveType).name;
    case "builtin-namespace":
      return a.name === (b as BuiltinNamespaceType).name;
    case "class": {
      const bc = b as ClassType;
      if (a.symbol.name !== bc.symbol.name || a.symbol.module !== bc.symbol.module) return false;
      const aArgs = a.typeArgs ?? [];
      const bArgs = bc.typeArgs ?? [];
      if (aArgs.length !== bArgs.length) return false;
      return aArgs.every((t, i) => typesEqual(t, bArgs[i]));
    }
    case "interface": {
      const bi = b as InterfaceType;
      if (a.symbol.name !== bi.symbol.name || a.symbol.module !== bi.symbol.module) return false;
      const aArgs = a.typeArgs ?? [];
      const bArgs = bi.typeArgs ?? [];
      if (aArgs.length !== bArgs.length) return false;
      return aArgs.every((t, i) => typesEqual(t, bArgs[i]));
    }
    case "enum":
      return a.symbol.name === (b as EnumType).symbol.name
        && a.symbol.module === (b as EnumType).symbol.module;
    case "function": {
      const bf = b as FunctionResolvedType;
      if (a.params.length !== bf.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!typesEqual(a.params[i].type, bf.params[i].type)) return false;
      }
      return typesEqual(a.returnType, bf.returnType);
    }
    case "array": {
      const ba = b as ArrayResolvedType;
      return a.readonly_ === ba.readonly_ && typesEqual(a.elementType, ba.elementType);
    }
    case "map": {
      const bm = b as MapResolvedType;
      return typesEqual(a.keyType, bm.keyType) && typesEqual(a.valueType, bm.valueType);
    }
    case "set": {
      const bs = b as SetResolvedType;
      return a.readonly_ === bs.readonly_ && typesEqual(a.elementType, bs.elementType);
    }
    case "union": {
      const bu = b as UnionResolvedType;
      if (a.types.length !== bu.types.length) return false;
      return a.types.every((t, i) => typesEqual(t, bu.types[i]));
    }
    case "tuple": {
      const bt = b as TupleResolvedType;
      if (a.elements.length !== bt.elements.length) return false;
      return a.elements.every((t, i) => typesEqual(t, bt.elements[i]));
    }
    case "weak":
      return typesEqual(a.inner, (b as WeakResolvedType).inner);
    case "null":
    case "void":
    case "unknown":
      return true;
    case "namespace":
      return a.sourceModule === (b as NamespaceType).sourceModule;
    case "actor":
      return typesEqual(a.innerClass, (b as ActorType).innerClass);
    case "promise":
      return typesEqual(a.valueType, (b as PromiseType).valueType);
    case "result": {
      const br = b as ResultResolvedType;
      return typesEqual(a.successType, br.successType)
        && typesEqual(a.errorType, br.errorType);
    }
    case "success-wrapper":
      return typesEqual(a.valueType, (b as SuccessWrapperType).valueType);
    case "failure-wrapper":
      return typesEqual(a.errorType, (b as FailureWrapperType).errorType);
    case "typevar":
      return a.name === (b as TypeVariableType).name;
    case "class-metadata":
      return b.kind === "class-metadata" && typesEqual(a.classType, b.classType);
    case "method-reflection":
      return b.kind === "method-reflection" && typesEqual(a.classType, b.classType);
  }
}

// ============================================================================
// Else-narrow type computation
// ============================================================================

/**
 * Compute the narrowed "happy path" type for an else-narrow statement.
 *
 * Applicable to Result and/or nullable types only.
 * Algorithm:
 * 1. Strip null from the type
 * 2. If the remaining type is Result<S, E>: happy path = strip null from S
 * 3. Else if null was stripped: happy path = remaining type
 * 4. Otherwise: not applicable
 */
export function computeElseNarrowType(
  type: ResolvedType,
): { narrowedType: ResolvedType; applicable: boolean } {
  // Step 1: strip null
  const { stripped, hadNull } = stripNull(type);

  // Step 2: if Result, extract success type and strip null from it
  if (stripped.kind === "result") {
    const innerStripped = stripNull(stripped.successType).stripped;
    return { narrowedType: innerStripped, applicable: true };
  }

  // Step 3: if null was stripped, return non-null type
  if (hadNull) {
    return { narrowedType: stripped, applicable: true };
  }

  // Step 4: not applicable
  return { narrowedType: type, applicable: false };
}

/** Strip null from a type, returning the remainder and whether null was present. */
function stripNull(type: ResolvedType): { stripped: ResolvedType; hadNull: boolean } {
  if (type.kind === "null") {
    return { stripped: { kind: "unknown" }, hadNull: true };
  }
  if (type.kind !== "union") {
    return { stripped: type, hadNull: false };
  }
  const hasNull = type.types.some((t) => t.kind === "null");
  if (!hasNull) {
    return { stripped: type, hadNull: false };
  }
  const nonNull = type.types.filter((t) => t.kind !== "null");
  if (nonNull.length === 0) return { stripped: { kind: "unknown" }, hadNull: true };
  if (nonNull.length === 1) return { stripped: nonNull[0], hadNull: true };
  return { stripped: { kind: "union", types: nonNull }, hadNull: true };
}

// ============================================================================
// Type parameter substitution
// ============================================================================

/**
 * Substitute type variables with concrete types.
 * Used when instantiating generic classes, functions, and type aliases.
 */
export function substituteTypeParams(
  type: ResolvedType,
  paramMap: Map<string, ResolvedType>,
): ResolvedType {
  switch (type.kind) {
    case "typevar":
      return paramMap.get(type.name) ?? type;
    case "array":
      return {
        kind: "array",
        elementType: substituteTypeParams(type.elementType, paramMap),
        readonly_: type.readonly_,
      };
    case "set":
      return {
        kind: "set",
        elementType: substituteTypeParams(type.elementType, paramMap),
        readonly_: type.readonly_,
      };
    case "union":
      return {
        kind: "union",
        types: type.types.map((t) => substituteTypeParams(t, paramMap)),
      };
    case "tuple":
      return {
        kind: "tuple",
        elements: type.elements.map((t) => substituteTypeParams(t, paramMap)),
      };
    case "function":
      return {
        kind: "function",
        params: type.params.map((p) => ({
          name: p.name,
          type: substituteTypeParams(p.type, paramMap),
          hasDefault: p.hasDefault,
          defaultValue: p.defaultValue,
        })),
        returnType: substituteTypeParams(type.returnType, paramMap),
        typeParams: type.typeParams,
      };
    case "weak":
      return { kind: "weak", inner: substituteTypeParams(type.inner, paramMap) };
    case "class":
      if (type.typeArgs && type.typeArgs.length > 0) {
        return {
          kind: "class",
          symbol: type.symbol,
          typeArgs: type.typeArgs.map((t) => substituteTypeParams(t, paramMap)),
        };
      }
      return type;
    case "interface":
      if (type.typeArgs && type.typeArgs.length > 0) {
        return {
          kind: "interface",
          symbol: type.symbol,
          typeArgs: type.typeArgs.map((t) => substituteTypeParams(t, paramMap)),
        };
      }
      return type;
    case "result":
      return {
        kind: "result",
        successType: substituteTypeParams(type.successType, paramMap),
        errorType: substituteTypeParams(type.errorType, paramMap),
      };
    case "promise":
      return { kind: "promise", valueType: substituteTypeParams(type.valueType, paramMap) };
    case "actor":
      return { kind: "actor", innerClass: substituteTypeParams(type.innerClass, paramMap) as ClassType };
    default:
      return type;
  }
}

// ============================================================================
// JSON serialization support
// ============================================================================

/**
 * Check whether a resolved type can be serialized to / deserialized from JSON.
 *
 * Serializable types:
 *   - primitives (int, long, float, double, string, char, bool)
 *   - null
 *   - classes (if all fields are serializable)
 *   - arrays (if element type is serializable)
 *   - tuples (if all element types are serializable)
 *   - enums
 *   - unions where all members are serializable (e.g., T | null)
 *
 * Non-serializable types:
 *   - function, void, weak, actor, promise, result, unknown, namespace,
 *     success-wrapper, failure-wrapper
 *
 * @param visited — set of class names already being checked (prevents infinite recursion)
 */
export function isJSONSerializable(
  type: ResolvedType,
  visited: Set<string> = new Set(),
): boolean {
  switch (type.kind) {
    case "json-value":
      return true;
    case "primitive":
    case "null":
    case "enum":
      return true;

    case "class": {
      // Guard against circular references
      const key = `${type.symbol.module}::${type.symbol.name}`;
      if (visited.has(key)) return true; // assume OK for cycles
      visited.add(key);
      for (const field of type.symbol.declaration.fields) {
        if (field.type) {
          // We need to resolve the type annotation to check serializability.
          // Since we only have the AST annotation here, we use resolvedType if available.
          if (field.resolvedType && !isJSONSerializable(field.resolvedType, visited)) {
            return false;
          }
        }
      }
      return true;
    }

    case "array":
      return isJSONSerializable(type.elementType, visited);

    case "map":
      return isJSONSerializable(type.keyType, visited)
        && isJSONSerializable(type.valueType, visited);

    case "set":
      return false;

    case "tuple":
      return type.elements.every((e) => isJSONSerializable(e, visited));

    case "union":
      return type.types.every((t) => isJSONSerializable(t, visited));

    case "interface":
      // Interfaces are serializable if used for fromJsonValue (checked separately for discriminator).
      // Individual class variants are checked at point of use.
      return true;

    case "function":
    case "void":
    case "weak":
    case "actor":
    case "promise":
    case "result":
    case "unknown":
    case "builtin-namespace":
    case "namespace":
    case "success-wrapper":
    case "failure-wrapper":
    case "typevar":
    case "class-metadata":
    case "method-reflection":
      return false;
  }
}

function isAssignableToJsonValue(source: ResolvedType): boolean {
  switch (source.kind) {
    case "json-value":
    case "null":
      return true;

    case "primitive":
      return source.name === "bool"
        || source.name === "byte"
        || source.name === "int"
        || source.name === "long"
        || source.name === "float"
        || source.name === "double"
        || source.name === "string";

    case "array":
      return source.elementType.kind === "json-value";

    case "map":
      return source.keyType.kind === "primitive"
        && source.keyType.name === "string"
        && source.valueType.kind === "json-value";

    case "union":
      return source.types.every((type) => isAssignableTo(type, JSON_VALUE_TYPE));

    default:
      return false;
  }
}

/**
 * Collect non-serializable field names and their type strings from a class.
 * Returns an array of `{ fieldName, typeStr }` for fields that cannot be
 * serialized to JSON.
 */
export function collectNonSerializableFields(
  classType: ClassType,
): { fieldName: string; typeStr: string }[] {
  const result: { fieldName: string; typeStr: string }[] = [];
  for (const field of classType.symbol.declaration.fields) {
    if (field.resolvedType && !isJSONSerializable(field.resolvedType)) {
      for (const name of field.names) {
        result.push({ fieldName: name, typeStr: typeToString(field.resolvedType) });
      }
    }
  }
  return result;
}

/**
 * Find a shared const string discriminator field across a set of class symbols.
 *
 * Returns the field name and a map of value → class symbol, or null if no
 * valid shared discriminator exists.
 *
 * Requirements:
 *   - Every class must have a `const` field with the same name
 *   - The field must have a string default value
 *   - All values must be distinct
 */
export function findSharedDiscriminator(
  classes: ClassSymbol[],
): { fieldName: string; valueMap: Map<string, ClassSymbol> } | null {
  if (classes.length === 0) return null;

  // Collect all const field names from the first class
  const firstClass = classes[0];
  const constFields = firstClass.declaration.fields.filter((f) => f.const_);

  for (const constField of constFields) {
    const fieldName = constField.names[0]; // const fields have exactly one name
    if (!fieldName) continue;

    // Check if every class has this const field with a distinct string value
    const valueMap = new Map<string, ClassSymbol>();
    let valid = true;

    for (const cls of classes) {
      const matchingField = cls.declaration.fields.find(
        (f) => f.const_ && f.names.includes(fieldName),
      );
      if (!matchingField || !matchingField.defaultValue) {
        valid = false;
        break;
      }

      // Extract the string value from the default expression
      const defaultExpr = matchingField.defaultValue;
      if (defaultExpr.kind !== "string-literal") {
        valid = false;
        break;
      }
      // String literal parts: for simple strings, parts is a single string element
      const value = defaultExpr.parts
        .filter((p): p is string => typeof p === "string")
        .join("");

      if (valueMap.has(value)) {
        valid = false; // duplicate value
        break;
      }
      valueMap.set(value, cls);
    }

    if (valid && valueMap.size === classes.length) {
      return { fieldName, valueMap };
    }
  }

  return null;
}
