import type { ResolvedType, Binding } from "./checker-types.js";
import type { ClassSymbol, ModuleSymbol } from "./types.js";

// ============================================================================
// Source Location
// ============================================================================

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

// ============================================================================
// Type Annotations
// ============================================================================

export interface NamedType {
  kind: "named-type";
  name: string;
  typeArgs: TypeAnnotation[];
  /** Set by the analyzer: the symbol this type name resolves to. */
  resolvedSymbol?: ModuleSymbol;
  span: SourceSpan;
}

export interface ArrayType {
  kind: "array-type";
  elementType: TypeAnnotation;
  readonly_: boolean;
  span: SourceSpan;
}

export interface UnionType {
  kind: "union-type";
  types: TypeAnnotation[];
  span: SourceSpan;
}

export interface FunctionType {
  kind: "function-type";
  params: FunctionTypeParam[];
  returnType: TypeAnnotation;
  span: SourceSpan;
}

export interface FunctionTypeParam {
  name: string;
  type: TypeAnnotation;
  span: SourceSpan;
}

export interface TupleType {
  kind: "tuple-type";
  elements: TypeAnnotation[];
  span: SourceSpan;
}

export interface WeakType {
  kind: "weak-type";
  type: TypeAnnotation;
  span: SourceSpan;
}

export type TypeAnnotation =
  | NamedType
  | ArrayType
  | UnionType
  | FunctionType
  | TupleType
  | WeakType;

// ============================================================================
// Resolved type decoration
// ============================================================================

/**
 * Mixin for AST nodes that carry a resolved type after type checking.
 * The type checker populates `resolvedType` during its analysis pass,
 * making type information directly available on the AST for compilation.
 */
export interface Typed {
  resolvedType?: ResolvedType;
}

// ============================================================================
// Expressions
// ============================================================================

export interface IntLiteral extends Typed {
  kind: "int-literal";
  value: number;
  span: SourceSpan;
}

export interface LongLiteral extends Typed {
  kind: "long-literal";
  value: bigint;
  span: SourceSpan;
}

export interface FloatLiteral extends Typed {
  kind: "float-literal";
  value: number;
  span: SourceSpan;
}

export interface DoubleLiteral extends Typed {
  kind: "double-literal";
  value: number;
  span: SourceSpan;
}

export interface StringLiteral extends Typed {
  kind: "string-literal";
  value: string;
  /** The interpolated parts, in order. Raw string segments alternate with expressions. */
  parts: (string | Expression)[];
  span: SourceSpan;
}

export interface CharLiteral extends Typed {
  kind: "char-literal";
  value: string;
  span: SourceSpan;
}

export interface BoolLiteral extends Typed {
  kind: "bool-literal";
  value: boolean;
  span: SourceSpan;
}

export interface NullLiteral extends Typed {
  kind: "null-literal";
  span: SourceSpan;
}

export interface Identifier extends Typed {
  kind: "identifier";
  name: string;
  span: SourceSpan;
  /** Set by the type checker: the binding this identifier resolves to. */
  resolvedBinding?: Binding;
}

export interface BinaryExpression extends Typed {
  kind: "binary-expression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
  span: SourceSpan;
}

export type BinaryOperator =
  | "+" | "-" | "*" | "/" | "\\" | "%" | "**"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "&&" | "||"
  | "&" | "|" | "^" | "<<" | ">>" | ">>>"
  | "??" | ".." | "..<";

export type UnaryOperator =
  | "!" | "-" | "+" | "~"
  | "try" | "try!" | "try?";

export interface UnaryExpression extends Typed {
  kind: "unary-expression";
  operator: UnaryOperator;
  operand: Expression;
  prefix: boolean;
  span: SourceSpan;
}

export type AssignmentOperator =
  | "=" | "+=" | "-=" | "*=" | "/=" | "\\=" | "%=" | "**="
  | "&=" | "|=" | "^=" | "<<=" | ">>="
  | "??=";

export interface AssignmentExpression extends Typed {
  kind: "assignment-expression";
  operator: AssignmentOperator;
  target: Expression;
  value: Expression;
  span: SourceSpan;
}

export interface MemberExpression extends Typed {
  kind: "member-expression";
  object: Expression;
  property: string;
  optional: boolean;  // ?.
  force: boolean;     // !.
  span: SourceSpan;
}

export interface QualifiedMemberExpression extends Typed {
  kind: "qualified-member-expression";
  object: Expression;
  property: string;
  span: SourceSpan;
}

