/**
 * JSON Schema Draft 7 generation from Doof ResolvedType.
 *
 * Used by the metadata system to produce inputSchema / outputSchema for
 * class methods, enabling OpenAPI, MCP, and LLM tool interop.
 *
 * Class types are lifted to `$ref: "#/$defs/ClassName"` with their schema
 * placed in a shared `$defs` map, so consumers can merge definitions across
 * multiple metadata objects to build consolidated API specs.
 */

import { isJsonValueType, type ResolvedType } from "./checker-types.js";
import type { ClassDeclaration, FunctionDeclaration } from "./ast.js";

// ============================================================================
// Public API
// ============================================================================

/** JSON Schema node — a plain object tree serializable to JSON. */
export type JsonSchema = Record<string, unknown>;

/**
 * Convert a ResolvedType to a JSON Schema Draft 7 object.
 *
 * Class types are emitted as `{ "$ref": "#/$defs/ClassName" }` and their
 * full schema is added to the `defs` map (keyed by class name).
 */
export function typeToJsonSchema(
  type: ResolvedType,
  defs: Map<string, JsonSchema>,
  visited: Set<string> = new Set(),
): JsonSchema {
  if (isJsonValueType(type)) {
    return {};
  }

  switch (type.kind) {
    case "primitive":
      switch (type.name) {
        case "byte":
          return { type: "integer", minimum: 0, maximum: 255 };
        case "int":
          return { type: "integer", format: "int32" };
        case "long":
          return { type: "integer", format: "int64" };
        case "float":
        case "double":
          return { type: "number" };
        case "string":
        case "char":
          return { type: "string" };
        case "bool":
          return { type: "boolean" };
      }
      break; // unreachable but satisfies TS

    case "null":
      return { type: "null" };

    case "class": {
      const name = type.symbol.name;
      // Add class schema to $defs if not already there
      if (!defs.has(name) && !visited.has(name)) {
        classToJsonSchema(type.symbol.declaration, defs, visited);
      }
      return { $ref: `#/$defs/${name}` };
    }

    case "array":
      return {
        type: "array",
        items: typeToJsonSchema(type.elementType, defs, visited),
      };

    case "tuple":
      return {
        type: "array",
        items: type.elements.map((e) => typeToJsonSchema(e, defs, visited)),
        minItems: type.elements.length,
        maxItems: type.elements.length,
      };

    case "enum":
      return {
        enum: type.symbol.declaration.variants.map((v) => v.name),
      };

    case "union": {
      const hasNull = type.types.some((t) => t.kind === "null");
      const nonNull = type.types.filter((t) => t.kind !== "null");

      if (hasNull && nonNull.length === 1) {
        // Nullable single type: anyOf with null
        const inner = typeToJsonSchema(nonNull[0], defs, visited);
        return { anyOf: [inner, { type: "null" }] };
      }

      // General union: anyOf
      return {
        anyOf: type.types.map((t) => typeToJsonSchema(t, defs, visited)),
      };
    }

    case "void":
      return { type: "null" };

    // Non-serializable types — shouldn't reach here if checker validation is correct
    case "function":
    case "weak":
    case "actor":
    case "promise":
    case "result":
    case "unknown":
    case "namespace":
    case "interface":
    case "success-wrapper":
    case "failure-wrapper":
    case "typevar":
    case "class-metadata":
    case "method-reflection":
      return {};
  }

  return {};
}

/**
 * Generate a JSON Schema for a class and add it to `defs`.
 *
 * The schema includes `type: "object"`, `properties`, `required`, and
 * optionally `description` from the class declaration.
 */
export function classToJsonSchema(
  decl: ClassDeclaration,
  defs: Map<string, JsonSchema>,
  visited: Set<string> = new Set(),
): void {
  // Guard against cycles
  const key = decl.name;
  if (visited.has(key)) return;
  visited.add(key);

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of decl.fields) {
    if (field.private_) continue;
    if (field.static_) continue;
    if (field.const_) continue; // const fields are not user-supplied

    for (let i = 0; i < field.names.length; i++) {
      const name = field.names[i];
      const desc = field.descriptions[i];
      const schema: JsonSchema = field.resolvedType
        ? typeToJsonSchema(field.resolvedType, defs, visited)
        : {};
      if (desc) schema.description = desc;
      properties[name] = schema;
      if (!field.defaultValue) {
        required.push(name);
      }
    }
  }

  const schema: JsonSchema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  if (decl.description) schema.description = decl.description;

  defs.set(key, schema);
}

/**
 * Generate a JSON Schema "object" for a method's input parameters.
 *
 * Each parameter becomes a property; all parameters without defaults are required.
 */
export function methodInputSchema(
  method: FunctionDeclaration,
  defs: Map<string, JsonSchema>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const param of method.params) {
    const schema: JsonSchema = param.resolvedType
      ? typeToJsonSchema(param.resolvedType, defs)
      : {};
    if (param.description) schema.description = param.description;
    properties[param.name] = schema;
    if (!param.defaultValue) {
      required.push(param.name);
    }
  }

  const result: JsonSchema = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

/**
 * Generate a JSON Schema for a method's return type.
 */
export function methodOutputSchema(
  method: FunctionDeclaration,
  defs: Map<string, JsonSchema>,
): JsonSchema {
  if (!method.resolvedType || method.resolvedType.kind !== "function") {
    return {};
  }
  const retType = method.resolvedType.returnType;
  if (retType.kind === "result") {
    return typeToJsonSchema(retType.successType, defs);
  }
  return typeToJsonSchema(retType, defs);
}

/**
 * Build the complete metadata JSON object for a class.
 *
 * Returns a plain object with `name`, `description`, `methods`, and `$defs`.
 */
export function buildClassMetadata(decl: ClassDeclaration): Record<string, unknown> {
  const defs = new Map<string, JsonSchema>();

  const methods: Record<string, unknown>[] = [];
  for (const method of decl.methods) {
    if (method.private_ || method.static_) continue;

    const entry: Record<string, unknown> = {
      name: method.name,
    };
    if (method.description) entry.description = method.description;
    entry.inputSchema = methodInputSchema(method, defs);
    entry.outputSchema = methodOutputSchema(method, defs);
    methods.push(entry);
  }

  const result: Record<string, unknown> = { name: decl.name };
  if (decl.description) result.description = decl.description;
  result.methods = methods;

  if (defs.size > 0) {
    const defsObj: Record<string, JsonSchema> = {};
    for (const [k, v] of defs) defsObj[k] = v;
    result.$defs = defsObj;
  }

  return result;
}
