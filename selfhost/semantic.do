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
  implementations: Symbol[] = []
  implementedInterfaceTypes: string[] = []
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
  typeArgs: ResolvedType[] = []
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
  typeArgs: ResolvedType[] = []
}

export class FunctionType {
  kind: string = "function"
  params: FunctionParamType[]
  returnType: ResolvedType
  typeParams: string[] = []
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

export class MapResolvedType {
  kind: string = "map"
  keyType: ResolvedType
  valueType: ResolvedType
  readonly_: bool
}

export class StreamResolvedType {
  kind: string = "stream"
  elementType: ResolvedType
}

// JsonValue is recursive, so it is represented as a dedicated intrinsic
// semantic type rather than expanding into a finite union of containers.
export class JsonValueResolvedType {
  kind: string = "json-value"
}

export class ResultResolvedType {
  kind: string = "result"
  valueType: ResolvedType
  errorType: ResolvedType
}

export class TupleResolvedType {
  kind: string = "tuple"
  elements: ResolvedType[]
}

export class UnionResolvedType {
  kind: string = "union"
  types: ResolvedType[]
  // Preserves the nominal identity of recursive semantic aliases such as
  // ResolvedType after union flattening, so the emitter can use the checked
  // alias representation without re-reading its source annotation.
  aliasName: string = ""
  aliasModule: string = ""
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

// A type parameter is resolved semantic information, not recovery unknown.
// Keeping it explicit lets the checker prove generic declarations before the
// emitter sees them while preserving the parameter spelling for C++ templates.
export class TypeParameterType {
  kind: string = "type-parameter"
  name: string
}

export type ResolvedType = PrimitiveType | ClassType | EnumType | InterfaceType | FunctionType |
  ArrayResolvedType | MapResolvedType | StreamResolvedType | JsonValueResolvedType | ResultResolvedType | TupleResolvedType | UnionResolvedType |
  NullType | VoidType | UnknownType | TypeParameterType

export class TypeSubstitution {
  names: string[] = []
  arguments: ResolvedType[] = []
}

export class Binding {
  name: string
  kind: string
  type_: ResolvedType
  mutable: bool
  span: SemanticSpan
  module: string
  symbol: Symbol | null = null
  casePattern: string = ""
}

export class Scope {
  parent: Scope | null
  bindings: Binding[] = []
  typeParams: string[] = []
  returnType: ResolvedType | null = null
  thisType: ResolvedType | null = null
}

export class CheckResult {
  diagnostics: Diagnostic[] = []
}
