export interface EnumShorthandMemberExpression extends ASTNode {
  kind: 'enumShorthand';
  memberName: string;
  location: SourceLocation;
  _expectedEnumType?: EnumTypeNode;
}
// Core type definitions for the doof transpiler

// Forward declaration for ParseError - actual definition in parser.ts
export class ParseError extends Error {
  constructor(message: string, public location?: SourceLocation) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface Position {
  line: number;
  column: number;
}

export interface SourceLocation {
  start: Position;
  end: Position;
  filename?: string;
}

// Type system
export type PrimitiveType = 'int' | 'float' | 'double' | 'bool' | 'char' | 'string' | 'void' | 'null';


// Union type for all type nodes
export interface TypeParameter {
  name: string;
  location: SourceLocation;
}

export type Type =
  | PrimitiveTypeNode
  | ArrayTypeNode
  | MapTypeNode
  | SetTypeNode
  | ClassTypeNode
  | ExternClassTypeNode
  | EnumTypeNode
  | FunctionTypeNode
  | UnionTypeNode
  | TypeAliasNode
  | TypeParameterTypeNode
  | UnknownTypeNode
  | RangeTypeNode;

export interface PrimitiveTypeNode {
  kind: 'primitive';
  type: PrimitiveType;
}

export interface ArrayTypeNode {
  kind: 'array';
  elementType: Type;
}

export interface MapTypeNode {
  kind: 'map';
  keyType: Type;
  valueType: Type;
}

export interface SetTypeNode {
  kind: 'set';
  elementType: Type;
}

export interface ClassTypeNode {
  kind: 'class';
  name: string;
  isWeak?: boolean;
  wasNullable?: boolean; // Track if this type was originally nullable (T | null -> std::shared_ptr<T>)
  typeArguments?: Type[];
}

export interface ExternClassTypeNode {
  kind: 'externClass';
  name: string;
  isWeak?: boolean;
  wasNullable?: boolean; // Track if this type was originally nullable (T | null -> std::shared_ptr<T>)
  namespace?: string; // Namespace for qualified type generation
}


export interface EnumTypeNode {
  kind: 'enum';
  name: string;
}

export interface FunctionTypeNode {
  kind: 'function';
  parameters: { name: string; type: Type }[];
  returnType: Type;
  typeParameters?: TypeParameter[];
  isConciseForm?: boolean; // true when using concise parameter(type) syntax
  isPrintlnFunction?: boolean; // special type handling for println
}

// Note: Intrinsic types (previously used for Instant/Duration/fs) were removed
// in favor of representing such runtime-provided types as extern classes.

export interface UnionTypeNode {
  kind: 'union';
  types: Type[];
  // Track whether this union was originally a simple T | null for narrowing purposes
  originallyNullable?: boolean;
}

export interface TypeAliasNode {
  kind: 'typeAlias';
  name: string;
  isWeak?: boolean;
  typeArguments?: Type[];
}

export interface TypeParameterTypeNode {
  kind: 'typeParameter';
  name: string;
  location?: SourceLocation;
}

export interface UnknownTypeNode {
  kind: 'unknown';
}

export interface RangeTypeNode {
  kind: 'range';
  start: Type;
  end: Type;
  inclusive: boolean;
}

// AST Node base
export interface ASTNode {
  kind: string;
  location: SourceLocation;
  inferredType?: Type;
  trailingComment?: string;
}

// Expressions

// Union type for all expressions
export type Expression =
  | Literal
  | InterpolatedString
  | Identifier
  | BinaryExpression
  | UnaryExpression
  | ConditionalExpression
  | CallExpression
  | XmlCallExpression
  | MemberExpression
  | IndexExpression
  | ArrayExpression
  | ObjectExpression
  | PositionalObjectExpression
  | TupleExpression
  | SetExpression
  | LambdaExpression
  | TrailingLambdaExpression
  | TypeGuardExpression
  | EnumShorthandMemberExpression
  | RangeExpression
  | NullCoalesceExpression
  | OptionalChainExpression
  | NonNullAssertionExpression;

export interface CapturedBinding {
  name: string;
  declarationScopeId: string;
  variableKind: 'local' | 'parameter' | 'field' | 'global' | 'this';
  type: Type;
  sourceLocation: SourceLocation;
  declarationLocation?: SourceLocation;
  declaringClass?: string;
  writesInside: boolean;
  readsInside: boolean;
}

export interface CaptureInfo {
  capturedVariables: CapturedBinding[];
  hasMutableCaptures?: boolean;
  includesThis?: boolean;
}

export interface ScopeTrackerEntry {
  scopeId: string;
  name: string;
  kind: 'parameter' | 'local' | 'field' | 'method' | 'global' | 'import' | 'this';
  declarationScope: string;
  declarationLocation?: SourceLocation;
  type?: Type;
  isConstant: boolean;
  declaringClass?: string;
}

export interface Literal extends ASTNode {
  kind: 'literal';
  value: string | number | boolean | null;
  literalType: 'string' | 'char' | 'number' | 'boolean' | 'null';
  originalText?: string; // For number literals, preserve original format (e.g., "1.0" vs "1")
  isTemplate?: boolean; // true for template strings (backticks), false for regular double-quoted strings
}

export interface InterpolatedString extends ASTNode {
  kind: 'interpolated-string';
  parts: (string | Expression)[];
  isTemplate: boolean; // true for backtick strings, false for double-quoted
  tagIdentifier?: Identifier; // Present when this is a tagged template (e.g., html`...`)
}

export interface Identifier extends ASTNode {
  kind: 'identifier';
  name: string;
  // For member resolution in class methods
  resolvedMember?: {
    kind: 'field' | 'method';
    className: string;
    memberName: string;
  };
  // Enhanced resolution metadata for code generation
  scopeInfo?: {
    isParameter: boolean;
    isLocalVariable: boolean;
    isClassMember: boolean;
    isStaticMember: boolean;
    isGlobalFunction: boolean;
    isImported: boolean;
    needsThisPrefix: boolean; // For JS generator
    declaringClass?: string;
    scopeId?: string;
    declarationScope?: string;
    scopeKind?: ScopeTrackerEntry['kind'];
  };
}

export interface BinaryExpression extends ASTNode {
  kind: 'binary';
  operator: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends ASTNode {
  kind: 'unary';
  operator: string;
  operand: Expression;
}

export interface ConditionalExpression extends ASTNode {
  kind: 'conditional';
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export type CallDispatchInfo = {
  kind: 'function' | 'staticMethod' | 'instanceMethod' | 'lambda' | 'intrinsic' | 'constructor' | 'collectionMethod' | 'unionMethod';
  targetName?: string;
  className?: string;
  objectType?: Type;
  methodType?: 'map' | 'set' | 'array' | 'string' | 'class' | 'externClass';
  unionType?: UnionTypeNode;
};

export interface CallExpression extends ASTNode {
  kind: 'call';
  callee: Expression;
  arguments: Expression[];
  namedArguments?: ObjectProperty[]; // For named argument syntax: func { arg1: value1, arg2: value2 }
  typeArguments?: Type[]; // Explicit generic type arguments
  resolvedTypeArguments?: Type[]; // Type arguments after validation/alias resolution
  genericInstantiation?: {
    typeParameters: TypeParameter[];
    typeArguments: Type[];
  };
  // Intrinsic metadata added by validator
  intrinsicInfo?: {
    namespace: string;
    function: string;
    cppMapping: string;
    vmMapping: string; // VM external function name
    returnType: Type;
  };
  // Type conversion metadata added by validator
  typeConversionInfo?: {
    function: string;
    inputType: Type;
    returnType: Type;
    cppMapping: string;
    vmMapping: string;
    description: string;
  };
  // Enum conversion metadata added by validator
  enumConversionInfo?: {
    enumName: string;
    backingType: Type;
    inputType: Type;
    returnType: Type;
    cppMapping: string;
    vmMapping: string;
  };
  
