/**
 * Shared test helpers for checker test suites.
 */

import { ModuleAnalyzer, type AnalysisResult } from "./analyzer.js";
import { TypeChecker } from "./checker.js";
import type {
  Program, Statement, Expression, Block,
  Identifier, ObjectProperty,
} from "./ast.js";
import type { Binding, ResolvedType } from "./checker-types.js";
import type { Diagnostic } from "./types.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";

// ============================================================================
// AST expression collector (walks the full AST to gather decorated nodes)
// ============================================================================

/** Recursively collect all Expression nodes from a Program. */
export function collectExprs(program: Program): Expression[] {
  const exprs: Expression[] = [];

  function walkExpr(e: Expression): void {
    exprs.push(e);
    switch (e.kind) {
      case "binary-expression": walkExpr(e.left); walkExpr(e.right); break;
      case "unary-expression": walkExpr(e.operand); break;
      case "assignment-expression": walkExpr(e.target); walkExpr(e.value); break;
      case "member-expression": walkExpr(e.object); break;
      case "qualified-member-expression": walkExpr(e.object); break;
      case "index-expression": walkExpr(e.object); walkExpr(e.index); break;
      case "call-expression": walkExpr(e.callee); e.args.forEach((a) => walkExpr(a.value)); break;
      case "array-literal": e.elements.forEach(walkExpr); break;
      case "tuple-literal": e.elements.forEach(walkExpr); break;
      case "object-literal": e.properties.forEach((p) => { if (p.value) walkExpr(p.value); }); break;
      case "map-literal": e.entries.forEach((en) => { walkExpr(en.key); walkExpr(en.value); }); break;
      case "lambda-expression":
        e.params.forEach((p) => { if (p.defaultValue) walkExpr(p.defaultValue); });
        if (e.body.kind === "block") walkBlock(e.body); else walkExpr(e.body);
        break;
      case "if-expression": walkExpr(e.condition); walkExpr(e.then); walkExpr(e.else_); break;
      case "case-expression":
        walkExpr(e.subject);
        e.arms.forEach((a) => { if (a.body.kind === "block") walkBlock(a.body); else walkExpr(a.body as Expression); });
        break;
      case "construct-expression":
        if (e.named) (e.args as ObjectProperty[]).forEach((p) => { if (p.value) walkExpr(p.value); });
        else (e.args as Expression[]).forEach(walkExpr);
        break;
      case "string-literal": e.parts.forEach((p) => { if (typeof p !== "string") walkExpr(p); }); break;
      case "async-expression":
        if (e.expression.kind === "block") walkBlock(e.expression as Block);
        else walkExpr(e.expression as Expression);
        break;
      case "actor-creation-expression":
        (e.args as Expression[]).forEach(walkExpr);
        break;
      case "catch-expression":
        e.body.forEach(walkStmt);
        break;
      case "non-null-assertion": walkExpr(e.expression); break;
      case "as-expression": walkExpr(e.expression); break;
    }
  }

  function walkStmt(s: Statement): void {
    switch (s.kind) {
      case "const-declaration": case "readonly-declaration":
      case "immutable-binding": case "let-declaration":
        walkExpr(s.value); break;
      case "function-declaration":
        s.params.forEach((p) => { if (p.defaultValue) walkExpr(p.defaultValue); });
        if (s.body.kind === "block") walkBlock(s.body); else walkExpr(s.body);
        break;
      case "class-declaration":
        s.fields.forEach((f) => { if (f.defaultValue) walkExpr(f.defaultValue); });
        s.methods.forEach((m) => {
          m.params.forEach((p) => { if (p.defaultValue) walkExpr(p.defaultValue); });
          if (m.body.kind === "block") walkBlock(m.body); else walkExpr(m.body);
        });
        break;
      case "if-statement":
        walkExpr(s.condition); walkBlock(s.body);
        s.elseIfs.forEach((ei) => { walkExpr(ei.condition); walkBlock(ei.body); });
        if (s.else_) walkBlock(s.else_);
        break;
      case "case-statement":
        walkExpr(s.subject);
        s.arms.forEach((a) => { if (a.body.kind === "block") walkBlock(a.body); else walkExpr(a.body as Expression); });
        break;
      case "while-statement":
        walkExpr(s.condition); walkBlock(s.body);
        if (s.then_) walkBlock(s.then_);
        break;
      case "for-statement":
        if (s.init) walkStmt(s.init);
        if (s.condition) walkExpr(s.condition);
        s.update.forEach(walkExpr);
        walkBlock(s.body);
        if (s.then_) walkBlock(s.then_);
        break;
      case "for-of-statement":
        walkExpr(s.iterable); walkBlock(s.body);
        if (s.then_) walkBlock(s.then_);
        break;
      case "with-statement":
        s.bindings.forEach((b) => walkExpr(b.value));
        walkBlock(s.body);
        break;
      case "return-statement": if (s.value) walkExpr(s.value); break;
      case "expression-statement": walkExpr(s.expression); break;
      case "export-declaration": walkStmt(s.declaration); break;
      case "array-destructuring": walkExpr(s.value); break;
      case "positional-destructuring": walkExpr(s.value); break;
      case "named-destructuring": walkExpr(s.value); break;
      case "array-destructuring-assignment": walkExpr(s.value); break;
      case "positional-destructuring-assignment": walkExpr(s.value); break;
      case "named-destructuring-assignment": walkExpr(s.value); break;
      case "try-statement": walkStmt(s.binding); break;
      case "block": walkBlock(s); break;
    }
  }

  function walkBlock(b: Block): void { b.statements.forEach(walkStmt); }

  program.statements.forEach(walkStmt);
  return exprs;
}

// ============================================================================
// Helpers
// ============================================================================

/** Result of the full analysis + type-checking pipeline. */
export interface CheckResult {
  program: Program;
  diagnostics: Diagnostic[];
  result: AnalysisResult;
}

/** Run the full analysis + type-checking pipeline on a file map. */
export function check(files: Record<string, string>, entry: string): CheckResult {
  const fs = new VirtualFS(files);
  const resolver = createBundledModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fs), resolver);
  const result = analyzer.analyzeModule(entry);
  const checker = new TypeChecker(result);
  const info = checker.checkModule(entry);
  return { program: result.modules.get(entry)!.program, diagnostics: info.diagnostics, result };
}

/** Get all identifier bindings whose name matches, by walking the decorated AST. */
export function findId(cr: CheckResult, name: string): Binding[] {
  return collectExprs(cr.program)
    .filter((e): e is Identifier => e.kind === "identifier" && e.resolvedBinding?.name === name)
    .map((e) => e.resolvedBinding!);
}

/** Get all expression resolved types that match a predicate, by walking the decorated AST. */
export function findTypes(
  cr: CheckResult,
  pred: (t: ResolvedType) => boolean,
): ResolvedType[] {
  return collectExprs(cr.program)
    .filter((e) => e.resolvedType !== undefined && pred(e.resolvedType))
    .map((e) => e.resolvedType!);
}
