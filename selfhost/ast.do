// Syntax tree data structures for the self-hosted compiler front end.
//
// The tree intentionally mirrors src/ast.ts.  Semantic passes decorate these
// nodes in place so later compiler phases do not re-resolve syntax.

import {
  ActorType, ArrayResolvedType, Binding, ClassMetadataResolvedType, ClassType, EnumType, InterfaceType, JsonValueResolvedType, MapResolvedType, MethodReflectionResolvedType, PromiseType, RangeResolvedType, ResultResolvedType, SetResolvedType, StreamResolvedType,
  FunctionType, NullType, PrimitiveType, Symbol, TupleResolvedType, UnionResolvedType,
  UnknownType, TypeParameterType, VoidType, WeakResolvedType,
} from "./semantic"
import type { ResolvedType } from "./semantic"

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
  resolvedSymbol: Symbol | null = null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ArrayType {
  kind: string
  elementType: TypeAnnotation
  readonly_: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class UnionType {
  kind: string
  types: TypeAnnotation[]
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class AstFunctionType {
  kind: string
  params: FunctionTypeParam[]
  returnType: TypeAnnotation
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class WeakType {
  kind: string = "weak-type"
  type_: TypeAnnotation
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class FunctionTypeParam {
  name: string
  type_: TypeAnnotation
  span: SourceSpan
}

export type TypeAnnotation = NamedType | ArrayType | UnionType | AstFunctionType | WeakType

export class IntLiteral {
  kind: string
  value: int
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class LongLiteral {
  kind: string
  value: long
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class FloatLiteral {
  kind: string
  value: float
  raw: string = ""
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class DoubleLiteral {
  kind: string
  value: double
  raw: string = ""
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class StringLiteral {
  kind: string
  value: string
  parts: string[]
  interpolations: Expression[]
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class CharLiteral {
  kind: string
  value: char
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class BoolLiteral {
  kind: string
  value: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class NullLiteral {
  kind: string
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class Identifier {
  kind: string
  name: string
  resolvedType: ResolvedType | null = null
  resolvedBinding: Binding | null = null
  span: SourceSpan
}

export class BinaryExpression {
  kind: string
  operator: string
  left: Expression
  right: Expression
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class UnaryExpression {
  kind: string
  operator: string
  operand: Expression
  prefix: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class AssignmentExpression {
  kind: string
  operator: string
  target: Expression
  value: Expression
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class MemberExpression {
  kind: string
  object: Expression
  property: string
  optional: bool
  force: bool
  resolvedStaticOwner: ClassDeclaration | null = null
  resolvedCallableField: bool = false
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class IndexExpression {
  kind: string
  object: Expression
  index: Expression
  optional: bool
  resolvedType: ResolvedType | null = null
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
  typeArgs: TypeAnnotation[] = []
  resolvedGenericTypeArgs: ResolvedType[] = []
  resolvedFunction: FunctionDeclaration | null = null
  resolvedConstructor: FunctionDeclaration | null = null
  resolvedClass: ClassDeclaration | null = null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ArrayLiteral {
  kind: string
  elements: Expression[]
  readonly_: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ObjectProperty {
  name: string
  value: Expression | null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ObjectLiteral {
  kind: string
  properties: ObjectProperty[]
  spread: Expression | null
  resolvedClass: ClassDeclaration | null = null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class TupleLiteral {
  kind: string
  elements: Expression[]
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class LambdaExpression {
  kind: string
  params: Parameter[]
  returnType: TypeAnnotation | null
  body: Expression | Block
  parameterless: bool
  trailing: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class IfExpression {
  kind: string
  condition: Expression
  then_: Expression
  else_: Expression
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ConstructExpression {
  kind: string
  type_: string
  typeArgs: TypeAnnotation[]
  args: ObjectProperty[]
  named: bool
  resolvedClass: ClassDeclaration | null = null
  resolvedConstructor: FunctionDeclaration | null = null
  resolvedConstructedType: ResolvedType | null = null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class DotShorthand {
  kind: string
  name: string
  resolvedShorthandOwnerName: string = ""
  resolvedShorthandOwnerKind: string = ""
  resolvedShorthandOwnerModule: string = ""
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ThisExpression {
  kind: string
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class CallerExpression {
  kind: string
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class AsyncExpression {
  kind: string
  expression: Expression | Block
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class RetireExpression {
  kind: string
  actor: Expression
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class AsExpression {
  kind: string
  expression: Expression
  targetType: TypeAnnotation
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ActorCreationExpression {
  kind: string
  className: string
  args: Expression[]
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class YieldBlockExpression {
  kind: string = "yield-block-expression"
  body: Block
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class CatchExpression {
  kind: string = "catch-expression"
  body: Block
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export type Expression =
  IntLiteral | LongLiteral | FloatLiteral | DoubleLiteral | StringLiteral |
  CharLiteral | BoolLiteral | NullLiteral | Identifier | BinaryExpression |
  UnaryExpression | AssignmentExpression | MemberExpression | IndexExpression |
  CallExpression | ArrayLiteral | ObjectLiteral | TupleLiteral |
  LambdaExpression | IfExpression | CaseExpression | ConstructExpression | DotShorthand |
  ThisExpression | CallerExpression | AsyncExpression | RetireExpression | AsExpression | ActorCreationExpression |
  YieldBlockExpression | CatchExpression

export class Parameter {
  name: string
  description: string = ""
  type_: TypeAnnotation | null
  defaultValue: Expression | null
  resolvedType: ResolvedType | null = null
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
  description: string = ""
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ReadonlyDeclaration {
  kind: string
  name: string
  description: string = ""
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class ImmutableBinding {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  exported: bool
  else_: Block | null = null
  failureName: string | null = null
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class LetDeclaration {
  kind: string
  name: string
  type_: TypeAnnotation | null
  value: Expression
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class FunctionDeclaration {
  kind: string
  name: string
  description: string = ""
  typeParams: string[]
  typeParamConstraints: TypeParameterConstraint[] = []
  params: Parameter[]
  returnType: TypeAnnotation | null
  body: Expression | Block
  exported: bool
  static_: bool
  isolated_: bool
  resolvedIsolated: bool = false
  private_: bool
  bodyless: bool = false
  native_: bool = false
  nativeHeader: string = ""
  nativeCppName: string = ""
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class TypeParameterConstraint {
  type_: TypeAnnotation | null = null
}

export class ReturnStatement {
  kind: string
  value: Expression | null = null
  resolvedExpectedType: ResolvedType | null = null
  span: SourceSpan
}

export class YieldStatement {
  kind: string
  value: Expression
  span: SourceSpan
}

export class YieldBlockAssignmentStatement {
  kind: string = "yield-block-assignment-statement"
  name: string
  value: YieldBlockExpression
  resolvedType: ResolvedType | null = null
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

export class CaseExpression {
  kind: string
  subject: Expression
  arms: CaseExpressionArm[]
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class CaseStatement {
  kind: string
  subject: Expression
  arms: CaseArm[]
  span: SourceSpan
}

export class CaseArm {
  kind: string
  patterns: CasePattern[]
  body: Expression | Block
  span: SourceSpan
}

export class CaseExpressionArm {
  kind: string
  patterns: CasePattern[]
  body: Expression | Block
  span: SourceSpan
}

export class TypePattern {
  kind: string
  name: string
  type_: TypeAnnotation
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class WildcardPattern {
  kind: string
  span: SourceSpan
}

export class ValuePattern {
  kind: string
  value: Expression
  span: SourceSpan
}

export class RangePattern {
  kind: string
  start: Expression | null
  end: Expression | null
  inclusive: bool
  span: SourceSpan
}

export type CasePattern = TypePattern | WildcardPattern | ValuePattern | RangePattern

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
  resolvedType: ResolvedType | null = null
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
  bindings: string[] = []
  namedBindings: DestructureBinding[] = []
  bindingKind: string
  value: Expression
  span: SourceSpan
}

export class DestructureBinding {
  name: string
  alias: string | null = null
  span: SourceSpan
}

// Statement-level Result propagation used by std/json and std/fs.
export class TryStatement {
  kind: string
  binding: ConstDeclaration | ReadonlyDeclaration | ImmutableBinding | LetDeclaration | ExpressionStatement | DestructuringStatement
  span: SourceSpan
}

export class ClassDeclaration {
  kind: string
  name: string
  description: string = ""
  struct_: bool = false
  typeParams: string[]
  typeParamConstraints: TypeParameterConstraint[] = []
  implements_: NamedType[]
  fields: ClassField[]
  methods: FunctionDeclaration[]
  destructor_: Block | null = null
  exported: bool
  private_: bool
  native_: bool = false
  nativeHeader: string = ""
  nativeCppName: string = ""
  resolvedSymbol: Symbol | null = null
  needsMetadata: bool = false
  span: SourceSpan
}

export class ClassField {
  kind: string
  names: string[]
  descriptions: string[] = []
  type_: TypeAnnotation | null
  defaultValue: Expression | null
  static_: bool
  readonly_: bool
  weak_: bool = false
  private_: bool
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class InterfaceDeclaration {
  kind: string
  name: string
  description: string = ""
  typeParams: string[]
  typeParamConstraints: TypeParameterConstraint[] = []
  fields: InterfaceField[]
  methods: FunctionDeclaration[]
  exported: bool
  resolvedSymbol: Symbol | null = null
  span: SourceSpan
}

export class InterfaceField {
  kind: string
  name: string
  description: string = ""
  type_: TypeAnnotation
  readonly_: bool = false
  resolvedType: ResolvedType | null = null
  span: SourceSpan
}

export class EnumDeclaration {
  kind: string
  name: string
  description: string = ""
  variants: EnumVariant[]
  exported: bool
  span: SourceSpan
}

export class EnumVariant {
  kind: string
  name: string
  description: string = ""
  value: Expression | null
  span: SourceSpan
}

export class TypeAliasDeclaration {
  kind: string
  name: string
  description: string = ""
  typeParams: string[]
  typeParamConstraints: TypeParameterConstraint[] = []
  type_: TypeAnnotation
  exported: bool
  resolvedType: ResolvedType | null = null
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

export class MockImportMapping {
  dependency: string
  replacement: string
  span: SourceSpan
}

export class MockImportDirective {
  kind: string
  sourcePattern: string
  mappings: MockImportMapping[]
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
  EnumDeclaration | TypeAliasDeclaration | ImportDeclaration | MockImportDirective |
  ExportDeclaration | ExportList | IfStatement | CaseStatement | WhileStatement |
  ForStatement | ForOfStatement | WithStatement | ReturnStatement |
  YieldStatement | BreakStatement | ContinueStatement | ExpressionStatement |
  DestructuringStatement | TryStatement | YieldBlockAssignmentStatement | Block

export class Program {
  kind: string
  statements: Statement[]
  span: SourceSpan
}
