import type { SourceSpan } from "./ast.js";
import type { EmitContext } from "./emitter-context.js";

function escapeCppString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

function getDoofSourceFileName(modulePath: string): string {
  const segments = modulePath.split(/[\\/]/);
  return segments[segments.length - 1] || modulePath;
}

export function emitPanicLocationArgs(span: SourceSpan, ctx: EmitContext): string {
  const fileName = getDoofSourceFileName(ctx.module.path);
  return `"${escapeCppString(fileName)}", ${span.start.line}`;
}

export function emitPanicAt(messageExpr: string, span: SourceSpan, ctx: EmitContext): string {
  return `doof::panic_at(${emitPanicLocationArgs(span, ctx)}, ${messageExpr})`;
}