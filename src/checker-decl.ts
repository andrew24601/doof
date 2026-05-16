import type { ClassDeclaration, FunctionDeclaration } from "./ast.js";
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
  buildMockCallMetadata,
  isAssignableTo,
  type ModuleTypeInfo,
  type ResolvedType,
  type Scope,
  typeToString,
  UNKNOWN_TYPE,
  VOID_TYPE,
} from "./checker-types.js";
import { reportUnsupportedHashCollectionConstraint } from "./checker-diagnostics.js";
import type { ModuleSymbolTable } from "./types.js";
import type { CheckerHost } from "./checker-internal.js";
import { getUnsupportedDefaultExpressionReason } from "./default-expression.js";

function resolveTypeParamConstraintTypes(
  host: CheckerHost,
  typeParams: string[],
  typeParamConstraints: (import("./ast.js").TypeAnnotation | null)[] | undefined,
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

function addUnsupportedDefaultDiagnostic(
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  kind: "parameter" | "field",
  expr: import("./ast.js").Expression,
  contextType?: ResolvedType,
): void {
  const reason = getUnsupportedDefaultExpressionReason(expr, contextType);
  if (!reason) return;

  info.diagnostics.push({
    severity: "error",
    message: `${kind === "parameter" ? "Parameter" : "Field"} default value is not supported: ${reason}`,
    span: expr.span,
    module: table.path,
  });
}

function buildMethodBindingType(
  host: CheckerHost,
  method: FunctionDeclaration,
  classDecl: ClassDeclaration,
  table: ModuleSymbolTable,
): ResolvedType {
  const typeParamConstraints = resolveTypeParamConstraintTypes(
    host,
    method.typeParams,
    method.typeParamConstraints,
    table,
  );
  if (method.typeParams.length > 0) {
    host.typeParamStack.push(new Set(method.typeParams));
  }

  const methodType: ResolvedType = {
    kind: "function",
    params: method.params.map((param) => ({
      name: param.name,
      type: param.resolvedType ?? (param.type ? host.resolveTypeAnnotation(param.type, table) : UNKNOWN_TYPE),
      hasDefault: param.defaultValue !== null,
      defaultValue: param.defaultValue,
    })),
    returnType: method.returnType
      ? host.resolveTypeAnnotation(method.returnType, table)
      : VOID_TYPE,
    typeParams: method.typeParams.length > 0 ? method.typeParams : undefined,
    typeParamConstraints,
    mockCall: method.mock_
      ? buildMockCallMetadata(
          table.path,
          method.name,
          method.params.map((param) => ({
            name: param.name,
            type: param.resolvedType ?? (param.type ? host.resolveTypeAnnotation(param.type, table) : UNKNOWN_TYPE),
            hasDefault: param.defaultValue !== null,
            defaultValue: param.defaultValue,
          })),
          classDecl.name,
        )
      : undefined,
  };

  if (method.typeParams.length > 0) {
    host.typeParamStack.pop();
  }

  return methodType;
}

export function checkFunction(
  host: CheckerHost,
  decl: FunctionDeclaration,
  parentScope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  if (decl.mock_ && decl.typeParams.length > 0) {
    info.diagnostics.push({
      severity: "error",
      message: "Generic mock functions are not supported yet",
      span: decl.span,
      module: table.path,
    });
  }

  if (decl.typeParams.length > 0) {
    host.typeParamStack.push(new Set(decl.typeParams));
  }

  if (decl.returnType) {
    validateCollectionTypeAnnotation(decl.returnType, decl.returnType.span, table, info, { allowOmittedTypeArgs: false });
  }
  const declaredReturnType = decl.returnType
    ? host.resolveTypeAnnotation(decl.returnType, table)
    : null;
  if (declaredReturnType) {
    reportUnsupportedHashCollectionConstraint(declaredReturnType, decl.returnType?.span ?? decl.span, table, info);
  }
  const effectiveBlockReturnType = decl.body.kind === "block"
    ? (declaredReturnType ?? VOID_TYPE)
    : declaredReturnType;
  const fnScope = host.pushScope(parentScope, "function", effectiveBlockReturnType);

  for (const param of decl.params) {
    if (param.type) {
      validateCollectionTypeAnnotation(param.type, param.type.span, table, info, {
        allowOmittedTypeArgs: param.defaultValue !== null,
      });
    }
    const paramType = param.type
      ? host.resolveTypeAnnotation(param.type, table)
      : UNKNOWN_TYPE;
    if (param.type) {
      reportUnsupportedHashCollectionConstraint(paramType, param.type.span, table, info);
    }
    param.resolvedType = paramType;
    fnScope.bindings.set(param.name, {
      name: param.name,
      kind: "parameter",
      type: paramType,
      mutable: false,
      span: param.span,
      module: table.path,
    });
    if (param.defaultValue) {
      const collectionAnnotation = getCollectionTypeAnnotationInfo(param.type);
      const inferredDefaultType = host.inferExprType(param.defaultValue, fnScope, table, info, paramType, true);
      const finalizedDefaultType = finalizeDeclaredCollectionType(
        param.type,
        param.type ? paramType : null,
        inferredDefaultType,
        param.defaultValue,
        table,
        info,
      );
      const resolvedParamType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : paramType;
      const assignabilityType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : inferredDefaultType;
      const effectiveDeclaredType = collectionAnnotation?.omitsTypeArgs ? resolvedParamType : paramType;
      if (param.type) {
        param.resolvedType = resolvedParamType;
        fnScope.bindings.set(param.name, {
          name: param.name,
          kind: "parameter",
          type: resolvedParamType,
          mutable: false,
          span: param.span,
          module: table.path,
        });
      }
      if (param.type && !isAssignableTo(assignabilityType, effectiveDeclaredType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Default value of type "${typeToString(assignabilityType)}" is not assignable to parameter type "${typeToString(effectiveDeclaredType)}"`,
          span: param.defaultValue.span,
          module: table.path,
        });
      }
      addUnsupportedDefaultDiagnostic(info, table, "parameter", param.defaultValue, param.resolvedType ?? undefined);
    }
  }

  let inferredReturnType: ResolvedType;
  if (decl.body.kind === "block") {
    host.checkStatements(decl.body.statements, fnScope, table, info);
    inferredReturnType = declaredReturnType ?? VOID_TYPE;
  } else {
    inferredReturnType = host.inferExprType(decl.body, fnScope, table, info, declaredReturnType ?? undefined);
    if (declaredReturnType && !isAssignableTo(inferredReturnType, declaredReturnType)) {
      info.diagnostics.push({
        severity: "error",
        message: `Type "${typeToString(inferredReturnType)}" is not assignable to return type "${typeToString(declaredReturnType)}"`,
        span: decl.body.span,
        module: table.path,
      });
    }
    if (declaredReturnType) {
      inferredReturnType = declaredReturnType;
    }
  }

  const binding = parentScope.bindings.get(decl.name);
  if (binding && binding.type.kind === "function" && binding.type.returnType.kind === "unknown") {
    binding.type = { ...binding.type, returnType: inferredReturnType };
  }

  decl.resolvedType = {
    kind: "function",
    params: decl.params.map((p) => ({
      name: p.name,
      type: p.resolvedType ?? UNKNOWN_TYPE,
      hasDefault: p.defaultValue !== null,
      defaultValue: p.defaultValue,
    })),
    returnType: inferredReturnType,
    typeParams: decl.typeParams.length > 0 ? decl.typeParams : undefined,
    typeParamConstraints: resolveTypeParamConstraintTypes(host, decl.typeParams, decl.typeParamConstraints, table),
    mockCall: decl.mock_
      ? buildMockCallMetadata(
          table.path,
          decl.name,
          decl.params.map((p) => ({
            name: p.name,
            type: p.resolvedType ?? UNKNOWN_TYPE,
            hasDefault: p.defaultValue !== null,
            defaultValue: p.defaultValue,
          })),
        )
      : undefined,
  };

  if (decl.typeParams.length > 0) {
    host.typeParamStack.pop();
  }
}

export function checkClass(
  host: CheckerHost,
  decl: ClassDeclaration,
  parentScope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  if (decl.mock_ && decl.typeParams.length > 0) {
    info.diagnostics.push({
      severity: "error",
      message: "Generic mock classes are not supported yet",
      span: decl.span,
      module: table.path,
    });
  }

  if (decl.typeParams.length > 0) {
    host.typeParamStack.push(new Set(decl.typeParams));
  }

  const classSymbol = table.symbols.get(decl.name);
  const thisType: ResolvedType = classSymbol?.symbolKind === "class"
    ? { kind: "class", symbol: classSymbol }
    : UNKNOWN_TYPE;

  for (const field of decl.fields) {
    if (!field.type && !field.defaultValue) {
      const quotedNames = field.names.map((name) => `"${name}"`).join(", ");
      info.diagnostics.push({
        severity: "error",
        message: field.names.length === 1
          ? `Class field ${quotedNames} must have a type annotation or a default value`
          : `Class fields ${quotedNames} must have a type annotation or a default value`,
        span: field.span,
        module: table.path,
      });
      continue;
    }

    if (field.type) {
      validateCollectionTypeAnnotation(field.type, field.type.span, table, info, {
        allowOmittedTypeArgs: field.defaultValue !== null,
      });
      const resolvedFieldType = host.resolveTypeAnnotation(field.type, table);
      field.resolvedType = field.readonly_ || field.const_
        ? applyDeepReadonly(resolvedFieldType)
        : resolvedFieldType;
      reportUnsupportedHashCollectionConstraint(field.resolvedType, field.type.span, table, info);
    }
    if (field.defaultValue) {
      const collectionAnnotation = getCollectionTypeAnnotationInfo(field.type);
      const declaredFieldType = field.resolvedType ?? null;
      const inferredDefaultType = host.inferExprType(
        field.defaultValue,
        parentScope,
        table,
        info,
        declaredFieldType ?? undefined,
        true,
      );
      const finalizedDefaultType = finalizeDeclaredCollectionType(
        field.type,
        declaredFieldType,
        inferredDefaultType,
        field.defaultValue,
        table,
        info,
      );
      if (field.type) {
        const fieldType = declaredFieldType!;
        const assignabilityType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : inferredDefaultType;
        const effectiveFieldType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : fieldType;
        if (!isAssignableTo(assignabilityType, effectiveFieldType)) {
          info.diagnostics.push({
            severity: "error",
            message: `Type "${typeToString(assignabilityType)}" is not assignable to field type "${typeToString(effectiveFieldType)}"`,
            span: field.defaultValue.span,
            module: table.path,
          });
        }
        field.resolvedType = collectionAnnotation?.omitsTypeArgs
          ? ((field.readonly_ || field.const_) ? applyDeepReadonly(finalizedDefaultType) : finalizedDefaultType)
          : fieldType;
      } else if (!field.resolvedType && finalizedDefaultType.kind !== "unknown") {
        field.resolvedType = field.readonly_ || field.const_
          ? applyDeepReadonly(finalizedDefaultType)
          : finalizedDefaultType;
      }
      addUnsupportedDefaultDiagnostic(info, table, "field", field.defaultValue, field.resolvedType ?? undefined);
    }

    if ((field.readonly_ || field.const_) && field.resolvedType) {
      const violation = findDeepReadonlyViolation(host, field.resolvedType, table);
      if (violation) {
        const fieldName = field.names[0] ?? "<field>";
        info.diagnostics.push({
          severity: "error",
          message: `Readonly field "${fieldName}" requires a deeply immutable type, but "${typeToString(field.resolvedType)}" is not deeply immutable: ${violation.reason}`,
          span: field.span,
          module: table.path,
        });
      }
    }
  }

  for (const method of decl.methods) {
    if (method.name === "toJsonObject" || method.name === "fromJsonValue" || method.name === "metadata") {
      info.diagnostics.push({
        severity: "error",
        message: `"${method.name}" is a reserved intrinsic method and cannot be user-defined`,
        span: method.span,
        module: table.path,
      });
    }
  }

  for (const method of decl.methods) {
    host.checkMethod(method, decl, thisType, parentScope, table, info);
  }

  if (classSymbol?.symbolKind === "class") {
    for (const ifaceRef of decl.implements_) {
      const ifaceType = host.resolveTypeAnnotation(ifaceRef, table);
      if (ifaceType.kind === "unknown") {
        info.diagnostics.push({
          severity: "error",
          message: `Interface "${ifaceRef.name}" is not defined`,
          span: ifaceRef.span,
          module: table.path,
        });
        continue;
      }
      if (ifaceType.kind !== "interface" && ifaceType.kind !== "stream") {
        info.diagnostics.push({
          severity: "error",
          message: `"${ifaceRef.name}" is not an interface`,
          span: ifaceRef.span,
          module: table.path,
        });
        continue;
      }
      const classType: ResolvedType = { kind: "class", symbol: classSymbol };
      if (!isAssignableTo(classType, ifaceType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Class "${decl.name}" does not satisfy interface "${typeToString(ifaceType)}"`,
          span: ifaceRef.span,
          module: table.path,
        });
      }
    }
  }

  if (decl.typeParams.length > 0) {
    host.typeParamStack.pop();
  }
}

