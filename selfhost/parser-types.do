// Type annotation parsing for the self-hosted parser.

import type { Parser } from "./parser"
import { TokenType } from "./lexer"
import { AstFunctionType, ArrayType, FunctionTypeParam, NamedType, SourceSpan, UnionType } from "./ast"
import type { TypeAnnotation } from "./ast"

export function parseOptionalType(parser: Parser): TypeAnnotation | null {
  if !parser.match(TokenType.Colon) { return null }
  return parseTypeAnnotation(parser)
}

export function parseTypeAnnotation(parser: Parser): TypeAnnotation {
  first := parseTypeMember(parser)
  let types: TypeAnnotation[] = [first]
  while parser.match(TokenType.Pipe) { types.push(parseTypeMember(parser)) }
  let result: TypeAnnotation = first
  if types.length > 1 { result = UnionType { kind: "union-type", types, span: SourceSpan { start: first.span.start, end: types[types.length - 1].span.end } } }
  return result
}

function parseTypeMember(parser: Parser): TypeAnnotation {
  let readonlyPrefix = parser.match(TokenType.Readonly)
  let result = parsePrimaryType(parser)
  while parser.check(TokenType.LeftBracket) && parser.peek(1).kind == TokenType.RightBracket {
    start := result.span.start
    parser.advance()
    parser.advance()
    result = ArrayType { kind: "array-type", elementType: result, readonly_: readonlyPrefix, span: SourceSpan { start, end: parser.location() } }
    readonlyPrefix = false
  }
  if readonlyPrefix { parser.fail("readonly must qualify an array type") }
  return result
}

function parsePrimaryType(parser: Parser): TypeAnnotation {
  start := parser.location()
  if parser.check(TokenType.LeftParen) {
    if parser.peek(1).kind != TokenType.RightParen && !(parser.peek(1).kind == TokenType.Identifier && parser.peek(2).kind == TokenType.Colon) {
      parser.advance()
      inner := parseTypeAnnotation(parser)
      parser.expect(TokenType.RightParen)
      return inner
    }
    parser.advance()
    let params: FunctionTypeParam[] = []
    while !parser.check(TokenType.RightParen) && !parser.atEnd() {
      paramStart := parser.location()
      paramName := parser.text(parser.expect(TokenType.Identifier))
      parser.expect(TokenType.Colon)
      paramType := parseTypeAnnotation(parser)
      params.push(FunctionTypeParam { name: paramName, type_: paramType, span: parser.span(paramStart) })
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.RightParen)
    parser.expect(TokenType.Colon)
    returnType := parseTypeAnnotation(parser)
    return AstFunctionType { kind: "function-type", params, returnType, span: parser.span(start) }
  }
  nameToken := parser.advance()
  if nameToken.kind != TokenType.Identifier && nameToken.kind != TokenType.Void && nameToken.kind != TokenType.Null {
    parser.fail("Expected a type name")
  }
  name := parser.text(nameToken)
  let typeArgs: TypeAnnotation[] = []
  if parser.match(TokenType.Less) {
    while !parser.check(TokenType.Greater) && !parser.atEnd() {
      typeArgs.push(parseTypeAnnotation(parser))
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.Greater)
  }
  return NamedType { kind: "named-type", name, typeArgs, span: parser.span(start) }
}
