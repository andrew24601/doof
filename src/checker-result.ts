import type { CaseArm, CatchExpression, Expression, SourceSpan, TryBinding } from "./ast.js";
import {
  isAssignableTo,
  getResultShape,
  NULL_TYPE,
  type ModuleTypeInfo,
  type ResolvedType,
  type ResultShape,
  type Scope,
  typeToString,
  UNKNOWN_TYPE,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";
import type { CheckerHost } from "./checker-internal.js";
import { checkDestructuringAssignment } from "./checker-stmt.js";

function isCompatibleCasePatternType(patternType: ResolvedType, subjectType: ResolvedType): boolean {
  return isAssignableTo(patternType, subjectType) || isAssignableTo(subjectType, patternType);
}

export function buildCaseArmScope(
  host: CheckerHost,
  arm: CaseArm,
  subjectType: ResolvedType,
  parentScope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): Scope {
  const result = getResultShape(subjectType);
  if (result) {
    return buildResultArmScope(host, arm, result, parentScope);
  }

  const armScope = host.pushScope(parentScope, "block");
  for (const pattern of arm.patterns) {
    if (pattern.kind !== "type-pattern") continue;
    if (pattern.name === "_") continue;

    const patternType = host.resolveTypeAnnotation(pattern.type, table);
    if (!isCompatibleCasePatternType(patternType, subjectType)) {
      info.diagnostics.push({
        severity: "error",
        message: `Pattern type "${typeToString(patternType)}" is not compatible with case subject type "${typeToString(subjectType)}"`,
        span: pattern.span,
        module: table.path,
      });
      continue;
    }

    armScope.bindings.set(pattern.name, {
      name: pattern.name,
      kind: "const",
      type: patternType,
      mutable: false,
      span: pattern.span,
      module: table.path,
    });
  }

  return armScope;
}

export function buildResultArmScope(
  host: CheckerHost,
  arm: CaseArm,
  subjectType: ResultShape,
  parentScope: Scope,
): Scope {
  const armScope = host.pushScope(parentScope, "block");
  for (const pattern of arm.patterns) {
    if (pattern.kind !== "type-pattern") continue;
    const typeName = pattern.type.kind === "named-type" ? pattern.type.name : null;
    if (typeName === "Success" && pattern.name !== "_") {
      armScope.bindings.set(pattern.name, {
        name: pattern.name,
        kind: "const",
        type: subjectType.successArm,
        mutable: false,
        span: pattern.span,
        module: "",
      });
    } else if (typeName === "Failure" && pattern.name !== "_") {
      armScope.bindings.set(pattern.name, {
        name: pattern.name,
        kind: "const",
        type: subjectType.failureArm,
        mutable: false,
        span: pattern.span,
        module: "",
      });
    }
  }
  return armScope;
}

export function checkCatchExpression(
  host: CheckerHost,
  expr: CatchExpression,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): ResolvedType {
  const errorTypes: ResolvedType[] = [];
  host.catchErrorTypes.push(errorTypes);

  const catchScope = host.pushScope(scope, "block");
  host.checkStatements(expr.body, catchScope, table, info);
  host.catchErrorTypes.pop();

  if (errorTypes.length === 0) {
    info.diagnostics.push({
      severity: "warning",
      message: "catch block contains no 'try' statements",
      span: expr.span,
      module: table.path,
    });
    return NULL_TYPE;
  }

  const seen = new Set<string>();
  const uniqueErrors: ResolvedType[] = [];
  for (const et of errorTypes) {
    const key = typeToString(et);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueErrors.push(et);
    }
  }

  if (uniqueErrors.length === 1) {
    const resultType: ResolvedType = { kind: "union", types: [uniqueErrors[0], NULL_TYPE] };
    expr.resolvedType = resultType;
    return resultType;
  }

  const resultType: ResolvedType = { kind: "union", types: [...uniqueErrors, NULL_TYPE] };
  expr.resolvedType = resultType;
  return resultType;
}

