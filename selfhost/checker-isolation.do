// Transitive mutable-global effect analysis for isolated and actor-dispatched code.

import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ActorType, Binding, Diagnostic, InterfaceType, ResolvedType, SemanticLocation, SemanticSpan,
} from "./semantic"
import {
  ActorCreationExpression, Block, CallExpression, ClassDeclaration, ConstDeclaration,
  ExportDeclaration, Expression, FunctionDeclaration, Identifier, ImmutableBinding,
  InterfaceDeclaration, MemberExpression, ReadonlyDeclaration, SourceSpan, Statement,
} from "./ast"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import {
  collectBlockExpressions, collectNestedExpressions, collectStatementExpressions,
} from "./checker-actor-lifecycle"
import { declarationFor } from "./checker-symbols"

export class IsolationReason {
  kind: string
  name: string
  span: SourceSpan
}

class IsolationCall {
  declaration: FunctionDeclaration
  span: SourceSpan
}

class IsolationNode {
  declaration: FunctionDeclaration
  module: string
  owner: string = ""
  calls: IsolationCall[] = []
  directReason: IsolationReason | null = null
  reason: IsolationReason | null = null
}

class IsolationGraph {
  nodes: IsolationNode[] = []
}

function unwrapExport(statement: Statement): Statement {
  case statement {
    export_: ExportDeclaration -> { return export_.declaration }
    _ -> { return statement }
  }
}

function collectGraph(result: AnalysisResult): IsolationGraph {
  graph := IsolationGraph {}
  for module of result.modules {
    for raw of module.program.statements {
      case unwrapExport(raw) {
        fn: FunctionDeclaration -> { graph.nodes.push(IsolationNode { declaration: fn, module: module.path }) }
        class_: ClassDeclaration -> {
          for method of class_.methods {
            graph.nodes.push(IsolationNode { declaration: method, module: module.path, owner: class_.name })
          }
        }
        _ -> { }
      }
    }
  }
  return graph
}

function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

function sameSpan(left: SourceSpan, right: SemanticSpan): bool {
  return left.start.offset == right.start.offset && left.end.offset == right.end.offset
}

function moduleValueDeclaration(result: AnalysisResult, binding: Binding): Statement | null {
  if binding.symbol != null && (binding.symbol!.kind == "const" || binding.symbol!.kind == "readonly") {
    return declarationFor(result, binding.symbol!)
  }
  module := findModule(result, binding.module)
  if module == null { return null }
  for raw of module!.program.statements {
    statement := unwrapExport(raw)
    case statement {
      value: ConstDeclaration -> { if sameSpan(value.span, binding.span) { return value } }
      value: ReadonlyDeclaration -> { if sameSpan(value.span, binding.span) { return value } }
      value: ImmutableBinding -> { if sameSpan(value.span, binding.span) { return value } }
      _ -> { }
    }
  }
  return null
}

function mutableModuleReason(result: AnalysisResult, expression: Expression): IsolationReason | null {
  case expression {
    identifier: Identifier -> {
      if identifier.resolvedBinding == null { return null }
      declaration := moduleValueDeclaration(result, identifier.resolvedBinding!)
      if declaration == null { return null }
      case declaration! {
        _: ReadonlyDeclaration -> { return null }
        _: ConstDeclaration -> { }
        _: ImmutableBinding -> { }
        _ -> { return null }
      }
      violation := findActorBoundaryViolation(result, identifier.resolvedBinding!.type_)
      if violation != null {
        return IsolationReason { kind: "module", name: identifier.name, span: identifier.span }
      }
    }
    _ -> { }
  }
  return null
}

function mutableStaticReason(expression: Expression): IsolationReason | null {
  case expression {
    member: MemberExpression -> {
      if member.resolvedStaticOwner == null { return null }
      for field of member.resolvedStaticOwner!.fields {
        if !field.static_ || field.readonly_ { continue }
        for name of field.names {
          if name == member.property {
            return IsolationReason {
              kind: "static",
              name: member.resolvedStaticOwner!.name + "." + member.property,
              span: member.span,
            }
          }
        }
      }
    }
    _ -> { }
  }
  return null
}

function allExpressions(roots: Expression[]): Expression[] {
  let result: Expression[] = []
  for root of roots { collectExpressionTree(root, result) }
  return result
}

function collectExpressionTree(expression: Expression, result: Expression[]): void {
  result.push(expression)
  let nested: Expression[] = []
  collectNestedExpressions(expression, nested)
  for child of nested { collectExpressionTree(child, result) }
}

