// Syntax tree data structures for the self-hosted compiler front end.
//
// The tree intentionally mirrors src/ast.ts.  Semantic fields are not part of
// this first self-hosted slice; the checker will add them once it is ported.

export struct AstLocation {
  line: int
  column: int
  offset: int
}

export struct SourceSpan {
  start: AstLocation
  end: AstLocation
}

export class NamedType {
  kind: string
  name: string
  typeArgs: TypeAnnotation[]
  span: SourceSpan
}

export class ArrayType {
  kind: string
  elementType: TypeAnnotation
  readonly_: bool
  span: SourceSpan
}

export class UnionType {
  kind: string
  types: TypeAnnotation[]
  span: SourceSpan
}

export class FunctionType {
  kind: string
  params: FunctionTypeParam[]
  returnType: TypeAnnotation
  span: SourceSpan
}

export class FunctionTypeParam {
  name: string
  type_: TypeAnnotation
  span: SourceSpan
}

export type TypeAnnotation = NamedType | ArrayType | UnionType | FunctionType

export class IntLiteral {
  kind: string
  value: int
  span: SourceSpan
}

export class LongLiteral {
  kind: string
  value: long
  span: SourceSpan
}

export class FloatLiteral {
  kind: string
  value: float
  span: SourceSpan
}

export class DoubleLiteral {
  kind: string
  value: double
  span: SourceSpan
}

export class StringLiteral {
  kind: string
  value: string
  parts: string[]
  interpolations: Expression[]
  span: SourceSpan
}

export class CharLiteral {
  kind: string
  value: char
  span: SourceSpan
}

export class BoolLiteral {
  kind: string
  value: bool
  span: SourceSpan
}

export class NullLiteral {
  kind: string
  span: SourceSpan
}

export class Identifier {
  kind: string
  name: string
  span: SourceSpan
}

export class BinaryExpression {
  kind: string
  operator: string
  left: Expression
  right: Expression
  span: SourceSpan
}

export class UnaryExpression {
  kind: string
  operator: string
  operand: Expression
  prefix: bool
  span: SourceSpan
}

export class AssignmentExpression {
  kind: string
  operator: string
  target: Expression
  value: Expression
  span: SourceSpan
}

export class MemberExpression {
  kind: string
  object: Expression
  property: string
  optional: bool
  force: bool
  span: SourceSpan
}

export class IndexExpression {
  kind: string
  object: Expression
  index: Expression
  optional: bool
  span: SourceSpan
}

export class CallArgument {
  name: string | null
  value: Expression
  span: SourceSpan
}

export class CallExpression {
  kind: string
  callee: Expression
  args: CallArgument[]
  span: SourceSpan
}

export class ArrayLiteral {
  kind: string
  elements: Expression[]
  readonly_: bool
  span: SourceSpan
}

export class ObjectProperty {
  name: string
  value: Expression | null
  span: SourceSpan
}

export class ObjectLiteral {
  kind: string
  properties: ObjectProperty[]
  spread: Expression | null
  span: SourceSpan
}

export class TupleLiteral {
  kind: string
  elements: Expression[]
  span: SourceSpan
}

export class LambdaExpression {
  kind: string
  params: Parameter[]
  returnType: TypeAnnotation | null
  body: Expression | Block
  parameterless: bool
  trailing: bool
  span: SourceSpan
}

export class IfExpression {
  kind: string
  condition: Expression
  then_: Expression
  else_: Expression
  span: SourceSpan
}

export class ConstructExpression {
  kind: string
  type_: string
  typeArgs: TypeAnnotation[]
  args: ObjectProperty[] | Expression[]
  named: bool
  span: SourceSpan
}

export class DotShorthand {
  kind: string
  name: string
  span: SourceSpan
}

export class ThisExpression {
  kind: string
  span: SourceSpan
}

export class CallerExpression {
  kind: string
  span: SourceSpan
}

export type Expression =
  IntLiteral | LongLiteral | FloatLiteral | DoubleLiteral | StringLiteral |
  CharLiteral | BoolLiteral | NullLiteral | Identifier | BinaryExpression |
  UnaryExpression | AssignmentExpression | MemberExpression | IndexExpression |
  CallExpression | ArrayLiteral | ObjectLiteral | TupleLiteral |
  LambdaExpression | IfExpression | ConstructExpression | DotShorthand |
  ThisExpression | CallerExpression

export class Parameter {
  name: string
  type_: TypeAnnotation | null
  defaultValue: Expression | null
  span: SourceSpan
}

export class Block {
  kind: string
  statements: Statement[]
  span: SourceSpan
}

export class ConstDeclaration {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  span: SourceSpan
}

