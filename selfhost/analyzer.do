// Module-level semantic analysis for the self-hosted compiler.
//
// The pass is intentionally phased: collect declarations, resolve imports,
// process export lists, then decorate named type annotations.  Keeping these
// responsibilities separate makes the later checker independent of parsing.

import { Parser } from "./parser"
import { ModuleResolver } from "./resolver"
import {
  Diagnostic, ImportBinding, NamespaceBinding, SemanticLocation, SemanticSpan,
  SourceFile, Symbol,
} from "./semantic"
import {
  ArrayType, AstLocation, ClassDeclaration, ConstDeclaration, EnumDeclaration,
  Block, ExportDeclaration, ExportList, ForOfStatement, ForStatement, FunctionDeclaration,
  FunctionType, IfStatement, ImmutableBinding, InterfaceDeclaration, LetDeclaration,
  NamedImport, NamedType, NamespaceImport, ReadonlyDeclaration, ReturnStatement,
  YieldStatement, WhileStatement, WithStatement, BreakStatement, ContinueStatement,
  ExpressionStatement, DestructuringStatement, ImportDeclaration, TypeAliasDeclaration, UnionType,
} from "./ast"
import type { ImportDeclaration, Program, SourceSpan, Statement, TypeAnnotation } from "./ast"

export class ModuleInfo {
  path: string
  program: Program
  symbols: Symbol[] = []
  exports: Symbol[] = []
  imports: ImportBinding[] = []
  namespaceImports: NamespaceBinding[] = []
  diagnostics: Diagnostic[] = []
}

export class AnalysisResult {
  modules: ModuleInfo[] = []
  diagnostics: Diagnostic[] = []
}

readonly BUILTIN_TYPES = ["byte", "int", "long", "float", "double", "string", "char", "bool", "void", "null"]

export class ModuleAnalyzer {
  resolver: ModuleResolver
  modules: ModuleInfo[] = []
  diagnostics: Diagnostic[] = []
  inProgress: string[] = []

  function analyze(entry: string): AnalysisResult {
    modules = []
    diagnostics = []
    inProgress = []
    ignored := analyzeModule(if entry.endsWith(".do") then entry else entry + ".do")
    return AnalysisResult { modules, diagnostics }
  }

  private function analyzeModule(path: string): ModuleInfo | null {
    existing := findModule(path)
    if existing != null { return existing }
    if contains(inProgress, path) { return null }

    source := resolver.find(path)
    if source == null {
      diagnostics.push(Diagnostic {
        severity: "error",
        message: "Module not found: " + path,
        span: emptySemanticSpan(),
        module: path,
      })
      return null
    }

    inProgress.push(path)
    program := Parser { source: source.source }.parse()
    info := ModuleInfo { path, program }
    modules.push(info)
    collectSymbols(info)
    resolveImports(info)
    resolveExportLists(info)
    resolveNamedTypes(info)
    ignored := inProgress.pop()
    for item of info.diagnostics { diagnostics.push(item) }
    return info
  }

  private function collectSymbols(info: ModuleInfo): void {
    for statement of info.program.statements {
      symbol := symbolFor(statement, info.path)
      if symbol == null { continue }
      info.symbols.push(symbol!)
      if symbol!.exported { info.exports.push(symbol!) }
    }
  }

  private function symbolFor(statement: Statement, module: string): Symbol | null {
    case statement {
      value: ClassDeclaration -> {
        return Symbol { kind: "class", name: value.name, module, exported: value.exported }
      }
      value: InterfaceDeclaration -> {
        return Symbol { kind: "interface", name: value.name, module, exported: value.exported }
      }
      value: FunctionDeclaration -> {
        return Symbol { kind: "function", name: value.name, module, exported: value.exported }
      }
      value: TypeAliasDeclaration -> {
        return Symbol { kind: "type-alias", name: value.name, module, exported: value.exported }
      }
      value: ConstDeclaration -> {
        return Symbol { kind: "const", name: value.name, module, exported: value.exported }
      }
      value: ReadonlyDeclaration -> {
        return Symbol { kind: "readonly", name: value.name, module, exported: value.exported }
      }
      value: ImmutableBinding -> {
        return Symbol { kind: "const", name: value.name, module, exported: value.exported }
      }
      value: EnumDeclaration -> {
        return Symbol { kind: "enum", name: value.name, module, exported: value.exported }
      }
      _ -> { return null }
    }
  }

  private function resolveImports(info: ModuleInfo): void {
    for statement of info.program.statements {
      case statement {
        import_: ImportDeclaration -> {
          sourcePath := resolver.resolve(info.path, import_.source)
          source := analyzeModule(sourcePath)
          for specifier of import_.specifiers {
            case specifier {
              named: NamedImport -> {
                let imported: Symbol | null = null
                if source != null { imported = findExport(source!, named.name) }
                if imported == null {
                  addError(info, "Module '" + import_.source + "' does not export '" + named.name + "'", named.span)
                }
                localName := if named.alias == null then named.name else named.alias!
                if imported == null {
                  info.imports.push(ImportBinding {
                    localName, sourceName: named.name, sourceModule: sourcePath,
                    typeOnly: import_.typeOnly,
                  })
                } else {
                  info.imports.push(ImportBinding {
                    localName, sourceName: named.name, sourceModule: sourcePath,
                    typeOnly: import_.typeOnly, symbol: imported,
                  })
                }
              }
              namespace: NamespaceImport -> {
                info.namespaceImports.push(NamespaceBinding {
                  localName: namespace.alias,
                  sourceModule: sourcePath,
                  typeOnly: import_.typeOnly,
                })
              }
            }
          }
        }
        _ -> { }
      }
    }
  }