export interface IndexExpression extends Typed {
  kind: "index-expression";
  object: Expression;
  index: Expression;
  optional: boolean;  // ?[]
  span: SourceSpan;
}

export interface CallExpression extends Typed {
  kind: "call-expression";
  callee: Expression;
  args: CallArgument[];
  resolvedGenericTypeArgs?: ResolvedType[];
  resolvedGenericBinding?: Binding;
  resolvedGenericOwnerClass?: ClassSymbol;
  resolvedGenericMethodName?: string;
  resolvedGenericMethodStatic?: boolean;
  span: SourceSpan;
}

export interface YieldBlockExpression extends Typed {
  kind: "yield-block-expression";
  body: Block;
  span: SourceSpan;
}

export interface CallArgument {
  name?: string;
  value: Expression;
  span: SourceSpan;
}

export interface ArrayLiteral extends Typed {
  kind: "array-literal";
  elements: Expression[];
  readonly_: boolean;
  span: SourceSpan;
}

export interface ObjectLiteral extends Typed {
  kind: "object-literal";
  properties: ObjectProperty[];
  spread?: Expression;
  span: SourceSpan;
}

export interface YieldBlockAssignmentStatement extends Typed {
  kind: "yield-block-assignment-statement";
  name: string;
  value: YieldBlockExpression;
  span: SourceSpan;
}

export interface ObjectProperty {
  kind: "object-property";
  name: string;
  value: Expression | null; // null = shorthand { name }
  span: SourceSpan;
}

export interface SpreadProperty {
  kind: "spread-property";
  value: Expression;
  span: SourceSpan;
}

export interface MapLiteral extends Typed {
  kind: "map-literal";
  entries: MapEntry[];
  span: SourceSpan;
}

export interface MapEntry {
  key: Expression;
  value: Expression;
  span: SourceSpan;
}

export interface TupleLiteral extends Typed {
  kind: "tuple-literal";
  elements: Expression[];
  span: SourceSpan;
}

export interface LambdaExpression extends Typed {
  kind: "lambda-expression";
  params: Parameter[];
  returnType: TypeAnnotation | null;
  body: Expression | Block;
  /** true when parameterless form `=> expr` */
  parameterless: boolean;
  /** true when created by trailing block syntax: `call() { body }` */
  trailing: boolean;
  span: SourceSpan;
}

export interface IfExpression extends Typed {
  kind: "if-expression";
  condition: Expression;
  then: Expression;
  else_: Expression;
  span: SourceSpan;
}

export interface CaseExpression extends Typed {
  kind: "case-expression";
  subject: Expression;
  arms: CaseArm[];
  span: SourceSpan;
}

export interface CaseStatement {
  kind: "case-statement";
  subject: Expression;
  arms: CaseArm[];
  span: SourceSpan;
}

export interface CaseArm {
  kind: "case-arm";
  patterns: CasePattern[];
  body: Expression | Block;
  span: SourceSpan;
}

export interface ValuePattern {
  kind: "value-pattern";
  value: Expression;
  span: SourceSpan;
}

export interface RangePattern {
  kind: "range-pattern";
  start: Expression | null;
  end: Expression | null;
  inclusive: boolean;
  span: SourceSpan;
}

export interface TypePattern {
  kind: "type-pattern";
  name: string;    // binding name, "_" for discard
  type: TypeAnnotation;
  span: SourceSpan;
}

export interface WildcardPattern {
  kind: "wildcard-pattern";
  span: SourceSpan;
}

export type CasePattern =
  | ValuePattern
  | RangePattern
  | TypePattern
  | WildcardPattern;

export interface ConstructExpression extends Typed {
  kind: "construct-expression";
  type: string;
  typeArgs: TypeAnnotation[];
  args: ObjectProperty[] | Expression[];
  named: boolean;
  tightBraces?: boolean;
  resolvedGenericTypeArgs?: ResolvedType[];
  resolvedGenericBinding?: Binding;
  span: SourceSpan;
}

export interface EnumAccess extends Typed {
  kind: "enum-access";
  enumName: string | null; // null for dot-shorthand (.Variant)
  variant: string;
  span: SourceSpan;
}

export interface DotShorthand extends Typed {
  kind: "dot-shorthand";
  name: string;
  span: SourceSpan;
}

export interface ThisExpression extends Typed {
  kind: "this-expression";
  span: SourceSpan;
}

export interface CallerExpression extends Typed {
  kind: "caller-expression";
  span: SourceSpan;
}

export interface CatchExpression extends Typed {
  kind: "catch-expression";
  body: Statement[];
  span: SourceSpan;
}

