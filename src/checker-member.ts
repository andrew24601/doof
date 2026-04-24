import {
  collectNonSerializableFields,
  findSharedDiscriminator,
  isAssignableTo,
  isJSONSerializable,
  buildMockCallMetadata,
  type Binding,
  type ModuleTypeInfo,
  type ResolvedType,
  JSON_VALUE_TYPE,
  STRING_TYPE,
  BOOL_TYPE,
  CHAR_TYPE,
  INT_TYPE,
  NULL_TYPE,
  substituteTypeParams,
  typeToString,
  UNKNOWN_TYPE,
  VOID_TYPE,
} from "./checker-types.js";
import type { ClassDeclaration, SourceSpan } from "./ast.js";
import type { ClassSymbol, InterfaceSymbol, ModuleSymbolTable, TypeAliasSymbol } from "./types.js";
import { BUILTIN_PARSE_ERROR_TYPE, type CheckerHost } from "./checker-internal.js";

export type MemberLookupMode = "instance" | "named-static" | "qualified-static";

function buildClassTypeSubstitution(
  host: CheckerHost,
  objectType: Extract<ResolvedType, { kind: "class" }>,
): Map<string, ResolvedType> | undefined {
  const classDecl = objectType.symbol.declaration;
  if (!objectType.typeArgs || objectType.typeArgs.length === 0 || classDecl.typeParams.length === 0) {
    return undefined;
  }

  const subMap = new Map<string, ResolvedType>();
  for (let i = 0; i < classDecl.typeParams.length && i < objectType.typeArgs.length; i++) {
    subMap.set(classDecl.typeParams[i], objectType.typeArgs[i]);
  }
  return subMap;
}

function withClassTypeParams<T>(
  host: CheckerHost,
  classDecl: ClassDeclaration,
  fn: () => T,
): T {
  if (classDecl.typeParams.length > 0) {
    host.typeParamStack.push(new Set(classDecl.typeParams));
  }
  try {
    return fn();
  } finally {
    if (classDecl.typeParams.length > 0) {
      host.typeParamStack.pop();
    }
  }
}

function withMethodTypeParams<T>(
  host: CheckerHost,
  method: ClassDeclaration["methods"][number],
  fn: () => T,
): T {
  if (method.typeParams.length > 0) {
    host.typeParamStack.push(new Set(method.typeParams));
  }
  try {
    return fn();
  } finally {
    if (method.typeParams.length > 0) {
      host.typeParamStack.pop();
    }
  }
}

function resolveClassFieldType(
  host: CheckerHost,
  classTable: ModuleSymbolTable,
  field: ClassDeclaration["fields"][number],
  classSubMap?: Map<string, ResolvedType>,
): ResolvedType {
  let fieldType = field.resolvedType
    ?? (field.type ? host.resolveTypeAnnotation(field.type, classTable) : UNKNOWN_TYPE);
  if (classSubMap) {
    fieldType = substituteTypeParams(fieldType, classSubMap);
  }
  return fieldType;
}

function resolveClassMethodType(
  host: CheckerHost,
  classTable: ModuleSymbolTable,
  method: ClassDeclaration["methods"][number],
  classDecl: ClassDeclaration,
  classSubMap?: Map<string, ResolvedType>,
): ResolvedType {
  let methodType: ResolvedType = withMethodTypeParams(host, method, () => ({
    kind: "function",
    params: method.params.map((p) => ({
      name: p.name,
      type: p.type ? host.resolveTypeAnnotation(p.type, classTable) : UNKNOWN_TYPE,
      hasDefault: p.defaultValue !== null,
      defaultValue: p.defaultValue,
    })),
    returnType: method.returnType
      ? host.resolveTypeAnnotation(method.returnType, classTable)
      : VOID_TYPE,
    typeParams: method.typeParams.length > 0 ? method.typeParams : undefined,
    mockCall: method.mock_
      ? buildMockCallMetadata(
          classTable.path,
          method.name,
          method.params.map((p) => ({
            name: p.name,
            type: p.type ? host.resolveTypeAnnotation(p.type, classTable) : UNKNOWN_TYPE,
            hasDefault: p.defaultValue !== null,
            defaultValue: p.defaultValue,
          })),
          classDecl.name,
        )
      : undefined,
  }));
  if (classSubMap) {
    methodType = substituteTypeParams(methodType, classSubMap);
  }
  return methodType;
}

function reportMemberDiagnostic(
  info: ModuleTypeInfo | undefined,
  table: ModuleSymbolTable,
  span: SourceSpan | undefined,
  message: string,
): void {
  if (!info || !span) return;
  info.diagnostics.push({
    severity: "error",
    message,
    span,
    module: table.path,
  });
}

function reportPrivateDiagnostic(
  table: ModuleSymbolTable,
  info: ModuleTypeInfo | undefined,
  span: SourceSpan | undefined,
  kind: "Property" | "Method",
  property: string,
  modulePath: string,
): void {
  reportMemberDiagnostic(
    info,
    table,
    span,
    `${kind} "${property}" is private and only accessible within "${modulePath}"`,
  );
}

