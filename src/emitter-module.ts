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
  CallExpression,
} from "./ast.js";
import type { ModuleSymbolTable, ClassSymbol } from "./types.js";
import { findSharedDiscriminator, isAssignableTo, isJSONSerializable, isStreamSensitiveType, substituteTypeParams, typeContainsTypeVar, type ResolvedType } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitStatement, emitBlockStatements } from "./emitter-stmt.js";
import { emitExpression, indent, emitIdentifierSafe, scanCapturedMutables } from "./emitter-expr.js";
import { emitType, emitInnerType, mangleTypeForCppName } from "./emitter-types.js";
import { buildGenericFunctionKey, buildMonomorphizedFunctionName, functionDeclIsStreamSensitive } from "./emitter-monomorphize.js";
import { emitClassMethodDefinitions } from "./emitter-decl.js";
import { emitDefaultExpression } from "./emitter-defaults.js";
import { generateRuntimeHeader } from "./emitter-runtime.js";
import { emitInterfaceFromJSON, emitTypeAliasFromJSON, propagateJsonDemand } from "./emitter-json.js";
import { propagateMetadataDemand } from "./emitter-metadata.js";
import type { ResolvedDoofBuildTarget } from "./build-targets.js";
import { createIOSAppSupportFiles } from "./ios-app-support.js";
import { createMacOSAppSupportFiles, type ProjectSupportFile } from "./macos-app-support.js";
import { getBundledStdlibSupportFiles } from "./stdlib.js";
import { BUNDLED_STDLIB_ROOT } from "./stdlib-constants.js";
import { relativeFsPath, toPortablePath } from "./path-utils.js";
import { emitStreamNextHelperName } from "./emitter-expr-utils.js";

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

interface GenericFunctionInstantiation {
  key: string;
  modulePath: string;
  decl: FunctionDeclaration;
  typeArgs: ResolvedType[];
  emittedName: string;
}

interface GenericClassInstantiation {
  key: string;
  modulePath: string;
  decl: ClassDeclaration;
  typeArgs: ResolvedType[];
}

interface GenericMethodInstantiation {
  key: string;
  ownerModulePath: string;
  ownerDecl: ClassDeclaration;
  ownerTypeArgs: ResolvedType[];
  methodDecl: FunctionDeclaration;
  methodTypeArgs: ResolvedType[];
}

interface StreamImplRef {
  baseName: string;
  cppTypeName: string;
  modulePath: string;
}

