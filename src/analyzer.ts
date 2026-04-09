/**
 * Module-level type analyzer for Doof.
 *
 * Responsibilities:
 *   1. Parse an entire module from source.
 *   2. Build a module-level symbol table (all top-level declarations).
 *   3. Resolve ESM-style imports across modules (transitive).
 *   4. Resolve NamedType references to their concrete symbol definitions.
 *
 * Usage:
 *   const analyzer = new ModuleAnalyzer(fs);
 *   const result = analyzer.analyzeModule("/path/to/entry.do");
 *   // result.modules — Map of resolved path → ModuleSymbolTable
 *   // NamedType nodes in the AST are decorated with resolvedSymbol
 */

import { parse, parseWithDiagnostics, ParseError } from "./parser.js";
import type {
  Program,
  Statement,
  TypeAnnotation,
  NamedType,
  ImportDeclaration,
  ExportDeclaration,
  ExportList,
  ExportAllDeclaration,
  ExternClassDeclaration,
  ExternFunctionDeclaration,
  ClassDeclaration,
  ClassField,
  FunctionDeclaration,
  Block,
  Parameter,
  SourceSpan,
} from "./ast.js";
import type {
  ModuleSymbol,
  ModuleSymbolTable,
  ResolvedImport,
  ResolvedNamespaceImport,
  Diagnostic,
} from "./types.js";
import { BUILTIN_TYPE_NAMES } from "./types.js";
import { ModuleResolver, type FileSystem } from "./resolver.js";

// ============================================================================
// Analysis result
// ============================================================================

export interface AnalysisResult {
  /** All analysed modules keyed by resolved absolute path. */
  modules: Map<string, ModuleSymbolTable>;
  /** All diagnostics across every module. */
  diagnostics: Diagnostic[];
}

// ============================================================================
// Analyzer
// ============================================================================

export class ModuleAnalyzer {
  private fs: FileSystem;
  private resolver: ModuleResolver;

  /** Modules already analysed (keyed by resolved path). */
  private modules = new Map<string, ModuleSymbolTable>();
  /** Modules currently being analysed (cycle detection). */
  private inProgress = new Set<string>();
  /** All diagnostics. */
  private diagnostics: Diagnostic[] = [];

  constructor(fs: FileSystem, resolver?: ModuleResolver) {
    this.fs = fs;
    this.resolver = resolver ?? new ModuleResolver(fs);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Analyse a module and all of its transitive imports.
   *
   * @param modulePath Absolute path to the entry module file.
   */
  analyzeModule(modulePath: string): AnalysisResult {
    // Reset state for a fresh analysis run.
    this.modules.clear();
    this.inProgress.clear();
    this.diagnostics = [];

    this.analyzeModuleInternal(modulePath);

    return {
      modules: this.modules,
      diagnostics: [...this.diagnostics],
    };
  }

  // --------------------------------------------------------------------------
  // Internal: recursive module analysis
  // --------------------------------------------------------------------------

  private analyzeModuleInternal(modulePath: string, importSpan?: SourceSpan): ModuleSymbolTable | null {
    // Already done?
    if (this.modules.has(modulePath)) {
      return this.modules.get(modulePath)!;
    }

    // Cycle detection — we allow it (like the spec says Doof handles circular
    // imports) but we don't recurse further. The caller will get null and can
    // still link against the partially-built table later.
    if (this.inProgress.has(modulePath)) {
      return this.modules.get(modulePath) ?? null;
    }

    const zeroSpan: SourceSpan = { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } };

    // Read source
    const source = this.fs.readFile(modulePath);
    if (source === null) {
      this.diagnostics.push({
        severity: "error",
        message: `Module not found: ${modulePath}`,
        span: importSpan ?? zeroSpan,
        module: modulePath,
      });
      return null;
    }

    // Parse
    let program: Program;
    try {
      const result = parseWithDiagnostics(source);
      program = result.program;
      // Surface lexer diagnostics (unterminated strings, unknown chars, etc.)
      for (const ld of result.lexerDiagnostics) {
        this.diagnostics.push({
          severity: ld.severity,
          message: ld.message,
          span: { start: { line: ld.line, column: ld.column, offset: 0 }, end: { line: ld.line, column: ld.column, offset: 0 } },
          module: modulePath,
        });
      }
    } catch (e: any) {
      // Extract structured position from ParseError if available
      const span: SourceSpan = (e instanceof ParseError)
        ? { start: { line: e.line, column: e.column, offset: 0 }, end: { line: e.line, column: e.column, offset: 0 } }
        : zeroSpan;
      this.diagnostics.push({
        severity: "error",
        message: `Parse error in ${modulePath}: ${e.message}`,
        span,
        module: modulePath,
      });
      return null;
    }

    // Create the initial table (symbols filled, imports pending).
    const table: ModuleSymbolTable = {
      path: modulePath,
      program,
      symbols: new Map(),
      exports: new Map(),
      imports: [],
      namespaceImports: [],
      diagnostics: [],
    };

    // Register early so circular imports can reference it.
    this.inProgress.add(modulePath);
    this.modules.set(modulePath, table);

    // Phase 1: Collect symbols from top-level declarations.
    this.collectSymbols(table);

    // Phase 2: Resolve imports — this may trigger recursive analysis.
    this.resolveImports(table);

    // Phase 3: Process re-exports (export { } from, export *, export * as).
    this.resolveReExports(table);

    // Phase 4: Resolve NamedType references.
    this.resolveNamedTypes(table);

    this.inProgress.delete(modulePath);
    this.diagnostics.push(...table.diagnostics);

    return table;
  }

