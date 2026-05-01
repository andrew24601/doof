/**
 * C++ declaration emission — converts Doof AST declaration nodes to C++ code.
 *
 * Handles function declarations, class/interface/enum declarations, and
 * type aliases. Delegates JSON serialization to emitter-json.ts.
 */

import type {
  FunctionDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  TypeAliasDeclaration,
  Parameter,
  ClassField,
  Expression,
  TypeAnnotation,
} from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { isJSONSerializable, findSharedDiscriminator } from "./checker-types.js";
import { emitType, emitInnerType } from "./emitter-types.js";
import { substituteEmitType } from "./emitter-monomorphize.js";
import { emitExpression, indent, emitIdentifierSafe, scanCapturedMutables } from "./emitter-expr.js";
import type { EmitContext } from "./emitter-context.js";
import { emitBlockStatements } from "./emitter-stmt.js";
import { emitToJSON, emitFromJSON, emitInterfaceFromJSON, emitTypeAliasFromJSON } from "./emitter-json.js";
import { emitMetadataDeclaration, emitMetadataDefinition } from "./emitter-metadata.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import type { ClassSymbol } from "./types.js";

// ============================================================================
// Template helpers
// ============================================================================

/** Emit `template<typename T, typename U>` prefix if the declaration has type params. */
function emitTemplatePrefix(typeParams: string[], ind: string): string | null {
  if (typeParams.length === 0) return null;
  const parts = typeParams.map((p) => `typename ${p}`).join(", ");
  return `${ind}template<${parts}>`;
}