function inferClassInstanceMemberType(
  host: CheckerHost,
  objectType: Extract<ResolvedType, { kind: "class" }>,
  property: string,
  table: ModuleSymbolTable,
  info?: ModuleTypeInfo,
  span?: SourceSpan,
): ResolvedType {
  const classDecl = objectType.symbol.declaration;
  const classTable = host.analysisResult.modules.get(objectType.symbol.module);
  if (!classTable) return UNKNOWN_TYPE;

  return withClassTypeParams(host, classDecl, () => {
    const classSubMap = buildClassTypeSubstitution(host, objectType);

    if (property === "toJsonValue") {
      classDecl.needsJson = true;
      const nonSerializable = collectNonSerializableFields(objectType);
      if (nonSerializable.length > 0 && info && span) {
        for (const { fieldName, typeStr } of nonSerializable) {
          info.diagnostics.push({
            severity: "error",
            message: `Field "${fieldName}" of type "${typeStr}" is not JSON-serializable`,
            span,
            module: table.path,
          });
        }
      }
      return { kind: "function", params: [], returnType: JSON_VALUE_TYPE };
    }

    if (property === "fromJsonValue" || property === "metadata") {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Static member "${property}" must be accessed on the class or via value::${property}`,
      );
      return UNKNOWN_TYPE;
    }

    for (const field of classDecl.fields) {
      if (!field.names.includes(property)) continue;
      if (field.static_) {
        reportMemberDiagnostic(
          info,
          table,
          span,
          `Static member "${property}" must be accessed on the class or via value::${property}`,
        );
        return UNKNOWN_TYPE;
      }
      if (field.private_ && objectType.symbol.module !== table.path) {
        reportPrivateDiagnostic(table, info, span, "Property", property, objectType.symbol.module);
      }
      return resolveClassFieldType(host, classTable, field, classSubMap);
    }

    for (const method of classDecl.methods) {
      if (method.name !== property) continue;
      if (method.static_) {
        reportMemberDiagnostic(
          info,
          table,
          span,
          `Static member "${property}" must be accessed on the class or via value::${property}`,
        );
        return UNKNOWN_TYPE;
      }
      if (method.private_ && objectType.symbol.module !== table.path) {
        reportPrivateDiagnostic(table, info, span, "Method", property, objectType.symbol.module);
      }
      return resolveClassMethodType(host, classTable, method, classDecl, classSubMap);
    }

    reportMemberDiagnostic(
      info,
      table,
      span,
      `Property "${property}" does not exist on type "${objectType.symbol.name}"`,
    );
    return UNKNOWN_TYPE;
  });
}

function inferClassStaticMemberType(
  host: CheckerHost,
  objectType: Extract<ResolvedType, { kind: "class" }>,
  property: string,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo | undefined,
  span: SourceSpan | undefined,
): ResolvedType {
  const classDecl = objectType.symbol.declaration;
  const classTable = host.analysisResult.modules.get(objectType.symbol.module);
  if (!classTable) return UNKNOWN_TYPE;

  return withClassTypeParams(host, classDecl, () => {
    const classSubMap = buildClassTypeSubstitution(host, objectType);

    if (property === "fromJsonValue") {
      classDecl.needsJson = true;
      const nonSerializable = collectNonSerializableFields(objectType);
      if (nonSerializable.length > 0 && info && span) {
        for (const { fieldName, typeStr } of nonSerializable) {
          info.diagnostics.push({
            severity: "error",
            message: `Field "${fieldName}" of type "${typeStr}" is not JSON-serializable`,
            span,
            module: table.path,
          });
        }
      }
      return {
        kind: "function",
        params: [
          { name: "json", type: JSON_VALUE_TYPE },
          { name: "lenient", type: BOOL_TYPE, hasDefault: true, defaultValue: null },
        ],
        returnType: { kind: "result", successType: objectType, errorType: STRING_TYPE },
      };
    }

    if (property === "metadata") {
      if (classDecl.typeParams.length > 0) {
        reportMemberDiagnostic(
          info,
          table,
          span,
          `"metadata" is not available on generic class "${classDecl.name}"`,
        );
        return UNKNOWN_TYPE;
      }
      classDecl.needsMetadata = true;
      classDecl.needsJson = true;
      validateMetadataSerializability(host, classDecl, objectType, table, info, span);
      return { kind: "class-metadata", classType: objectType };
    }

    if (property === "toJsonValue") {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Member "${property}" is an instance member and must be accessed on an instance`,
      );
      return UNKNOWN_TYPE;
    }

    for (const field of classDecl.fields) {
      if (!field.names.includes(property)) continue;
      if (!field.static_) {
        reportMemberDiagnostic(
          info,
          table,
          span,
          `Member "${property}" is an instance member and must be accessed on an instance`,
        );
        return UNKNOWN_TYPE;
      }
      if (field.private_ && objectType.symbol.module !== table.path) {
        reportPrivateDiagnostic(table, info, span, "Property", property, objectType.symbol.module);
      }
      return resolveClassFieldType(host, classTable, field, classSubMap);
    }

    for (const method of classDecl.methods) {
      if (method.name !== property) continue;
      if (!method.static_) {
        reportMemberDiagnostic(
          info,
          table,
          span,
          `Member "${property}" is an instance member and must be accessed on an instance`,
        );
        return UNKNOWN_TYPE;
      }
      if (method.private_ && objectType.symbol.module !== table.path) {
        reportPrivateDiagnostic(table, info, span, "Method", property, objectType.symbol.module);
      }
      return resolveClassMethodType(host, classTable, method, classDecl, classSubMap);
    }

    reportMemberDiagnostic(
      info,
      table,
      span,
      `Property "${property}" does not exist on type "${objectType.symbol.name}"`,
    );
    return UNKNOWN_TYPE;
  });
}