export function checkMethod(
  host: CheckerHost,
  method: FunctionDeclaration,
  classDecl: ClassDeclaration,
  thisType: ResolvedType,
  parentScope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  if (method.mock_ && method.static_) {
    info.diagnostics.push({
      severity: "error",
      message: "Static mock methods are not supported yet",
      span: method.span,
      module: table.path,
    });
  }

  if (method.mock_ && method.typeParams.length > 0) {
    info.diagnostics.push({
      severity: "error",
      message: "Generic mock methods are not supported yet",
      span: method.span,
      module: table.path,
    });
  }

  if (method.typeParams.length > 0) {
    host.typeParamStack.push(new Set(method.typeParams));
  }

  if (method.returnType) {
    validateCollectionTypeAnnotation(method.returnType, method.returnType.span, table, info, { allowOmittedTypeArgs: false });
  }
  const returnType = method.returnType
    ? host.resolveTypeAnnotation(method.returnType, table)
    : null;
  if (returnType) {
    reportUnsupportedHashCollectionConstraint(returnType, method.returnType?.span ?? method.span, table, info);
  }
  const effectiveMethodReturnType = method.body.kind === "block"
    ? (returnType ?? VOID_TYPE)
    : returnType;
  const methodScope: Scope = {
    parent: parentScope,
    bindings: new Map(),
    kind: method.static_ ? "function" : "method",
    thisType: method.static_ ? null : thisType,
    returnType: effectiveMethodReturnType,
  };

  for (const candidate of classDecl.methods) {
    if (candidate.static_ !== method.static_) continue;
    methodScope.bindings.set(candidate.name, {
      name: candidate.name,
      kind: "function",
      type: buildMethodBindingType(host, candidate, classDecl, table),
      mutable: false,
      span: candidate.span,
      module: table.path,
    });
  }

  if (!method.static_) {
    for (const field of classDecl.fields) {
      const fieldType = field.resolvedType
        ?? (field.type ? host.resolveTypeAnnotation(field.type, table) : UNKNOWN_TYPE);
      for (const fieldName of field.names) {
        methodScope.bindings.set(fieldName, {
          name: fieldName,
          kind: "field",
          type: fieldType,
          mutable: !field.readonly_ && !field.const_,
          span: field.span,
          module: table.path,
        });
      }
    }
  }

  for (const param of method.params) {
    if (param.type) {
      validateCollectionTypeAnnotation(param.type, param.type.span, table, info, {
        allowOmittedTypeArgs: param.defaultValue !== null,
      });
    }
    const paramType = param.type
      ? host.resolveTypeAnnotation(param.type, table)
      : UNKNOWN_TYPE;
    if (param.type) {
      reportUnsupportedHashCollectionConstraint(paramType, param.type.span, table, info);
    }
    param.resolvedType = paramType;
    methodScope.bindings.set(param.name, {
      name: param.name,
      kind: "parameter",
      type: paramType,
      mutable: false,
      span: param.span,
      module: table.path,
    });
    if (param.defaultValue) {
      const collectionAnnotation = getCollectionTypeAnnotationInfo(param.type);
      const inferredDefaultType = host.inferExprType(param.defaultValue, methodScope, table, info, paramType, true);
      const finalizedDefaultType = finalizeDeclaredCollectionType(
        param.type,
        param.type ? paramType : null,
        inferredDefaultType,
        param.defaultValue,
        table,
        info,
      );
      const resolvedParamType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : paramType;
      const assignabilityType = collectionAnnotation?.omitsTypeArgs ? finalizedDefaultType : inferredDefaultType;
      const effectiveDeclaredType = collectionAnnotation?.omitsTypeArgs ? resolvedParamType : paramType;
      if (param.type) {
        param.resolvedType = resolvedParamType;
        methodScope.bindings.set(param.name, {
          name: param.name,
          kind: "parameter",
          type: resolvedParamType,
          mutable: false,
          span: param.span,
          module: table.path,
        });
      }
      if (param.type && !isAssignableTo(assignabilityType, effectiveDeclaredType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Default value of type "${typeToString(assignabilityType)}" is not assignable to parameter type "${typeToString(effectiveDeclaredType)}"`,
          span: param.defaultValue.span,
          module: table.path,
        });
      }
      addUnsupportedDefaultDiagnostic(info, table, "parameter", param.defaultValue, param.resolvedType ?? undefined);
    }
  }

  if (method.body.kind === "block") {
    host.checkStatements(method.body.statements, methodScope, table, info);
  } else {
    const bodyType = host.inferExprType(method.body, methodScope, table, info);
    if (returnType && !isAssignableTo(bodyType, returnType)) {
      info.diagnostics.push({
        severity: "error",
        message: `Type "${typeToString(bodyType)}" is not assignable to return type "${typeToString(returnType)}"`,
        span: method.body.span,
        module: table.path,
      });
    }
  }

  method.resolvedType = {
    kind: "function",
    params: method.params.map((p) => ({
      name: p.name,
      type: p.resolvedType ?? UNKNOWN_TYPE,
      hasDefault: p.defaultValue !== null,
      defaultValue: p.defaultValue,
    })),
    returnType: returnType ?? VOID_TYPE,
    typeParams: method.typeParams.length > 0 ? method.typeParams : undefined,
    typeParamConstraints: resolveTypeParamConstraintTypes(host, method.typeParams, method.typeParamConstraints, table),
    mockCall: method.mock_
      ? buildMockCallMetadata(
          table.path,
          method.name,
          method.params.map((p) => ({
            name: p.name,
            type: p.resolvedType ?? UNKNOWN_TYPE,
            hasDefault: p.defaultValue !== null,
            defaultValue: p.defaultValue,
          })),
          classDecl.name,
        )
      : undefined,
  };

  if (method.typeParams.length > 0) {
    host.typeParamStack.pop();
  }
}