function collectTypeAliasClassSymbols(typeAnn: TypeAnnotation): ClassSymbol[] | null {
  if (typeAnn.kind === "named-type") {
    const sym = typeAnn.resolvedSymbol;
    if (!sym) return null;
    if (sym.symbolKind === "class") return [sym];
    if (sym.symbolKind === "type-alias") return collectTypeAliasClassSymbols(sym.declaration.type);
    return null;
  }

  if (typeAnn.kind !== "union-type") return null;

  const members: ClassSymbol[] = [];
  const seen = new Set<string>();
  for (const inner of typeAnn.types) {
    const innerMembers = collectTypeAliasClassSymbols(inner);
    if (!innerMembers || innerMembers.length === 0) return null;
    for (const member of innerMembers) {
      const key = `${member.module}:${member.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(member);
    }
  }
  return members;
}

// ============================================================================
// Functions
// ============================================================================

export function emitFunctionDecl(decl: FunctionDeclaration, ctx: EmitContext): void {
  const ind = indent(ctx);
  const name = ctx.qualifiedFunctionName ?? emitIdentifierSafe(ctx.functionNameOverride ?? decl.name);
  const resolvedDeclType = substituteEmitType(decl.resolvedType, ctx);
  const inlinePrefix = ctx.forceInline ? "inline " : "";

  // Emit description comment
  if (decl.description) {
    ctx.sourceLines.push(`${ind}// ${decl.description}`);
  }
  // Emit parameter description comments
  const paramDescs = decl.params.filter((p) => p.description);
  if (paramDescs.length > 0) {
    for (const p of paramDescs) {
      ctx.sourceLines.push(`${ind}// @param ${p.name} ${p.description}`);
    }
  }

  // Emit template prefix for generic functions
  const tpl = ctx.suppressTemplatePrefix ? null : emitTemplatePrefix(decl.typeParams, ind);
  if (tpl) ctx.sourceLines.push(tpl);

  // Determine return type
  const retType = resolvedDeclType && resolvedDeclType.kind === "function"
    ? emitType(resolvedDeclType.returnType)
    : "auto";

  // Build parameter list
  const includeDefaults = ctx.emitParameterDefaults ?? true;
  const params = decl.params.map((p) => emitParam(p, ctx, includeDefaults)).join(", ");

  // Emit function signature
  // Note: we don't emit const on methods. Tracking which methods are
  // pure readers vs mutators is complex, and const prevents any field
  // mutation.  We can add fine-grained const later if needed.
  const staticPrefix = ctx.inClass && decl.static_ ? "static " : "";
  const mockCall = resolvedDeclType && resolvedDeclType.kind === "function"
    ? resolvedDeclType.mockCall
    : undefined;

  if (decl.body.kind === "block") {
    ctx.sourceLines.push(`${ind}${inlinePrefix}${staticPrefix}${retType} ${name}(${params}) {`);
    const fnRetType = resolvedDeclType && resolvedDeclType.kind === "function"
      ? resolvedDeclType.returnType
      : undefined;
    emitMockRecordingPrelude(decl, mockCall, ctx);
    if (decl.bodyless) {
      ctx.sourceLines.push(`${ind}    doof::panic("Unexpected mock function invoked: ${decl.name}");`);
      ctx.sourceLines.push(`${ind}}`);
      return;
    }
    // Pre-scan for let variables captured by lambdas → heap-box them
    const paramNameSet = new Set(decl.params.map((p) => p.name));
    const capturedMutables = scanCapturedMutables(decl.body, paramNameSet);
    emitBlockStatements(decl.body, {
      ...ctx,
      indent: ctx.indent + 1,
      currentFunctionReturnType: fnRetType,
      capturedMutables: capturedMutables.size > 0 ? capturedMutables : undefined,
    });
    ctx.sourceLines.push(`${ind}}`);
  } else {
    // Expression body → return wrapper
    const fnRetType = resolvedDeclType && resolvedDeclType.kind === "function"
      ? resolvedDeclType.returnType
      : undefined;
    const body = emitExpression(decl.body as Expression, ctx, fnRetType);
    ctx.sourceLines.push(`${ind}${inlinePrefix}${staticPrefix}${retType} ${name}(${params}) {`);
    emitMockRecordingPrelude(decl, mockCall, ctx);
    ctx.sourceLines.push(`${ind}    return ${body};`);
    ctx.sourceLines.push(`${ind}}`);
  }
}

export function emitFunctionPrototype(decl: FunctionDeclaration, ctx: EmitContext): void {
  const ind = indent(ctx);
  const name = emitIdentifierSafe(decl.name);
  const resolvedDeclType = substituteEmitType(decl.resolvedType, ctx);

  if (decl.description) {
    ctx.sourceLines.push(`${ind}// ${decl.description}`);
  }
  for (const param of decl.params) {
    if (param.description) {
      ctx.sourceLines.push(`${ind}// @param ${param.name} ${param.description}`);
    }
  }

  const tpl = emitTemplatePrefix(decl.typeParams, ind);
  if (tpl) ctx.sourceLines.push(tpl);

  const retType = resolvedDeclType && resolvedDeclType.kind === "function"
    ? emitType(resolvedDeclType.returnType)
    : "auto";
  const params = decl.params.map((p) => emitParam(p, ctx, false)).join(", ");
  const staticPrefix = ctx.inClass && decl.static_ ? "static " : "";
  ctx.sourceLines.push(`${ind}${staticPrefix}${retType} ${name}(${params});`);
}

export function emitParam(param: Parameter, _ctx: EmitContext, includeDefault = true): string {
  const resolvedType = substituteEmitType(param.resolvedType, _ctx);
  const pType = resolvedType ? emitType(resolvedType) : "auto";
  const name = emitIdentifierSafe(param.name);
  if (includeDefault && param.defaultValue) {
    const defaultVal = emitDefaultExpression(param.defaultValue, resolvedType ?? undefined);
    return `${pType} ${name} = ${defaultVal}`;
  }
  return `${pType} ${name}`;
}

// ============================================================================
// Classes
// ============================================================================

export function emitClassDecl(decl: ClassDeclaration, ctx: EmitContext): void {
  const ind = indent(ctx);
  const name = ctx.classNameOverride ?? emitIdentifierSafe(decl.name);
  const memberInd = indent({ indent: ctx.indent + 1 });

  // Emit description comment
  if (decl.description) {
    ctx.sourceLines.push(`${ind}// ${decl.description}`);
  }

  // Emit template prefix for generic classes
  const tpl = ctx.emitExplicitClassSpecialization
    ? `${ind}template<>`
    : emitTemplatePrefix(decl.typeParams, ind);
  if (tpl) ctx.sourceLines.push(tpl);

  ctx.sourceLines.push(`${ind}struct ${name} : public std::enable_shared_from_this<${name}> {`);

  // Fields
  for (const field of decl.fields) {
    emitClassField(field, { ...ctx, indent: ctx.indent + 1 });
  }

  const mockMethods = decl.methods.filter((method) => method.mock_);
  for (const method of mockMethods) {
    const mockCall = method.resolvedType && method.resolvedType.kind === "function"
      ? method.resolvedType.mockCall
      : undefined;
    if (!mockCall) continue;
    ctx.sourceLines.push(`${memberInd}std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName} = std::make_shared<std::vector<${emitType(mockCall.captureType)}>>();`);
  }

  // Constructor from fields (non-const, non-static fields)
  const constructorFields = decl.fields
    .filter((f) => !f.const_ && !f.static_)
    .flatMap((f) => f.names.map((n) => ({ name: n, field: f })));

  if (constructorFields.length > 0) {
    ctx.sourceLines.push("");
    // C++ requires that once a parameter has a default, all subsequent parameters must too.
    // Find the last field that has no default — only fields after it (in the trailing all-defaulted
    // suffix) are allowed to carry default argument values.
    const lastRequiredIdx = constructorFields.reduceRight(
      (acc: number, cf, idx) => (acc >= 0 ? acc : cf.field.defaultValue ? acc : idx),
      -1,
    );
    const ctorParams = constructorFields
      .map((cf, idx) => {
        let fType: string;
        const resolvedFieldType = substituteEmitType(cf.field.resolvedType, ctx);
        if (cf.field.weak_) {
          // weak fields get weak_ptr parameter type
          const innerName = resolvedFieldType?.kind === "class"
            ? resolvedFieldType.symbol.name
            : resolvedFieldType?.kind === "weak" && resolvedFieldType.inner.kind === "class"
              ? resolvedFieldType.inner.symbol.name
              : "auto";
          fType = `std::weak_ptr<${innerName}>`;
        } else {
          fType = resolvedFieldType ? emitType(resolvedFieldType) : "auto";
        }
        // Only emit a default if this field is in the trailing all-defaulted suffix
        if (idx > lastRequiredIdx && cf.field.defaultValue) {
          const defaultVal = emitExpression(cf.field.defaultValue, ctx, resolvedFieldType ?? undefined);
          return `${fType} ${emitIdentifierSafe(cf.name)} = ${defaultVal}`;
        }
        return `${fType} ${emitIdentifierSafe(cf.name)}`;
      })
      .join(", ");
    const initList = constructorFields
      .map((cf) => `${emitIdentifierSafe(cf.name)}(${emitIdentifierSafe(cf.name)})`)
      .join(", ");
    ctx.sourceLines.push(
      `${memberInd}${name}(${ctorParams}) : ${initList} {}`,
    );
  }

  // Methods
  if (decl.methods.length > 0) {
    ctx.sourceLines.push("");
    for (const method of decl.methods) {
      const methodCtx = { ...ctx, indent: ctx.indent + 1, inClass: true };
      if (ctx.emitMethodBodiesInline === false) {
        emitFunctionPrototype(method, methodCtx);
      } else {
        emitFunctionDecl(method, methodCtx);
      }
    }
  }

  // Destructor
  if (decl.destructor) {
    ctx.sourceLines.push("");
    ctx.sourceLines.push(`${memberInd}~${name}() {`);
    emitBlockStatements(decl.destructor, { ...ctx, indent: ctx.indent + 2 });
    ctx.sourceLines.push(`${memberInd}}`);
  }

  // JSON serialization methods (toJsonObject / fromJsonValue)
  // Only generate if the class was marked as needing JSON (on-demand)
  // AND all fields are JSON-serializable
  if (decl.needsJson) {
    const allFieldsSerializable = decl.fields.every((f) =>
      !f.weak_ && (!f.resolvedType || isJSONSerializable(f.resolvedType)),
    );
    if (allFieldsSerializable) {
      emitToJSON(decl, name, ctx);
      emitFromJSON(decl, name, ctx);
    }
  }

  // Metadata declaration (on-demand — definition emitted after class body)
  if (decl.needsMetadata) {
    emitMetadataDeclaration(name, ctx);
  }

  ctx.sourceLines.push(`${ind}};`);

  // Metadata definition (out-of-line, after class body so type is complete)
  if (decl.needsMetadata) {
    emitMetadataDefinition(decl, name, ctx);
  }
}

export function emitClassMethodDefinitions(decl: ClassDeclaration, ctx: EmitContext): void {
  const name = ctx.classNameOverride ?? emitIdentifierSafe(decl.name);

  for (const method of decl.methods) {
    emitFunctionDecl(method, {
      ...ctx,
      inClass: false,
      emitParameterDefaults: false,
      qualifiedFunctionName: `${name}::${emitIdentifierSafe(method.name)}`,
    });
    ctx.sourceLines.push("");
  }
}

function emitClassField(field: ClassField, ctx: EmitContext): void {
  const ind = indent(ctx);
  const resolvedFieldType = substituteEmitType(field.resolvedType, ctx);

  for (let fi = 0; fi < field.names.length; fi++) {
    const name = field.names[fi];
    const desc = field.descriptions[fi];
    const safeName = emitIdentifierSafe(name);

    // Emit field description comment
    if (desc) {
      ctx.sourceLines.push(`${ind}// ${desc}`);
    }

    if (field.const_) {
      const fType = resolvedFieldType ? emitType(resolvedFieldType) : "auto";
      if (field.defaultValue) {
        const val = emitExpression(field.defaultValue, ctx, resolvedFieldType ?? undefined);
        ctx.sourceLines.push(`${ind}const ${fType} ${safeName} = ${val};`);
      } else {
        ctx.sourceLines.push(`${ind}const ${fType} ${safeName};`);
      }
    } else if (field.static_) {
      const fType = resolvedFieldType ? emitType(resolvedFieldType) : "auto";
      if (field.defaultValue) {
        const val = emitExpression(field.defaultValue, ctx, resolvedFieldType ?? undefined);
        ctx.sourceLines.push(`${ind}static inline ${fType} ${safeName} = ${val};`);
      } else {
        ctx.sourceLines.push(`${ind}static inline ${fType} ${safeName}{};`);
      }
    } else if (field.weak_) {
      // weak field → std::weak_ptr
      // The checker may resolve the type as just the class type (since weak_ is a field modifier),
      // or as a wrapped weak type. Handle both cases.
      let innerType = "auto";
      if (resolvedFieldType) {
        if (resolvedFieldType.kind === "weak") {
          innerType = emitInnerType(resolvedFieldType.inner);
        } else if (resolvedFieldType.kind === "class") {
          innerType = resolvedFieldType.symbol.name;
        } else {
          innerType = emitType(resolvedFieldType);
        }
      }
      ctx.sourceLines.push(`${ind}std::weak_ptr<${innerType}> ${safeName};`);
    } else {
      const fType = resolvedFieldType ? emitType(resolvedFieldType) : "auto";
      if (field.defaultValue) {
        const val = emitExpression(field.defaultValue, ctx, resolvedFieldType ?? undefined);
        ctx.sourceLines.push(`${ind}${fType} ${safeName} = ${val};`);
      } else {
        ctx.sourceLines.push(`${ind}${fType} ${safeName};`);
      }
    }
  }
}

function emitMockRecordingPrelude(
  decl: FunctionDeclaration,
  mockCall: FunctionDeclaration["resolvedType"] extends infer T ? any : never,
  ctx: EmitContext,
): void {
  if (!decl.mock_ || !mockCall) return;

  const ind = indent({ indent: ctx.indent + 1 });
  const storageRef = ctx.inClass && !decl.static_
    ? `this->${mockCall.storageName}`
    : mockCall.storageName;
  const args = decl.params.map((param) => emitIdentifierSafe(param.name)).join(", ");
  const captureType = emitType(mockCall.captureType);
  if (args.length > 0) {
    ctx.sourceLines.push(`${ind}${storageRef}->push_back(${captureType}{${args}});`);
    return;
  }
  ctx.sourceLines.push(`${ind}${storageRef}->push_back(${captureType}{});`);
}

// ============================================================================
// Interfaces → std::variant
// ============================================================================

export function emitInterfaceDecl(decl: InterfaceDeclaration, ctx: EmitContext): void {
  const ind = indent(ctx);
  const name = emitIdentifierSafe(decl.name);

  // Emit description comment
  if (decl.description) {
    ctx.sourceLines.push(`${ind}// ${decl.description}`);
  }

  // Look up implementing classes from the pre-computed map
  const impls = ctx.interfaceImpls.get(decl.name);
  if (impls && impls.length > 0) {
    const variants = impls
      .map((cls) => `std::shared_ptr<${cls.name}>`)
      .join(", ");
    ctx.sourceLines.push(`${ind}using ${name} = std::variant<${variants}>;`);

    // Generate fromJsonValue dispatcher if the interface was marked as needing JSON (on-demand)
    // AND all implementors are JSON-serializable and have a shared discriminator
    if (decl.needsJson) {
      const allSerializable = impls.every((cls) =>
        cls.declaration.fields.every(
          (f) => !f.resolvedType || isJSONSerializable(f.resolvedType),
        ),
      );
      if (allSerializable) {
        const disc = findSharedDiscriminator(impls);
        if (disc) {
          emitInterfaceFromJSON(name, impls, disc, ctx);
        }
      }
    }
  } else {
    throw new Error(`Cannot emit interface "${decl.name}" without implementing classes`);
  }
}

// ============================================================================
// Enums
// ============================================================================

export function emitEnumDecl(decl: EnumDeclaration, ctx: EmitContext): void {
  const ind = indent(ctx);
  const name = emitIdentifierSafe(decl.name);

  // Emit description comment
  if (decl.description) {
    ctx.sourceLines.push(`${ind}// ${decl.description}`);
  }

  ctx.sourceLines.push(`${ind}enum class ${name} {`);
  for (let i = 0; i < decl.variants.length; i++) {
    const variant = decl.variants[i];
    const comma = i < decl.variants.length - 1 ? "," : "";
    if (variant.description) {
      ctx.sourceLines.push(`${ind}    // ${variant.description}`);
    }
    if (variant.value) {
      ctx.sourceLines.push(`${ind}    ${variant.name} = ${emitExpression(variant.value, ctx)}${comma}`);
    } else {
      ctx.sourceLines.push(`${ind}    ${variant.name}${comma}`);
    }
  }
  ctx.sourceLines.push(`${ind}};`);

  // Emit name helper
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline const char* ${name}_name(${name} _v) {`);
  ctx.sourceLines.push(`${ind}    switch (_v) {`);
  for (const variant of decl.variants) {
    ctx.sourceLines.push(`${ind}        case ${name}::${variant.name}: return "${variant.name}";`);
  }
  ctx.sourceLines.push(`${ind}        default: return "unknown";`);
  ctx.sourceLines.push(`${ind}    }`);
  ctx.sourceLines.push(`${ind}}`);

  // Emit fromName helper
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline std::optional<${name}> ${name}_fromName(std::string_view _s) {`);
  for (const variant of decl.variants) {
    ctx.sourceLines.push(`${ind}    if (_s == "${variant.name}") return ${name}::${variant.name};`);
  }
  ctx.sourceLines.push(`${ind}    return std::nullopt;`);
  ctx.sourceLines.push(`${ind}}`);

  // Emit fromValue helper (for integer-valued enums)
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline std::optional<${name}> ${name}_fromValue(int32_t _v) {`);
  ctx.sourceLines.push(`${ind}    switch (static_cast<${name}>(_v)) {`);
  for (const variant of decl.variants) {
    ctx.sourceLines.push(`${ind}        case ${name}::${variant.name}: return ${name}::${variant.name};`);
  }
  ctx.sourceLines.push(`${ind}        default: return std::nullopt;`);
  ctx.sourceLines.push(`${ind}    }`);
  ctx.sourceLines.push(`${ind}}`);

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline std::ostream& operator<<(std::ostream& _os, ${name} _v) {`);
  ctx.sourceLines.push(`${ind}    return _os << ${name}_name(_v);`);
  ctx.sourceLines.push(`${ind}}`);

  // Emit std::hash specialization so enums can be used as Map keys
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`namespace std { template<> struct hash<${name}> { size_t operator()(${name} v) const noexcept { return hash<int>{}(static_cast<int>(v)); } }; }`);
}

