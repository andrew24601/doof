import type {
  Block,
  CallExpression,
  CallArgument,
  ConstructExpression,
  Expression,
  FunctionDeclaration,
  ObjectLiteral,
  ObjectProperty,
  SourceSpan,
  Statement,
  TypeAnnotation,
  TupleLiteral,
} from "./ast.js";
import {
  BOOL_TYPE,
  CHAR_TYPE,
  DOUBLE_TYPE,
  FLOAT_TYPE,
  findSharedDiscriminator,
  formatUnsupportedHashCollectionConstraintMessage,
  INT_TYPE,
  isAssignableTo,
  isJsonValueType,
  isSupportedHashCollectionElementType,
  isSupportedMapKeyType,
  JSON_VALUE_TYPE,
  LONG_TYPE,
  normalizeTypeForRuntime,
  NULL_TYPE,
  STRING_TYPE,
  substituteTypeParams,
  type Binding,
  type FunctionResolvedParam,
  type ModuleTypeInfo,
  type ResolvedType,
  type Scope,
  typeToString,
  typesEqual,
  UNKNOWN_TYPE,
  VOID_TYPE,
} from "./checker-types.js";
import {
  NUMERIC_PRIMITIVE_NAMES,
  STRING_CONVERTIBLE_PRIMITIVE_NAMES,
  type CheckerHost,
  type ConstructorParam,
} from "./checker-internal.js";
import { inferBinaryType, inferUnaryType, resolveExpectedEnumType } from "./checker-expr-ops.js";
import { inferMemberType } from "./checker-member.js";
import { buildCaseArmScope } from "./checker-result.js";
import type { ClassSymbol, ModuleSymbolTable } from "./types.js";

function resolveExpectedResultContext(
  host: CheckerHost,
  scope: Scope,
  expectedType?: ResolvedType,
): Extract<ResolvedType, { kind: "result" }> | null {
  if (expectedType?.kind === "result") return expectedType;
  const fnReturn = host.findReturnType(scope);
  return fnReturn?.kind === "result" ? fnReturn : null;
}

function reportMissingResultContext(
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
  ctorName: "Success" | "Failure",
): void {
  info.diagnostics.push({
    severity: "error",
    message: `${ctorName} requires contextual Result type; add an explicit Result<T, E> annotation`,
    span,
    module: table.path,
  });
}

function isVoidResultType(resultType: Extract<ResolvedType, { kind: "result" }>): boolean {
  return resultType.successType.kind === "void";
}

function inferObjectLiteralProperties(
  host: CheckerHost,
  expr: ObjectLiteral,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  getExpectedType?: (propName: string) => ResolvedType | undefined,
): void {
  for (const prop of expr.properties) {
    if (prop.value) {
      inferExprType(host, prop.value, scope, table, info, getExpectedType?.(prop.name));
      continue;
    }

    const binding = host.lookupBinding(prop.name, scope);
    if (binding) {
      (prop as { _shorthandResolvedType?: ResolvedType })._shorthandResolvedType = binding.type;
      continue;
    }

    info.diagnostics.push({
      severity: "error",
      message: `Undefined identifier "${prop.name}"`,
      span: prop.span,
      module: table.path,
    });
  }
}

function getObjectPropertyResolvedType(prop: ObjectProperty): ResolvedType {
  return prop.value?.resolvedType ?? (prop as { _shorthandResolvedType?: ResolvedType })._shorthandResolvedType ?? UNKNOWN_TYPE;
}