function functionExpressions(fn: FunctionDeclaration): Expression[] {
  let roots: Expression[] = []
  for parameter of fn.params { if parameter.defaultValue != null { roots.push(parameter.defaultValue!) } }
  case fn.body {
    block: Block -> { collectBlockExpressions(block, roots) }
    expression: Expression -> { roots.push(expression) }
  }
  return allExpressions(roots)
}

function nodeForDeclaration(graph: IsolationGraph, declaration: FunctionDeclaration): IsolationNode | null {
  for node of graph.nodes { if node.declaration == declaration { return node } }
  return null
}

function nodesForDeclaration(result: AnalysisResult, graph: IsolationGraph, declaration: FunctionDeclaration): IsolationNode[] {
  direct := nodeForDeclaration(graph, declaration)
  if direct != null { return [direct!] }
  let targets: IsolationNode[] = []
  for module of result.modules {
    for raw of module.program.statements {
      case unwrapExport(raw) {
        interface_: InterfaceDeclaration -> {
          let ownsMethod = false
          for method of interface_.methods {
            if method.name == declaration.name && method.span.start.offset == declaration.span.start.offset && method.span.end.offset == declaration.span.end.offset {
              ownsMethod = true
            }
          }
          if !ownsMethod || interface_.resolvedSymbol == null { continue }
          for implementation of interface_.resolvedSymbol!.implementations {
            candidate := declarationFor(result, implementation)
            if candidate == null { continue }
            case candidate! {
              class_: ClassDeclaration -> {
                for method of class_.methods {
                  if method.name == declaration.name && method.static_ == declaration.static_ {
                    node := nodeForDeclaration(graph, method)
                    if node != null { targets.push(node!) }
                  }
                }
              }
              _ -> { }
            }
          }
        }
        _ -> { }
      }
    }
  }
  return targets
}