// ============================================================================
// Type aliases
// ============================================================================

export function emitTypeAlias(
  stmt: TypeAliasDeclaration,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const name = emitIdentifierSafe(stmt.name);

  // Emit description comment
  if (stmt.description) {
    ctx.sourceLines.push(`${ind}// ${stmt.description}`);
  }

  // Emit template prefix for generic type aliases
  const tpl = emitTemplatePrefix(stmt.typeParams, ind);
  if (tpl) ctx.sourceLines.push(tpl);

  const cppType = emitTypeAnnotation(stmt.type, ctx);
  ctx.sourceLines.push(`${ind}using ${name} = ${cppType};`);

  if (stmt.needsJson) {
    const members = collectTypeAliasClassSymbols(stmt.type);
    const allSerializable = members && members.length > 0 && members.every((cls) =>
      cls.declaration.fields.every((f) => !f.resolvedType || isJSONSerializable(f.resolvedType)),
    );
    if (allSerializable) {
      const disc = findSharedDiscriminator(members);
      if (disc) {
        emitTypeAliasFromJSON(name, disc, ctx);
      }
    }
  }
}

/**
 * Convert a TypeAnnotation AST node to a C++ type string.
 * Uses resolvedSymbol when available (set by the analyzer), otherwise
 * falls back to name-based lookup in the module symbols.
 */
