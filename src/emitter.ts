/**
 * C++ transpiler — main entry point.
 *
 * Orchestrates the emission of C++ source code from a decorated Doof AST.
 * Consumes the output of the analyzer + type checker pipeline, where all
 * AST nodes are decorated with `resolvedType`, `resolvedBinding`, and
 * `resolvedSymbol` fields.
 *
 * For Phase 1, emits a single .cpp file per module (all-in-one).
 * Header/source splitting comes in Phase 7.
 */

import type { AnalysisResult } from "./analyzer.js";
import { buildAnyRuntimePlan } from "./any-runtime.js";
import type { Block, Statement, ClassDeclaration, InterfaceDeclaration } from "./ast.js";
import type { ModuleSymbolTable, ClassSymbol, InterfaceSymbol } from "./types.js";
import { emitStatement, emitBlockStatements } from "./emitter-stmt.js";
import { indent } from "./emitter-expr.js";
import type { EmitContext } from "./emitter-context.js";
import { propagateJsonDemand } from "./emitter-json.js";
import { propagateMetadataDemand } from "./emitter-metadata.js";
export type { EmitContext } from "./emitter-context.js";

// ============================================================================
// Public API
// ============================================================================

export interface EmitResult {
  /** The generated C++ source code. */
  code: string;
  /** The module path that was emitted. */
  modulePath: string;
}

/**
 * Emit C++ code for a single module.
 *
 * @param modulePath - Absolute path of the module to emit.
 * @param analysisResult - The full analysis result from the analyzer.
 * @returns The generated C++ source code.
 */
export function emitCpp(
  modulePath: string,
  analysisResult: AnalysisResult,
): string {
  const table = analysisResult.modules.get(modulePath);
  if (!table) {
    throw new Error(`Module not found: ${modulePath}`);
  }

  // Propagate on-demand flags before emission
  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  return emitModule(table, analysisResult);
}

/**
 * Emit C++ for all modules in the analysis result.
 */
export function emitAllModules(
  analysisResult: AnalysisResult,
): EmitResult[] {
  // Propagate on-demand flags before emission
  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  const results: EmitResult[] = [];
  for (const [path, table] of analysisResult.modules) {
    results.push({
      code: emitModule(table, analysisResult),
      modulePath: path,
    });
  }
  return results;
}

// ============================================================================
// Internal
// ============================================================================

function emitModule(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
): string {
  // Pre-compute interface implementations across all modules
  const interfaceImpls = buildInterfaceImplMap(analysisResult);
  const anyPlan = buildAnyRuntimePlan(analysisResult);

  const ctx: EmitContext = {
    indent: 0,
    module: table,
    allModules: analysisResult.modules,
    headerLines: [],
    sourceLines: [],
    interfaceImpls,
    anyPlan,
    tempCounter: 0,
    inClass: false,
    emitBlock: blockToString,
  };

  // Emit standard includes
  emitIncludes(ctx);

  // Emit forward declarations for all class structs.
  // This ensures interface `using` aliases (which reference struct types via
  // shared_ptr) compile even when the interface is declared before its
  // implementing classes in source order.
  emitForwardDeclarations(ctx);

  // Emit all statements
  for (const stmt of table.program.statements) {
    // Skip import/export wrappers — handle the inner declaration
    if (stmt.kind === "export-declaration") {
      emitStatement(stmt.declaration, ctx);
    } else if (
      stmt.kind === "import-declaration" ||
      stmt.kind === "extern-class-declaration" ||
      stmt.kind === "extern-function-declaration" ||
      stmt.kind === "export-list" ||
      stmt.kind === "export-all-declaration"
    ) {
      // Import/extern declarations are handled via includes at the top
      continue;
    } else {
      emitStatement(stmt, ctx);
    }
    ctx.sourceLines.push(""); // blank line between top-level declarations
  }

  // Combine header and source
  const allLines = [...ctx.headerLines, "", ...ctx.sourceLines];

  // Trim trailing blank lines
  while (allLines.length > 0 && allLines[allLines.length - 1].trim() === "") {
    allLines.pop();
  }

  return allLines.join("\n") + "\n";
}

/** Emit standard C++ includes. */
function emitIncludes(ctx: EmitContext): void {
  ctx.headerLines.push('#include "doof_runtime.hpp"');
  ctx.headerLines.push("#include <cstdint>");
  ctx.headerLines.push("#include <memory>");
  ctx.headerLines.push("#include <string>");
  ctx.headerLines.push("#include <vector>");
  ctx.headerLines.push("#include <variant>");
  ctx.headerLines.push("#include <optional>");
  ctx.headerLines.push("#include <functional>");
  ctx.headerLines.push("#include <unordered_map>");
  ctx.headerLines.push("#include <unordered_set>");
  ctx.headerLines.push("#include <tuple>");
  ctx.headerLines.push("#include <type_traits>");
  ctx.headerLines.push("#include <cmath>");

  // Include nlohmann/json if this module has any JSON-serializable classes
  if (moduleNeedsJson(ctx)) {
    ctx.headerLines.push("#include <nlohmann/json.hpp>");
  }

  // Emit includes for imported modules
  for (const imp of ctx.module.imports) {
    // Convert module path to hpp include
    const hppPath = modulePathToInclude(imp.sourceModule);
    ctx.headerLines.push(`#include "${hppPath}"`);
  }
  for (const nsImp of ctx.module.namespaceImports) {
    const hppPath = modulePathToInclude(nsImp.sourceModule);
    ctx.headerLines.push(`#include "${hppPath}"`);
  }

  // Emit includes for extern C++ class and function imports
  emitExternIncludes(ctx);
}

