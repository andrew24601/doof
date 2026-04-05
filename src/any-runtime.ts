import type { ClassDeclaration } from "./ast.js";
import type { AnalysisResult } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import {
  type ResolvedType,
  STRING_TYPE,
  typeToString,
} from "./checker-types.js";
import { emitType } from "./emitter-types.js";
import type { ClassSymbol, InterfaceSymbol, ModuleSymbolTable } from "./types.js";

export interface AnyCarrierSpec {
  key: string;
  type: ResolvedType;
  valueCppType: string;
  carrierCppType: string;
  boxed: boolean;
  aliasName?: string;
}

export interface AnyRuntimePlan {
  usesAny: boolean;
  carriers: AnyCarrierSpec[];
  carrierByKey: Map<string, AnyCarrierSpec>;
  interfaceImpls: Map<string, ClassSymbol[]>;
}

const ANY_PLAN_CACHE = new WeakMap<AnalysisResult, AnyRuntimePlan>();

export function buildAnyRuntimePlan(analysisResult: AnalysisResult): AnyRuntimePlan {
  const cached = ANY_PLAN_CACHE.get(analysisResult);
  if (cached) return cached;

  ensureAnyUsageByModule(analysisResult);

  const interfaceImpls = buildInterfaceImplMap(analysisResult);
  const usageByModule = analysisResult.anyUsageByModule;

  let usesAny = false;
  const pending: AnyCarrierSpec[] = [];
  const pendingKeys = new Set<string>();

  const addCarrier = (type: ResolvedType): void => {
    const normalized = normalizeForAnyStorage(type, interfaceImpls);
    for (const candidate of normalized) {
      if (!isConcreteAnyCarrier(candidate)) continue;
      const key = typeToString(candidate);
      if (pendingKeys.has(key)) continue;
      pendingKeys.add(key);
      pending.push({
        key,
        type: candidate,
        valueCppType: emitType(candidate),
        carrierCppType: "",
        boxed: shouldBoxAnyCarrier(candidate),
      });
    }
  };

  for (const [modulePath] of analysisResult.modules) {
    const usage = usageByModule.get(modulePath);
    if (!usage) {
      throw new Error(`Missing type-checker any-usage for module "${modulePath}"`);
    }
    usesAny = usesAny || usage.usesAny;
    for (const [, type] of usage.observedTypes) {
      addCarrier(type);
    }
  }

  usesAny = collectMetadataInvokeTypes(analysisResult, addCarrier) || usesAny;

  if (!usesAny) {
    const plan = {
      usesAny: false,
      carriers: [],
      carrierByKey: new Map(),
      interfaceImpls,
    };
    ANY_PLAN_CACHE.set(analysisResult, plan);
    return plan;
  }

  const carriers = pending.map((carrier, index) => {
    if (!carrier.boxed) {
      return {
        ...carrier,
        carrierCppType: carrier.valueCppType,
      };
    }

    const aliasName = `AnyBox${index}`;
    return {
      ...carrier,
      aliasName,
      carrierCppType: `doof::${aliasName}`,
    };
  });

  const plan = {
    usesAny,
    carriers,
    carrierByKey: new Map(carriers.map((carrier) => [carrier.key, carrier])),
    interfaceImpls,
  };
  ANY_PLAN_CACHE.set(analysisResult, plan);
  return plan;
}

function ensureAnyUsageByModule(analysisResult: AnalysisResult): void {
  if (analysisResult.anyUsageByModule.size >= analysisResult.modules.size) return;

  const checker = new TypeChecker(analysisResult);
  for (const [modulePath] of analysisResult.modules) {
    if (analysisResult.anyUsageByModule.has(modulePath)) continue;
    checker.checkModule(modulePath);
  }
}

function collectMetadataInvokeTypes(
  analysisResult: AnalysisResult,
  addCarrier: (type: ResolvedType) => void,
): boolean {
  let needsAny = false;

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      const decl = stmt.kind === "export-declaration" ? stmt.declaration : stmt;
      if (decl.kind !== "class-declaration" || !decl.needsMetadata) continue;

      needsAny = true;
      addCarrier(STRING_TYPE);

      for (const method of decl.methods) {
        if (method.private_ || method.static_ || !method.resolvedType || method.resolvedType.kind !== "function") {
          continue;
        }
        const retType = method.resolvedType.returnType;
        if (retType.kind === "result") {
          addCarrier(retType.errorType);
        }
      }
    }
  }

  return needsAny;
}