export function checkTryStatement(
  host: CheckerHost,
  binding: TryBinding,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  span: SourceSpan,
): void {
  if (binding.kind === "expression-statement") {
    host.inferExprType(binding.expression, scope, table, info);
  } else if (
    binding.kind === "array-destructuring-assignment"
    || binding.kind === "positional-destructuring-assignment"
    || binding.kind === "named-destructuring-assignment"
  ) {
    host.inferExprType(binding.value, scope, table, info);
  } else if (binding.kind === "positional-destructuring" && binding.bindings.includes("_")) {
    host.inferExprType(binding.value, scope, table, info);
    for (let i = 0; i < binding.bindings.length; i++) {
      const name = binding.bindings[i];
      if (name === "_") continue;
      scope.bindings.set(name, {
        name,
        kind: binding.bindingKind === "let" ? "let" : "immutable-binding",
        type: UNKNOWN_TYPE,
        mutable: binding.bindingKind === "let",
        span: binding.span,
        module: table.path,
      });
    }
  } else if (binding.kind === "array-destructuring") {
    host.inferExprType(binding.value, scope, table, info);
    for (const name of binding.bindings) {
      if (name === "_") continue;
      scope.bindings.set(name, {
        name,
        kind: binding.bindingKind === "let" ? "let" : "immutable-binding",
        type: UNKNOWN_TYPE,
        mutable: binding.bindingKind === "let",
        span: binding.span,
        module: table.path,
      });
    }
  } else {
    host.checkStatement(binding, scope, table, info);
  }

  const rhsExpr = host.getTryBindingValue(binding);
  if (!rhsExpr) return;

  const rhsType = rhsExpr.resolvedType ?? UNKNOWN_TYPE;
  if (rhsType.kind === "unknown") return;
  const rhsResult = getResultShape(rhsType);
  if (!rhsResult) {
    info.diagnostics.push({
      severity: "error",
      message: `"try" can only be applied to a Result type, but got "${typeToString(rhsType)}"`,
      span,
      module: table.path,
    });
    return;
  }

  if (host.catchErrorTypes.length > 0) {
    host.catchErrorTypes[host.catchErrorTypes.length - 1].push(rhsResult.errorType);
  } else {
    const enclosingReturn = host.findReturnType(scope);
    const enclosingResult = enclosingReturn ? getResultShape(enclosingReturn) : null;
    if (enclosingReturn && !enclosingResult && enclosingReturn.kind !== "unknown") {
      info.diagnostics.push({
        severity: "error",
        message: `"try" can only be used in a function that returns Result<T, E>, but enclosing function returns "${typeToString(enclosingReturn)}"`,
        span,
        module: table.path,
      });
    }

    if (enclosingResult) {
      if (!isAssignableTo(rhsResult.errorType, enclosingResult.errorType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Error type "${typeToString(rhsResult.errorType)}" is not assignable to enclosing Result error type "${typeToString(enclosingResult.errorType)}"`,
          span,
          module: table.path,
        });
      }
    }
  }

  const isBareExpressionTry = binding.kind === "expression-statement"
    && binding.expression.kind !== "assignment-expression";
  if (rhsResult.successType.kind === "void" && !isBareExpressionTry) {
    info.diagnostics.push({
      severity: "error",
      message: '"try" on Result<void, E> cannot bind a value; use "try expr" instead',
      span,
      module: table.path,
    });
    return;
  }

  if (
    (binding.kind === "array-destructuring" || binding.kind === "array-destructuring-assignment")
    && rhsResult.successType.kind !== "array"
  ) {
    info.diagnostics.push({
      severity: "error",
      message: `Array destructuring requires a T[] value, but got "${typeToString(rhsResult.successType)}"`,
      span: binding.value.span,
      module: table.path,
    });
    return;
  }

  if (
    binding.kind === "array-destructuring-assignment"
    || binding.kind === "positional-destructuring-assignment"
    || binding.kind === "named-destructuring-assignment"
  ) {
    checkDestructuringAssignment(host, binding, scope, table, info, rhsResult.successType);
    return;
  }

  host.retypeTryBinding(binding, rhsResult.successType, scope, table);
}

export function getTryBindingValue(binding: TryBinding): Expression | null {
  switch (binding.kind) {
    case "immutable-binding":
    case "const-declaration":
    case "readonly-declaration":
    case "let-declaration":
    case "array-destructuring":
    case "positional-destructuring":
    case "named-destructuring":
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
      return binding.value;
    case "expression-statement": {
      const expr = binding.expression;
      if (expr.kind !== "assignment-expression") return expr;
      if (expr.kind === "assignment-expression") return expr.value;
      return null;
    }
    default:
      return null;
  }
}

export function retypeTryBinding(
  host: CheckerHost,
  binding: TryBinding,
  successType: ResolvedType,
  scope: Scope,
  table: ModuleSymbolTable,
): void {
  switch (binding.kind) {
    case "immutable-binding":
    case "const-declaration":
    case "readonly-declaration":
    case "let-declaration": {
      binding.resolvedType = successType;
      const b = scope.bindings.get(binding.name);
      if (b) b.type = successType;
      break;
    }
    case "array-destructuring": {
      const elementType = successType.kind === "array"
        ? successType.elementType
        : UNKNOWN_TYPE;
      for (const name of binding.bindings) {
        if (name === "_") continue;
        const b = scope.bindings.get(name);
        if (b) b.type = elementType;
      }
      break;
    }
    case "positional-destructuring": {
      const fieldTypes = host.getPositionalFieldTypes(successType, table);
      for (let i = 0; i < binding.bindings.length; i++) {
        if (binding.bindings[i] === "_") continue;
        const b = scope.bindings.get(binding.bindings[i]);
        if (b) b.type = i < fieldTypes.length ? fieldTypes[i] : UNKNOWN_TYPE;
      }
      break;
    }
    case "named-destructuring": {
      for (const db of binding.bindings) {
        const localName = db.alias ?? db.name;
        const fieldType = host.lookupFieldType(successType, db.name, table);
        const b = scope.bindings.get(localName);
        if (b) b.type = fieldType;
      }
      break;
    }
    case "array-destructuring-assignment":
    case "positional-destructuring-assignment":
    case "named-destructuring-assignment":
    case "expression-statement":
      break;
  }
}
