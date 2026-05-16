import type { SourceSpan } from "./ast.js";
import {
  findUnsupportedHashCollectionConstraint,
  formatUnsupportedHashCollectionConstraintMessage,
  type ModuleTypeInfo,
  type ResolvedType,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

/**
 * Report the shared Map/Set hashability diagnostic from any checker phase that
 * resolves a declared or inferred collection type.
 */
export function reportUnsupportedHashCollectionConstraint(
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
