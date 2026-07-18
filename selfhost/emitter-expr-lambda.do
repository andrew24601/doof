// Lambda lowering and capture analysis for the self-hosted C++ emitter.
//
// Escaping closures must own mutable local state. Before a callable body is
// emitted, captured `let` bindings are identified so their declarations can be
// boxed in shared_ptr. Lambda capture lists then copy both ordinary immutable
// values and those boxes into the actor-affine doof::callback wrapper.

import {
  ActorCreationExpression, ArrayLiteral, AssignmentExpression, AsyncExpression, BinaryExpression, Block, CallExpression,
  CaseExpression, CaseStatement, ConstDeclaration, ConstructExpression, Expression,
  ExpressionStatement, ForOfStatement, ForStatement, Identifier, IfExpression,
  IfStatement, ImmutableBinding, IndexExpression, LambdaExpression,
  LetDeclaration, MemberExpression, ObjectLiteral, ReadonlyDeclaration, RetireExpression, ReturnStatement,
  Statement, StringLiteral, ThisExpression, TryStatement, DestructuringStatement, TupleLiteral, UnaryExpression,
  WhileStatement, WithStatement, YieldBlockExpression, YieldBlockAssignmentStatement, CatchExpression,
} from "./ast"
import { FunctionType, ResolvedType, ResultResolvedType, VoidType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitBlock } from "./emitter-stmt"
import { emitType } from "./emitter-types"

export function emitLambdaExpression(expression: LambdaExpression, context: EmitContext, expected: ResolvedType | null = null): string {
  let functionType = lambdaFunctionType(expression)
  if expected != null {
    case expected! {
      expectedFunction: FunctionType -> { functionType = expectedFunction }
      _ -> { }
    }
  }
  let params = ""
  for i of 0..<expression.params.length {
    if i > 0 { params = params + ", " }
    parameter := expression.params[i]
    if parameter.resolvedType == null { panic("Lambda parameter was not resolved before emission") }
    params = params + emitType(parameter.resolvedType!, context.modulePath) + " " + cppIdentifier(parameter.name)
  }

  captureNames := lambdaCaptureNames(expression)
  let captures = ""
  if captureNames.length > 0 {
    captures = ""
    for i of 0..<captureNames.length {
      if i > 0 { captures = captures + ", " }
      captures = captures + captureNames[i]
    }
  }

  previousReturnErrorType := context.currentReturnErrorType
  previousFunctionName := context.currentFunctionName
  context.currentFunctionName = previousFunctionName + ".<lambda>"
  case functionType.returnType {
    result: ResultResolvedType -> { context.currentReturnErrorType = emitType(result.errorType, context.modulePath) }
    _ -> { context.currentReturnErrorType = "" }
  }

  returnType := emitType(functionType.returnType, context.modulePath)
  let lambda = "[" + captures + "](" + params + ") -> " + returnType + " {"
  case expression.body {
    block: Block -> { lambda = lambda + "\n" + emitBlock(block, 1, context) + "}" }
    body: Expression -> { lambda = lambda + " return " + emitExpression(body, context, functionType.returnType) + "; }" }
  }

  context.currentReturnErrorType = previousReturnErrorType
  context.currentFunctionName = previousFunctionName
  return emitType(functionType, context.modulePath) + "(" + lambda + ")"
}

// Finds mutable bindings whose storage must outlive the current stack frame.
// Each lambda is evaluated against its own body span, so a mutable local used
// only by its containing lambda remains an ordinary local while one captured by
// a nested lambda is boxed.
export function scanCapturedMutablesInBlock(body: Block): string[] {
  let result: string[] = []
  scanBlockForLambdas(body, result)
  return result
}

export function scanCapturedMutablesInExpression(body: Expression): string[] {
  let result: string[] = []
  scanExpressionForLambdas(body, result)
  return result
}

function lambdaFunctionType(expression: LambdaExpression): FunctionType {
  if expression.resolvedType != null {
    case expression.resolvedType! {
      function_: FunctionType -> { return function_ }
      _ -> { }
    }
  }
  panic("Lambda has no resolved function type")
  return FunctionType { params: [], returnType: VoidType {} }
}

