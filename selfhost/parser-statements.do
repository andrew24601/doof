// Statement, control-flow, and case-pattern parsing for the self-hosted parser.

import type { Parser } from "./parser"
import { TokenType } from "./lexer"
import {
  Block, IfBranch, WithBinding, CaseArm, CaseExpression, CaseExpressionArm, CaseStatement,
  CasePattern, RangePattern, TypePattern, ValuePattern, WildcardPattern,
  IfStatement, WhileStatement, ForOfStatement, ForStatement, WithStatement,
  BreakStatement, ContinueStatement, ReturnStatement, YieldStatement,
  ExpressionStatement, DestructuringStatement, DestructureBinding, ConstDeclaration, ReadonlyDeclaration, ImmutableBinding, TryStatement,
  UnaryExpression, Identifier, LetDeclaration, LambdaExpression, CallExpression,
  CallArgument, AstLocation, SourceSpan, YieldBlockExpression, YieldBlockAssignmentStatement,
} from "./ast"
import type { Statement, Expression, TypeAnnotation } from "./ast"

export function parseStatement(parser: Parser): Statement {
  if parser.check(TokenType.Mock) { return parser.parseMockImport() }
  if parser.check(TokenType.Export) { return parser.parseExport() }
  if parser.check(TokenType.Import) { return parser.parseImport() }
  if parser.check(TokenType.Const) { return parser.parseConst(false) }
  if parser.check(TokenType.Readonly) && parser.peek(1).kind != TokenType.LeftBracket { return parser.parseReadonly(false) }
  if parser.check(TokenType.Let) { return parser.parseLet() }
  if parser.check(TokenType.Function) { return parser.parseFunction(false, false, false, false) }
  if parser.check(TokenType.Isolated) && parser.peek(1).kind == TokenType.Function {
    parser.advance()
    return parser.parseFunction(false, false, true, false)
  }
  if parser.check(TokenType.Class) || parser.check(TokenType.Struct) { return parser.parseClass(false, false) }
  if parser.check(TokenType.Private) {
    parser.advance()
    if parser.check(TokenType.Function) { return parser.parseFunction(false, false, false, true) }
    if parser.check(TokenType.Class) || parser.check(TokenType.Struct) { return parser.parseClass(false, true) }
    parser.fail("Expected function, class, or struct after private")
  }
  if parser.check(TokenType.Interface) { return parser.parseInterface(false) }
  if parser.check(TokenType.Enum) { return parser.parseEnum(false) }
  if parser.check(TokenType.Type) { return parser.parseTypeAlias(false) }
  if parser.check(TokenType.Return) { return parseReturn(parser) }
  if parser.check(TokenType.Yield) { return parseYield(parser) }
  if parser.check(TokenType.Try) { return parseTryStatement(parser) }
  if parser.check(TokenType.If) { return parseIfStatement(parser) }
  if parser.check(TokenType.Case) { return parseCaseStatement(parser) }
  if parser.check(TokenType.While) { return parseWhile(parser, null) }
  if parser.check(TokenType.For) { return parseFor(parser, null) }
  if parser.check(TokenType.With) { return parseWith(parser) }
  if parser.check(TokenType.Break) { return parseBreak(parser) }
  if parser.check(TokenType.Continue) { return parseContinue(parser) }

  if parser.check(TokenType.Identifier) {
    if parser.peek(1).kind == TokenType.Colon && looksLikeTypedImmutableBinding(parser) {
      return parseTypedImmutableBinding(parser)
    }
  }
  if parser.check(TokenType.Underscore) && parser.peek(1).kind == TokenType.ColonEqual {
    return parseDiscardElseBinding(parser)
  }
  if parser.check(TokenType.LeftBracket) {
    if looksLikePattern(parser, TokenType.ColonEqual) {
      return parseDestructuring(parser, "array", "immutable", TokenType.ColonEqual)
    }
    if looksLikePattern(parser, TokenType.Equal) {
      return parseDestructuring(parser, "array", "assignment", TokenType.Equal)
    }
  }
  if parser.check(TokenType.LeftParen) {
    if looksLikePattern(parser, TokenType.ColonEqual) {
      return parseDestructuring(parser, "positional", "immutable", TokenType.ColonEqual)
    }
    if looksLikePattern(parser, TokenType.Equal) {
      return parseDestructuring(parser, "positional", "assignment", TokenType.Equal)
    }
  }
  if parser.check(TokenType.LeftBrace) {
    if looksLikePattern(parser, TokenType.ColonEqual) {
      return parseDestructuring(parser, "named", "immutable", TokenType.ColonEqual)
    }
    if looksLikePattern(parser, TokenType.Equal) {
      return parseDestructuring(parser, "named", "assignment", TokenType.Equal)
    }
  }
  if parser.check(TokenType.LeftBrace) { parser.fail("Bare block statements are not allowed") }

  return parseExpressionStatement(parser)
}