function inferInterfaceInstanceMemberType(
  host: CheckerHost,
  objectType: Extract<ResolvedType, { kind: "interface" }>,
  property: string,
  table: ModuleSymbolTable,
  info?: ModuleTypeInfo,
  span?: SourceSpan,
): ResolvedType {
  const ifaceDecl = objectType.symbol.declaration;
  const ifaceTable = host.analysisResult.modules.get(objectType.symbol.module);
  if (!ifaceTable) return UNKNOWN_TYPE;

  if (property === "fromJsonValue") {
    reportMemberDiagnostic(
      info,
      table,
      span,
      `Static member "${property}" must be accessed on the interface or via value::${property}`,
    );
    return UNKNOWN_TYPE;
  }

  for (const field of ifaceDecl.fields) {
    if (field.name === property) {
      return host.resolveTypeAnnotation(field.type, ifaceTable);
    }
  }
  for (const method of ifaceDecl.methods) {
    if (method.name !== property) continue;
    if (method.static_) {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Static member "${property}" must be accessed via value::${property}`,
      );
      return UNKNOWN_TYPE;
    }
    return {
      kind: "function",
      params: method.params.map((p) => ({
        name: p.name,
        type: p.type ? host.resolveTypeAnnotation(p.type, ifaceTable) : UNKNOWN_TYPE,
      })),
      returnType: host.resolveTypeAnnotation(method.returnType, ifaceTable),
    };
  }
  reportMemberDiagnostic(
    info,
    table,
    span,
    `Property "${property}" does not exist on type "${objectType.symbol.name}"`,
  );
  return UNKNOWN_TYPE;
}

function inferInterfaceStaticMemberType(
  host: CheckerHost,
  objectType: Extract<ResolvedType, { kind: "interface" }>,
  property: string,
  table: ModuleSymbolTable,
  mode: Extract<MemberLookupMode, "named-static" | "qualified-static">,
  info?: ModuleTypeInfo,
  span?: SourceSpan,
): ResolvedType {
  const ifaceDecl = objectType.symbol.declaration;
  const ifaceTable = host.analysisResult.modules.get(objectType.symbol.module);
  if (!ifaceTable) return UNKNOWN_TYPE;

  if (property === "fromJsonValue") {
    if (mode === "qualified-static") {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Static member "${property}" must be accessed on the interface`,
      );
      return UNKNOWN_TYPE;
    }

    ifaceDecl.needsJson = true;
    const implClasses = findInterfaceImplementors(host, objectType.symbol);
    for (const cls of implClasses) {
      cls.declaration.needsJson = true;
    }
    if (implClasses.length === 0 && info && span) {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot deserialize interface "${objectType.symbol.name}": no implementing classes found`,
        span,
        module: table.path,
      });
    } else {
      const discriminator = findSharedDiscriminator(implClasses);
      if (!discriminator && info && span) {
        info.diagnostics.push({
          severity: "error",
          message: `Cannot deserialize interface "${objectType.symbol.name}": all implementing classes must share a const string field with distinct values (e.g., const kind = "variant")`,
          span,
          module: table.path,
        });
      }
      for (const cls of implClasses) {
        const clsType = { kind: "class" as const, symbol: cls };
        const nonSerializable = collectNonSerializableFields(clsType);
        if (nonSerializable.length > 0 && info && span) {
          for (const { fieldName, typeStr } of nonSerializable) {
            info.diagnostics.push({
              severity: "error",
              message: `Field "${fieldName}" of type "${typeStr}" in class "${cls.name}" is not JSON-serializable`,
              span,
              module: table.path,
            });
          }
        }
      }
    }
    return {
      kind: "function",
      params: [
        { name: "json", type: JSON_VALUE_TYPE },
        { name: "lenient", type: BOOL_TYPE, hasDefault: true, defaultValue: null },
      ],
      returnType: { kind: "result", successType: objectType, errorType: STRING_TYPE },
    };
  }

  if (property === "metadata") {
    if (mode === "named-static") {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Static member "${property}" must be accessed via value::${property}`,
      );
      return UNKNOWN_TYPE;
    }

    const implClasses = findInterfaceImplementors(host, objectType.symbol);
    if (implClasses.length === 0) {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Cannot resolve metadata for interface "${objectType.symbol.name}": no implementing classes found`,
      );
      return UNKNOWN_TYPE;
    }

    const metaTypes: ResolvedType[] = [];
    for (const cls of implClasses) {
      const classType: Extract<ResolvedType, { kind: "class" }> = { kind: "class", symbol: cls };
      cls.declaration.needsMetadata = true;
      cls.declaration.needsJson = true;
      validateMetadataSerializability(host, cls.declaration, classType, table, info, span);
      metaTypes.push({ kind: "class-metadata", classType });
    }
    return metaTypes.length === 1 ? metaTypes[0] : { kind: "union", types: metaTypes };
  }

  for (const field of ifaceDecl.fields) {
    if (field.name !== property) continue;
    reportMemberDiagnostic(
      info,
      table,
      span,
      `Member "${property}" is an instance member and must be accessed on an instance`,
    );
    return UNKNOWN_TYPE;
  }

  for (const method of ifaceDecl.methods) {
    if (method.name !== property) continue;
    if (!method.static_) {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Member "${property}" is an instance member and must be accessed on an instance`,
      );
      return UNKNOWN_TYPE;
    }
    if (mode === "named-static") {
      reportMemberDiagnostic(
        info,
        table,
        span,
        `Static member "${property}" must be accessed via value::${property}`,
      );
      return UNKNOWN_TYPE;
    }
    return {
      kind: "function",
      params: method.params.map((p) => ({
        name: p.name,
        type: p.type ? host.resolveTypeAnnotation(p.type, ifaceTable) : UNKNOWN_TYPE,
      })),
      returnType: host.resolveTypeAnnotation(method.returnType, ifaceTable),
    };
  }

  reportMemberDiagnostic(
    info,
    table,
    span,
    `Property "${property}" does not exist on type "${objectType.symbol.name}"`,
  );
  return UNKNOWN_TYPE;
}

