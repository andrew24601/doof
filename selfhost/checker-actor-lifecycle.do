// Conservative straight-line use-after-retire diagnostics.
//
// Runtime aliases remain guarded by Actor<T>'s lifecycle state. This pass adds
// an earlier diagnostic when a later statement reuses the same resolved
// lexical binding after `retire binding`.

import {
  ActorCreationExpression, ArrayLiteral, AssignmentExpression, AsyncExpression,
  BinaryExpression, Block, CallExpression, CaseExpression, CaseStatement,
  ConstDeclaration, ConstructExpression, DestructuringStatement, ExportDeclaration,
  Expression, ExpressionStatement, ForOfStatement, ForStatement, Identifier,
  IfExpression, IfStatement, ImmutableBinding, IndexExpression, LambdaExpression,
  LetDeclaration, MemberExpression, ObjectLiteral, ReadonlyDeclaration,
  RetireExpression, ReturnStatement, SourceSpan, Statement, StringLiteral, TryStatement,
  TupleLiteral, UnaryExpression, WhileStatement, WithStatement, YieldStatement,
  AsExpression, RangePattern, ValuePattern, CatchExpression, YieldBlockExpression, YieldBlockAssignmentStatement,
} from "./ast"
import { ActorType, Binding, Diagnostic, SemanticLocation, SemanticSpan } from "./semantic"

export function reportRetiredActorUses(statement: Statement, retired: Binding[], module: string, diagnostics: Diagnostic[]): void {
  if retired.length == 0 { return }
  let identifiers: Identifier[] = []
  collectStatementIdentifiers(statement, identifiers)
  for identifier of identifiers {
    if identifier.resolvedBinding == null { continue }
    for binding of retired {
      if sameBinding(identifier.resolvedBinding!, binding) {
        diagnostics.push(Diagnostic {
          severity: "error",
          message: "Cannot use actor binding \"" + identifier.name + "\" after it has been retired",
          span: semanticSpan(identifier.span),
          module,
        })
      }
    }
  }
}

export function collectRetiredActorBindings(statement: Statement, retired: Binding[]): void {
  let expressions: Expression[] = []
  collectStatementExpressions(statement, expressions)
  for expression of expressions {
    case expression {
      retire_: RetireExpression -> {
        case retire_.actor {
          identifier: Identifier -> {
            if identifier.resolvedBinding == null || identifier.resolvedType == null { continue }
            case identifier.resolvedType! {
              _: ActorType -> { addBinding(retired, identifier.resolvedBinding!) }
              _ -> { }
            }
          }
          _ -> { }
        }
      }
      _ -> { }
    }
  }
}

function collectStatementIdentifiers(statement: Statement, result: Identifier[]): void {
  let expressions: Expression[] = []
  collectStatementExpressions(statement, expressions)
  for expression of expressions { collectExpressionIdentifiers(expression, result) }
}

function collectExpressionIdentifiers(expression: Expression, result: Identifier[]): void {
  case expression {
    identifier: Identifier -> { result.push(identifier) }
    _ -> { }
  }
  let nested: Expression[] = []
  collectNestedExpressions(expression, nested)
  for child of nested { collectExpressionIdentifiers(child, result) }
}

