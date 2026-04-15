/**
 * Module-level C++ emission — .hpp/.cpp splitting for multi-module programs.
 *
 * Splits each Doof module into a header (.hpp) and implementation (.cpp) file:
 *   - .hpp: include guard, forward declarations, struct definitions (with inline
 *           methods), interface aliases, enum declarations, type aliases,
 *           function forward declarations
 *   - .cpp: #include own header, function implementations, variable definitions,
 *           anonymous namespace for non-exported symbols, main() wrapper
 *
 * Also exposes a top-level emitProject() function that produces all generated
 * output files for a project at once.
 */

import * as nodePath from "node:path";
import type { AnalysisResult } from "./analyzer.js";
import type { PackageOutputPaths } from "./package-manifest.js";
import type {
  Statement,
  FunctionDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  TypeAliasDeclaration,
  TypeAnnotation,
  ConstDeclaration,
  ReadonlyDeclaration,
  ImmutableBinding,
  LetDeclaration,
  Expression,
  Parameter,
} from "./ast.js";
import type { ModuleSymbolTable, ClassSymbol } from "./types.js";
import { findSharedDiscriminator, isJSONSerializable, type ResolvedType } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitStatement, emitBlockStatements } from "./emitter-stmt.js";
import { emitExpression, indent, emitIdentifierSafe, scanCapturedMutables } from "./emitter-expr.js";
import { emitType, emitInnerType } from "./emitter-types.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import { emitInterfaceFromJSON, emitTypeAliasFromJSON, propagateJsonDemand } from "./emitter-json.js";
import { propagateMetadataDemand } from "./emitter-metadata.js";
import type { ResolvedDoofBuildTarget } from "./build-targets.js";
import { createMacOSAppSupportFiles, type ProjectSupportFile } from "./macos-app-target.js";
import { BUNDLED_STDLIB_ROOT } from "./stdlib.js";
import { relativeFsPath, toPortablePath } from "./path-utils.js";

// ============================================================================
// Public types
// ============================================================================

/** Result of emitting a single module as .hpp + .cpp pair. */
export interface ModuleEmitResult {
  /** Generated C++ header content. */
  hppCode: string;
  /** Generated C++ source content. */
  cppCode: string;
  /** Original module path. */
  modulePath: string;
  /** C++ header filename (relative). */
  hppPath: string;
  /** C++ source filename (relative). */
  cppPath: string;
}

/** Result of emitting a full project. */
export interface ProjectCopiedFile {
  sourcePath: string;
  relativePath: string;
  kind: "file" | "directory" | "auto";
}

export interface ProjectEmitResult {
  /** All module .hpp/.cpp pairs. */
  modules: ModuleEmitResult[];
  /** doof_runtime.hpp content. */
  runtime: string;
  /** Additional generated support files. */
  supportFiles: ProjectSupportFile[];
  /** Native package files or trees copied into the output directory. */
  outputNativeCopies: ProjectCopiedFile[];
  /** Output-relative include search roots for copied native inputs. */
  outputNativeIncludePaths: string[];
  /** Output-relative native source files for copied native inputs. */
  outputNativeSourceFiles: string[];
  /** Output-relative library search paths for copied native inputs. */
  outputNativeLibraryPaths: string[];
}

export interface ProjectBuildMetadata {
  outputBinaryName?: string;
  buildTarget?: ResolvedDoofBuildTarget | null;
  packageOutputPaths?: PackageOutputPaths;
}