function lambdaCaptureNames(expression: LambdaExpression): string[] {
  let result: string[] = []
  let bodyStart = 0
  let bodyEnd = 0
  case expression.body {
    block: Block -> {
      bodyStart = block.span.start.offset
      bodyEnd = block.span.end.offset
      collectBlockCaptures(block, bodyStart, bodyEnd, result, false)
    }
    body: Expression -> {
      bodyStart = body.span.start.offset
      bodyEnd = body.span.end.offset
      collectExpressionCaptures(body, bodyStart, bodyEnd, result, false)
    }
  }
  let captures: string[] = []
  for name of result {
    let parameter = false
    for item of expression.params { if cppIdentifier(item.name) == name { parameter = true } }
    if !parameter { captures.push(name) }
  }
  return captures
}

function scanBlockForLambdas(block: Block, result: string[]): void {
  for statement of block.statements { scanStatementForLambdas(statement, result) }
}

function scanStatementForLambdas(statement: Statement, result: string[]): void {
  case statement {
    const_: ConstDeclaration -> { scanExpressionForLambdas(const_.value, result) }
    readonly_: ReadonlyDeclaration -> { scanExpressionForLambdas(readonly_.value, result) }
    binding: ImmutableBinding -> {
      scanExpressionForLambdas(binding.value, result)
      if binding.else_ != null { scanBlockForLambdas(binding.else_!, result) }
    }
    let_: LetDeclaration -> { scanExpressionForLambdas(let_.value, result) }
    expression: ExpressionStatement -> { scanExpressionForLambdas(expression.expression, result) }
    return_: ReturnStatement -> { if return_.value != null { scanExpressionForLambdas(return_.value!, result) } }
    if_: IfStatement -> {
      scanExpressionForLambdas(if_.condition, result)
      scanBlockForLambdas(if_.body, result)
      for branch of if_.elseIfs {
        scanExpressionForLambdas(branch.condition, result)
        scanBlockForLambdas(branch.body, result)
      }
      if if_.else_ != null { scanBlockForLambdas(if_.else_!, result) }
    }
    case_: CaseStatement -> {
      scanExpressionForLambdas(case_.subject, result)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { scanBlockForLambdas(block, result) }
          expression: Expression -> { scanExpressionForLambdas(expression, result) }
        }
      }
    }
    while_: WhileStatement -> {
      scanExpressionForLambdas(while_.condition, result)
      scanBlockForLambdas(while_.body, result)
      if while_.then_ != null { scanBlockForLambdas(while_.then_!, result) }
    }
    for_: ForStatement -> {
      if for_.init != null { scanStatementForLambdas(for_.init!, result) }
      if for_.condition != null { scanExpressionForLambdas(for_.condition!, result) }
      for update of for_.update { scanExpressionForLambdas(update, result) }
      scanBlockForLambdas(for_.body, result)
      if for_.then_ != null { scanBlockForLambdas(for_.then_!, result) }
    }
    forOf: ForOfStatement -> {
      scanExpressionForLambdas(forOf.iterable, result)
      scanBlockForLambdas(forOf.body, result)
      if forOf.then_ != null { scanBlockForLambdas(forOf.then_!, result) }
    }
    with_: WithStatement -> {
      for binding of with_.bindings { scanExpressionForLambdas(binding.value, result) }
      scanBlockForLambdas(with_.body, result)
    }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { scanExpressionForLambdas(declaration.value, result) }
        declaration: ReadonlyDeclaration -> { scanExpressionForLambdas(declaration.value, result) }
        binding: ImmutableBinding -> { scanExpressionForLambdas(binding.value, result) }
        declaration: LetDeclaration -> { scanExpressionForLambdas(declaration.value, result) }
        expression: ExpressionStatement -> { scanExpressionForLambdas(expression.expression, result) }
        destructuring: DestructuringStatement -> { scanExpressionForLambdas(destructuring.value, result) }
      }
    }
    assignment: YieldBlockAssignmentStatement -> { scanExpressionForLambdas(assignment.value, result) }
    block: Block -> { scanBlockForLambdas(block, result) }
    _ -> { }
  }
}

