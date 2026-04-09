/**
 * C++ control-flow expression emission — if-expressions, case-expressions
 * (pattern matching), and catch-expressions.
 */

import type {
  IfExpression,
  CaseExpression,
  CatchExpression,
  Expression,
  Block,
} from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { emitType } from "./emitter-types.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression, emitBlockBody, indent } from "./emitter-expr.js";
import { emitIdentifierSafe } from "./emitter-expr-literals.js";
import { resolveTypeAnnotation } from "./emitter-expr-utils.js";

// ============================================================================
// If-expression → ternary
// ============================================================================

export function emitIfExpression(expr: IfExpression, ctx: EmitContext): string {
  const cond = emitExpression(expr.condition, ctx);
  const then_ = emitExpression(expr.then, ctx);
  const else_ = emitExpression(expr.else_, ctx);
  return `(${cond} ? ${then_} : ${else_})`;
}

// ============================================================================
// Case expression → switch or std::visit
// ============================================================================

export function emitCaseExpression(expr: CaseExpression, ctx: EmitContext): string {
  const subject = emitExpression(expr.subject, ctx);
  const subjectType = expr.subject.resolvedType;

  // For Result types → use isSuccess()/isFailure() checks
  if (subjectType && subjectType.kind === "result") {
    return emitCaseAsResultMatch(expr, subject, ctx);
  }

  // For union/variant types → use std::visit
  if (subjectType && (subjectType.kind === "union" || subjectType.kind === "interface")) {
    return emitCaseAsVisit(expr, subject, ctx);
  }

  // For value types → IIFE with if-chain or switch
  return emitCaseAsIIFE(expr, subject, ctx);
}

function yieldCtx(ctx: EmitContext, indentLevel: number, resultType: ResolvedType | undefined): EmitContext {
  return {
    ...ctx,
    indent: indentLevel,
    caseExpressionYieldType: resultType,
  };
}

/**
 * Emit a case expression matching on a Result<T, E> value.
 */
function emitCaseAsResultMatch(expr: CaseExpression, subject: string, ctx: EmitContext): string {
  const retType = expr.resolvedType ? emitType(expr.resolvedType) : "auto";
  const resultType = expr.resolvedType;
  const ind = indent(ctx);
  const innerInd = indent({ ...ctx, indent: ctx.indent + 1 });

  const tmpVar = "_case_result";
  let result = `[&]() -> ${retType} {\n`;
  result += `${innerInd}auto ${tmpVar} = ${subject};\n`;

  for (const arm of expr.arms) {
    for (const pattern of arm.patterns) {
      if (pattern.kind === "type-pattern") {
        const typeName = pattern.type.kind === "named-type" ? pattern.type.name : null;
        if (typeName === "Success") {
          result += `${innerInd}if (${tmpVar}.isSuccess()) `;
          result += emitResultMatchArm(arm.body, pattern.name, tmpVar, ctx, resultType);
        } else if (typeName === "Failure") {
          result += `${innerInd}if (${tmpVar}.isFailure()) `;
          result += emitResultMatchArm(arm.body, pattern.name, tmpVar, ctx, resultType);
        }
      } else if (pattern.kind === "wildcard-pattern") {
        if (arm.body.kind === "block") {
          result += emitBlockBody(arm.body, yieldCtx(ctx, ctx.indent + 1, resultType));
          result += `\n`;
        } else {
          result += `${innerInd}return ${emitExpression(arm.body as Expression, ctx)};\n`;
        }
      }
    }
  }

  result += `${innerInd}doof::unreachable();\n`;
  result += `${ind}}()`;
  return result;
}

function emitResultMatchArm(
  body: Expression | Block,
  bindingName: string,
  tmpVar: string,
  ctx: EmitContext,
  resultType: ResolvedType | undefined,
): string {
  const innerInd = indent({ ...ctx, indent: ctx.indent + 1 });
  if (body.kind === "block") {
    let s = `{\n`;
    if (bindingName !== "_") {
      s += `${innerInd}    auto& ${emitIdentifierSafe(bindingName)} = ${tmpVar};\n`;
    }
    s += emitBlockBody(body as Block, yieldCtx(ctx, ctx.indent + 2, resultType));
    s += `${innerInd}}\n`;
    return s;
  }
  let s = `{\n`;
  if (bindingName !== "_") {
    s += `${innerInd}    auto& ${emitIdentifierSafe(bindingName)} = ${tmpVar};\n`;
  }
  s += `${innerInd}    return ${emitExpression(body as Expression, ctx)};\n`;
  s += `${innerInd}}\n`;
  return s;
}