interface StreamAliasInfo {
  streamType: Extract<ResolvedType, { kind: "stream" }>;
  impls: StreamImplRef[];
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
  buildTarget?: ResolvedDoofBuildTarget | null,
): ModuleEmitResult {
  const table = analysisResult.modules.get(modulePath);
  if (!table) {
    throw new Error(`Module not found: ${modulePath}`);
  }

  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  const interfaceImpls = buildInterfaceImplMap(analysisResult);
  const monomorphizedFunctions = collectDirectStreamFunctionInstantiations(analysisResult);
  const monomorphizedClasses = collectConcreteStreamSensitiveClassInstantiations(analysisResult);
  const { hppName, cppName } = modulePathToCppNames(modulePath, baseDir, packageOutputPaths);

  const hppCode = emitHpp(table, analysisResult, interfaceImpls, monomorphizedFunctions, monomorphizedClasses, baseDir, packageOutputPaths);
  const cppCode = emitCppFile(
    table,
    analysisResult,
    interfaceImpls,
    monomorphizedFunctions,
    monomorphizedClasses,
    baseDir,
    packageOutputPaths,
    buildTarget,
  );

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
    modules.push(emitModuleSplit(
      modPath,
      analysisResult,
      baseDir,
      buildMetadata.packageOutputPaths,
      buildMetadata.buildTarget,
    ));
  }

  const supportFiles = [
    ...getBundledStdlibSupportFiles(analysisResult.modules.keys()),
    ...(buildMetadata.buildTarget?.kind === "macos-app"
      ? createMacOSAppSupportFiles(buildMetadata.buildTarget.config, executableName)
      : buildMetadata.buildTarget?.kind === "ios-app"
        ? createIOSAppSupportFiles(buildMetadata.buildTarget.config, executableName)
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
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
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

  const monomorphizedClassesForModule = orderMonomorphizedClassInstantiations(
    [...monomorphizedClasses.values()].filter((inst) => inst.modulePath === table.path),
  );

  const mockCaptureTypes = collectMockCaptureTypes(classified);
  for (const captureType of mockCaptureTypes) {
    emitMockCaptureStruct(lines, captureType);
    lines.push("");
  }

  const streamAliases = buildStreamImplMap(analysisResult, monomorphizedClasses);
  for (const [aliasName, info] of streamAliases) {
    emitStreamAliasHpp(aliasName, info, table, lines);
    lines.push("");
  }

  // Interface aliases (use forward-declared class names via shared_ptr)
  for (const iface of classified.interfaces) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitInterfaceAliasHpp(iface.decl, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Type aliases
  for (const alias of classified.typeAliases) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement({ ...alias.decl, needsJson: false } as TypeAliasDeclaration as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Enum declarations
  for (const en of classified.enums) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(en.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Full struct definitions (with inline methods)
  // Skip extern classes — their struct is defined in the external header.
  for (const cls of nativeClasses.filter((candidate) => !classDeclIsStreamSensitive(candidate.decl))) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(cls.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const inst of monomorphizedClassesForModule) {
    const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const typeArgs = inst.typeArgs.map(emitType).join(", ");
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      typeSubstitution,
      classNameOverride: `${emitIdentifierSafe(inst.decl.name)}<${typeArgs}>`,
      emitExplicitClassSpecialization: true,
      emitMethodBodiesInline: false,
    };
    emitStatement(inst.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const inst of monomorphizedClassesForModule) {
    const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const typeArgs = inst.typeArgs.map(emitType).join(", ");
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      typeSubstitution,
      classNameOverride: `${emitIdentifierSafe(inst.decl.name)}<${typeArgs}>`,
      emitExplicitClassSpecialization: true,
      forceInline: true,
    };
    emitClassMethodDefinitions(inst.decl, ctx);
    lines.push(...ctx.sourceLines);
  }
  const dependencyModules = new Set(collectReferencedModulePaths(table));
  for (const [aliasName, info] of streamAliases) {
    emitStreamNextHelperDefinition(aliasName, info, table, dependencyModules, lines);
  }
  if (monomorphizedClassesForModule.length > 0) {
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
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
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
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitTypeAliasFromJSON(emitIdentifierSafe(alias.decl.name), disc, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Function forward declarations (exported only, non-generic)
  // Generic functions get full body in .hpp since C++ templates must be header-only.
  const exportedFunctions = classified.functions.filter(fn => fn.exported && fn.decl.name !== "main");
  const nonGenericExported = exportedFunctions.filter(fn => fn.decl.typeParams.length === 0);
  const genericExported = exportedFunctions.filter(fn => fn.decl.typeParams.length > 0 && !functionDeclIsStreamSensitive(fn.decl));
  const monomorphizedForModule = [...monomorphizedFunctions.values()].filter((inst) => inst.modulePath === table.path);
  for (const fn of nonGenericExported) {
    lines.push(emitFunctionSignature(fn.decl, interfaceImpls) + ";");
  }
  for (const inst of monomorphizedForModule) {
    lines.push(emitFunctionSignature(inst.decl, interfaceImpls, inst.emittedName, buildFunctionTypeSubstitutionMap(inst.decl, inst.typeArgs)) + ";");
  }
  if (nonGenericExported.length > 0 || monomorphizedForModule.length > 0) {
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
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Non-exported generic functions also go in .hpp (templates must be header-only)
  const nonExportedGenericFns = classified.functions.filter(
    fn => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length > 0 && !functionDeclIsStreamSensitive(fn.decl),
  );
  for (const fn of nonExportedGenericFns) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
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
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  _monomorphizedClasses: Map<string, GenericClassInstantiation>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
  buildTarget?: ResolvedDoofBuildTarget | null,
): string {
  const lines: string[] = [];
  const { hppName } = modulePathToCppNames(table.path, baseDir, packageOutputPaths);

  // Include own header and runtime
  lines.push(`#include "${hppName}"`);
  lines.push(`#include "doof_runtime.hpp"`);
  lines.push("");

  const classified = classifyStatements(table);
  const monomorphizedForModule = [...monomorphizedFunctions.values()].filter((inst) => inst.modulePath === table.path);
  const nonExportedMockFunctions = classified.functions.filter((fn) => !fn.exported && hasMockCall(fn.decl));
  const exportedMockFunctions = classified.functions.filter((fn) => fn.exported && hasMockCall(fn.decl));

  // Anonymous namespace for non-exported functions (skip generics — they're in .hpp)
  const nonExportedFns = classified.functions.filter(
    (fn) => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length === 0,
  );
  const mainDecl = classified.functions.find((fn) => fn.decl.name === "main");
  
  // Emit non-exported functions in namespace, and put doof_main there too (if there are non-exported funcs)
  // This way doof_main can call non-exported functions without ambiguity with stdlib names
  const hasNonExportedCode = nonExportedFns.length > 0 || nonExportedMockFunctions.length > 0;
  
  if (hasNonExportedCode) {
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
      const ctx = makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
      emitStatement(fn.decl as Statement, ctx);
      lines.push(...ctx.sourceLines);
      lines.push("");
    }
    
    // Emit doof_main inside the namespace so it can call non-exported functions without ambiguity
    if (mainDecl) {
      emitDoofMainFunction(mainDecl.decl, table, analysisResult, interfaceImpls, monomorphizedFunctions, lines);
    }
    
    lines.push("} // anonymous namespace");
    lines.push("");
  }

  for (const inst of monomorphizedForModule) {
    const typeSubstitution = buildFunctionTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const resolvedType = inst.decl.resolvedType && inst.decl.resolvedType.kind === "function"
      ? substituteTypeParams(inst.decl.resolvedType, typeSubstitution)
      : inst.decl.resolvedType;
    const ctx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      emitParameterDefaults: false,
      typeSubstitution,
      functionNameOverride: inst.emittedName,
      suppressTemplatePrefix: true,
      currentFunctionReturnType: resolvedType && resolvedType.kind === "function" ? resolvedType.returnType : undefined,
    };
    emitStatement(inst.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
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
      const ctx = makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
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
    const ctx = { ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions), emitParameterDefaults: false };
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Exported variable definitions
  const exportedVars = classified.variables.filter((v) => v.exported);
  for (const v of exportedVars) {
    const ctx = makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(v.stmt, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Module init function (for readonly globals)
  if (hasReadonlyGlobals(classified)) {
    emitInitFunction(table, analysisResult, classified, interfaceImpls, monomorphizedFunctions, lines, baseDir);
  }

  // main() wrapper - emit if not already emitted inside the namespace
  const mainFn = classified.functions.find((fn) => fn.decl.name === "main");
  if (mainFn) {
    // If doof_main was not emitted inside the namespace, emit it now with the app-entry wrapper.
    if (!hasNonExportedCode) {
      emitDoofMainFunction(mainFn.decl, table, analysisResult, interfaceImpls, monomorphizedFunctions, lines);
    }

    emitExternCMainEntryWrapper(mainFn.decl, table, analysisResult, baseDir, lines);
    if (buildTarget?.kind !== "ios-app") {
      emitNativeMainWrapper(lines);
    }
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

function emitDoofMainFunction(
  mainDecl: FunctionDeclaration,
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  lines: string[],
): void {
  // Emit the Doof main as doof_main (without extern C wrapper)
  const ctx = makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
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
}

function emitExternCMainEntryWrapper(
  mainDecl: FunctionDeclaration,
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  baseDir: string,
  lines: string[],
): void {
  // Emit a stable exported entry point for native shells and app hosts.
  const retType = mainDecl.resolvedType && mainDecl.resolvedType.kind === "function"
    ? emitType(mainDecl.resolvedType.returnType)
    : "int32_t";
  const hasArgs = mainDecl.params.length > 0;
  const returnsInt = retType === "int32_t" || retType === "int64_t";

  lines.push('extern "C" int doof_entry_main(int argc, char** argv) {');

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

function emitNativeMainWrapper(lines: string[]): void {
  lines.push("int main(int argc, char** argv) {");
  lines.push("    return doof_entry_main(argc, argv);");
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
  nameOverride?: string,
  typeSubstitution?: Map<string, ResolvedType>,
): string {
  const name = emitIdentifierSafe(nameOverride ?? decl.name);
  const resolvedType = decl.resolvedType && typeSubstitution
    ? substituteTypeParams(decl.resolvedType, typeSubstitution)
    : decl.resolvedType;
  const retType = resolvedType && resolvedType.kind === "function"
    ? emitType(resolvedType.returnType)
    : "auto";
  const params = decl.params.map((p) => emitParamSignature(p, typeSubstitution)).join(", ");
  return `${retType} ${name}(${params})`;
}

function emitParamSignature(param: Parameter, typeSubstitution?: Map<string, ResolvedType>): string {
  const resolvedType = param.resolvedType && typeSubstitution
    ? substituteTypeParams(param.resolvedType, typeSubstitution)
    : param.resolvedType;
  const pType = resolvedType ? emitType(resolvedType) : "auto";
  const name = emitIdentifierSafe(param.name);
  if (param.defaultValue) {
    const defaultVal = emitDefaultExpression(param.defaultValue, resolvedType ?? undefined);
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

function emitStreamAliasHpp(
  aliasName: string,
  aliasInfo: StreamAliasInfo,
  table: ModuleSymbolTable,
  lines: string[],
): void {
  const { impls, streamType } = aliasInfo;
  if (impls.length === 0) {
    throw new Error(`Cannot emit stream alias "${aliasName}" without implementing classes`);
  }

  const localClassNames = new Set<string>();
  for (const [symName, sym] of table.symbols) {
    if (sym.symbolKind === "class") localClassNames.add(symName);
  }

  const seen = new Set<string>();
  for (const cls of impls) {
    if (localClassNames.has(cls.baseName)) continue;
    if (cls.cppTypeName.includes("<")) continue;
    if (seen.has(cls.baseName)) continue;
    seen.add(cls.baseName);
    lines.push(`struct ${cls.baseName};`);
  }

  const guardName = `DOOF_STREAM_ALIAS_${aliasName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const variants = impls.map((cls) => `std::shared_ptr<${cls.cppTypeName}>`).join(", ");
  const nextType = emitType({ kind: "union", types: [streamType.elementType, { kind: "null" }] });
  const helperName = emitStreamNextHelperName(aliasName);
  lines.push(`#ifndef ${guardName}`);
  lines.push(`#define ${guardName}`);
  lines.push(`using ${aliasName} = std::variant<${variants}>;`);
  lines.push(`${nextType} ${helperName}(const ${aliasName}& stream);`);
  lines.push(`#endif`);
}

function emitStreamNextHelperDefinition(
  aliasName: string,
  aliasInfo: StreamAliasInfo,
  table: ModuleSymbolTable,
  dependencyModules: Set<string>,
  lines: string[],
): void {
  if (!aliasInfo.impls.every((impl) => impl.modulePath === table.path || dependencyModules.has(impl.modulePath))) {
    return;
  }

  const guardName = `DOOF_STREAM_NEXT_HELPER_${aliasName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const helperName = emitStreamNextHelperName(aliasName);
  const nextType = emitType({ kind: "union", types: [aliasInfo.streamType.elementType, { kind: "null" }] });
  lines.push(`#ifndef ${guardName}`);
  lines.push(`#define ${guardName}`);
  lines.push(`inline ${nextType} ${helperName}(const ${aliasName}& stream) {`);
  lines.push(`    return std::visit([](auto&& _obj) { return _obj->next(); }, stream);`);
  lines.push("}");
  lines.push(`#endif`);
  lines.push("");
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
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
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
    const ctx = makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
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
      if (cls.declaration.implements_.some((impl) => impl.name === iface.name)) {
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

function buildStreamImplMap(
  analysisResult: AnalysisResult,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
): Map<string, StreamAliasInfo> {
  const streamTypes = collectUsedStreamTypes(analysisResult, monomorphizedClasses);
  const classes: ClassSymbol[] = [];

  for (const [, table] of analysisResult.modules) {
    for (const [, sym] of table.symbols) {
      if (sym.symbolKind === "class") classes.push(sym);
    }
  }

  const result = new Map<string, StreamAliasInfo>();
  for (const streamType of streamTypes) {
    const aliasName = emitType(streamType);
    const impls: StreamImplRef[] = classes
      .filter((cls) => cls.declaration.typeParams.length === 0)
      .filter((cls) => isAssignableTo({ kind: "class", symbol: cls }, streamType))
      .map((cls) => ({
        baseName: cls.name,
        cppTypeName: cls.name,
        modulePath: cls.module,
      }));

    for (const inst of monomorphizedClasses.values()) {
      const classType: ResolvedType = {
        kind: "class",
        symbol: {
          name: inst.decl.name,
          symbolKind: "class",
          module: inst.modulePath,
          exported: false,
          declaration: inst.decl,
        },
        typeArgs: inst.typeArgs,
      };
      if (!isAssignableTo(classType, streamType)) continue;
      impls.push({
        baseName: inst.decl.name,
        cppTypeName: `${inst.decl.name}<${inst.typeArgs.map(emitType).join(", ")}>`,
        modulePath: inst.modulePath,
      });
    }

    result.set(aliasName, { streamType, impls });
  }
  return result;
}

function collectUsedStreamTypes(
  analysisResult: AnalysisResult,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
): Extract<ResolvedType, { kind: "stream" }>[] {
  const result = new Map<string, Extract<ResolvedType, { kind: "stream" }>>();

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      collectStreamTypesFromStatement(stmt, result);
    }
  }

  for (const inst of monomorphizedClasses.values()) {
    collectStreamTypesFromGenericClassInstantiation(inst, result);
  }

  return [...result.values()];
}

function collectStreamTypesFromGenericClassInstantiation(
  inst: GenericClassInstantiation,
  result: Map<string, Extract<ResolvedType, { kind: "stream" }>>,
): void {
  const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);

  for (const field of inst.decl.fields) {
    if (field.resolvedType) {
      collectStreamTypesFromResolvedType(substituteTypeParams(field.resolvedType, typeSubstitution), result);
    }
  }

  for (const method of inst.decl.methods) {
    if (method.resolvedType) {
      collectStreamTypesFromResolvedType(substituteTypeParams(method.resolvedType, typeSubstitution), result);
    }
    for (const param of method.params) {
      if (param.resolvedType) {
        collectStreamTypesFromResolvedType(substituteTypeParams(param.resolvedType, typeSubstitution), result);
      }
    }
  }
}

function collectStreamTypesFromStatement(
  stmt: Statement,
  result: Map<string, Extract<ResolvedType, { kind: "stream" }>>,
): void {
  const typedStmt = stmt as Statement & { resolvedType?: ResolvedType };
  if (typedStmt.resolvedType) collectStreamTypesFromResolvedType(typedStmt.resolvedType, result);

  switch (stmt.kind) {
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      if (stmt.resolvedType) collectStreamTypesFromResolvedType(stmt.resolvedType, result);
      collectStreamTypesFromExpression(stmt.value, result);
      break;
    case "function-declaration":
      if (stmt.resolvedType) collectStreamTypesFromResolvedType(stmt.resolvedType, result);
      for (const param of stmt.params) {
        if (param.resolvedType) collectStreamTypesFromResolvedType(param.resolvedType, result);
        if (param.defaultValue) collectStreamTypesFromExpression(param.defaultValue, result);
      }
      if (stmt.body.kind === "block") {
        for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      } else {
        collectStreamTypesFromExpression(stmt.body, result);
      }
      break;
    case "class-declaration":
      for (const field of stmt.fields) {
        if (field.resolvedType) collectStreamTypesFromResolvedType(field.resolvedType, result);
        if (field.defaultValue) collectStreamTypesFromExpression(field.defaultValue, result);
      }
      for (const method of stmt.methods) {
        collectStreamTypesFromStatement(method, result);
      }
      break;
    case "interface-declaration":
      for (const field of stmt.fields) {
        if (field.resolvedType) collectStreamTypesFromResolvedType(field.resolvedType, result);
      }
      for (const method of stmt.methods) {
        if (method.resolvedType) collectStreamTypesFromResolvedType(method.resolvedType, result);
        for (const param of method.params) {
          if (param.resolvedType) collectStreamTypesFromResolvedType(param.resolvedType, result);
        }
      }
      break;
    case "type-alias-declaration":
      break;
    case "if-statement":
      collectStreamTypesFromExpression(stmt.condition, result);
      for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      for (const elseIf of stmt.elseIfs) {
        collectStreamTypesFromExpression(elseIf.condition, result);
        for (const inner of elseIf.body.statements) collectStreamTypesFromStatement(inner, result);
      }
      if (stmt.else_) {
        for (const inner of stmt.else_.statements) collectStreamTypesFromStatement(inner, result);
      }
      break;
    case "while-statement":
      collectStreamTypesFromExpression(stmt.condition, result);
      for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectStreamTypesFromStatement(inner, result);
      }
      break;
    case "for-statement":
      if (stmt.init) collectStreamTypesFromStatement(stmt.init, result);
      if (stmt.condition) collectStreamTypesFromExpression(stmt.condition, result);
      for (const update of stmt.update) collectStreamTypesFromExpression(update, result);
      for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectStreamTypesFromStatement(inner, result);
      }
      break;
    case "for-of-statement":
      collectStreamTypesFromExpression(stmt.iterable, result);
      for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectStreamTypesFromStatement(inner, result);
      }
      break;
    case "with-statement":
      for (const binding of stmt.bindings) {
        if (binding.resolvedType) collectStreamTypesFromResolvedType(binding.resolvedType, result);
        collectStreamTypesFromExpression(binding.value, result);
      }
      for (const inner of stmt.body.statements) collectStreamTypesFromStatement(inner, result);
      break;
    case "return-statement":
      if (stmt.value) collectStreamTypesFromExpression(stmt.value, result);
      break;
    case "yield-statement":
      collectStreamTypesFromExpression(stmt.value, result);
      break;
    case "expression-statement":
      collectStreamTypesFromExpression(stmt.expression, result);
      break;
    case "export-declaration":
      collectStreamTypesFromStatement(stmt.declaration, result);
      break;
    case "block":
      for (const inner of stmt.statements) collectStreamTypesFromStatement(inner, result);
      break;
    case "case-statement":
      collectStreamTypesFromExpression(stmt.subject, result);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectStreamTypesFromStatement(inner, result);
        } else {
          collectStreamTypesFromExpression(arm.body, result);
        }
      }
      break;
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      collectStreamTypesFromExpression(stmt.value, result);
      break;
    case "try-statement":
      collectStreamTypesFromStatement(stmt.binding, result);
      break;
    default:
      break;
  }
}

function collectStreamTypesFromExpression(
  expr: Expression,
  result: Map<string, Extract<ResolvedType, { kind: "stream" }>>,
): void {
  if (expr.resolvedType) collectStreamTypesFromResolvedType(expr.resolvedType, result);

  switch (expr.kind) {
    case "binary-expression":
      collectStreamTypesFromExpression(expr.left, result);
      collectStreamTypesFromExpression(expr.right, result);
      break;
    case "unary-expression":
      collectStreamTypesFromExpression(expr.operand, result);
      break;
    case "assignment-expression":
      collectStreamTypesFromExpression(expr.target, result);
      collectStreamTypesFromExpression(expr.value, result);
      break;
    case "member-expression":
      collectStreamTypesFromExpression(expr.object, result);
      break;
    case "qualified-member-expression":
      collectStreamTypesFromExpression(expr.object, result);
      break;
    case "index-expression":
      collectStreamTypesFromExpression(expr.object, result);
      collectStreamTypesFromExpression(expr.index, result);
      break;
    case "call-expression":
      collectStreamTypesFromExpression(expr.callee, result);
      for (const arg of expr.args) collectStreamTypesFromExpression(arg.value, result);
      break;
    case "array-literal":
      for (const element of expr.elements) collectStreamTypesFromExpression(element, result);
      break;
    case "tuple-literal":
      for (const element of expr.elements) collectStreamTypesFromExpression(element, result);
      break;
    case "object-literal":
      for (const property of expr.properties) {
        if (property.value) collectStreamTypesFromExpression(property.value, result);
      }
      if (expr.spread) collectStreamTypesFromExpression(expr.spread, result);
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectStreamTypesFromExpression(entry.key, result);
        collectStreamTypesFromExpression(entry.value, result);
      }
      break;
    case "lambda-expression":
      for (const param of expr.params) {
        if (param.resolvedType) collectStreamTypesFromResolvedType(param.resolvedType, result);
        if (param.defaultValue) collectStreamTypesFromExpression(param.defaultValue, result);
      }
      if (expr.body.kind === "block") {
        for (const inner of expr.body.statements) collectStreamTypesFromStatement(inner, result);
      } else {
        collectStreamTypesFromExpression(expr.body, result);
      }
      break;
    case "if-expression":
      collectStreamTypesFromExpression(expr.condition, result);
      collectStreamTypesFromExpression(expr.then, result);
      collectStreamTypesFromExpression(expr.else_, result);
      break;
    case "case-expression":
      collectStreamTypesFromExpression(expr.subject, result);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectStreamTypesFromStatement(inner, result);
        } else {
          collectStreamTypesFromExpression(arm.body, result);
        }
      }
      break;
    case "construct-expression":
      if (expr.named) {
        for (const property of expr.args as import("./ast.js").ObjectProperty[]) {
          if (property.value) collectStreamTypesFromExpression(property.value, result);
        }
      } else {
        for (const arg of expr.args as Expression[]) collectStreamTypesFromExpression(arg, result);
      }
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") collectStreamTypesFromExpression(part, result);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const inner of expr.expression.statements) collectStreamTypesFromStatement(inner, result);
      } else {
        collectStreamTypesFromExpression(expr.expression, result);
      }
      break;
    case "actor-creation-expression":
      for (const arg of expr.args) collectStreamTypesFromExpression(arg, result);
      break;
    case "catch-expression":
      for (const inner of expr.body) collectStreamTypesFromStatement(inner, result);
      break;
    case "non-null-assertion":
      collectStreamTypesFromExpression(expr.expression, result);
      break;
    case "as-expression":
      collectStreamTypesFromExpression(expr.expression, result);
      break;
    default:
      break;
  }
}

function collectStreamTypesFromResolvedType(
  type: ResolvedType,
  result: Map<string, Extract<ResolvedType, { kind: "stream" }>>,
): void {
  if (type.kind === "stream") {
    if (streamAliasContainsTypeVar(type.elementType)) {
      return;
    }
    result.set(emitType(type), type);
    collectStreamTypesFromResolvedType(type.elementType, result);
    return;
  }

  switch (type.kind) {
    case "array":
    case "set":
      collectStreamTypesFromResolvedType(type.elementType, result);
      break;
    case "map":
      collectStreamTypesFromResolvedType(type.keyType, result);
      collectStreamTypesFromResolvedType(type.valueType, result);
      break;
    case "union":
      for (const inner of type.types) collectStreamTypesFromResolvedType(inner, result);
      break;
    case "tuple":
      for (const inner of type.elements) collectStreamTypesFromResolvedType(inner, result);
      break;
    case "function":
      for (const param of type.params) collectStreamTypesFromResolvedType(param.type, result);
      collectStreamTypesFromResolvedType(type.returnType, result);
      break;
    case "weak":
      collectStreamTypesFromResolvedType(type.inner, result);
      break;
    case "class":
    case "interface":
      for (const arg of type.typeArgs ?? []) collectStreamTypesFromResolvedType(arg, result);
      break;
    case "result":
      collectStreamTypesFromResolvedType(type.successType, result);
      collectStreamTypesFromResolvedType(type.errorType, result);
      break;
    case "promise":
      collectStreamTypesFromResolvedType(type.valueType, result);
      break;
    case "actor":
      collectStreamTypesFromResolvedType(type.innerClass, result);
      break;
    case "success-wrapper":
      collectStreamTypesFromResolvedType(type.valueType, result);
      break;
    case "failure-wrapper":
      collectStreamTypesFromResolvedType(type.errorType, result);
      break;
    case "mock-capture":
      for (const field of type.fields) collectStreamTypesFromResolvedType(field.type, result);
      break;
    case "class-metadata":
    case "method-reflection":
      collectStreamTypesFromResolvedType(type.classType, result);
      break;
    default:
      break;
  }
}

function collectDirectStreamFunctionInstantiations(
  analysisResult: AnalysisResult,
): Map<string, GenericFunctionInstantiation> {
  const result = new Map<string, GenericFunctionInstantiation>();
  const pending: GenericFunctionInstantiation[] = [];

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      collectDirectStreamInstantiationsFromStatement(stmt, result, pending);
    }
  }

  while (pending.length > 0) {
    const instantiation = pending.pop()!;
    const typeSubstitution = buildFunctionTypeSubstitutionMap(instantiation.decl, instantiation.typeArgs);
    collectDirectStreamInstantiationsFromFunction(instantiation.decl, typeSubstitution, result, pending);
  }

  return result;
}