function callDeclaration(result: AnalysisResult, call: CallExpression): FunctionDeclaration | null {
  if call.resolvedFunction != null { return call.resolvedFunction }
  case call.callee {
    member: MemberExpression -> {
      if member.object.resolvedType == null { return null }
      case member.object.resolvedType! {
        interface_: InterfaceType -> {
          declaration := declarationFor(result, interface_.symbol)
          if declaration == null { return null }
          case declaration! {
            interfaceDeclaration: InterfaceDeclaration -> {
              for method of interfaceDeclaration.methods { if method.name == member.property { return method } }
            }
            _ -> { }
          }
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return null
}

function analyzeNode(result: AnalysisResult, graph: IsolationGraph, node: IsolationNode): void {
  if node.declaration.bodyless && !node.declaration.isolated_ {
    node.directReason = IsolationReason { kind: "bodyless", name: node.declaration.name, span: node.declaration.span }
    return
  }
  for expression of functionExpressions(node.declaration) {
    if node.directReason == null {
      node.directReason = mutableModuleReason(result, expression)
      if node.directReason == null { node.directReason = mutableStaticReason(expression) }
    }
    case expression {
      call: CallExpression -> {
        declaration := callDeclaration(result, call)
        if declaration != null {
          node.calls.push(IsolationCall { declaration: declaration!, span: call.span })
        }
      }
      _ -> { }
    }
  }
}

function inferIsolation(result: AnalysisResult, graph: IsolationGraph): void {
  for node of graph.nodes {
    analyzeNode(result, graph, node)
    node.reason = node.directReason
  }
  let changed = true
  while changed {
    changed = false
    for node of graph.nodes {
      if node.reason != null { continue }
      for call of node.calls {
        for target of nodesForDeclaration(result, graph, call.declaration) {
          if target.reason != null {
            node.reason = IsolationReason { kind: "call", name: target.declaration.name, span: call.span }
            changed = true
            break
          }
        }
        if node.reason != null { break }
      }
    }
  }
  for node of graph.nodes { node.declaration.resolvedIsolated = node.reason == null }
}

function reasonText(reason: IsolationReason): string {
  if reason.kind == "module" { return "accesses mutable module binding \"" + reason.name + "\"" }
  if reason.kind == "static" { return "accesses mutable static field \"" + reason.name + "\"" }
  if reason.kind == "call" { return "calls non-isolated function \"" + reason.name + "\"" }
  return "uses bodyless function \"" + reason.name + "\" without an isolated contract"
}

function semanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}

function pushDiagnostic(diagnostics: Diagnostic[], module: string, span: SourceSpan, message: string): void {
  diagnostics.push(Diagnostic { severity: "error", message, span: semanticSpan(span), module })
}

function probeReason(result: AnalysisResult, graph: IsolationGraph, expression: Expression): IsolationReason | null {
  for nested of allExpressions([expression]) {
    let reason = mutableModuleReason(result, nested)
    if reason == null { reason = mutableStaticReason(nested) }
    if reason != null { return reason }
    case nested {
      call: CallExpression -> {
        declaration := callDeclaration(result, call)
        if declaration != null {
          for target of nodesForDeclaration(result, graph, declaration!) {
            if target.reason != null {
              return IsolationReason { kind: "call", name: target.declaration.name, span: call.span }
            }
          }
        }
      }
      _ -> { }
    }
  }
  return null
}

function actorConstructionReason(result: AnalysisResult, graph: IsolationGraph, actor: ActorCreationExpression): IsolationReason | null {
  if actor.resolvedType == null { return null }
  let class_: ClassDeclaration | null = null
  case actor.resolvedType! {
    actorType_: ActorType -> {
      declaration := declarationFor(result, actorType_.innerClass.symbol)
      if declaration != null {
        case declaration! {
          resolved: ClassDeclaration -> { class_ = resolved }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  if class_ == null { return null }
  for method of class_!.methods {
    if method.static_ && method.name == "constructor" {
      node := nodeForDeclaration(graph, method)
      if node != null && node!.reason != null {
        return IsolationReason { kind: "call", name: method.name, span: actor.span }
      }
      return null
    }
  }
  let positionalIndex = 0
  for field of class_!.fields {
    if field.static_ { continue }
    if positionalIndex >= actor.args.length && field.defaultValue != null {
      reason := probeReason(result, graph, field.defaultValue!)
      if reason != null { return reason }
    }
    positionalIndex = positionalIndex + 1
  }
  return null
}

function moduleExpressions(module: ModuleInfo): Expression[] {
  let roots: Expression[] = []
  for raw of module.program.statements {
    statement := unwrapExport(raw)
    case statement {
      fn: FunctionDeclaration -> {
        for expression of functionExpressions(fn) { roots.push(expression) }
      }
      class_: ClassDeclaration -> {
        for field of class_.fields { if field.defaultValue != null { roots.push(field.defaultValue!) } }
        for method of class_.methods {
          for expression of functionExpressions(method) { roots.push(expression) }
        }
      }
      _ -> { collectStatementExpressions(statement, roots) }
    }
  }
  return allExpressions(roots)
}

export function validateIsolationEffects(result: AnalysisResult, module: ModuleInfo, diagnostics: Diagnostic[]): void {
  graph := collectGraph(result)
  inferIsolation(result, graph)

  for node of graph.nodes {
    if node.module != module.path || !node.declaration.isolated_ || node.reason == null { continue }
    owner := if node.owner == "" then "function \"" + node.declaration.name + "\"" else "method \"" + node.owner + "." + node.declaration.name + "\""
    message := if node.reason!.kind == "call"
      then "Isolated " + owner + " cannot call non-isolated function \"" + node.reason!.name + "\""
      else "Isolated " + owner + " is not isolated: " + reasonText(node.reason!)
    pushDiagnostic(diagnostics, module.path, node.reason!.span, message)
  }

  for expression of moduleExpressions(module) {
    case expression {
      call: CallExpression -> {
        case call.callee {
          member: MemberExpression -> {
            if member.object.resolvedType != null {
              case member.object.resolvedType! {
                _: ActorType -> {
                  if call.resolvedFunction != null {
                    target := nodeForDeclaration(graph, call.resolvedFunction!)
                    if target != null && target!.reason != null {
                      pushDiagnostic(diagnostics, module.path, call.span,
                        "Actor method \"" + target!.declaration.name + "\" is not isolated: " + reasonText(target!.reason!))
                    }
                  }
                }
                _ -> { }
              }
            }
          }
          _ -> { }
        }
      }
      actor: ActorCreationExpression -> {
        reason := actorConstructionReason(result, graph, actor)
        if reason != null {
          pushDiagnostic(diagnostics, module.path, actor.span,
            "Actor<" + actor.className + "> construction is not isolated: " + reasonText(reason!))
        }
      }
      _ -> { }
    }
  }
}