export function collectStatementExpressions(statement: Statement, result: Expression[]): void {
  case statement {
    value: ConstDeclaration -> { result.push(value.value) }
    value: ReadonlyDeclaration -> { result.push(value.value) }
    value: ImmutableBinding -> { result.push(value.value); if value.else_ != null { collectBlockExpressions(value.else_!, result) } }
    value: LetDeclaration -> { result.push(value.value) }
    expression: ExpressionStatement -> { result.push(expression.expression) }
    return_: ReturnStatement -> { if return_.value != null { result.push(return_.value!) } }
    yield_: YieldStatement -> { result.push(yield_.value) }
    if_: IfStatement -> {
      result.push(if_.condition)
      collectBlockExpressions(if_.body, result)
      for branch of if_.elseIfs { result.push(branch.condition); collectBlockExpressions(branch.body, result) }
      if if_.else_ != null { collectBlockExpressions(if_.else_!, result) }
    }
    while_: WhileStatement -> {
      result.push(while_.condition); collectBlockExpressions(while_.body, result)
      if while_.then_ != null { collectBlockExpressions(while_.then_!, result) }
    }
    for_: ForStatement -> {
      if for_.init != null { collectStatementExpressions(for_.init!, result) }
      if for_.condition != null { result.push(for_.condition!) }
      for update of for_.update { result.push(update) }
      collectBlockExpressions(for_.body, result)
      if for_.then_ != null { collectBlockExpressions(for_.then_!, result) }
    }
    forOf: ForOfStatement -> {
      result.push(forOf.iterable); collectBlockExpressions(forOf.body, result)
      if forOf.then_ != null { collectBlockExpressions(forOf.then_!, result) }
    }
    with_: WithStatement -> {
      for binding of with_.bindings { result.push(binding.value) }
      collectBlockExpressions(with_.body, result)
    }
    case_: CaseStatement -> {
      result.push(case_.subject)
      for arm of case_.arms {
        for pattern of arm.patterns {
          case pattern {
            value: ValuePattern -> { result.push(value.value) }
            range: RangePattern -> {
              if range.start != null { result.push(range.start!) }
              if range.end != null { result.push(range.end!) }
            }
            _ -> { }
          }
        }
        case arm.body {
          block: Block -> { collectBlockExpressions(block, result) }
          expression: Expression -> { result.push(expression) }
        }
      }
    }
    destructuring: DestructuringStatement -> { result.push(destructuring.value) }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { collectStatementExpressions(declaration, result) }
        declaration: ReadonlyDeclaration -> { collectStatementExpressions(declaration, result) }
        binding: ImmutableBinding -> { collectStatementExpressions(binding, result) }
        declaration: LetDeclaration -> { collectStatementExpressions(declaration, result) }
        expression: ExpressionStatement -> { collectStatementExpressions(expression, result) }
        destructuring: DestructuringStatement -> { collectStatementExpressions(destructuring, result) }
      }
    }
    assignment: YieldBlockAssignmentStatement -> { result.push(assignment.value) }
    export_: ExportDeclaration -> { collectStatementExpressions(export_.declaration, result) }
    block: Block -> { collectBlockExpressions(block, result) }
    _ -> { }
  }
}

export function collectBlockExpressions(block: Block, result: Expression[]): void {
  for statement of block.statements { collectStatementExpressions(statement, result) }
}

export function collectNestedExpressions(expression: Expression, result: Expression[]): void {
  case expression {
    string_: StringLiteral -> { for interpolation of string_.interpolations { result.push(interpolation) } }
    binary: BinaryExpression -> { result.push(binary.left); result.push(binary.right) }
    unary: UnaryExpression -> { result.push(unary.operand) }
    assignment: AssignmentExpression -> { result.push(assignment.target); result.push(assignment.value) }
    member: MemberExpression -> { result.push(member.object) }
    index: IndexExpression -> { result.push(index.object); result.push(index.index) }
    call: CallExpression -> { result.push(call.callee); for argument of call.args { result.push(argument.value) } }
    array: ArrayLiteral -> { for element of array.elements { result.push(element) } }
    object: ObjectLiteral -> {
      if object.spread != null { result.push(object.spread!) }
      for property of object.properties {
        if property.key != null { result.push(property.key!) }
        if property.value != null { result.push(property.value!) }
      }
    }
    tuple: TupleLiteral -> { for element of tuple.elements { result.push(element) } }
    lambda: LambdaExpression -> {
      case lambda.body {
        block: Block -> { collectBlockExpressions(block, result) }
        body: Expression -> { result.push(body) }
      }
    }
    if_: IfExpression -> { result.push(if_.condition); result.push(if_.then_); result.push(if_.else_) }
    case_: CaseExpression -> {
      result.push(case_.subject)
      for arm of case_.arms {
        for pattern of arm.patterns {
          case pattern {
            value: ValuePattern -> { result.push(value.value) }
            range: RangePattern -> {
              if range.start != null { result.push(range.start!) }
              if range.end != null { result.push(range.end!) }
            }
            _ -> { }
          }
        }
        case arm.body {
          block: Block -> { collectBlockExpressions(block, result) }
          bodyExpression: Expression -> { result.push(bodyExpression) }
        }
      }
    }
    yieldBlock: YieldBlockExpression -> { collectBlockExpressions(yieldBlock.body, result) }
    catch_: CatchExpression -> { collectBlockExpressions(catch_.body, result) }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { collectBlockExpressions(block, result) }
        inner: Expression -> { result.push(inner) }
      }
    }
    retire_: RetireExpression -> { result.push(retire_.actor) }
    actor: ActorCreationExpression -> { for argument of actor.args { result.push(argument) } }
    construct: ConstructExpression -> {
      for property of construct.args { if property.value != null { result.push(property.value!) } }
    }
    as_: AsExpression -> { result.push(as_.expression) }
    _ -> { }
  }
}

function sameBinding(left: Binding, right: Binding): bool {
  return left.name == right.name && left.span.start.offset == right.span.start.offset && left.span.end.offset == right.span.end.offset
}

function addBinding(values: Binding[], value: Binding): void {
  for existing of values { if sameBinding(existing, value) { return } }
  values.push(value)
}

function semanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}
