/**
 * C++ metadata and per-method invoke generation for tool interop.
 *
 * Generates:
 *   - `static inline const doof::ClassMetadata<ClassName> _metadata` — structured
 *     metadata object containing class name, description, method reflections with
 *     per-method `invoke` lambdas returning `doof::Result<doof::JsonValue, doof::Any>`.
 *
 * On-demand: only emitted when `needsMetadata` is set on a ClassDeclaration
 * (triggered by user code accessing `MyClass.metadata`).
 */

import type { ClassDeclaration } from "./ast.js";
import type { AnalysisResult } from "./analyzer.js";
import type { Statement } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitWrapAnyValue } from "./emitter-any.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import { indent, emitIdentifierSafe } from "./emitter-expr.js";
import { emitType } from "./emitter-types.js";
import {
  emitSerializeExpr,
  emitDeserializeExpr,
  emitJsonTypeCheck,
  jsonTypeName,
  markReferencedClasses,
} from "./emitter-json.js";
import type { EmitContext } from "./emitter-context.js";
import { buildClassMetadata } from "./emitter-schema.js";

// ============================================================================
// On-demand metadata propagation
// ============================================================================

/**
 * Propagate `needsMetadata` → `needsJson` on all classes referenced by
 * public method signatures of metadata-marked classes.
 *
 * Must be called before emission (alongside propagateJsonDemand).
 */
export function propagateMetadataDemand(analysisResult: AnalysisResult): void {
  // Build class lookup
  const classDecls = new Map<string, ClassDeclaration[]>();
  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      const decl = unwrapExport(stmt);
      if (decl.kind === "class-declaration") {
        const list = classDecls.get(decl.name) ?? [];
        list.push(decl);
        classDecls.set(decl.name, list);
      }
    }
  }

  // Seed worklist with metadata-marked classes
  const worklist: ClassDeclaration[] = [];
  const visited = new Set<string>();
  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      const decl = unwrapExport(stmt);
      if (decl.kind === "class-declaration" && decl.needsMetadata) {
        decl.needsJson = true;
        worklist.push(decl);
      }
    }
  }

  // Walk method parameter/return types and mark referenced classes
  while (worklist.length > 0) {
    const cls = worklist.pop()!;
    if (visited.has(cls.name)) continue;
    visited.add(cls.name);

    for (const method of cls.methods) {
      if (method.private_ || method.static_) continue;
      for (const param of method.params) {
        if (param.resolvedType) {
          markReferencedClasses(param.resolvedType, classDecls, worklist);
        }
      }
      // Also check return type
      if (method.resolvedType && method.resolvedType.kind === "function" && method.resolvedType.returnType) {
        markReferencedClasses(metadataSuccessType(method.resolvedType.returnType), classDecls, worklist);
      }
    }
  }
}

function unwrapExport(stmt: Statement): Statement {
  return stmt.kind === "export-declaration" ? stmt.declaration : stmt;
}

function metadataSuccessType(type: ResolvedType): ResolvedType {
  return type.kind === "result" ? type.successType : type;
}

// ============================================================================
// Structured metadata emission
// ============================================================================

/**
 * Emit the declaration of `_metadata` inside the class body.
 * The actual definition is emitted after the class closing `};` via
 * `emitMetadataDefinition` to avoid the incomplete-type issue (the
 * invoke lambdas reference member functions which require the class
 * to be fully defined).
 */