function scanExpressionForLambdas(expression: Expression, result: string[]): void {
  case expression {
    binary: BinaryExpression -> { scanExpressionForLambdas(binary.left, result)
      scanExpressionForLambdas(binary.right, result) }
    unary: UnaryExpression -> { scanExpressionForLambdas(unary.operand, result) }
    assignment: AssignmentExpression -> { scanExpressionForLambdas(assignment.target, result)
      scanExpressionForLambdas(assignment.value, result) }
    member: MemberExpression -> { scanExpressionForLambdas(member.object, result) }
    index: IndexExpression -> { scanExpressionForLambdas(index.object, result)
      scanExpressionForLambdas(index.index, result) }
    call: CallExpression -> { scanExpressionForLambdas(call.callee, result)
      for argument of call.args { scanExpressionForLambdas(argument.value, result) } }
    array: ArrayLiteral -> { for element of array.elements { scanExpressionForLambdas(element, result) } }
    object: ObjectLiteral -> {
      for property of object.properties {
        if property.key != null { scanExpressionForLambdas(property.key!, result) }
        if property.value != null { scanExpressionForLambdas(property.value!, result) }
      }
      if object.spread != null { scanExpressionForLambdas(object.spread!, result) }
    }
    tuple: TupleLiteral -> { for element of tuple.elements { scanExpressionForLambdas(element, result) } }
    string_: StringLiteral -> { for interpolation of string_.interpolations { scanExpressionForLambdas(interpolation, result) } }
    lambda: LambdaExpression -> {
      case lambda.body {
        block: Block -> {
          collectBlockCaptures(block, block.span.start.offset, block.span.end.offset, result, true)
          scanBlockForLambdas(block, result)
        }
        body: Expression -> {
          collectExpressionCaptures(body, body.span.start.offset, body.span.end.offset, result, true)
          scanExpressionForLambdas(body, result)
        }
      }
    }
    if_: IfExpression -> { scanExpressionForLambdas(if_.condition, result)
      scanExpressionForLambdas(if_.then_, result)
      scanExpressionForLambdas(if_.else_, result) }
    case_: CaseExpression -> { scanExpressionForLambdas(case_.subject, result)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { scanBlockForLambdas(block, result) }
          bodyExpression: Expression -> { scanExpressionForLambdas(bodyExpression, result) }
        }
      } }
    construct: ConstructExpression -> { for property of construct.args { if property.value != null { scanExpressionForLambdas(property.value!, result) } } }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { scanBlockForLambdas(block, result) }
        inner: Expression -> { scanExpressionForLambdas(inner, result) }
      }
    }
    retire_: RetireExpression -> { scanExpressionForLambdas(retire_.actor, result) }
    actor: ActorCreationExpression -> { for argument of actor.args { scanExpressionForLambdas(argument, result) } }
    yieldBlock: YieldBlockExpression -> { scanBlockForLambdas(yieldBlock.body, result) }
    catch_: CatchExpression -> { scanBlockForLambdas(catch_.body, result) }
    _ -> { }
  }
}

function collectBlockCaptures(block: Block, bodyStart: int, bodyEnd: int, result: string[], mutableOnly: bool): void {
  for statement of block.statements { collectStatementCaptures(statement, bodyStart, bodyEnd, result, mutableOnly) }
}