function collectDirectStreamInstantiationsFromStatement(
  stmt: Statement,
  result: Map<string, GenericFunctionInstantiation>,
  pending: GenericFunctionInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  switch (stmt.kind) {
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      collectDirectStreamInstantiationsFromExpression(stmt.value, result, pending, typeSubstitution);
      break;
    case "function-declaration":
      for (const param of stmt.params) {
        if (param.defaultValue) collectDirectStreamInstantiationsFromExpression(param.defaultValue, result, pending, typeSubstitution);
      }
      if (stmt.body.kind === "block") {
        for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      } else {
        collectDirectStreamInstantiationsFromExpression(stmt.body, result, pending, typeSubstitution);
      }
      break;
    case "class-declaration":
      for (const field of stmt.fields) {
        if (field.defaultValue) collectDirectStreamInstantiationsFromExpression(field.defaultValue, result, pending, typeSubstitution);
      }
      for (const method of stmt.methods) {
        if (method.body.kind === "block") {
          for (const inner of method.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
        } else {
          collectDirectStreamInstantiationsFromExpression(method.body, result, pending, typeSubstitution);
        }
      }
      break;
    case "if-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.condition, result, pending, typeSubstitution);
      for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      for (const elseIf of stmt.elseIfs) {
        collectDirectStreamInstantiationsFromExpression(elseIf.condition, result, pending, typeSubstitution);
        for (const inner of elseIf.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      }
      if (stmt.else_) {
        for (const inner of stmt.else_.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      }
      break;
    case "while-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.condition, result, pending, typeSubstitution);
      for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      }
      break;
    case "for-statement":
      if (stmt.init) collectDirectStreamInstantiationsFromStatement(stmt.init, result, pending, typeSubstitution);
      if (stmt.condition) collectDirectStreamInstantiationsFromExpression(stmt.condition, result, pending, typeSubstitution);
      for (const update of stmt.update) collectDirectStreamInstantiationsFromExpression(update, result, pending, typeSubstitution);
      for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      }
      break;
    case "for-of-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.iterable, result, pending, typeSubstitution);
      for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      }
      break;
    case "with-statement":
      for (const binding of stmt.bindings) collectDirectStreamInstantiationsFromExpression(binding.value, result, pending, typeSubstitution);
      for (const inner of stmt.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      break;
    case "return-statement":
      if (stmt.value) collectDirectStreamInstantiationsFromExpression(stmt.value, result, pending, typeSubstitution);
      break;
    case "yield-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.value, result, pending, typeSubstitution);
      break;
    case "expression-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.expression, result, pending, typeSubstitution);
      break;
    case "export-declaration":
      collectDirectStreamInstantiationsFromStatement(stmt.declaration, result, pending, typeSubstitution);
      break;
    case "block":
      for (const inner of stmt.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      break;
    case "case-statement":
      collectDirectStreamInstantiationsFromExpression(stmt.subject, result, pending, typeSubstitution);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
        } else {
          collectDirectStreamInstantiationsFromExpression(arm.body, result, pending, typeSubstitution);
        }
      }
      break;
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      collectDirectStreamInstantiationsFromExpression(stmt.value, result, pending, typeSubstitution);
      break;
    case "try-statement":
      collectDirectStreamInstantiationsFromStatement(stmt.binding, result, pending, typeSubstitution);
      break;
    default:
      break;
  }
}

