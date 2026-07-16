/** Transitive mutable-global effect analysis for isolated and actor-dispatched code. */

import type {
  ActorCreationExpression,
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  SourceSpan,
  Statement,
} from "./ast.js";
import { findActorBoundaryViolation } from "./checker-actor-boundary.js";
import type { CheckerHost } from "./checker-internal.js";
import { walkExpression, walkStatementListExpressions } from "./checker-stmt.js";
import { isAssignableTo, type ModuleTypeInfo, type ResolvedType } from "./checker-types.js";
import type { AnalysisResult } from "./analyzer.js";
import type { ModuleSymbol, ModuleSymbolTable } from "./types.js";

type IsolationReason =
  | { kind: "module"; name: string; span: SourceSpan }
  | { kind: "static"; name: string; span: SourceSpan }
  | { kind: "call"; name: string; span: SourceSpan }
  | { kind: "bodyless"; name: string; span: SourceSpan };

interface CallEdge {
  target: FunctionNode;
  span: SourceSpan;
}

interface FunctionNode {
  declaration: FunctionDeclaration;
  module: string;
  owner: ClassDeclaration | null;
  calls: CallEdge[];
  directReason: IsolationReason | null;
  reason: IsolationReason | null;
}

interface IsolationGraph {
  analysis: AnalysisResult;
  nodes: FunctionNode[];
  nodeByDeclaration: Map<FunctionDeclaration, FunctionNode>;
  nodeBySpan: Map<string, FunctionNode>;
  moduleValues: Map<string, boolean>;
}

function spanKey(module: string, span: SourceSpan): string {
  return `${module}:${span.start.offset}:${span.end.offset}`;
}

function unwrapExport(statement: Statement): Statement {
  return statement.kind === "export-declaration" ? statement.declaration : statement;
}

function collectGraph(analysis: AnalysisResult): IsolationGraph {
  const graph: IsolationGraph = {
    analysis,
    nodes: [],
    nodeByDeclaration: new Map(),
    nodeBySpan: new Map(),
    moduleValues: new Map(),
  };

  const addFunction = (
    declaration: FunctionDeclaration,
    module: string,
    owner: ClassDeclaration | null,
  ): void => {
    const node: FunctionNode = {
      declaration,
      module,
      owner,
      calls: [],
      directReason: null,
      reason: null,
    };
    graph.nodes.push(node);
    graph.nodeByDeclaration.set(declaration, node);
    graph.nodeBySpan.set(spanKey(module, declaration.span), node);
  };

  for (const [module, table] of analysis.modules) {
    for (const rawStatement of table.program.statements) {
      const statement = unwrapExport(rawStatement);
      switch (statement.kind) {
        case "function-declaration":
          addFunction(statement, module, null);
          break;
        case "extern-function-declaration": {
          const symbol = table.symbols.get(statement.name);
          if (symbol?.symbolKind === "function") addFunction(symbol.declaration, module, null);
          break;
        }
        case "class-declaration":
          for (const method of statement.methods) addFunction(method, module, statement);
          break;
        case "extern-class-declaration": {
          const symbol = table.symbols.get(statement.name);
          if (symbol?.symbolKind !== "class") break;
          for (const method of symbol.declaration.methods) {
            addFunction(method, module, symbol.declaration);
          }
          break;
        }
        case "const-declaration":
        case "readonly-declaration":
        case "immutable-binding":
          graph.moduleValues.set(
            spanKey(module, statement.span),
            statement.kind === "readonly-declaration",
          );
          break;
        default:
          break;
      }
    }
  }

  return graph;
}

function nominalOwner(type: ResolvedType | undefined): Extract<ResolvedType, { kind: "class" | "struct" | "interface" }> | null {
  if (!type) return null;
  if (type.kind === "actor") return type.innerClass;
  if (type.kind === "class" || type.kind === "struct" || type.kind === "interface") return type;
  return null;
}

function functionSymbolForExpression(expression: Expression): ModuleSymbol | null {
  if (expression.kind === "identifier") {
    return expression.resolvedBinding?.symbol ?? null;
  }
  if (expression.kind === "member-expression" || expression.kind === "qualified-member-expression") {
    return expression.resolvedNamespaceMemberSymbol ?? null;
  }
  return null;
}