function collectStatementCaptures(statement: Statement, bodyStart: int, bodyEnd: int, result: string[], mutableOnly: bool): void {
  case statement {
    const_: ConstDeclaration -> { collectExpressionCaptures(const_.value, bodyStart, bodyEnd, result, mutableOnly) }
    readonly_: ReadonlyDeclaration -> { collectExpressionCaptures(readonly_.value, bodyStart, bodyEnd, result, mutableOnly) }
    binding: ImmutableBinding -> {
      collectExpressionCaptures(binding.value, bodyStart, bodyEnd, result, mutableOnly)
      if binding.else_ != null { collectBlockCaptures(binding.else_!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    let_: LetDeclaration -> { collectExpressionCaptures(let_.value, bodyStart, bodyEnd, result, mutableOnly) }
    expression: ExpressionStatement -> { collectExpressionCaptures(expression.expression, bodyStart, bodyEnd, result, mutableOnly) }
    return_: ReturnStatement -> { if return_.value != null { collectExpressionCaptures(return_.value!, bodyStart, bodyEnd, result, mutableOnly) } }
    if_: IfStatement -> {
      collectExpressionCaptures(if_.condition, bodyStart, bodyEnd, result, mutableOnly)
      collectBlockCaptures(if_.body, bodyStart, bodyEnd, result, mutableOnly)
      for branch of if_.elseIfs { collectExpressionCaptures(branch.condition, bodyStart, bodyEnd, result, mutableOnly)
        collectBlockCaptures(branch.body, bodyStart, bodyEnd, result, mutableOnly) }
      if if_.else_ != null { collectBlockCaptures(if_.else_!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    case_: CaseStatement -> { collectExpressionCaptures(case_.subject, bodyStart, bodyEnd, result, mutableOnly)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { collectBlockCaptures(block, bodyStart, bodyEnd, result, mutableOnly) }
          expression: Expression -> { collectExpressionCaptures(expression, bodyStart, bodyEnd, result, mutableOnly) }
        }
      } }
    while_: WhileStatement -> {
      collectExpressionCaptures(while_.condition, bodyStart, bodyEnd, result, mutableOnly)
      collectBlockCaptures(while_.body, bodyStart, bodyEnd, result, mutableOnly)
      if while_.then_ != null { collectBlockCaptures(while_.then_!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    for_: ForStatement -> {
      if for_.init != null { collectStatementCaptures(for_.init!, bodyStart, bodyEnd, result, mutableOnly) }
      if for_.condition != null { collectExpressionCaptures(for_.condition!, bodyStart, bodyEnd, result, mutableOnly) }
      for update of for_.update { collectExpressionCaptures(update, bodyStart, bodyEnd, result, mutableOnly) }
      collectBlockCaptures(for_.body, bodyStart, bodyEnd, result, mutableOnly)
      if for_.then_ != null { collectBlockCaptures(for_.then_!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    forOf: ForOfStatement -> {
      collectExpressionCaptures(forOf.iterable, bodyStart, bodyEnd, result, mutableOnly)
      collectBlockCaptures(forOf.body, bodyStart, bodyEnd, result, mutableOnly)
      if forOf.then_ != null { collectBlockCaptures(forOf.then_!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    with_: WithStatement -> { for binding of with_.bindings { collectExpressionCaptures(binding.value, bodyStart, bodyEnd, result, mutableOnly) }
      collectBlockCaptures(with_.body, bodyStart, bodyEnd, result, mutableOnly) }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { collectExpressionCaptures(declaration.value, bodyStart, bodyEnd, result, mutableOnly) }
        declaration: ReadonlyDeclaration -> { collectExpressionCaptures(declaration.value, bodyStart, bodyEnd, result, mutableOnly) }
        binding: ImmutableBinding -> { collectExpressionCaptures(binding.value, bodyStart, bodyEnd, result, mutableOnly) }
        declaration: LetDeclaration -> { collectExpressionCaptures(declaration.value, bodyStart, bodyEnd, result, mutableOnly) }
        expression: ExpressionStatement -> { collectExpressionCaptures(expression.expression, bodyStart, bodyEnd, result, mutableOnly) }
        destructuring: DestructuringStatement -> { collectExpressionCaptures(destructuring.value, bodyStart, bodyEnd, result, mutableOnly) }
      }
    }
    assignment: YieldBlockAssignmentStatement -> { collectExpressionCaptures(assignment.value, bodyStart, bodyEnd, result, mutableOnly) }
    block: Block -> { collectBlockCaptures(block, bodyStart, bodyEnd, result, mutableOnly) }
    _ -> { }
  }
}

function collectExpressionCaptures(expression: Expression, bodyStart: int, bodyEnd: int, result: string[], mutableOnly: bool): void {
  case expression {
    identifier: Identifier -> { collectIdentifierCapture(identifier, bodyStart, bodyEnd, result, mutableOnly) }
    _: ThisExpression -> { if !mutableOnly { addUnique(result, "this") } }
    binary: BinaryExpression -> { collectExpressionCaptures(binary.left, bodyStart, bodyEnd, result, mutableOnly)
      collectExpressionCaptures(binary.right, bodyStart, bodyEnd, result, mutableOnly) }
    unary: UnaryExpression -> { collectExpressionCaptures(unary.operand, bodyStart, bodyEnd, result, mutableOnly) }
    assignment: AssignmentExpression -> { collectExpressionCaptures(assignment.target, bodyStart, bodyEnd, result, mutableOnly)
      collectExpressionCaptures(assignment.value, bodyStart, bodyEnd, result, mutableOnly) }
    member: MemberExpression -> { collectExpressionCaptures(member.object, bodyStart, bodyEnd, result, mutableOnly) }
    index: IndexExpression -> { collectExpressionCaptures(index.object, bodyStart, bodyEnd, result, mutableOnly)
      collectExpressionCaptures(index.index, bodyStart, bodyEnd, result, mutableOnly) }
    call: CallExpression -> { collectExpressionCaptures(call.callee, bodyStart, bodyEnd, result, mutableOnly)
      for argument of call.args { collectExpressionCaptures(argument.value, bodyStart, bodyEnd, result, mutableOnly) } }
    array: ArrayLiteral -> { for element of array.elements { collectExpressionCaptures(element, bodyStart, bodyEnd, result, mutableOnly) } }
    object: ObjectLiteral -> {
      for property of object.properties {
        if property.key != null { collectExpressionCaptures(property.key!, bodyStart, bodyEnd, result, mutableOnly) }
        if property.value != null { collectExpressionCaptures(property.value!, bodyStart, bodyEnd, result, mutableOnly) }
      }
      if object.spread != null { collectExpressionCaptures(object.spread!, bodyStart, bodyEnd, result, mutableOnly) }
    }
    tuple: TupleLiteral -> { for element of tuple.elements { collectExpressionCaptures(element, bodyStart, bodyEnd, result, mutableOnly) } }
    string_: StringLiteral -> { for interpolation of string_.interpolations { collectExpressionCaptures(interpolation, bodyStart, bodyEnd, result, mutableOnly) } }
    lambda: LambdaExpression -> {
      case lambda.body {
        block: Block -> { collectBlockCaptures(block, bodyStart, bodyEnd, result, mutableOnly) }
        body: Expression -> { collectExpressionCaptures(body, bodyStart, bodyEnd, result, mutableOnly) }
      }
    }
    if_: IfExpression -> { collectExpressionCaptures(if_.condition, bodyStart, bodyEnd, result, mutableOnly)
      collectExpressionCaptures(if_.then_, bodyStart, bodyEnd, result, mutableOnly)
      collectExpressionCaptures(if_.else_, bodyStart, bodyEnd, result, mutableOnly) }
    case_: CaseExpression -> { collectExpressionCaptures(case_.subject, bodyStart, bodyEnd, result, mutableOnly)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { collectBlockCaptures(block, bodyStart, bodyEnd, result, mutableOnly) }
          bodyExpression: Expression -> { collectExpressionCaptures(bodyExpression, bodyStart, bodyEnd, result, mutableOnly) }
        }
      } }
    construct: ConstructExpression -> { for property of construct.args { if property.value != null { collectExpressionCaptures(property.value!, bodyStart, bodyEnd, result, mutableOnly) } } }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { collectBlockCaptures(block, bodyStart, bodyEnd, result, mutableOnly) }
        inner: Expression -> { collectExpressionCaptures(inner, bodyStart, bodyEnd, result, mutableOnly) }
      }
    }
    retire_: RetireExpression -> { collectExpressionCaptures(retire_.actor, bodyStart, bodyEnd, result, mutableOnly) }
    actor: ActorCreationExpression -> { for argument of actor.args { collectExpressionCaptures(argument, bodyStart, bodyEnd, result, mutableOnly) } }
    yieldBlock: YieldBlockExpression -> { collectBlockCaptures(yieldBlock.body, bodyStart, bodyEnd, result, mutableOnly) }
    catch_: CatchExpression -> { collectBlockCaptures(catch_.body, bodyStart, bodyEnd, result, mutableOnly) }
    _ -> { }
  }
}

function collectIdentifierCapture(identifier: Identifier, bodyStart: int, bodyEnd: int, result: string[], mutableOnly: bool): void {
  if identifier.resolvedBinding == null { return }
  binding := identifier.resolvedBinding!
  if binding.kind == "field" {
    if !mutableOnly { addUnique(result, "this") }
    return
  }
  if binding.kind == "method" {
    if !mutableOnly { addUnique(result, "this") }
    return
  }
  if binding.symbol != null || binding.kind == "builtin" || binding.kind == "import" { return }
  bindingStart := binding.span.start.offset
  if bindingStart >= bodyStart && bindingStart <= bodyEnd { return }
  if mutableOnly && !binding.mutable { return }
  addUnique(result, cppIdentifier(identifier.name))
}

function addUnique(values: string[], value: string): void {
  for existing of values { if existing == value { return } }
  values.push(value)
}
