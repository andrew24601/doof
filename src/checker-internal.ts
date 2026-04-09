import type { AnalysisResult } from "./analyzer.js";
import type {
  Block,
  CaseArm,
  CatchExpression,
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  SourceSpan,
  Statement,
  TryBinding,
  TypeAnnotation,
} from "./ast.js";
import type {
  Binding,
  EnumType,
  FunctionResolvedParam,
  ModuleTypeInfo,
  ResolvedType,
  ResultResolvedType,
  Scope,
} from "./checker-types.js";
import type { EnumDeclaration } from "./ast.js";
import type { ClassSymbol, EnumSymbol, ModuleSymbol, ModuleSymbolTable } from "./types.js";

export const BUILTIN_SPAN: SourceSpan = {
  start: { line: 0, column: 0, offset: 0 },
  end: { line: 0, column: 0, offset: 0 },
};

const BUILTIN_PARSE_ERROR_DECL: EnumDeclaration = {
  kind: "enum-declaration",
  name: "ParseError",
  exported: false,
  span: BUILTIN_SPAN,
  variants: [
    { kind: "enum-variant", name: "InvalidFormat", description: undefined, value: null, span: BUILTIN_SPAN },
    { kind: "enum-variant", name: "Overflow", description: undefined, value: null, span: BUILTIN_SPAN },
    { kind: "enum-variant", name: "Underflow", description: undefined, value: null, span: BUILTIN_SPAN },
    { kind: "enum-variant", name: "EmptyInput", description: undefined, value: null, span: BUILTIN_SPAN },
  ],
};

const BUILTIN_PARSE_ERROR_SYMBOL: EnumSymbol = {
  symbolKind: "enum",
  name: "ParseError",
  declaration: BUILTIN_PARSE_ERROR_DECL,
  exported: false,
  module: "<builtin>",
};

export const BUILTIN_PARSE_ERROR_TYPE: EnumType = {
  kind: "enum",
  symbol: BUILTIN_PARSE_ERROR_SYMBOL,
};

export const NUMERIC_PRIMITIVE_NAMES = new Set(["byte", "int", "long", "float", "double"]);
export const STRING_CONVERTIBLE_PRIMITIVE_NAMES = new Set(["byte", "int", "long", "float", "double", "string", "char", "bool"]);

export interface CheckerHost {
  readonly analysisResult: AnalysisResult;
  readonly catchErrorTypes: ResolvedType[][];
  readonly typeParamStack: Set<string>[];
  checkBlock(block: Block, parentScope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkCatchExpression(expr: CatchExpression, scope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): ResolvedType;
  checkClass(decl: ClassDeclaration, parentScope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkConditionIsBool(condType: ResolvedType, expr: Expression, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkFunction(decl: FunctionDeclaration, parentScope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkMethod(
    method: FunctionDeclaration,
    classDecl: ClassDeclaration,
    thisType: ResolvedType,
    parentScope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void;
  checkStatement(stmt: Statement, scope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkStatements(stmts: Statement[], scope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo): void;
  checkTryStatement(binding: TryBinding, scope: Scope, table: ModuleSymbolTable, info: ModuleTypeInfo, span: SourceSpan): void;
  blockAlwaysExits(block: Block): boolean;
  blockAlwaysYields(block: Block): boolean;
  extractNullNarrowing(
    condition: Expression,
    scope: Scope,
  ): { name: string; narrowedType: ResolvedType; operator: "==" | "!="; binding: Binding } | null;
  findReturnType(scope: Scope): ResolvedType | null;
  findThisType(scope: Scope): ResolvedType | null;
  getPositionalFieldTypes(type: ResolvedType, table: ModuleSymbolTable): ResolvedType[];
  getTryBindingValue(binding: TryBinding): Expression | null;
  inferExprType(
    expr: Expression,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
    expectedType?: ResolvedType,
  ): ResolvedType;
  inferTypeArgs(
    typeParams: string[],
    params: { name: string; type: ResolvedType }[],
    argTypes: ResolvedType[],
  ): Map<string, ResolvedType>;
  lookupBinding(name: string, scope: Scope): Binding | null;
  lookupFieldType(objectType: ResolvedType, fieldName: string, table: ModuleSymbolTable): ResolvedType;
  pushScope(parent: Scope, kind: Scope["kind"], returnType?: ResolvedType | null): Scope;
  resolveGenericTypeArgs(
    declTypeParams: string[],
    typeArgs: TypeAnnotation[] | undefined,
    table: ModuleSymbolTable,
  ): ResolvedType[] | undefined;
  resolveTypeAnnotation(ann: TypeAnnotation, table: ModuleSymbolTable): ResolvedType;
  retypeTryBinding(binding: TryBinding, successType: ResolvedType, scope: Scope, table: ModuleSymbolTable): void;
  symbolToType(sym: ModuleSymbol, table: ModuleSymbolTable, typeArgs?: TypeAnnotation[]): ResolvedType;
}

export interface ConstructorParam {
  name: string;
  type: ResolvedType;
  hasDefault: boolean;
}

export interface BuiltinFunctionSpec {
  name: string;
  params: FunctionResolvedParam[];
  returnType: ResolvedType;
}

export type NullNarrowing = ReturnType<CheckerHost["extractNullNarrowing"]>;
export type ResultArmScopeBuilder = (
  arm: CaseArm,
  subjectType: ResultResolvedType,
  parentScope: Scope,
) => Scope;

export type ClassLikeType = Extract<ResolvedType, { kind: "class" }>;
export type KnownClassSymbol = ClassSymbol;