export interface AsyncExpression extends Typed {
  kind: "async-expression";
  /** The call expression or block being dispatched asynchronously. */
  expression: Expression | Block;
  span: SourceSpan;
}

export interface NonNullAssertionExpression extends Typed {
  kind: "non-null-assertion";
  expression: Expression;
  span: SourceSpan;
}

export interface AsExpression extends Typed {
  kind: "as-expression";
  expression: Expression;
  targetType: TypeAnnotation;
  span: SourceSpan;
}

export interface ActorCreationExpression extends Typed {
  kind: "actor-creation-expression";
  /** The class name to wrap in an actor. */
  className: string;
  /** Constructor arguments. */
  args: Expression[];
  span: SourceSpan;
}

export type Expression =
  | IntLiteral
  | LongLiteral
  | FloatLiteral
  | DoubleLiteral
  | StringLiteral
  | CharLiteral
  | BoolLiteral
  | NullLiteral
  | Identifier
  | BinaryExpression
  | UnaryExpression
  | AssignmentExpression
  | YieldBlockExpression
  | MemberExpression
  | QualifiedMemberExpression
  | IndexExpression
  | CallExpression
  | ArrayLiteral
  | ObjectLiteral
  | MapLiteral
  | TupleLiteral
  | LambdaExpression
  | IfExpression
  | CaseExpression
  | ConstructExpression
  | EnumAccess
  | DotShorthand
  | ThisExpression
  | CallerExpression
  | CatchExpression
  | AsyncExpression
  | NonNullAssertionExpression
  | AsExpression
  | ActorCreationExpression;

// ============================================================================
// Statements
// ============================================================================

export interface ConstDeclaration extends Typed {
  kind: "const-declaration";
  name: string;
  description?: string;
  type: TypeAnnotation | null;
  value: Expression;
  exported: boolean;
  span: SourceSpan;
}

export interface ReadonlyDeclaration extends Typed {
  kind: "readonly-declaration";
  name: string;
  description?: string;
  type: TypeAnnotation | null;
  value: Expression;
  exported: boolean;
  span: SourceSpan;
}

export interface ImmutableBinding extends Typed {
  kind: "immutable-binding";
  name: string;
  type: TypeAnnotation | null;
  value: Expression;
  span: SourceSpan;
}

export interface LetDeclaration extends Typed {
  kind: "let-declaration";
  name: string;
  type: TypeAnnotation | null;
  value: Expression;
  span: SourceSpan;
}

export interface FunctionDeclaration extends Typed {
  kind: "function-declaration";
  name: string;
  description?: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  params: Parameter[];
  returnType: TypeAnnotation | null;
  body: Expression | Block;
  mock_?: boolean;
  bodyless?: boolean;
  exported: boolean;
  static_: boolean;
  isolated_: boolean;
  private_: boolean;
  span: SourceSpan;
}

export interface Parameter extends Typed {
  name: string;
  description?: string;
  type: TypeAnnotation | null;
  defaultValue: Expression | null;
  span: SourceSpan;
}

export interface Block {
  kind: "block";
  statements: Statement[];
  span: SourceSpan;
}

export interface ReturnStatement {
  kind: "return-statement";
  value: Expression | null;
  span: SourceSpan;
}

export interface YieldStatement {
  kind: "yield-statement";
  value: Expression;
  span: SourceSpan;
}

export interface IfStatement {
  kind: "if-statement";
  condition: Expression;
  body: Block;
  elseIfs: { condition: Expression; body: Block; span: SourceSpan }[];
  else_: Block | null;
  span: SourceSpan;
}

export interface WhileStatement {
  kind: "while-statement";
  condition: Expression;
  body: Block;
  label: string | null;
  then_: Block | null;
  span: SourceSpan;
}

export interface ForStatement {
  kind: "for-statement";
  init: Statement | null;
  condition: Expression | null;
  update: Expression[];
  body: Block;
  label: string | null;
  then_: Block | null;
  span: SourceSpan;
}

export interface ForOfStatement {
  kind: "for-of-statement";
  bindings: string[];
  iterable: Expression;
  body: Block;
  label: string | null;
  then_: Block | null;
  span: SourceSpan;
}

export interface WithBinding extends Typed {
  name: string;
  type: TypeAnnotation | null;
  value: Expression;
  span: SourceSpan;
}

export interface ElseNarrowStatement extends Typed {
  kind: "else-narrow-statement";
  name: string;
  type: TypeAnnotation | null;
  subject: Expression;
  elseBlock: Block;
  span: SourceSpan;
}

export interface WithStatement {
  kind: "with-statement";
  bindings: WithBinding[];
  body: Block;
  span: SourceSpan;
}