export function emitTypeAnnotation(
  typeAnn: import("./ast.js").TypeAnnotation,
  ctx: EmitContext,
): string {
  switch (typeAnn.kind) {
    case "named-type": {
      // Check for primitive names first
      const PRIMITIVE_NAMES: Record<string, string> = {
        byte: "uint8_t",
        int: "int32_t",
        long: "int64_t",
        float: "float",
        double: "double",
        string: "std::string",
        char: "char32_t",
        bool: "bool",
        void: "void",
      };
      if (PRIMITIVE_NAMES[typeAnn.name]) {
        return PRIMITIVE_NAMES[typeAnn.name];
      }
      if (typeAnn.name === "JsonValue") {
        return "doof::JsonValue";
      }

      // If analyzer resolved this, look at the symbol kind
      if (typeAnn.resolvedSymbol) {
        const sym = typeAnn.resolvedSymbol;
        if (sym.symbolKind === "class") {
          return `std::shared_ptr<${sym.name}>`;
        }
        // Interface/enum — use name directly (alias was already emitted)
        return sym.name;
      }

      // Fallback: use name directly
      return emitIdentifierSafe(typeAnn.name);
    }

    case "array-type": {
      const el = emitTypeAnnotation(typeAnn.elementType, ctx);
      return `std::shared_ptr<std::vector<${el}>>`;
    }

    case "union-type": {
      const types = typeAnn.types;
      const hasNull = types.some(
        (t) => t.kind === "named-type" && t.name === "null",
      );
      const nonNull = types.filter(
        (t) => !(t.kind === "named-type" && t.name === "null"),
      );

      // Single type + null
      if (hasNull && nonNull.length === 1) {
        const inner = nonNull[0];
        if (inner.kind === "named-type" && inner.resolvedSymbol?.symbolKind === "class") {
          return `std::shared_ptr<${inner.resolvedSymbol.name}>`;
        }
        return `std::optional<${emitTypeAnnotation(inner, ctx)}>`;
      }

      // Multi-type union
      const memberTypes = nonNull.map((t) => emitTypeAnnotation(t, ctx));
      if (hasNull) {
        memberTypes.unshift("std::monostate");
      }
      return `std::variant<${memberTypes.join(", ")}>`;
    }

    case "function-type": {
      const params = typeAnn.params.map((p) => emitTypeAnnotation(p.type, ctx)).join(", ");
      const ret = emitTypeAnnotation(typeAnn.returnType, ctx);
      return `std::function<${ret}(${params})>`;
    }

    case "tuple-type": {
      const els = typeAnn.elements.map((e) => emitTypeAnnotation(e, ctx)).join(", ");
      return `std::tuple<${els}>`;
    }

    case "weak-type": {
      const inner = emitTypeAnnotation(typeAnn.type, ctx);
      // Strip shared_ptr wrapper if present
      const match = inner.match(/^std::shared_ptr<(.+)>$/);
      if (match) {
        return `std::weak_ptr<${match[1]}>`;
      }
      return `std::weak_ptr<${inner}>`;
    }
  }
}