function parseReturn(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Return)
  if parser.check(TokenType.RightBrace) || parser.check(TokenType.EndOfFile) || parser.check(TokenType.Semicolon) {
    parser.consumeSemicolon()
    return ReturnStatement { kind: "return-statement", span: parser.span(start) }
  }
  value := parser.parseExpression()
  parser.consumeSemicolon()
  return ReturnStatement { kind: "return-statement", value: value, span: parser.span(start) }
}

function parseYield(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Yield)
  value := parser.parseExpression()
  parser.consumeSemicolon()
  return YieldStatement { kind: "yield-statement", value: value, span: parser.span(start) }
}

function parseIfStatement(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.If)
  condition := parser.parseExpression()
  body := parseBlock(parser)
  let elseIfs: IfBranch[] = []
  let else_: Block | null = null
  while parser.match(TokenType.Else) {
    if parser.match(TokenType.If) {
      branchStart := parser.location()
      branchCondition := parser.parseExpression()
      branchBody := parseBlock(parser)
      elseIfs.push(IfBranch { condition: branchCondition, body: branchBody, span: parser.span(branchStart) })
    } else {
      else_ = parseBlock(parser)
      break
    }
  }
  return IfStatement { kind: "if-statement", condition, body, elseIfs, else_, span: parser.span(start) }
}

function parseCaseStatement(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Case)
  subject := parser.parseExpression()
  parser.expect(TokenType.LeftBrace)
  let arms: CaseArm[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    armStart := parser.location()
    let patterns: CasePattern[] = [parseCasePattern(parser)]
    while parser.match(TokenType.Pipe) { patterns.push(parseCasePattern(parser)) }
    parser.expect(TokenType.RightArrow)
    body := if parser.check(TokenType.LeftBrace) then parseBlock(parser) else parseInlineCaseArm(parser)
    arms.push(CaseArm { kind: "case-arm", patterns, body, span: parser.span(armStart) })
    parser.match(TokenType.Comma)
  }
  parser.expect(TokenType.RightBrace)
  parser.consumeSemicolon()
  return CaseStatement { kind: "case-statement", subject, arms, span: parser.span(start) }
}

export function parseCaseExpression(parser: Parser): Expression {
  start := parser.location()
  parser.expect(TokenType.Case)
  subject := parser.parseExpression()
  parser.expect(TokenType.LeftBrace)
  let arms: CaseExpressionArm[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    armStart := parser.location()
    let patterns: CasePattern[] = [parseCasePattern(parser)]
    while parser.match(TokenType.Pipe) { patterns.push(parseCasePattern(parser)) }
    parser.expect(TokenType.RightArrow)
    body := parseCaseExpressionBody(parser)
    arms.push(CaseExpressionArm { kind: "case-expression-arm", patterns, body, span: parser.span(armStart) })
    parser.match(TokenType.Comma)
  }
  parser.expect(TokenType.RightBrace)
  return CaseExpression { kind: "case-expression", subject, arms, span: parser.span(start) }
}

// Keep the Expression/Block promotion at a typed boundary so generated C++
// does not try to represent this choice as a native conditional expression.
function parseCaseExpressionBody(parser: Parser): Expression | Block {
  if parser.check(TokenType.LeftBrace) { return parseBlock(parser) }
  return parser.parseExpression()
}

function parseInlineCaseArm(parser: Parser): Block {
  statement := parseStatement(parser)
  return Block { kind: "block", statements: [statement], span: statement.span }
}

