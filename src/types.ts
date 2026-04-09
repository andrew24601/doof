/**
 * Type analysis data structures.
 *
 * These complement the syntactic TypeAnnotation nodes from ast.ts with
 * semantic information gathered during analysis — symbol definitions
 * and module symbol tables.
 */

import type {
  TypeAnnotation,
  SourceSpan,
  Statement,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  TypeAliasDeclaration,
  FunctionDeclaration,
  ConstDeclaration,
  ReadonlyDeclaration,
  Program,
  MockImportDirective,
} from "./ast.js";

// ============================================================================
// Symbols
// ============================================================================

/** The kind of declaration a symbol refers to. */
export type SymbolKind =
  | "class"
  | "interface"
  | "enum"
  | "type-alias"
  | "function"
  | "const"
  | "readonly";

/** A type-level symbol: a name that can appear in type position. */
export type TypeSymbol =
  | ClassSymbol
  | InterfaceSymbol
  | EnumSymbol
  | TypeAliasSymbol;

/** A value-level symbol: a name that can appear in expression position. */
export type ValueSymbol =
  | ClassSymbol       // classes are both types and constructors
  | EnumSymbol        // enums are both types and namespaces
  | FunctionSymbol
  | ConstSymbol
  | ReadonlySymbol;

/** Any module-level symbol. */
export type ModuleSymbol = TypeSymbol | FunctionSymbol | ConstSymbol | ReadonlySymbol;

// ---------------------------------------------------------------------------
// Individual symbol types
// ---------------------------------------------------------------------------

export interface ClassSymbol {
  symbolKind: "class";
  name: string;
  declaration: ClassDeclaration;
  exported: boolean;
  /** The resolved module path this symbol lives in. */
  module: string;
  /** If set, this is an extern C++ class import. */
  extern_?: {
    /** Explicit header path (null = infer from class name). */
    headerPath: string | null;
    /** Fully-qualified C++ name (e.g. "httplib::Client"). */
    cppName: string | null;
  };
}

export interface InterfaceSymbol {
  symbolKind: "interface";
  name: string;
  declaration: InterfaceDeclaration;
  exported: boolean;
  module: string;
}

export interface EnumSymbol {
  symbolKind: "enum";
  name: string;
  declaration: EnumDeclaration;
  exported: boolean;
  module: string;
}

export interface TypeAliasSymbol {
  symbolKind: "type-alias";
  name: string;
  declaration: TypeAliasDeclaration;
  exported: boolean;
  module: string;
}

export interface FunctionSymbol {
  symbolKind: "function";
  name: string;
  declaration: FunctionDeclaration;
  exported: boolean;
  module: string;
  /** If set, this is an extern C/C++ function import. */
  extern_?: {
    /** Explicit header path (null = infer from function name). */
    headerPath: string | null;
    /** Fully-qualified C++ name (e.g. "std::sin"). */
    cppName: string | null;
  };
}

export interface ConstSymbol {
  symbolKind: "const";
  name: string;
  declaration: ConstDeclaration;
  exported: boolean;
  module: string;
}

export interface ReadonlySymbol {
  symbolKind: "readonly";
  name: string;
  declaration: ReadonlyDeclaration;
  exported: boolean;
  module: string;
}

// ============================================================================
// Module symbol table
// ============================================================================

/**
 * A resolved import binding — the result of resolving an ImportDeclaration
 * specifier against the source module's exports.
 */
export interface ResolvedImport {
  /** The local name in the importing module. */
  localName: string;
  /** The exported name in the source module. */
  sourceName: string;
  /** Resolved absolute path of the source module. */
  sourceModule: string;
  /** Whether this is a type-only import. */
  typeOnly: boolean;
  /** The symbol this import resolved to (null if unresolved). */
  symbol: ModuleSymbol | null;
}

/**
 * A namespace import: `import * as ns from "mod"`.
 * Binds all exports of the source module under a single name.
 */
export interface ResolvedNamespaceImport {
  /** The local namespace name. */
  localName: string;
  /** Resolved absolute path of the source module. */
  sourceModule: string;
  /** Whether this is a type-only import. */
  typeOnly: boolean;
}

/**
 * Per-module analysis result.
 */
export interface ModuleSymbolTable {
  /** Resolved absolute path of the module file. */
  path: string;
  /** The parsed AST. */
  program: Program;
  /** Mock import directives declared in this module. */
  mockImportDirectives: MockImportDirective[];
  /** Root test module whose mock environment applies to this module, if any. */
  mockRootPath: string | null;
  /** All top-level symbols declared in this module (private + exported). */
  symbols: Map<string, ModuleSymbol>;
  /** Only the exported symbols (subset of symbols). */
  exports: Map<string, ModuleSymbol>;
  /** Resolved named imports. */
  imports: ResolvedImport[];
  /** Resolved namespace imports. */
  namespaceImports: ResolvedNamespaceImport[];
  /** Diagnostics produced during analysis. */
  diagnostics: Diagnostic[];
}

// ============================================================================
// Diagnostics
// ============================================================================

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  span: SourceSpan;
  module: string;
}

// ============================================================================
// Builtin types
// ============================================================================

/**
 * Names that are always in scope as types without needing an import.
 */
export const BUILTIN_TYPE_NAMES = new Set([
  "byte",
  "int",
  "long",
  "float",
  "double",
  "string",
  "char",
  "bool",
  "JsonValue",
  "ParseError",
  "void",
  "null",
  "Array",
  "ReadonlyArray",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
  "Tuple",
  "Actor",
  "Promise",
  "Result",
]);