function targetForCall(graph: IsolationGraph, expression: Expression): FunctionNode | null {
  const symbol = functionSymbolForExpression(expression);
  if (symbol?.symbolKind === "function") {
    return graph.nodeByDeclaration.get(symbol.declaration) ?? null;
  }

  if (expression.kind === "identifier") {
    const binding = expression.resolvedBinding;
    return binding ? graph.nodeBySpan.get(spanKey(binding.module, binding.span)) ?? null : null;
  }

  if (expression.kind !== "member-expression" && expression.kind !== "qualified-member-expression") {
    return null;
  }

  const owner = nominalOwner(expression.object.resolvedType);
  if (!owner || owner.kind === "interface") return null;
  const method = owner.symbol.declaration.methods.find((candidate) =>
    candidate.name === expression.property
    && candidate.static_ === (expression.kind === "qualified-member-expression")
  );
  return method ? graph.nodeByDeclaration.get(method) ?? null : null;
}

function targetsForCall(graph: IsolationGraph, expression: Expression): FunctionNode[] {
  const direct = targetForCall(graph, expression);
  if (direct) return [direct];
  if (expression.kind !== "member-expression" && expression.kind !== "qualified-member-expression") return [];
  const owner = nominalOwner(expression.object.resolvedType);
  if (!owner || owner.kind !== "interface") return [];

  const targets: FunctionNode[] = [];
  for (const [, module] of graph.analysis.modules) {
    for (const [, symbol] of module.symbols) {
      if (symbol.symbolKind !== "class") continue;
      if (!isAssignableTo({ kind: "class", symbol }, owner)) continue;
      const method = symbol.declaration.methods.find((candidate) =>
        candidate.name === expression.property
        && candidate.static_ === (expression.kind === "qualified-member-expression")
      );
      const node = method ? graph.nodeByDeclaration.get(method) : undefined;
      if (node && !targets.includes(node)) targets.push(node);
    }
  }
  return targets;
}

function mutableModuleBindingReason(
  host: CheckerHost,
  graph: IsolationGraph,
  expression: Expression,
): IsolationReason | null {
  if (expression.kind !== "identifier" || !expression.resolvedBinding) return null;
  const binding = expression.resolvedBinding;
  const key = spanKey(binding.module, binding.span);
  const explicitlyReadonly = graph.moduleValues.get(key);
  if (explicitlyReadonly === undefined || explicitlyReadonly) return null;

  const table = host.analysisResult.modules.get(binding.module);
  if (!table) return null;
  const violation = findActorBoundaryViolation(host, binding.type, table);
  if (!violation) return null;
  return { kind: "module", name: binding.name, span: expression.span };
}

function mutableStaticReason(expression: Expression): IsolationReason | null {
  if (expression.kind !== "member-expression" && expression.kind !== "qualified-member-expression") {
    return null;
  }
  const owner = nominalOwner(expression.object.resolvedType);
  if (!owner || owner.kind === "interface") return null;
  const field = owner.symbol.declaration.fields.find((candidate) =>
    candidate.static_ && candidate.names.includes(expression.property)
  );
  if (!field || field.readonly_ || field.const_) return null;
  return { kind: "static", name: `${owner.symbol.name}.${expression.property}`, span: expression.span };
}

function visitFunctionBody(node: FunctionNode, visit: (expression: Expression) => void): void {
  for (const parameter of node.declaration.params) {
    if (parameter.defaultValue) walkExpression(parameter.defaultValue, visit);
  }
  if (node.declaration.body.kind === "block") {
    walkStatementListExpressions(node.declaration.body.statements, (root) => walkExpression(root, visit));
  } else {
    walkExpression(node.declaration.body, visit);
  }
}

function analyzeFunction(host: CheckerHost, graph: IsolationGraph, node: FunctionNode): void {
  if (node.declaration.bodyless && !node.declaration.isolated_) {
    node.directReason = {
      kind: "bodyless",
      name: node.declaration.name,
      span: node.declaration.span,
    };
    return;
  }

  visitFunctionBody(node, (expression) => {
    if (!node.directReason) {
      node.directReason = mutableModuleBindingReason(host, graph, expression)
        ?? mutableStaticReason(expression);
    }
    if (expression.kind !== "call-expression") return;
    for (const target of targetsForCall(graph, expression.callee)) {
      node.calls.push({ target, span: expression.span });
    }
  });
}

function inferIsolation(host: CheckerHost, graph: IsolationGraph): void {
  for (const node of graph.nodes) analyzeFunction(host, graph, node);
  for (const node of graph.nodes) node.reason = node.directReason;

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.reason) continue;
      const unsafeCall = node.calls.find((edge) => edge.target.reason !== null);
      if (!unsafeCall) continue;
      node.reason = {
        kind: "call",
        name: unsafeCall.target.declaration.name,
        span: unsafeCall.span,
      };
      changed = true;
    }
  }

  for (const node of graph.nodes) {
    node.declaration.resolvedIsolated = node.reason === null;
  }
}