function parseCasePattern(parser: Parser): CasePattern {
  start := parser.location()
  if parser.match(TokenType.Underscore) {
    if parser.match(TokenType.Colon) {
      typeValue := parser.parseTypeAnnotation()
      return TypePattern { kind: "type-pattern", name: "_", type_: typeValue, span: parser.span(start) }
    }
    return WildcardPattern { kind: "wildcard-pattern", span: parser.span(start) }
  }
  if parser.match(TokenType.DotDotLess) {
    end := parser.parseAdditive()
    return RangePattern {
      kind: "range-pattern", start: null, end, inclusive: false, span: parser.span(start),
    }
  }
  if parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.Colon {
    name := parser.text(parser.advance())
    parser.advance()
    typeValue := parser.parseTypeAnnotation()
    return TypePattern { kind: "type-pattern", name, type_: typeValue, span: parser.span(start) }
  }
  // Pattern alternatives use `|` as a separator, so a value pattern must
  // stop before bitwise-or rather than consume the rest of the arm.
  value := parser.parseAdditive()
  if parser.match(TokenType.DotDot) {
    if parser.check(TokenType.RightArrow) || parser.check(TokenType.Pipe) || parser.check(TokenType.Comma) || parser.check(TokenType.RightBrace) || parser.atEnd() {
      return RangePattern {
        kind: "range-pattern", start: value, end: null, inclusive: true, span: parser.span(start),
      }
    }
    end := parser.parseAdditive()
    return RangePattern {
      kind: "range-pattern", start: value, end, inclusive: true, span: parser.span(start),
    }
  }
  if parser.match(TokenType.DotDotLess) {
    end := parser.parseAdditive()
    return RangePattern {
      kind: "range-pattern", start: value, end, inclusive: false, span: parser.span(start),
    }
  }
  return ValuePattern { kind: "value-pattern", value, span: parser.span(start) }
}

function parseWhile(parser: Parser, label: string | null): Statement {
  start := parser.location()
  parser.expect(TokenType.While)
  condition := parser.parseExpression()
  body := parseBlock(parser)
  let then_: Block | null = null
  if parser.match(TokenType.Then) { then_ = parseBlock(parser) }
  return WhileStatement { kind: "while-statement", condition, body, label, then_, span: parser.span(start) }
}

function parseFor(parser: Parser, label: string | null): Statement {
  start := parser.location()
  parser.expect(TokenType.For)
  if parser.check(TokenType.Identifier) && (parser.peek(1).kind == TokenType.Of || parser.peek(1).kind == TokenType.Comma) {
    let bindings: string[] = [parser.text(parser.advance())]
    while parser.match(TokenType.Comma) { bindings.push(parser.text(parser.expect(TokenType.Identifier))) }
    parser.expect(TokenType.Of)
    parser.inForIterable = true
    iterable := parser.parseExpression()
    parser.inForIterable = false
    body := parseBlock(parser)
    let then_: Block | null = null
    if parser.match(TokenType.Then) { then_ = parseBlock(parser) }
    return ForOfStatement { kind: "for-of-statement", bindings, iterable, body, label, then_, span: parser.span(start) }
  }
  let init: Statement | null = null
  if !parser.check(TokenType.Semicolon) {
    if parser.check(TokenType.Let) { init = parseLetNoSemicolon(parser) }
    else { init = parseExpressionStatementNoSemicolon(parser) }
  }
  parser.expect(TokenType.Semicolon)
  let condition: Expression | null = null
  if !parser.check(TokenType.Semicolon) { condition = parser.parseExpression() }
  parser.expect(TokenType.Semicolon)
  let update: Expression[] = []
  while !parser.check(TokenType.LeftBrace) && !parser.atEnd() {
    update.push(parser.parseExpression())
    if !parser.match(TokenType.Comma) { break }
  }
  body := parseBlock(parser)
  let then_: Block | null = null
  if parser.match(TokenType.Then) { then_ = parseBlock(parser) }
  return ForStatement { kind: "for-statement", init, condition, update, body, label, then_, span: parser.span(start) }
}

function parseLetNoSemicolon(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Let)
  name := parser.text(parser.expect(TokenType.Identifier))
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  return LetDeclaration { kind: "let-declaration", name, type_: typeValue, value, span: parser.span(start) }
}

function parseExpressionStatementNoSemicolon(parser: Parser): Statement {
  start := parser.location()
  value := parser.parseExpression()
  return ExpressionStatement { kind: "expression-statement", expression: value, span: parser.span(start) }
}