export interface BreakStatement {
  kind: "break-statement";
  label: string | null;
  span: SourceSpan;
}

export interface ContinueStatement {
  kind: "continue-statement";
  label: string | null;
  span: SourceSpan;
}

export interface ExpressionStatement {
  kind: "expression-statement";
  expression: Expression;
  span: SourceSpan;
}

export interface ClassDeclaration {
  kind: "class-declaration";
  name: string;
  description?: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  implements_: NamedType[];
  fields: ClassField[];
  methods: FunctionDeclaration[];
  destructor: Block | null;
  mock_?: boolean;
  exported: boolean;
  private_: boolean;
  /** Set by the checker when user code accesses .toJsonObject() or .fromJsonValue() */
  needsJson?: boolean;
  /** Set by the checker when user code accesses .metadata or .invoke() */
  needsMetadata?: boolean;
  span: SourceSpan;
}

export interface ClassField extends Typed {
  kind: "class-field";
  names: string[];
  descriptions: (string | undefined)[];
  type: TypeAnnotation | null;
  defaultValue: Expression | null;
  static_: boolean;
  readonly_: boolean;
  const_: boolean;
  weak_: boolean;
  private_: boolean;
  span: SourceSpan;
}

export interface InterfaceDeclaration {
  kind: "interface-declaration";
  name: string;
  description?: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  fields: InterfaceField[];
  methods: InterfaceMethod[];
  exported: boolean;
  /** Set by the checker when user code accesses .fromJsonValue() */
  needsJson?: boolean;
  span: SourceSpan;
}

export interface InterfaceField extends Typed {
  kind: "interface-field";
  name: string;
  description?: string;
  type: TypeAnnotation;
  static_: boolean;
  readonly_: boolean;
  span: SourceSpan;
}

export interface InterfaceMethod extends Typed {
  kind: "interface-method";
  name: string;
  description?: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  params: Parameter[];
  returnType: TypeAnnotation;
  static_: boolean;
  span: SourceSpan;
}

export interface EnumDeclaration {
  kind: "enum-declaration";
  name: string;
  description?: string;
  variants: EnumVariant[];
  exported: boolean;
  span: SourceSpan;
}

export interface EnumVariant {
  kind: "enum-variant";
  name: string;
  description?: string;
  value: Expression | null;
  span: SourceSpan;
}

export interface TypeAliasDeclaration {
  kind: "type-alias-declaration";
  name: string;
  description?: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  type: TypeAnnotation;
  exported: boolean;
  /** Set by the checker when user code accesses .fromJsonValue() */
  needsJson?: boolean;
  span: SourceSpan;
}

// ============================================================================
// Imports & Exports
// ============================================================================

export interface ImportDeclaration {
  kind: "import-declaration";
  specifiers: ImportSpecifier[];
  source: string;
  typeOnly: boolean;
  span: SourceSpan;
}

export interface MockImportMapping {
  dependency: string;
  replacement: string;
  span: SourceSpan;
}

export interface MockImportDirective {
  kind: "mock-import-directive";
  sourcePattern: string;
  mappings: MockImportMapping[];
  span: SourceSpan;
}

export interface NamedImportSpecifier {
  kind: "named-import-specifier";
  name: string;
  alias: string | null;
  span: SourceSpan;
}

export interface NamespaceImportSpecifier {
  kind: "namespace-import-specifier";
  alias: string;
  span: SourceSpan;
}

export type ImportSpecifier = NamedImportSpecifier | NamespaceImportSpecifier;

export interface ExportDeclaration {
  kind: "export-declaration";
  declaration: Statement;
  span: SourceSpan;
}

export interface ExportList {
  kind: "export-list";
  specifiers: ExportSpecifier[];
  source: string | null; // for re-exports
  span: SourceSpan;
}

export interface ExportSpecifier {
  kind: "export-specifier";
  name: string;
  alias: string | null;
  span: SourceSpan;
}

export interface ExportAllDeclaration {
  kind: "export-all-declaration";
  source: string;
  alias: string | null;
  span: SourceSpan;
}

// ============================================================================
// Extern C++ class imports
// ============================================================================

/**
 * `import class Name { ... }` or `import class Name from "header" { ... }`
 * Declares the shape of an external C++ class for interop.
 */
export interface ExternClassDeclaration {
  kind: "extern-class-declaration";
  name: string;
  exported: boolean;
  /** Explicit header path, or null to infer from class name. */
  headerPath: string | null;
  /** Fully-qualified C++ name when `as` clause is present (e.g. "httplib::Client"). */
  cppName: string | null;
  fields: ExternClassField[];
  methods: ExternClassMethod[];
  span: SourceSpan;
}