function reasonText(reason: IsolationReason): string {
  switch (reason.kind) {
    case "module": return `accesses mutable module binding "${reason.name}"`;
    case "static": return `accesses mutable static field "${reason.name}"`;
    case "call": return `calls non-isolated function "${reason.name}"`;
    case "bodyless": return `uses bodyless function "${reason.name}" without an isolated contract`;
  }
}

function visitModuleExpressions(table: ModuleSymbolTable, visit: (expression: Expression) => void): void {
  for (const rawStatement of table.program.statements) {
    const statement = unwrapExport(rawStatement);
    switch (statement.kind) {
      case "function-declaration": {
        const body = statement.body;
        if (body.kind === "block") {
          walkStatementListExpressions(body.statements, (root) => walkExpression(root, visit));
        } else {
          walkExpression(body, visit);
        }
        break;
      }
      case "class-declaration":
        for (const field of statement.fields) {
          if (field.defaultValue) walkExpression(field.defaultValue, visit);
        }
        for (const method of statement.methods) {
          if (method.body.kind === "block") {
            walkStatementListExpressions(method.body.statements, (root) => walkExpression(root, visit));
          } else {
            walkExpression(method.body, visit);
          }
        }
        break;
      case "const-declaration":
      case "readonly-declaration":
      case "immutable-binding":
        walkExpression(statement.value, visit);
        break;
      default:
        break;
    }
  }
}

function firstExpressionReason(
  host: CheckerHost,
  graph: IsolationGraph,
  expression: Expression,
): IsolationReason | null {
  let reason: IsolationReason | null = null;
  walkExpression(expression, (nested) => {
    if (reason) return;
    reason = mutableModuleBindingReason(host, graph, nested) ?? mutableStaticReason(nested);
    if (reason || nested.kind !== "call-expression") return;
    const target = targetsForCall(graph, nested.callee).find((candidate) => candidate.reason !== null);
    if (target?.reason) reason = { kind: "call", name: target.declaration.name, span: nested.span };
  });
  return reason;
}

function actorConstructionReason(
  host: CheckerHost,
  graph: IsolationGraph,
  expression: ActorCreationExpression,
  table: ModuleSymbolTable,
): IsolationReason | null {
  const symbol = table.symbols.get(expression.className);
  if (symbol?.symbolKind !== "class") return null;
  const declaration = symbol.declaration;
  const factory = declaration.methods.find((method) => method.static_ && method.name === "constructor");
  if (factory) {
    const factoryNode = graph.nodeByDeclaration.get(factory);
    if (factoryNode?.reason) {
      return { kind: "call", name: factory.name, span: expression.span };
    }
    return null;
  }

  const fields = declaration.fields.filter((field) => !field.static_);
  for (let index = expression.args.length; index < fields.length; index++) {
    const defaultValue = fields[index].defaultValue;
    if (!defaultValue) continue;
    const reason = firstExpressionReason(host, graph, defaultValue);
    if (reason) return reason;
  }
  return null;
}

/** Validate explicit isolation contracts and actor-dispatched execution paths. */
export function validateIsolationEffects(
  host: CheckerHost,
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  const graph = collectGraph(host.analysisResult);
  inferIsolation(host, graph);

  for (const node of graph.nodes) {
    if (node.module !== table.path || !node.declaration.isolated_ || !node.reason) continue;
    const owner = node.owner ? `method "${node.owner.name}.${node.declaration.name}"` : `function "${node.declaration.name}"`;
    const prefix = node.reason.kind === "call"
      ? `Isolated ${owner} cannot call non-isolated function "${node.reason.name}"`
      : `Isolated ${owner} is not isolated: ${reasonText(node.reason)}`;
    info.diagnostics.push({
      severity: "error",
      message: prefix,
      span: node.reason.span,
      module: table.path,
    });
  }

  visitModuleExpressions(table, (expression) => {
    if (expression.kind === "call-expression"
      && (expression.callee.kind === "member-expression" || expression.callee.kind === "qualified-member-expression")
      && expression.callee.object.resolvedType?.kind === "actor") {
      const target = targetsForCall(graph, expression.callee)[0] ?? null;
      if (target?.reason) {
        info.diagnostics.push({
          severity: "error",
          message: `Actor method "${target.declaration.name}" is not isolated: ${reasonText(target.reason)}`,
          span: expression.span,
          module: table.path,
        });
      }
    }

    if (expression.kind === "actor-creation-expression") {
      const reason = actorConstructionReason(host, graph, expression, table);
      if (reason) {
        info.diagnostics.push({
          severity: "error",
          message: `Actor<${expression.className}> construction is not isolated: ${reasonText(reason)}`,
          span: expression.span,
          module: table.path,
        });
      }
    }
  });
}