function parseWith(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.With)
  let bindings: WithBinding[] = []
  while !parser.check(TokenType.LeftBrace) && !parser.atEnd() {
    bindingStart := parser.location()
    name := parser.text(parser.expect(TokenType.Identifier))
    typeValue := parser.parseOptionalType()
    parser.expect(TokenType.ColonEqual)
    value := parser.parseExpression()
    bindings.push(WithBinding { name, type_: typeValue, value, span: parser.span(bindingStart) })
    if !parser.match(TokenType.Comma) { break }
  }
  body := parseBlock(parser)
  return WithStatement { kind: "with-statement", bindings, body, span: parser.span(start) }
}

function parseBreak(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Break)
  let label: string | null = null
  if parser.check(TokenType.Identifier) && parser.sameLineAsPrevious() { label = parser.text(parser.advance()) }
  parser.consumeSemicolon()
  return BreakStatement { kind: "break-statement", label, span: parser.span(start) }
}

function parseContinue(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Continue)
  let label: string | null = null
  if parser.check(TokenType.Identifier) && parser.sameLineAsPrevious() { label = parser.text(parser.advance()) }
  parser.consumeSemicolon()
  return ContinueStatement { kind: "continue-statement", label, span: parser.span(start) }
}

export function parseBlock(parser: Parser): Block {
  start := parser.location()
  parser.expect(TokenType.LeftBrace)
  let statements: Statement[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() { statements.push(parseStatement(parser)) }
  parser.expect(TokenType.RightBrace)
  return Block { kind: "block", statements, span: parser.span(start) }
}

export function looksLikePattern(parser: Parser, separator: TokenType): bool {
  let depth = 0
  let index = 0
  while index < 128 {
    token := parser.peek(index)
    if token.kind == TokenType.EndOfFile { return false }
    if token.kind == TokenType.LeftBracket || token.kind == TokenType.LeftParen || token.kind == TokenType.LeftBrace { depth = depth + 1 }
    if token.kind == TokenType.RightBracket || token.kind == TokenType.RightParen || token.kind == TokenType.RightBrace { depth = depth - 1 }
    if depth == 0 && token.kind == separator { return true }
    if depth == 0 && token.kind == TokenType.Equal { return separator == TokenType.Equal }
    index = index + 1
  }
  return false
}

export function parseDestructuring(parser: Parser, shape: string, bindingKind: string, separator: TokenType): Statement {
  start := parser.location()
  let close = TokenType.RightParen
  let open = TokenType.LeftParen
  if shape == "array" { close = TokenType.RightBracket; open = TokenType.LeftBracket }
  if shape == "named" { close = TokenType.RightBrace; open = TokenType.LeftBrace }
  parser.expect(open)
  let bindings: string[] = []
  let namedBindings: DestructureBinding[] = []
  while !parser.check(close) && !parser.atEnd() {
    bindingStart := parser.location()
    if shape == "named" {
      name := parser.text(parser.expect(TokenType.Identifier))
      let alias: string | null = null
      if parser.match(TokenType.As) { alias = parser.text(parser.expect(TokenType.Identifier)) }
      namedBindings.push(DestructureBinding { name, alias, span: parser.span(bindingStart) })
    } else if parser.check(TokenType.Underscore) { bindings.push("_"); parser.advance() }
    else { bindings.push(parser.text(parser.expect(TokenType.Identifier))) }
    if !parser.match(TokenType.Comma) { break }
  }
  parser.expect(close)
  parser.expect(separator)
  value := parser.parseExpression()
  parser.consumeSemicolon()
  let kind = if shape == "array" then "array-destructuring" else if shape == "named" then "named-destructuring" else "positional-destructuring"
  if bindingKind == "assignment" { kind = kind + "-assignment" }
  return DestructuringStatement { kind, bindings, namedBindings, bindingKind, value, span: parser.span(start) }
}

function parseExpressionStatement(parser: Parser): Statement {
  start := parser.location()
  if parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.LeftArrow {
    name := parser.text(parser.advance())
    parser.advance()
    blockStart := parser.location()
    if !parser.check(TokenType.LeftBrace) { parser.fail("Expected block after '<-'") }
    body := parseBlock(parser)
    value := YieldBlockExpression { body, span: parser.span(blockStart) }
    parser.consumeSemicolon()
    return YieldBlockAssignmentStatement { name, value, span: parser.span(start) }
  }
  if parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.ColonEqual {
    name := parser.text(parser.advance())
    parser.advance()
    rhs := parser.parseExpression()
    let else_: Block | null = null
    let failureName: string | null = null
    if parser.check(TokenType.Else) {
      capture := parseElseCaptureAndBlock(parser)
      else_ = capture.block
      failureName = capture.failureName
    }
    parser.consumeSemicolon()
    return ImmutableBinding { kind: "immutable-binding", name, type_: null, value: rhs, exported: false, else_, failureName, span: parser.span(start) }
  }
  let value = parser.parseExpression()
  if parser.check(TokenType.Else) {
    capture := parseElseCaptureAndBlock(parser)
    parser.consumeSemicolon()
    return ImmutableBinding {
      kind: "immutable-binding", name: "_", type_: null, value, exported: false,
      else_: capture.block, failureName: capture.failureName, span: parser.span(start),
    }
  }
  value = parseTrailingLambdaExpressionStatement(parser, value)
  parser.consumeSemicolon()
  return ExpressionStatement { kind: "expression-statement", expression: value, span: parser.span(start) }
}

// Trailing lambdas are statement-only syntax, so attach the block only after
// the ordinary expression parser has produced the complete call expression.
function parseTrailingLambdaExpressionStatement(parser: Parser, expression: Expression): Expression {
  if !parser.previousIs(TokenType.RightParen) || !parser.check(TokenType.LeftBrace) || !parser.sameLineAsPrevious() {
    return expression
  }
  case expression {
    call: CallExpression -> {
      block := parseBlock(parser)
      lambda := LambdaExpression {
        kind: "lambda-expression", params: [], returnType: null, body: block,
        parameterless: true, trailing: true, span: block.span,
      }
      call.args.push(CallArgument { name: null, value: lambda, span: block.span })
      call.span = SourceSpan { start: call.span.start, end: block.span.end }
      if parser.sameLineAsPrevious() && (
        parser.check(TokenType.Dot) || parser.check(TokenType.DoubleColon) ||
        parser.check(TokenType.QuestionDot) || parser.check(TokenType.BangDot) ||
        parser.check(TokenType.LeftParen) || parser.check(TokenType.LeftBracket) ||
        parser.check(TokenType.QuestionBracket) || parser.check(TokenType.Bang)
      ) {
        parser.fail("Chaining after a trailing lambda is not allowed; use an explicit lambda instead")
      }
      return call
    }
    _ -> { return expression }
  }
}

export function parseTryStatement(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Try)
  if parser.check(TokenType.Bang) || (parser.check(TokenType.Identifier) && parser.text(parser.current()) == "?") {
    let operator = "try!"
    if parser.match(TokenType.Bang) { operator = "try!" }
    else { parser.advance(); operator = "try?" }
    operand := parser.parseUnary()
    parser.consumeSemicolon()
    return ExpressionStatement {
      kind: "expression-statement",
      expression: UnaryExpression { kind: "unary-expression", operator, operand, prefix: true, span: SourceSpan { start, end: operand.span.end } },
      span: parser.span(start),
    }
  }
  if parser.check(TokenType.Const) {
    case parser.parseConst(false) {
      binding: ConstDeclaration -> { return TryStatement { kind: "try-statement", binding, span: parser.span(start) } }
      _ -> { parser.fail("Expected const declaration after try") }
    }
  }
  if parser.check(TokenType.Readonly) {
    case parser.parseReadonly(false) {
      binding: ReadonlyDeclaration -> { return TryStatement { kind: "try-statement", binding, span: parser.span(start) } }
      _ -> { parser.fail("Expected readonly declaration after try") }
    }
  }
  if parser.check(TokenType.Let) {
    case parser.parseLet() {
      binding: LetDeclaration -> { return TryStatement { kind: "try-statement", binding, span: parser.span(start) } }
      binding: DestructuringStatement -> { return TryStatement { kind: "try-statement", binding, span: parser.span(start) } }
      _ -> { parser.fail("Expected named let declaration after try") }
    }
  }
  if parser.check(TokenType.LeftBracket) {
    if looksLikePattern(parser, TokenType.ColonEqual) { return wrapTryDestructuring(parser, start, "array", "immutable", TokenType.ColonEqual) }
    if looksLikePattern(parser, TokenType.Equal) { return wrapTryDestructuring(parser, start, "array", "assignment", TokenType.Equal) }
  }
  if parser.check(TokenType.LeftParen) {
    if looksLikePattern(parser, TokenType.ColonEqual) { return wrapTryDestructuring(parser, start, "positional", "immutable", TokenType.ColonEqual) }
    if looksLikePattern(parser, TokenType.Equal) { return wrapTryDestructuring(parser, start, "positional", "assignment", TokenType.Equal) }
  }
  if parser.check(TokenType.LeftBrace) {
    if looksLikePattern(parser, TokenType.ColonEqual) { return wrapTryDestructuring(parser, start, "named", "immutable", TokenType.ColonEqual) }
    if looksLikePattern(parser, TokenType.Equal) { return wrapTryDestructuring(parser, start, "named", "assignment", TokenType.Equal) }
  }
  if parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.ColonEqual {
    name := parser.text(parser.advance())
    parser.advance()
    value := parser.parseExpression()
    let else_: Block | null = null
    if parser.match(TokenType.Else) { else_ = parseBlock(parser) }
    parser.consumeSemicolon()
    binding := ImmutableBinding {
      kind: "immutable-binding", name, type_: null, value, exported: false, else_,
      span: parser.span(start),
    }
    return TryStatement { kind: "try-statement", binding, span: parser.span(start) }
  }
  value := parser.parseExpression()
  parser.consumeSemicolon()
  return TryStatement {
    kind: "try-statement",
    binding: ExpressionStatement { kind: "expression-statement", expression: value, span: parser.span(start) },
    span: parser.span(start),
  }
}