  private function resolveExportLists(info: ModuleInfo): void {
    for statement of info.program.statements {
      case statement {
        list: ExportList -> {
          for specifier of list.specifiers {
            local := findSymbol(info, specifier.name)
            if local != null {
              exportedName := if specifier.alias == null then specifier.name else specifier.alias!
              if findExport(info, exportedName) == null {
                info.exports.push(Symbol { kind: local.kind, name: exportedName, module: local.module, exported: true })
              }
            } else {
              addError(info, "Cannot export unknown symbol '" + specifier.name + "'", specifier.span)
            }
          }
        }
        _ -> { }
      }
    }
  }

  private function resolveNamedTypes(info: ModuleInfo): void {
    for statement of info.program.statements { visitStatementTypes(statement, info) }
  }

  private function visitStatementTypes(statement: Statement, info: ModuleInfo): void {
    case statement {
      fn: FunctionDeclaration -> { visitFunctionTypes(fn, info) }
      class_: ClassDeclaration -> {
        for annotation of class_.implements_ { visitType(annotation, info) }
        for field of class_.fields { if field.type_ != null { visitType(field.type_!, info) } }
        for method of class_.methods { visitFunctionTypes(method, info) }
      }
      interface_: InterfaceDeclaration -> {
        for field of interface_.fields { visitType(field.type_, info) }
        for method of interface_.methods { visitFunctionTypes(method, info) }
      }
      alias: TypeAliasDeclaration -> { visitType(alias.type_, info) }
      const_: ConstDeclaration -> { if const_.type_ != null { visitType(const_.type_!, info) } }
      readonly_: ReadonlyDeclaration -> { if readonly_.type_ != null { visitType(readonly_.type_!, info) } }
      binding: ImmutableBinding -> { if binding.type_ != null { visitType(binding.type_!, info) } }
      let_: LetDeclaration -> { if let_.type_ != null { visitType(let_.type_!, info) } }
      _ -> { }
    }
  }

  private function visitFunctionTypes(fn: FunctionDeclaration, info: ModuleInfo): void {
    for parameter of fn.params { if parameter.type_ != null { visitType(parameter.type_!, info) } }
    if fn.returnType != null { visitType(fn.returnType!, info) }
  }

  private function visitType(annotation: TypeAnnotation, info: ModuleInfo): void {
    case annotation {
      named: NamedType -> {
        if !isBuiltin(named.name) {
          let symbol: Symbol | null = findSymbol(info, named.name)
          if symbol == null {
            for imported of info.imports {
              if imported.localName == named.name { symbol = imported.symbol; break }
            }
          }
          if symbol == null { addError(info, "Unknown type '" + named.name + "'", named.span) }
          named.resolvedSymbol = symbol
        }
        for argument of named.typeArgs { visitType(argument, info) }
      }
      array: ArrayType -> { visitType(array.elementType, info) }
      union: UnionType -> { for member of union.types { visitType(member, info) } }
      function_: FunctionType -> {
        for parameter of function_.params { visitType(parameter.type_, info) }
        visitType(function_.returnType, info)
      }
    }
  }

  private function findModule(path: string): ModuleInfo | null {
    for module of modules { if module.path == path { return module } }
    return null
  }

  // Keep the complete Statement union visible in this module's generated
  // header.  These forms are dispatched by shared Statement-typed helpers.
  private function keepStatementTypes(
    block: Block | null = null,
    export_: ExportDeclaration | null = null,
    import_: ImportDeclaration | null = null,
    if_: IfStatement | null = null,
    while_: WhileStatement | null = null,
    for_: ForStatement | null = null,
    forOf: ForOfStatement | null = null,
    with_: WithStatement | null = null,
    return_: ReturnStatement | null = null,
    yield_: YieldStatement | null = null,
    break_: BreakStatement | null = null,
    continue_: ContinueStatement | null = null,
    expression: ExpressionStatement | null = null,
    destructuring: DestructuringStatement | null = null,
  ): void { }
}

export function createAnalyzer(sources: SourceFile[]): ModuleAnalyzer {
  return ModuleAnalyzer { resolver: ModuleResolver { sources } }
}

function findSymbol(info: ModuleInfo, name: string): Symbol | null {
  for symbol of info.symbols { if symbol.name == name { return symbol } }
  return null
}

function findExport(info: ModuleInfo, name: string): Symbol | null {
  for symbol of info.exports { if symbol.name == name { return symbol } }
  return null
}

function isBuiltin(name: string): bool {
  for builtin of BUILTIN_TYPES { if builtin == name { return true } }
  return false
}

function contains(values: string[], value: string): bool {
  for item of values { if item == value { return true } }
  return false
}

function addError(info: ModuleInfo, message: string, span: SourceSpan): void {
  info.diagnostics.push(Diagnostic { severity: "error", message, span: semanticSpan(span), module: info.path })
}

function semanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}

function emptySemanticSpan(): SemanticSpan {
  zero := SemanticLocation { line: 0, column: 0, offset: 0 }
  return SemanticSpan { start: zero, end: zero }
}