export function renderAnyRuntimeSupport(plan: AnyRuntimePlan): string {
  const lines: string[] = [];
  const forwardDecls = renderAnyForwardDeclarations(plan);

  if (forwardDecls.length > 0) {
    lines.push("} // namespace doof");
    lines.push("");
    lines.push(...forwardDecls);
    lines.push("");
    lines.push("namespace doof {");
    lines.push("");
  }

  lines.push("// ============================================================================");
  lines.push("// Any — closed-world dynamic value carrier");
  lines.push("// ============================================================================");
  lines.push("");
  lines.push("struct Any;");
  for (const carrier of plan.carriers) {
    if (!carrier.boxed || !carrier.aliasName) continue;
    lines.push(`using ${carrier.aliasName} = std::shared_ptr<${carrier.valueCppType}>;`);
  }
  lines.push("");
  lines.push("template <typename T, typename = void>");
  lines.push("struct AnyValueHasher {");
  lines.push("    size_t operator()(const T&) const noexcept { return 0; }");
  lines.push("};");
  lines.push("");
  lines.push("template <typename T>");
  lines.push("struct AnyValueHasher<T, std::enable_if_t<std::is_enum_v<T>>> {");
  lines.push("    size_t operator()(const T& value) const noexcept {");
  lines.push("        using Underlying = std::underlying_type_t<T>;");
  lines.push("        return std::hash<Underlying>{}(static_cast<Underlying>(value));");
  lines.push("    }");
  lines.push("};");
  lines.push("");
  lines.push("template <typename T>");
  lines.push("struct AnyValueHasher<T, std::void_t<decltype(std::hash<T>{}(std::declval<const T&>()))>> {");
  lines.push("    size_t operator()(const T& value) const noexcept {");
  lines.push("        return std::hash<T>{}(value);");
  lines.push("    }");
  lines.push("};");
  lines.push("");
  lines.push("inline size_t any_hash_combine(size_t left, size_t right) {");
  lines.push("    return left ^ (right + 0x9e3779b97f4a7c15ULL + (left << 6) + (left >> 2));");
  lines.push("}");
  lines.push("");
  lines.push("struct Any {");
  lines.push("    using Storage = std::variant<std::monostate");
  for (const carrier of plan.carriers) {
    lines.push(`        , ${carrier.carrierCppType}`);
  }
  lines.push("    >;");
  lines.push("");
  lines.push("    Storage value;");
  lines.push("");
  lines.push("    Any() : value(std::monostate{}) {}");
  lines.push("    Any(std::nullptr_t) : value(std::monostate{}) {}");
  lines.push("    Any(const Any&) = default;");
  lines.push("    Any(Any&&) noexcept = default;");
  lines.push("    Any& operator=(const Any&) = default;");
  lines.push("    Any& operator=(Any&&) noexcept = default;");
  lines.push("");
  lines.push("    template <typename T, typename D = std::decay_t<T>, std::enable_if_t<!std::is_same_v<D, Any>, int> = 0>");
  lines.push("    Any(T&& input) : value(std::forward<T>(input)) {}");
  lines.push("");
  lines.push("    bool isNull() const { return std::holds_alternative<std::monostate>(value); }");
  lines.push("};");
  lines.push("");
  lines.push("inline bool operator==(const Any& left, const Any& right) {");
  lines.push("    return left.value == right.value;");
  lines.push("}");
  lines.push("");
  lines.push("template <typename T>");
  lines.push("inline bool any_is(const Any& value) {");
  lines.push("    return std::holds_alternative<T>(value.value);");
  lines.push("}");
  lines.push("");
  lines.push("template <typename T>");
  lines.push("inline T any_cast(const Any& value) {");
  lines.push("    return std::get<T>(value.value);");
  lines.push("}");
  lines.push("");
  lines.push("inline size_t any_hash(const Any& value) {");
  lines.push("    return std::visit([](const auto& inner) -> size_t {");
  lines.push("        using T = std::decay_t<decltype(inner)>;");
  lines.push("        return any_hash_combine(typeid(T).hash_code(), AnyValueHasher<T>{}(inner));");
  lines.push("    }, value.value);");
  lines.push("}");
  lines.push("");
  lines.push("} // namespace doof");
  lines.push("");
  lines.push("namespace std {");
  lines.push("template <>");
  lines.push("struct hash<doof::Any> {");
  lines.push("    size_t operator()(const doof::Any& value) const noexcept {");
  lines.push("        return doof::any_hash(value);");
  lines.push("    }");
  lines.push("};");
  lines.push("} // namespace std");
  lines.push("");
  lines.push("namespace doof {");

  return lines.join("\n");
}

function shouldBoxAnyCarrier(type: ResolvedType): boolean {
  switch (type.kind) {
    case "tuple":
    case "function":
    case "weak":
    case "promise":
    case "result":
    case "class-metadata":
    case "method-reflection":
      return true;
    default:
      return false;
  }
}

function normalizeForAnyStorage(
  type: ResolvedType,
  interfaceImpls: Map<string, ClassSymbol[]>,
): ResolvedType[] {
  switch (type.kind) {
    case "any":
    case "null":
    case "void":
    case "unknown":
    case "builtin-namespace":
    case "namespace":
    case "success-wrapper":
    case "failure-wrapper":
    case "class-metadata":
    case "method-reflection":
      return [];

    case "interface":
      return (interfaceImpls.get(type.symbol.name) ?? []).map((symbol) => ({ kind: "class" as const, symbol }));

    case "union":
      return type.types.flatMap((member) => normalizeForAnyStorage(member, interfaceImpls));

    default:
      return [type];
  }
}