function collectDirectStreamInstantiationsFromFunction(
  decl: FunctionDeclaration,
  typeSubstitution: Map<string, ResolvedType>,
  result: Map<string, GenericFunctionInstantiation>,
  pending: GenericFunctionInstantiation[],
): void {
  for (const param of decl.params) {
    if (param.defaultValue) {
      collectDirectStreamInstantiationsFromExpression(param.defaultValue, result, pending, typeSubstitution);
    }
  }

  if (decl.body.kind === "block") {
    for (const stmt of decl.body.statements) {
      collectDirectStreamInstantiationsFromStatement(stmt, result, pending, typeSubstitution);
    }
    return;
  }

  collectDirectStreamInstantiationsFromExpression(decl.body, result, pending, typeSubstitution);
}

function collectDirectStreamInstantiationsFromExpression(
  expr: Expression,
  result: Map<string, GenericFunctionInstantiation>,
  pending: GenericFunctionInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  if (expr.kind === "call-expression") {
    maybeRecordDirectStreamInstantiation(expr, result, pending, typeSubstitution);
  }

  switch (expr.kind) {
    case "binary-expression":
      collectDirectStreamInstantiationsFromExpression(expr.left, result, pending, typeSubstitution);
      collectDirectStreamInstantiationsFromExpression(expr.right, result, pending, typeSubstitution);
      break;
    case "unary-expression":
      collectDirectStreamInstantiationsFromExpression(expr.operand, result, pending, typeSubstitution);
      break;
    case "assignment-expression":
      collectDirectStreamInstantiationsFromExpression(expr.target, result, pending, typeSubstitution);
      collectDirectStreamInstantiationsFromExpression(expr.value, result, pending, typeSubstitution);
      break;
    case "member-expression":
    case "qualified-member-expression":
      collectDirectStreamInstantiationsFromExpression(expr.object, result, pending, typeSubstitution);
      break;
    case "index-expression":
      collectDirectStreamInstantiationsFromExpression(expr.object, result, pending, typeSubstitution);
      collectDirectStreamInstantiationsFromExpression(expr.index, result, pending, typeSubstitution);
      break;
    case "call-expression":
      collectDirectStreamInstantiationsFromExpression(expr.callee, result, pending, typeSubstitution);
      for (const arg of expr.args) collectDirectStreamInstantiationsFromExpression(arg.value, result, pending, typeSubstitution);
      break;
    case "array-literal":
    case "tuple-literal":
      for (const element of expr.elements) collectDirectStreamInstantiationsFromExpression(element, result, pending, typeSubstitution);
      break;
    case "object-literal":
      for (const property of expr.properties) {
        if (property.value) collectDirectStreamInstantiationsFromExpression(property.value, result, pending, typeSubstitution);
      }
      if (expr.spread) collectDirectStreamInstantiationsFromExpression(expr.spread, result, pending, typeSubstitution);
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectDirectStreamInstantiationsFromExpression(entry.key, result, pending, typeSubstitution);
        collectDirectStreamInstantiationsFromExpression(entry.value, result, pending, typeSubstitution);
      }
      break;
    case "lambda-expression":
      for (const param of expr.params) {
        if (param.defaultValue) collectDirectStreamInstantiationsFromExpression(param.defaultValue, result, pending, typeSubstitution);
      }
      if (expr.body.kind === "block") {
        for (const inner of expr.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      } else {
        collectDirectStreamInstantiationsFromExpression(expr.body, result, pending, typeSubstitution);
      }
      break;
    case "if-expression":
      collectDirectStreamInstantiationsFromExpression(expr.condition, result, pending, typeSubstitution);
      collectDirectStreamInstantiationsFromExpression(expr.then, result, pending, typeSubstitution);
      collectDirectStreamInstantiationsFromExpression(expr.else_, result, pending, typeSubstitution);
      break;
    case "case-expression":
      collectDirectStreamInstantiationsFromExpression(expr.subject, result, pending, typeSubstitution);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
        } else {
          collectDirectStreamInstantiationsFromExpression(arm.body, result, pending, typeSubstitution);
        }
      }
      break;
    case "construct-expression":
      if (expr.named) {
        for (const property of expr.args as import("./ast.js").ObjectProperty[]) {
          if (property.value) collectDirectStreamInstantiationsFromExpression(property.value, result, pending, typeSubstitution);
        }
      } else {
        for (const arg of expr.args as Expression[]) collectDirectStreamInstantiationsFromExpression(arg, result, pending, typeSubstitution);
      }
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") collectDirectStreamInstantiationsFromExpression(part, result, pending, typeSubstitution);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const inner of expr.expression.statements) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      } else {
        collectDirectStreamInstantiationsFromExpression(expr.expression, result, pending, typeSubstitution);
      }
      break;
    case "actor-creation-expression":
      for (const arg of expr.args) collectDirectStreamInstantiationsFromExpression(arg, result, pending, typeSubstitution);
      break;
    case "catch-expression":
      for (const inner of expr.body) collectDirectStreamInstantiationsFromStatement(inner, result, pending, typeSubstitution);
      break;
    case "non-null-assertion":
      collectDirectStreamInstantiationsFromExpression(expr.expression, result, pending, typeSubstitution);
      break;
    case "as-expression":
      collectDirectStreamInstantiationsFromExpression(expr.expression, result, pending, typeSubstitution);
      break;
    default:
      break;
  }
}