function emitCaseAsVisit(expr: CaseExpression, subject: string, ctx: EmitContext): string {
  const retType = expr.resolvedType ? emitType(expr.resolvedType) : "auto";
  const resultType = expr.resolvedType;
  const ind = indent(ctx);
  const innerInd = indent({ ...ctx, indent: ctx.indent + 1 });

  let result = `std::visit([&](auto&& _val) -> ${retType} {\n`;
  result += `${innerInd}using _T = std::decay_t<decltype(_val)>;\n`;

  for (const arm of expr.arms) {
    for (const pattern of arm.patterns) {
      if (pattern.kind === "type-pattern") {
        const resolvedType = resolveTypeAnnotation(pattern.type, ctx);
        const cppType = emitType(resolvedType);
        result += `${innerInd}if constexpr (std::is_same_v<_T, ${cppType}>) {\n`;
        if (pattern.name !== "_") {
          result += `${innerInd}    auto& ${emitIdentifierSafe(pattern.name)} = _val;\n`;
        }
        if (arm.body.kind === "block") {
          result += emitBlockBody(arm.body as Block, yieldCtx(ctx, ctx.indent + 2, resultType));
        } else {
          result += `${innerInd}    return ${emitExpression(arm.body as Expression, ctx)};\n`;
        }
        result += `${innerInd}}\n`;
      } else if (pattern.kind === "wildcard-pattern") {
        if (arm.body.kind === "block") {
          result += emitBlockBody(arm.body as Block, yieldCtx(ctx, ctx.indent + 1, resultType));
          result += `\n`;
        } else {
          result += `${innerInd}return ${emitExpression(arm.body as Expression, ctx)};\n`;
        }
      }
    }
  }

  result += `${ind}}, ${subject})`;
  return result;
}

function emitCaseAsIIFE(expr: CaseExpression, subject: string, ctx: EmitContext): string {
  const retType = expr.resolvedType ? emitType(expr.resolvedType) : "auto";
  const resultType = expr.resolvedType;
  const ind = indent(ctx);
  const innerInd = indent({ ...ctx, indent: ctx.indent + 1 });
  const tmpVar = "_case_subject";

  let result = `[&]() -> ${retType} {\n`;
  result += `${innerInd}auto ${tmpVar} = ${subject};\n`;

  for (const arm of expr.arms) {
    for (const pattern of arm.patterns) {
      let bindingName: string | null = null;
      if (pattern.kind === "value-pattern") {
        const val = emitExpression(pattern.value, ctx);
        result += `${innerInd}if (${tmpVar} == ${val}) `;
      } else if (pattern.kind === "range-pattern") {
        const conditions: string[] = [];
        if (pattern.start) {
          conditions.push(`${tmpVar} >= ${emitExpression(pattern.start, ctx)}`);
        }
        if (pattern.end) {
          const op = pattern.inclusive ? "<=" : "<";
          conditions.push(`${tmpVar} ${op} ${emitExpression(pattern.end, ctx)}`);
        }
        result += `${innerInd}if (${conditions.join(" && ")}) `;
      } else if (pattern.kind === "type-pattern") {
        result += `${innerInd}if (true) `;
        bindingName = pattern.name;
      } else if (pattern.kind === "wildcard-pattern") {
        if (arm.body.kind === "block") {
          result += emitBlockBody(arm.body as Block, yieldCtx(ctx, ctx.indent + 1, resultType));
        } else {
          result += `${innerInd}return ${emitExpression(arm.body as Expression, ctx)};\n`;
        }
        continue;
      }

      if (arm.body.kind === "block") {
        result += `{\n`;
        if (bindingName && bindingName !== "_") {
          result += `${innerInd}    auto& ${emitIdentifierSafe(bindingName)} = ${tmpVar};\n`;
        }
        result += `${emitBlockBody(arm.body as Block, yieldCtx(ctx, ctx.indent + 2, resultType))}${innerInd}}\n`;
      } else {
        result += `{\n`;
        if (bindingName && bindingName !== "_") {
          result += `${innerInd}    auto& ${emitIdentifierSafe(bindingName)} = ${tmpVar};\n`;
        }
        result += `${innerInd}    return ${emitExpression(arm.body as Expression, ctx)};\n`;
        result += `${innerInd}}\n`;
      }
    }
  }

  result += `${ind}}()`;
  return result;
}

// ============================================================================
// Catch expression (IIFE form — for expression position)
// ============================================================================

/**
 * Emit a catch expression as an IIFE for use in expression position.
 */
export function emitCatchExpressionIIFE(expr: CatchExpression, ctx: EmitContext): string {
  const resolvedType = expr.resolvedType;
  const cppType = resolvedType ? emitType(resolvedType) : "auto";
  const catchVar = `_catch_${ctx.tempCounter++}`;

  let nullInit: string;
  if (cppType.startsWith("std::optional")) {
    nullInit = "std::nullopt";
  } else if (cppType.startsWith("std::shared_ptr") || cppType.startsWith("std::weak_ptr")) {
    nullInit = "nullptr";
  } else {
    nullInit = "std::monostate{}";
  }

  const lines: string[] = [];
  lines.push(`[&]() -> ${cppType} {`);
  lines.push(`        ${cppType} ${catchVar} = ${nullInit};`);
  lines.push(`        do {`);

  const savedLines = ctx.sourceLines;
  const bodyLines: string[] = [];
  ctx.sourceLines = bodyLines;

  const prevCatchVar = ctx.catchVarName;
  ctx.catchVarName = catchVar;
  const innerCtx = { ...ctx, indent: 3 };
  for (const stmt of expr.body) {
    const blockWrapper = { kind: "block" as const, statements: [stmt], span: expr.span };
    ctx.emitBlock(blockWrapper, innerCtx);
  }
  ctx.catchVarName = prevCatchVar;
  ctx.tempCounter = innerCtx.tempCounter;

  ctx.sourceLines = savedLines;

  for (const line of bodyLines) {
    lines.push(line);
  }

  lines.push(`        } while (false);`);
  lines.push(`        return ${catchVar};`);
  lines.push(`    }()`);

  return lines.join("\n");
}