function wrapTryDestructuring(parser: Parser, start: AstLocation, shape: string, bindingKind: string, separator: TokenType): Statement {
  case parseDestructuring(parser, shape, bindingKind, separator) {
    binding: DestructuringStatement -> { return TryStatement { kind: "try-statement", binding, span: parser.span(start) } }
    _ -> { parser.fail("Expected destructuring after try") }
  }
  return ExpressionStatement { kind: "expression-statement", expression: Identifier { kind: "identifier", name: "<error>", span: parser.locationSpan() }, span: parser.span(start) }
}

function parseInitializer(parser: Parser): Expression {
  if parser.match(TokenType.Equal) { return parser.parseExpression() }
  parser.fail("Expected '=' in declaration")
  return Identifier { kind: "identifier", name: "<error>", span: parser.locationSpan() }
}

function looksLikeTypedImmutableBinding(parser: Parser): bool {
  let index = 2
  while index < 64 {
    token := parser.peek(index)
    if token.kind == TokenType.EndOfFile || token.kind == TokenType.Semicolon || token.kind == TokenType.LeftBrace { return false }
    if token.kind == TokenType.ColonEqual { return true }
    index = index + 1
  }
  return false
}

function parseTypedImmutableBinding(parser: Parser): Statement {
  start := parser.location()
  name := parser.text(parser.expect(TokenType.Identifier))
  parser.expect(TokenType.Colon)
  typeValue := parser.parseTypeAnnotation()
  parser.expect(TokenType.ColonEqual)
  value := parser.parseExpression()
  let else_: Block | null = null
  let failureName: string | null = null
  if parser.check(TokenType.Else) {
    capture := parseElseCaptureAndBlock(parser)
    else_ = capture.block
    failureName = capture.failureName
  }
  parser.consumeSemicolon()
  return ImmutableBinding { kind: "immutable-binding", name, type_: typeValue, value, exported: false, else_, failureName, span: parser.span(start) }
}

function parseDiscardElseBinding(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Underscore)
  parser.expect(TokenType.ColonEqual)
  value := parser.parseExpression()
  if !parser.check(TokenType.Else) { parser.fail("Discard binding '_' requires an else block") }
  capture := parseElseCaptureAndBlock(parser)
  parser.consumeSemicolon()
  return ImmutableBinding {
    kind: "immutable-binding", name: "_", type_: null, value, exported: false,
    else_: capture.block, failureName: capture.failureName, span: parser.span(start),
  }
}

class ElseCapture {
  failureName: string | null
  block: Block
}

function parseElseCaptureAndBlock(parser: Parser): ElseCapture {
  parser.expect(TokenType.Else)
  let failureName: string | null = null
  if parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.LeftBrace {
    failureName = parser.text(parser.advance())
  }
  return ElseCapture { failureName, block: parseBlock(parser) }
}