export class ReadonlyDeclaration {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  span: SourceSpan
}

export class ImmutableBinding {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  span: SourceSpan
}

export class LetDeclaration {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  span: SourceSpan
}

export class FunctionDeclaration {
  kind: string
  name: string
  typeParams: string[]
  params: Parameter[]
  returnType: TypeAnnotation | null
  body: Expression | Block
  exported: bool
  static_: bool
  isolated_: bool
  private_: bool
  span: SourceSpan
}

export class ReturnStatement {
  kind: string
  value: Expression | null
  span: SourceSpan
}

export class YieldStatement {
  kind: string
  value: Expression
  span: SourceSpan
}

export class IfStatement {
  kind: string
  condition: Expression
  body: Block
  elseIfs: IfBranch[]
  else_: Block | null
  span: SourceSpan
}

export class IfBranch {
  condition: Expression
  body: Block
  span: SourceSpan
}

export class WhileStatement {
  kind: string
  condition: Expression
  body: Block
  label: string | null
  then_: Block | null
  span: SourceSpan
}

export class ForStatement {
  kind: string
  init: Statement | null
  condition: Expression | null
  update: Expression[]
  body: Block
  label: string | null
  then_: Block | null
  span: SourceSpan
}

export class ForOfStatement {
  kind: string
  bindings: string[]
  iterable: Expression
  body: Block
  label: string | null
  then_: Block | null
  span: SourceSpan
}

export class WithBinding {
  name: string
  type_: TypeAnnotation | null
  value: Expression
  span: SourceSpan
}

export class WithStatement {
  kind: string
  bindings: WithBinding[]
  body: Block
  span: SourceSpan
}

export class BreakStatement {
  kind: string
  label: string | null
  span: SourceSpan
}

export class ContinueStatement {
  kind: string
  label: string | null
  span: SourceSpan
}

export class ExpressionStatement {
  kind: string
  expression: Expression
  span: SourceSpan
}

export class DestructuringStatement {
  kind: string
  bindings: string[]
  bindingKind: string
  value: Expression
  span: SourceSpan
}

export class ClassDeclaration {
  kind: string
  name: string
  typeParams: string[]
  implements_: NamedType[]
  fields: ClassField[]
  methods: FunctionDeclaration[]
  exported: bool
  private_: bool
  span: SourceSpan
}

export class ClassField {
  kind: string
  names: string[]
  type_: TypeAnnotation | null
  defaultValue: Expression | null
  static_: bool
  readonly_: bool
  private_: bool
  span: SourceSpan
}

export class InterfaceDeclaration {
  kind: string
  name: string
  typeParams: string[]
  fields: InterfaceField[]
  methods: FunctionDeclaration[]
  exported: bool
  span: SourceSpan
}

export class InterfaceField {
  kind: string
  name: string
  type_: TypeAnnotation
  span: SourceSpan
}

export class EnumDeclaration {
  kind: string
  name: string
  variants: EnumVariant[]
  exported: bool
  span: SourceSpan
}

export class EnumVariant {
  kind: string
  name: string
  value: Expression | null
  span: SourceSpan
}

export class TypeAliasDeclaration {
  kind: string
  name: string
  typeParams: string[]
  type_: TypeAnnotation
  exported: bool
  span: SourceSpan
}

export class NamedImport {
  kind: string
  name: string
  alias: string | null
  span: SourceSpan
}

export class NamespaceImport {
  kind: string
  alias: string
  span: SourceSpan
}

export type ImportSpecifier = NamedImport | NamespaceImport

export class ImportDeclaration {
  kind: string
  specifiers: ImportSpecifier[]
  source: string
  typeOnly: bool
  span: SourceSpan
}

export class ExportDeclaration {
  kind: string
  declaration: Statement
  span: SourceSpan
}

export class ExportSpecifier {
  name: string
  alias: string | null
  span: SourceSpan
}

export class ExportList {
  kind: string
  specifiers: ExportSpecifier[]
  source: string | null
  span: SourceSpan
}

export type Statement =
  ConstDeclaration | ReadonlyDeclaration | ImmutableBinding | LetDeclaration |
  FunctionDeclaration | ClassDeclaration | InterfaceDeclaration |
  EnumDeclaration | TypeAliasDeclaration | ImportDeclaration |
  ExportDeclaration | ExportList | IfStatement | WhileStatement |
  ForStatement | ForOfStatement | WithStatement | ReturnStatement |
  YieldStatement | BreakStatement | ContinueStatement | ExpressionStatement |
  DestructuringStatement | Block

export class Program {
  kind: string
  statements: Statement[]
  span: SourceSpan
}
