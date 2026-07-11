/**
 * Conservative control-flow facts used by the checker for definite-return
 * validation. This is intentionally separate from expression type checking:
 * it answers only whether a statement can complete normally.
 */

import type { Block, Expression, Statement } from "./ast.js";
import { getResultShape } from "./checker-types.js";

interface Flow {
  /** The statement can reach the next statement normally. */
  normal: boolean;
  /** A break can escape to the enclosing loop. */
  break_: boolean;
  /** A continue can escape to the enclosing loop. */
  continue_: boolean;
}

const NORMAL_FLOW: Flow = { normal: true, break_: false, continue_: false };

function combineBranches(branches: Flow[]): Flow {
  return {
    normal: branches.some((branch) => branch.normal),
    break_: branches.some((branch) => branch.break_),
    continue_: branches.some((branch) => branch.continue_),
  };
}

function isBooleanLiteral(expression: Expression, value: boolean): boolean {
  return expression.kind === "bool-literal" && expression.value === value;
}

function expressionFlow(expression: Expression): Flow {
  if (
    expression.kind === "call-expression"
    && expression.callee.kind === "identifier"
    && expression.callee.name === "panic"
    && expression.callee.resolvedBinding?.module === "<builtin>"
  ) {
    return { normal: false, break_: false, continue_: false };
  }
  return NORMAL_FLOW;
}

function caseIsExhaustive(statement: Extract<Statement, { kind: "case-statement" }>): boolean {
  if (statement.arms.some((arm) => arm.patterns.some((pattern) => pattern.kind === "wildcard-pattern"))) {
    return true;
  }

  // Result cases have two intrinsic arms. The checker already recognizes
  // these patterns for narrowing, so reuse that closed-world shape here.
  const result = getResultShape(statement.subject.resolvedType ?? { kind: "unknown" });
  if (!result) return false;
  const typeNames = new Set(
    statement.arms.flatMap((arm) => arm.patterns.flatMap((pattern) =>
      pattern.kind === "type-pattern" && pattern.type.kind === "named-type"
        ? [pattern.type.name]
        : [],
    )),
  );
  return typeNames.has("Success") && typeNames.has("Failure");
}

function statementFlow(statement: Statement, loopDepth: number): Flow {
  switch (statement.kind) {
    case "return-statement":
      return { normal: false, break_: false, continue_: false };

    case "break-statement":
      return loopDepth > 0
        ? { normal: false, break_: true, continue_: false }
        : NORMAL_FLOW;

    case "continue-statement":
      return loopDepth > 0
        ? { normal: false, break_: false, continue_: true }
        : NORMAL_FLOW;

    case "expression-statement":
      return expressionFlow(statement.expression);

    case "if-statement": {
      const branches: Flow[] = [];
      let canReachNextCondition = true;
      const conditions = [
        { condition: statement.condition, body: statement.body },
        ...statement.elseIfs.map((elseIf) => ({ condition: elseIf.condition, body: elseIf.body })),
      ];
      for (const branch of conditions) {
        if (!canReachNextCondition) break;
        if (isBooleanLiteral(branch.condition, false)) continue;
        branches.push(blockFlow(branch.body, loopDepth));
        if (isBooleanLiteral(branch.condition, true)) canReachNextCondition = false;
      }
      if (canReachNextCondition && statement.else_) {
        branches.push(blockFlow(statement.else_, loopDepth));
        canReachNextCondition = false;
      }
      if (canReachNextCondition) {
        // A non-exhaustive if always has a path that skips its body.
        branches.push(NORMAL_FLOW);
      }
      return combineBranches(branches.length > 0 ? branches : [NORMAL_FLOW]);
    }

    case "case-statement": {
      const branches = statement.arms.map((arm) =>
        arm.body.kind === "block" ? blockFlow(arm.body, loopDepth) : NORMAL_FLOW,
      );
      if (!caseIsExhaustive(statement)) {
        branches.push(NORMAL_FLOW);
      }
      return combineBranches(branches.length > 0 ? branches : [NORMAL_FLOW]);
    }

    case "while-statement": {
      const body = blockFlow(statement.body, loopDepth + 1);
      const canExitByCondition = !isBooleanLiteral(statement.condition, true);
      const thenFlow = statement.then_ ? blockFlow(statement.then_, loopDepth) : NORMAL_FLOW;
      return {
        normal: body.break_ || (canExitByCondition && thenFlow.normal),
        break_: false,
        continue_: false,
      };
    }

    case "for-statement": {
      const body = blockFlow(statement.body, loopDepth + 1);
      const canExitByCondition = statement.condition !== null && !isBooleanLiteral(statement.condition, true);
      const thenFlow = statement.then_ ? blockFlow(statement.then_, loopDepth) : NORMAL_FLOW;
      return {
        normal: body.break_ || (canExitByCondition && thenFlow.normal),
        break_: false,
        continue_: false,
      };
    }

    case "for-of-statement": {
      const body = blockFlow(statement.body, loopDepth + 1);
      const thenFlow = statement.then_ ? blockFlow(statement.then_, loopDepth) : NORMAL_FLOW;
      // The iterable may be empty, so the loop body cannot establish a
      // definite return for the function. A break skips the `then` block.
      return {
        normal: body.break_ || thenFlow.normal,
        break_: false,
        continue_: false,
      };
    }

    case "block":
      return blockFlow(statement, loopDepth);

    case "export-declaration":
      return statementFlow(statement.declaration, loopDepth);

    default:
      return NORMAL_FLOW;
  }
}

function blockFlow(block: Block, loopDepth: number): Flow {
  let flow: Flow = NORMAL_FLOW;
  for (const statement of block.statements) {
    if (!flow.normal) break;
    const next = statementFlow(statement, loopDepth);
    flow = {
      normal: next.normal,
      break_: flow.break_ || next.break_,
      continue_: flow.continue_ || next.continue_,
    };
  }
  return flow;
}

/** Returns true when the block has a path that reaches its closing brace. */
export function blockCanFallThrough(block: Block): boolean {
  return blockFlow(block, 0).normal;
}