export function emitMetadataDeclaration(
  cppName: string,
  ctx: EmitContext,
): void {
  const memberInd = indent({ indent: ctx.indent + 1 });
  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${memberInd}static const doof::ClassMetadata<${cppName}> _metadata;`);
}

/**
 * Emit the out-of-line definition of `_metadata` after the class body.
 * Must be called after the class closing `};` so the type is complete.
 */
export function emitMetadataDefinition(
  decl: ClassDeclaration,
  cppName: string,
  ctx: EmitContext,
): void {
  const ind = indent(ctx);
  const metadata = buildClassMetadata(decl);

  ctx.sourceLines.push("");
  ctx.sourceLines.push(`${ind}inline const doof::ClassMetadata<${cppName}> ${cppName}::_metadata = {`);

  // Name
  const nameStr = escapeStringLiteral(decl.name);
  ctx.sourceLines.push(`${ind}    "${nameStr}",`);

  // Description
  const descStr = decl.description ? escapeStringLiteral(decl.description) : "";
  ctx.sourceLines.push(`${ind}    "${descStr}",`);

  // Methods vector (wrapped in shared_ptr)
  const methods = decl.methods.filter((m) => !m.private_ && !m.static_);
  ctx.sourceLines.push(`${ind}    std::make_shared<std::vector<doof::MethodReflection<${cppName}>>>(std::vector<doof::MethodReflection<${cppName}>>{`);
  for (let mi = 0; mi < methods.length; mi++) {
    const method = methods[mi];
    const safeName = emitIdentifierSafe(method.name);
    const comma = mi < methods.length - 1 ? "," : "";

    // Build inputSchema and outputSchema as JsonValue literals.
    const methodMeta = (metadata.methods as Record<string, unknown>[])[mi];
    const inputSchemaJson = methodMeta.inputSchema ? JSON.stringify(methodMeta.inputSchema) : "{}";
    const outputSchemaJson = methodMeta.outputSchema ? JSON.stringify(methodMeta.outputSchema) : "{}";

    ctx.sourceLines.push(`${ind}        doof::MethodReflection<${cppName}>{`);
    ctx.sourceLines.push(`${ind}            "${escapeStringLiteral(method.name)}",`);
    ctx.sourceLines.push(`${ind}            "${method.description ? escapeStringLiteral(method.description) : ""}",`);
    ctx.sourceLines.push(`${ind}            doof::json_parse_or_panic(R"_doof_schema_(${inputSchemaJson})_doof_schema_"),`);
    ctx.sourceLines.push(`${ind}            doof::json_parse_or_panic(R"_doof_schema_(${outputSchemaJson})_doof_schema_"),`);

    // Invoke lambda: (std::shared_ptr<T>, const doof::JsonValue&) -> Result<JsonValue, any>
    ctx.sourceLines.push(`${ind}            [](std::shared_ptr<${cppName}> _instance, const doof::JsonValue& _params) -> doof::Result<doof::JsonValue, doof::Any> {`);
    ctx.sourceLines.push(`${ind}                const auto* _p = doof::json_as_object(_params);`);
    ctx.sourceLines.push(`${ind}                if (_p == nullptr) {`);
    ctx.sourceLines.push(`${ind}                    return doof::Result<doof::JsonValue, doof::Any>::failure(doof::Any{std::string("Invalid JSON params: expected object")});`);
    ctx.sourceLines.push(`${ind}                }`);

    // Deserialize parameters
    for (const param of method.params) {
      const paramType = param.resolvedType;
      if (!paramType) continue;
      const safeParamName = emitIdentifierSafe(param.name);
      const iterName = `_it_${safeParamName}`;
      if (param.defaultValue) {
        const defaultValue = emitDefaultExpression(param.defaultValue, paramType);
        ctx.sourceLines.push(`${ind}                ${emitTypeForMetadata(paramType)} ${safeParamName};`);
        ctx.sourceLines.push(`${ind}                if (auto ${iterName} = _p->find("${param.name}"); ${iterName} != _p->end()) {`);
        ctx.sourceLines.push(`${ind}                    if (!${emitJsonTypeCheck(`${iterName}->second`, paramType)}) {`);
        ctx.sourceLines.push(`${ind}                        return doof::Result<doof::JsonValue, doof::Any>::failure(doof::Any{std::string("Parameter \\"${param.name}\\" expected ${jsonTypeName(paramType)} but got ") + doof::json_type_name(${iterName}->second)});`);
        ctx.sourceLines.push(`${ind}                    }`);
        ctx.sourceLines.push(`${ind}                    ${safeParamName} = ${emitDeserializeExpr(`${iterName}->second`, paramType, ctx)};`);
        ctx.sourceLines.push(`${ind}                } else {`);
        ctx.sourceLines.push(`${ind}                    ${safeParamName} = ${defaultValue};`);
        ctx.sourceLines.push(`${ind}                }`);
      } else {
        ctx.sourceLines.push(`${ind}                auto ${iterName} = _p->find("${param.name}");`);
        ctx.sourceLines.push(`${ind}                if (${iterName} == _p->end()) {`);
        ctx.sourceLines.push(`${ind}                    return doof::Result<doof::JsonValue, doof::Any>::failure(doof::Any{std::string("Missing required parameter \\"${param.name}\\"")});`);
        ctx.sourceLines.push(`${ind}                }`);
        ctx.sourceLines.push(`${ind}                if (!${emitJsonTypeCheck(`${iterName}->second`, paramType)}) {`);
        ctx.sourceLines.push(`${ind}                    return doof::Result<doof::JsonValue, doof::Any>::failure(doof::Any{std::string("Parameter \\"${param.name}\\" expected ${jsonTypeName(paramType)} but got ") + doof::json_type_name(${iterName}->second)});`);
        ctx.sourceLines.push(`${ind}                }`);
        ctx.sourceLines.push(`${ind}                auto ${safeParamName} = ${emitDeserializeExpr(`${iterName}->second`, paramType, ctx)};`);
      }
    }

    // Build arg list
    const args = method.params.map((p) => emitIdentifierSafe(p.name)).join(", ");

    // Call method and serialize result
    const retType = method.resolvedType && method.resolvedType.kind === "function"
      ? method.resolvedType.returnType
      : undefined;

    if (!retType || retType.kind === "void") {
      ctx.sourceLines.push(`${ind}                _instance->${safeName}(${args});`);
      ctx.sourceLines.push(`${ind}                return doof::Result<doof::JsonValue, doof::Any>::success(doof::JsonValue(nullptr));`);
    } else if (retType.kind === "result") {
      ctx.sourceLines.push(`${ind}                auto _result = _instance->${safeName}(${args});`);
      ctx.sourceLines.push(`${ind}                if (_result.isFailure()) {`);
      ctx.sourceLines.push(`${ind}                    return doof::Result<doof::JsonValue, doof::Any>::failure(${emitWrapAnyValue("_result.error()", retType.errorType, ctx)});`);
      ctx.sourceLines.push(`${ind}                }`);
      if (retType.successType.kind === "void") {
        ctx.sourceLines.push(`${ind}                _result.value();`);
        ctx.sourceLines.push(`${ind}                return doof::Result<doof::JsonValue, doof::Any>::success(doof::JsonValue(nullptr));`);
      } else {
        ctx.sourceLines.push(`${ind}                auto _success = _result.value();`);
        const serialized = emitSerializeExpr("_success", retType.successType);
        ctx.sourceLines.push(`${ind}                return doof::Result<doof::JsonValue, doof::Any>::success(${serialized});`);
      }
    } else {
      ctx.sourceLines.push(`${ind}                auto _result = _instance->${safeName}(${args});`);
      const serialized = emitSerializeExpr("_result", retType);
      ctx.sourceLines.push(`${ind}                return doof::Result<doof::JsonValue, doof::Any>::success(${serialized});`);
    }

    ctx.sourceLines.push(`${ind}            }`);
    ctx.sourceLines.push(`${ind}        }${comma}`);
  }
  ctx.sourceLines.push(`${ind}    }),`);

  // $defs — structured JsonValue (or null)
  if (metadata.$defs) {
    const defsJson = JSON.stringify(metadata.$defs);
    ctx.sourceLines.push(`${ind}    doof::JsonValue(doof::json_parse_or_panic(R"_doof_defs_(${defsJson})_doof_defs_"))`);
  } else {
    ctx.sourceLines.push(`${ind}    std::nullopt`);
  }

  ctx.sourceLines.push(`${ind}};`);
}

function escapeStringLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function emitTypeForMetadata(type: ResolvedType): string {
  return type.kind === "void" ? "void" : emitType(type);
}
