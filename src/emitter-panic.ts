import { BUNDLED_STDLIB_ROOT } from "./stdlib-constants.js";
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

function formatSourceModulePath(modulePath: string, stripExtension: boolean): string {
  let normalized = modulePath.replace(/\\/g, "/");
  if (normalized.startsWith(`${BUNDLED_STDLIB_ROOT}/`)) {
    normalized = normalized.slice(`${BUNDLED_STDLIB_ROOT}/`.length);
  }
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (stripExtension) {
    if (normalized.endsWith("/index.do")) {
      normalized = normalized.slice(0, -"/index.do".length);
    } else if (normalized.endsWith(".do")) {
      normalized = normalized.slice(0, -".do".length);
    }
  }
  return normalized || "<module>";
}

function formatCallableName(ctx: EmitContext): string {
  return ctx.currentCallableName ?? "<module>";
}

export function emitCallerSourceLocation(span: SourceSpan, ctx: EmitContext): string {
  const fileName = formatSourceModulePath(ctx.module.path, true);
  const functionName = formatCallableName(ctx);
  return `std::make_shared<doof::SourceLocation>(std::string("${escapeCppString(fileName)}"), ${span.start.line}, std::string("${escapeCppString(functionName)}"))`;
}

export function emitPanicLocationArgs(span: SourceSpan, ctx: EmitContext): string {
  const fileName = formatSourceModulePath(ctx.module.path, false);
  return `"${escapeCppString(fileName)}", ${span.start.line}`;
}

export function emitPanicAt(messageExpr: string, span: SourceSpan, ctx: EmitContext): string {
  return `doof::panic_at(${emitPanicLocationArgs(span, ctx)}, ${messageExpr})`;
}