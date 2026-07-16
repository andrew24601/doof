// Public façade and token state for the self-hosted recursive-descent parser.
//
// Syntax-specific parsing lives in parser-declarations.do,
// parser-statements.do, parser-types.do, and parser-expressions.do.  Keeping
// token state here preserves the existing Parser { source }.parse() API while
// allowing each grammar area to stay independently focused.

import { Lexer, Token, TokenType, tokenValue } from "./lexer"
import {
  parseExport as parseExportImpl, parseConst as parseConstImpl,
  parseReadonly as parseReadonlyImpl, parseLet as parseLetImpl,
  parseFunction as parseFunctionImpl, parseClass as parseClassImpl,
  parseInterface as parseInterfaceImpl, parseEnum as parseEnumImpl,
  parseTypeAlias as parseTypeAliasImpl, parseImport as parseImportImpl,
  parseMockImport as parseMockImportImpl,
} from "./parser-declarations"
import {
  parseStatement as parseStatementImpl, parseBlock as parseBlockImpl,
  parseCaseExpression as parseCaseExpressionImpl,
  looksLikePattern as looksLikePatternImpl,
  parseDestructuring as parseDestructuringImpl,
  parseTryStatement as parseTryStatementImpl,
} from "./parser-statements"
import { parseOptionalType as parseOptionalTypeImpl, parseTypeAnnotation as parseTypeAnnotationImpl } from "./parser-types"
import { parseExpression as parseExpressionImpl, parseAdditive as parseAdditiveImpl, parseUnary as parseUnaryImpl } from "./parser-expressions"
import {
  Program, Block, ClassDeclaration, FunctionDeclaration, NamedType,
  Statement, Expression, TypeAnnotation, AstLocation, SourceSpan,
} from "./ast"

export class Parser {
  readonly source: string
  tokens: Token[] = []
  pos: int = 0
  inForIterable: bool = false
  errorMessage: string = ""
  errorLine: int = 0
  errorColumn: int = 0
  errorOffset: int = 0

  function parse(): Program {
    errorMessage = ""
    errorLine = 0
    errorColumn = 0
    errorOffset = 0
    lexer := Lexer { source }
    tokens = lexer.tokenize()
    pos = 0
    start := location()
    let statements: Statement[] = []
    while !atEnd() { statements.push(parseStatement()) }
    return Program { kind: "program", statements, span: span(start) }
  }

  // Shared parser state operations are public to the focused parser modules;
  // callers should continue to use parse() or the top-level parse() function.
  function current(): Token { return tokens[pos] }

  function peek(offset: int = 0): Token {
    index := pos + offset
    if index >= tokens.length { return tokens[tokens.length - 1] }
    return tokens[index]
  }

  function atEnd(): bool { return current().kind == TokenType.EndOfFile }

  function advance(): Token {
    token := current()
    if !atEnd() { pos = pos + 1 }
    return token
  }

  function check(kind: TokenType): bool { return current().kind == kind }

  function match(kind: TokenType): bool {
    if !check(kind) { return false }
    advance()
    return true
  }

  function expect(kind: TokenType, message: string = ""): Token {
    if check(kind) { return advance() }
    let expectedMessage = message
    if expectedMessage == "" { expectedMessage = "Expected " + expectedLabel(kind) + " before '" + currentText() + "'" }
    fail(expectedMessage)
    return current()
  }

  function fail(message: string): void {
    token := current()
    errorMessage = message
    errorLine = token.line
    errorColumn = token.column
    errorOffset = token.offset
    panic("Parse error at " + string(token.line) + ":" + string(token.column) + ": " + message)
  }

  private function expectedLabel(kind: TokenType): string {
    if kind == TokenType.Identifier { return "identifier" }
    if kind == TokenType.RightParen { return "')'" }
    if kind == TokenType.RightBrace { return "'}'" }
    if kind == TokenType.RightBracket { return "']'" }
    if kind == TokenType.Colon { return "':'" }
    if kind == TokenType.Equal { return "'='" }
    if kind == TokenType.Greater { return "'>'" }
    return "token"
  }

  function text(token: Token): string { return tokenValue(token, source) }
  private function currentText(): string { return text(current()) }

  function location(): AstLocation {
    token := current()
    return AstLocation { line: token.line, column: token.column, offset: token.offset }
  }

  function span(start: AstLocation): SourceSpan {
    previous := if pos > 0 then tokens[pos - 1] else current()
    return SourceSpan {
      start,
      end: AstLocation {
        line: previous.line,
        column: previous.column + previous.length,
        offset: previous.offset + previous.length,
      },
    }
  }

  function sameLineAsPrevious(): bool {
    if pos == 0 { return false }
    return tokens[pos - 1].line == current().line
  }

  function previousIs(kind: TokenType): bool {
    if pos == 0 { return false }
    return tokens[pos - 1].kind == kind
  }

  function immediatelyAfterPrevious(): bool {
    if pos == 0 { return false }
    previous := tokens[pos - 1]
    return previous.offset + previous.length == current().offset
  }

  function consumeSemicolon(): void { match(TokenType.Semicolon) }

  function locationSpan(): SourceSpan { start := location(); return SourceSpan { start, end: start } }

  // --------------------------------------------------------------------------
  // Focused parser-module entry points
  // --------------------------------------------------------------------------

  function parseStatement(): Statement { return parseStatementImpl(this) }
  function parseExport(): Statement { return parseExportImpl(this) }
  function parseConst(exported: bool): Statement { return parseConstImpl(this, exported) }
  function parseReadonly(exported: bool): Statement { return parseReadonlyImpl(this, exported) }
  function parseLet(): Statement { return parseLetImpl(this) }
  function parseFunction(exported: bool, static_: bool, isolated_: bool, private_: bool): FunctionDeclaration {
    return parseFunctionImpl(this, exported, static_, isolated_, private_)
  }
  function parseClass(exported: bool, private_: bool): Statement { return parseClassImpl(this, exported, private_) }
  function parseInterface(exported: bool): Statement { return parseInterfaceImpl(this, exported) }
  function parseEnum(exported: bool): Statement { return parseEnumImpl(this, exported) }
  function parseTypeAlias(exported: bool): Statement { return parseTypeAliasImpl(this, exported) }
  function parseImport(): Statement { return parseImportImpl(this) }
  function parseMockImport(): Statement { return parseMockImportImpl(this) }

  function parseBlock(): Block { return parseBlockImpl(this) }
  function parseCaseExpression(): Expression { return parseCaseExpressionImpl(this) }
  function looksLikePattern(separator: TokenType): bool { return looksLikePatternImpl(this, separator) }
  function parseDestructuring(shape: string, bindingKind: string, separator: TokenType): Statement {
    return parseDestructuringImpl(this, shape, bindingKind, separator)
  }
  function parseTryStatement(): Statement { return parseTryStatementImpl(this) }

  function parseOptionalType(): TypeAnnotation | null { return parseOptionalTypeImpl(this) }
  function parseTypeAnnotation(): TypeAnnotation { return parseTypeAnnotationImpl(this) }

  function parseExpression(): Expression { return parseExpressionImpl(this) }
  function parseAdditive(): Expression { return parseAdditiveImpl(this) }
  function parseUnary(): Expression { return parseUnaryImpl(this) }
}

export function parse(source: string): Program { return Parser { source }.parse() }