function inferTypeAliasStaticMemberType(
  aliasSymbol: TypeAliasSymbol,
  objectType: ResolvedType,
  property: string,
  table: ModuleSymbolTable,
  info?: ModuleTypeInfo,
  span?: SourceSpan,
): ResolvedType {
  const aliasDecl = aliasSymbol.declaration;

  if (property !== "fromJsonValue") {
    reportMemberDiagnostic(
      info,
      table,
      span,
      `Property "${property}" does not exist on type alias "${aliasSymbol.name}"`,
    );
    return UNKNOWN_TYPE;
  }

  if (aliasDecl.typeParams.length > 0) {
    reportMemberDiagnostic(
      info,
      table,
      span,
      `"fromJsonValue" is not available on generic type alias "${aliasSymbol.name}"`,
    );
    return UNKNOWN_TYPE;
  }

  if (objectType.kind !== "union") {
    reportMemberDiagnostic(
      info,
      table,
      span,
      `Cannot deserialize type alias "${aliasSymbol.name}": fromJsonValue requires a union of classes`,
    );
    return UNKNOWN_TYPE;
  }

  const classMembers = objectType.types.filter(
    (inner): inner is Extract<ResolvedType, { kind: "class" }> => inner.kind === "class",
  );
  if (classMembers.length !== objectType.types.length || classMembers.length === 0) {
    reportMemberDiagnostic(
      info,
      table,
      span,
      `Cannot deserialize type alias "${aliasSymbol.name}": fromJsonValue requires a union of classes`,
    );
    return UNKNOWN_TYPE;
  }

  aliasDecl.needsJson = true;

  const classSymbols = classMembers.map((member) => member.symbol);
  for (const cls of classSymbols) {
    cls.declaration.needsJson = true;
    const nonSerializable = collectNonSerializableFields({ kind: "class", symbol: cls });
    if (nonSerializable.length > 0 && info && span) {
      for (const { fieldName, typeStr } of nonSerializable) {
        info.diagnostics.push({
          severity: "error",
          message: `Field "${fieldName}" of type "${typeStr}" in class "${cls.name}" is not JSON-serializable`,
          span,
          module: table.path,
        });
      }
    }
  }

  const discriminator = findSharedDiscriminator(classSymbols);
  if (!discriminator && info && span) {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot deserialize type alias "${aliasSymbol.name}": all member classes must share a const string field with distinct values (e.g., const kind = "variant")`,
      span,
      module: table.path,
    });
  }

  return {
    kind: "function",
    params: [
      { name: "json", type: JSON_VALUE_TYPE },
      { name: "lenient", type: BOOL_TYPE, hasDefault: true, defaultValue: null },
    ],
    returnType: { kind: "result", successType: objectType, errorType: STRING_TYPE },
  };
}

function inferStreamInstanceMemberType(
  objectType: Extract<ResolvedType, { kind: "stream" }>,
  property: string,
  table: ModuleSymbolTable,
  info?: ModuleTypeInfo,
  span?: SourceSpan,
): ResolvedType {
  if (property === "next") {
    return {
      kind: "function",
      params: [],
      returnType: {
        kind: "union",
        types: [objectType.elementType, NULL_TYPE],
      },
    };
  }

  reportMemberDiagnostic(
    info,
    table,
    span,
    `Property "${property}" does not exist on type "${typeToString(objectType)}"`,
  );
  return UNKNOWN_TYPE;
}

export function inferMemberType(
  host: CheckerHost,
  objectType: ResolvedType,
  property: string,
  table: ModuleSymbolTable,
  mode: MemberLookupMode = "instance",
  info?: ModuleTypeInfo,
  span?: SourceSpan,
  binding?: Binding,
): ResolvedType {
  if (objectType.kind === "function" && property === "calls") {
    if (objectType.mockCall) {
      return {
        kind: "array",
        elementType: objectType.mockCall.captureType,
        readonly_: false,
      };
    }

    reportMemberDiagnostic(
      info,
      table,
      span,
      `Property "calls" is only available on mock functions and mock methods`,
    );
    return UNKNOWN_TYPE;
  }

  if (objectType.kind === "mock-capture") {
    const field = objectType.fields.find((entry) => entry.name === property);
    if (field) return field.type;

    reportMemberDiagnostic(
      info,
      table,
      span,
      `Property "${property}" does not exist on type "${objectType.typeName}"`,
    );
    return UNKNOWN_TYPE;
  }

  if (objectType.kind === "namespace") {
    const sourceTable = host.analysisResult.modules.get(objectType.sourceModule);
    if (!sourceTable) return UNKNOWN_TYPE;
    const sym = sourceTable.symbols.get(property);
    if (sym && sym.exported) {
      return host.symbolToType(sym, sourceTable);
    }
    if (info && span) {
      info.diagnostics.push({
        severity: "error",
        message: `Module "${objectType.sourceModule}" has no exported member "${property}"`,
        span,
        module: table.path,
      });
    }
    return UNKNOWN_TYPE;
  }

  if (mode !== "instance" && binding?.symbol?.symbolKind === "type-alias") {
    return inferTypeAliasStaticMemberType(binding.symbol, objectType, property, table, info, span);
  }

  if (objectType.kind === "class") {
    return mode === "instance"
      ? inferClassInstanceMemberType(host, objectType, property, table, info, span)
      : inferClassStaticMemberType(host, objectType, property, table, info, span);
  }

  if (objectType.kind === "interface") {
    return mode === "instance"
      ? inferInterfaceInstanceMemberType(host, objectType, property, table, info, span)
      : inferInterfaceStaticMemberType(host, objectType, property, table, mode, info, span);
  }

  if (objectType.kind === "stream") {
    if (mode !== "instance") {
      reportMemberDiagnostic(info, table, span, `Static member "${property}" must be accessed on an instance`);
      return UNKNOWN_TYPE;
    }
    return inferStreamInstanceMemberType(objectType, property, table, info, span);
  }

  if (objectType.kind === "tuple") {
    const match = property.match(/^_(\d+)$/);
    if (match) {
      const index = parseInt(match[1], 10) - 1;
      if (index >= 0 && index < objectType.elements.length) {
        return objectType.elements[index];
      }
    }
  }

  if (objectType.kind === "array" && property === "length") return INT_TYPE;
  if (objectType.kind === "array") {
    const elem = objectType.elementType;
    const resultElem: ResolvedType = { kind: "result", successType: elem, errorType: STRING_TYPE };
    if (objectType.readonly_ && property === "push") {
      reportMemberDiagnostic(info, table, span, 'Method "push" is not available on readonly array');
      return UNKNOWN_TYPE;
    }
    if (property === "push") return { kind: "function", params: [{ name: "element", type: elem }], returnType: VOID_TYPE };
    if (objectType.readonly_ && property === "pop") {
      reportMemberDiagnostic(info, table, span, 'Method "pop" is not available on readonly array');
      return UNKNOWN_TYPE;
    }
    if (property === "pop") return { kind: "function", params: [], returnType: resultElem };
    if (property === "contains") return { kind: "function", params: [{ name: "element", type: elem }], returnType: BOOL_TYPE };
    if (property === "indexOf") return { kind: "function", params: [{ name: "element", type: elem }], returnType: INT_TYPE };
    if (property === "some") {
      return {
        kind: "function",
        params: [{
          name: "predicate",
          type: {
            kind: "function",
            params: [{ name: "it", type: elem }],
            returnType: BOOL_TYPE,
          },
        }],
        returnType: BOOL_TYPE,
      };
    }
    if (property === "every") {
      return {
        kind: "function",
        params: [{
          name: "predicate",
          type: {
            kind: "function",
            params: [{ name: "it", type: elem }],
            returnType: BOOL_TYPE,
          },
        }],
        returnType: BOOL_TYPE,
      };
    }
    if (property === "filter") {
      return {
        kind: "function",
        params: [{
          name: "predicate",
          type: {
            kind: "function",
            params: [{ name: "it", type: elem }],
            returnType: BOOL_TYPE,
          },
        }],
        returnType: { kind: "array", elementType: elem, readonly_: objectType.readonly_ },
      };
    }
    if (property === "map") {
      const mappedType: ResolvedType = { kind: "typevar", name: "U" };
      return {
        kind: "function",
        typeParams: ["U"],
        params: [{
          name: "mapper",
          type: {
            kind: "function",
            params: [{ name: "it", type: elem }],
            returnType: mappedType,
          },
        }],
        returnType: { kind: "array", elementType: mappedType, readonly_: objectType.readonly_ },
      };
    }
    if (property === "slice") {
      return {
        kind: "function",
        params: [{ name: "start", type: INT_TYPE }, { name: "end", type: INT_TYPE }],
        returnType: { kind: "array", elementType: elem, readonly_: objectType.readonly_ },
      };
    }
    if (objectType.readonly_ && property === "buildReadonly") {
      reportMemberDiagnostic(info, table, span, 'Method "buildReadonly" is not available on readonly array');
      return UNKNOWN_TYPE;
    }
    if (property === "buildReadonly") return { kind: "function", params: [], returnType: { kind: "array", elementType: elem, readonly_: true } };
    if (property === "cloneMutable") return { kind: "function", params: [], returnType: { kind: "array", elementType: elem, readonly_: false } };
    // Unknown member on array
    reportMemberDiagnostic(info, table, span, `Property "${property}" does not exist on type "${typeToString(objectType)}"`);
    return UNKNOWN_TYPE;
  }
  if (objectType.kind === "map") {
    const k = objectType.keyType;
    const v = objectType.valueType;
    const resultV: ResolvedType = { kind: "result", successType: v, errorType: STRING_TYPE };
    if (property === "size") return INT_TYPE;
    if (property === "get") return { kind: "function", params: [{ name: "key", type: k }], returnType: resultV };
    if (objectType.readonly_ && property === "set") {
      reportMemberDiagnostic(info, table, span, 'Method "set" is not available on readonly map');
      return UNKNOWN_TYPE;
    }
    if (property === "set") return { kind: "function", params: [{ name: "key", type: k }, { name: "value", type: v }], returnType: VOID_TYPE };
    if (property === "has") return { kind: "function", params: [{ name: "key", type: k }], returnType: BOOL_TYPE };
    if (objectType.readonly_ && property === "delete") {
      reportMemberDiagnostic(info, table, span, 'Method "delete" is not available on readonly map');
      return UNKNOWN_TYPE;
    }
    if (property === "delete") return { kind: "function", params: [{ name: "key", type: k }], returnType: VOID_TYPE };
    if (property === "keys") return { kind: "function", params: [], returnType: { kind: "array", elementType: k, readonly_: false } };
    if (property === "values") return { kind: "function", params: [], returnType: { kind: "array", elementType: v, readonly_: false } };
    // Unknown member on map
    reportMemberDiagnostic(info, table, span, `Property "${property}" does not exist on type "${typeToString(objectType)}"`);
    return UNKNOWN_TYPE;
  }
  if (objectType.kind === "set") {
    const elem = objectType.elementType;
    if (property === "size") return INT_TYPE;
    if (property === "has") return { kind: "function", params: [{ name: "value", type: elem }], returnType: BOOL_TYPE };
    if (objectType.readonly_ && property === "add") {
      reportMemberDiagnostic(info, table, span, 'Method "add" is not available on readonly set');
      return UNKNOWN_TYPE;
    }
    if (property === "add") return { kind: "function", params: [{ name: "value", type: elem }], returnType: VOID_TYPE };
    if (objectType.readonly_ && property === "delete") {
      reportMemberDiagnostic(info, table, span, 'Method "delete" is not available on readonly set');
      return UNKNOWN_TYPE;
    }
    if (property === "delete") return { kind: "function", params: [{ name: "value", type: elem }], returnType: VOID_TYPE };
    if (property === "values") return { kind: "function", params: [], returnType: { kind: "array", elementType: elem, readonly_: false } };
    // Unknown member on set
    reportMemberDiagnostic(info, table, span, `Property "${property}" does not exist on type "${typeToString(objectType)}"`);
    return UNKNOWN_TYPE;
  }
  if (objectType.kind === "primitive" && objectType.name === "string") {
    if (property === "length") return INT_TYPE;
    if (property === "indexOf") return { kind: "function", params: [{ name: "search", type: STRING_TYPE }], returnType: INT_TYPE };
    if (property === "contains") return { kind: "function", params: [{ name: "search", type: STRING_TYPE }], returnType: BOOL_TYPE };
    if (property === "startsWith") return { kind: "function", params: [{ name: "prefix", type: STRING_TYPE }], returnType: BOOL_TYPE };
    if (property === "endsWith") return { kind: "function", params: [{ name: "suffix", type: STRING_TYPE }], returnType: BOOL_TYPE };
    if (property === "substring") return { kind: "function", params: [{ name: "start", type: INT_TYPE }, { name: "end", type: INT_TYPE }], returnType: STRING_TYPE };
    if (property === "slice") return { kind: "function", params: [{ name: "start", type: INT_TYPE }], returnType: STRING_TYPE };
    if (property === "padStart") return { kind: "function", params: [{ name: "length", type: INT_TYPE }, { name: "fill", type: CHAR_TYPE }], returnType: STRING_TYPE };
    if (property === "trim") return { kind: "function", params: [], returnType: STRING_TYPE };
    if (property === "trimStart") return { kind: "function", params: [], returnType: STRING_TYPE };
    if (property === "trimEnd") return { kind: "function", params: [{ name: "fill", type: CHAR_TYPE, hasDefault: true, defaultValue: null }], returnType: STRING_TYPE };
    if (property === "toUpperCase") return { kind: "function", params: [], returnType: STRING_TYPE };
    if (property === "toLowerCase") return { kind: "function", params: [], returnType: STRING_TYPE };
    if (property === "replace") return { kind: "function", params: [{ name: "search", type: STRING_TYPE }, { name: "replacement", type: STRING_TYPE }], returnType: STRING_TYPE };
    if (property === "replaceAll") return { kind: "function", params: [{ name: "search", type: STRING_TYPE }, { name: "replacement", type: STRING_TYPE }], returnType: STRING_TYPE };
    if (property === "split") return { kind: "function", params: [{ name: "delimiter", type: STRING_TYPE }], returnType: { kind: "array", elementType: STRING_TYPE, readonly_: false } };
    if (property === "charAt") return { kind: "function", params: [{ name: "index", type: INT_TYPE }], returnType: STRING_TYPE };
    if (property === "repeat") return { kind: "function", params: [{ name: "count", type: INT_TYPE }], returnType: STRING_TYPE };
    // Unknown member on string
    reportMemberDiagnostic(info, table, span, `Property "${property}" does not exist on type "${typeToString(objectType)}"`);
    return UNKNOWN_TYPE;
  }
  if (objectType.kind === "builtin-namespace") {
    if (property === "parse" && ["byte", "int", "long", "float", "double"].includes(objectType.name)) {
      const primitiveName = objectType.name as "byte" | "int" | "long" | "float" | "double";
      return {
        kind: "function",
        params: [{ name: "value", type: STRING_TYPE }],
        returnType: {
          kind: "result",
          successType: { kind: "primitive", name: primitiveName },
          errorType: BUILTIN_PARSE_ERROR_TYPE,
        },
      };
    }
    if (info && span) {
      info.diagnostics.push({
        severity: "error",
        message: `Builtin namespace "${objectType.name}" has no member "${property}"`,
        span,
        module: table.path,
      });
    }
    return UNKNOWN_TYPE;
  }
  if (objectType.kind === "enum" && property === "name") return STRING_TYPE;
  if (objectType.kind === "enum" && property === "value") return INT_TYPE;
  if (objectType.kind === "enum" && property === "fromName") {
    return { kind: "function", params: [{ name: "s", type: STRING_TYPE }], returnType: { kind: "union", types: [{ kind: "enum", symbol: objectType.symbol }, { kind: "null" }] } };
  }
  if (objectType.kind === "enum" && property === "fromValue") {
    return { kind: "function", params: [{ name: "v", type: INT_TYPE }], returnType: { kind: "union", types: [{ kind: "enum", symbol: objectType.symbol }, { kind: "null" }] } };
  }
  if (objectType.kind === "enum") {
    const variants = objectType.symbol.declaration.variants;
    if (variants.some((v) => v.name === property)) {
      return objectType;
    }
  }

  if (objectType.kind === "actor") {
    if (property === "stop") {
      return { kind: "function", params: [], returnType: VOID_TYPE };
    }
    return inferMemberType(host, objectType.innerClass, property, table);
  }

  if (objectType.kind === "promise") {
    if (property === "get") {
      return {
        kind: "function",
        params: [],
        returnType: {
          kind: "result",
          successType: objectType.valueType,
          errorType: STRING_TYPE,
        },
      };
    }
  }

  if (objectType.kind === "result") {
    if (property === "value") {
      if (objectType.successType.kind === "void") {
        if (info && span) {
          info.diagnostics.push({
            severity: "error",
            message: 'Property "value" is not available on type "Result<void, E>"',
            span,
            module: table.path,
          });
        }
        return UNKNOWN_TYPE;
      }
      return objectType.successType;
    }
    if (property === "error") return objectType.errorType;
    if (property === "isSuccess") return { kind: "function", params: [], returnType: BOOL_TYPE };
    if (property === "isFailure") return { kind: "function", params: [], returnType: BOOL_TYPE };
  }

  if (objectType.kind === "success-wrapper") {
    if (property === "value") {
      if (objectType.valueType.kind === "void") {
        if (info && span) {
          info.diagnostics.push({
            severity: "error",
            message: 'Property "value" is not available on type "Success<void>"',
            span,
            module: table.path,
          });
        }
        return UNKNOWN_TYPE;
      }
      return objectType.valueType;
    }
  }
  if (objectType.kind === "failure-wrapper") {
    if (property === "error") return objectType.errorType;
  }

  if (objectType.kind === "union") {
    const nonNull = objectType.types.filter((t) => t.kind !== "null");
    if (nonNull.length === 1) {
      return inferMemberType(host, nonNull[0], property, table, mode, info, span);
    }
    if (nonNull.length > 0 && nonNull.every((t) => t.kind === "class-metadata")) {
      if (property === "name" || property === "description") {
        return STRING_TYPE;
      }
      if (property === "defs") {
        return { kind: "union", types: [JSON_VALUE_TYPE, NULL_TYPE] };
      }
      if (property === "methods") {
        const methodTypes = nonNull.map((t) => ({
          kind: "array" as const,
          elementType: { kind: "method-reflection" as const, classType: t.classType },
          readonly_: true,
        }));
        return methodTypes.length === 1 ? methodTypes[0] : { kind: "union", types: methodTypes };
      }
    }
  }

  if (objectType.kind === "class-metadata") {
    if (property === "name") return STRING_TYPE;
    if (property === "description") return STRING_TYPE;
    if (property === "invoke") {
      return {
        kind: "function",
        params: [
          { name: "instance", type: objectType.classType },
          { name: "methodName", type: STRING_TYPE },
          { name: "params", type: JSON_VALUE_TYPE },
        ],
        returnType: { kind: "result", successType: JSON_VALUE_TYPE, errorType: JSON_VALUE_TYPE },
      };
    }
    if (property === "methods") {
      return { kind: "array", elementType: { kind: "method-reflection", classType: objectType.classType }, readonly_: true };
    }
    if (property === "defs") {
      return { kind: "union", types: [JSON_VALUE_TYPE, NULL_TYPE] };
    }
  }
  if (objectType.kind === "method-reflection") {
    if (property === "name") return STRING_TYPE;
    if (property === "description") return STRING_TYPE;
    if (property === "inputSchema") return JSON_VALUE_TYPE;
    if (property === "outputSchema") return JSON_VALUE_TYPE;
    if (property === "invoke") {
      return {
        kind: "function",
        params: [
          { name: "instance", type: objectType.classType },
          { name: "params", type: JSON_VALUE_TYPE },
        ],
        returnType: { kind: "result", successType: JSON_VALUE_TYPE, errorType: JSON_VALUE_TYPE },
      };
    }
  }

  return UNKNOWN_TYPE;
}

export function lookupFieldType(
  host: CheckerHost,
  objectType: ResolvedType,
  fieldName: string,
  table: ModuleSymbolTable,
): ResolvedType {
  return inferMemberType(host, objectType, fieldName, table);
}

export function getPositionalFieldTypes(
  host: CheckerHost,
  type: ResolvedType,
  table: ModuleSymbolTable,
): ResolvedType[] {
  if (type.kind === "class") {
    const classTable = host.analysisResult.modules.get(type.symbol.module);
    if (!classTable) return [];
    const result: ResolvedType[] = [];
    for (const field of type.symbol.declaration.fields) {
      if (field.static_) continue;
      const fieldType = field.type
        ? host.resolveTypeAnnotation(field.type, classTable)
        : UNKNOWN_TYPE;
      for (const _ of field.names) {
        result.push(fieldType);
      }
    }
    return result;
  }
  if (type.kind === "tuple") {
    return type.elements;
  }
  return [];
}

function findInterfaceImplementors(host: CheckerHost, ifaceSym: InterfaceSymbol): ClassSymbol[] {
  const result: ClassSymbol[] = [];
  const ifaceType: ResolvedType = { kind: "interface", symbol: ifaceSym };

  for (const [, moduleTable] of host.analysisResult.modules) {
    for (const [, sym] of moduleTable.symbols) {
      if (sym.symbolKind !== "class") continue;
      const classType: ResolvedType = { kind: "class", symbol: sym };
      if (isAssignableTo(classType, ifaceType)) {
        result.push(sym);
      }
    }
  }
  return result;
}

function validateMetadataSerializability(
  host: CheckerHost,
  classDecl: ClassDeclaration,
  objectType: Extract<ResolvedType, { kind: "class" }>,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo | undefined,
  span: SourceSpan | undefined,
): void {
  if (!info || !span) return;
  const classTable = host.analysisResult.modules.get(objectType.symbol.module);
  if (!classTable) return;

  for (const method of classDecl.methods) {
    if (method.private_ || method.static_) continue;
    for (const param of method.params) {
      if (param.type) {
        const paramType = host.resolveTypeAnnotation(param.type, classTable);
        if (!isJSONSerializable(paramType)) {
          info.diagnostics.push({
            severity: "error",
            message: `Parameter "${param.name}" of method "${method.name}" has type "${typeToString(paramType)}" which is not JSON-serializable (required for metadata)`,
            span,
            module: table.path,
          });
        }
      }
    }
    if (method.returnType) {
      const retType = host.resolveTypeAnnotation(method.returnType, classTable);
      if (retType.kind === "result") {
        const successType = retType.successType;
        if (successType.kind !== "void" && !isJSONSerializable(successType)) {
          info.diagnostics.push({
            severity: "error",
            message: `Success type "${typeToString(successType)}" of Result-returning method "${method.name}" is not JSON-serializable (required for metadata)`,
            span,
            module: table.path,
          });
        }
      } else if (retType.kind !== "void" && !isJSONSerializable(retType)) {
        info.diagnostics.push({
          severity: "error",
          message: `Return type "${typeToString(retType)}" of method "${method.name}" is not JSON-serializable (required for metadata)`,
          span,
          module: table.path,
        });
      }
    }
  }
}