/**
 * Module-level C++ emission — .hpp/.cpp splitting for multi-module programs.
 *
 * Splits each Doof module into a header (.hpp) and implementation (.cpp) file:
 *   - .hpp: planned include surface, forward declarations, API struct
 *           definitions, interface aliases, enum declarations, type aliases,
 *           function forward declarations
 *   - .cpp: #include own header, private implementation classes, function
 *           implementations, variable definitions, main() wrapper
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
import type { ModuleSymbolTable, ClassSymbol, ModuleSymbol } from "./types.js";
import { findSharedDiscriminator, isAssignableTo, isJSONSerializable, isJsonValueType, isStreamSensitiveType, substituteTypeParams, typeContainsTypeVar, type ResolvedType } from "./checker-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitStatement, emitBlockStatements } from "./emitter-stmt.js";
import { emitExpression, indent, emitIdentifierSafe, scanCapturedMutables } from "./emitter-expr.js";
import { emitClassCppName, emitClassForwardDeclName, emitClassSharedPtrType, emitLocalClassCppName, emitPrivateClassCppName, emitType, emitInnerType, mangleTypeForCppName } from "./emitter-types.js";
import { assignModuleNamespaces, emitModuleNamespace, emitQualifiedHelperName, emitQualifiedSymbolName } from "./emitter-names.js";
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
import { emitStreamNextHelperName, emitStreamValueHelperName } from "./emitter-expr-utils.js";

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
  /** Coverage module ID assigned to this module (only present when coverage was requested). */
  coverageModuleId?: number;
  /** Sorted 1-based Doof source line numbers that received coverage marks (only present when coverage was requested). */
  instrumentedLines?: number[];
}

/** Result of emitting a full project. */
export interface ProjectCopiedFile {
  sourcePath: string;
  relativePath: string;
  kind: "file" | "directory" | "auto";
}

/** Per-module coverage metadata returned alongside emitted C++ when coverage is enabled. */
export interface CoverageModuleMetadata {
  /** Stable integer ID used in emitted doof::coverage::cov_mark() calls. */
  moduleId: number;
  /** Absolute path of the Doof source file. */
  modulePath: string;
  /** Sorted 1-based line numbers that were instrumented (i.e. total coverable lines). */
  instrumentedLines: number[];
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
  /** Present when coverage instrumentation was requested via ProjectBuildMetadata.coverage. */
  coverageModules?: CoverageModuleMetadata[];
}

export interface ProjectBuildMetadata {
  outputBinaryName?: string;
  buildTarget?: ResolvedDoofBuildTarget | null;
  packageOutputPaths?: PackageOutputPaths;
  /** When true, emit doof::coverage::cov_mark() calls and populate coverageModules in the result. */
  coverage?: boolean;
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
  isExtern: boolean;
}

interface StreamAliasInfo {
  streamType: Extract<ResolvedType, { kind: "stream" }>;
  impls: StreamImplRef[];
}

