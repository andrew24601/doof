// Shared semantic data for the self-hosted front end.
//
// These are intentionally small, nominal records.  The analyzer owns module
// symbols; the checker owns resolved types and lexical bindings.

export struct SemanticLocation {
  line: int
  column: int
  offset: int
}

export struct SemanticSpan {
  start: SemanticLocation
  end: SemanticLocation
}

export class Diagnostic {
  severity: string
  message: string
  span: SemanticSpan
  module: string
}

export class Symbol {
  kind: string
  name: string
  module: string
  exported: bool
  originalName: string = ""
  native_: bool = false
  nativeHeader: string = ""
  nativeCppName: string = ""
}

export class ImportBinding {
  localName: string
  sourceName: string
  sourceModule: string
  typeOnly: bool
  symbol: Symbol | null = null
}

export class NamespaceBinding {
  localName: string
  sourceModule: string
  typeOnly: bool
}

export class SourceFile {
  path: string
  source: string
}

export class PrimitiveType {
  kind: string = "primitive"
  name: string
}

export class ClassType {
  kind: string = "class"
  name: string
  symbol: Symbol
}

export class EnumType {
  kind: string = "enum"
  name: string
  symbol: Symbol
}

export class InterfaceType {
  kind: string = "interface"
  name: string
  symbol: Symbol
}

export class FunctionType {
  kind: string = "function"
  params: FunctionParamType[]
  returnType: ResolvedType
}

export class FunctionParamType {
  name: string
  type_: ResolvedType
  hasDefault: bool
}

export class ArrayResolvedType {
  kind: string = "array"
  elementType: ResolvedType
  readonly_: bool
}

export class TupleResolvedType {
  kind: string = "tuple"
  elements: ResolvedType[]
}

export class UnionResolvedType {
  kind: string = "union"
  types: ResolvedType[]
}

export class NullType {
  kind: string = "null"
}

export class VoidType {
  kind: string = "void"
}

export class UnknownType {
  kind: string = "unknown"
}

export type ResolvedType = PrimitiveType | ClassType | EnumType | InterfaceType | FunctionType |
  ArrayResolvedType | TupleResolvedType | UnionResolvedType |
  NullType | VoidType | UnknownType

export class Binding {
  name: string
  kind: string
  type_: ResolvedType
  mutable: bool
  span: SemanticSpan
  module: string
  symbol: Symbol | null = null
}

export class Scope {
  parent: Scope | null
  bindings: Binding[] = []
  returnType: ResolvedType | null = null
  thisType: ResolvedType | null = null
}

export class CheckResult {
  diagnostics: Diagnostic[] = []
}