function isConcreteAnyCarrier(type: ResolvedType): boolean {
  switch (type.kind) {
    case "any":
    case "unknown":
    case "void":
    case "builtin-namespace":
    case "namespace":
    case "success-wrapper":
    case "failure-wrapper":
    case "typevar":
      return false;

    case "primitive":
    case "json-value":
    case "enum":
    case "null":
      return true;

    case "class":
    case "interface":
      return (type.typeArgs ?? []).every(isConcreteAnyCarrier);

    case "array":
      return isConcreteAnyCarrier(type.elementType);

    case "map":
      return isConcreteAnyCarrier(type.keyType) && isConcreteAnyCarrier(type.valueType);

    case "set":
      return false;

    case "union":
      return type.types.every(isConcreteAnyCarrier);

    case "tuple":
      return type.elements.every(isConcreteAnyCarrier);

    case "weak":
      return isConcreteAnyCarrier(type.inner);

    case "function":
      return type.params.every((param) => isConcreteAnyCarrier(param.type))
        && isConcreteAnyCarrier(type.returnType);

    case "actor":
      return isConcreteAnyCarrier(type.innerClass);

    case "promise":
      return isConcreteAnyCarrier(type.valueType);

    case "result":
      return isConcreteAnyCarrier(type.successType) && isConcreteAnyCarrier(type.errorType);

    case "class-metadata":
    case "method-reflection":
      return false;
  }
}

function renderAnyForwardDeclarations(plan: AnyRuntimePlan): string[] {
  const decls = new Map<string, string>();
  for (const carrier of plan.carriers) {
    collectAnyForwardDeclarations(carrier.type, decls);
  }
  return [...decls.values()];
}

function collectAnyForwardDeclarations(type: ResolvedType, decls: Map<string, string>): void {
  switch (type.kind) {
    case "class": {
      const name = type.symbol.extern_?.cppName ?? type.symbol.name;
      if (!decls.has(name)) {
        const typeParams = type.symbol.declaration.typeParams;
        if (typeParams.length === 0) {
          decls.set(name, `struct ${name};`);
        } else {
          const params = typeParams.map((_, index) => `typename T${index}`).join(", ");
          decls.set(name, `template <${params}> struct ${name};`);
        }
      }
      for (const arg of type.typeArgs ?? []) collectAnyForwardDeclarations(arg, decls);
      break;
    }

    case "array":
      collectAnyForwardDeclarations(type.elementType, decls);
      break;

    case "map":
      collectAnyForwardDeclarations(type.keyType, decls);
      collectAnyForwardDeclarations(type.valueType, decls);
      break;

    case "set":
      collectAnyForwardDeclarations(type.elementType, decls);
      break;

    case "union":
      for (const member of type.types) collectAnyForwardDeclarations(member, decls);
      break;

    case "tuple":
      for (const element of type.elements) collectAnyForwardDeclarations(element, decls);
      break;

    case "weak":
      collectAnyForwardDeclarations(type.inner, decls);
      break;

    case "function":
      for (const param of type.params) collectAnyForwardDeclarations(param.type, decls);
      collectAnyForwardDeclarations(type.returnType, decls);
      break;

    case "actor":
      collectAnyForwardDeclarations(type.innerClass, decls);
      break;

    case "promise":
      collectAnyForwardDeclarations(type.valueType, decls);
      break;

    case "result":
      collectAnyForwardDeclarations(type.successType, decls);
      collectAnyForwardDeclarations(type.errorType, decls);
      break;

    default:
      break;
  }
}

function buildInterfaceImplMap(
  analysisResult: AnalysisResult,
): Map<string, ClassSymbol[]> {
  const impls = new Map<string, ClassSymbol[]>();
  const interfaces: InterfaceSymbol[] = [];
  const classes: ClassSymbol[] = [];

  for (const [, table] of analysisResult.modules) {
    collectSymbols(table, interfaces, classes);
  }

  for (const iface of interfaces) {
    const implementing: ClassSymbol[] = [];
    for (const cls of classes) {
      if (cls.declaration.implements_.includes(iface.name)) {
        implementing.push(cls);
        continue;
      }

      if (classStructurallyImplements(cls.declaration, iface.declaration)) {
        implementing.push(cls);
      }
    }
    impls.set(iface.name, implementing);
  }

  return impls;
}

function collectSymbols(
  table: ModuleSymbolTable,
  interfaces: InterfaceSymbol[],
  classes: ClassSymbol[],
): void {
  for (const [, sym] of table.symbols) {
    if (sym.symbolKind === "interface") {
      interfaces.push(sym);
    } else if (sym.symbolKind === "class") {
      classes.push(sym);
    }
  }
}

function classStructurallyImplements(
  cls: ClassDeclaration,
  iface: InterfaceSymbol["declaration"],
): boolean {
  for (const field of iface.fields) {
    const classField = cls.fields.find((candidate) => candidate.names.includes(field.name));
    if (!classField) return false;
  }

  for (const method of iface.methods) {
    const classMethod = cls.methods.find((candidate) => candidate.name === method.name && candidate.static_ === method.static_);
    if (!classMethod) return false;
    if (classMethod.params.length !== method.params.length) return false;
  }

  return true;
}