function collectConcreteStreamSensitiveClassInstantiations(
  analysisResult: AnalysisResult,
): Map<string, GenericClassInstantiation> {
  const result = new Map<string, GenericClassInstantiation>();
  const pendingClasses: GenericClassInstantiation[] = [];
  const pendingMethods: GenericMethodInstantiation[] = [];

  for (const [, table] of analysisResult.modules) {
    for (const stmt of table.program.statements) {
      collectConcreteClassInstantiationsFromStatement(stmt, result, pendingClasses, pendingMethods);
    }
  }

  while (pendingClasses.length > 0 || pendingMethods.length > 0) {
    const methodInstantiation = pendingMethods.pop();
    if (methodInstantiation) {
      collectConcreteClassInstantiationsFromMethodInstantiation(
        methodInstantiation,
        result,
        pendingClasses,
        pendingMethods,
      );
      continue;
    }

    const classInstantiation = pendingClasses.pop();
    if (classInstantiation) {
      collectConcreteClassInstantiationsFromClassInstantiation(
        classInstantiation,
        result,
        pendingClasses,
        pendingMethods,
      );
    }
  }

  return result;
}

function collectConcreteClassInstantiationsFromStatement(
  stmt: Statement,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
  pendingMethods: GenericMethodInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  const typedStmt = stmt as Statement & { resolvedType?: ResolvedType };
  const resolvedStmtType = typedStmt.resolvedType && typeSubstitution
    ? substituteTypeParams(typedStmt.resolvedType, typeSubstitution)
    : typedStmt.resolvedType;
  if (resolvedStmtType) {
    collectConcreteClassInstantiationsFromResolvedType(resolvedStmtType, result, pendingClasses);
  }

  switch (stmt.kind) {
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      if (stmt.resolvedType) {
        const resolvedType = typeSubstitution ? substituteTypeParams(stmt.resolvedType, typeSubstitution) : stmt.resolvedType;
        collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
      }
      collectConcreteClassInstantiationsFromExpression(stmt.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "function-declaration":
      if (stmt.resolvedType) {
        const resolvedType = typeSubstitution ? substituteTypeParams(stmt.resolvedType, typeSubstitution) : stmt.resolvedType;
        collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
      }
      for (const param of stmt.params) {
        if (param.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(param.resolvedType, typeSubstitution) : param.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
        if (param.defaultValue) {
          collectConcreteClassInstantiationsFromExpression(param.defaultValue, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      if (stmt.body.kind === "block") {
        for (const inner of stmt.body.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      } else {
        collectConcreteClassInstantiationsFromExpression(stmt.body, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "class-declaration":
      for (const field of stmt.fields) {
        if (field.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(field.resolvedType, typeSubstitution) : field.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
        if (field.defaultValue) {
          collectConcreteClassInstantiationsFromExpression(field.defaultValue, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      for (const method of stmt.methods) {
        collectConcreteClassInstantiationsFromStatement(method, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "interface-declaration":
      for (const field of stmt.fields) {
        if (field.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(field.resolvedType, typeSubstitution) : field.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
      }
      for (const method of stmt.methods) {
        if (method.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(method.resolvedType, typeSubstitution) : method.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
        for (const param of method.params) {
          if (param.resolvedType) {
            const resolvedType = typeSubstitution ? substituteTypeParams(param.resolvedType, typeSubstitution) : param.resolvedType;
            collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
          }
        }
      }
      break;
    case "if-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.condition, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const inner of stmt.body.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      for (const elseIf of stmt.elseIfs) {
        collectConcreteClassInstantiationsFromExpression(elseIf.condition, result, pendingClasses, pendingMethods, typeSubstitution);
        for (const inner of elseIf.body.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      if (stmt.else_) {
        for (const inner of stmt.else_.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "while-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.condition, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const inner of stmt.body.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "for-statement":
      if (stmt.init) collectConcreteClassInstantiationsFromStatement(stmt.init, result, pendingClasses, pendingMethods, typeSubstitution);
      if (stmt.condition) collectConcreteClassInstantiationsFromExpression(stmt.condition, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const update of stmt.update) collectConcreteClassInstantiationsFromExpression(update, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const inner of stmt.body.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "for-of-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.iterable, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const inner of stmt.body.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "with-statement":
      for (const binding of stmt.bindings) {
        if (binding.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(binding.resolvedType, typeSubstitution) : binding.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
        collectConcreteClassInstantiationsFromExpression(binding.value, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      for (const inner of stmt.body.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "return-statement":
      if (stmt.value) collectConcreteClassInstantiationsFromExpression(stmt.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "yield-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "expression-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.expression, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "export-declaration":
      collectConcreteClassInstantiationsFromStatement(stmt.declaration, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "block":
      for (const inner of stmt.statements) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "case-statement":
      collectConcreteClassInstantiationsFromExpression(stmt.subject, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) {
            collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
          }
        } else {
          collectConcreteClassInstantiationsFromExpression(arm.body, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      collectConcreteClassInstantiationsFromExpression(stmt.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "try-statement":
      collectConcreteClassInstantiationsFromStatement(stmt.binding, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    default:
      break;
  }
}

function collectConcreteClassInstantiationsFromExpression(
  expr: Expression,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
  pendingMethods: GenericMethodInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  const resolvedExprType = expr.resolvedType && typeSubstitution
    ? substituteTypeParams(expr.resolvedType, typeSubstitution)
    : expr.resolvedType;
  if (resolvedExprType) collectConcreteClassInstantiationsFromResolvedType(resolvedExprType, result, pendingClasses);

  if (expr.kind === "call-expression") {
    maybeRecordGenericMethodInstantiation(expr, result, pendingClasses, pendingMethods, typeSubstitution);
  }

  switch (expr.kind) {
    case "binary-expression":
      collectConcreteClassInstantiationsFromExpression(expr.left, result, pendingClasses, pendingMethods, typeSubstitution);
      collectConcreteClassInstantiationsFromExpression(expr.right, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "unary-expression":
      collectConcreteClassInstantiationsFromExpression(expr.operand, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "assignment-expression":
      collectConcreteClassInstantiationsFromExpression(expr.target, result, pendingClasses, pendingMethods, typeSubstitution);
      collectConcreteClassInstantiationsFromExpression(expr.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "member-expression":
    case "qualified-member-expression":
      collectConcreteClassInstantiationsFromExpression(expr.object, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "index-expression":
      collectConcreteClassInstantiationsFromExpression(expr.object, result, pendingClasses, pendingMethods, typeSubstitution);
      collectConcreteClassInstantiationsFromExpression(expr.index, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "call-expression":
      collectConcreteClassInstantiationsFromExpression(expr.callee, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const arg of expr.args) collectConcreteClassInstantiationsFromExpression(arg.value, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "array-literal":
    case "tuple-literal":
      for (const element of expr.elements) collectConcreteClassInstantiationsFromExpression(element, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "object-literal":
      for (const property of expr.properties) {
        if (property.value) {
          collectConcreteClassInstantiationsFromExpression(property.value, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      if (expr.spread) collectConcreteClassInstantiationsFromExpression(expr.spread, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectConcreteClassInstantiationsFromExpression(entry.key, result, pendingClasses, pendingMethods, typeSubstitution);
        collectConcreteClassInstantiationsFromExpression(entry.value, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "lambda-expression":
      for (const param of expr.params) {
        if (param.resolvedType) {
          const resolvedType = typeSubstitution ? substituteTypeParams(param.resolvedType, typeSubstitution) : param.resolvedType;
          collectConcreteClassInstantiationsFromResolvedType(resolvedType, result, pendingClasses);
        }
        if (param.defaultValue) {
          collectConcreteClassInstantiationsFromExpression(param.defaultValue, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      if (expr.body.kind === "block") {
        for (const inner of expr.body.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      } else {
        collectConcreteClassInstantiationsFromExpression(expr.body, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "if-expression":
      collectConcreteClassInstantiationsFromExpression(expr.condition, result, pendingClasses, pendingMethods, typeSubstitution);
      collectConcreteClassInstantiationsFromExpression(expr.then, result, pendingClasses, pendingMethods, typeSubstitution);
      collectConcreteClassInstantiationsFromExpression(expr.else_, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "case-expression":
      collectConcreteClassInstantiationsFromExpression(expr.subject, result, pendingClasses, pendingMethods, typeSubstitution);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) {
            collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
          }
        } else {
          collectConcreteClassInstantiationsFromExpression(arm.body, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "construct-expression":
      if (expr.named) {
        for (const property of expr.args as import("./ast.js").ObjectProperty[]) {
          if (property.value) {
            collectConcreteClassInstantiationsFromExpression(property.value, result, pendingClasses, pendingMethods, typeSubstitution);
          }
        }
      } else {
        for (const arg of expr.args as Expression[]) {
          collectConcreteClassInstantiationsFromExpression(arg, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") {
          collectConcreteClassInstantiationsFromExpression(part, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const inner of expr.expression.statements) {
          collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
        }
      } else {
        collectConcreteClassInstantiationsFromExpression(expr.expression, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "actor-creation-expression":
      for (const arg of expr.args) collectConcreteClassInstantiationsFromExpression(arg, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "catch-expression":
      for (const inner of expr.body) {
        collectConcreteClassInstantiationsFromStatement(inner, result, pendingClasses, pendingMethods, typeSubstitution);
      }
      break;
    case "non-null-assertion":
      collectConcreteClassInstantiationsFromExpression(expr.expression, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    case "as-expression":
      collectConcreteClassInstantiationsFromExpression(expr.expression, result, pendingClasses, pendingMethods, typeSubstitution);
      break;
    default:
      break;
  }
}

function collectConcreteClassInstantiationsFromResolvedType(
  type: ResolvedType,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
): void {
  if (type.kind === "class"
      && type.symbol.declaration.typeParams.length > 0
      && classDeclIsStreamSensitive(type.symbol.declaration)
      && type.typeArgs
      && type.typeArgs.length > 0
      && !type.typeArgs.some(typeContainsTypeVar)) {
    const key = buildGenericClassKey(type.symbol.module, type.symbol.name, type.typeArgs);
    if (!result.has(key)) {
      const instantiation = {
        key,
        modulePath: type.symbol.module,
        decl: type.symbol.declaration,
        typeArgs: type.typeArgs,
      };
      result.set(key, instantiation);
      pendingClasses.push(instantiation);
    }
  }

  switch (type.kind) {
    case "array":
    case "set":
    case "stream":
      collectConcreteClassInstantiationsFromResolvedType(type.elementType, result, pendingClasses);
      break;
    case "map":
      collectConcreteClassInstantiationsFromResolvedType(type.keyType, result, pendingClasses);
      collectConcreteClassInstantiationsFromResolvedType(type.valueType, result, pendingClasses);
      break;
    case "union":
      for (const inner of type.types) collectConcreteClassInstantiationsFromResolvedType(inner, result, pendingClasses);
      break;
    case "tuple":
      for (const inner of type.elements) collectConcreteClassInstantiationsFromResolvedType(inner, result, pendingClasses);
      break;
    case "function":
      for (const param of type.params) collectConcreteClassInstantiationsFromResolvedType(param.type, result, pendingClasses);
      collectConcreteClassInstantiationsFromResolvedType(type.returnType, result, pendingClasses);
      break;
    case "weak":
      collectConcreteClassInstantiationsFromResolvedType(type.inner, result, pendingClasses);
      break;
    case "class":
    case "interface":
      for (const arg of type.typeArgs ?? []) collectConcreteClassInstantiationsFromResolvedType(arg, result, pendingClasses);
      break;
    case "result":
      collectConcreteClassInstantiationsFromResolvedType(type.successType, result, pendingClasses);
      collectConcreteClassInstantiationsFromResolvedType(type.errorType, result, pendingClasses);
      break;
    case "promise":
      collectConcreteClassInstantiationsFromResolvedType(type.valueType, result, pendingClasses);
      break;
    case "actor":
      collectConcreteClassInstantiationsFromResolvedType(type.innerClass, result, pendingClasses);
      break;
    case "success-wrapper":
      collectConcreteClassInstantiationsFromResolvedType(type.valueType, result, pendingClasses);
      break;
    case "failure-wrapper":
      collectConcreteClassInstantiationsFromResolvedType(type.errorType, result, pendingClasses);
      break;
    case "mock-capture":
      for (const field of type.fields) collectConcreteClassInstantiationsFromResolvedType(field.type, result, pendingClasses);
      break;
    case "class-metadata":
    case "method-reflection":
      collectConcreteClassInstantiationsFromResolvedType(type.classType, result, pendingClasses);
      break;
    default:
      break;
  }
}

function collectConcreteClassInstantiationsFromClassInstantiation(
  inst: GenericClassInstantiation,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
  pendingMethods: GenericMethodInstantiation[],
): void {
  const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);

  for (const field of inst.decl.fields) {
    if (field.resolvedType) {
      collectConcreteClassInstantiationsFromResolvedType(
        substituteTypeParams(field.resolvedType, typeSubstitution),
        result,
        pendingClasses,
      );
    }
    if (field.defaultValue) {
      collectConcreteClassInstantiationsFromExpression(
        field.defaultValue,
        result,
        pendingClasses,
        pendingMethods,
        typeSubstitution,
      );
    }
  }

  for (const method of inst.decl.methods) {
    if (method.typeParams.length > 0) continue;
    collectConcreteClassInstantiationsFromStatement(
      method,
      result,
      pendingClasses,
      pendingMethods,
      typeSubstitution,
    );
  }
}

function collectConcreteClassInstantiationsFromMethodInstantiation(
  inst: GenericMethodInstantiation,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
  pendingMethods: GenericMethodInstantiation[],
): void {
  const typeSubstitution = combineTypeSubstitutions(
    buildClassTypeSubstitutionMap(inst.ownerDecl, inst.ownerTypeArgs),
    buildFunctionTypeSubstitutionMap(inst.methodDecl, inst.methodTypeArgs),
  );

  collectConcreteClassInstantiationsFromStatement(
    inst.methodDecl,
    result,
    pendingClasses,
    pendingMethods,
    typeSubstitution,
  );
}

function maybeRecordGenericMethodInstantiation(
  expr: CallExpression,
  result: Map<string, GenericClassInstantiation>,
  pendingClasses: GenericClassInstantiation[],
  pendingMethods: GenericMethodInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  if (!expr.resolvedGenericOwnerClass || !expr.resolvedGenericMethodName || !expr.resolvedGenericTypeArgs || expr.resolvedGenericTypeArgs.length === 0) {
    return;
  }

  const concreteMethodTypeArgs = typeSubstitution
    ? expr.resolvedGenericTypeArgs.map((typeArg) => substituteTypeParams(typeArg, typeSubstitution))
    : expr.resolvedGenericTypeArgs;
  if (concreteMethodTypeArgs.some(typeContainsTypeVar)) {
    return;
  }

  const methodDecl = expr.resolvedGenericOwnerClass.declaration.methods.find(
    (method) => method.name === expr.resolvedGenericMethodName && method.static_ === !!expr.resolvedGenericMethodStatic,
  );
  if (!methodDecl || methodDecl.typeParams.length === 0) {
    return;
  }

  const ownerType = getGenericMethodOwnerType(expr, typeSubstitution);
  if (!ownerType || ownerType.kind !== "class") {
    return;
  }

  const ownerTypeArgs = ownerType.typeArgs ?? [];
  if (expr.resolvedGenericOwnerClass.declaration.typeParams.length > 0) {
    if (ownerTypeArgs.length === 0 || ownerTypeArgs.some(typeContainsTypeVar)) {
      return;
    }
    collectConcreteClassInstantiationsFromResolvedType(ownerType, result, pendingClasses);
  }

  const ownerKey = buildGenericClassKey(ownerType.symbol.module, ownerType.symbol.name, ownerTypeArgs);
  const key = `${ownerKey}::${methodDecl.name}::${concreteMethodTypeArgs.map(mangleTypeForCppName).join("__")}`;
  if (pendingMethods.some((pending) => pending.key === key)) {
    return;
  }

  pendingMethods.push({
    key,
    ownerModulePath: ownerType.symbol.module,
    ownerDecl: ownerType.symbol.declaration,
    ownerTypeArgs,
    methodDecl,
    methodTypeArgs: concreteMethodTypeArgs,
  });
}

function getGenericMethodOwnerType(
  expr: CallExpression,
  typeSubstitution?: Map<string, ResolvedType>,
): ResolvedType | undefined {
  if (expr.callee.kind !== "member-expression" && expr.callee.kind !== "qualified-member-expression") {
    return undefined;
  }
  if (!expr.callee.object.resolvedType) return undefined;
  return typeSubstitution ? substituteTypeParams(expr.callee.object.resolvedType, typeSubstitution) : expr.callee.object.resolvedType;
}

function combineTypeSubstitutions(
  ...maps: Array<Map<string, ResolvedType>>
): Map<string, ResolvedType> {
  const result = new Map<string, ResolvedType>();
  for (const map of maps) {
    for (const [key, value] of map) {
      result.set(key, value);
    }
  }
  return result;
}

function orderMonomorphizedClassInstantiations(
  instantiations: GenericClassInstantiation[],
): GenericClassInstantiation[] {
  const byKey = new Map(instantiations.map((inst) => [inst.key, inst]));
  const dependencies = new Map<string, string[]>();

  for (const inst of instantiations) {
    const referenced = collectDirectConcreteClassDependencies(inst);
    referenced.delete(inst.key);
    dependencies.set(
      inst.key,
      [...referenced].filter((key) => byKey.has(key)).sort(),
    );
  }

  const ordered: GenericClassInstantiation[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) return;
    visiting.add(key);
    for (const dependencyKey of dependencies.get(key) ?? []) {
      visit(dependencyKey);
    }
    visiting.delete(key);
    visited.add(key);
    const inst = byKey.get(key);
    if (inst) ordered.push(inst);
  };

  for (const inst of [...instantiations].sort((left, right) => left.key.localeCompare(right.key))) {
    visit(inst.key);
  }

  return ordered;
}

function collectDirectConcreteClassDependencies(
  inst: GenericClassInstantiation,
): Set<string> {
  const result = new Map<string, GenericClassInstantiation>();
  collectConcreteClassInstantiationsFromClassInstantiation(inst, result, [], []);
  return new Set(result.keys());
}

function classDeclIsStreamSensitive(decl: ClassDeclaration): boolean {
  for (const field of decl.fields) {
    if (field.resolvedType && isStreamSensitiveType(field.resolvedType)) return true;
  }
  for (const method of decl.methods) {
    if (method.resolvedType && isStreamSensitiveType(method.resolvedType)) return true;
  }
  return false;
}

function buildGenericClassKey(
  modulePath: string,
  className: string,
  typeArgs: ResolvedType[],
): string {
  return `${modulePath}::${className}::${typeArgs.map(mangleTypeForCppName).join("__")}`;
}

function buildClassTypeSubstitutionMap(
  decl: ClassDeclaration,
  typeArgs: ResolvedType[],
): Map<string, ResolvedType> {
  const map = new Map<string, ResolvedType>();
  for (let index = 0; index < decl.typeParams.length && index < typeArgs.length; index++) {
    map.set(decl.typeParams[index], typeArgs[index]);
  }
  return map;
}

function maybeRecordDirectStreamInstantiation(
  expr: CallExpression,
  result: Map<string, GenericFunctionInstantiation>,
  pending: GenericFunctionInstantiation[],
  typeSubstitution?: Map<string, ResolvedType>,
): void {
  const binding = expr.resolvedGenericBinding;
  const typeArgs = expr.resolvedGenericTypeArgs?.map((typeArg) =>
    typeSubstitution ? substituteTypeParams(typeArg, typeSubstitution) : typeArg,
  );
  if (!binding?.symbol || binding.symbol.symbolKind !== "function" || !typeArgs || typeArgs.length === 0) {
    return;
  }

  if (typeArgs.some(typeContainsTypeVar)) {
    return;
  }

  const decl = binding.symbol.declaration;
  if (!functionDeclIsStreamSensitive(decl)) return;

  const key = buildGenericFunctionKey(binding.symbol.module, binding.symbol.name, typeArgs);
  if (result.has(key)) return;
  const instantiation = {
    key,
    modulePath: binding.symbol.module,
    decl,
    typeArgs,
    emittedName: buildMonomorphizedFunctionName(binding.symbol.name, typeArgs),
  };
  result.set(key, instantiation);
  pending.push(instantiation);
}

function buildFunctionTypeSubstitutionMap(
  decl: FunctionDeclaration,
  typeArgs: ResolvedType[],
): Map<string, ResolvedType> {
  const map = new Map<string, ResolvedType>();
  for (let index = 0; index < decl.typeParams.length && index < typeArgs.length; index++) {
    map.set(decl.typeParams[index], typeArgs[index]);
  }
  return map;
}

function streamAliasContainsTypeVar(type: ResolvedType): boolean {
  switch (type.kind) {
    case "typevar":
      return true;
    case "array":
    case "set":
    case "stream":
      return streamAliasContainsTypeVar(type.elementType);
    case "map":
      return streamAliasContainsTypeVar(type.keyType) || streamAliasContainsTypeVar(type.valueType);
    case "union":
      return type.types.some(streamAliasContainsTypeVar);
    case "tuple":
      return type.elements.some(streamAliasContainsTypeVar);
    case "function":
      return type.params.some((param) => streamAliasContainsTypeVar(param.type)) || streamAliasContainsTypeVar(type.returnType);
    case "weak":
      return streamAliasContainsTypeVar(type.inner);
    case "class":
    case "interface":
      return (type.typeArgs ?? []).some(streamAliasContainsTypeVar);
    case "result":
      return streamAliasContainsTypeVar(type.successType) || streamAliasContainsTypeVar(type.errorType);
    case "promise":
      return streamAliasContainsTypeVar(type.valueType);
    case "actor":
      return streamAliasContainsTypeVar(type.innerClass);
    case "success-wrapper":
      return streamAliasContainsTypeVar(type.valueType);
    case "failure-wrapper":
      return streamAliasContainsTypeVar(type.errorType);
    case "mock-capture":
      return type.fields.some((field) => streamAliasContainsTypeVar(field.type));
    case "class-metadata":
    case "method-reflection":
      return streamAliasContainsTypeVar(type.classType);
    default:
      return false;
  }
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
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation> = new Map(),
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
    monomorphizedFunctionNames: new Map([...monomorphizedFunctions.entries()].map(([key, inst]) => [key, inst.emittedName])),
    emitBlock: makeBlockHelper(table, analysisResult, interfaceImpls),
  };
}

function makeCppCtx(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation> = new Map(),
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
    monomorphizedFunctionNames: new Map([...monomorphizedFunctions.entries()].map(([key, inst]) => [key, inst.emittedName])),
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