  // Call dispatch information determined by validator
  callInfo?: CallDispatchInfo;
  // Snapshot of call dispatch info for resiliency when validators reset callInfo
  callInfoSnapshot?: CallDispatchInfo;
}

// XML-style call prior to normalization into a CallExpression
export interface XmlAttribute extends ASTNode {
  kind: 'xmlAttribute';
  name: Identifier;
  value?: Expression; // Absent only for future boolean shorthand (not supported yet)
  isLambdaShorthand?: boolean; // True when parsed from name=> expr form
}

export interface XmlCallExpression extends ASTNode {
  kind: 'xmlCall';
  callee: Identifier | MemberExpression; // Tag name or member path (obj.method)
  attributes: XmlAttribute[];
  children?: Expression[]; // After parsing: string literals, nested xmlCall, or expressions
  selfClosing: boolean;
  // During validation we may attach the synthesized CallExpression for downstream consumers
  normalizedCall?: CallExpression;
}

export interface MemberExpression extends ASTNode {
  kind: 'member';
  object: Expression;
  property: Identifier | Literal; // Support both regular identifiers and quoted string literals
  computed: boolean;
}

export interface IndexExpression extends ASTNode {
  kind: 'index';
  object: Expression;
  index: Expression;
}

export interface ArrayExpression extends ASTNode {
  kind: 'array';
  elements: Expression[];
  _expectedElementType?: Type;
}

export interface ObjectExpression extends ASTNode {
  kind: 'object';
  properties: ObjectProperty[];
  className?: string;
  typeArguments?: Type[];
  resolvedTypeArguments?: Type[];
  genericInstantiation?: {
    typeParameters: TypeParameter[];
    typeArguments: Type[];
  };
  _expectedEnumKeyType?: EnumTypeNode;
  // Enhanced metadata for code generation
  instantiationInfo?: {
    targetClass: string;
    fieldMappings: Array<{
      fieldName: string;
      type: Type;
      matchedProperty?: string;
      defaultValue?: Expression;
    }>;
    unmatchedProperties: string[]; // properties not matched to class fields
  };
}

export interface PositionalObjectExpression extends ASTNode {
  kind: 'positionalObject';
  className: string;
  arguments: Expression[];
  typeArguments?: Type[];
  resolvedTypeArguments?: Type[];
  genericInstantiation?: {
    typeParameters: TypeParameter[];
    typeArguments: Type[];
  };
}

export interface TupleExpression extends ASTNode {
  kind: 'tuple';
  elements: Expression[];
  _inferredTargetType?: Type; // Target type inferred from context
}

export interface SetExpression extends ASTNode {
  kind: 'set';
  elements: Expression[];
  _expectedEnumType?: EnumTypeNode;
}

export interface ObjectProperty extends ASTNode {
  kind: 'property';
  key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression;
  value?: Expression; // Optional for shorthand syntax
  shorthand?: boolean; // true when using shorthand like { x } instead of { x: x }
  trailingComment?: string;
}

export interface LambdaExpression extends ASTNode {
  kind: 'lambda';
  parameters: Parameter[];
  body: Expression | BlockStatement;
  returnType?: Type;
  isShortForm?: boolean;
  _expectedFunctionType?: Type; // Expected function type context for validation
  captureInfo?: CaptureInfo;
}

export interface TrailingLambdaExpression extends ASTNode {
  kind: 'trailingLambda';
  callee: Expression;
  arguments: Expression[];
  lambda: {
    body: Expression | BlockStatement;
    isBlock: boolean;
    parameters?: Parameter[]; // Inferred parameters from function signature
    _expectedFunctionType?: Type; // Expected function type for validation
    captureInfo?: CaptureInfo;
  };
}

export interface TypeGuardExpression extends ASTNode {
  kind: 'typeGuard';
  expression: Expression;
  type: Type;
}

export interface NullCoalesceExpression extends ASTNode {
  kind: 'nullCoalesce';
  left: Expression;
  right: Expression;
}

export interface OptionalChainExpression extends ASTNode {
  kind: 'optionalChain';
  object: Expression;
  property?: Identifier | Literal;
  computed: boolean;
  isMethodCall?: boolean; // true if this is a?.method() call
  isOptionalCall?: boolean; // true if this is a direct optional call like fn?.()
}

export interface NonNullAssertionExpression extends ASTNode {
  kind: 'nonNullAssertion';
  operand: Expression;
}

// Statements
export type Statement =
  | BlockStatement
  | ExpressionStatement
  | DestructuringVariableDeclaration
  | DestructuringAssignment
  | VariableDeclaration
  | FunctionDeclaration
  | ClassDeclaration
  | ExternClassDeclaration
  | InterfaceDeclaration
  | FieldDeclaration
  | MethodDeclaration
  | EnumDeclaration
  | TypeAliasDeclaration
  | IfStatement
  | WhileStatement
  | ForStatement
  | ForOfStatement
  | SwitchStatement
  | ReturnStatement
  | BreakStatement
  | ContinueStatement
  | ImportDeclaration
  | ExportDeclaration
  | BlankStatement
  | MarkdownHeader
  | MarkdownTable;

export interface BlockStatement extends ASTNode {
  kind: 'block';
  body: Statement[];
}

export interface ExpressionStatement extends ASTNode {
  kind: 'expression';
  expression: Expression;
}

export interface VariableDeclaration extends ASTNode {
  kind: 'variable';
  isConst: boolean;
  identifier: Identifier;
  type?: Type;
  initializer?: Expression;
  isConciseLambda?: boolean; // true when using concise name(params) => body syntax
  lambdaParameters?: Parameter[]; // parameters for concise lambda form
  isExport?: boolean;
}

// Destructuring patterns (MVP)
export type Pattern = ObjectPattern | TuplePattern;

export interface ObjectPattern extends ASTNode {
  kind: 'objectPattern';
  names: Identifier[]; // { x, y }
}

export interface TuplePattern extends ASTNode {
  kind: 'tuplePattern';
  names: Identifier[]; // (x, y)
}

export interface DestructuringVariableDeclaration extends ASTNode {
  kind: 'destructuringVariable';
  isConst: boolean;
  pattern: Pattern;
  type?: Type; // optional overall type (unused in MVP)
  initializer: Expression;
}

export interface DestructuringAssignment extends ASTNode {
  kind: 'destructuringAssign';
  pattern: Pattern;
  expression: Expression;
}

export interface FunctionDeclaration extends ASTNode {
  kind: 'function';
  name: Identifier;
  parameters: Parameter[];
  returnType: Type;
  body: BlockStatement;
  isExport?: boolean;
  typeParameters?: TypeParameter[];
}

export interface Parameter extends ASTNode {
  kind: 'parameter';
  name: Identifier;
  type: Type;
  defaultValue?: Expression;
  isConciseForm?: boolean; // true when using concise name(type) syntax
}

export interface ClassDeclaration extends ASTNode {
  kind: 'class';
  name: Identifier;
  fields: FieldDeclaration[];
  methods: MethodDeclaration[];
  nestedClasses?: ClassDeclaration[];
  constructor?: ConstructorDeclaration;
  isExport?: boolean;
  typeParameters?: TypeParameter[];
}

export interface InterfaceDeclaration extends ASTNode {
  kind: 'interface';
  name: Identifier;
  extends?: InterfaceTypeReference[];
  members: InterfaceMember[];
  isExport?: boolean;
}

export type InterfaceMember = InterfaceProperty | InterfaceMethod;

export interface InterfaceTypeReference {
  name: string;
  typeArguments?: Type[];
  location: SourceLocation;
}

export interface InterfaceProperty extends ASTNode {
  kind: 'interfaceProperty';
  name: Identifier;
  type: Type;
  optional: boolean;
  readonly: boolean;
}

export interface InterfaceMethod extends ASTNode {
  kind: 'interfaceMethod';
  name: Identifier;
  parameters: Parameter[];
  returnType: Type;
  optional: boolean;
}

export interface ConstructorDeclaration extends ASTNode {
  kind: 'constructor';
  parameters: Parameter[];
  body: BlockStatement;
  isPublic: boolean;
}

export interface ExternClassDeclaration extends ASTNode {
  kind: 'externClass';
  name: Identifier;
  fields: FieldDeclaration[];
  methods: MethodDeclaration[];
  header?: string; // Optional, defaults to "${name}.h"
  namespace?: string; // C++ namespace for the class
  isExport?: boolean;
}

export interface FieldDeclaration extends ASTNode {
  kind: 'field';
  name: Identifier;
  type: Type; // May be 'unknown' after parsing when const field uses inference
  defaultValue?: Expression;
  isPublic: boolean;
  isStatic: boolean;
  isConst: boolean;
  isReadonly: boolean;
  isConciseCallable?: boolean; // true when using concise name(type) syntax for callable fields
}

export interface MethodDeclaration extends ASTNode {
  kind: 'method';
  name: Identifier;
  parameters: Parameter[];
  returnType: Type;
  body: BlockStatement;
  isPublic: boolean;
  isStatic: boolean;
  isExtern?: boolean;
  usesFunctionKeyword?: boolean;
}


export interface EnumDeclaration extends ASTNode {
  kind: 'enum';
  name: Identifier;
  members: EnumMember[];
  isExport?: boolean;
}

export interface TypeAliasDeclaration extends ASTNode {
  kind: 'typeAlias';
  name: Identifier;
  type: Type;
  isExport?: boolean;
}

export interface EnumMember extends ASTNode {
  kind: 'enumMember';
  name: Identifier;
  value?: Literal;
}

export interface IfStatement extends ASTNode {
  kind: 'if';
  condition: Expression;
  thenStatement: Statement;
  elseStatement?: Statement;
}

export interface WhileStatement extends ASTNode {
  kind: 'while';
  condition: Expression;
  body: Statement;
}

export interface ForStatement extends ASTNode {
  kind: 'for';
  init?: VariableDeclaration | Expression;
  condition?: Expression;
  update?: Expression;
  body: Statement;
}

export interface ForOfStatement extends ASTNode {
  kind: 'forOf';
  variable: Identifier;
  iterable: Expression;
  body: Statement;
  isConst: boolean;
}

export interface SwitchStatement extends ASTNode {
  kind: 'switch';
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface SwitchCase extends ASTNode {
  kind: 'case';
  tests: (Expression | RangeExpression)[];
  body: Statement[];
  isDefault: boolean;
}

export interface RangeExpression extends ASTNode {
  kind: 'range';
  start: Expression;
  end: Expression;
  inclusive: boolean;
}

export interface ReturnStatement extends ASTNode {
  kind: 'return';
  argument?: Expression;
}




export interface BreakStatement extends ASTNode {
  kind: 'break';
}

export interface ContinueStatement extends ASTNode {
  kind: 'continue';
}

export interface BlankStatement extends ASTNode {
  kind: 'blank';
  trailingComment?: string;
}

export interface MarkdownHeader extends ASTNode {
  kind: 'markdownHeader';
  level: number;
  text: string;
}

export type TableColumn =
  | BooleanConditionColumn
  | ComparisonConditionColumn
  | ActionConclusionColumn
  | DeclarationConclusionColumn;

export interface TableColumnBase extends ASTNode {
  headerText: string;
}

export interface BooleanConditionColumn extends TableColumnBase {
  kind: 'conditionBoolean';
}

export interface ComparisonConditionColumn extends TableColumnBase {
  kind: 'conditionComparison';
  discriminant: Expression;
}

export interface ActionConclusionColumn extends TableColumnBase {
  kind: 'conclusionAction';
}

export interface DeclarationConclusionColumn extends TableColumnBase {
  kind: 'conclusionDeclaration';
  target: Identifier;
}

export type TableCellContent =
  | Expression
  | RangeExpression
  | Statement[]
  | null;

export interface TableRowCell {
  rawText: string;
  location: SourceLocation;
  entries?: Array<Expression | RangeExpression>;
  content?: TableCellContent;
}

export interface TableRow {
  cells: TableRowCell[];
  location: SourceLocation;
}

export interface MarkdownTable extends ASTNode {
  kind: 'markdownTable';
  headers: string[];
  rows: string[][];
  columns: TableColumn[];
  structuredRows: TableRow[];
  alignments?: Array<'left' | 'center' | 'right'>;
}

export interface ImportDeclaration extends ASTNode {
  kind: 'import';
  specifiers: ImportSpecifier[];
  source: Literal;
}

export interface ImportSpecifier extends ASTNode {
  kind: 'importSpecifier';
  imported: Identifier;
  local?: Identifier;
}

export interface ExportDeclaration extends ASTNode {
  kind: 'export';
  declaration: Statement;
}

// Program root
export interface Program extends ASTNode {
  kind: 'program';
  body: Statement[];
  filename?: string;
  moduleName?: string;
  errors?: ParseError[];
  callDispatch?: Map<string, CallDispatchInfo>;
}

// Validation context for type checking
export interface ValidationContext {
  symbols: Map<string, Type>;
  globalSymbols: Map<string, ExportedSymbol>;
  imports: Map<string, ImportInfo>;
  classes: Map<string, ClassDeclaration>;
  externClasses: Map<string, ExternClassDeclaration>;
  interfaces: Map<string, InterfaceDeclaration>;
  enums: Map<string, EnumDeclaration>;
  functions: Map<string, FunctionDeclaration>;
  typeAliases: Map<string, TypeAliasDeclaration>;
  // Consolidated type symbol table for all type declarations
  typeSymbols: TypeSymbolTable;
  currentClass?: ClassDeclaration;
  currentFunction?: FunctionDeclaration;
  currentMethod?: MethodDeclaration;
  currentModule?: string;
  globalContext?: GlobalValidationContext;
  inLoop?: boolean;
  inSwitch?: boolean;
  errors: ValidationError[];
  // Property access paths narrowed within the current scope (e.g. "foo.bar")
  propertyNarrowings: Map<string, Type>;
  // Enhanced metadata for code generation
  codeGenHints: {
    builtinFunctions: Map<string, { jsMapping: string; returnType: Type }>;
    objectInstantiations: Map<string, ObjectExpression['instantiationInfo']>;
    typeGuards: Map<string, { jsCondition: string; originalType: Type; targetType: Type }>;
    typeNarrowing: Map<string, { variableName: string; narrowedType: Type; originalType: Type; branchType: 'then' | 'else' }>;
    scopeTracker: Map<string, ScopeTrackerEntry>;
  // Types that require JSON "to" helpers because they are printed via println
    jsonPrintTypes: Set<string>;
  // Types that require JSON "from" helpers because fromJSON is called on them
    jsonFromTypes: Set<string>;
  // Type conversion functions used (requires runtime support)
    includeTypeConversions: boolean;
  // Enum to string functions needed
    enumToStringFunctions: Set<string>;
  // Enum validation functions needed  
    enumValidationFunctions: Set<string>;
  // Call dispatch metadata keyed by expression id
  callDispatch: Map<string, CallDispatchInfo>;
  // Extern class dependencies needing runtime linkage/imports
  externDependencies: Set<string>;
  // Scope ids for locals captured mutably by lambdas
  capturedMutableScopes: Set<string>;
  };
}

// Global validation context for multi-file projects
export interface GlobalValidationContext {
  files: Map<string, Program>; // filename -> AST
  moduleMap: Map<string, string>; // filename -> module name
  exportedSymbols: Map<string, ExportedSymbol>; // fully qualified name -> symbol info
  errors: ValidationError[];
  validationContexts?: Map<string, ValidationContext>;
}

export interface ExportedSymbol {
  name: string;
  fullyQualifiedName: string;
  type: 'function' | 'class' | 'enum' | 'variable' | 'typeAlias';
  signature: Type;
  sourceModule: string;
}

export interface ImportInfo {
  localName: string;
  importedName: string;
  sourceModule: string;
  sourceFile: string;
  fullyQualifiedName: string;
}

export interface ValidationError {
  message: string;
  location?: SourceLocation;
}

// Type symbol table for consolidated type declaration lookup
export type TypeDeclaration =
  | ClassDeclaration
  | EnumDeclaration
  | ExternClassDeclaration
  | InterfaceDeclaration;

export class TypeSymbolTable {
  private symbols: Map<string, TypeDeclaration>;