/** Check if any class in this module has been marked as needing JSON serialization. */
function moduleNeedsJson(ctx: EmitContext): boolean {
  for (const stmt of ctx.module.program.statements) {
    const decl = stmt.kind === "export-declaration" ? stmt.declaration : stmt;
    if (decl.kind === "class-declaration" && decl.needsJson) {
      return true;
    }
    if (decl.kind === "interface-declaration" && decl.needsJson) {
      return true;
    }
  }
  return false;
}

/** Emit #include directives for extern class and function declarations. */
function emitExternIncludes(ctx: EmitContext): void {
  const seen = new Set<string>();
  function addInclude(header: string): void {
    const line = header.startsWith("<") ? `#include ${header}` : `#include "${header}"`;
    if (!seen.has(line)) {
      seen.add(line);
      ctx.headerLines.push(line);
    }
  }
  for (const stmt of ctx.module.program.statements) {
    if (stmt.kind === "extern-class-declaration") {
      addInclude(stmt.headerPath ?? `${stmt.name}.hpp`);
    } else if (stmt.kind === "extern-function-declaration" && stmt.headerPath) {
      addInclude(stmt.headerPath);
    } else if (stmt.kind === "export-declaration") {
      const inner = stmt.declaration;
      if (inner.kind === "extern-function-declaration" && inner.headerPath) {
        addInclude(inner.headerPath);
      } else if (inner.kind === "extern-class-declaration") {
        addInclude(inner.headerPath ?? `${inner.name}.hpp`);
      }
    }
  }
}

/** Convert a Doof module path to a C++ include path. */
function modulePathToInclude(modulePath: string): string {
  // Strip leading / and replace .do extension with .hpp
  return modulePath.replace(/^\//, "").replace(/\.do$/, ".hpp");
}

/**
 * Build a map from interface name to all classes that implement it.
 * Scans all modules in the analysis result.
 */
function buildInterfaceImplMap(
  analysisResult: AnalysisResult,
): Map<string, ClassSymbol[]> {
  const impls = new Map<string, ClassSymbol[]>();

  // Collect all interfaces and classes across all modules
  const interfaces: InterfaceSymbol[] = [];
  const classes: ClassSymbol[] = [];

  for (const [, table] of analysisResult.modules) {
    for (const [, sym] of table.symbols) {
      if (sym.symbolKind === "interface") {
        interfaces.push(sym);
      } else if (sym.symbolKind === "class") {
        classes.push(sym);
      }
    }
  }

  // For each interface, find classes that declare they implement it
  // or structurally satisfy it
  for (const iface of interfaces) {
    const implementing: ClassSymbol[] = [];

    for (const cls of classes) {
      // Check explicit implements_ declaration
      if (cls.declaration.implements_.includes(iface.name)) {
        implementing.push(cls);
        continue;
      }

      // Structural check: does the class have all fields and methods?
      if (classStructurallyImplements(cls.declaration, iface.declaration)) {
        implementing.push(cls);
      }
    }

    impls.set(iface.name, implementing);
  }

  return impls;
}

/** Check if a class structurally implements an interface. */
function classStructurallyImplements(
  cls: ClassDeclaration,
  iface: InterfaceDeclaration,
): boolean {
  // Check fields
  for (const field of iface.fields) {
    const classField = cls.fields.find((f) => f.names.includes(field.name));
    if (!classField) return false;
  }

  // Check methods
  for (const method of iface.methods) {
    const classMethod = cls.methods.find((m) => m.name === method.name && m.static_ === method.static_);
    if (!classMethod) return false;
    if (classMethod.params.length !== method.params.length) return false;
  }

  return true;
}

/**
 * Emit `struct Foo;` forward declarations for every class in this module.
 * Skips extern classes (whose struct is defined in an external header).
 */
function emitForwardDeclarations(ctx: EmitContext): void {
  const classNames: string[] = [];
  for (const stmt of ctx.module.program.statements) {
    const decl = stmt.kind === "export-declaration" ? stmt.declaration : stmt;
    if (decl.kind === "class-declaration") {
      classNames.push(decl.name);
    }
  }
  if (classNames.length > 0) {
    for (const name of classNames) {
      ctx.sourceLines.push(`struct ${name};`);
    }
    ctx.sourceLines.push("");
  }
}

/**
 * Helper: emit a block body as a string (used by emitter-expr for lambdas/IIFE).
 */
function blockToString(block: Block, ctx: EmitContext): string {
  const tempCtx: EmitContext = {
    ...ctx,
    sourceLines: [],
  };
  emitBlockStatements(block, tempCtx);
  return tempCtx.sourceLines.join("\n");
}