interface HeaderPlan {
  standardIncludes: Set<string>;
  externIncludes: string[];
  externInteropPredecls: string[];
  externInteropPreAliases: string[];
  externInteropPostAliases: string[];
  crossModuleForwardDecls: string[];
  moduleIncludes: string[];
  classified: ClassifiedStatements;
  nativeClasses: ClassifiedDecl<ClassDeclaration>[];
  cppOnlyNativeClasses: ClassifiedDecl<ClassDeclaration>[];
  monomorphizedClassesForModule: GenericClassInstantiation[];
  monomorphizedMethodsForModule: GenericMethodInstantiation[];
  mockCaptureTypes: MockCaptureType[];
  streamAliases: Map<string, StreamAliasInfo>;
  streamTypesForModule: Extract<ResolvedType, { kind: "stream" }>[];
  nonGenericExportedFunctions: ClassifiedDecl<FunctionDeclaration>[];
  genericExportedFunctions: ClassifiedDecl<FunctionDeclaration>[];
  monomorphizedFunctionsForModule: GenericFunctionInstantiation[];
  exportedMockFunctions: ClassifiedDecl<FunctionDeclaration>[];
  nonExportedGenericFunctions: ClassifiedDecl<FunctionDeclaration>[];
  exportedVariables: { stmt: Statement; exported: boolean }[];
  hasInitDeclaration: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns true for Doof source modules that should receive line-coverage
 * instrumentation: non-test files that are not part of the bundled stdlib.
 */
function isCoverageEligible(modulePath: string): boolean {
  return !modulePath.endsWith(".test.do")
    && !modulePath.includes("/.doof-tests/")
    && !modulePath.startsWith(`${BUNDLED_STDLIB_ROOT}/`)
    && modulePath !== BUNDLED_STDLIB_ROOT;
}

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
  coverageModuleId?: number,
): ModuleEmitResult {
  const table = analysisResult.modules.get(modulePath);
  if (!table) {
    throw new Error(`Module not found: ${modulePath}`);
  }
  if (!table.emittedCppNamespace) {
    assignModuleNamespaces(modulePath, analysisResult.modules, packageOutputPaths);
  }
  table.emittedDiagnosticPath = relativeModulePathWithPackages(modulePath, baseDir, packageOutputPaths);

  propagateJsonDemand(analysisResult);
  propagateMetadataDemand(analysisResult);

  const interfaceImpls = buildInterfaceImplMap(analysisResult);
  const monomorphizedFunctions = collectDirectStreamFunctionInstantiations(analysisResult);
  const monomorphizedMethods = new Map<string, GenericMethodInstantiation>();
  const monomorphizedClasses = collectConcreteStreamSensitiveClassInstantiations(analysisResult, monomorphizedMethods);
  markAllHeaderVisiblePrivateClassNames(analysisResult, interfaceImpls);
  const { hppName, cppName } = modulePathToCppNames(modulePath, baseDir, packageOutputPaths);

  const hppCode = emitHpp(table, analysisResult, interfaceImpls, monomorphizedFunctions, monomorphizedClasses, monomorphizedMethods, baseDir, packageOutputPaths);
  const { code: cppCode, instrumentedLines } = emitCppFile(
    table,
    analysisResult,
    interfaceImpls,
    monomorphizedFunctions,
    monomorphizedClasses,
    baseDir,
    packageOutputPaths,
    buildTarget,
    coverageModuleId,
  );

  return {
    hppCode,
    cppCode,
    modulePath,
    hppPath: hppName,
    cppPath: cppName,
    coverageModuleId,
    instrumentedLines: coverageModuleId !== undefined
      ? [...instrumentedLines].sort((a, b) => a - b)
      : undefined,
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
  assignModuleNamespaces(entryPath, analysisResult.modules, buildMetadata.packageOutputPaths);
  const executableName = buildMetadata.outputBinaryName ?? modulePathToBaseName(entryPath);

  // Build coverage module ID map: assign a stable integer to each non-test, non-stdlib module.
  const coverageModuleIdMap = new Map<string, number>();
  if (buildMetadata.coverage) {
    let nextId = 0;
    for (const [modPath] of analysisResult.modules) {
      if (isCoverageEligible(modPath)) {
        coverageModuleIdMap.set(modPath, nextId++);
      }
    }
  }

  const modules: ModuleEmitResult[] = [];
  for (const [modPath] of analysisResult.modules) {
    modules.push(emitModuleSplit(
      modPath,
      analysisResult,
      baseDir,
      buildMetadata.packageOutputPaths,
      buildMetadata.buildTarget,
      coverageModuleIdMap.get(modPath),
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

  const coverageModules: CoverageModuleMetadata[] | undefined = buildMetadata.coverage
    ? modules
      .filter((m) => m.coverageModuleId !== undefined)
      .map((m) => ({
        moduleId: m.coverageModuleId!,
        modulePath: m.modulePath,
        instrumentedLines: m.instrumentedLines ?? [],
      }))
    : undefined;

  return {
    modules,
    runtime: generateRuntimeHeader(),
    supportFiles,
    outputNativeCopies: [],
    outputNativeIncludePaths: [],
    outputNativeSourceFiles: [],
    outputNativeLibraryPaths: [],
    coverageModules,
  };
}

// ============================================================================
// Header (.hpp) generation
// ============================================================================

function buildHeaderPlan(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
  monomorphizedMethods: Map<string, GenericMethodInstantiation>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): HeaderPlan {
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

  const classified = classifyStatements(table);
  const nativeClasses = classified.classes.filter((cls) => {
    const sym = table.symbols.get(cls.decl.name);
    return !(sym?.symbolKind === "class" && sym.extern_);
  });
  const headerSurfaceClassKeys = buildHeaderSurfaceClassKeySet(interfaceImpls, classified);
  const headerNativeClasses = nativeClasses.filter((cls) => isHeaderVisibleClass(cls, table.path, headerSurfaceClassKeys));
  markHeaderVisiblePrivateClassNames(table, headerNativeClasses);
  const exportedFunctions = classified.functions.filter((fn) => fn.exported && fn.decl.name !== "main");
  const streamAliases = buildStreamImplMap(analysisResult, monomorphizedClasses);
  const streamTypesForModule = collectUsedStreamTypesForModule(table, monomorphizedClasses);

  return {
    standardIncludes,
    externIncludes: [...externIncludeSet].filter((inc) => !standardIncludes.has(inc)),
    ...collectExternInteropAliases(table, analysisResult),
    crossModuleForwardDecls: collectCrossModuleClassForwardDecls(table, analysisResult, interfaceImpls, streamAliases, streamTypesForModule),
    moduleIncludes: collectHeaderReferencedModulePaths(table, analysisResult, classified, headerNativeClasses, monomorphizedClasses, monomorphizedMethods, monomorphizedFunctions)
      .map((dependencyModule) => modulePathToInclude(dependencyModule, baseDir, packageOutputPaths)),
    classified,
    nativeClasses: headerNativeClasses,
    cppOnlyNativeClasses: nativeClasses.filter((cls) => !headerNativeClasses.includes(cls)),
    monomorphizedClassesForModule: orderMonomorphizedClassInstantiations(
      [...monomorphizedClasses.values()].filter((inst) => inst.modulePath === table.path),
    ),
    monomorphizedMethodsForModule: [...monomorphizedMethods.values()].filter((inst) => inst.ownerModulePath === table.path),
    mockCaptureTypes: collectMockCaptureTypes(classified),
    streamAliases,
    streamTypesForModule,
    nonGenericExportedFunctions: exportedFunctions.filter((fn) => fn.decl.typeParams.length === 0),
    genericExportedFunctions: exportedFunctions.filter((fn) => fn.decl.typeParams.length > 0 && !functionDeclIsStreamSensitive(fn.decl)),
    monomorphizedFunctionsForModule: [...monomorphizedFunctions.values()].filter((inst) => inst.modulePath === table.path),
    exportedMockFunctions: exportedFunctions.filter((fn) => hasMockCall(fn.decl)),
    nonExportedGenericFunctions: classified.functions.filter(
      (fn) => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length > 0 && !functionDeclIsStreamSensitive(fn.decl),
    ),
    exportedVariables: classified.variables.filter((v) => v.exported),
    hasInitDeclaration: hasReadonlyGlobals(classified),
  };
}

function isHeaderVisibleClass(
  cls: ClassifiedDecl<ClassDeclaration>,
  modulePath: string,
  headerSurfaceClassKeys: Set<string>,
): boolean {
  return cls.exported
    || cls.decl.typeParams.length > 0
    || cls.decl.implements_.length > 0
    || classDeclIsStreamSensitive(cls.decl)
    || headerSurfaceClassKeys.has(`${modulePath}:${cls.decl.name}`);
}

function getClassSymbolForDecl(table: ModuleSymbolTable, decl: ClassDeclaration): ClassSymbol {
  const sym = table.symbols.get(decl.name);
  if (sym?.symbolKind !== "class") {
    throw new Error(`Missing class symbol for "${decl.name}" during C++ emission`);
  }
  return sym;
}

function markHeaderVisiblePrivateClassNames(
  table: ModuleSymbolTable,
  classes: ClassifiedDecl<ClassDeclaration>[],
): void {
  for (const cls of classes) {
    const sym = getClassSymbolForDecl(table, cls.decl);
    if (sym.exported || sym.extern_) continue;
    sym.emittedCppName = emitPrivateClassCppName(sym);
  }
}

function markAllHeaderVisiblePrivateClassNames(
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
): void {
  for (const table of analysisResult.modules.values()) {
    const classified = classifyStatements(table);
    const nativeClasses = classified.classes.filter((cls) => {
      const sym = table.symbols.get(cls.decl.name);
      return !(sym?.symbolKind === "class" && sym.extern_);
    });
    const headerSurfaceClassKeys = buildHeaderSurfaceClassKeySet(interfaceImpls, classified);
    markHeaderVisiblePrivateClassNames(
      table,
      nativeClasses.filter((cls) => isHeaderVisibleClass(cls, table.path, headerSurfaceClassKeys)),
    );
  }
}

function collectHeaderReferencedModulePaths(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  classified: ClassifiedStatements,
  headerNativeClasses: ClassifiedDecl<ClassDeclaration>[],
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
  monomorphizedMethods: Map<string, GenericMethodInstantiation>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
): string[] {
  const dependencies = new Set<string>();
  const hasExternInterop = moduleDeclaresExternInterop(table)
    || moduleProvidesExternInteropTypes(table.path, analysisResult);
  const addModule = (modulePath: string | null | undefined): void => {
    if (!modulePath || modulePath === table.path || modulePath.startsWith("<")) return;
    dependencies.add(modulePath);
  };

  const addTypeAnnotationDeps = (typeAnn: TypeAnnotation | null | undefined): void => {
    if (!typeAnn) return;
    switch (typeAnn.kind) {
      case "named-type": {
        const sym = typeAnn.resolvedSymbol;
        if (sym) {
          if (sym.symbolKind !== "class" || sym.extern_ || hasExternInterop) {
            addModule(sym.module);
          }
        }
        for (const arg of typeAnn.typeArgs) {
          addTypeAnnotationDeps(arg);
        }
        break;
      }
      case "array-type":
        addTypeAnnotationDeps(typeAnn.elementType);
        break;
      case "union-type":
        for (const inner of typeAnn.types) {
          addTypeAnnotationDeps(inner);
        }
        break;
      case "function-type":
        for (const param of typeAnn.params) {
          addTypeAnnotationDeps(param.type);
        }
        addTypeAnnotationDeps(typeAnn.returnType);
        break;
      case "tuple-type":
        for (const element of typeAnn.elements) {
          addTypeAnnotationDeps(element);
        }
        break;
      case "weak-type":
        addTypeAnnotationDeps(typeAnn.type);
        break;
    }
  };

  const addResolvedTypeDeps = (type: ResolvedType | null | undefined): void => {
    if (!type || isJsonValueType(type)) return;
    switch (type.kind) {
      case "interface":
        addModule(type.symbol.module);
        for (const arg of type.typeArgs ?? []) {
          addResolvedTypeDeps(arg);
        }
        break;
      case "enum":
        addModule(type.symbol.module);
        break;
      case "class":
        if (type.symbol.extern_ || hasExternInterop) {
          addModule(type.symbol.module);
        }
        for (const arg of type.typeArgs ?? []) {
          addResolvedTypeDeps(arg);
        }
        break;
      case "function":
        for (const param of type.params) {
          addResolvedTypeDeps(param.type);
        }
        addResolvedTypeDeps(type.returnType);
        break;
      case "mock-capture":
        for (const field of type.fields) {
          addResolvedTypeDeps(field.type);
        }
        break;
      case "array":
      case "set":
      case "stream":
        addResolvedTypeDeps(type.elementType);
        break;
      case "map":
        addResolvedTypeDeps(type.keyType);
        addResolvedTypeDeps(type.valueType);
        break;
      case "union":
        for (const inner of type.types) {
          addResolvedTypeDeps(inner);
        }
        break;
      case "tuple":
        for (const element of type.elements) {
          addResolvedTypeDeps(element);
        }
        break;
      case "weak":
        addResolvedTypeDeps(type.inner);
        break;
      case "actor":
        addResolvedTypeDeps(type.innerClass);
        break;
      case "promise":
        addResolvedTypeDeps(type.valueType);
        break;
      case "result":
        addResolvedTypeDeps(type.successType);
        addResolvedTypeDeps(type.errorType);
        break;
      case "class-metadata":
      case "method-reflection":
        addResolvedTypeDeps(type.classType);
        break;
      case "primitive":
      case "builtin-namespace":
      case "null":
      case "void":
      case "unknown":
      case "namespace":
      case "success-wrapper":
      case "failure-wrapper":
      case "typevar":
        break;
    }
  };

  const addFunctionSurfaceDeps = (decl: FunctionDeclaration): void => {
    addResolvedTypeDeps(decl.resolvedType);
    addTypeAnnotationDeps(decl.returnType);
    for (const param of decl.params) {
      addTypeAnnotationDeps(param.type);
      addResolvedTypeDeps(param.resolvedType);
    }
  };

  for (const sym of table.exports.values()) {
    addModule(sym.module);
  }

  for (const cls of headerNativeClasses) {
    for (const field of cls.decl.fields) {
      addTypeAnnotationDeps(field.type);
      addResolvedTypeDeps(field.resolvedType);
    }
    for (const method of cls.decl.methods) {
      addFunctionSurfaceDeps(method);
    }
  }

  for (const iface of classified.interfaces) {
    for (const field of iface.decl.fields) {
      addTypeAnnotationDeps(field.type);
      addResolvedTypeDeps(field.resolvedType);
    }
    for (const method of iface.decl.methods) {
      addTypeAnnotationDeps(method.returnType);
      addResolvedTypeDeps(method.resolvedType);
      for (const param of method.params) {
        addTypeAnnotationDeps(param.type);
        addResolvedTypeDeps(param.resolvedType);
      }
    }
  }

  for (const alias of classified.typeAliases) {
    addTypeAnnotationDeps(alias.decl.type);
  }

  const exportedFunctions = classified.functions.filter((fn) => fn.exported && fn.decl.name !== "main");
  for (const fn of exportedFunctions) {
    addFunctionSurfaceDeps(fn.decl);
  }

  for (const variable of classified.variables.filter((v) => v.exported)) {
    addResolvedTypeDeps((variable.stmt as ConstDeclaration | ReadonlyDeclaration | ImmutableBinding | LetDeclaration).resolvedType);
  }

  if (hasExternInterop) {
    for (const stmt of table.program.statements) {
      const inner = stmt.kind === "export-declaration" ? stmt.declaration : stmt;
      if (inner.kind === "extern-function-declaration") {
        for (const param of inner.params) addTypeAnnotationDeps(param.type);
        addTypeAnnotationDeps(inner.returnType);
      } else if (inner.kind === "extern-class-declaration") {
        for (const field of inner.fields) addTypeAnnotationDeps(field.type);
        for (const method of inner.methods) {
          for (const param of method.params) addTypeAnnotationDeps(param.type);
          addTypeAnnotationDeps(method.returnType);
        }
      }
    }
  }

  const emitsHeaderInlineBodies = classified.functions.some(
    (fn) => fn.decl.name !== "main" && fn.decl.typeParams.length > 0 && !functionDeclIsStreamSensitive(fn.decl),
  )
    || [...monomorphizedFunctions.values()].some((inst) => inst.modulePath === table.path)
    || [...monomorphizedClasses.values()].some((inst) => inst.modulePath === table.path)
    || [...monomorphizedMethods.values()].some((inst) => inst.ownerModulePath === table.path);
  if (emitsHeaderInlineBodies) {
    for (const dependencyModule of collectReferencedModulePaths(table)) {
      addModule(dependencyModule);
    }
  }

  const preferredOrder = collectReferencedModulePaths(table);
  const ordered = preferredOrder.filter((modulePath) => dependencies.has(modulePath));
  const remaining = [...dependencies].filter((modulePath) => !preferredOrder.includes(modulePath)).sort();
  return [...ordered, ...remaining];
}

function moduleDeclaresExternInterop(table: ModuleSymbolTable): boolean {
  for (const stmt of table.program.statements) {
    const inner = stmt.kind === "export-declaration"
      ? (stmt as any).declaration as Statement
      : stmt;
    if (inner.kind === "extern-class-declaration" || inner.kind === "extern-function-declaration") {
      return true;
    }
  }
  return false;
}

function moduleProvidesExternInteropTypes(
  modulePath: string,
  analysisResult: AnalysisResult,
): boolean {
  for (const table of analysisResult.modules.values()) {
    if (collectExternReferencedTypeSymbols(table, analysisResult).some((symbol) => symbol.module === modulePath)) {
      return true;
    }
  }
  return false;
}

function collectExternInteropAliases(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
): Pick<HeaderPlan, "externInteropPredecls" | "externInteropPreAliases" | "externInteropPostAliases"> {
  const nativeNamespaces = collectExternCppNamespaces(table);
  const referencedTypeSymbols = collectExternReferencedTypeSymbols(table, analysisResult);
  const localInteropSymbols = uniqueSymbols(referencedTypeSymbols);
  const preAliasSymbols = localInteropSymbols.filter(canAliasBeforeModuleBody);
  const postAliasMap = createExternInteropAliasMap(
    nativeNamespaces,
    localInteropSymbols.filter((symbol) => isInteropAliasableSymbol(symbol) && !canAliasBeforeModuleBody(symbol)),
  );
  mergeExternInteropAliasMaps(
    postAliasMap,
    collectProjectExternInteropPostAliasMapForModule(table.path, analysisResult),
  );

  return {
    externInteropPredecls: nativeNamespaces.length > 0
      ? emitExternInteropPredecls(table.path, referencedTypeSymbols, analysisResult)
      : [],
    externInteropPreAliases: emitExternInteropAliasBlocks(nativeNamespaces, preAliasSymbols),
    externInteropPostAliases: emitExternInteropAliasMap(postAliasMap),
  };
}

function collectExternReferencedTypeSymbols(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
): ModuleSymbol[] {
  const referencedTypeSymbols = new Map<string, ModuleSymbol>();

  const addReferencedTypeSymbol = (sym: ModuleSymbol): void => {
    if (sym.module === "<builtin>" || !isTypeLevelSymbol(sym) || isExternClassSymbol(sym)) return;
    referencedTypeSymbols.set(`${sym.module}:${sym.name}`, sym);
  };

  const addTypeAnnotation = (typeAnn: TypeAnnotation | null | undefined): void => {
    if (!typeAnn) return;
    switch (typeAnn.kind) {
      case "named-type": {
        const sym = typeAnn.resolvedSymbol;
        if (sym) {
          addReferencedTypeSymbol(sym);
          const sourceTable = analysisResult.modules.get(sym.module);
          for (const exported of sourceTable?.exports.values() ?? []) {
            addReferencedTypeSymbol(exported);
          }
        }
        for (const arg of typeAnn.typeArgs) {
          addTypeAnnotation(arg);
        }
        break;
      }
      case "array-type":
        addTypeAnnotation(typeAnn.elementType);
        break;
      case "union-type":
        for (const inner of typeAnn.types) addTypeAnnotation(inner);
        break;
      case "function-type":
        for (const param of typeAnn.params) addTypeAnnotation(param.type);
        addTypeAnnotation(typeAnn.returnType);
        break;
      case "tuple-type":
        for (const element of typeAnn.elements) addTypeAnnotation(element);
        break;
      case "weak-type":
        addTypeAnnotation(typeAnn.type);
        break;
    }
  };

  const visitExtern = (stmt: Statement): void => {
    if (stmt.kind === "extern-function-declaration") {
      for (const param of stmt.params) addTypeAnnotation(param.type);
      addTypeAnnotation(stmt.returnType);
      return;
    }
    if (stmt.kind === "extern-class-declaration") {
      for (const field of stmt.fields) addTypeAnnotation(field.type);
      for (const method of stmt.methods) {
        for (const param of method.params) addTypeAnnotation(param.type);
        addTypeAnnotation(method.returnType);
      }
    }
  };

  for (const stmt of table.program.statements) {
    const inner = stmt.kind === "export-declaration" ? stmt.declaration : stmt;
    visitExtern(inner);
  }

  return [...referencedTypeSymbols.values()];
}

function collectExternCppNamespaces(table: ModuleSymbolTable): string[] {
  const namespaces = new Set<string>();

  const visitExtern = (stmt: Statement): void => {
    if (stmt.kind !== "extern-class-declaration" && stmt.kind !== "extern-function-declaration") return;
    namespaces.add(extractCppNamespace(stmt.cppName));
  };

  for (const stmt of table.program.statements) {
    visitExtern(stmt.kind === "export-declaration" ? stmt.declaration : stmt);
  }

  return [...namespaces].sort();
}

function extractCppNamespace(cppName: string | null): string {
  if (!cppName) return "";
  const lastSeparator = cppName.lastIndexOf("::");
  return lastSeparator === -1 ? "" : cppName.slice(0, lastSeparator);
}

function isTypeLevelSymbol(symbol: ModuleSymbol): boolean {
  return symbol.symbolKind === "class"
    || symbol.symbolKind === "interface"
    || symbol.symbolKind === "enum"
    || symbol.symbolKind === "type-alias";
}

function isExternClassSymbol(symbol: ModuleSymbol): boolean {
  return symbol.symbolKind === "class" && !!symbol.extern_;
}

function canAliasBeforeModuleBody(symbol: ModuleSymbol): boolean {
  return (symbol.symbolKind === "class" && symbol.declaration.typeParams.length === 0)
    || symbol.symbolKind === "enum";
}

function isInteropAliasableSymbol(symbol: ModuleSymbol): boolean {
  if (symbol.symbolKind === "class") {
    return symbol.declaration.typeParams.length === 0;
  }
  if (symbol.symbolKind === "interface") {
    return false;
  }
  if (symbol.symbolKind === "type-alias") {
    return symbol.declaration.typeParams.length === 0;
  }
  return true;
}

function uniqueSymbols(symbols: ModuleSymbol[]): ModuleSymbol[] {
  const byIdentity = new Map<string, ModuleSymbol>();
  for (const symbol of symbols) {
    byIdentity.set(`${symbol.module}:${symbol.name}`, symbol);
  }
  return [...byIdentity.values()].sort((left, right) =>
    `${left.module}:${left.name}`.localeCompare(`${right.module}:${right.name}`),
  );
}

function emitExternInteropPredecls(
  modulePath: string,
  symbols: ModuleSymbol[],
  analysisResult: AnalysisResult,
): string[] {
  const localPredecls = uniqueSymbols(symbols.filter((symbol) =>
    symbol.module === modulePath && canAliasBeforeModuleBody(symbol),
  ));
  if (localPredecls.length === 0) return [];

  const lines: string[] = [`namespace ${emitModuleNamespace(modulePath, analysisResult.modules)} {`];
  for (const symbol of localPredecls) {
    if (symbol.symbolKind === "class") {
      const typeParams = symbol.declaration.typeParams;
      if (typeParams.length > 0) {
        lines.push(`template<${typeParams.map((param) => `typename ${param}`).join(", ")}>`);
      }
      lines.push(`struct ${emitClassForwardDeclName(symbol)};`);
    } else if (symbol.symbolKind === "enum") {
      lines.push(`enum class ${emitIdentifierSafe(symbol.name)};`);
    }
  }
  lines.push("}");
  return lines;
}

function emitExternInteropAliasBlocks(
  nativeNamespaces: string[],
  symbols: ModuleSymbol[],
): string[] {
  if (symbols.length === 0) return [];
  return emitExternInteropAliasMap(createExternInteropAliasMap(nativeNamespaces, symbols));
}

function createExternInteropAliasMap(
  nativeNamespaces: string[],
  symbols: ModuleSymbol[],
): Map<string, Map<string, ModuleSymbol>> {
  const aliases = new Map<string, Map<string, ModuleSymbol>>();
  if (symbols.length === 0) return aliases;
  for (const nativeNamespace of nativeNamespaces) {
    const namespaceAliases = aliases.get(nativeNamespace) ?? new Map<string, ModuleSymbol>();
    for (const symbol of symbols) {
      namespaceAliases.set(`${symbol.module}:${symbol.name}`, symbol);
    }
    aliases.set(nativeNamespace, namespaceAliases);
  }
  return aliases;
}

function mergeExternInteropAliasMaps(
  target: Map<string, Map<string, ModuleSymbol>>,
  source: Map<string, Map<string, ModuleSymbol>>,
): void {
  for (const [nativeNamespace, sourceAliases] of source) {
    const targetAliases = target.get(nativeNamespace) ?? new Map<string, ModuleSymbol>();
    for (const [key, symbol] of sourceAliases) {
      targetAliases.set(key, symbol);
    }
    target.set(nativeNamespace, targetAliases);
  }
}

function collectProjectExternInteropPostAliasMapForModule(
  modulePath: string,
  analysisResult: AnalysisResult,
): Map<string, Map<string, ModuleSymbol>> {
  const aliases = new Map<string, Map<string, ModuleSymbol>>();

  for (const externTable of analysisResult.modules.values()) {
    if (externTable.path === modulePath) continue;
    const nativeNamespaces = collectExternCppNamespaces(externTable);
    if (nativeNamespaces.length === 0) continue;

    const symbols = collectExternReferencedTypeSymbols(externTable, analysisResult)
      .filter((symbol) => symbol.module === modulePath && isInteropAliasableSymbol(symbol));
    mergeExternInteropAliasMaps(aliases, createExternInteropAliasMap(nativeNamespaces, symbols));
  }

  return aliases;
}

function emitExternInteropAliasMap(
  aliases: Map<string, Map<string, ModuleSymbol>>,
): string[] {
  if (aliases.size === 0) return [];

  const lines: string[] = [];
  for (const nativeNamespace of [...aliases.keys()].sort()) {
    if (nativeNamespace) {
      lines.push(`namespace ${nativeNamespace} {`);
    }
    const symbols = uniqueSymbols([...(aliases.get(nativeNamespace)?.values() ?? [])]);
    for (const symbol of symbols) {
      const targetName = symbol.symbolKind === "class"
        ? emitClassForwardDeclName(symbol)
        : emitIdentifierSafe(symbol.name);
      lines.push(`using ${emitIdentifierSafe(symbol.name)} = ${emitQualifiedSymbolName(symbol, targetName)};`);
    }
    if (nativeNamespace) {
      lines.push(`} // namespace ${nativeNamespace}`);
    }
  }
  return lines;
}

function buildHeaderSurfaceClassKeySet(
  interfaceImpls: Map<string, ClassSymbol[]>,
  classified: ClassifiedStatements,
): Set<string> {
  const result = new Set<string>();
  for (const impls of interfaceImpls.values()) {
    for (const impl of impls) {
      result.add(`${impl.module}:${impl.name}`);
    }
  }
  for (const alias of classified.typeAliases) {
    const members = collectTypeAliasClassSymbols(alias.decl.type);
    if (!members) continue;
    for (const member of members) {
      result.add(`${member.module}:${member.name}`);
    }
  }
  return result;
}

function collectCrossModuleClassForwardDecls(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  streamAliases: Map<string, StreamAliasInfo>,
  streamTypesForModule: Extract<ResolvedType, { kind: "stream" }>[],
): string[] {
  const symbols = new Map<string, ClassSymbol>();

  const addSymbol = (symbol: ClassSymbol | null): void => {
    if (!symbol || symbol.module === table.path || symbol.extern_) return;
    symbols.set(`${symbol.module}:${emitClassForwardDeclName(symbol)}`, symbol);
  };

  for (const imp of table.imports) {
    if (imp.symbol?.symbolKind === "class") {
      addSymbol(imp.symbol);
    }
  }

  for (const nsImp of table.namespaceImports) {
    const sourceTable = analysisResult.modules.get(nsImp.sourceModule);
    if (!sourceTable) continue;
    for (const sym of sourceTable.exports.values()) {
      if (sym.symbolKind === "class") {
        addSymbol(sym);
      }
    }
  }

  // Interface aliases may reference implementors from modules that were not
  // directly imported by this module, so include the concrete implementors of
  // interfaces declared by this module as incomplete types.
  for (const sym of table.symbols.values()) {
    if (sym.symbolKind !== "interface" || sym.module !== table.path) continue;
    for (const impl of interfaceImpls.get(`${sym.module}:${sym.name}`) ?? []) {
      addSymbol(impl);
    }
  }

  for (const streamType of streamTypesForModule) {
    const aliasName = emitType(streamType);
    const aliasInfo = streamAliases.get(aliasName);
    for (const impl of aliasInfo?.impls ?? []) {
      if (impl.isExtern || impl.modulePath === table.path) continue;
      const sourceTable = analysisResult.modules.get(impl.modulePath);
      const symbol = sourceTable?.symbols.get(impl.baseName);
      if (symbol?.symbolKind === "class") {
        addSymbol(symbol);
      }
    }
  }

  const lines: string[] = [];
  const ordered = [...symbols.values()].sort((left, right) =>
    `${left.module}:${emitClassForwardDeclName(left)}`.localeCompare(`${right.module}:${emitClassForwardDeclName(right)}`),
  );
  const symbolsByNamespace = new Map<string, ClassSymbol[]>();
  for (const symbol of ordered) {
    const namespace = emitModuleNamespace(symbol.module, analysisResult.modules);
    const namespaceSymbols = symbolsByNamespace.get(namespace) ?? [];
    namespaceSymbols.push(symbol);
    symbolsByNamespace.set(namespace, namespaceSymbols);
  }
  for (const [namespace, namespaceSymbols] of symbolsByNamespace) {
    lines.push(`namespace ${namespace} {`);
    for (const symbol of namespaceSymbols) {
      const typeParams = symbol.declaration.typeParams;
      if (typeParams.length > 0) {
        lines.push(`template<${typeParams.map((param) => `typename ${param}`).join(", ")}>`);
      }
      lines.push(`struct ${emitClassForwardDeclName(symbol)};`);
    }
    lines.push("}");
  }
  return lines;
}

function emitHpp(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
  monomorphizedMethods: Map<string, GenericMethodInstantiation>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
): string {
  const plan = buildHeaderPlan(
    table,
    analysisResult,
    interfaceImpls,
    monomorphizedFunctions,
    monomorphizedClasses,
    monomorphizedMethods,
    baseDir,
    packageOutputPaths,
  );
  const lines: string[] = [];

  // Pragma once
  lines.push("#pragma once");
  lines.push("");

  for (const inc of plan.standardIncludes) {
    lines.push(inc);
  }

  lines.push("");

  // Runtime header (needed for inline methods that use doof:: utilities)
  lines.push(`#include "doof_runtime.hpp"`);
  lines.push("");

  if (plan.crossModuleForwardDecls.length > 0) {
    lines.push(...plan.crossModuleForwardDecls);
    lines.push("");
  }

  if (plan.moduleIncludes.length > 0) {
    for (const inc of plan.moduleIncludes) {
      lines.push(`#include "${inc}"`);
    }
    lines.push("");
  }

  if (plan.externInteropPredecls.length > 0) {
    lines.push(...plan.externInteropPredecls);
    lines.push("");
  }

  if (plan.externInteropPreAliases.length > 0) {
    lines.push(...plan.externInteropPreAliases);
    lines.push("");
  }

  if (plan.externIncludes.length > 0) {
    for (const inc of plan.externIncludes) {
      lines.push(inc);
    }
    lines.push("");
  }

  const moduleNamespace = emitModuleNamespace(table.path, analysisResult.modules);
  const moduleNamespaceStart = lines.length;
  lines.push(`namespace ${moduleNamespace} {`);
  lines.push("");

  // Forward declarations for classes (needed before interface aliases)
  // Skip extern classes — their struct is defined in the external header.
  for (const cls of plan.nativeClasses) {
    const sym = getClassSymbolForDecl(table, cls.decl);
    const tpLen = cls.decl.typeParams.length;
    if (tpLen > 0) {
      const tpl = cls.decl.typeParams.map((p: string) => `typename ${p}`).join(", ");
      lines.push(`template<${tpl}>`);
    }
    lines.push(`struct ${emitClassForwardDeclName(sym)};`);
  }
  if (plan.nativeClasses.length > 0) {
    lines.push("");
  }

  for (const captureType of plan.mockCaptureTypes) {
    emitMockCaptureStruct(lines, captureType);
    lines.push("");
  }

  for (const streamType of plan.streamTypesForModule) {
    const aliasName = emitType(streamType);
    const info = plan.streamAliases.get(aliasName);
    if (!info) continue;
    emitStreamAliasHpp(aliasName, info, table, lines);
    lines.push("");
  }

  // Interface aliases (use forward-declared class names via shared_ptr)
  for (const iface of plan.classified.interfaces) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitInterfaceAliasHpp(iface.decl, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Type aliases
  for (const alias of plan.classified.typeAliases) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement({ ...alias.decl, needsJson: false } as TypeAliasDeclaration as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Enum declarations
  for (const en of plan.classified.enums) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(en.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Full struct definitions (with inline methods)
  // Skip extern classes — their struct is defined in the external header.
  for (const cls of plan.nativeClasses.filter((candidate) => !classDeclIsStreamSensitive(candidate.decl))) {
    const sym = getClassSymbolForDecl(table, cls.decl);
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      classNameOverride: emitLocalClassCppName(sym),
      emitMethodBodiesInline: cls.decl.typeParams.length > 0 ? true : false,
    };
    emitStatement(cls.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const inst of plan.monomorphizedClassesForModule) {
    const sym = getClassSymbolForDecl(table, inst.decl);
    const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const typeArgs = inst.typeArgs.map((typeArg) => emitType(typeArg, table.path)).join(", ");
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      typeSubstitution,
      classNameOverride: `${emitLocalClassCppName(sym)}<${typeArgs}>`,
      emitExplicitClassSpecialization: true,
      emitMethodBodiesInline: false,
    };
    emitStatement(inst.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const inst of plan.monomorphizedClassesForModule) {
    const sym = getClassSymbolForDecl(table, inst.decl);
    const typeSubstitution = buildClassTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const typeArgs = inst.typeArgs.map((typeArg) => emitType(typeArg, table.path)).join(", ");
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      typeSubstitution,
      classNameOverride: `${emitLocalClassCppName(sym)}<${typeArgs}>`,
      emitExplicitClassSpecialization: true,
      forceInline: true,
    };
    emitClassMethodDefinitions(inst.decl, ctx);
    lines.push(...ctx.sourceLines);
  }
  for (const inst of plan.monomorphizedMethodsForModule) {
    const ownerSym = getClassSymbolForDecl(table, inst.ownerDecl);
    const ownerTypeSubstitution = buildClassTypeSubstitutionMap(inst.ownerDecl, inst.ownerTypeArgs);
    const methodTypeSubstitution = buildFunctionTypeSubstitutionMap(inst.methodDecl, inst.methodTypeArgs);
    const typeSubstitution = combineTypeSubstitutions(ownerTypeSubstitution, methodTypeSubstitution);
    const ownerTypeArgs = inst.ownerTypeArgs.map((typeArg) => emitType(typeArg, table.path)).join(", ");
    const methodTypeArgs = inst.methodTypeArgs.map((typeArg) => emitType(typeArg, table.path)).join(", ");
    const ctx = {
      ...makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      typeSubstitution,
      forceInline: true,
      suppressTemplatePrefix: true,
      qualifiedFunctionName: `${emitLocalClassCppName(ownerSym)}<${ownerTypeArgs}>::${emitIdentifierSafe(inst.methodDecl.name)}<${methodTypeArgs}>`,
    };
    lines.push("template<>");
    emitStatement(inst.methodDecl as Statement, ctx);
    lines.push(...ctx.sourceLines);
  }
  if (plan.monomorphizedClassesForModule.length > 0) {
    lines.push("");
  }

  for (const iface of plan.classified.interfaces) {
    const impls = interfaceImpls.get(`${table.path}:${iface.decl.name}`);
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

  for (const alias of plan.classified.typeAliases) {
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
  for (const fn of plan.nonGenericExportedFunctions) {
    lines.push(emitFunctionSignature(fn.decl, interfaceImpls) + ";");
  }
  for (const inst of plan.monomorphizedFunctionsForModule) {
    lines.push(emitFunctionSignature(inst.decl, interfaceImpls, inst.emittedName, buildFunctionTypeSubstitutionMap(inst.decl, inst.typeArgs)) + ";");
  }
  if (plan.nonGenericExportedFunctions.length > 0 || plan.monomorphizedFunctionsForModule.length > 0) {
    lines.push("");
  }

  for (const fn of plan.exportedMockFunctions) {
    const resolvedType = fn.decl.resolvedType;
    if (!resolvedType || resolvedType.kind !== "function" || !resolvedType.mockCall) continue;
    const mockCall = resolvedType.mockCall;
    lines.push(`extern std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName};`);
  }
  if (plan.exportedMockFunctions.length > 0) {
    lines.push("");
  }

  // Generic function full definitions in .hpp (templates must be header-only)
  for (const fn of plan.genericExportedFunctions) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Non-exported generic functions also go in .hpp (templates must be header-only)
  for (const fn of plan.nonExportedGenericFunctions) {
    const ctx = makeHeaderCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions);
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Exported variable declarations (extern)
  for (const v of plan.exportedVariables) {
    const externDecl = emitExternVariableDecl(v.stmt);
    if (externDecl) {
      lines.push(externDecl);
    }
  }
  if (plan.exportedVariables.length > 0) {
    lines.push("");
  }

  // Module init function declaration (for modules with readonly globals)
  if (plan.hasInitDeclaration) {
    const initName = modulePathToInitName(table.path, baseDir);
    lines.push(`void ${initName}();`);
    lines.push("");
  }

  lines.push(`} // namespace ${moduleNamespace}`);
  if (lines.slice(moduleNamespaceStart + 1, lines.length - 1).every((line) => line.trim() === "")) {
    lines.splice(moduleNamespaceStart, lines.length - moduleNamespaceStart);
  }
  lines.push("");

  if (plan.externInteropPostAliases.length > 0) {
    lines.push(...plan.externInteropPostAliases);
    lines.push("");
  }

  for (const en of plan.classified.enums) {
    const name = emitIdentifierSafe(en.decl.name);
    const qualifiedName = `::${moduleNamespace}::${name}`;
    lines.push(`template<> struct std::hash<${qualifiedName}> { size_t operator()(${qualifiedName} v) const noexcept { return hash<int>{}(static_cast<int>(v)); } };`);
  }
  if (plan.classified.enums.length > 0) {
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
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
  baseDir: string,
  packageOutputPaths?: PackageOutputPaths,
  buildTarget?: ResolvedDoofBuildTarget | null,
  coverageModuleId?: number,
): { code: string; instrumentedLines: Set<number> } {
  const lines: string[] = [];
  const coverageInstrumentedLines = coverageModuleId !== undefined ? new Set<number>() : undefined;
  // Partial context fields to spread on every EmitContext created within this function.
  const covCtx = coverageModuleId !== undefined
    ? { coverageEnabled: true as const, coverageModuleId, coverageInstrumentedLines }
    : {};
  const { hppName } = modulePathToCppNames(table.path, baseDir, packageOutputPaths);
    const streamAliases = buildStreamImplMap(analysisResult, monomorphizedClasses);

  // Include own header and runtime
  lines.push(`#include "${hppName}"`);
  lines.push(`#include "doof_runtime.hpp"`);
  for (const dependencyModule of collectCppReferencedModulePaths(table, analysisResult, monomorphizedClasses)) {
    lines.push(`#include "${modulePathToInclude(dependencyModule, baseDir, packageOutputPaths)}"`);
  }
  lines.push("");

  const moduleNamespace = emitModuleNamespace(table.path, analysisResult.modules);
  const moduleNamespaceStart = lines.length;
  lines.push(`namespace ${moduleNamespace} {`);
  lines.push("");

  const streamTypesForModule = collectUsedStreamTypesForModule(table, monomorphizedClasses);
  for (const streamType of streamTypesForModule) {
    const aliasName = emitType(streamType);
    const info = streamAliases.get(aliasName);
    if (!info) continue;
    emitStreamNextHelperDefinition(aliasName, info, lines);
    emitStreamValueHelperDefinition(aliasName, info, lines);
  }
  if (streamTypesForModule.length > 0) {
    lines.push("");
  }

  const classified = classifyStatements(table);
  const monomorphizedForModule = [...monomorphizedFunctions.values()].filter((inst) => inst.modulePath === table.path);
  const nonExportedMockFunctions = classified.functions.filter((fn) => !fn.exported && hasMockCall(fn.decl));
  const exportedMockFunctions = classified.functions.filter((fn) => fn.exported && hasMockCall(fn.decl));
  const nativeClasses = classified.classes.filter((cls) => {
    const sym = table.symbols.get(cls.decl.name);
    return !(sym?.symbolKind === "class" && sym.extern_);
  });
  const headerSurfaceClassKeys = buildHeaderSurfaceClassKeySet(interfaceImpls, classified);
  const headerNativeClasses = nativeClasses.filter((cls) => isHeaderVisibleClass(cls, table.path, headerSurfaceClassKeys));
  markHeaderVisiblePrivateClassNames(table, headerNativeClasses);
  const cppOnlyNativeClasses = nativeClasses.filter((cls) => !headerNativeClasses.includes(cls));

  // Non-exported functions use static internal linkage in the cpp.
  const nonExportedFns = classified.functions.filter(
    (fn) => !fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length === 0,
  );
  const mainDecl = classified.functions.find((fn) => fn.decl.name === "main");
  for (const fn of nonExportedMockFunctions) {
    const resolvedType = fn.decl.resolvedType;
    if (!resolvedType || resolvedType.kind !== "function" || !resolvedType.mockCall) continue;
    const mockCall = resolvedType.mockCall;
    lines.push(`static std::shared_ptr<std::vector<${emitType(mockCall.captureType)}>> ${mockCall.storageName} = std::make_shared<std::vector<${emitType(mockCall.captureType)}>>();`);
  }
  if (nonExportedMockFunctions.length > 0) {
    lines.push("");
  }

  emitCppOnlyClassDeclarations(
    cppOnlyNativeClasses.filter((candidate) => !classDeclIsStreamSensitive(candidate.decl)),
    table,
    analysisResult,
    interfaceImpls,
    monomorphizedFunctions,
    lines,
    covCtx,
  );

  for (const fn of nonExportedFns) {
    lines.push(`static ${emitFunctionSignature(fn.decl, interfaceImpls, undefined, undefined, true, table.path)};`);
  }
  if (nonExportedFns.length > 0) {
    lines.push("");
  }

  // Emit private top-level variables before private method/function bodies so
  // helpers can reference them without requiring a separate declaration form.
  const nonExportedVars = classified.variables.filter((v) => !v.exported);
  if (nonExportedVars.length > 0) {
    for (const v of nonExportedVars) {
      const ctx = {
        ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
        ...covCtx,
        internalLinkage: true,
      };
      emitStatement(v.stmt, ctx);
      lines.push(...ctx.sourceLines);
      lines.push("");
    }
    lines.push("");
  }

  emitCppOnlyClassMethodDefinitions(
    cppOnlyNativeClasses.filter((candidate) => !classDeclIsStreamSensitive(candidate.decl)),
    table,
    analysisResult,
    interfaceImpls,
    monomorphizedFunctions,
    lines,
    covCtx,
  );

  for (const fn of nonExportedFns) {
    const ctx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      ...covCtx,
      emitParameterDefaults: false,
      internalLinkage: true,
    };
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  for (const inst of monomorphizedForModule) {
    const typeSubstitution = buildFunctionTypeSubstitutionMap(inst.decl, inst.typeArgs);
    const resolvedType = inst.decl.resolvedType && inst.decl.resolvedType.kind === "function"
      ? substituteTypeParams(inst.decl.resolvedType, typeSubstitution)
      : inst.decl.resolvedType;
    const ctx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      ...covCtx,
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

  for (const cls of headerNativeClasses.filter((candidate) => !classDeclIsStreamSensitive(candidate.decl) && candidate.decl.typeParams.length === 0)) {
    const sym = getClassSymbolForDecl(table, cls.decl);
    const ctx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      ...covCtx,
      classNameOverride: emitLocalClassCppName(sym),
    };
    emitClassMethodDefinitions(cls.decl, ctx);
    lines.push(...ctx.sourceLines);
  }
  if (headerNativeClasses.some((candidate) => !classDeclIsStreamSensitive(candidate.decl) && candidate.decl.typeParams.length === 0 && candidate.decl.methods.length > 0)) {
    lines.push("");
  }

  // Exported function implementations (skip generics — they're in .hpp)
  const exportedFns = classified.functions.filter(
    (fn) => fn.exported && fn.decl.name !== "main" && fn.decl.typeParams.length === 0,
  );
  for (const fn of exportedFns) {
    const ctx = { ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions), ...covCtx, emitParameterDefaults: false };
    emitStatement(fn.decl as Statement, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Exported variable definitions
  const exportedVars = classified.variables.filter((v) => v.exported);
  for (const v of exportedVars) {
    const ctx = { ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions), ...covCtx };
    emitStatement(v.stmt, ctx);
    lines.push(...ctx.sourceLines);
    lines.push("");
  }

  // Module init function (for readonly globals)
  if (hasReadonlyGlobals(classified)) {
    emitInitFunction(table, analysisResult, classified, interfaceImpls, monomorphizedFunctions, lines, baseDir);
  }

  // main() wrapper
  const mainFn = classified.functions.find((fn) => fn.decl.name === "main");
  if (mainFn) {
    emitDoofMainFunction(mainFn.decl, table, analysisResult, interfaceImpls, monomorphizedFunctions, lines, covCtx);
  }

  lines.push(`} // namespace ${moduleNamespace}`);
  if (lines.slice(moduleNamespaceStart + 1, lines.length - 1).every((line) => line.trim() === "")) {
    lines.splice(moduleNamespaceStart, lines.length - moduleNamespaceStart);
  }
  lines.push("");

  if (mainFn) {
    emitExternCMainEntryWrapper(mainFn.decl, table, analysisResult, baseDir, lines);
    if (buildTarget?.kind !== "ios-app") {
      emitNativeMainWrapper(lines);
    }
  }

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return { code: lines.join("\n") + "\n", instrumentedLines: coverageInstrumentedLines ?? new Set<number>() };
}

function emitCppOnlyClassDeclarations(
  classes: ClassifiedDecl<ClassDeclaration>[],
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  lines: string[],
  covCtx: object,
): void {
  if (classes.length === 0) return;

  lines.push("namespace {");
  lines.push("");
  for (const cls of classes) {
    const sym = getClassSymbolForDecl(table, cls.decl);
    const declCtx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      ...covCtx,
      classNameOverride: emitLocalClassCppName(sym),
      emitMethodBodiesInline: false,
    };
    emitStatement(cls.decl as Statement, declCtx);
    lines.push(...declCtx.sourceLines);
    lines.push("");
  }
  lines.push("}");
  lines.push("");
}

function emitCppOnlyClassMethodDefinitions(
  classes: ClassifiedDecl<ClassDeclaration>[],
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  interfaceImpls: Map<string, ClassSymbol[]>,
  monomorphizedFunctions: Map<string, GenericFunctionInstantiation>,
  lines: string[],
  covCtx: object,
): void {
  if (!classes.some((cls) => cls.decl.methods.length > 0)) return;

  lines.push("namespace {");
  lines.push("");
  for (const cls of classes) {
    if (cls.decl.methods.length === 0) continue;
    const sym = getClassSymbolForDecl(table, cls.decl);
    const methodCtx = {
      ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions),
      ...covCtx,
      classNameOverride: emitLocalClassCppName(sym),
    };
    emitClassMethodDefinitions(cls.decl, methodCtx);
    lines.push(...methodCtx.sourceLines);
  }
  lines.push("}");
  lines.push("");
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
  covCtx: object = {},
): void {
  // Emit the Doof main as doof_main (without extern C wrapper)
  const ctx = { ...makeCppCtx(table, analysisResult, interfaceImpls, monomorphizedFunctions), ...covCtx };
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
      currentCallableName: mainDecl.name,
      currentFunctionReturnType: mainDecl.resolvedType && mainDecl.resolvedType.kind === "function"
        ? mainDecl.resolvedType.returnType
        : undefined,
      capturedMutables: capturedMutables.size > 0 ? capturedMutables : undefined,
    });
    lines.push(...ctx.sourceLines);
    lines.push("}");
  } else {
    const body = emitExpression(mainDecl.body as Expression, {
      ...ctx,
      currentCallableName: mainDecl.name,
    });
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
    lines.push(`    ${emitQualifiedHelperName(modPath, initName, analysisResult.modules)}();`);
  }

  if (hasArgs) {
    lines.push("    auto args = std::make_shared<std::vector<std::string>>(argv, argv + argc);");
    if (returnsInt) {
      lines.push(`    return static_cast<int>(${emitQualifiedHelperName(table.path, "doof_main", analysisResult.modules)}(args));`);
    } else {
      lines.push(`    ${emitQualifiedHelperName(table.path, "doof_main", analysisResult.modules)}(args);`);
      lines.push("    return 0;");
    }
  } else {
    if (returnsInt) {
      lines.push(`    return static_cast<int>(${emitQualifiedHelperName(table.path, "doof_main", analysisResult.modules)}());`);
    } else {
      lines.push(`    ${emitQualifiedHelperName(table.path, "doof_main", analysisResult.modules)}();`);
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
  includeDefaults = true,
  currentModulePath?: string,
): string {
  const name = emitIdentifierSafe(nameOverride ?? decl.name);
  const resolvedType = decl.resolvedType && typeSubstitution
    ? substituteTypeParams(decl.resolvedType, typeSubstitution)
    : decl.resolvedType;
  const retType = resolvedType && resolvedType.kind === "function"
    ? emitType(resolvedType.returnType, currentModulePath)
    : "auto";
  const params = decl.params.map((p) => emitParamSignature(p, typeSubstitution, includeDefaults, currentModulePath)).join(", ");
  return `${retType} ${name}(${params})`;
}

function emitParamSignature(
  param: Parameter,
  typeSubstitution?: Map<string, ResolvedType>,
  includeDefault = true,
  currentModulePath?: string,
): string {
  const resolvedType = param.resolvedType && typeSubstitution
    ? substituteTypeParams(param.resolvedType, typeSubstitution)
    : param.resolvedType;
  const pType = resolvedType ? emitType(resolvedType, currentModulePath) : "auto";
  const name = emitIdentifierSafe(param.name);
  if (includeDefault && param.defaultValue) {
    const defaultVal = emitDefaultExpression(param.defaultValue, resolvedType ?? undefined, currentModulePath);
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
        return `extern const std::shared_ptr<const ${emitClassCppName(s.resolvedType.symbol)}> ${name};`;
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
  const impls = ctx.interfaceImpls.get(`${ctx.module.path}:${decl.name}`);
  if (impls && impls.length > 0) {
    // Deduplicate implementors by C++ identity (same class may be collected from multiple modules).
    const seen = new Set<string>();
    const uniqueImpls = impls.filter((cls) => {
      const cppName = emitClassCppName(cls, ctx.module.path);
      if (seen.has(cppName)) return false;
      seen.add(cppName);
      return true;
    });

    const variants = uniqueImpls
      .map((cls) => emitClassSharedPtrType({ kind: "class", symbol: cls }, ctx.module.path))
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

  const moduleNamespace = table.emittedCppNamespace ?? emitModuleNamespace(table.path);
  const guardName = `DOOF_STREAM_ALIAS_${moduleNamespace.toUpperCase().replace(/::/g, "_")}_${aliasName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const localPrefix = `::${moduleNamespace}::`;
  const variants = impls
    .map((cls) => cls.modulePath === table.path ? cls.cppTypeName.replace(localPrefix, "") : cls.cppTypeName)
    .map((cppTypeName) => `std::shared_ptr<${cppTypeName}>`)
    .join(", ");
  const nextHelperName = emitStreamNextHelperName(aliasName);
  const valueHelperName = emitStreamValueHelperName(aliasName);
  const valueType = emitType(streamType.elementType);
  lines.push(`#ifndef ${guardName}`);
  lines.push(`#define ${guardName}`);

  if (impls.length === 0) {
    lines.push(`using ${aliasName} = std::variant<std::monostate>;`);
    lines.push(`inline bool ${nextHelperName}(const ${aliasName}&) { return false; }`);
    lines.push(`inline ${valueType} ${valueHelperName}(const ${aliasName}&) { doof::panic("Stream alias ${aliasName} has no implementing classes in this build"); }`);
    lines.push(`#endif`);
    return;
  }

  lines.push(`using ${aliasName} = std::variant<${variants}>;`);
  lines.push(`bool ${nextHelperName}(const ${aliasName}& stream);`);
  lines.push(`${valueType} ${valueHelperName}(const ${aliasName}& stream);`);
  lines.push(`#endif`);
}

function emitStreamNextHelperDefinition(
  aliasName: string,
  aliasInfo: StreamAliasInfo,
  lines: string[],
): void {
  const helperName = emitStreamNextHelperName(aliasName);
  lines.push(`bool ${helperName}(const ${aliasName}& stream) {`);
  lines.push(`    return std::visit([](auto&& _obj) { return _obj->next(); }, stream);`);
  lines.push("}");
  lines.push("");
}

function emitStreamValueHelperDefinition(
  aliasName: string,
  aliasInfo: StreamAliasInfo,
  lines: string[],
): void {
  const helperName = emitStreamValueHelperName(aliasName);
  const valueType = emitType(aliasInfo.streamType.elementType);
  lines.push(`${valueType} ${helperName}(const ${aliasName}& stream) {`);
  lines.push(`    return std::visit([](auto&& _obj) { return _obj->value(); }, stream);`);
  lines.push("}");
  lines.push("");
}

function canModuleDefineStreamHelper(
  aliasInfo: StreamAliasInfo,
  table: ModuleSymbolTable,
): boolean {
  const dependencyModules = new Set(collectReferencedModulePaths(table));
  return aliasInfo.impls.every((impl) => impl.modulePath === table.path || dependencyModules.has(impl.modulePath));
}

function findStreamHelperOwnerModule(
  aliasInfo: StreamAliasInfo,
  analysisResult: AnalysisResult,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
): string | null {
  if (aliasInfo.impls.length === 0) return null;

  const aliasName = emitType(aliasInfo.streamType);
  const candidates: string[] = [];
  for (const [modulePath, table] of analysisResult.modules) {
    const streamTypesForModule = collectUsedStreamTypesForModule(table, monomorphizedClasses);
    const moduleUsesAlias = streamTypesForModule.some((streamType) => emitType(streamType) === aliasName);
    const moduleOwnsImpl = aliasInfo.impls.some((impl) => impl.modulePath === modulePath);
    if (!moduleUsesAlias && !moduleOwnsImpl) {
      continue;
    }
    if (canModuleDefineStreamHelper(aliasInfo, table)) {
      candidates.push(modulePath);
    }
  }

  candidates.sort();
  return candidates[0] ?? null;
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
    lines.push(`    ${emitQualifiedHelperName(depPath, depInitName, analysisResult.modules)}();`);
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

function collectCppReferencedModulePaths(
  table: ModuleSymbolTable,
  analysisResult: AnalysisResult,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
): string[] {
  const dependencies = new Set(collectReferencedModulePaths(table));
  for (const dependencyModule of collectMemberAccessModulePaths(table)) {
    dependencies.add(dependencyModule);
  }

  const streamAliases = buildStreamImplMap(analysisResult, monomorphizedClasses);
  for (const streamType of collectUsedStreamTypesForModule(table, monomorphizedClasses)) {
    const aliasName = emitType(streamType);
    for (const impl of streamAliases.get(aliasName)?.impls ?? []) {
      if (!impl.isExtern && impl.modulePath !== table.path) {
        dependencies.add(impl.modulePath);
      }
    }
  }
  return [...dependencies];
}

function collectMemberAccessModulePaths(table: ModuleSymbolTable): string[] {
  const dependencies = new Set<string>();
  for (const stmt of table.program.statements) {
    collectMemberAccessModulePathsFromStatement(stmt, table.path, dependencies);
  }
  return [...dependencies];
}

function collectMemberAccessModulePathsFromStatement(
  stmt: Statement,
  currentModulePath: string,
  dependencies: Set<string>,
): void {
  switch (stmt.kind) {
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      collectMemberAccessModulePathsFromExpression(stmt.value, currentModulePath, dependencies);
      break;
    case "function-declaration":
      for (const param of stmt.params) {
        if (param.defaultValue) {
          collectMemberAccessModulePathsFromExpression(param.defaultValue, currentModulePath, dependencies);
        }
      }
      if (stmt.body.kind === "block") {
        for (const inner of stmt.body.statements) {
          collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
        }
      } else {
        collectMemberAccessModulePathsFromExpression(stmt.body, currentModulePath, dependencies);
      }
      break;
    case "class-declaration":
      for (const field of stmt.fields) {
        if (field.defaultValue) {
          collectMemberAccessModulePathsFromExpression(field.defaultValue, currentModulePath, dependencies);
        }
      }
      for (const method of stmt.methods) {
        collectMemberAccessModulePathsFromStatement(method, currentModulePath, dependencies);
      }
      break;
    case "if-statement":
      collectMemberAccessModulePathsFromExpression(stmt.condition, currentModulePath, dependencies);
      for (const inner of stmt.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      for (const elseIf of stmt.elseIfs) {
        collectMemberAccessModulePathsFromExpression(elseIf.condition, currentModulePath, dependencies);
        for (const inner of elseIf.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      }
      if (stmt.else_) {
        for (const inner of stmt.else_.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      }
      break;
    case "while-statement":
      collectMemberAccessModulePathsFromExpression(stmt.condition, currentModulePath, dependencies);
      for (const inner of stmt.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      }
      break;
    case "for-statement":
      if (stmt.init) collectMemberAccessModulePathsFromStatement(stmt.init, currentModulePath, dependencies);
      if (stmt.condition) collectMemberAccessModulePathsFromExpression(stmt.condition, currentModulePath, dependencies);
      for (const update of stmt.update) collectMemberAccessModulePathsFromExpression(update, currentModulePath, dependencies);
      for (const inner of stmt.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      }
      break;
    case "for-of-statement":
      collectMemberAccessModulePathsFromExpression(stmt.iterable, currentModulePath, dependencies);
      for (const inner of stmt.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      if (stmt.then_) {
        for (const inner of stmt.then_.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      }
      break;
    case "with-statement":
      for (const binding of stmt.bindings) {
        collectMemberAccessModulePathsFromExpression(binding.value, currentModulePath, dependencies);
      }
      for (const inner of stmt.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      break;
    case "return-statement":
      if (stmt.value) collectMemberAccessModulePathsFromExpression(stmt.value, currentModulePath, dependencies);
      break;
    case "yield-statement":
      collectMemberAccessModulePathsFromExpression(stmt.value, currentModulePath, dependencies);
      break;
    case "expression-statement":
      collectMemberAccessModulePathsFromExpression(stmt.expression, currentModulePath, dependencies);
      break;
    case "export-declaration":
      collectMemberAccessModulePathsFromStatement(stmt.declaration, currentModulePath, dependencies);
      break;
    case "block":
      for (const inner of stmt.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      break;
    case "case-statement":
      collectMemberAccessModulePathsFromExpression(stmt.subject, currentModulePath, dependencies);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
        } else {
          collectMemberAccessModulePathsFromExpression(arm.body, currentModulePath, dependencies);
        }
      }
      break;
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      collectMemberAccessModulePathsFromExpression(stmt.value, currentModulePath, dependencies);
      break;
    case "try-statement":
      collectMemberAccessModulePathsFromStatement(stmt.binding, currentModulePath, dependencies);
      break;
    default:
      break;
  }
}

function collectMemberAccessModulePathsFromExpression(
  expr: Expression,
  currentModulePath: string,
  dependencies: Set<string>,
): void {
  switch (expr.kind) {
    case "binary-expression":
      collectMemberAccessModulePathsFromExpression(expr.left, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.right, currentModulePath, dependencies);
      break;
    case "unary-expression":
      collectMemberAccessModulePathsFromExpression(expr.operand, currentModulePath, dependencies);
      break;
    case "assignment-expression":
      collectMemberAccessModulePathsFromExpression(expr.target, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.value, currentModulePath, dependencies);
      break;
    case "member-expression":
    case "qualified-member-expression":
      collectConcreteMemberObjectModulePaths(expr.object.resolvedType, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.object, currentModulePath, dependencies);
      break;
    case "index-expression":
      collectMemberAccessModulePathsFromExpression(expr.object, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.index, currentModulePath, dependencies);
      break;
    case "call-expression":
      collectMemberAccessModulePathsFromExpression(expr.callee, currentModulePath, dependencies);
      for (const arg of expr.args) collectMemberAccessModulePathsFromExpression(arg.value, currentModulePath, dependencies);
      break;
    case "array-literal":
    case "tuple-literal":
      for (const element of expr.elements) collectMemberAccessModulePathsFromExpression(element, currentModulePath, dependencies);
      break;
    case "object-literal":
      for (const property of expr.properties) {
        if (property.value) collectMemberAccessModulePathsFromExpression(property.value, currentModulePath, dependencies);
      }
      if (expr.spread) collectMemberAccessModulePathsFromExpression(expr.spread, currentModulePath, dependencies);
      break;
    case "map-literal":
      for (const entry of expr.entries) {
        collectMemberAccessModulePathsFromExpression(entry.key, currentModulePath, dependencies);
        collectMemberAccessModulePathsFromExpression(entry.value, currentModulePath, dependencies);
      }
      break;
    case "lambda-expression":
      for (const param of expr.params) {
        if (param.defaultValue) collectMemberAccessModulePathsFromExpression(param.defaultValue, currentModulePath, dependencies);
      }
      if (expr.body.kind === "block") {
        for (const inner of expr.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      } else {
        collectMemberAccessModulePathsFromExpression(expr.body, currentModulePath, dependencies);
      }
      break;
    case "if-expression":
      collectMemberAccessModulePathsFromExpression(expr.condition, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.then, currentModulePath, dependencies);
      collectMemberAccessModulePathsFromExpression(expr.else_, currentModulePath, dependencies);
      break;
    case "case-expression":
      collectMemberAccessModulePathsFromExpression(expr.subject, currentModulePath, dependencies);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          for (const inner of arm.body.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
        } else {
          collectMemberAccessModulePathsFromExpression(arm.body, currentModulePath, dependencies);
        }
      }
      break;
    case "construct-expression":
      if (expr.named) {
        for (const property of expr.args as import("./ast.js").ObjectProperty[]) {
          if (property.value) collectMemberAccessModulePathsFromExpression(property.value, currentModulePath, dependencies);
        }
      } else {
        for (const arg of expr.args as Expression[]) collectMemberAccessModulePathsFromExpression(arg, currentModulePath, dependencies);
      }
      break;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") collectMemberAccessModulePathsFromExpression(part, currentModulePath, dependencies);
      }
      break;
    case "async-expression":
      if (expr.expression.kind === "block") {
        for (const inner of expr.expression.statements) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      } else {
        collectMemberAccessModulePathsFromExpression(expr.expression, currentModulePath, dependencies);
      }
      break;
    case "actor-creation-expression":
      for (const arg of expr.args) collectMemberAccessModulePathsFromExpression(arg, currentModulePath, dependencies);
      break;
    case "catch-expression":
      for (const inner of expr.body) collectMemberAccessModulePathsFromStatement(inner, currentModulePath, dependencies);
      break;
    case "non-null-assertion":
    case "as-expression":
      collectMemberAccessModulePathsFromExpression(expr.expression, currentModulePath, dependencies);
      break;
    default:
      break;
  }
}

function collectConcreteMemberObjectModulePaths(
  type: ResolvedType | undefined,
  currentModulePath: string,
  dependencies: Set<string>,
): void {
  if (!type || isJsonValueType(type)) return;
  switch (type.kind) {
    case "class":
    case "interface":
      if (type.symbol.module !== "<builtin>" && type.symbol.module !== currentModulePath) {
        dependencies.add(type.symbol.module);
      }
      break;
    case "union":
      for (const inner of type.types) {
        collectConcreteMemberObjectModulePaths(inner, currentModulePath, dependencies);
      }
      break;
    case "weak":
      collectConcreteMemberObjectModulePaths(type.inner, currentModulePath, dependencies);
      break;
    case "actor":
      collectConcreteMemberObjectModulePaths(type.innerClass, currentModulePath, dependencies);
      break;
    default:
      break;
  }
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

    impls.set(`${iface.module}:${iface.name}`, implementing);
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
  const classSymbolsByKey = new Map(classes.map((cls) => [`${cls.module}:${cls.name}`, cls]));

  const result = new Map<string, StreamAliasInfo>();
  for (const streamType of streamTypes) {
    const aliasName = emitType(streamType);
    const impls: StreamImplRef[] = classes
      .filter((cls) => cls.declaration.typeParams.length === 0)
      .filter((cls) => isAssignableTo({ kind: "class", symbol: cls }, streamType))
      .map((cls) => ({
        baseName: cls.name,
        cppTypeName: emitClassCppName(cls),
        modulePath: cls.module,
        isExtern: !!cls.extern_,
      }));

    for (const inst of monomorphizedClasses.values()) {
      const instSymbol = classSymbolsByKey.get(`${inst.modulePath}:${inst.decl.name}`) ?? {
        name: inst.decl.name,
        symbolKind: "class" as const,
        module: inst.modulePath,
        exported: false,
        declaration: inst.decl,
      };
      const classType: ResolvedType = {
        kind: "class",
        symbol: instSymbol,
        typeArgs: inst.typeArgs,
      };
      if (!isAssignableTo(classType, streamType)) continue;
      impls.push({
        baseName: inst.decl.name,
        cppTypeName: `${emitClassCppName(instSymbol)}<${inst.typeArgs.map((typeArg) => emitType(typeArg, inst.modulePath)).join(", ")}>`,
        modulePath: inst.modulePath,
        isExtern: false,
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

function collectUsedStreamTypesForModule(
  table: ModuleSymbolTable,
  monomorphizedClasses: Map<string, GenericClassInstantiation>,
): Extract<ResolvedType, { kind: "stream" }>[] {
  const result = new Map<string, Extract<ResolvedType, { kind: "stream" }>>();

  for (const stmt of table.program.statements) {
    collectStreamTypesFromStatement(stmt, result);
  }

  for (const inst of monomorphizedClasses.values()) {
    if (inst.modulePath !== table.path) continue;
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
  if (isJsonValueType(type)) {
    return;
  }

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
  methodResult = new Map<string, GenericMethodInstantiation>(),
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
      if (methodResult.has(methodInstantiation.key)) {
        continue;
      }
      methodResult.set(methodInstantiation.key, methodInstantiation);
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
  if (isJsonValueType(type)) {
    return;
  }

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
  if (isJsonValueType(type)) {
    return false;
  }

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