export interface ExternClassField {
  kind: "extern-class-field";
  names: string[];
  descriptions: (string | undefined)[];
  type: TypeAnnotation;
  span: SourceSpan;
}

export interface ExternClassMethod {
  kind: "extern-class-method";
  name: string;
  static_: boolean;
  params: Parameter[];
  returnType: TypeAnnotation;
  span: SourceSpan;
}

// ============================================================================
// Extern C++ function imports
// ============================================================================

/**
 * `import function name(params): Type from "header" [as cpp::name]`
 * Declares the signature of an external C/C++ function for interop.
 */
export interface ExternFunctionDeclaration {
  kind: "extern-function-declaration";
  name: string;
  typeParams: string[];
  typeParamConstraints?: (TypeAnnotation | null)[];
  /** Explicit header path, or null to infer from function name. */
  headerPath: string | null;
  /** Fully-qualified C++ name when `as` clause is present (e.g. "std::sin"). */
  cppName: string | null;
  params: Parameter[];
  returnType: TypeAnnotation;
  exported: boolean;
  span: SourceSpan;
}

// ============================================================================
// Destructuring (in bindings)
// ============================================================================

export interface PositionalDestructuring {
  kind: "positional-destructuring";
  bindings: string[];
  bindingKind: "immutable" | "let";
  value: Expression;
  span: SourceSpan;
}

export interface ArrayDestructuring {
  kind: "array-destructuring";
  bindings: string[];
  bindingKind: "immutable" | "let";
  value: Expression;
  span: SourceSpan;
}

export interface NamedDestructuring {
  kind: "named-destructuring";
  bindings: DestructureBinding[];
  bindingKind: "immutable" | "let";
  value: Expression;
  span: SourceSpan;
}

export interface PositionalDestructuringAssignment {
  kind: "positional-destructuring-assignment";
  bindings: string[];
  value: Expression;
  span: SourceSpan;
}

export interface ArrayDestructuringAssignment {
  kind: "array-destructuring-assignment";
  bindings: string[];
  value: Expression;
  span: SourceSpan;
}

export interface NamedDestructuringAssignment {
  kind: "named-destructuring-assignment";
  bindings: DestructureBinding[];
  value: Expression;
  span: SourceSpan;
}

export interface DestructureBinding {
  name: string;
  alias: string | null;
  span: SourceSpan;
}

// ============================================================================
// Try statement — early return on Result failure
// ============================================================================

/**
 * The binding forms that `try` can wrap.
 * `try x := expr`, `try const x = expr`, `try let x = expr`,
 * `try readonly x = expr`, `try (a, b) := expr`, `try {a, b} := expr`,
 * `try x = expr` (assignment via expression-statement).
 */
export type TryBinding =
  | ImmutableBinding
  | ConstDeclaration
  | ReadonlyDeclaration
  | LetDeclaration
  | ExpressionStatement
  | ArrayDestructuring
  | PositionalDestructuring
  | NamedDestructuring
  | ArrayDestructuringAssignment
  | PositionalDestructuringAssignment
  | NamedDestructuringAssignment;

export interface TryStatement {
  kind: "try-statement";
  binding: TryBinding;
  span: SourceSpan;
}

// ============================================================================
// Top-level
// ============================================================================

export type Statement =
  | ConstDeclaration
  | ReadonlyDeclaration
  | ImmutableBinding
  | LetDeclaration
  | YieldBlockAssignmentStatement
  | FunctionDeclaration
  | ClassDeclaration
  | InterfaceDeclaration
  | EnumDeclaration
  | TypeAliasDeclaration
  | MockImportDirective
  | ImportDeclaration
  | ExternClassDeclaration
  | ExternFunctionDeclaration
  | ExportDeclaration
  | ExportList
  | ExportAllDeclaration
  | IfStatement
  | WhileStatement
  | ForStatement
  | ForOfStatement
  | WithStatement
  | ReturnStatement
  | YieldStatement
  | BreakStatement
  | ContinueStatement
  | CaseStatement
  | TryStatement
  | ElseNarrowStatement
  | ExpressionStatement
  | ArrayDestructuring
  | PositionalDestructuring
  | NamedDestructuring
  | ArrayDestructuringAssignment
  | PositionalDestructuringAssignment
  | NamedDestructuringAssignment
  | Block;

export interface Program {
  kind: "program";
  statements: Statement[];
  span: SourceSpan;
}