  // ==========================================================================
  // Phase 1: Collect symbols
  // ==========================================================================

  private collectSymbols(table: ModuleSymbolTable): void {
    for (const stmt of table.program.statements) {
      this.collectSymbol(stmt, table);
    }
  }

  private collectSymbol(stmt: Statement, table: ModuleSymbolTable): void {
    switch (stmt.kind) {
      case "class-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "class",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "interface-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "interface",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "enum-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "enum",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "type-alias-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "type-alias",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "function-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "function",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "const-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "const",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "readonly-declaration": {
        const sym: ModuleSymbol = {
          symbolKind: "readonly",
          name: stmt.name,
          declaration: stmt,
          exported: stmt.exported,
          module: table.path,
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "extern-class-declaration": {
        // Synthesize a ClassDeclaration from the extern class for the type system.
        const synthDecl = synthesizeClassDecl(stmt);
        const sym: ModuleSymbol = {
          symbolKind: "class",
          name: stmt.name,
          declaration: synthDecl,
          exported: stmt.exported,
          module: table.path,
          extern_: {
            headerPath: stmt.headerPath,
            cppName: stmt.cppName,
          },
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "extern-function-declaration": {
          // Synthesize a FunctionDeclaration from the imported function for the type system.
        const synthDecl = synthesizeExternFuncDecl(stmt);
        const sym: ModuleSymbol = {
          symbolKind: "function",
          name: stmt.name,
          declaration: synthDecl,
          exported: stmt.exported,
          module: table.path,
          extern_: {
            headerPath: stmt.headerPath,
            cppName: stmt.cppName,
          },
        };
        table.symbols.set(stmt.name, sym);
        if (stmt.exported) table.exports.set(stmt.name, sym);
        break;
      }
      case "export-declaration": {
        // `export <declaration>` — unwrap and collect the inner declaration.
        this.collectSymbol(stmt.declaration, table);
        break;
      }
      // export-list, export-all-declaration, import-declaration — handled
      // in later phases.
      default:
        break;
    }
  }

  // ==========================================================================
  // Phase 2: Resolve imports
  // ==========================================================================

  private resolveImports(table: ModuleSymbolTable): void {
    for (const stmt of table.program.statements) {
      if (stmt.kind !== "import-declaration") continue;
      const importDecl = stmt as ImportDeclaration;

      // Resolve the source module path.
      const resolved = this.resolver.resolve(importDecl.source, table.path);
      if (resolved === null) {
        table.diagnostics.push({
          severity: "error",
          message: `Cannot resolve module "${importDecl.source}" from ${table.path}`,
          span: importDecl.span,
          module: table.path,
        });
        continue;
      }

      // Recursively analyse the source module.
      const sourceTable = this.analyzeModuleInternal(resolved, importDecl.span);

      for (const spec of importDecl.specifiers) {
        if (spec.kind === "namespace-import-specifier") {
          table.namespaceImports.push({
            localName: spec.alias,
            sourceModule: resolved,
            typeOnly: importDecl.typeOnly,
          });
        } else {
          // named import
          const sourceName = spec.name;
          const localName = spec.alias ?? spec.name;
          const symbol = sourceTable?.exports.get(sourceName) ?? null;

          if (symbol === null && sourceTable !== null) {
            table.diagnostics.push({
              severity: "error",
              message: `Module "${importDecl.source}" does not export "${sourceName}"`,
              span: spec.span,
              module: table.path,
            });
          }

          const binding: ResolvedImport = {
            localName,
            sourceName,
            sourceModule: resolved,
            typeOnly: importDecl.typeOnly,
            symbol,
          };
          table.imports.push(binding);

          // Make the imported symbol available in this module's scope under
          // its local name (so NamedType resolution can find it).
          if (symbol) {
            table.symbols.set(localName, symbol);
          }
        }
      }
    }
  }

  // ==========================================================================
  // Phase 3: Re-exports
  // ==========================================================================

  private resolveReExports(table: ModuleSymbolTable): void {
    for (const stmt of table.program.statements) {
      // export { A, B } — local export list (no source module)
      if (stmt.kind === "export-list" && stmt.source === null) {
        for (const spec of stmt.specifiers) {
          const sym = table.symbols.get(spec.name) ?? null;
          if (sym) {
            // Block exporting private declarations
            const decl = sym.declaration as any;
            if (decl?.private_) {
              table.diagnostics.push({
                severity: "error",
                message: `Cannot export private declaration "${spec.name}"`,
                span: spec.span,
                module: table.path,
              });
              continue;
            }
            const exportName = spec.alias ?? spec.name;
            table.exports.set(exportName, sym);
          }
        }
      }

      if (stmt.kind === "export-list" && stmt.source !== null) {
        // export { A, B } from "./mod"
        const resolved = this.resolver.resolve(stmt.source, table.path);
        if (!resolved) {
          table.diagnostics.push({
            severity: "error",
            message: `Cannot resolve re-export source "${stmt.source}"`,
            span: stmt.span,
            module: table.path,
          });
          continue;
        }
        const sourceTable = this.analyzeModuleInternal(resolved, stmt.span);
        for (const spec of stmt.specifiers) {
          const sym = sourceTable?.exports.get(spec.name) ?? null;
          if (sym) {
            const exportName = spec.alias ?? spec.name;
            table.exports.set(exportName, sym);
            table.symbols.set(exportName, sym);
          } else {
            table.diagnostics.push({
              severity: "error",
              message: `Re-exported name "${spec.name}" not found in "${stmt.source}"`,
              span: spec.span,
              module: table.path,
            });
          }
        }
      }

      if (stmt.kind === "export-all-declaration") {
        const resolved = this.resolver.resolve(stmt.source, table.path);
        if (!resolved) {
          table.diagnostics.push({
            severity: "error",
            message: `Cannot resolve re-export source "${stmt.source}"`,
            span: stmt.span,
            module: table.path,
          });
          continue;
        }
        const sourceTable = this.analyzeModuleInternal(resolved, stmt.span);
        if (sourceTable) {
          if (stmt.alias) {
            // export * as ns from "./mod" — not a per-symbol re-export,
            // but we surface it as a namespace. For now we skip individual
            // symbol merging. Consumers can look up the source module.
          } else {
            // export * from "./mod"
            for (const [name, sym] of sourceTable.exports) {
              table.exports.set(name, sym);
              // Don't overwrite local declarations.
              if (!table.symbols.has(name)) {
                table.symbols.set(name, sym);
              }
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // Phase 4: Resolve NamedType references
  // ==========================================================================

  /**
   * Walk every TypeAnnotation in the module and resolve NamedType nodes
   * to the symbol they reference (local declarations + imports).
   *
   * A `typeParamScope` set tracks type parameter names that are in scope
   * (from enclosing function, class, interface, or type-alias declarations)
   * so they are not reported as unknown types.
   */
  private resolveNamedTypes(table: ModuleSymbolTable): void {
    for (const stmt of table.program.statements) {
      this.resolveNamedTypesInStatement(stmt, table, new Set());
    }
  }

  private resolveNamedTypesInStatement(stmt: Statement, table: ModuleSymbolTable, typeParamScope: Set<string>): void {
    switch (stmt.kind) {
      case "const-declaration":
      case "readonly-declaration":
      case "immutable-binding":
      case "let-declaration":
        if (stmt.type) this.resolveTypeAnnotation(stmt.type, table, typeParamScope);
        break;
      case "function-declaration": {
        // Function type params are in scope for params and return type.
        const fnScope = this.extendScope(typeParamScope, stmt.typeParams);
        for (const p of stmt.params) {
          if (p.type) this.resolveTypeAnnotation(p.type, table, fnScope);
        }
        if (stmt.returnType) this.resolveTypeAnnotation(stmt.returnType, table, fnScope);
        break;
      }
      case "class-declaration": {
        // Class type params are in scope for fields and methods.
        const classScope = this.extendScope(typeParamScope, stmt.typeParams);
        for (const f of stmt.fields) {
          if (f.type) this.resolveTypeAnnotation(f.type, table, classScope);
        }
        for (const m of stmt.methods) {
          // Method-level type params extend the class scope.
          const methodScope = this.extendScope(classScope, m.typeParams);
          for (const p of m.params) {
            if (p.type) this.resolveTypeAnnotation(p.type, table, methodScope);
          }
          if (m.returnType) this.resolveTypeAnnotation(m.returnType, table, methodScope);
        }
        break;
      }
      case "interface-declaration": {
        const ifaceScope = this.extendScope(typeParamScope, stmt.typeParams);
        for (const f of stmt.fields) {
          this.resolveTypeAnnotation(f.type, table, ifaceScope);
        }
        for (const m of stmt.methods) {
          const methodScope = this.extendScope(ifaceScope, m.typeParams);
          for (const p of m.params) {
            if (p.type) this.resolveTypeAnnotation(p.type, table, methodScope);
          }
          this.resolveTypeAnnotation(m.returnType, table, methodScope);
        }
        break;
      }
      case "type-alias-declaration": {
        const aliasScope = this.extendScope(typeParamScope, stmt.typeParams);
        this.resolveTypeAnnotation(stmt.type, table, aliasScope);
        break;
      }
      case "export-declaration":
        this.resolveNamedTypesInStatement(stmt.declaration, table, typeParamScope);
        break;
      default:
        break;
    }
  }

  /** Create a new scope set with additional type parameter names. */
  private extendScope(base: Set<string>, typeParams: string[]): Set<string> {
    if (typeParams.length === 0) return base;
    const extended = new Set(base);
    for (const tp of typeParams) extended.add(tp);
    return extended;
  }

  private resolveTypeAnnotation(type: TypeAnnotation, table: ModuleSymbolTable, typeParamScope: Set<string>): void {
    switch (type.kind) {
      case "named-type":
        this.resolveNamedTypeNode(type, table, typeParamScope);
        // Also resolve type arguments recursively.
        for (const arg of type.typeArgs) {
          this.resolveTypeAnnotation(arg, table, typeParamScope);
        }
        break;
      case "array-type":
        this.resolveTypeAnnotation(type.elementType, table, typeParamScope);
        break;
      case "union-type":
        for (const t of type.types) {
          this.resolveTypeAnnotation(t, table, typeParamScope);
        }
        break;
      case "function-type":
        for (const p of type.params) {
          this.resolveTypeAnnotation(p.type, table, typeParamScope);
        }
        this.resolveTypeAnnotation(type.returnType, table, typeParamScope);
        break;
      case "tuple-type":
        for (const el of type.elements) {
          this.resolveTypeAnnotation(el, table, typeParamScope);
        }
        break;
      case "weak-type":
        this.resolveTypeAnnotation(type.type, table, typeParamScope);
        break;
    }
  }

  private resolveNamedTypeNode(node: NamedType, table: ModuleSymbolTable, typeParamScope: Set<string>): void {
    const name = node.name;

    // Skip builtins — they don't resolve to a user declaration.
    if (BUILTIN_TYPE_NAMES.has(name)) return;

    // Skip type parameters — they are resolved later by the type checker.
    if (typeParamScope.has(name)) return;

    // Look up in the module's scope (local + imported symbols).
    const sym = table.symbols.get(name) ?? null;
    if (sym) {
      node.resolvedSymbol = sym;
    } else {
      table.diagnostics.push({
        severity: "error",
        message: `Unknown type "${name}"`,
        span: node.span,
        module: table.path,
      });
    }
  }
}

// ============================================================================
// Extern class → ClassDeclaration synthesis
// ============================================================================

/**
 * Synthesize a ClassDeclaration from an ExternClassDeclaration so that the
 * rest of the pipeline (checker, emitter) can treat it identically to a
 * regular class. The generated ClassDeclaration has no method bodies.
 */
function synthesizeClassDecl(ext: ExternClassDeclaration): ClassDeclaration {
  const fields: ClassField[] = ext.fields.map((f) => ({
    kind: "class-field" as const,
    names: f.names,
    descriptions: f.descriptions,
    type: f.type,
    defaultValue: null,
    readonly_: false,
    const_: false,
    static_: false,
    weak_: false,
    private_: false,
    span: f.span,
  }));

  const emptyBlock: Block = {
    kind: "block",
    statements: [],
    span: ext.span,
  };

  const methods: FunctionDeclaration[] = ext.methods.map((m) => ({
    kind: "function-declaration" as const,
    name: m.name,
    typeParams: [],
    params: m.params,
    returnType: m.returnType,
    body: emptyBlock,
    exported: false,
    static_: m.static_,
    isolated_: false,
    private_: false,
    span: m.span,
  }));

  return {
    kind: "class-declaration",
    name: ext.name,
    typeParams: [],
    implements_: [],
    fields,
    methods,
    destructor: null,
    exported: false,
    private_: false,
    span: ext.span,
  };
}

/**
 * Synthesize a FunctionDeclaration from an ExternFunctionDeclaration.
 * The body is an empty block — it will never be emitted.
 */
function synthesizeExternFuncDecl(ext: ExternFunctionDeclaration): FunctionDeclaration {
  const emptyBlock: Block = {
    kind: "block",
    statements: [],
    span: ext.span,
  };

  return {
    kind: "function-declaration",
    name: ext.name,
    typeParams: [],
    params: ext.params,
    returnType: ext.returnType,
    body: emptyBlock,
    exported: ext.exported,
    static_: false,
    isolated_: false,
    private_: false,
    span: ext.span,
  };
}