export interface NativeBuildOptions {
  cppStd: string;
  includePaths: string[];
  libraryPaths: string[];
  linkLibraries: string[];
  frameworks: string[];
  pkgConfigPackages: string[];
  sourceFiles: string[];
  objectFiles: string[];
  compilerFlags: string[];
  linkerFlags: string[];
  defines: string[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Emit a single module as a .hpp/.cpp pair.
 *
 * @param baseDir — common base directory; output paths are relative to this.
 *                  Defaults to "/" for backward compatibility with virtual-FS tests.
 */
export function emitModuleSplit(
  modulePath: string,
  analysisResult: AnalysisResult,
  baseDir = "/",
  packageOutputPaths?: PackageOutputPaths,
): ModuleEmitResult {
  const table = analysisResult.modules.get(modulePath);
  if (!table) {
    throw new Error(`Module not found: ${modulePath}`);
  }

  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  const interfaceImpls = buildInterfaceImplMap(analysisResult);
  const { hppName, cppName } = modulePathToCppNames(modulePath, baseDir, packageOutputPaths);

  const hppCode = emitHpp(table, analysisResult, interfaceImpls, baseDir, packageOutputPaths);
  const cppCode = emitCppFile(table, analysisResult, interfaceImpls, baseDir, packageOutputPaths);

  return {
    hppCode,
    cppCode,
    modulePath,
    hppPath: hppName,
    cppPath: cppName,
  };
}

/**
 * Emit a full project: all modules split + runtime + generated support files.
 *
 * Output paths (hppPath, cppPath, #include directives) are relative to the
 * entry file's directory. Modules that live outside that directory are still
 * anchored under the output folder by stripping leading `../` segments.
 */
export function emitProject(
  entryPath: string,
  analysisResult: AnalysisResult,
  buildMetadata: ProjectBuildMetadata = {},
): ProjectEmitResult {
  // Propagate on-demand JSON flags before emission
  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  const baseDir = nodePath.dirname(entryPath);
  const executableName = buildMetadata.outputBinaryName ?? modulePathToBaseName(entryPath);
  const modules: ModuleEmitResult[] = [];
  for (const [modPath] of analysisResult.modules) {
    modules.push(emitModuleSplit(modPath, analysisResult, baseDir, buildMetadata.packageOutputPaths));
  }

  const supportFiles = [
    ...(buildMetadata.buildTarget?.kind === "macos-app"
      ? createMacOSAppSupportFiles(buildMetadata.buildTarget.config, executableName)
      : []),
  ];

  return {
    modules,
    runtime: generateRuntimeHeader(),
    supportFiles,
    outputNativeCopies: [],
    outputNativeIncludePaths: [],
    outputNativeSourceFiles: [],
    outputNativeLibraryPaths: [],
  };
}

// ============================================================================
// Header (.hpp) generation
// ============================================================================

function emitHpp(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): string {
  const lines: string[] = [];

  // Pragma once
  lines.push("#pragma once");
  lines.push("");

  // Standard system includes (used for dedup with extern includes below)
  const standardIncludes = new Set([
    "#include <cstdint>",
    "#include <memory>",
    "#include <string>",
    "#include <vector>",
    "#include <variant>",
    "#include <optional>",
    "#include <functional>",
    "#include <unordered_map>",
    "#include <unordered_set>",
    "#include <tuple>",
    "#include <type_traits>",
    "#include <cmath>",
  ]);
  for (const inc of standardIncludes) {
    lines.push(inc);
  }

  lines.push("");

  // Runtime header (needed for inline methods that use doof:: utilities)
  lines.push(`#include "doof_runtime.hpp"`);
  lines.push("");

  // Extern C++ class imports → #include their headers
  const externIncludeSet = new Set<string>();
  for (const stmt of table.program.statements) {
    if (stmt.kind === "extern-class-declaration") {
      externIncludeSet.add(formatHeaderInclude(stmt.headerPath ?? `${stmt.name}.hpp`));
    } else if (stmt.kind === "extern-function-declaration") {
      if (stmt.headerPath) {
        externIncludeSet.add(formatHeaderInclude(stmt.headerPath));
      }
    } else if (stmt.kind === "export-declaration") {
      const inner = (stmt as any).declaration;
      if (inner?.kind === "extern-function-declaration" && inner.headerPath) {
        externIncludeSet.add(formatHeaderInclude(inner.headerPath));
      } else if (inner?.kind === "extern-class-declaration") {
        externIncludeSet.add(formatHeaderInclude(inner.headerPath ?? `${inner.name}.hpp`));
      }
    }
  }
  const externIncludes = [...externIncludeSet].filter((inc) => !standardIncludes.has(inc));
  if (externIncludes.length > 0) {
    for (const inc of externIncludes) {
      lines.push(inc);
    }
    lines.push("");
  }

  // Module imports → #include their .hpp
  const moduleIncludes = new Set<string>();
  for (const dependencyModule of collectReferencedModulePaths(table)) {
    moduleIncludes.add(modulePathToInclude(dependencyModule, baseDir, packageOutputPaths));
  }
  if (moduleIncludes.size > 0) {
    for (const inc of moduleIncludes) {
      lines.push(`#include "${inc}"`);
    }
    lines.push("");
  }

  // Collect declarations by kind from the AST
  const classified = classifyStatements(table);

  // Forward declarations for classes (needed before interface aliases)
  // Skip extern classes — their struct is defined in the external header.
  const nativeClasses = classified.classes.filter((cls) => {
    const sym = table.symbols.get(cls.decl.name);
    return !(sym?.symbolKind === "class" && sym.extern_);
  });
  for (const cls of nativeClasses) {
    const tpLen = cls.decl.typeParams.length;
    if (tpLen > 0) {
      const tpl = cls.decl.typeParams.map((p: string) => `typename ${p}`).join(", ");
      lines.push(`template<${tpl}>`);
    }
    lines.push(`struct ${emitIdentifierSafe(cls.decl.name)};`);
  }
  if (nativeClasses.length > 0) {
    lines.push("");
  }

  const mockCaptureTypes = collectMockCaptureTypes(classified);
  for (const captureType of mockCaptureTypes) {
    emitMockCaptureStruct(lines, captureType);
    lines.push("");
  }

  // Interface aliases (use forward-declared class names via shared_ptr)
  for (const iface of classified.interfaces) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitInterfaceAliasHpp(iface.decl, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Type aliases
  for (const alias of classified.typeAliases) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitStatement({ ...alias.decl, needsJson: false } as TypeAliasDeclaration as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Enum declarations
  for (const en of classified.enums) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitStatement(en.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Full struct definitions (with inline methods)
  // Skip extern classes — their struct is defined in the external header.
  for (const cls of nativeClasses) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitStatement(cls.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const iface of classified.interfaces) {
    const impls = interfaceImpls.get(iface.decl.name);
    if (!impls || !iface.decl.needsJson) continue;
    const allSerializable = impls.every((cls) =>
      cls.declaration.fields.every((field) => !field.resolvedType || isJSONSerializable(field.resolvedType)),
    );
    if (!allSerializable) continue;
    const disc = findSharedDiscriminator(impls);
    if (!disc) continue;
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitInterfaceFromJSON(emitIdentifierSafe(iface.decl.name), impls, disc, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const alias of classified.typeAliases) {
    if (!alias.decl.needsJson) continue;
    const members = collectTypeAliasClassSymbols(alias.decl.type);
    const allSerializable = members && members.length > 0 && members.every((cls) =>
      cls.declaration.fields.every((field) => !field.resolvedType || isJSONSerializable(field.resolvedType)),
    );
    if (!allSerializable) continue;
    const disc = findSharedDiscriminator(members);
    if (!disc) continue;
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitTypeAliasFromJSON(emitIdentifierSafe(alias.decl.name), disc, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Function forward declarations (exported only, non-generic)
  // Generic functions get full body in .hpp since C++ templates must be header-only.
  const exportedFunctions = classified.functions.filter(fn => fn.exported && fn.decl.name !== "main");
  const nonGenericExported = exportedFunctions.filter(fn => fn.decl.typeParams.length === 0);
  const genericExported = exportedFunctions.filter(fn => fn.decl.typeParams.length > 0);
  for (const fn of nonGenericExported) {
    lines.push(emitFunctionSignature(fn.decl, interfaceImpls) + ";");
  }
  if (nonGenericExported.length > 0) {
    lines.push("");
  }

  const exportedMockFunctions = exportedFunctions.filter((fn) => hasMockCall(fn.decl));
  for (const fn of exportedMockFunctions) {
    const resolvedType = fn.decl.resolvedType;
    if (!resolvedType || resolvedType.kind !== "function" || !resolvedType.mockCall) continue;
    const mockCall = resolvedType.mockCall;
    lines.push(`extern std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName};`);
  }
  if (exportedMockFunctions.length > 0) {
    lines.push("");
  }

  // Generic function full definitions in .hpp (templates must be header-only)
  for (const fn of genericExported) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Non-exported generic functions also go in .hpp (templates must be header-only)
  const nonExportedGenericFns = classified.functions.filter(
    fn => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length > 0,
  );
  for (const fn of nonExportedGenericFns) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls);
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Exported variable declarations (extern)
  for (const v of classified.variables.filter(v => v.exported)) {
    const externDecl = emitExternVariableDecl(v.stmt);
    if (externDecl) {
      lines.push(externDecl);
    }
  }
  if (classified.variables.some(v => v.exported)) {
    lines.push("");
  }

  // Module init function declaration (for modules with readonly globals)
  if (hasReadonlyGlobals(classified)) {
    const initName = modulePathToInitName(table.path, baseDir);
    lines.push(`void ${initName}();`);
    lines.push("");
  }

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.join("\n") + "\n";
}

// ============================================================================
// Source (.cpp) generation
// ============================================================================

function emitCppFile(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): string {
  const lines: string[] = [];
  const { hppName } = modulePathToCppNames(table.path, baseDir, packageOutputPaths);

  // Include own header and runtime
  lines.push(`#include "${hppName}"`);
  lines.push(`#include "doof_runtime.hpp"`);
  lines.push("");

  const classified = classifyStatements(table);
  const nonExportedMockFunctions = classified.functions.filter((fn) => !fn.exported && hasMockCall(fn.decl));
  const exportedMockFunctions = classified.functions.filter((fn) => fn.exported && hasMockCall(fn.decl));

  // Anonymous namespace for non-exported functions (skip generics — they're in .hpp)
  const nonExportedFns = classified.functions.filter(
    (fn) => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length === 0,
  );
  if (nonExportedFns.length > 0 || nonExportedMockFunctions.length > 0) {
    lines.push("namespace {");
    lines.push("");
    for (const fn of nonExportedMockFunctions) {
      const resolvedType = fn.decl.resolvedType;
      if (!resolvedType || resolvedType.kind !== "function" || !resolvedType.mockCall) continue;
      const mockCall = resolvedType.mockCall;
      lines.push(`std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName} = std::make_shared<std::vector<${emitType(mockCall.captureType)}>>();`);
    }
    if (nonExportedMockFunctions.length > 0) {
      lines.push("");
    }
    for (const fn of nonExportedFns) {
      const ctx = makeCppCtx(table, analysisResult, interfaceImpls);
      emitStatement(fn.decl as Statement, ctx);
      lines.push(...ctx.sourceLines);
      lines.push("");
    }
    lines.push("} // anonymous namespace");
    lines.push("");
  }

  for (const fn of exportedMockFunctions) {
    const resolvedType = fn.decl.resolvedType;
    if (!resolvedType || resolvedType.kind !== "function" || !resolvedType.mockCall) continue;
    const mockCall = resolvedType.mockCall;
    lines.push(`std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName} = std::make_shared<std::vector<${emitType(mockCall.captureType)}>>();`);
  }
  if (exportedMockFunctions.length > 0) {
    lines.push("");
  }

  // Non-exported variable definitions (in anonymous namespace)
  const nonExportedVars = classified.variables.filter((v) => !v.exported);
  if (nonExportedVars.length > 0) {
    lines.push("namespace {");
    lines.push("");
    for (const v of nonExportedVars) {
      const ctx = makeCppCtx(table, analysisResult, interfaceImpls);
      emitStatement(v.stmt, ctx);
      lines.push(...ctx.sourceLines);
      lines.push("");
    }
    lines.push("} // anonymous namespace");
    lines.push("");
  }

  // Exported function implementations (skip generics — they're in .hpp)
  const exportedFns = classified.functions.filter(
    (fn) => fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length === 0,
  );
  for (const fn of exportedFns) {
    const ctx = { ...makeCppCtx(table, analysisResult, interfaceImpls), emitParameterDefaults: false };
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Exported variable definitions
  const exportedVars = classified.variables.filter((v) => v.exported);
  for (const v of exportedVars) {
    const ctx = makeCppCtx(table, analysisResult, interfaceImpls);
    emitStatement(v.stmt, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Module init function (for readonly globals)
  if (hasReadonlyGlobals(classified)) {
    emitInitFunction(table, analysisResult, classified, interfaceImpls, lines, baseDir);
  }

  // main() wrapper
  const mainFn = classified.functions.find((fn) => fn.decl.name === "main");
  if (mainFn) {
    emitMainWrapper(mainFn.decl, table, analysisResult, interfaceImpls, lines, baseDir);
  }

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.join("\n") + "\n";
}

// ============================================================================
// main() entry point wrapper
// ============================================================================

function emitMainWrapper(
  mainDecl: FunctionDeclaration,
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  lines: string[],
  baseDir: string,
): void {
  // Emit the Doof main as doof_main
  const ctx = makeCppCtx(table, analysisResult, interfaceImpls);
  const retType = mainDecl.resolvedType && mainDecl.resolvedType.kind === "function"
    ? emitType(mainDecl.resolvedType.returnType)
    : "int32_t";

  // Build doof_main parameter list
  const params = mainDecl.params.map((p) => {
    const pType = p.resolvedType ? emitType(p.resolvedType) : "auto";
    return `${pType} ${emitIdentifierSafe(p.name)}`;
  }).join(", ");

  // Emit doof_main function body
  if (mainDecl.body.kind === "block") {
    lines.push(`${retType} doof_main(${params}) {`);
    const paramNameSet = new Set(mainDecl.params.map((p) => p.name));
    const capturedMutables = scanCapturedMutables(mainDecl.body, paramNameSet);
    emitBlockStatements(mainDecl.body, {
      ...ctx,
      indent: 1,
      currentFunctionReturnType: mainDecl.resolvedType && mainDecl.resolvedType.kind === "function"
        ? mainDecl.resolvedType.returnType
        : undefined,
      capturedMutables: capturedMutables.size > 0 ? capturedMutables : undefined,
    });
    lines.push(...ctx.sourceLines);
    lines.push("}");
  } else {
    const body = emitExpression(mainDecl.body as Expression, ctx);
    lines.push(`${retType} doof_main(${params}) {`);
    lines.push(`    return ${body};`);
    lines.push("}");
  }
  lines.push("");

  // Emit C++ main() wrapper
  const hasArgs = mainDecl.params.length > 0;
  const returnsInt = retType === "int32_t" || retType === "int64_t";

  lines.push("int main(int argc, char** argv) {");

  // Module initialization calls
  const initCalls = buildInitOrder(table, analysisResult);
  for (const modPath of initCalls) {
    const initName = modulePathToInitName(modPath, baseDir);
    lines.push(`    ${initName}();`);
  }

  if (hasArgs) {
    lines.push("    auto args = std::make_shared<std::vector<std::string>>(argv, argv + argc);");
    if (returnsInt) {
      lines.push("    return static_cast<int>(doof_main(args));");
    } else {
      lines.push("    doof_main(args);");
      lines.push("    return 0;");
    }
  } else {
    if (returnsInt) {
      lines.push("    return static_cast<int>(doof_main());");
    } else {
      lines.push("    doof_main();");
      lines.push("    return 0;");
    }
  }

  lines.push("}");
}

// ============================================================================
// Declaration classification
// ============================================================================

interface ClassifiedDecl<T> {
  decl: T;
  exported: boolean;
}

type MockCaptureType = Extract<ResolvedType, { kind: "mock-capture" }>;

interface ClassifiedStatements {
  classes: ClassifiedDecl<ClassDeclaration>[];
  interfaces: ClassifiedDecl<InterfaceDeclaration>[];
  enums: ClassifiedDecl<EnumDeclaration>[];
  typeAliases: ClassifiedDecl<TypeAliasDeclaration>[];
  functions: ClassifiedDecl<FunctionDeclaration>[];
  variables: { stmt: Statement; exported: boolean }[];
}

function classifyStatements(table: ModuleSymbolTable): ClassifiedStatements {
  const result: ClassifiedStatements = {
    classes: [],
    interfaces: [],
    enums: [],
    typeAliases: [],
    functions: [],
    variables: [],
  };

  for (const stmt of table.program.statements) {
    const exported = stmt.kind === "export-declaration";
    const inner = exported ? (stmt as any).declaration as Statement : stmt;

    switch (inner.kind) {
      case "class-declaration":
        result.classes.push({ decl: inner as ClassDeclaration, exported });
        break;
      case "interface-declaration":
        result.interfaces.push({ decl: inner as InterfaceDeclaration, exported });
        break;
      case "enum-declaration":
        result.enums.push({ decl: inner as EnumDeclaration, exported });
        break;
      case "type-alias-declaration":
        result.typeAliases.push({ decl: inner as TypeAliasDeclaration, exported });
        break;
      case "function-declaration":
        result.functions.push({ decl: inner as FunctionDeclaration, exported });
        break;
      case "const-declaration":
      case "readonly-declaration":
      case "immutable-binding":
      case "let-declaration":
        result.variables.push({ stmt: inner, exported });
        break;
      case "mock-import-directive":
      case "import-declaration":
      case "extern-class-declaration":
      case "extern-function-declaration":
      case "export-list":
      case "export-all-declaration":
        // Skip — handled by includes
        break;
    }
  }

  return result;
}

function hasMockCall(
  decl: FunctionDeclaration,
): decl is FunctionDeclaration & { resolvedType: Extract<ResolvedType, { kind: "function" }> } {
  return !!(decl.resolvedType && decl.resolvedType.kind === "function" && decl.resolvedType.mockCall);
}

function collectMockCaptureTypes(classified: ClassifiedStatements): MockCaptureType[] {
  const captures = new Map<string, MockCaptureType>();

  for (const fn of classified.functions) {
    if (!hasMockCall(fn.decl)) continue;
    captures.set(fn.decl.resolvedType.mockCall!.captureType.typeName, fn.decl.resolvedType.mockCall!.captureType);
  }

  for (const cls of classified.classes) {
    for (const method of cls.decl.methods) {
      if (!hasMockCall(method)) continue;
      captures.set(method.resolvedType.mockCall!.captureType.typeName, method.resolvedType.mockCall!.captureType);
    }
  }

  return [...captures.values()].sort((left, right) => left.typeName.localeCompare(right.typeName));
}

function emitMockCaptureStruct(lines: string[], captureType: MockCaptureType): void {
  lines.push(`struct ${captureType.typeName} {`);
  for (const field of captureType.fields) {
    lines.push(`    ${emitType(field.type)} ${emitIdentifierSafe(field.name)};`);
  }
  lines.push("};");
}

/**
 * Check if a module has any readonly globals that need runtime initialization.
 */
function hasReadonlyGlobals(classified: ClassifiedStatements): boolean {
  return classified.variables.some(
    (v) => v.stmt.kind === "readonly-declaration",
  );
}

// ============================================================================
// Function signature (declaration only, no body)
// ============================================================================

/**
 * Emit just the function signature (for use in .hpp forward declarations).
 * Returns `retType name(params)` without trailing semicolon.
 */
function emitFunctionSignature(
  decl: FunctionDeclaration,
  _interfaceImpls: Map<string, ClassSymbol[]>,
): string {
  const name = emitIdentifierSafe(decl.name);
  const retType = decl.resolvedType && decl.resolvedType.kind === "function"
    ? emitType(decl.resolvedType.returnType)
    : "auto";
  const params = decl.params.map((p) => emitParamSignature(p)).join(", ");
  return `${retType} ${name}(${params})`;
}

function emitParamSignature(param: Parameter): string {
  const pType = param.resolvedType ? emitType(param.resolvedType) : "auto";
  const name = emitIdentifierSafe(param.name);
  if (param.defaultValue) {
    const defaultVal = emitDefaultExpression(param.defaultValue, param.resolvedType ?? undefined);
    return `${pType} ${name} = ${defaultVal}`;
  }
  return `${pType} ${name}`;
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
// Extern variable declarations (for .hpp)
// ============================================================================

function emitExternVariableDecl(stmt: Statement): string | null {
  switch (stmt.kind) {
    case "const-declaration": {
      const s = stmt as ConstDeclaration;
      const name = emitIdentifierSafe(s.name);
      if (s.resolvedType) {
        return `extern const ${emitType(s.resolvedType)} ${name};`;
      }
      return `extern const auto ${name};`;
    }
    case "readonly-declaration": {
      const s = stmt as ReadonlyDeclaration;
      const name = emitIdentifierSafe(s.name);
      if (s.resolvedType && s.resolvedType.kind === "class") {
        return `extern const std::shared_ptr<const ${s.resolvedType.symbol.name}> ${name};`;
      }
      if (s.resolvedType) {
        return `extern const ${emitType(s.resolvedType)} ${name};`;
      }
      return null;
    }
    case "immutable-binding": {
      const s = stmt as ImmutableBinding;
      const name = emitIdentifierSafe(s.name);
      if (s.resolvedType) {
        if (s.resolvedType.kind === "class") {
          return `extern const ${emitType(s.resolvedType)} ${name};`;
        }
        return `extern const ${emitType(s.resolvedType)} ${name};`;
      }
      return null;
    }
    case "let-declaration": {
      const s = stmt as LetDeclaration;
      const name = emitIdentifierSafe(s.name);
      if (s.resolvedType) {
        return `extern ${emitType(s.resolvedType)} ${name};`;
      }
      return null;
    }
    default:
      return null;
  }
}

// ============================================================================
// Interface alias for .hpp
// ============================================================================

function emitInterfaceAliasHpp(
  decl: InterfaceDeclaration,
  ctx: EmitContext,
): void {
  const name = emitIdentifierSafe(decl.name);
  const impls = ctx.interfaceImpls.get(decl.name);
  if (impls && impls.length > 0) {
    // Deduplicate implementors by name (same class may be collected from multiple modules)
    const seen = new Set<string>();
    const uniqueImpls = impls.filter((cls) => {
      if (seen.has(cls.name)) return false;
      seen.add(cls.name);
      return true;
    });

    // Forward-declare cross-module implementors that aren't locally declared.
    // std::shared_ptr<T> only needs a forward declaration of T, not a full definition.
    const localClassNames = new Set<string>();
    for (const [symName, sym] of ctx.module.symbols) {
      if (sym.symbolKind === "class") localClassNames.add(symName);
    }
    for (const cls of uniqueImpls) {
      if (!localClassNames.has(cls.name)) {
        ctx.sourceLines.push(`struct ${cls.name};`);
      }
    }

    const variants = uniqueImpls
      .map((cls) => `std::shared_ptr<${cls.name}>`)
      .join(", ");
    ctx.sourceLines.push(`using ${name} = std::variant<${variants}>;`);
  } else {
    throw new Error(`Cannot emit interface "${decl.name}" without implementing classes`);
  }
}

// ============================================================================
// Module initialization
// ============================================================================

/**
 * Emit the _init_module() function that initializes readonly globals.
 * Uses a static bool guard to prevent double initialization.
 * Dependencies are initialized first by calling their init functions.
 */
function emitInitFunction(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  classified: ClassifiedStatements,
  interfaceImpls: Map<string, ClassSymbol[]>,
  lines: string[],
  baseDir: string,
): void {
  const initName = modulePathToInitName(table.path, baseDir);

  lines.push(`void ${initName}() {`);
  lines.push("    static bool _initialized = false;");
  lines.push("    if (_initialized) return;");
  lines.push("    _initialized = true;");

  // Initialize dependencies first
  const depOrder = buildInitOrder(table, analysisResult);
  for (const depPath of depOrder) {
    // Don't call our own init recursively
    if (depPath === table.path) continue;
    const depInitName = modulePathToInitName(depPath, baseDir);
    lines.push(`    ${depInitName}();`);
  }

  // Initialize readonly globals
  const readonlyVars = classified.variables.filter(
    (v) => v.stmt.kind === "readonly-declaration",
  );
  for (const v of readonlyVars) {
    const ctx = makeCppCtx(table, analysisResult, interfaceImpls);
    ctx.indent = 1;
    emitStatement(v.stmt, ctx);
    lines.push(...ctx.sourceLines);
  }

  lines.push("}");
  lines.push("");
}

/**
 * Build a topological init order for modules (dependency-first).
 * Returns module paths in initialization order.
 */
function buildInitOrder(
  entryTable: ModuleSymbolTable,
  analysisResult: AnalysisResult,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);

    const table = analysisResult.modules.get(path);
    if (!table) return;

    // Visit dependencies first
    for (const dependencyModule of collectReferencedModulePaths(table)) {
      visit(dependencyModule);
    }

    // Only add if the module has readonly globals that need initialization
    const hasReadonlyGlobals = table.program.statements.some((stmt) => {
      const inner = stmt.kind === "export-declaration"
        ? (stmt as any).declaration
        : stmt;
      return inner.kind === "readonly-declaration";
    });

    if (hasReadonlyGlobals) {
      order.push(path);
    }
  }

  // Visit all imported modules from the entry
  for (const dependencyModule of collectReferencedModulePaths(entryTable)) {
    visit(dependencyModule);
  }

  return order;
}

function collectReferencedModulePaths(table: ModuleSymbolTable): string[] {
  const dependencies = new Set<string>();

  for (const imp of table.imports) {
    if (imp.sourceModule !== table.path) {
      dependencies.add(imp.sourceModule);
    }
  }

  for (const nsImp of table.namespaceImports) {
    if (nsImp.sourceModule !== table.path) {
      dependencies.add(nsImp.sourceModule);
    }
  }

  for (const sym of table.exports.values()) {
    if (sym.module !== table.path) {
      dependencies.add(sym.module);
    }
  }

  return [...dependencies];
}

// ============================================================================
// Path utilities
// ============================================================================

/**
 * Compute a relative path from baseDir, stripping leading "/" or baseDir prefix.
 */
function relativeModulePath(modulePath: string, baseDir: string): string {
  if (modulePath.startsWith(`${BUNDLED_STDLIB_ROOT}/`) || modulePath === BUNDLED_STDLIB_ROOT) {
    return nodePath.posix.join("__doof_stdlib__", relativeFsPath(BUNDLED_STDLIB_ROOT, modulePath));
  }
  return anchorRelativePath(toPortablePath(relativeFsPath(baseDir, modulePath)));
}

function relativeModulePathWithPackages(
  modulePath: string,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): string {
  if (modulePath.startsWith(`${BUNDLED_STDLIB_ROOT}/`) || modulePath === BUNDLED_STDLIB_ROOT) {
    return nodePath.posix.join("__doof_stdlib__", relativeFsPath(BUNDLED_STDLIB_ROOT, modulePath));
  }

  const mappedPath = resolvePackageModuleOutputPath(modulePath, packageOutputPaths);
  if (mappedPath) {
    return mappedPath;
  }

  return relativeModulePath(modulePath, baseDir);
}

function anchorRelativePath(relativePath: string): string {
  const parts = relativePath.split("/");
  while (parts.length > 0 && parts[0] === "..") {
    parts.shift();
  }
  return parts.join("/");
}

function formatHeaderInclude(headerPath: string): string {
  return headerPath.startsWith("<") ? `#include ${headerPath}` : `#include "${headerPath}"`;
}

/** Convert a Doof module path to C++ .hpp/.cpp filenames (relative to baseDir). */
function modulePathToCppNames(
  modulePath: string,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): { hppName: string; cppName: string } {
  const base = relativeModulePathWithPackages(modulePath, baseDir, packageOutputPaths).replace(/\.do$/, "");
  return { hppName: `${base}.hpp`, cppName: `${base}.cpp` };
}

/** Convert a Doof module path to a #include header path (relative to baseDir). */
function modulePathToInclude(modulePath: string, baseDir: string, packageOutputPaths?: PackageOutputPaths): string {
  return relativeModulePathWithPackages(modulePath, baseDir, packageOutputPaths).replace(/\.do$/, ".hpp");
}

function resolvePackageModuleOutputPath(
  modulePath: string,
  packageOutputPaths?: PackageOutputPaths,
): string | null {
  if (!packageOutputPaths) {
    return null;
  }

  let bestMatch: { rootDir: string; outputRoot: string } | null = null;
  for (const [rootDir, outputRoot] of packageOutputPaths.byRootDir) {
    if (!(modulePath === rootDir || modulePath.startsWith(`${rootDir}/`))) {
      continue;
    }
    if (!bestMatch || rootDir.length > bestMatch.rootDir.length) {
      bestMatch = { rootDir, outputRoot };
    }
  }

  if (!bestMatch) {
    return null;
  }

  const relativeWithinPackage = toPortablePath(relativeFsPath(bestMatch.rootDir, modulePath));
  if (!bestMatch.outputRoot) {
    return relativeWithinPackage;
  }
  if (!relativeWithinPackage) {
    return bestMatch.outputRoot;
  }
  return `${bestMatch.outputRoot}/${relativeWithinPackage}`;
}

/** Convert a module path to an init function name. */
function modulePathToInitName(modulePath: string, baseDir: string): string {
  const base = relativeModulePath(modulePath, baseDir).replace(/\.do$/, "").replace(/\//g, "_");
  return `_init_${base}`;
}

/** Extract base name from a module path (for project name). */
function modulePathToBaseName(modulePath: string): string {
  const parts = modulePath.replace(/^\//, "").replace(/\.do$/, "").split("/");
  return parts[parts.length - 1] || "doof_project";
}

// ============================================================================
// Interface implementation map (shared with emitter.ts)
// ============================================================================

function buildInterfaceImplMap(
  analysisResult: AnalysisResult,
): Map<string, ClassSymbol[]> {
  const impls = new Map<string, ClassSymbol[]>();

  const interfaces: import("./types.js").InterfaceSymbol[] = [];
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

function classStructurallyImplements(
  cls: ClassDeclaration,
  iface: InterfaceDeclaration,
): boolean {
  for (const field of iface.fields) {
    const classField = cls.fields.find((f) => f.names.includes(field.name));
    if (!classField) return false;
  }

  for (const method of iface.methods) {
    const classMethod = cls.methods.find((m) => m.name === method.name && m.static_ === method.static_);
    if (!classMethod) return false;
    if (classMethod.params.length !== method.params.length) return false;
  }

  return true;
}

// ============================================================================
// Context helpers
// ============================================================================

function makeHeaderCtx(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
): EmitContext {
  return {
    indent: 0,
    module: table,
    allModules: analysisResult.modules,
    headerLines: [],
    sourceLines: [],
    interfaceImpls,
    tempCounter: 0,
    inClass: false,
    emitParameterDefaults: true,
    emitBlock: makeBlockHelper(table, analysisResult, interfaceImpls),
  };
}

function makeCppCtx(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
): EmitContext {
  return {
    indent: 0,
    module: table,
    allModules: analysisResult.modules,
    headerLines: [],
    sourceLines: [],
    interfaceImpls,
    tempCounter: 0,
    inClass: false,
    emitParameterDefaults: true,
    emitBlock: makeBlockHelper(table, analysisResult, interfaceImpls),
  };
}

function makeBlockHelper(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
) {
  return (block: import("./ast.js").Block, ctx: EmitContext): string => {
    const tempCtx: EmitContext = {
      ...ctx,
      sourceLines: [],
    };
    emitBlockStatements(block, tempCtx);
    return tempCtx.sourceLines.join("\n");
  };
}
