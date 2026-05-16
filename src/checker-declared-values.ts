import type { Expression, SourceSpan, TypeAnnotation } from "./ast.js";
import {
  finalizeDeclaredCollectionType,
  getCollectionTypeAnnotationInfo,
  validateCollectionTypeAnnotation,
  type CollectionTypeAnnotationInfo,
} from "./checker-collection-annotations.js";
import { reportUnsupportedHashCollectionConstraint } from "./checker-diagnostics.js";
import type { CheckerHost } from "./checker-internal.js";
import type {
  ModuleTypeInfo,
  ResolvedType,
  Scope,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

interface ResolveDeclaredTypeOptions {
  allowOmittedTypeArgs: boolean;
  transformDeclaredType?: (type: ResolvedType) => ResolvedType;
}

export interface DeclaredTypeResolution {
  collectionAnnotation: CollectionTypeAnnotationInfo | null;
  declaredType: ResolvedType | null;
}

export interface DeclaredValueResolution {
  inferredType: ResolvedType;
  finalizedType: ResolvedType;
}

/**
 * Resolve and validate the annotation attached to a declaration-like value site.
 * Callers keep ownership of any extra policy layered on top of the declared type
 * (for example readonly violation diagnostics or binding registration).
 */
export function resolveDeclaredType(
  host: CheckerHost,
  annotation: TypeAnnotation | null,
  fallbackSpan: SourceSpan,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  options: ResolveDeclaredTypeOptions,
): DeclaredTypeResolution {
  if (annotation) {
    validateCollectionTypeAnnotation(annotation, annotation.span, table, info, {
      allowOmittedTypeArgs: options.allowOmittedTypeArgs,
    });
  }

  const collectionAnnotation = getCollectionTypeAnnotationInfo(annotation);
  const resolvedAnnotationType = annotation
    ? host.resolveTypeAnnotation(annotation, table)
    : null;
  const declaredType = resolvedAnnotationType && options.transformDeclaredType
    ? options.transformDeclaredType(resolvedAnnotationType)
    : resolvedAnnotationType;

  if (declaredType) {
    reportUnsupportedHashCollectionConstraint(declaredType, annotation?.span ?? fallbackSpan, table, info);
  }

  return {
    collectionAnnotation,
    declaredType,
  };
}

/**
 * Infer an initializer/default value against an already-resolved annotation and
 * perform the shared omitted-collection-type finalization step.
 */
export function resolveDeclaredValue(
  host: CheckerHost,
  annotation: TypeAnnotation | null,
  declaredType: ResolvedType | null,
  value: Expression,
  scope: Scope,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
  options: {
    expectedType?: ResolvedType;
    inferAsDefaultValue?: boolean;
  } = {},
): DeclaredValueResolution {
  const inferredType = host.inferExprType(
    value,
    scope,
    table,
    info,
    options.expectedType ?? declaredType ?? undefined,
    options.inferAsDefaultValue,
  );
  const finalizedType = finalizeDeclaredCollectionType(
    annotation,
    declaredType,
    inferredType,
    value,
    table,
    info,
  );

  return {
    inferredType,
    finalizedType,
  };
}

/**
 * Omitted Map/Set type arguments use the same-site initializer as the semantic
 * type source, so callers can swap in the post-processed initializer type when
 * checking assignability while leaving normal annotations on the declared type.
 */
export function getCollectionAwareAssignabilityTypes(
  collectionAnnotation: CollectionTypeAnnotationInfo | null,
  declaredType: ResolvedType | null,
  inferredType: ResolvedType,
  omittedAnnotationType: ResolvedType,
): {
  effectiveDeclaredType: ResolvedType | null;
  assignabilityType: ResolvedType;
} {
  if (collectionAnnotation?.omitsTypeArgs) {
    return {
      effectiveDeclaredType: omittedAnnotationType,
      assignabilityType: omittedAnnotationType,
    };
  }

  return {
    effectiveDeclaredType: declaredType,
    assignabilityType: inferredType,
  };
}