function inferResultObjectLiteral(
  host: CheckerHost,
  expr: ObjectLiteral,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  resultType: Extract<ResolvedType, { kind: "result" }>,
): ResolvedType {
  inferObjectLiteralProperties(host, expr, scope, table, info, (propName) => {
    if (propName === "value" && !isVoidResultType(resultType)) return resultType.successType;
    if (propName === "error") return resultType.errorType;
    return undefined;
  });

  const valueProp = expr.properties.find((prop) => prop.name === "value");
  const errorProp = expr.properties.find((prop) => prop.name === "error");
  const recognizedPropCount = expr.properties.filter((prop) => prop.name === "value" || prop.name === "error").length;

  if (valueProp && errorProp) {
    info.diagnostics.push({
      severity: "error",
      message: 'Result object literal must contain either a "value" field or an "error" field, but not both',
      span: expr.span,
      module: table.path,
    });
    return UNKNOWN_TYPE;
  }

  if (!valueProp && !errorProp) {
    if (expr.properties.length === 0 && isVoidResultType(resultType)) {
      return resultType;
    }
    info.diagnostics.push({
      severity: "error",
      message: 'Result object literal must contain a "value" field or an "error" field',
      span: expr.span,
      module: table.path,
    });
    return UNKNOWN_TYPE;
  }

  if (recognizedPropCount !== expr.properties.length) {
    info.diagnostics.push({
      severity: "error",
      message: 'Result object literal only supports "value" and "error" fields',
      span: expr.span,
      module: table.path,
    });
    return UNKNOWN_TYPE;
  }

  if (valueProp) {
    if (isVoidResultType(resultType)) {
      info.diagnostics.push({
        severity: "error",
        message: 'Result<void, E> object literal must not specify a "value" field',
        span: valueProp.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }
    const valueType = getObjectPropertyResolvedType(valueProp);
    if (!isAssignableTo(valueType, resultType.successType)) {
      info.diagnostics.push({
        severity: "error",
        message: `Field "value": type "${typeToString(valueType)}" is not assignable to type "${typeToString(resultType.successType)}"`,
        span: valueProp.span,
        module: table.path,
      });
    }
    return resultType;
  }

  const errorType = getObjectPropertyResolvedType(errorProp!);
  if (!isAssignableTo(errorType, resultType.errorType)) {
    info.diagnostics.push({
      severity: "error",
      message: `Field "error": type "${typeToString(errorType)}" is not assignable to type "${typeToString(resultType.errorType)}"`,
      span: errorProp!.span,
      module: table.path,
    });
  }
  return resultType;
}

function isStringConvertibleType(type: ResolvedType): boolean {
  switch (type.kind) {
    case "primitive":
      return STRING_CONVERTIBLE_PRIMITIVE_NAMES.has(type.name);
    case "null":
      return true;
    case "union":
      return type.types.every(isStringConvertibleType);
    default:
      return false;
  }
}

function isUnshadowedResultCtorCall(
  calleeName: string,
  calleeBinding: Binding | null,
): calleeName is "Success" | "Failure" {
  return (calleeName === "Success" || calleeName === "Failure")
    && (!calleeBinding || calleeBinding.kind === "builtin");
}

function isUnshadowedResultCtorConstruct(
  expr: ConstructExpression,
  table: ModuleSymbolTable,
): expr is ConstructExpression & { type: "Success" | "Failure"; named: true } {
  if (!expr.named || (expr.type !== "Success" && expr.type !== "Failure")) {
    return false;
  }
  return table.symbols.get(expr.type)?.symbolKind !== "class";
}

interface ResolvedCallArgumentInfo {
  span: SourceSpan;
  type: ResolvedType;
}

interface NamedCallInput {
  name: string;
  span: SourceSpan;
  inferType: (expectedType?: ResolvedType) => ResolvedType;
}

function getResolvedGenericTypeArgs(
  typeParams: string[],
  paramMap: Map<string, ResolvedType>,
): ResolvedType[] {
  return typeParams.map((typeParam) => paramMap.get(typeParam) ?? UNKNOWN_TYPE);
}

function resolveDeclarationTypeParamConstraints(
  host: CheckerHost,
  typeParams: string[],
  typeParamConstraints: (TypeAnnotation | null)[] | undefined,
  table: ModuleSymbolTable,
): (ResolvedType | null)[] | undefined {
  if (!typeParamConstraints || typeParamConstraints.length === 0 || typeParams.length === 0) {
    return undefined;
  }

  host.typeParamStack.push(new Set(typeParams));
  const resolved = typeParams.map((_, index) => {
    const constraint = typeParamConstraints[index] ?? null;
    return constraint ? host.resolveTypeAnnotation(constraint, table) : null;
  });
  host.typeParamStack.pop();

  return resolved.some((constraint) => constraint !== null) ? resolved : undefined;
}

function reportTypeArgumentConstraintViolation(
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
  typeParam: string,
  argType: ResolvedType,
  constraint: ResolvedType,
): void {
  info.diagnostics.push({
    severity: "error",
    message: `Type "${typeToString(argType)}" does not satisfy constraint "${typeToString(constraint)}" for type parameter "${typeParam}"`,
    span,
    module: table.path,
  });
}

function validateResolvedTypeArgsAgainstConstraints(
  typeParams: string[],
  typeParamConstraints: (ResolvedType | null)[] | undefined,
  resolvedTypeArgs: ResolvedType[] | undefined,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  span: SourceSpan,
): ResolvedType[] | undefined {
  if (!resolvedTypeArgs || !typeParamConstraints) return resolvedTypeArgs;

  return resolvedTypeArgs.map((argType, index) => {
    const constraint = typeParamConstraints[index] ?? null;
    if (!constraint || argType.kind === "unknown" || isAssignableTo(argType, constraint)) {
      return argType;
    }
    reportTypeArgumentConstraintViolation(info, table, span, typeParams[index] ?? "T", argType, constraint);
    return UNKNOWN_TYPE;
  });
}

function validateInferredTypeArgsAgainstConstraints(
  typeParams: string[],
  typeParamConstraints: (ResolvedType | null)[] | undefined,
  paramMap: Map<string, ResolvedType>,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  span: SourceSpan,
): void {
  if (!typeParamConstraints) return;

  for (let index = 0; index < typeParams.length; index++) {
    const constraint = typeParamConstraints[index] ?? null;
    if (!constraint) continue;
    const typeParam = typeParams[index];
    const argType = paramMap.get(typeParam);
    if (!argType || argType.kind === "unknown" || isAssignableTo(argType, constraint)) continue;
    reportTypeArgumentConstraintViolation(info, table, span, typeParam, argType, constraint);
    paramMap.set(typeParam, UNKNOWN_TYPE);
  }
}

function buildResolvedGenericClassType(
  calleeType: Extract<ResolvedType, { kind: "class" }>,
  paramMap: Map<string, ResolvedType>,
): Extract<ResolvedType, { kind: "class" }> {
  if (calleeType.typeArgs && calleeType.typeArgs.length > 0) {
    return calleeType;
  }

  const typeParams = calleeType.symbol.declaration.typeParams;
  if (typeParams.length === 0) {
    return calleeType;
  }

  const resolvedTypeArgs = getResolvedGenericTypeArgs(typeParams, paramMap);
  if (resolvedTypeArgs.every((typeArg) => typeArg.kind === "unknown")) {
    return calleeType;
  }

  return {
    kind: "class",
    symbol: calleeType.symbol,
    typeArgs: resolvedTypeArgs,
  };
}

function recordResolvedGenericCall(
  expr: CallExpression,
  calleeType: Extract<ResolvedType, { kind: "function" }>,
  paramMap: Map<string, ResolvedType>,
): void {
  expr.resolvedGenericTypeArgs = getResolvedGenericTypeArgs(calleeType.typeParams ?? [], paramMap);
  if (expr.callee.kind === "identifier" && expr.callee.resolvedBinding) {
    expr.resolvedGenericBinding = expr.callee.resolvedBinding;
    return;
  }

  if (expr.callee.kind === "member-expression" || expr.callee.kind === "qualified-member-expression") {
    const objectType = expr.callee.object.resolvedType;
    if (objectType?.kind === "class") {
      expr.resolvedGenericOwnerClass = objectType.symbol;
      expr.resolvedGenericMethodName = expr.callee.property;
      expr.resolvedGenericMethodStatic = expr.callee.kind === "qualified-member-expression";
    }
  }
}

function isResolvedTypeParamBinding(
  binding: ResolvedType | undefined,
  typeParamName: string,
): boolean {
  return !!binding && !(binding.kind === "typevar" && binding.name === typeParamName);
}

function applyResultMethodGenericDefaults(
  callExpr: CallExpression,
  calleeType: Extract<ResolvedType, { kind: "function" }>,
  paramMap: Map<string, ResolvedType>,
): void {
  if (callExpr.callee.kind !== "member-expression") return;

  const objectType = callExpr.callee.object.resolvedType;
  const typeParams = calleeType.typeParams ?? [];
  if (objectType?.kind !== "result" || typeParams.length === 0) return;

  if (callExpr.callee.property === "andThen" && typeParams.length >= 2) {
    const errorTypeParam = typeParams[1];
    if (!isResolvedTypeParamBinding(paramMap.get(errorTypeParam), errorTypeParam)) {
      paramMap.set(errorTypeParam, objectType.errorType);
    }
    return;
  }

  if (callExpr.callee.property === "orElse" && typeParams.length >= 2) {
    const successTypeParam = typeParams[0];
    const errorTypeParam = typeParams[1];
    if (!isResolvedTypeParamBinding(paramMap.get(successTypeParam), successTypeParam)) {
      paramMap.set(successTypeParam, objectType.successType);
    }
    if (!isResolvedTypeParamBinding(paramMap.get(errorTypeParam), errorTypeParam)) {
      paramMap.set(errorTypeParam, objectType.errorType);
    }
  }
}

function applyTypeSubstitutionToExpression(
  expr: Expression,
  paramMap: Map<string, ResolvedType>,
): void {
  if (expr.resolvedType) {
    expr.resolvedType = substituteTypeParams(expr.resolvedType, paramMap);
  }

  switch (expr.kind) {
    case "binary-expression":
      applyTypeSubstitutionToExpression(expr.left, paramMap);
      applyTypeSubstitutionToExpression(expr.right, paramMap);
      return;
    case "unary-expression":
      applyTypeSubstitutionToExpression(expr.operand, paramMap);
      return;
    case "assignment-expression":
      applyTypeSubstitutionToExpression(expr.target, paramMap);
      applyTypeSubstitutionToExpression(expr.value, paramMap);
      return;
    case "member-expression":
    case "qualified-member-expression":
      applyTypeSubstitutionToExpression(expr.object, paramMap);
      return;
    case "index-expression":
      applyTypeSubstitutionToExpression(expr.object, paramMap);
      applyTypeSubstitutionToExpression(expr.index, paramMap);
      return;
    case "call-expression":
      if (expr.resolvedGenericTypeArgs) {
        expr.resolvedGenericTypeArgs = expr.resolvedGenericTypeArgs.map((typeArg) =>
          substituteTypeParams(typeArg, paramMap)
        );
      }
      applyTypeSubstitutionToExpression(expr.callee, paramMap);
      for (const arg of expr.args) {
        applyTypeSubstitutionToExpression(arg.value, paramMap);
      }
      return;
    case "array-literal":
      for (const element of expr.elements) {
        applyTypeSubstitutionToExpression(element, paramMap);
      }
      return;
    case "tuple-literal":
      for (const element of expr.elements) {
        applyTypeSubstitutionToExpression(element, paramMap);
      }
      return;
    case "object-literal":
      for (const prop of expr.properties) {
        if (prop.value) {
          applyTypeSubstitutionToExpression(prop.value, paramMap);
        }
      }
      return;
    case "map-literal":
      for (const entry of expr.entries) {
        applyTypeSubstitutionToExpression(entry.key, paramMap);
        applyTypeSubstitutionToExpression(entry.value, paramMap);
      }
      return;
    case "lambda-expression":
      for (const param of expr.params) {
        if (param.resolvedType) {
          param.resolvedType = substituteTypeParams(param.resolvedType, paramMap);
        }
        if (param.defaultValue) {
          applyTypeSubstitutionToExpression(param.defaultValue, paramMap);
        }
      }
      if (expr.body.kind === "block") {
        applyTypeSubstitutionToBlock(expr.body, paramMap);
      } else {
        applyTypeSubstitutionToExpression(expr.body, paramMap);
      }
      return;
    case "if-expression":
      applyTypeSubstitutionToExpression(expr.condition, paramMap);
      applyTypeSubstitutionToExpression(expr.then, paramMap);
      applyTypeSubstitutionToExpression(expr.else_, paramMap);
      return;
    case "case-expression":
      applyTypeSubstitutionToExpression(expr.subject, paramMap);
      for (const arm of expr.arms) {
        if (arm.body.kind === "block") {
          applyTypeSubstitutionToBlock(arm.body, paramMap);
        } else {
          applyTypeSubstitutionToExpression(arm.body, paramMap);
        }
      }
      return;
    case "construct-expression":
      if (expr.named) {
        for (const prop of expr.args as import("./ast.js").ObjectProperty[]) {
          if (prop.value) {
            applyTypeSubstitutionToExpression(prop.value, paramMap);
          }
        }
        return;
      }
      for (const arg of expr.args as Expression[]) {
        applyTypeSubstitutionToExpression(arg, paramMap);
      }
      return;
    case "string-literal":
      for (const part of expr.parts) {
        if (typeof part !== "string") {
          applyTypeSubstitutionToExpression(part, paramMap);
        }
      }
      return;
    case "async-expression":
      if (expr.expression.kind === "block") {
        applyTypeSubstitutionToBlock(expr.expression, paramMap);
      } else {
        applyTypeSubstitutionToExpression(expr.expression, paramMap);
      }
      return;
    case "actor-creation-expression":
      for (const arg of expr.args) {
        applyTypeSubstitutionToExpression(arg, paramMap);
      }
      return;
    case "catch-expression":
      for (const stmt of expr.body) {
        applyTypeSubstitutionToStatement(stmt, paramMap);
      }
      return;
    case "non-null-assertion":
    case "as-expression":
      applyTypeSubstitutionToExpression(expr.expression, paramMap);
      return;
    default:
      return;
  }
}

function applyTypeSubstitutionToStatement(
  stmt: Statement,
  paramMap: Map<string, ResolvedType>,
): void {
  switch (stmt.kind) {
    case "const-declaration":
    case "readonly-declaration":
    case "immutable-binding":
    case "let-declaration":
      if (stmt.resolvedType) {
        stmt.resolvedType = substituteTypeParams(stmt.resolvedType, paramMap);
      }
      applyTypeSubstitutionToExpression(stmt.value, paramMap);
      return;
    case "expression-statement":
      applyTypeSubstitutionToExpression(stmt.expression, paramMap);
      return;
    case "return-statement":
      if (stmt.value) {
        applyTypeSubstitutionToExpression(stmt.value, paramMap);
      }
      return;
    case "if-statement":
      applyTypeSubstitutionToExpression(stmt.condition, paramMap);
      applyTypeSubstitutionToBlock(stmt.body, paramMap);
      for (const elseIf of stmt.elseIfs) {
        applyTypeSubstitutionToExpression(elseIf.condition, paramMap);
        applyTypeSubstitutionToBlock(elseIf.body, paramMap);
      }
      if (stmt.else_) {
        applyTypeSubstitutionToBlock(stmt.else_, paramMap);
      }
      return;
    case "case-statement":
      applyTypeSubstitutionToExpression(stmt.subject, paramMap);
      for (const arm of stmt.arms) {
        if (arm.body.kind === "block") {
          applyTypeSubstitutionToBlock(arm.body, paramMap);
        } else {
          applyTypeSubstitutionToExpression(arm.body, paramMap);
        }
      }
      return;
    case "while-statement":
      applyTypeSubstitutionToExpression(stmt.condition, paramMap);
      applyTypeSubstitutionToBlock(stmt.body, paramMap);
      if (stmt.then_) {
        applyTypeSubstitutionToBlock(stmt.then_, paramMap);
      }
      return;
    case "for-statement":
      if (stmt.init) {
        applyTypeSubstitutionToStatement(stmt.init, paramMap);
      }
      if (stmt.condition) {
        applyTypeSubstitutionToExpression(stmt.condition, paramMap);
      }
      for (const update of stmt.update) {
        applyTypeSubstitutionToExpression(update, paramMap);
      }
      applyTypeSubstitutionToBlock(stmt.body, paramMap);
      if (stmt.then_) {
        applyTypeSubstitutionToBlock(stmt.then_, paramMap);
      }
      return;
    case "for-of-statement":
      applyTypeSubstitutionToExpression(stmt.iterable, paramMap);
      applyTypeSubstitutionToBlock(stmt.body, paramMap);
      if (stmt.then_) {
        applyTypeSubstitutionToBlock(stmt.then_, paramMap);
      }
      return;
    case "with-statement":
      for (const binding of stmt.bindings) {
        if (binding.resolvedType) {
          binding.resolvedType = substituteTypeParams(binding.resolvedType, paramMap);
        }
        applyTypeSubstitutionToExpression(binding.value, paramMap);
      }
      applyTypeSubstitutionToBlock(stmt.body, paramMap);
      return;
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      applyTypeSubstitutionToExpression(stmt.value, paramMap);
      return;
    case "try-statement":
      applyTypeSubstitutionToStatement(stmt.binding, paramMap);
      return;
    case "block":
      applyTypeSubstitutionToBlock(stmt, paramMap);
      return;
    case "function-declaration":
    case "class-declaration":
    case "import-declaration":
    case "mock-import-directive":
    case "extern-class-declaration":
    case "extern-function-declaration":
    case "export-list":
    case "export-all-declaration":
    case "break-statement":
    case "continue-statement":
    case "else-narrow-statement":
    case "interface-declaration":
    case "enum-declaration":
    case "type-alias-declaration":
    case "export-declaration":
      return;
  }
}

function applyTypeSubstitutionToBlock(
  block: Block,
  paramMap: Map<string, ResolvedType>,
): void {
  for (const stmt of block.statements) {
    applyTypeSubstitutionToStatement(stmt, paramMap);
  }
}

function validatePositionalFunctionArgs(
  params: FunctionResolvedParam[],
  argTypes: ResolvedType[],
  argSpans: SourceSpan[],
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  callSpan: SourceSpan,
): void {
  const requiredCount = params.filter((param) => !param.hasDefault).length;
  const totalCount = params.length;

  if (argTypes.length < requiredCount || argTypes.length > totalCount) {
    const range = requiredCount === totalCount ? `${totalCount}` : `${requiredCount}-${totalCount}`;
    info.diagnostics.push({
      severity: "error",
      message: `Expected ${range} argument(s) but got ${argTypes.length}`,
      span: callSpan,
      module: table.path,
    });
  }

  for (let i = 0; i < Math.min(argTypes.length, params.length); i++) {
    if (!isAssignableTo(argTypes[i], params[i].type)) {
      info.diagnostics.push({
        severity: "error",
        message: `Argument of type "${typeToString(argTypes[i])}" is not assignable to parameter "${params[i].name}" of type "${typeToString(params[i].type)}"`,
        span: argSpans[i] ?? callSpan,
        module: table.path,
      });
    }
  }
}

function resolveNamedFunctionArgs(
  params: FunctionResolvedParam[],
  args: NamedCallInput[],
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  callSpan: SourceSpan,
): Array<ResolvedCallArgumentInfo | null> {
  const ordered: Array<ResolvedCallArgumentInfo | null> = Array.from({ length: params.length }, () => null);
  const paramIndexByName = new Map(params.map((param, index) => [param.name, index]));
  const provided = new Set<string>();

  for (const arg of args) {
    const paramIndex = paramIndexByName.get(arg.name);
    const expectedType = paramIndex !== undefined ? params[paramIndex].type : undefined;
    const argType = arg.inferType(expectedType);

    if (paramIndex === undefined) {
      info.diagnostics.push({
        severity: "error",
        message: `Function call does not have a parameter named "${arg.name}"`,
        span: arg.span,
        module: table.path,
      });
      continue;
    }

    if (provided.has(arg.name)) {
      info.diagnostics.push({
        severity: "error",
        message: `Parameter "${arg.name}" is specified more than once`,
        span: arg.span,
        module: table.path,
      });
      continue;
    }

    provided.add(arg.name);
    ordered[paramIndex] = { span: arg.span, type: argType };
  }

  for (let i = 0; i < params.length; i++) {
    if (!ordered[i] && !params[i].hasDefault) {
      info.diagnostics.push({
        severity: "error",
        message: `Missing required parameter "${params[i].name}"`,
        span: callSpan,
        module: table.path,
      });
    }
  }

  return ordered;
}

function validateResolvedNamedFunctionArgs(
  params: FunctionResolvedParam[],
  orderedArgs: Array<ResolvedCallArgumentInfo | null>,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  for (let i = 0; i < Math.min(params.length, orderedArgs.length); i++) {
    const arg = orderedArgs[i];
    if (!arg) continue;
    if (!isAssignableTo(arg.type, params[i].type)) {
      info.diagnostics.push({
        severity: "error",
        message: `Argument of type "${typeToString(arg.type)}" is not assignable to parameter "${params[i].name}" of type "${typeToString(params[i].type)}"`,
        span: arg.span,
        module: table.path,
      });
    }
  }
}

function buildNamedCallInputsFromCallArgs(
  args: CallArgument[],
  host: CheckerHost,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): NamedCallInput[] {
  return args.map((arg, index) => ({
    name: arg.name ?? `_${index}`,
    span: arg.span,
    inferType: (expectedType?: ResolvedType) => inferExprType(host, arg.value, scope, table, info, expectedType),
  }));
}

function buildNamedCallInputsFromProperties(
  props: ObjectProperty[],
  host: CheckerHost,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): NamedCallInput[] {
  return props.map((prop) => ({
    name: prop.name,
    span: prop.span,
    inferType: (expectedType?: ResolvedType) => {
      if (prop.value) {
        return inferExprType(host, prop.value, scope, table, info, expectedType);
      }
      const binding = host.lookupBinding(prop.name, scope);
      if (binding) {
        (prop as { _shorthandResolvedType?: ResolvedType })._shorthandResolvedType = binding.type;
        return binding.type;
      }
      info.diagnostics.push({
        severity: "error",
        message: `Undefined identifier "${prop.name}"`,
        span: prop.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    },
  }));
}

function reportNamespaceLikeValueUse(
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
  name: string,
  kind: "namespace" | "builtin-namespace",
): void {
  const message = kind === "namespace"
    ? `Namespace import "${name}" cannot be used as a value; access an exported member instead`
    : `Builtin namespace "${name}" cannot be used as a value; access a static member instead`;
  info.diagnostics.push({
    severity: "error",
    message,
    span,
    module: table.path,
  });
}

function combineArrayElementTypes(elemTypes: ResolvedType[]): ResolvedType {
  const combinedTypes: ResolvedType[] = [];
  const seen = new Set<string>();

  const pushUnique = (type: ResolvedType) => {
    if (type.kind === "union") {
      for (const member of type.types) pushUnique(member);
      return;
    }

    const key = typeToString(type);
    if (!seen.has(key)) {
      seen.add(key);
      combinedTypes.push(type);
    }
  };

  for (const elemType of elemTypes) pushUnique(elemType);

  if (combinedTypes.length === 0) return UNKNOWN_TYPE;
  return combinedTypes.length === 1 ? combinedTypes[0] : { kind: "union", types: combinedTypes };
}

function mergeInferredMapKeyType(
  current: ResolvedType,
  next: ResolvedType,
): ResolvedType | null {
  if (current.kind === "unknown") return next;
  if (isAssignableTo(next, current)) return current;
  if (isSupportedHashCollectionElementType(next) && isAssignableTo(current, next)) return next;
  return null;
}

export function inferExprType(
  host: CheckerHost,
  expr: Expression,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  expectedType?: ResolvedType,
): ResolvedType {
  const type = inferExprTypeInner(host, expr, scope, table, info, expectedType);
  expr.resolvedType = type;
  return type;
}

function inferExprTypeInner(
  host: CheckerHost,
  expr: Expression,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  expectedType?: ResolvedType,
): ResolvedType {
  switch (expr.kind) {
    case "int-literal":
      if (expectedType?.kind === "primitive" &&
          (expectedType.name === "byte"
            || expectedType.name === "long"
            || expectedType.name === "float"
            || expectedType.name === "double")) {
        return expectedType;
      }
      return INT_TYPE;
    case "long-literal":
      if (expectedType?.kind === "primitive" && expectedType.name === "double") {
        return expectedType;
      }
      return LONG_TYPE;
    case "float-literal":
      if (expectedType?.kind === "primitive" && expectedType.name === "double") {
        return expectedType;
      }
      return FLOAT_TYPE;
    case "double-literal":
      if (expectedType?.kind === "primitive" && expectedType.name === "float") {
        return expectedType;
      }
      return DOUBLE_TYPE;
    case "char-literal":
      return CHAR_TYPE;
    case "bool-literal":
      return BOOL_TYPE;
    case "null-literal":
      return NULL_TYPE;

    case "string-literal": {
      for (const part of expr.parts) {
        if (typeof part !== "string") {
          inferExprType(host, part, scope, table, info);
        }
      }
      return STRING_TYPE;
    }

    case "identifier": {
      const binding = host.lookupBinding(expr.name, scope);
      if (binding) {
        expr.resolvedBinding = binding;
        if (binding.type.kind === "namespace" || binding.type.kind === "builtin-namespace") {
          reportNamespaceLikeValueUse(info, table, expr.span, expr.name, binding.type.kind);
          return UNKNOWN_TYPE;
        }
        return binding.type;
      }
      info.diagnostics.push({
        severity: "error",
        message: `Undefined identifier "${expr.name}"`,
        span: expr.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    case "this-expression": {
      const thisType = host.findThisType(scope);
      if (thisType) return thisType;
      info.diagnostics.push({
        severity: "error",
        message: "\"this\" is not available in this context",
        span: expr.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    case "binary-expression": {
      let left: ResolvedType;
      let right: ResolvedType;

      if (expr.left.kind === "dot-shorthand") {
        right = inferExprType(host, expr.right, scope, table, info);
        left = inferExprType(host, expr.left, scope, table, info, resolveExpectedEnumType(right));
      } else if (expr.right.kind === "dot-shorthand") {
        left = inferExprType(host, expr.left, scope, table, info);
        right = inferExprType(host, expr.right, scope, table, info, resolveExpectedEnumType(left));
      } else {
        left = inferExprType(host, expr.left, scope, table, info);
        right = inferExprType(host, expr.right, scope, table, info);
      }

      return inferBinaryType(expr.operator, left, right, info, table, expr.span);
    }

    case "unary-expression": {
      const operand = inferExprType(host, expr.operand, scope, table, info);
      return inferUnaryType(expr.operator, operand, info, table, expr.span);
    }

    case "yield-block-expression": {
      const yieldScope: Scope = {
        ...scope,
        inValueYieldBlock: true,
        valueYield: {
          type: expectedType ?? null,
          hasYield: false,
          context: "yield block",
        },
      };
      host.checkBlock(expr.body, yieldScope, table, info);
      if (!host.blockAlwaysYields(expr.body)) {
        info.diagnostics.push({
          severity: "error",
          message: "Yield blocks must yield a value on every path",
          span: expr.body.span,
          module: table.path,
        });
      }
      return yieldScope.valueYield?.type ?? UNKNOWN_TYPE;
    }

    case "assignment-expression": {
      const targetType = inferExprType(host, expr.target, scope, table, info);
      const valueType = inferExprType(host, expr.value, scope, table, info, targetType);

      if (expr.target.kind === "identifier") {
        const binding = host.lookupBinding(expr.target.name, scope);
        if (binding && !binding.mutable) {
          info.diagnostics.push({
            severity: "error",
            message: `Cannot assign to "${expr.target.name}" because it is ${binding.kind === "const" ? "a constant" : binding.kind === "readonly" ? "readonly" : "an immutable binding"}`,
            span: expr.span,
            module: table.path,
          });
        }
      } else if (expr.target.kind === "member-expression") {
        if (expr.target.object.kind === "identifier") {
          const objBinding = host.lookupBinding(expr.target.object.name, scope);
          if (objBinding && objBinding.type.kind === "class") {
            const classDecl = objBinding.type.symbol.declaration;
            for (const field of classDecl.fields) {
              if (field.names.includes(expr.target.property)) {
                if (field.readonly_ || field.const_) {
                  info.diagnostics.push({
                    severity: "error",
                    message: `Cannot assign to "${expr.target.property}" because it is ${field.const_ ? "a const field" : "a readonly field"}`,
                    span: expr.span,
                    module: table.path,
                  });
                }
                break;
              }
            }
          }
        }
      } else if (expr.target.kind === "qualified-member-expression") {
        if (expr.target.object.kind === "identifier") {
          const objBinding = host.lookupBinding(expr.target.object.name, scope);
          if (objBinding && objBinding.type.kind === "class") {
            const classDecl = objBinding.type.symbol.declaration;
            for (const field of classDecl.fields) {
              if (field.names.includes(expr.target.property)) {
                if (field.readonly_ || field.const_) {
                  info.diagnostics.push({
                    severity: "error",
                    message: `Cannot assign to "${expr.target.property}" because it is ${field.const_ ? "a const field" : "a readonly field"}`,
                    span: expr.span,
                    module: table.path,
                  });
                }
                break;
              }
            }
          }
        }
      } else if (expr.target.kind === "index-expression") {
        const collectionType = inferExprType(host, expr.target.object, scope, table, info);
        if (collectionType.kind === "array" && collectionType.readonly_) {
          info.diagnostics.push({
            severity: "error",
            message: "Cannot assign to an element of a readonly array",
            span: expr.span,
            module: table.path,
          });
        }
        if (collectionType.kind === "map" && collectionType.readonly_) {
          info.diagnostics.push({
            severity: "error",
            message: "Cannot assign to an entry of a readonly map",
            span: expr.span,
            module: table.path,
          });
        }
      }

      if (expr.operator === "=" && !isAssignableTo(valueType, targetType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Type "${typeToString(valueType)}" is not assignable to type "${typeToString(targetType)}"`,
          span: expr.span,
          module: table.path,
        });
      }

      return valueType;
    }

    case "member-expression": {
      let objectType: ResolvedType;
      let binding: Binding | null = null;
      if (expr.object.kind === "identifier") {
        binding = host.lookupBinding(expr.object.name, scope);
        if (binding) {
          expr.object.resolvedBinding = binding;
          expr.object.resolvedType = binding.type;
          objectType = binding.type;
        } else {
          info.diagnostics.push({
            severity: "error",
            message: `Undefined identifier "${expr.object.name}"`,
            span: expr.object.span,
            module: table.path,
          });
          objectType = UNKNOWN_TYPE;
        }
      } else {
        objectType = inferExprType(host, expr.object, scope, table, info);
      }
      if ((expr.force || expr.optional) && objectType.kind === "union") {
        const nonNull = objectType.types.filter((t: ResolvedType) => t.kind !== "null");
        if (nonNull.length === 1) {
          objectType = nonNull[0];
        }
      }

      const isTypeAliasStatic = !!binding && (
        binding.kind === "type-alias"
        || binding.symbol?.symbolKind === "type-alias"
      );
      const lookupMode = binding && (
        (binding.kind === "class" || binding.kind === "import") && objectType.kind === "class"
        || binding.kind === "interface" && objectType.kind === "interface"
        || isTypeAliasStatic
      )
        ? "named-static"
        : "instance";
      return inferMemberType(host, objectType, expr.property, table, lookupMode, info, expr.span, binding ?? undefined);
    }

    case "qualified-member-expression": {
      let objectType: ResolvedType;
      let binding: Binding | null = null;
      if (expr.object.kind === "identifier") {
        binding = host.lookupBinding(expr.object.name, scope);
        if (binding) {
          expr.object.resolvedBinding = binding;
          expr.object.resolvedType = binding.type;
          objectType = binding.type;
        } else {
          info.diagnostics.push({
            severity: "error",
            message: `Undefined identifier "${expr.object.name}"`,
            span: expr.object.span,
            module: table.path,
          });
          objectType = UNKNOWN_TYPE;
        }
      } else {
        objectType = inferExprType(host, expr.object, scope, table, info);
      }
      return inferMemberType(host, objectType, expr.property, table, "qualified-static", info, expr.span, binding ?? undefined);
    }

    case "index-expression": {
      const objectType = inferExprType(host, expr.object, scope, table, info);
      inferExprType(host, expr.index, scope, table, info);
      if (objectType.kind === "array") return objectType.elementType;
      if (objectType.kind === "map") return objectType.valueType;
      return UNKNOWN_TYPE;
    }

    case "call-expression": {
      const calleeBinding = expr.callee.kind === "identifier"
        ? host.lookupBinding(expr.callee.name, scope)
        : null;
      if (expr.callee.kind === "identifier"
          && (!calleeBinding || calleeBinding.kind === "builtin")
          && NUMERIC_PRIMITIVE_NAMES.has(expr.callee.name)) {
        if (expr.args.length !== 1) {
          info.diagnostics.push({
            severity: "error",
            message: `Numeric cast ${expr.callee.name}() requires exactly 1 argument`,
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        const argType = inferExprType(host, expr.args[0].value, scope, table, info);
        if (argType.kind !== "unknown" && !(argType.kind === "primitive" && NUMERIC_PRIMITIVE_NAMES.has(argType.name))) {
          info.diagnostics.push({
            severity: "error",
            message: `Cannot cast "${typeToString(argType)}" to ${expr.callee.name}; numeric casts require a numeric operand`,
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        return { kind: "primitive", name: expr.callee.name as "byte" | "int" | "long" | "float" | "double" };
      }

      if (expr.callee.kind === "identifier"
          && expr.callee.name === "string"
          && (!calleeBinding || calleeBinding.kind === "builtin")) {
        if (expr.args.length !== 1) {
          info.diagnostics.push({
            severity: "error",
            message: "string() requires exactly 1 argument",
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        const argType = inferExprType(host, expr.args[0].value, scope, table, info);
        if (argType.kind !== "unknown" && !isStringConvertibleType(argType)) {
          info.diagnostics.push({
            severity: "error",
            message: `Cannot convert "${typeToString(argType)}" to string; string() requires a primitive, null, or union of string-convertible members`,
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        return STRING_TYPE;
      }

      if (expr.callee.kind === "identifier" && isUnshadowedResultCtorCall(expr.callee.name, calleeBinding)) {
        const resultContext = resolveExpectedResultContext(host, scope, expectedType);
        const argTypes: ResolvedType[] = [];
        for (const arg of expr.args) {
          argTypes.push(inferExprType(host, arg.value, scope, table, info));
        }
        if (expr.callee.name === "Failure" && argTypes.length !== 1) {
          info.diagnostics.push({
            severity: "error",
            message: "Failure() requires exactly 1 argument",
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        if (!resultContext) {
          reportMissingResultContext(info, table, expr.span, expr.callee.name);
          return UNKNOWN_TYPE;
        }
        if (expr.callee.name === "Success") {
          if (isVoidResultType(resultContext)) {
            if (argTypes.length !== 0) {
              info.diagnostics.push({
                severity: "error",
                message: "Success() for Result<void, E> must not take an argument",
                span: expr.span,
                module: table.path,
              });
              return UNKNOWN_TYPE;
            }
            return { kind: "result", successType: VOID_TYPE, errorType: resultContext.errorType };
          }
          if (argTypes.length !== 1) {
            info.diagnostics.push({
              severity: "error",
              message: "Success() requires exactly 1 argument",
              span: expr.span,
              module: table.path,
            });
            return UNKNOWN_TYPE;
          }
          const successType = argTypes[0];
          return { kind: "result", successType, errorType: resultContext.errorType };
        }
        const errorType = argTypes[0];
        return { kind: "result", successType: resultContext.successType, errorType };
      }

      const calleeType = inferExprType(host, expr.callee, scope, table, info);

      if (calleeType.kind === "function") {
        let effectiveCalleeType = calleeType;
        const hasNamedArgs = expr.args.some((arg) => arg.name);

        if (hasNamedArgs) {
          const orderedArgs = resolveNamedFunctionArgs(
            calleeType.params,
            buildNamedCallInputsFromCallArgs(expr.args, host, scope, table, info),
            table,
            info,
            expr.span,
          );
          if (calleeType.typeParams && calleeType.typeParams.length > 0) {
            const providedParams: FunctionResolvedParam[] = [];
            const providedArgTypes: ResolvedType[] = [];
            for (let i = 0; i < orderedArgs.length; i++) {
              if (!orderedArgs[i]) continue;
              providedParams.push(calleeType.params[i]);
              providedArgTypes.push(orderedArgs[i]!.type);
            }
            const paramMap = host.inferTypeArgs(calleeType.typeParams, providedParams, providedArgTypes);
            validateInferredTypeArgsAgainstConstraints(
              calleeType.typeParams,
              calleeType.typeParamConstraints,
              paramMap,
              table,
              info,
              expr.span,
            );
            applyResultMethodGenericDefaults(expr, calleeType, paramMap);
            for (const arg of expr.args) {
              applyTypeSubstitutionToExpression(arg.value, paramMap);
            }
            recordResolvedGenericCall(expr, calleeType, paramMap);
            effectiveCalleeType = substituteTypeParams(calleeType, paramMap) as typeof calleeType;
          }
          validateResolvedNamedFunctionArgs(effectiveCalleeType.params, orderedArgs, table, info);
          return effectiveCalleeType.returnType;
        }

        if (calleeType.typeParams && calleeType.typeParams.length > 0) {
          const argTypes: ResolvedType[] = [];
          for (let i = 0; i < expr.args.length; i++) {
            const paramType = i < calleeType.params.length ? calleeType.params[i].type : undefined;
            argTypes.push(inferExprType(host, expr.args[i].value, scope, table, info, paramType));
          }
          const paramMap = host.inferTypeArgs(calleeType.typeParams, calleeType.params, argTypes);
          validateInferredTypeArgsAgainstConstraints(
            calleeType.typeParams,
            calleeType.typeParamConstraints,
            paramMap,
            table,
            info,
            expr.span,
          );
          applyResultMethodGenericDefaults(expr, calleeType, paramMap);
          for (const arg of expr.args) {
            applyTypeSubstitutionToExpression(arg.value, paramMap);
          }
          recordResolvedGenericCall(expr, calleeType, paramMap);
          effectiveCalleeType = substituteTypeParams(calleeType, paramMap) as typeof calleeType;
          validatePositionalFunctionArgs(
            effectiveCalleeType.params,
            argTypes,
            expr.args.map((arg) => arg.span),
            table,
            info,
            expr.span,
          );
          return effectiveCalleeType.returnType;
        }

        const argTypes: ResolvedType[] = [];
        for (let i = 0; i < expr.args.length; i++) {
          const paramType = i < calleeType.params.length ? calleeType.params[i].type : undefined;
          argTypes.push(inferExprType(host, expr.args[i].value, scope, table, info, paramType));
        }
        validatePositionalFunctionArgs(
          calleeType.params,
          argTypes,
          expr.args.map((arg) => arg.span),
          table,
          info,
          expr.span,
        );
        return calleeType.returnType;
      }

      if (calleeType.kind === "class") {
        let effectiveClassType = calleeType;
        let constructorParams = getConstructorParams(host, calleeType.symbol, table, true);

        if ((!calleeType.typeArgs || calleeType.typeArgs.length === 0) && calleeType.symbol.declaration.typeParams.length > 0) {
          const argTypes: ResolvedType[] = [];
          for (let i = 0; i < expr.args.length; i++) {
            const paramType = i < constructorParams.length ? constructorParams[i].type : undefined;
            argTypes.push(inferExprType(host, expr.args[i].value, scope, table, info, paramType));
          }

          const typeParamConstraints = resolveDeclarationTypeParamConstraints(
            host,
            calleeType.symbol.declaration.typeParams,
            calleeType.symbol.declaration.typeParamConstraints,
            table,
          );
          const paramMap = host.inferTypeArgs(calleeType.symbol.declaration.typeParams, constructorParams, argTypes);
          validateInferredTypeArgsAgainstConstraints(
            calleeType.symbol.declaration.typeParams,
            typeParamConstraints,
            paramMap,
            table,
            info,
            expr.span,
          );
          effectiveClassType = buildResolvedGenericClassType(calleeType, paramMap);

          if (effectiveClassType.typeArgs && effectiveClassType.typeArgs.length > 0) {
            const classParamMap = new Map<string, ResolvedType>();
            for (let i = 0; i < calleeType.symbol.declaration.typeParams.length && i < effectiveClassType.typeArgs.length; i++) {
              classParamMap.set(calleeType.symbol.declaration.typeParams[i], effectiveClassType.typeArgs[i]);
            }
            constructorParams = constructorParams.map((param) => ({
              ...param,
              type: substituteTypeParams(param.type, classParamMap),
            }));
          }

          validateConstructorArgs(
            host,
            calleeType.symbol,
            argTypes,
            expr.args.map((arg) => arg.span),
            true,
            table,
            info,
            expr.span,
            constructorParams,
          );
          return effectiveClassType;
        }

        if (expr.args.some((arg) => arg.name)) {
          const props: ObjectProperty[] = expr.args.map((arg) => ({
            kind: "object-property",
            name: arg.name!,
            value: arg.value,
            span: arg.span,
          }));
          const paramMap = new Map(constructorParams.map((param) => [param.name, param]));
          for (const prop of props) {
            const fieldParam = paramMap.get(prop.name);
            inferExprType(host, prop.value!, scope, table, info, fieldParam?.type);
          }
          validateNamedConstructorArgs(host, calleeType.symbol, props, true, table, info, expr.span, constructorParams);
        } else {
          const argTypes: ResolvedType[] = [];
          for (let i = 0; i < expr.args.length; i++) {
            const paramType = i < constructorParams.length ? constructorParams[i].type : undefined;
            argTypes.push(inferExprType(host, expr.args[i].value, scope, table, info, paramType));
          }
          validateConstructorArgs(host, calleeType.symbol, argTypes, expr.args.map((a) => a.span), true, table, info, expr.span, constructorParams);
        }
        return effectiveClassType;
      }

      for (const arg of expr.args) {
        inferExprType(host, arg.value, scope, table, info);
      }
      return UNKNOWN_TYPE;
    }

    case "construct-expression": {
      if (isUnshadowedResultCtorConstruct(expr, table) && expr.type === "Success") {
        const props = expr.args as ObjectProperty[];
        const resultContext = resolveExpectedResultContext(host, scope, expectedType);
        for (const prop of props) {
          if (prop.value) {
            inferExprType(
              host,
              prop.value,
              scope,
              table,
              info,
              prop.name === "value" ? resultContext?.successType : undefined,
            );
          }
        }
        if (!resultContext) {
          reportMissingResultContext(info, table, expr.span, "Success");
          return UNKNOWN_TYPE;
        }
        if (isVoidResultType(resultContext)) {
          if (props.length !== 0) {
            info.diagnostics.push({
              severity: "error",
              message: "Success for Result<void, E> must not specify any fields",
              span: expr.span,
              module: table.path,
            });
            return UNKNOWN_TYPE;
          }
          return { kind: "result", successType: VOID_TYPE, errorType: resultContext.errorType };
        }
        const valueProp = props.find((p) => p.name === "value");
        if (!valueProp || !valueProp.value) {
          info.diagnostics.push({
            severity: "error",
            message: "Success requires a \"value\" field",
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        const successType = valueProp.value.resolvedType ?? UNKNOWN_TYPE;
        return { kind: "result", successType, errorType: resultContext.errorType };
      }

      if (isUnshadowedResultCtorConstruct(expr, table) && expr.type === "Failure") {
        const props = expr.args as ObjectProperty[];
        const resultContext = resolveExpectedResultContext(host, scope, expectedType);
        for (const prop of props) {
          if (prop.value) {
            inferExprType(
              host,
              prop.value,
              scope,
              table,
              info,
              prop.name === "error" ? resultContext?.errorType : undefined,
            );
          }
        }
        const errorProp = props.find((p) => p.name === "error");
        if (!errorProp || !errorProp.value) {
          info.diagnostics.push({
            severity: "error",
            message: "Failure requires an \"error\" field",
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        const errorType = errorProp.value.resolvedType ?? UNKNOWN_TYPE;
        if (!resultContext) {
          reportMissingResultContext(info, table, expr.span, "Failure");
          return UNKNOWN_TYPE;
        }
        return { kind: "result", successType: resultContext.successType, errorType };
      }

      const targetBinding = host.lookupBinding(expr.type, scope);
      const resolvedClassSymbol = targetBinding?.type.kind === "class"
        ? targetBinding.type.symbol
        : null;
      const sym = targetBinding ? resolvedClassSymbol : table.symbols.get(expr.type);
      if (sym?.symbolKind === "class") {
        const typeParamConstraints = resolveDeclarationTypeParamConstraints(
          host,
          sym.declaration.typeParams,
          sym.declaration.typeParamConstraints,
          table,
        );
        const resolvedTypeArgs = validateResolvedTypeArgsAgainstConstraints(
          sym.declaration.typeParams,
          typeParamConstraints,
          host.resolveGenericTypeArgs(sym.declaration.typeParams, expr.typeArgs, table),
          table,
          info,
          expr.span,
        );
        let paramSubMap: Map<string, ResolvedType> | undefined;
        if (resolvedTypeArgs && sym.declaration.typeParams.length > 0) {
          paramSubMap = new Map<string, ResolvedType>();
          for (let i = 0; i < sym.declaration.typeParams.length && i < resolvedTypeArgs.length; i++) {
            paramSubMap.set(sym.declaration.typeParams[i], resolvedTypeArgs[i]);
          }
        }

        let constructParams = getConstructorParams(host, sym, table, true);
        if (paramSubMap) {
          constructParams = constructParams.map((p) => ({
            ...p,
            type: substituteTypeParams(p.type, paramSubMap!),
          }));
        }

        if (expr.named) {
          const props = expr.args as ObjectProperty[];
          const cpMap = new Map(constructParams.map((p) => [p.name, p]));
          for (const prop of props) {
            const fieldParam = cpMap.get(prop.name);
            if (prop.value) {
              inferExprType(host, prop.value, scope, table, info, fieldParam?.type);
            } else {
              const binding = host.lookupBinding(prop.name, scope);
              if (binding) {
                (prop as { _shorthandResolvedType?: ResolvedType })._shorthandResolvedType = binding.type;
              } else {
                info.diagnostics.push({
                  severity: "error",
                  message: `Undefined identifier "${prop.name}"`,
                  span: prop.span,
                  module: table.path,
                });
              }
            }
          }
          validateNamedConstructorArgs(host, sym, props, true, table, info, expr.span, constructParams);
        } else {
          const argTypes: ResolvedType[] = [];
          for (let i = 0; i < expr.args.length; i++) {
            const paramType = i < constructParams.length ? constructParams[i].type : undefined;
            argTypes.push(inferExprType(host, expr.args[i] as Expression, scope, table, info, paramType));
          }
          const argSpans = (expr.args as Expression[]).map((a) => a.span);
          validateConstructorArgs(host, sym, argTypes, argSpans, true, table, info, expr.span, constructParams);
        }

        if (sym.declaration.private_ && sym.module !== table.path) {
          info.diagnostics.push({
            severity: "error",
            message: `Class "${sym.name}" is private and only accessible within "${sym.module}"`,
            span: expr.span,
            module: table.path,
          });
        }
        if (sym.module !== table.path) {
          const privateFieldsWithoutDefaults = sym.declaration.fields.filter(
            (f) => f.private_ && f.defaultValue === null,
          );
          if (privateFieldsWithoutDefaults.length > 0) {
            const fieldNames = privateFieldsWithoutDefaults.flatMap((f) => f.names).join(", ");
            info.diagnostics.push({
              severity: "error",
              message: `Class "${sym.name}" cannot be constructed from outside "${sym.module}" because it has private fields without defaults: ${fieldNames}`,
              span: expr.span,
              module: table.path,
            });
          }
        }
        return resolvedTypeArgs
          ? { kind: "class", symbol: sym, typeArgs: resolvedTypeArgs }
          : { kind: "class", symbol: sym };
      }

      if (expr.named
          && targetBinding?.type.kind === "function"
          && (targetBinding.kind === "function"
        || targetBinding.kind === "import"
        || targetBinding.kind === "builtin")) {
        if (!expr.tightBraces) {
          for (const arg of expr.args as ObjectProperty[]) {
            if (arg.value) {
              inferExprType(host, arg.value, scope, table, info);
            } else {
              const binding = host.lookupBinding(arg.name, scope);
              if (binding) {
                (arg as { _shorthandResolvedType?: ResolvedType })._shorthandResolvedType = binding.type;
              } else {
                info.diagnostics.push({
                  severity: "error",
                  message: `Undefined identifier "${arg.name}"`,
                  span: arg.span,
                  module: table.path,
                });
              }
            }
          }
          info.diagnostics.push({
            severity: "error",
            message: `Named call syntax requires '{' to immediately follow "${expr.type}" with no whitespace`,
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }

        let effectiveCalleeType = targetBinding.type;
        const orderedArgs = resolveNamedFunctionArgs(
          targetBinding.type.params,
          buildNamedCallInputsFromProperties(expr.args as ObjectProperty[], host, scope, table, info),
          table,
          info,
          expr.span,
        );
        if (targetBinding.type.typeParams && targetBinding.type.typeParams.length > 0) {
          const providedParams: FunctionResolvedParam[] = [];
          const providedArgTypes: ResolvedType[] = [];
          for (let i = 0; i < orderedArgs.length; i++) {
            if (!orderedArgs[i]) continue;
            providedParams.push(targetBinding.type.params[i]);
            providedArgTypes.push(orderedArgs[i]!.type);
          }
          const paramMap = host.inferTypeArgs(targetBinding.type.typeParams, providedParams, providedArgTypes);
          validateInferredTypeArgsAgainstConstraints(
            targetBinding.type.typeParams,
            targetBinding.type.typeParamConstraints,
            paramMap,
            table,
            info,
            expr.span,
          );
          effectiveCalleeType = substituteTypeParams(targetBinding.type, paramMap) as typeof targetBinding.type;
        }
        validateResolvedNamedFunctionArgs(effectiveCalleeType.params, orderedArgs, table, info);
        return effectiveCalleeType.returnType;
      }

      if (expr.named) {
        for (const arg of expr.args) {
          const prop = arg as ObjectProperty;
          if (prop.value) inferExprType(host, prop.value, scope, table, info);
        }
      } else {
        for (const arg of expr.args) {
          inferExprType(host, arg as Expression, scope, table, info);
        }
      }
      return UNKNOWN_TYPE;
    }

    case "array-literal": {
      if (expectedType && isJsonValueType(expectedType)) {
        expr.elements.forEach((e) => inferExprType(host, e, scope, table, info, JSON_VALUE_TYPE));
        return { kind: "array", elementType: JSON_VALUE_TYPE, readonly_: expr.readonly_ };
      }
      const expectedElemType = expectedType?.kind === "array"
        ? expectedType.elementType
        : expectedType?.kind === "set"
          ? expectedType.elementType
          : undefined;
      const elemTypes = expr.elements.map((e) => inferExprType(host, e, scope, table, info, expectedElemType));
      if (expectedElemType
        && expectedElemType.kind !== "unknown"
        && elemTypes.every((elemType) => isAssignableTo(elemType, expectedElemType))) {
        if (expectedType?.kind === "set") {
          return {
            kind: "set",
            elementType: expectedElemType,
            readonly_: expectedType.readonly_,
          };
        }
        if (expectedType?.kind === "array") {
          return {
            kind: "array",
            elementType: expectedElemType,
            readonly_: expectedType.readonly_,
          };
        }
      }
      const elemType = elemTypes.length > 0 ? combineArrayElementTypes(elemTypes) : (expectedElemType ?? UNKNOWN_TYPE);
      if (expectedType?.kind === "set") {
        return { kind: "set", elementType: elemType, readonly_: expectedType.readonly_ };
      }
      return { kind: "array", elementType: elemType, readonly_: expr.readonly_ };
    }

    case "tuple-literal": {
      if (expectedType?.kind === "class") {
        const sym = expectedType.symbol;
        const params = getConstructorParams(host, sym, table, false);
        const argTypes: ResolvedType[] = [];
        for (let i = 0; i < expr.elements.length; i++) {
          const paramType = i < params.length ? params[i].type : undefined;
          argTypes.push(inferExprType(host, expr.elements[i], scope, table, info, paramType));
        }
        const argSpans = expr.elements.map((e) => e.span);
        validateConstructorArgs(host, sym, argTypes, argSpans, false, table, info, expr.span);
        return expectedType;
      }
      if (expectedType?.kind === "union") {
        const classTarget = resolveUnionForLiteral(host, expectedType, expr, scope, table, info);
        if (classTarget) return classTarget;
      }
      const elems = expr.elements.map((e) => inferExprType(host, e, scope, table, info));
      return { kind: "tuple", elements: elems };
    }

    case "object-literal": {
      if (expectedType && isJsonValueType(expectedType)) {
        inferObjectLiteralProperties(host, expr, scope, table, info, () => JSON_VALUE_TYPE);
        return { kind: "map", keyType: STRING_TYPE, valueType: JSON_VALUE_TYPE };
      }
      if (expectedType?.kind === "result") {
        return inferResultObjectLiteral(host, expr, scope, table, info, expectedType);
      }
      if (expectedType?.kind === "map" && expr.properties.length === 0 && !expr.spread) {
        return expectedType;
      }
      if (expectedType?.kind === "class") {
        const sym = expectedType.symbol;
        const fieldParams = getConstructorParams(host, sym, table, false);
        inferObjectLiteralProperties(host, expr, scope, table, info, (propName) =>
          fieldParams.find((p) => p.name === propName)?.type,
        );
        validateNamedConstructorArgs(host, sym, expr.properties, false, table, info, expr.span);
        return expectedType;
      }
      if (expectedType?.kind === "union") {
        const resolution = resolveUnionForObjectLiteral(host, expectedType, expr, scope, table, info);
        if (resolution.resolvedType) return resolution.resolvedType;

        inferObjectLiteralProperties(host, expr, scope, table, info);
        info.diagnostics.push({
          severity: "error",
          message: resolution.diagnostic ?? `Object literal is not compatible with union type "${typeToString(expectedType)}"`,
          span: expr.span,
          module: table.path,
        });
        return UNKNOWN_TYPE;
      }
      inferObjectLiteralProperties(host, expr, scope, table, info);
      info.diagnostics.push({
        severity: "error",
        message: expectedType
          ? `Object literal is not compatible with type "${typeToString(expectedType)}"`
          : "Object literal requires contextual type information or an explicit annotation",
        span: expr.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    case "map-literal": {
      const expectedMap = expectedType?.kind === "map"
        ? expectedType
        : expectedType && isJsonValueType(expectedType)
          ? { kind: "map" as const, keyType: STRING_TYPE, valueType: JSON_VALUE_TYPE }
          : undefined;

      let keyType: ResolvedType = UNKNOWN_TYPE;
      const valueTypes: ResolvedType[] = [];

      for (const entry of expr.entries) {
        const kt = inferExprType(host, entry.key, scope, table, info, expectedMap?.keyType);
        const vt = inferExprType(host, entry.value, scope, table, info, expectedMap?.valueType);
        if ((!expectedMap || expectedMap.keyType.kind === "unknown") && !isSupportedMapKeyType(kt)) {
          info.diagnostics.push({
            severity: "error",
            message: formatUnsupportedHashCollectionConstraintMessage({ kind: "map-key", type: kt }, "map-literal-key"),
            span: entry.key.span,
            module: table.path,
          });
        }
        if (keyType.kind === "unknown") {
          keyType = kt;
        } else if (!expectedMap && isSupportedMapKeyType(keyType)) {
          const mergedKeyType = mergeInferredMapKeyType(keyType, kt);
          if (!mergedKeyType && isSupportedMapKeyType(kt)) {
            info.diagnostics.push({
              severity: "error",
              message: `Map literal key type "${typeToString(kt)}" is not compatible with inferred key type "${typeToString(keyType)}"`,
              span: entry.key.span,
              module: table.path,
            });
          } else if (mergedKeyType) {
            keyType = mergedKeyType;
          }
        }
        valueTypes.push(vt);
      }

      const valueType = valueTypes.length > 0
        ? combineArrayElementTypes(valueTypes)
        : (expectedMap?.valueType ?? UNKNOWN_TYPE);

      if (expectedMap) {
        return {
          kind: "map",
          keyType: expectedMap.keyType.kind === "unknown" ? keyType : expectedMap.keyType,
          valueType: expectedMap.valueType.kind === "unknown" ? valueType : expectedMap.valueType,
          readonly_: expectedMap.readonly_,
        };
      }

      return { kind: "map", keyType, valueType };
    }

    case "lambda-expression": {
      const expectedFn = expectedType?.kind === "function" ? expectedType : undefined;

      if (expr.parameterless && expectedFn) {
        for (const ep of expectedFn.params) {
          expr.params.push({
            name: ep.name,
            type: null,
            defaultValue: null,
            span: expr.span,
          });
        }
      }

      if (expectedFn && expr.params.length > 0 && !expr.parameterless) {
        const hasUntypedParams = expr.params.some((p) => !p.type);

        if (hasUntypedParams) {
          const expectedParamNames = new Set(expectedFn.params.map((p) => p.name));
          const expectedParamMap = new Map(expectedFn.params.map((p) => [p.name, p]));

          let hasErrors = false;
          for (const p of expr.params) {
            if (!p.type && !expectedParamNames.has(p.name)) {
              hasErrors = true;
              info.diagnostics.push({
                severity: "error",
                message: `Parameter "${p.name}" does not match any parameter in the expected signature (${expectedFn.params.map((ep) => ep.name).join(", ")})`,
                span: p.span,
                module: table.path,
              });
            }
          }

          if (!hasErrors) {
            const namedSet = new Set(expr.params.map((p) => p.name));
            const fullParams: typeof expr.params = [];

            for (const ep of expectedFn.params) {
              if (namedSet.has(ep.name)) {
                const existing = expr.params.find((p) => p.name === ep.name)!;
                existing.resolvedType = ep.type;
                fullParams.push(existing);
              } else {
                fullParams.push({
                  name: `_$${ep.name}`,
                  type: null,
                  defaultValue: null,
                  span: expr.span,
                });
              }
            }
            expr.params.length = 0;
            for (const p of fullParams) expr.params.push(p);

            for (const p of expr.params) {
              if (!p.type && !p.resolvedType) {
                const originalName = p.name.startsWith("_$") ? p.name.slice(2) : p.name;
                const match = expectedParamMap.get(originalName);
                if (match) p.resolvedType = match.type;
              }
            }
          }
        }
      } else if (expectedFn && expr.parameterless) {
        const expectedParamMap = new Map(expectedFn.params.map((p) => [p.name, p]));
        for (const p of expr.params) {
          if (!p.type) {
            const match = expectedParamMap.get(p.name);
            if (match) p.resolvedType = match.type;
          }
        }
      }

      const params: FunctionResolvedParam[] = expr.params.map((p) => ({
        name: p.name,
        type: p.type
          ? host.resolveTypeAnnotation(p.type, table)
          : p.resolvedType ?? UNKNOWN_TYPE,
        hasDefault: p.defaultValue !== null,
        defaultValue: p.defaultValue,
      }));

      const declaredReturn = expr.returnType
        ? host.resolveTypeAnnotation(expr.returnType, table)
        : null;
      if (expr.trailing && expectedFn && expectedFn.returnType.kind !== "void") {
        info.diagnostics.push({
          severity: "error",
          message: `Trailing lambda requires a void callback type, but expected return type is "${typeToString(expectedFn.returnType)}"; use an explicit lambda instead`,
          span: expr.span,
          module: table.path,
        });
      }

      const lambdaScope = host.pushScope(scope, "function", declaredReturn);
      if (expr.trailing) {
        lambdaScope.inTrailingLambda = true;
      }
      for (const param of expr.params) {
        const pType = param.type
          ? host.resolveTypeAnnotation(param.type, table)
          : param.resolvedType ?? UNKNOWN_TYPE;
        param.resolvedType = pType;
        if (param.name.startsWith("_$")) continue;
        lambdaScope.bindings.set(param.name, {
          name: param.name,
          kind: "parameter",
          type: pType,
          mutable: false,
          span: param.span,
          module: table.path,
        });
      }

      let returnType: ResolvedType;
      if (expr.returnType) {
        returnType = host.resolveTypeAnnotation(expr.returnType, table);
        if (expr.body.kind === "block") {
          host.checkStatements(expr.body.statements, lambdaScope, table, info);
        } else {
          const bodyType = inferExprType(host, expr.body, lambdaScope, table, info);
          if (!isAssignableTo(bodyType, returnType)) {
            info.diagnostics.push({
              severity: "error",
              message: `Type "${typeToString(bodyType)}" is not assignable to return type "${typeToString(returnType)}"`,
              span: expr.body.span,
              module: table.path,
            });
          }
        }
      } else if (expr.body.kind === "block") {
        host.checkStatements(expr.body.statements, lambdaScope, table, info);
        returnType = expectedFn?.returnType ?? VOID_TYPE;
      } else {
        returnType = inferExprType(host, expr.body, lambdaScope, table, info, expectedFn?.returnType);
      }

      return { kind: "function", params, returnType };
    }

    case "if-expression": {
      const condType = inferExprType(host, expr.condition, scope, table, info);
      host.checkConditionIsBool(condType, expr.condition, table, info);
      const thenType = inferExprType(host, expr.then, scope, table, info);
      inferExprType(host, expr.else_, scope, table, info);
      return thenType;
    }

    case "case-expression": {
      const subjectType = inferExprType(host, expr.subject, scope, table, info);
      const expectedEnumType = resolveExpectedEnumType(subjectType);
      let resultType: ResolvedType = UNKNOWN_TYPE;
      for (const arm of expr.arms) {
        for (const pattern of arm.patterns) {
          if (pattern.kind === "value-pattern") {
            inferExprType(host, pattern.value, scope, table, info, expectedEnumType);
          } else if (pattern.kind === "range-pattern") {
            if (pattern.start) inferExprType(host, pattern.start, scope, table, info, expectedEnumType);
            if (pattern.end) inferExprType(host, pattern.end, scope, table, info, expectedEnumType);
          }
        }
        let armScope = buildCaseArmScope(host, arm, subjectType, scope, table, info);
        armScope = { ...armScope, inCaseExpressionArm: true, inValueYieldBlock: true };
        if (arm.body.kind === "block") {
          armScope.valueYield = {
            type: resultType.kind === "unknown" ? null : resultType,
            hasYield: false,
            context: "case-expression arm",
          };
          host.checkBlock(arm.body as Block, armScope, table, info);
          if (!host.blockAlwaysYields(arm.body as Block)) {
            info.diagnostics.push({
              severity: "error",
              message: "Block case-expression arms must yield a value on every path",
              span: arm.body.span,
              module: table.path,
            });
          }
          const yieldedType: ResolvedType = armScope.valueYield?.type ?? UNKNOWN_TYPE;
          if (resultType.kind === "unknown") resultType = yieldedType;
        } else {
          const expectedBodyType = resultType.kind === "unknown" ? undefined : resultType;
          const bodyType = inferExprType(host, arm.body as Expression, armScope, table, info, expectedBodyType);
          if (resultType.kind === "unknown") resultType = bodyType;
        }
      }
      return resultType;
    }

    case "enum-access": {
      if (expr.enumName) {
        const sym = table.symbols.get(expr.enumName);
        if (sym?.symbolKind === "enum") return { kind: "enum", symbol: sym };
      }
      return UNKNOWN_TYPE;
    }

    case "dot-shorthand": {
      const enumType = resolveExpectedEnumType(expectedType);
      if (enumType) return enumType;
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer enum type for ".${expr.name}"`,
        span: expr.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    case "async-expression": {
      if (expr.expression.kind === "block") {
        host.checkBlock(expr.expression as Block, scope, table, info);
        return { kind: "promise", valueType: UNKNOWN_TYPE };
      }
      const innerType = inferExprType(host, expr.expression as Expression, scope, table, info);
      return { kind: "promise", valueType: innerType };
    }

    case "actor-creation-expression": {
      for (const arg of expr.args) {
        inferExprType(host, arg, scope, table, info);
      }
      const sym = table.symbols.get(expr.className);
      if (sym?.symbolKind === "class") {
        return { kind: "actor", innerClass: { kind: "class", symbol: sym } };
      }
      return UNKNOWN_TYPE;
    }

    case "catch-expression":
      return host.checkCatchExpression(expr, scope, table, info);

    case "non-null-assertion": {
      const innerType = inferExprType(host, expr.expression, scope, table, info);
      if (innerType.kind === "result") {
        return innerType.successType;
      }
      if (innerType.kind === "union") {
        const hasNull = innerType.types.some((t) => t.kind === "null");
        if (!hasNull) {
          info.diagnostics.push({
            severity: "error",
            message: `Postfix "!" can only be applied to a nullable or Result type, but got "${typeToString(innerType)}"`,
            span: expr.span,
            module: table.path,
          });
          return UNKNOWN_TYPE;
        }
        const nonNull = innerType.types.filter((t) => t.kind !== "null");
        if (nonNull.length === 1) return nonNull[0];
        if (nonNull.length > 1) return { kind: "union", types: nonNull };
        return UNKNOWN_TYPE;
      }
      info.diagnostics.push({
        severity: "error",
        message: `Postfix "!" can only be applied to a nullable or Result type, but got "${typeToString(innerType)}"`,
        span: expr.span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    case "as-expression": {
      const sourceType = inferExprType(host, expr.expression, scope, table, info);
      const targetType = host.resolveTypeAnnotation(expr.targetType, table);
      return inferAsNarrowType(sourceType, targetType, info, table, expr.span);
    }

    default:
      return UNKNOWN_TYPE;
  }
}

function getConstructorParams(
  host: CheckerHost,
  sym: ClassSymbol,
  table: ModuleSymbolTable,
  nominal: boolean,
): ConstructorParam[] {
  const externFactoryParams = getExternConstructorFactoryParams(host, sym, table);
  if (externFactoryParams) {
    return externFactoryParams;
  }

  const params: ConstructorParam[] = [];
  const classDecl = sym.declaration;
  const classTable = host.analysisResult.modules.get(sym.module) ?? table;
  if (classDecl.typeParams.length > 0) {
    host.typeParamStack.push(new Set(classDecl.typeParams));
  }
  try {
    for (const field of classDecl.fields) {
      if (field.static_) continue;
      if (nominal && field.const_) continue;
      const fieldType = field.resolvedType
        ?? (field.type ? host.resolveTypeAnnotation(field.type, classTable) : UNKNOWN_TYPE);
      for (const name of field.names) {
        params.push({ name, type: fieldType, hasDefault: field.defaultValue !== null, source: "field" });
      }
    }
  } finally {
    if (classDecl.typeParams.length > 0) {
      host.typeParamStack.pop();
    }
  }
  return params;
}

function getExternConstructorFactoryParams(
  host: CheckerHost,
  sym: ClassSymbol,
  table: ModuleSymbolTable,
): ConstructorParam[] | null {
  const factoryMethod = findExternConstructorFactoryMethod(host, sym, table);
  if (!factoryMethod) return null;

  const classTable = host.analysisResult.modules.get(sym.module) ?? table;
  return factoryMethod.params.map((param) => ({
    name: param.name,
    type: param.resolvedType
      ?? (param.type ? host.resolveTypeAnnotation(param.type, classTable) : UNKNOWN_TYPE),
    hasDefault: param.defaultValue !== null,
    source: "parameter",
  }));
}

function findExternConstructorFactoryMethod(
  host: CheckerHost,
  sym: ClassSymbol,
  table: ModuleSymbolTable,
): FunctionDeclaration | null {
  if (!sym.extern_) return null;

  const classTable = host.analysisResult.modules.get(sym.module) ?? table;
  for (const method of sym.declaration.methods) {
    if (!method.static_ || method.name !== "create") continue;

    const resolvedReturnType = method.returnType
      ? host.resolveTypeAnnotation(method.returnType, classTable)
      : UNKNOWN_TYPE;
    if (resolvedReturnType.kind === "class" && resolvedReturnType.symbol === sym) {
      return method;
    }

    if (method.returnType?.kind === "named-type" && method.returnType.name === sym.name) {
      return method;
    }
  }

  return null;
}

function describeConstructorParam(param: ConstructorParam): string {
  return param.source === "parameter" ? "parameter" : "field";
}

function validateConstructorArgs(
  host: CheckerHost,
  sym: ClassSymbol,
  argTypes: ResolvedType[],
  argSpans: SourceSpan[],
  nominal: boolean,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  callSpan: SourceSpan,
  paramsOverride?: ConstructorParam[],
): void {
  const params = paramsOverride ?? getConstructorParams(host, sym, table, nominal);
  const requiredCount = params.filter((p) => !p.hasDefault).length;
  const totalCount = params.length;

  if (argTypes.length < requiredCount || argTypes.length > totalCount) {
    const range = requiredCount === totalCount ? `${totalCount}` : `${requiredCount}-${totalCount}`;
    info.diagnostics.push({
      severity: "error",
      message: `Class "${sym.name}" expects ${range} constructor argument(s) but got ${argTypes.length}`,
      span: callSpan,
      module: table.path,
    });
    return;
  }

  for (let i = 0; i < argTypes.length; i++) {
    if (!isAssignableTo(argTypes[i], params[i].type)) {
      const paramKind = describeConstructorParam(params[i]);
      info.diagnostics.push({
        severity: "error",
        message: `Argument ${i + 1}: type "${typeToString(argTypes[i])}" is not assignable to ${paramKind} "${params[i].name}" of type "${typeToString(params[i].type)}"`,
        span: argSpans[i] ?? callSpan,
        module: table.path,
      });
    }
  }
}

function validateNamedConstructorArgs(
  host: CheckerHost,
  sym: ClassSymbol,
  props: ObjectProperty[],
  nominal: boolean,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  callSpan: SourceSpan,
  paramsOverride?: ConstructorParam[],
): void {
  const params = paramsOverride ?? getConstructorParams(host, sym, table, nominal);
  const paramMap = new Map(params.map((p) => [p.name, p]));
  const constructorSource = params.some((param) => param.source === "parameter") ? "parameter" : "field";

  for (const prop of props) {
    if (!paramMap.has(prop.name)) {
      info.diagnostics.push({
        severity: "error",
        message: constructorSource === "parameter"
          ? `Class "${sym.name}" does not have a constructor parameter "${prop.name}"`
          : `Class "${sym.name}" does not have a field "${prop.name}"`,
        span: prop.span,
        module: table.path,
      });
    } else {
      const param = paramMap.get(prop.name)!;
      const valueType = getObjectPropertyResolvedType(prop);
      if (!isAssignableTo(valueType, param.type)) {
        const paramKind = describeConstructorParam(param);
        info.diagnostics.push({
          severity: "error",
          message: `${paramKind === "parameter" ? "Parameter" : "Field"} "${prop.name}": type "${typeToString(valueType)}" is not assignable to type "${typeToString(param.type)}"`,
          span: prop.span,
          module: table.path,
        });
      }
    }
  }

  const providedNames = new Set(props.map((p) => p.name));
  for (const param of params) {
    if (!param.hasDefault && !providedNames.has(param.name)) {
      const paramKind = describeConstructorParam(param);
      info.diagnostics.push({
        severity: "error",
        message: `Missing required ${paramKind} "${param.name}" in construction of "${sym.name}"`,
        span: callSpan,
        module: table.path,
      });
    }
  }
}

function resolveUnionForLiteral(
  host: CheckerHost,
  unionType: { kind: "union"; types: ResolvedType[] },
  expr: TupleLiteral,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): ResolvedType | null {
  const candidates = unionType.types.filter(
    (t): t is Extract<ResolvedType, { kind: "class" }> => t.kind === "class",
  );
  if (candidates.length === 0) return null;

  const matching = candidates.filter((c) => {
    const params = getConstructorParams(host, c.symbol, table, false);
    const required = params.filter((p) => !p.hasDefault).length;
    return expr.elements.length >= required && expr.elements.length <= params.length;
  });

  if (matching.length !== 1) return null;

  const sym = matching[0].symbol;
  const params = getConstructorParams(host, sym, table, false);
  const argTypes: ResolvedType[] = [];
  for (let i = 0; i < expr.elements.length; i++) {
    const paramType = i < params.length ? params[i].type : undefined;
    argTypes.push(inferExprType(host, expr.elements[i], scope, table, info, paramType));
  }
  const argSpans = expr.elements.map((e) => e.span);
  validateConstructorArgs(host, sym, argTypes, argSpans, false, table, info, expr.span);
  return matching[0];
}

function resolveUnionForObjectLiteral(
  host: CheckerHost,
  unionType: { kind: "union"; types: ResolvedType[] },
  expr: ObjectLiteral,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): { resolvedType: ResolvedType | null; diagnostic?: string } {
  const candidates = unionType.types.filter(
    (t): t is Extract<ResolvedType, { kind: "class" }> => t.kind === "class",
  );
  if (candidates.length === 0) {
    return {
      resolvedType: null,
      diagnostic: `Object literal is not compatible with union type "${typeToString(unionType)}"`,
    };
  }

  const sharedDiscriminator = findSharedDiscriminator(candidates.map((candidate) => candidate.symbol));
  const disambiguationHint = sharedDiscriminator
    ? `; add "${sharedDiscriminator.fieldName}" to disambiguate`
    : "";

  const propNames = new Set(expr.properties.map((p) => p.name));

  const constDiscriminatorProp = expr.properties.find((p) => {
    if (!p.value || p.value.kind !== "string-literal") return false;
    return candidates.some((c) =>
      c.symbol.declaration.fields.some((f) => f.const_ && f.names.includes(p.name)),
    );
  });

  if (constDiscriminatorProp && constDiscriminatorProp.value?.kind === "string-literal") {
    const discValue = constDiscriminatorProp.value.parts.length === 1
      && typeof constDiscriminatorProp.value.parts[0] === "string"
      ? constDiscriminatorProp.value.parts[0]
      : null;
    if (discValue) {
      const matching = candidates.filter((c) => {
        const field = c.symbol.declaration.fields.find(
          (f) => f.const_ && f.names.includes(constDiscriminatorProp.name),
        );
        if (!field || !field.defaultValue) return false;
        if (field.defaultValue.kind === "string-literal") {
          return field.defaultValue.parts.length === 1 && field.defaultValue.parts[0] === discValue;
        }
        return false;
      });

      if (matching.length === 1) {
        const sym = matching[0].symbol;
        const fieldParams = getConstructorParams(host, sym, table, false);
        inferObjectLiteralProperties(host, expr, scope, table, info, (propName) =>
          fieldParams.find((p) => p.name === propName)?.type,
        );
        validateNamedConstructorArgs(host, sym, expr.properties, false, table, info, expr.span);
        return { resolvedType: matching[0] };
      }

      return {
        resolvedType: null,
        diagnostic: `Object literal discriminator "${constDiscriminatorProp.name}" value "${discValue}" does not match any class in union type "${typeToString(unionType)}"`,
      };
    }
  }

  const matching = candidates.filter((c) => {
    const allFieldNames = new Set<string>();
    for (const f of c.symbol.declaration.fields) {
      for (const n of f.names) allFieldNames.add(n);
    }
    return [...propNames].every((n) => allFieldNames.has(n));
  });

  if (matching.length === 0) {
    return {
      resolvedType: null,
      diagnostic: `Object literal does not match any class in union type "${typeToString(unionType)}"${disambiguationHint}`,
    };
  }

  if (matching.length > 1) {
    return {
      resolvedType: null,
      diagnostic: `Object literal is ambiguous for union type "${typeToString(unionType)}"${disambiguationHint}`,
    };
  }

  const sym = matching[0].symbol;
  const fieldParams = getConstructorParams(host, sym, table, false);
  inferObjectLiteralProperties(host, expr, scope, table, info, (propName) =>
    fieldParams.find((p) => p.name === propName)?.type,
  );
  validateNamedConstructorArgs(host, sym, expr.properties, false, table, info, expr.span);
  return { resolvedType: matching[0] };
}

// ============================================================================
// As narrowing expression
// ============================================================================

/**
 * Validate an `expr as T` narrowing and return `Result<T, string>`.
 *
 * v1 support matrix:
 * - `U1 | U2 | ... -> T` — T must be an exact union member
 * - `Interface -> ConcreteClass` — interface lowers to closed-world variant
 * - `T | null -> T` — nullable narrowing
 * - `Result<V, F> -> Result<T, F | string>` — narrow the success channel
 * - `T -> T` — identity fast path (unconditional success)
 */
function inferAsNarrowType(
  sourceType: ResolvedType,
  targetType: ResolvedType,
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
): ResolvedType {
  if (sourceType.kind === "unknown") {
    return UNKNOWN_TYPE; // prior error — suppress cascade
  }
  if (targetType.kind === "unknown") {
    info.diagnostics.push({
      severity: "error",
      message: `"as" narrowing target type could not be resolved`,
      span,
      module: table.path,
    });
    return UNKNOWN_TYPE;
  }

  if (sourceType.kind === "result") {
    if (!isValidAsNarrow(sourceType.successType, targetType)) {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot narrow "${typeToString(sourceType)}" to "${typeToString(targetType)}" with "as"; source must be a union, an interface, nullable, or Result thereof`,
        span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }

    return {
      kind: "result",
      successType: targetType,
      errorType: widenAsNarrowErrorType(sourceType.errorType),
    };
  }

  if (!isValidAsNarrow(sourceType, targetType)) {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot narrow "${typeToString(sourceType)}" to "${typeToString(targetType)}" with "as"; source must be a union, an interface, nullable, or Result thereof`,
      span,
      module: table.path,
    });
    return UNKNOWN_TYPE;
  }

  const resultType: ResolvedType = {
    kind: "result",
    successType: targetType,
    errorType: STRING_TYPE,
  };
  return resultType;
}

function widenAsNarrowErrorType(errorType: ResolvedType): ResolvedType {
  const combinedTypes: ResolvedType[] = [];
  const seen = new Set<string>();

  const pushUnique = (type: ResolvedType) => {
    if (type.kind === "union") {
      for (const member of type.types) pushUnique(member);
      return;
    }

    const key = typeToString(type);
    if (!seen.has(key)) {
      seen.add(key);
      combinedTypes.push(type);
    }
  };

  pushUnique(errorType);
  pushUnique(STRING_TYPE);

  return combinedTypes.length === 1 ? combinedTypes[0] : { kind: "union", types: combinedTypes };
}

/**
 * Check whether `expr as T` is a valid narrowing in v1.
 */
function isValidAsNarrow(sourceType: ResolvedType, targetType: ResolvedType): boolean {
  // Identity: T -> T is always valid
  if (typesEqual(sourceType, targetType)) return true;

  if (isNumericAsTarget(sourceType, targetType)) return true;

  // JsonValue -> exact runtime member, treated as a canonical JSON sum type
  if (isJsonValueType(sourceType)) {
    const runtimeTarget = normalizeTypeForRuntime(targetType);
    return sourceType.types.some((member) => isValidAsNarrow(member, runtimeTarget));
  }

  // T | null -> T (nullable narrowing: target is the non-null part)
  if (sourceType.kind === "union") {
    const nonNull = sourceType.types.filter((t) => t.kind !== "null");
    const hasNull = nonNull.length < sourceType.types.length;

    // T | null -> T
    if (hasNull && nonNull.length === 1 && typesEqual(nonNull[0], targetType)) return true;

    // Union member extraction: U1 | U2 | ... -> T where T is an exact member
    // or a numeric member can be converted to T with checked runtime conversion.
    if (sourceType.types.some((member) => isValidAsNarrow(member, targetType))) return true;
  }

  // Interface -> ConcreteClass
  if (sourceType.kind === "interface" && targetType.kind === "class") return true;

  return false;
}

function isNumericAsTarget(sourceType: ResolvedType, targetType: ResolvedType): boolean {
  return sourceType.kind === "primitive"
    && targetType.kind === "primitive"
    && NUMERIC_PRIMITIVE_NAMES.has(sourceType.name)
    && NUMERIC_PRIMITIVE_NAMES.has(targetType.name);
}