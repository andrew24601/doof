import type { Block, Expression, SourceSpan, Statement } from "./ast.js";
import {
  finalizeDeclaredCollectionType,
  getCollectionTypeAnnotationInfo,
  validateCollectionTypeAnnotation,
} from "./checker-collection-annotations.js";
import {
  applyDeepReadonly,
  findDeepReadonlyViolation,
} from "./checker-readonly.js";
import {
  computeElseNarrowType,
  findUnsupportedHashCollectionConstraint,
  formatUnsupportedHashCollectionConstraintMessage,
  isAssignableTo,
  type Binding,
  type ModuleTypeInfo,
  type ResolvedType,
  type Scope,
  typeToString,
  UNKNOWN_TYPE,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";
import type { CheckerHost } from "./checker-internal.js";
import { resolveExpectedEnumType } from "./checker-expr-ops.js";
import { buildCaseArmScope } from "./checker-result.js";
import { inferMemberType } from "./checker-member.js";

type ValueBindingStatement = Extract<Statement,
  | { kind: "const-declaration" }
  | { kind: "readonly-declaration" }
  | { kind: "let-declaration" }
  | { kind: "immutable-binding" }
>;

type DestructuringAssignmentStatement = Extract<Statement,
  | { kind: "array-destructuring-assignment" }
  | { kind: "positional-destructuring-assignment" }
  | { kind: "named-destructuring-assignment" }
>;

export function checkStatements(
  host: CheckerHost,
  stmts: Statement[],
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  for (const stmt of stmts) {
    checkStatement(host, stmt, scope, table, info);
  }
}

export function checkStatement(
  host: CheckerHost,
  stmt: Statement,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  switch (stmt.kind) {
    case "mock-import-directive":
      break;

    case "const-declaration":
    case "readonly-declaration": {
      if (stmt.type) {
        validateCollectionTypeAnnotation(stmt.type, stmt.type.span, table, info, { allowOmittedTypeArgs: true });
      }
      const collectionAnnotation = getCollectionTypeAnnotationInfo(stmt.type);
      const resolvedDeclaredType = stmt.type
        ? host.resolveTypeAnnotation(stmt.type, table)
        : null;
      const declaredType = stmt.kind === "readonly-declaration" && resolvedDeclaredType
        ? applyDeepReadonly(resolvedDeclaredType)
        : resolvedDeclaredType;
      if (declaredType) {
        reportUnsupportedHashCollectionConstraint(declaredType, stmt.type?.span ?? stmt.span, table, info);
      }
      const inferredType = host.inferExprType(stmt.value, scope, table, info, declaredType ?? undefined);
      const finalizedType = finalizeDeclaredCollectionType(
        stmt.type,
        declaredType,
        inferredType,
        stmt.value,
        table,
        info,
      );
      const type = stmt.kind === "readonly-declaration"
        ? applyDeepReadonly(finalizedType)
        : finalizedType;
      stmt.resolvedType = type;

      const effectiveDeclaredType = collectionAnnotation?.omitsTypeArgs ? type : declaredType;
      const assignabilityType = collectionAnnotation?.omitsTypeArgs ? type : inferredType;
      if (effectiveDeclaredType && !isAssignableTo(assignabilityType, effectiveDeclaredType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Type "${typeToString(assignabilityType)}" is not assignable to type "${typeToString(effectiveDeclaredType)}"`,
          span: stmt.span,
          module: table.path,
        });
      }

      if (stmt.kind === "readonly-declaration") {
        const violation = findDeepReadonlyViolation(host, type, table);
        if (violation) {
          info.diagnostics.push({
            severity: "error",
            message: `Readonly declaration requires a deeply immutable type, but "${typeToString(type)}" is not deeply immutable: ${violation.reason}`,
            span: stmt.span,
            module: table.path,
          });
        }
      }

      reportUnresolvedObjectLiteralBindingType(stmt, type, info, table.path, stmt.value.span);
      registerValueBinding(stmt, scope, table, info, type);
      break;
    }

    case "let-declaration": {
      if (stmt.type) {
        validateCollectionTypeAnnotation(stmt.type, stmt.type.span, table, info, { allowOmittedTypeArgs: true });
      }
      const collectionAnnotation = getCollectionTypeAnnotationInfo(stmt.type);
      const declaredType = stmt.type
        ? host.resolveTypeAnnotation(stmt.type, table)
        : null;
      if (declaredType) {
        reportUnsupportedHashCollectionConstraint(declaredType, stmt.type?.span ?? stmt.span, table, info);
      }
      const inferredType = host.inferExprType(stmt.value, scope, table, info, declaredType ?? undefined);
      const type = finalizeDeclaredCollectionType(
        stmt.type,
        declaredType,
        inferredType,
        stmt.value,
        table,
        info,
      );
      stmt.resolvedType = type;

      const effectiveDeclaredType = collectionAnnotation?.omitsTypeArgs ? type : declaredType;
      const assignabilityType = collectionAnnotation?.omitsTypeArgs ? type : inferredType;
      if (effectiveDeclaredType && !isAssignableTo(assignabilityType, effectiveDeclaredType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Type "${typeToString(assignabilityType)}" is not assignable to type "${typeToString(effectiveDeclaredType)}"`,
          span: stmt.span,
          module: table.path,
        });
      }

      reportUnresolvedObjectLiteralBindingType(stmt, type, info, table.path, stmt.value.span);
      registerValueBinding(stmt, scope, table, info, type);
      break;
    }

    case "immutable-binding": {
      if (stmt.type) {
        validateCollectionTypeAnnotation(stmt.type, stmt.type.span, table, info, { allowOmittedTypeArgs: true });
      }
      const collectionAnnotation = getCollectionTypeAnnotationInfo(stmt.type);
      const declaredType = stmt.type
        ? host.resolveTypeAnnotation(stmt.type, table)
        : null;
      if (declaredType) {
        reportUnsupportedHashCollectionConstraint(declaredType, stmt.type?.span ?? stmt.span, table, info);
      }
      const inferredType = host.inferExprType(stmt.value, scope, table, info, declaredType ?? undefined);
      const type = finalizeDeclaredCollectionType(
        stmt.type,
        declaredType,
        inferredType,
        stmt.value,
        table,
        info,
      );
      stmt.resolvedType = type;

      const effectiveDeclaredType = collectionAnnotation?.omitsTypeArgs ? type : declaredType;
      const assignabilityType = collectionAnnotation?.omitsTypeArgs ? type : inferredType;
      if (effectiveDeclaredType && !isAssignableTo(assignabilityType, effectiveDeclaredType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Type "${typeToString(assignabilityType)}" is not assignable to type "${typeToString(effectiveDeclaredType)}"`,
          span: stmt.span,
          module: table.path,
        });
      }

      reportUnresolvedObjectLiteralBindingType(stmt, type, info, table.path, stmt.value.span);
      registerValueBinding(stmt, scope, table, info, type);
      break;
    }

    case "function-declaration":
      host.checkFunction(stmt, scope, table, info);
      break;

    case "class-declaration":
      host.checkClass(stmt, scope, table, info);
      break;

    case "if-statement": {
      const condType = host.inferExprType(stmt.condition, scope, table, info);
      host.checkConditionIsBool(condType, stmt.condition, table, info);

      const nullNarrow = host.extractNullNarrowing(stmt.condition, scope);
      if (nullNarrow) {
        if (nullNarrow.operator === "!=") {
          const thenScope = host.pushScope(scope, "block");
          thenScope.bindings.set(nullNarrow.name, { ...nullNarrow.binding, type: nullNarrow.narrowedType });
          host.checkStatements(stmt.body.statements, thenScope, table, info);
          if (stmt.else_) host.checkBlock(stmt.else_, scope, table, info);
        } else {
          host.checkBlock(stmt.body, scope, table, info);
          if (stmt.else_) {
            const elseScope = host.pushScope(scope, "block");
            elseScope.bindings.set(nullNarrow.name, { ...nullNarrow.binding, type: nullNarrow.narrowedType });
            host.checkStatements(stmt.else_.statements, elseScope, table, info);
          }
        }
      } else {
        host.checkBlock(stmt.body, scope, table, info);
        if (stmt.else_) host.checkBlock(stmt.else_, scope, table, info);
      }
      for (const ei of stmt.elseIfs) {
        const eiCondType = host.inferExprType(ei.condition, scope, table, info);
        host.checkConditionIsBool(eiCondType, ei.condition, table, info);
        host.checkBlock(ei.body, scope, table, info);
      }
      break;
    }

    case "while-statement": {
      const condType = host.inferExprType(stmt.condition, scope, table, info);
      host.checkConditionIsBool(condType, stmt.condition, table, info);
      host.checkBlock(stmt.body, scope, table, info);
      if (stmt.then_) host.checkBlock(stmt.then_, scope, table, info);
      break;
    }

    case "for-statement": {
      const forScope = host.pushScope(scope, "block");
      if (stmt.init) host.checkStatement(stmt.init, forScope, table, info);
      if (stmt.condition) host.inferExprType(stmt.condition, forScope, table, info);
      for (const upd of stmt.update) host.inferExprType(upd, forScope, table, info);
      host.checkBlock(stmt.body, forScope, table, info);
      if (stmt.then_) host.checkBlock(stmt.then_, scope, table, info);
      break;
    }

    case "for-of-statement": {
      const forScope = host.pushScope(scope, "block");
      const iterableType = host.inferExprType(stmt.iterable, scope, table, info);
      const elemType = iterableType.kind === "array"
        ? iterableType.elementType
        : iterableType.kind === "set"
          ? iterableType.elementType
        : iterableType.kind === "stream"
          ? iterableType.elementType
        : isRangeExpression(stmt.iterable)
          ? iterableType
          : UNKNOWN_TYPE;

      if (iterableType.kind === "map" && stmt.bindings.length === 2) {
        forScope.bindings.set(stmt.bindings[0], {
          name: stmt.bindings[0],
          kind: "immutable-binding",
          type: iterableType.keyType,
          mutable: false,
          span: stmt.span,
          module: table.path,
        });
        forScope.bindings.set(stmt.bindings[1], {
          name: stmt.bindings[1],
          kind: "immutable-binding",
          type: iterableType.valueType,
          mutable: false,
          span: stmt.span,
          module: table.path,
        });
      } else if (stmt.bindings.length === 1) {
        forScope.bindings.set(stmt.bindings[0], {
          name: stmt.bindings[0],
          kind: "immutable-binding",
          type: elemType,
          mutable: false,
          span: stmt.span,
          module: table.path,
        });
      } else {
        const fieldTypes = host.getPositionalFieldTypes(elemType, table);
        for (let i = 0; i < stmt.bindings.length; i++) {
          forScope.bindings.set(stmt.bindings[i], {
            name: stmt.bindings[i],
            kind: "immutable-binding",
            type: i < fieldTypes.length ? fieldTypes[i] : UNKNOWN_TYPE,
            mutable: false,
            span: stmt.span,
            module: table.path,
          });
        }
      }

      host.checkBlock(stmt.body, forScope, table, info);
      if (stmt.then_) host.checkBlock(stmt.then_, scope, table, info);
      break;
    }

    case "with-statement": {
      const withScope = host.pushScope(scope, "block");
      for (const binding of stmt.bindings) {
        const declaredType = binding.type
          ? host.resolveTypeAnnotation(binding.type, table)
          : null;
        if (declaredType) {
          reportUnsupportedHashCollectionConstraint(declaredType, binding.type?.span ?? binding.span, table, info);
        }
        const inferredType = host.inferExprType(binding.value, withScope, table, info, declaredType ?? undefined);
        const type = declaredType ?? inferredType;
        binding.resolvedType = type;

        if (declaredType && !isAssignableTo(inferredType, declaredType)) {
          info.diagnostics.push({
            severity: "error",
            message: `Type "${typeToString(inferredType)}" is not assignable to type "${typeToString(declaredType)}"`,
            span: binding.span,
            module: table.path,
          });
        }

        withScope.bindings.set(binding.name, {
          name: binding.name,
          kind: "immutable-binding",
          type,
          mutable: false,
          span: binding.span,
          module: table.path,
        });
      }
      host.checkBlock(stmt.body, withScope, table, info);
      break;
    }

    case "return-statement": {
      if (scope.inTrailingLambda) {
        info.diagnostics.push({
          severity: "error",
          message: "'return' cannot be used inside a trailing lambda body; use an explicit lambda instead",
          span: stmt.span,
          module: table.path,
        });
        break;
      }
      if (scope.inCaseExpressionArm) {
        info.diagnostics.push({
          severity: "error",
          message: "'return' cannot be used inside a case-expression arm; use a case-statement if you need early exit",
          span: stmt.span,
          module: table.path,
        });
        break;
      }
      if (scope.inCatchExpressionBody) {
        info.diagnostics.push({
          severity: "error",
          message: "'return' cannot be used inside a catch expression in expression position",
          span: stmt.span,
          module: table.path,
        });
        break;
      }
      if (stmt.value) {
        const expectedReturn = host.findReturnType(scope);
        const returnType = host.inferExprType(stmt.value, scope, table, info, expectedReturn ?? undefined);
        if (expectedReturn && !isAssignableTo(returnType, expectedReturn)) {
          info.diagnostics.push({
            severity: "error",
            message: `Type "${typeToString(returnType)}" is not assignable to return type "${typeToString(expectedReturn)}"`,
            span: stmt.span,
            module: table.path,
          });
        }
      } else {
        const expectedReturn = host.findReturnType(scope);
        if (expectedReturn && expectedReturn.kind !== "void" && expectedReturn.kind !== "unknown") {
          info.diagnostics.push({
            severity: "error",
            message: `A function with return type "${typeToString(expectedReturn)}" must return a value`,
            span: stmt.span,
            module: table.path,
          });
        }
      }
      break;
    }

    case "yield-statement": {
      if (!scope.caseExpressionYield) {
        info.diagnostics.push({
          severity: "error",
          message: "'yield' can only be used inside a block case-expression arm",
          span: stmt.span,
          module: table.path,
        });
        break;
      }

      const expectedType = scope.caseExpressionYield.type ?? undefined;
      const valueType = host.inferExprType(stmt.value, scope, table, info, expectedType);
      const yieldState = scope.caseExpressionYield;

      if (!yieldState.type || yieldState.type.kind === "unknown") {
        yieldState.type = valueType;
      } else if (isAssignableTo(valueType, yieldState.type)) {
        // keep the existing expected type
      } else if (isAssignableTo(yieldState.type, valueType)) {
        yieldState.type = valueType;
      } else {
        info.diagnostics.push({
          severity: "error",
          message: `Type "${typeToString(valueType)}" is not assignable to yielded type "${typeToString(yieldState.type)}"`,
          span: stmt.value.span,
          module: table.path,
        });
      }

      yieldState.hasYield = true;
      break;
    }

    case "case-statement": {
      const subjectType = host.inferExprType(stmt.subject, scope, table, info);
      const expectedEnumType = resolveExpectedEnumType(subjectType);

      for (const arm of stmt.arms) {
        for (const pattern of arm.patterns) {
          if (pattern.kind === "value-pattern") {
            host.inferExprType(pattern.value, scope, table, info, expectedEnumType);
          } else if (pattern.kind === "range-pattern") {
            if (pattern.start) host.inferExprType(pattern.start, scope, table, info, expectedEnumType);
            if (pattern.end) host.inferExprType(pattern.end, scope, table, info, expectedEnumType);
          }
        }

        const armScope = buildCaseArmScope(host, arm, subjectType, scope, table, info);
        if (arm.body.kind === "block") {
          host.checkBlock(arm.body, armScope, table, info);
        } else {
          const bodyType = host.inferExprType(arm.body, armScope, table, info);
          if (bodyType.kind === "result") {
            info.diagnostics.push({
              severity: "error",
              message: "Result value must be used — assign it to a variable, unwrap it with try/try!/try?, or use it in an expression",
              span: arm.body.span,
              module: table.path,
            });
          }
        }
      }
      break;
    }

    case "expression-statement": {
      const exprType = host.inferExprType(stmt.expression, scope, table, info);
      if (exprType.kind === "result") {
        info.diagnostics.push({
          severity: "error",
          message: "Result value must be used — assign it to a variable, unwrap it with try/try!/try?, or use it in an expression",
          span: stmt.span,
          module: table.path,
        });
      }
      break;
    }

    case "export-declaration":
      host.checkStatement(stmt.declaration, scope, table, info);
      break;

    case "positional-destructuring": {
      const valueType = host.inferExprType(stmt.value, scope, table, info);
      const fieldTypes = host.getPositionalFieldTypes(valueType, table);
      for (let i = 0; i < stmt.bindings.length; i++) {
        if (stmt.bindings[i] === "_") continue;
        scope.bindings.set(stmt.bindings[i], {
          name: stmt.bindings[i],
          kind: stmt.bindingKind === "let" ? "let" : "immutable-binding",
          type: i < fieldTypes.length ? fieldTypes[i] : UNKNOWN_TYPE,
          mutable: stmt.bindingKind === "let",
          span: stmt.span,
          module: table.path,
        });
      }
      break;
    }

    case "array-destructuring": {
      const valueType = host.inferExprType(stmt.value, scope, table, info);
      const elementType = valueType.kind === "array"
        ? valueType.elementType
        : UNKNOWN_TYPE;

      if (valueType.kind !== "array") {
        info.diagnostics.push({
          severity: "error",
          message: `Array destructuring requires a T[] value, but got "${typeToString(valueType)}"`,
          span: stmt.value.span,
          module: table.path,
        });
      }

      for (const name of stmt.bindings) {
        if (name === "_") continue;
        scope.bindings.set(name, {
          name,
          kind: stmt.bindingKind === "let" ? "let" : "immutable-binding",
          type: elementType,
          mutable: stmt.bindingKind === "let",
          span: stmt.span,
          module: table.path,
        });
      }
      break;
    }

    case "named-destructuring": {
      const valueType = host.inferExprType(stmt.value, scope, table, info);
      for (const binding of stmt.bindings) {
        const localName = binding.alias ?? binding.name;
        const fieldType = host.lookupFieldType(valueType, binding.name, table);
        scope.bindings.set(localName, {
          name: localName,
          kind: stmt.bindingKind === "let" ? "let" : "immutable-binding",
          type: fieldType,
          mutable: stmt.bindingKind === "let",
          span: binding.span,
          module: table.path,
        });
      }
      break;
    }

    case "positional-destructuring-assignment":
    case "array-destructuring-assignment":
    case "named-destructuring-assignment":
      checkDestructuringAssignment(host, stmt, scope, table, info);
      break;

    case "block":
      host.checkBlock(stmt, scope, table, info);
      break;

    case "else-narrow-statement": {
      const declaredType = stmt.type
        ? host.resolveTypeAnnotation(stmt.type, table)
        : null;
      const subjectType = host.inferExprType(stmt.subject, scope, table, info, declaredType ?? undefined);
      const fullType = declaredType ?? subjectType;
      const { narrowedType, applicable } = computeElseNarrowType(fullType);

      if (!applicable) {
        info.diagnostics.push({
          severity: "error",
          message: `Else-narrow requires a Result or nullable type, but got "${typeToString(fullType)}"`,
          span: stmt.span,
          module: table.path,
        });
      }

      const elseScope = host.pushScope(scope, "block");
      elseScope.bindings.set(stmt.name, {
        name: stmt.name,
        kind: "immutable-binding",
        type: fullType,
        mutable: false,
        span: stmt.span,
        module: table.path,
      });
      host.checkBlock(stmt.elseBlock, elseScope, table, info);

      if (!host.blockAlwaysExits(stmt.elseBlock)) {
        info.diagnostics.push({
          severity: "error",
          message: "Else-narrow block must exit scope via return, break, or continue",
          span: stmt.elseBlock.span,
          module: table.path,
        });
      }

      stmt.resolvedType = narrowedType;
      scope.bindings.set(stmt.name, {
        name: stmt.name,
        kind: "immutable-binding",
        type: narrowedType,
        mutable: false,
        span: stmt.span,
        module: table.path,
      });
      break;
    }

    case "try-statement":
      if (scope.inCaseExpressionArm && host.catchErrorTypes.length === 0) {
        info.diagnostics.push({
          severity: "error",
          message: "'try' cannot be used inside a case-expression arm; use a case-statement if you need early exit",
          span: stmt.span,
          module: table.path,
        });
        break;
      }
      host.checkTryStatement(stmt.binding, scope, table, info, stmt.span);
      break;

    default:
      break;
  }
}

export function checkBlock(
  host: CheckerHost,
  block: Block,
  parentScope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  const blockScope = host.pushScope(parentScope, "block");
  host.checkStatements(block.statements, blockScope, table, info);
}

export function checkDestructuringAssignment(
  host: CheckerHost,
  stmt: DestructuringAssignmentStatement,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  sourceType?: ResolvedType,
): void {
  const valueType = sourceType ?? host.inferExprType(stmt.value, scope, table, info);

  switch (stmt.kind) {
    case "array-destructuring-assignment": {
      if (valueType.kind !== "array") {
        info.diagnostics.push({
          severity: "error",
          message: `Array destructuring requires a T[] value, but got "${typeToString(valueType)}"`,
          span: stmt.value.span,
          module: table.path,
        });
        return;
      }

      for (const name of stmt.bindings) {
        if (name === "_") continue;
        validateDestructuringAssignmentTarget(host, name, valueType.elementType, stmt.span, scope, table, info);
      }
      return;
    }

    case "positional-destructuring-assignment": {
      if (valueType.kind !== "class" && valueType.kind !== "tuple") {
        info.diagnostics.push({
          severity: "error",
          message: `Positional destructuring requires a tuple or class value, but got "${typeToString(valueType)}"`,
          span: stmt.value.span,
          module: table.path,
        });
        return;
      }

      const fieldTypes = host.getPositionalFieldTypes(valueType, table);
      if (fieldTypes.length < stmt.bindings.length) {
        info.diagnostics.push({
          severity: "error",
          message: `Positional destructuring expected at least ${stmt.bindings.length} values, but got ${fieldTypes.length}`,
          span: stmt.span,
          module: table.path,
        });
      }

      for (let i = 0; i < stmt.bindings.length; i++) {
        const name = stmt.bindings[i];
        if (name === "_") continue;
        validateDestructuringAssignmentTarget(
          host,
          name,
          i < fieldTypes.length ? fieldTypes[i] : UNKNOWN_TYPE,
          stmt.span,
          scope,
          table,
          info,
        );
      }
      return;
    }

    case "named-destructuring-assignment": {
      for (const binding of stmt.bindings) {
        const localName = binding.alias ?? binding.name;
        const fieldType = inferMemberType(host, valueType, binding.name, table, "instance", info, binding.span);
        validateDestructuringAssignmentTarget(host, localName, fieldType, binding.span, scope, table, info);
      }
      return;
    }
  }
}

function registerValueBinding(
  stmt: ValueBindingStatement,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  type: ResolvedType,
): void {
  const existing = scope.bindings.get(stmt.name);
  if (existing) {
    if (isPredeclaredBindingForStatement(existing, stmt, table.path)) {
      existing.type = type;
      return;
    }

    info.diagnostics.push({
      severity: "error",
      message: `Variable "${stmt.name}" is already declared in this scope`,
      span: stmt.span,
      module: table.path,
    });
    return;
  }

  scope.bindings.set(stmt.name, {
    name: stmt.name,
    kind: statementToBindingKind(stmt.kind),
    type,
    mutable: stmt.kind === "let-declaration",
    span: stmt.span,
    module: table.path,
  });
}

function statementToBindingKind(
  kind: ValueBindingStatement["kind"],
): Binding["kind"] {
  switch (kind) {
    case "const-declaration":
      return "const";
    case "readonly-declaration":
      return "readonly";
    case "let-declaration":
      return "let";
    case "immutable-binding":
      return "immutable-binding";
  }
}

function isPredeclaredBindingForStatement(
  binding: Binding,
  stmt: ValueBindingStatement,
  modulePath: string,
): boolean {
  return binding.module === modulePath
    && spansEqual(binding.span, stmt.span)
    && binding.kind === statementToBindingKind(stmt.kind);
}

function spansEqual(left: SourceSpan, right: SourceSpan): boolean {
  return left.start.offset === right.start.offset
    && left.end.offset === right.end.offset;
}

function reportUnresolvedObjectLiteralBindingType(
  stmt: ValueBindingStatement,
  type: ResolvedType,
  info: ModuleTypeInfo,
  modulePath: string,
  valueSpan: SourceSpan,
): void {
  if (type.kind !== "unknown") return;
  if (stmt.value.kind !== "object-literal") return;
  if (hasDiagnosticAtSpan(info, modulePath, valueSpan)) return;

  info.diagnostics.push({
    severity: "error",
    message: `Could not infer type for "${stmt.name}"; provide an explicit type annotation`,
    span: stmt.span,
    module: modulePath,
  });
}

function reportUnsupportedHashCollectionConstraint(
  type: ResolvedType,
  span: SourceSpan,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  const issue = findUnsupportedHashCollectionConstraint(type);
  if (!issue) return;

  info.diagnostics.push({
    severity: "error",
    message: formatUnsupportedHashCollectionConstraintMessage(issue),
    span,
    module: table.path,
  });
}

function hasDiagnosticAtSpan(
  info: ModuleTypeInfo,
  modulePath: string,
  span: SourceSpan,
): boolean {
  return info.diagnostics.some((diagnostic) =>
    diagnostic.module === modulePath
      && spansEqual(diagnostic.span, span),
  );
}

function validateDestructuringAssignmentTarget(
  host: CheckerHost,
  name: string,
  sourceType: ResolvedType,
  span: SourceSpan,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  const binding = host.lookupBinding(name, scope);
  if (!binding) {
    info.diagnostics.push({
      severity: "error",
      message: `Undefined identifier "${name}"`,
      span,
      module: table.path,
    });
    return;
  }

  if (!binding.mutable) {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot assign to "${name}" because it is ${binding.kind === "const" ? "a constant" : binding.kind === "readonly" ? "readonly" : "an immutable binding"}`,
      span,
      module: table.path,
    });
  }

  if (!isAssignableTo(sourceType, binding.type)) {
    info.diagnostics.push({
      severity: "error",
      message: `Type "${typeToString(sourceType)}" is not assignable to type "${typeToString(binding.type)}"`,
      span,
      module: table.path,
    });
  }
}

function isRangeExpression(expr: Expression): boolean {
  return expr.kind === "binary-expression"
    && (expr.operator === ".." || expr.operator === "..<");
}