  constructor(
    interfaces: Map<string, InterfaceDeclaration>,
    classes: Map<string, ClassDeclaration>,
    enums: Map<string, EnumDeclaration>,
    externClasses: Map<string, ExternClassDeclaration>,
    onDuplicateError?: (name: string, existing: TypeDeclaration, duplicate: TypeDeclaration) => void
  ) {
    this.symbols = new Map();
    
    // Helper to add declarations with duplicate checking
    const addDeclarations = (map: Map<string, TypeDeclaration>) => {
      map.forEach((decl, name) => {
        const existing = this.symbols.get(name);
        if (existing) {
          onDuplicateError?.(name, existing, decl);
        } else {
          this.symbols.set(name, decl);
        }
      });
    };

    // Add all type declarations
    addDeclarations(interfaces as unknown as Map<string, TypeDeclaration>);
    addDeclarations(classes);
    addDeclarations(enums);
    addDeclarations(externClasses);
  // addDeclarations(exceptions); // Removed
  }

  get(name: string): TypeDeclaration | undefined {
    return this.symbols.get(name);
  }

  has(name: string): boolean {
    return this.symbols.has(name);
  }

  keys(): IterableIterator<string> {
    return this.symbols.keys();
  }

  values(): IterableIterator<TypeDeclaration> {
    return this.symbols.values();
  }

  entries(): IterableIterator<[string, TypeDeclaration]> {
    return this.symbols.entries();
  }
}
