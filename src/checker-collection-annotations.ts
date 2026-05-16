import type { Expression, NamedType, SourceSpan, TypeAnnotation } from "./ast.js";
import {
  type ModuleTypeInfo,
  type ResolvedType,
} from "./checker-types.js";
import { reportUnsupportedHashCollectionConstraint } from "./checker-diagnostics.js";
import type { ModuleSymbolTable } from "./types.js";

type CollectionAnnotationName = "Map" | "ReadonlyMap" | "Set" | "ReadonlySet";

export interface CollectionTypeAnnotationInfo {
  annotation: NamedType;
  name: CollectionAnnotationName;
  kind: "map" | "set";
  readonly_: boolean;
  expectedTypeArgCount: 1 | 2;
  typeArgCount: number;
  omitsTypeArgs: boolean;
  hasFullTypeArgs: boolean;
}

export function getCollectionTypeAnnotationInfo(
  annotation: TypeAnnotation | null | undefined,
): CollectionTypeAnnotationInfo | null {
  if (!annotation || annotation.kind !== "named-type") return null;

  switch (annotation.name) {
    case "Map":
      return buildCollectionTypeAnnotationInfo(annotation, "map", false, 2);
    case "ReadonlyMap":
      return buildCollectionTypeAnnotationInfo(annotation, "map", true, 2);
    case "Set":
      return buildCollectionTypeAnnotationInfo(annotation, "set", false, 1);
    case "ReadonlySet":
      return buildCollectionTypeAnnotationInfo(annotation, "set", true, 1);
    default:
      return null;
  }
}

export function validateCollectionTypeAnnotation(
  annotation: TypeAnnotation | null | undefined,
  span: SourceSpan,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  options: { allowOmittedTypeArgs: boolean },
): CollectionTypeAnnotationInfo | null {
  const annotationInfo = getCollectionTypeAnnotationInfo(annotation);
  if (!annotationInfo) return null;

  if (annotationInfo.hasFullTypeArgs) return annotationInfo;

  if (annotationInfo.omitsTypeArgs) {
    if (options.allowOmittedTypeArgs) return annotationInfo;

    info.diagnostics.push({
      severity: "error",
      message: `Omitted type arguments for ${annotationInfo.name} are only supported with a same-site non-empty ${annotationInfo.kind} literal`,
      span,
      module: table.path,
    });
    return null;
  }

  info.diagnostics.push({
    severity: "error",
    message: `${annotationInfo.name} requires either 0 or ${annotationInfo.expectedTypeArgCount} type arguments`,
    span,
    module: table.path,
  });
  return null;
}

export function finalizeDeclaredCollectionType(
  annotation: TypeAnnotation | null | undefined,
  declaredType: ResolvedType | null,
  inferredType: ResolvedType,
  valueExpr: Expression,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): ResolvedType {
  const annotationInfo = getCollectionTypeAnnotationInfo(annotation);
  if (!declaredType || !annotationInfo?.omitsTypeArgs) {
    return declaredType ?? inferredType;
  }

  if (annotationInfo.kind === "map") {
    if (valueExpr.kind === "object-literal" && valueExpr.properties.length === 0 && !valueExpr.spread) {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer ${annotationInfo.name} type arguments from an empty map literal; provide a full ${annotationInfo.name}<K, V> annotation`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    if (valueExpr.kind !== "map-literal") {
      info.diagnostics.push({
        severity: "error",
        message: `Omitted type arguments for ${annotationInfo.name} require a same-site non-empty map literal`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    if (valueExpr.entries.length === 0) {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer ${annotationInfo.name} type arguments from an empty map literal; provide a full ${annotationInfo.name}<K, V> annotation`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    if (inferredType.kind !== "map"
      || inferredType.keyType.kind === "unknown"
      || inferredType.valueType.kind === "unknown") {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer ${annotationInfo.name} type arguments from this map literal; provide a full ${annotationInfo.name}<K, V> annotation`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    if (inferredType.keyType.kind === "union") {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer ${annotationInfo.name} key type from heterogeneous map keys; provide a full ${annotationInfo.name}<K, V> annotation`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    if (inferredType.valueType.kind === "union") {
      info.diagnostics.push({
        severity: "error",
        message: `Cannot infer ${annotationInfo.name} value type from heterogeneous map values; provide a full ${annotationInfo.name}<K, V> annotation`,
        span: valueExpr.span,
        module: table.path,
      });
      return inferredType;
    }

    reportUnsupportedHashCollectionConstraint(inferredType, valueExpr.span, table, info);
    return inferredType;
  }

  if (valueExpr.kind !== "array-literal") {
    info.diagnostics.push({
      severity: "error",
      message: `Omitted type arguments for ${annotationInfo.name} require a same-site non-empty set literal`,
      span: valueExpr.span,
      module: table.path,
    });
    return inferredType;
  }

  if (valueExpr.elements.length === 0) {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot infer ${annotationInfo.name} element type from an empty set literal; provide a full ${annotationInfo.name}<T> annotation`,
      span: valueExpr.span,
      module: table.path,
    });
    return inferredType;
  }

  if (inferredType.kind !== "set" || inferredType.elementType.kind === "unknown") {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot infer ${annotationInfo.name} element type from this set literal; provide a full ${annotationInfo.name}<T> annotation`,
      span: valueExpr.span,
      module: table.path,
    });
    return inferredType;
  }

  if (inferredType.elementType.kind === "union") {
    info.diagnostics.push({
      severity: "error",
      message: `Cannot infer ${annotationInfo.name} element type from heterogeneous set elements; provide a full ${annotationInfo.name}<T> annotation`,
      span: valueExpr.span,
      module: table.path,
    });
    return inferredType;
  }

  reportUnsupportedHashCollectionConstraint(inferredType, valueExpr.span, table, info);
  return inferredType;
}

function buildCollectionTypeAnnotationInfo(
  annotation: NamedType,
  kind: "map" | "set",
  readonly_: boolean,
  expectedTypeArgCount: 1 | 2,
): CollectionTypeAnnotationInfo {
  return {
    annotation,
    name: annotation.name as CollectionAnnotationName,
    kind,
    readonly_,
    expectedTypeArgCount,
    typeArgCount: annotation.typeArgs.length,
    omitsTypeArgs: annotation.typeArgs.length === 0,
    hasFullTypeArgs: annotation.typeArgs.length === expectedTypeArgCount,
  };
}
